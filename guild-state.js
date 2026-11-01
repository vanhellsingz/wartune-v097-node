'use strict';
// ==========================================================================
// guild-state.js — Sistema de Guilda (Consortia) do Wartune Ultra
// Implementa busca, criação, membros, cargos e doação (contribuição).
// Persistência em MariaDB (consortia, consortia_members, consortia_contributions)
// e sincronização com characters.state_json.
// ==========================================================================

const fs = require('node:fs');
const path = require('node:path');
const attributeCalculator = require('./attribute-calculator');
const guildSkills = require('./guild-skills');
const configRoot = path.resolve(__dirname, '../res/release/config');

function loadCatalog(prefix) {
  const file = fs.readdirSync(configRoot).find(f => f.startsWith(prefix + '-') && f.endsWith('.json'));
  if (!file) return [];
  const data = JSON.parse(fs.readFileSync(path.join(configRoot, file), 'utf8'));
  return data[prefix] || [];
}

const consortiaLevelCatalog = loadCatalog('t_s_consortialevel');
const guildQuickPrice = Number(loadCatalog('t_s_config').find(c => c.ConfigName === 'ConsortiaQuic_Price')?.ConfigValue || 0);
const upgradeColumns = Object.freeze({1:'levels',2:'shop_level',3:'altar_level',4:'school_level',20:'store_level'});
const level1Config = consortiaLevelCatalog.find(c => Number(c.Types) === 1 && Number(c.Levels) === 1) || {
  Property1: 50000, // Gold
  Property2: 500    // Balens
};

function formatDate(d) {
  const date = d ? new Date(d) : new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function withGuildTransaction(pool, operation) {
  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    const result = await operation(cx);
    await cx.commit();
    return result;
  } catch (error) {
    await cx.rollback();
    throw error;
  } finally {
    cx.release();
  }
}

async function memberDuty(pool, characterId, consortiaId) {
  const [rows] = await pool.query(
    'SELECT duty_id FROM consortia_members WHERE character_id = ? AND consortia_id = ? LIMIT 1',
    [characterId, consortiaId]);
  return rows.length ? Number(rows[0].duty_id) : 0;
}

async function mayManageGuild(pool, characterId, consortiaId) {
  return [1,2].includes(await memberDuty(pool, characterId, consortiaId));
}

async function settleGuildUpgrade(pool, consortiaId) {
  return withGuildTransaction(pool, async cx => {
    const [guilds] = await cx.query('SELECT id FROM consortia WHERE id=? FOR UPDATE', [consortiaId]);
    if (!guilds.length) return false;
    const [pending] = await cx.query('SELECT * FROM consortia_upgrades WHERE consortia_id=? FOR UPDATE', [consortiaId]);
    if (!pending.length || new Date(pending[0].ready_at).getTime() > Date.now()) return false;
    const column = upgradeColumns[Number(pending[0].upgrade_type)];
    if (!column) throw new Error('Tipo de melhoria de guilda desconhecido');
    await cx.query(`UPDATE consortia SET ${column}=GREATEST(${column},?),updated_at=NOW() WHERE id=?`,
      [Number(pending[0].target_level), consortiaId]);
    await cx.query('DELETE FROM consortia_upgrades WHERE consortia_id=?', [consortiaId]);
    return true;
  });
}

async function upgradeGuild(pool, characterId, upgradeType) {
  const type = Number(upgradeType);
  const column = upgradeColumns[type];
  if (!column) return {ok:false,message:'Tipo de melhoria indisponivel'};
  return withGuildTransaction(pool, async cx => {
    const [membership] = await cx.query('SELECT consortia_id,duty_id FROM consortia_members WHERE character_id=?', [characterId]);
    if (!membership.length || ![1,2].includes(Number(membership[0].duty_id)))
      return {ok:false,message:'Cargo sem permissao para melhorar a guilda'};
    const guildId = Number(membership[0].consortia_id);
    const [guilds] = await cx.query('SELECT * FROM consortia WHERE id=? FOR UPDATE', [guildId]);
    if (!guilds.length) return {ok:false,message:'Guilda nao encontrada'};
    const [pending] = await cx.query('SELECT * FROM consortia_upgrades WHERE consortia_id=? FOR UPDATE', [guildId]);
    if (pending.length) {
      if (new Date(pending[0].ready_at).getTime() > Date.now())
        return {ok:false,message:'Melhoria em andamento',guildId};
      const oldColumn = upgradeColumns[Number(pending[0].upgrade_type)];
      if (!oldColumn) throw new Error('Tipo de melhoria pendente desconhecido');
      await cx.query(`UPDATE consortia SET ${oldColumn}=GREATEST(${oldColumn},?) WHERE id=?`,
        [Number(pending[0].target_level),guildId]);
      guilds[0][oldColumn]=Math.max(Number(guilds[0][oldColumn]),Number(pending[0].target_level));
      await cx.query('DELETE FROM consortia_upgrades WHERE consortia_id=?',[guildId]);
    }
    const nextLevel = Number(guilds[0][column] || 0)+1;
    const template = consortiaLevelCatalog.find(c => Number(c.Types)===type && Number(c.Levels)===nextLevel);
    if (!template) return {ok:false,message:'Nivel maximo atingido',guildId};
    if (type!==1 && nextLevel>Number(guilds[0].levels))
      return {ok:false,message:'Nivel da guilda insuficiente',guildId};
    const cost=Number(template.NeedOffer);
    const seconds=Number(template.CodeTime);
    if (!Number.isSafeInteger(cost)||cost<0||!Number.isSafeInteger(seconds)||seconds<0)
      throw new Error('Catalogo de melhoria invalido');
    if (Number(guilds[0].offer)<cost) return {ok:false,message:'Contribuicao insuficiente',guildId};
    await cx.query('UPDATE consortia SET offer=offer-?,updated_at=NOW() WHERE id=?',[cost,guildId]);
    if (seconds>0) {
      await cx.query('INSERT INTO consortia_upgrades(consortia_id,upgrade_type,target_level,offer_spent,started_at,ready_at) VALUES (?,?,?,?,NOW(3),DATE_ADD(NOW(3),INTERVAL ? SECOND))',
        [guildId,type,nextLevel,cost,seconds]);
    } else {
      await cx.query(`UPDATE consortia SET ${column}=? WHERE id=?`,[nextLevel,guildId]);
    }
    return {ok:true,guildId,type,targetLevel:nextLevel,offerSpent:cost,codeSeconds:seconds};
  });
}

async function accelerateGuildUpgrade(pool, characterId, payType) {
  if (![0,1].includes(Number(payType))) return {ok:false,message:'Forma de pagamento invalida'};
  if (!Number.isSafeInteger(guildQuickPrice)||guildQuickPrice<=0)
    return {ok:false,message:'Preco da aceleracao indisponivel'};
  return withGuildTransaction(pool, async cx => {
    const [membership]=await cx.query('SELECT consortia_id,duty_id FROM consortia_members WHERE character_id=?',[characterId]);
    if (!membership.length || ![1,2].includes(Number(membership[0].duty_id)))
      return {ok:false,message:'Cargo sem permissao'};
    const guildId=Number(membership[0].consortia_id);
    const [guilds]=await cx.query('SELECT id FROM consortia WHERE id=? FOR UPDATE',[guildId]);
    if (!guilds.length) return {ok:false,message:'Guilda nao encontrada'};
    const [pending]=await cx.query('SELECT * FROM consortia_upgrades WHERE consortia_id=? FOR UPDATE',[guildId]);
    if (!pending.length) return {ok:false,message:'Nenhuma melhoria em andamento',guildId};
    const remaining=Math.max(0,Math.ceil((new Date(pending[0].ready_at).getTime()-Date.now())/1000));
    const cost=guildQuickPrice*Math.ceil(remaining/600);
    const [characters]=await cx.query('SELECT crystals,bound_crystals,state_json FROM characters WHERE id=? FOR UPDATE',[characterId]);
    if (!characters.length) return {ok:false,message:'Personagem nao encontrado'};
    const balanceColumn=Number(payType)===0?'bound_crystals':'crystals';
    if (Number(characters[0][balanceColumn])<cost) return {ok:false,message:'Diamantes insuficientes',guildId};
    await cx.query(`UPDATE characters SET ${balanceColumn}=${balanceColumn}-? WHERE id=?`,[cost,characterId]);
    const saved=typeof characters[0].state_json==='string'?JSON.parse(characters[0].state_json):structuredClone(characters[0].state_json||{});
    saved.wallet=saved.wallet||{};
    saved.wallet[balanceColumn==='crystals'?'balens':'boundBalens']=Number(characters[0][balanceColumn])-cost;
    await cx.query('UPDATE characters SET state_json=? WHERE id=?',[JSON.stringify(saved),characterId]);
    const column=upgradeColumns[Number(pending[0].upgrade_type)];
    if (!column) throw new Error('Tipo de melhoria pendente desconhecido');
    await cx.query(`UPDATE consortia SET ${column}=GREATEST(${column},?),updated_at=NOW() WHERE id=?`,
      [Number(pending[0].target_level),guildId]);
    await cx.query('DELETE FROM consortia_upgrades WHERE consortia_id=?',[guildId]);
    return {ok:true,guildId,cost,level:Number(pending[0].target_level)};
  });
}

async function searchGuilds(pool, nameFilter, pageIndex) {
  let sql = `
    SELECT c.id, c.name, c.chairman_name, c.levels, c.offer, c.materials, c.description,
           (SELECT COUNT(*) FROM consortia_members cm WHERE cm.consortia_id = c.id) AS member_count
    FROM consortia c
  `;
  const params = [];
  if (nameFilter && nameFilter.trim()) {
    sql += ' WHERE c.name LIKE ?';
    params.push(`%${nameFilter.trim()}%`);
  }
  sql += ' ORDER BY c.levels DESC, c.offer DESC LIMIT 20';

  const [rows] = await pool.query(sql, params);
  const consortiaInfo = rows.map(r => ({
    consortiaId: Number(r.id),
    consortiaName: r.name,
    chairmanName: r.chairman_name,
    levels: Number(r.levels),
    offer: Number(r.offer),
    materials: Number(r.materials) || 0,
    currentCount: Number(r.member_count) || 1,
    honor: 0,
    description: r.description || '',
    isRobot: false
  }));

  return {
    consortiaInfo,
    totalRows: consortiaInfo.length,
    isReset: true
  };
}

async function getGuildInfo(pool, consortiaId) {
  if (!consortiaId || consortiaId <= 0) return null;
  await settleGuildUpgrade(pool, consortiaId);
  const [rows] = await pool.query(`
    SELECT c.*,
           (SELECT COUNT(*) FROM consortia_members cm WHERE cm.consortia_id = c.id) AS member_count
    FROM consortia c
    WHERE c.id = ?
    LIMIT 1
  `, [consortiaId]);

  if (!rows.length) return null;
  const r = rows[0];
  const [upgrades] = await pool.query('SELECT upgrade_type, started_at, ready_at FROM consortia_upgrades WHERE consortia_id=?', [consortiaId]);
  const pending = upgrades[0];
  const [powerRows] = await pool.query(`
    SELECT ch.grade, ch.state_json FROM consortia_members cm
    JOIN characters ch ON ch.id=cm.character_id WHERE cm.consortia_id=?`, [consortiaId]);
  const guildPower = powerRows.reduce((sum, member) =>
    sum + attributeCalculator.calculateAttributes(member).fightingCapacity, 0);
  const skillResearch = await guildSkills.researchLevels(pool, consortiaId);

  return {
    consortiaId: Number(r.id),
    consortiaName: r.name,
    creatorId: Number(r.creator_id),
    creatorName: r.creator_name,
    chairmanId: Number(r.chairman_id),
    chairmanName: r.chairman_name,
    levels: Number(r.levels),
    codeType: pending ? Number(pending.upgrade_type) : 0,
    codeBeginDate: formatDate(pending?.started_at),
    codeNeedDate: pending ? Math.max(0, Math.round((new Date(pending.ready_at)-new Date(pending.started_at))/1000)) : 0,
    currentDate: formatDate(),
    addCount: 0,
    currentCount: Number(r.member_count) || 1,
    kickCount: 0,
    shopLevel: Number(r.shop_level) || 1,
    storeLevel: Number(r.store_level) || 1,
    altarLevel: Number(r.altar_level) || 1,
    schoolLevel: Number(r.school_level) || 1,
    attackLevel: skillResearch.attackLevel,
    defenceLevel: skillResearch.defenceLevel,
    agilityLevel: skillResearch.agilityLevel,
    abilityLevel: skillResearch.abilityLevel,
    captainLevel: skillResearch.captainLevel,
    goldLevel: skillResearch.goldLevel,
    physiqueLevel: skillResearch.physiqueLevel,
    hiSkillList: skillResearch.hiSkillList,
    materials: Number(r.materials) || 0,
    fightPower: guildPower,
    offer: Number(r.offer) || 0,
    totalOffer: Number(r.total_offer) || 0,
    placard: r.placard || 'Bem-vindo à guilda!',
    description: r.description || 'Guilda de Guerreiros',
    createDate: formatDate(r.created_at)
  };
}

async function getGuildMembers(pool, consortiaId, onlineIds = new Set()) {
  if (!consortiaId || consortiaId <= 0) return { uuid: 'consortia_0', totalRows: 0, playerInfo: [] };

  const [rows] = await pool.query(`
    SELECT cm.duty_id, cm.offer, cm.total_offer, cm.build, cm.total_build,
           ch.id, ch.nickname, ch.icon, ch.grade, ch.sex, ch.camp, ch.crystals, ch.state_json,
           COALESCE(v.vip_level, ch.vip_level, 0) AS vip_level,
           COALESCE(v.vip_type, ch.vip_type, 1) AS vip_type,
           c.name AS consortia_name
    FROM consortia_members cm
    JOIN characters ch ON ch.id = cm.character_id
    JOIN consortia c ON c.id = cm.consortia_id
    LEFT JOIN vip v ON v.character_id = ch.id
    WHERE cm.consortia_id = ?
    ORDER BY cm.duty_id ASC, cm.total_offer DESC
  `, [consortiaId]);

  const playerInfo = rows.map(r => ({
    userId: Number(r.id),
    nickName: r.nickname,
    headId: Number(r.icon) || 1,
    grades: Number(r.grade),
    consortiaOffer: Number(r.offer),
    consortiaTotalOffer: Number(r.total_offer),
    consortiaBuild: Number(r.build) || 0,
    consortiaTotalBuild: Number(r.total_build) || 0,
    consortiaName: r.consortia_name,
    fightingCapacity: attributeCalculator.calculateAttributes(r).fightingCapacity,
    sexs: Number(r.sex) || 1,
    state: onlineIds.has(Number(r.id)) ? 1 : 0,
    job: Number(r.camp) || 1,
    role: 1,
    dutyId: Number(r.duty_id) || 5,
    isVip: Number(r.vip_level) > 0,
    vipType: Number(r.vip_type) || 1,
    logOutTime: formatDate(new Date())
  }));

  return {
    uuid: `consortia_${consortiaId}`,
    totalRows: playerInfo.length,
    playerInfo
  };
}

function getDutyList() {
  return {
    dutyInfo: [
      { levels: 1, dutyName: 'Líder', rights: Buffer.alloc(16, 0xFF) },
      { levels: 2, dutyName: 'Vice-Líder', rights: Buffer.alloc(16, 0x7F) },
      { levels: 3, dutyName: 'Oficial', rights: Buffer.alloc(16, 0x3F) },
      { levels: 4, dutyName: 'Elite', rights: Buffer.alloc(16, 0x1F) },
      { levels: 5, dutyName: 'Membro', rights: Buffer.alloc(16, 0x01) }
    ]
  };
}

async function createGuild(pool, character, saved, guildName, isPay) {
  if (!guildName || !guildName.trim()) {
    return { ok: false, message: 'Nome de guilda inválido' };
  }
  const cleanName = guildName.trim();
  if (cleanName.length > 30) return {ok:false,message:'Nome de guilda muito longo'};
  return withGuildTransaction(pool, async cx => {
  const [locked] = await cx.query('SELECT gold,crystals,state_json FROM characters WHERE id=? FOR UPDATE',[character.id]);
  if (!locked.length) return {ok:false,message:'Personagem nao encontrado'};
  character.gold=Number(locked[0].gold);
  character.crystals=Number(locked[0].crystals);
  saved=typeof locked[0].state_json==='string' ? JSON.parse(locked[0].state_json) : structuredClone(locked[0].state_json||{});
  const [membership]=await cx.query('SELECT id FROM consortia_members WHERE character_id=? FOR UPDATE',[character.id]);
  if (membership.length) return {ok:false,message:'Voce ja possui uma guilda'};

  // Verifica se o personagem já possui guilda
  if (saved.consortia && saved.consortia.id > 0) {
    return { ok: false, message: 'Você já possui uma guilda' };
  }

  // Verifica custo
  const needGold = Number(level1Config.Property1) || 50000;
  const needBalens = Number(level1Config.Property2) || 500;

  if (isPay) {
    const curBalens = Number(character.crystals) || 0;
    if (curBalens < needBalens) {
      return { ok: false, message: 'Balens insuficientes' };
    }
    character.crystals = curBalens - needBalens;
  } else {
    const curGold = Number(character.gold) || 0;
    if (curGold < needGold) {
      return { ok: false, message: 'Ouro insuficiente' };
    }
    character.gold = curGold - needGold;
  }

  // Insere guilda
  const [result] = await cx.query(`
    INSERT INTO consortia (name, creator_id, creator_name, chairman_id, chairman_name, levels, offer, total_offer, shop_level, store_level, altar_level, school_level, placard, description)
    VALUES (?, ?, ?, ?, ?, 1, 0, 0, 1, 1, 1, 1, 'Bem-vindo à guilda!', 'Guilda Ativa')
  `, [cleanName, character.id, character.nickname, character.id, character.nickname]);

  const guildId = result.insertId;

  // Insere membro líder
  await cx.query(`
    INSERT INTO consortia_members (consortia_id, character_id, duty_id, offer, total_offer)
    VALUES (?, ?, 1, 0, 0)
    ON DUPLICATE KEY UPDATE consortia_id = VALUES(consortia_id), duty_id = 1
  `, [guildId, character.id]);

  // Atualiza estado do personagem
  saved.consortia = {
    id: guildId,
    name: cleanName,
    dutyId: 1,
    offer: 0,
    totalOffer: 0
  };

  // Salva no banco characters
  await cx.query(`
    UPDATE characters
    SET gold = ?, crystals = ?, state_json = ?
    WHERE id = ?
  `, [character.gold, character.crystals, JSON.stringify(saved), character.id]);

  return {
    ok: true,
    guildId,
    guildName: cleanName
  };
  });
}

async function contributeGuild(pool, character, saved, offerGold, offerPoint) {
  return withGuildTransaction(pool, async cx => {
  const [locked]=await cx.query('SELECT gold,crystals,state_json FROM characters WHERE id=? FOR UPDATE',[character.id]);
  if (!locked.length) return {ok:false,message:'Personagem nao encontrado'};
  character.gold=Number(locked[0].gold);
  character.crystals=Number(locked[0].crystals);
  saved=typeof locked[0].state_json==='string' ? JSON.parse(locked[0].state_json) : structuredClone(locked[0].state_json||{});
  if (!saved.consortia || !saved.consortia.id) {
    return { ok: false, message: 'Personagem não possui guilda' };
  }
  const guildId = saved.consortia.id;
  const [membership]=await cx.query('SELECT id FROM consortia_members WHERE character_id=? AND consortia_id=? FOR UPDATE',[character.id,guildId]);
  if (!membership.length) return {ok:false,message:'Membro nao pertence a guilda'};
  const goldAmount = Number(offerGold);
  const pointAmount = Number(offerPoint);
  if (![goldAmount,pointAmount].every(value=>Number.isSafeInteger(value)&&value>=0))
    return {ok:false,message:'Valor de doacao invalido'};

  if (goldAmount <= 0 && pointAmount <= 0) {
    return { ok: false, message: 'Valor de doação inválido' };
  }

  // Valida recursos do jogador
  if (goldAmount > 0) {
    if ((Number(character.gold) || 0) < goldAmount) {
      return { ok: false, message: 'Ouro insuficiente para doação' };
    }
    character.gold = (Number(character.gold) || 0) - goldAmount;
  }
  if (pointAmount > 0) {
    if ((Number(character.crystals) || 0) < pointAmount) {
      return { ok: false, message: 'Balens insuficientes para doação' };
    }
    character.crystals = (Number(character.crystals) || 0) - pointAmount;
  }

  // Cálculo da contribuição no Wartune:
  // 1000 Gold = 1000 Fundos de Guilda + 1 Contribuição pessoal
  // 1 Balen = 100 Fundos de Guilda + 1 Contribuição pessoal
  const guildFundsAdded = goldAmount + (pointAmount * 100);
  const playerOfferAdded = Math.floor(goldAmount / 1000) + pointAmount;

  // Atualiza guilda
  await cx.query(`
    UPDATE consortia
    SET offer = offer + ?, total_offer = total_offer + ?
    WHERE id = ?
  `, [guildFundsAdded, guildFundsAdded, guildId]);

  // Atualiza membro
  await cx.query(`
    UPDATE consortia_members
    SET offer = offer + ?, total_offer = total_offer + ?
    WHERE consortia_id = ? AND character_id = ?
  `, [playerOfferAdded, playerOfferAdded, guildId, character.id]);

  // Registra histórico
  await cx.query(`
    INSERT INTO consortia_contributions (consortia_id, character_id, character_name, gold, point, offer)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [guildId, character.id, character.nickname, goldAmount, pointAmount, playerOfferAdded]);

  // Atualiza estado salvo
  saved.consortia.offer = (Number(saved.consortia.offer) || 0) + playerOfferAdded;
  saved.consortia.totalOffer = (Number(saved.consortia.totalOffer) || 0) + playerOfferAdded;

  await cx.query(`
    UPDATE characters
    SET gold = ?, crystals = ?, state_json = ?
    WHERE id = ?
  `, [character.gold, character.crystals, JSON.stringify(saved), character.id]);

  return {
    ok: true,
    guildFundsAdded,
    playerOfferAdded,
    newPlayerOffer: saved.consortia.offer
  };
  });
}

async function getContributionList(pool, consortiaId, pageIndex, isHistory) {
  if (!consortiaId || consortiaId <= 0) return { contributeInfo: [] };
  const [rows] = await pool.query(`
    SELECT character_id, character_name, offer, gold, point, created_at
    FROM consortia_contributions
    WHERE consortia_id = ?
    ORDER BY id DESC
    LIMIT 20
  `, [consortiaId]);

  const contributeInfo = rows.map(r => ({
    userId: Number(r.character_id),
    nickName: r.character_name,
    offer: Number(r.offer),
    contributeGold: Number(r.gold),
    date: formatDate(r.created_at)
  }));

  return { contributeInfo };
}

async function applyToGuild(pool, character, consortiaId) {
  if (!consortiaId || consortiaId <= 0) {
    return { ok: false, message: 'ID de guilda inválido' };
  }
  return withGuildTransaction(pool, async cx => {
  const [member]=await cx.query('SELECT id FROM consortia_members WHERE character_id=? FOR UPDATE',[character.id]);
  if (member.length) return {ok:false,message:'Personagem ja possui guilda'};
  const [guildRows] = await cx.query('SELECT id, name FROM consortia WHERE id = ?', [consortiaId]);
  if (!guildRows.length) {
    return { ok: false, message: 'Guilda não encontrada' };
  }
  const guild = guildRows[0];

  const [res] = await cx.query(`
    INSERT INTO consortia_apply (consortia_id, character_id)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
  `, [consortiaId, character.id]);

  return {
    ok: true,
    applyId: Number(res.insertId),
    consortiaId,
    consortiaName: guild.name
  };
  });
}

async function getApplyList(pool, consortiaId) {
  if (!consortiaId || consortiaId <= 0) return { info: [] };
  const [rows] = await pool.query(`
    SELECT a.id AS apply_id, a.consortia_id, a.character_id, a.created_at,
           c.nickname, c.grade, c.icon, c.camp,
           g.name AS consortia_name, g.chairman_name, g.chairman_id
    FROM consortia_apply a
    JOIN characters c ON c.id = a.character_id
    JOIN consortia g ON g.id = a.consortia_id
    WHERE a.consortia_id = ?
    ORDER BY a.id DESC
  `, [consortiaId]);

  const info = rows.map(r => ({
    id: Number(r.apply_id),
    consortiaId: Number(r.consortia_id),
    consortiaName: r.consortia_name,
    createDate: formatDate(r.created_at),
    userId: Number(r.character_id),
    userNickname: r.nickname,
    inviteId: Number(r.chairman_id),
    inviteNickname: r.chairman_name,
    chairmanNickname: r.chairman_name,
    inviteDate: formatDate(r.created_at),
    fromType: 0,
    isexist: true
  }));

  return { info };
}

async function operateApply(pool, actorId, applyId, result) {
  return withGuildTransaction(pool, async cx => {
  const [rows] = await cx.query('SELECT * FROM consortia_apply WHERE id = ? FOR UPDATE', [applyId]);
  if (!rows.length) {
    return { ok: false, message: 'Candidatura não encontrada' };
  }
  const app = rows[0];
  const consortiaId = Number(app.consortia_id);
  const characterId = Number(app.character_id);
  const [actor]=await cx.query('SELECT duty_id FROM consortia_members WHERE character_id=? AND consortia_id=? FOR UPDATE',[actorId,consortiaId]);
  if (!actor.length || ![1,2].includes(Number(actor[0].duty_id)))
    return {ok:false,message:'Sem permissao para aprovar candidatura'};

  if (result) {
    const [existing]=await cx.query('SELECT consortia_id FROM consortia_members WHERE character_id=? FOR UPDATE',[characterId]);
    if (existing.length) return {ok:false,message:'Candidato ja pertence a uma guilda'};
    const [charRows]=await cx.query('SELECT state_json FROM characters WHERE id=? FOR UPDATE',[characterId]);
    if (!charRows.length) return {ok:false,message:'Candidato nao encontrado'};
    await cx.query(`
      INSERT INTO consortia_members (consortia_id, character_id, duty_id, offer, total_offer)
      VALUES (?, ?, 5, 0, 0)
    `, [consortiaId, characterId]);

    if (charRows.length) {
      const [gRows] = await cx.query('SELECT name FROM consortia WHERE id = ?', [consortiaId]);
      const gName = gRows.length ? gRows[0].name : 'Guilda';
      let saved = {};
      try { saved = JSON.parse(charRows[0].state_json || '{}'); } catch (_) {}
      saved.consortia = {
        id: consortiaId,
        name: gName,
        dutyId: 5,
        offer: 0,
        totalOffer: 0
      };
      await cx.query('UPDATE characters SET state_json = ? WHERE id = ?', [JSON.stringify(saved), characterId]);
    }
  }

  await cx.query('DELETE FROM consortia_apply WHERE id = ?', [applyId]);

  return {
    ok: true,
    applyId,
    result: Boolean(result),
    consortiaId,
    characterId
  };
  });
}

async function quitGuild(pool, characterId) {
  return withGuildTransaction(pool, async cx => {
    const [rows]=await cx.query('SELECT state_json FROM characters WHERE id=? FOR UPDATE',[characterId]);
    if (!rows.length) return {ok:false,message:'Personagem nao encontrado'};
    const [members]=await cx.query('SELECT consortia_id,duty_id FROM consortia_members WHERE character_id=? FOR UPDATE',[characterId]);
    if (!members.length) return {ok:false,message:'Personagem nao pertence a guilda'};
    if (Number(members[0].duty_id)===1) return {ok:false,message:'Lider deve transferir o cargo antes de sair'};
    const saved=typeof rows[0].state_json==='string' ? JSON.parse(rows[0].state_json) : structuredClone(rows[0].state_json||{});
    const guildId=Number(members[0].consortia_id);
    if (Number(saved.consortia?.id)!==guildId) return {ok:false,message:'Estado de guilda inconsistente'};
    await cx.query('DELETE FROM consortia_members WHERE character_id=? AND consortia_id=?',[characterId,guildId]);
    saved.consortia=null;
    await cx.query('UPDATE characters SET state_json=? WHERE id=?',[JSON.stringify(saved),characterId]);
    return {ok:true,guildId};
  });
}

module.exports = {
  searchGuilds,
  getGuildInfo,
  getGuildMembers,
  getDutyList,
  createGuild,
  contributeGuild,
  getContributionList,
  applyToGuild,
  getApplyList,
  operateApply,
  quitGuild,
  mayManageGuild,
  upgradeGuild,
  accelerateGuildUpgrade,
  settleGuildUpgrade,
  formatDate
};
