'use strict';
// ==========================================================================
// guard-system-state.js — Sistema de Guardiões (Guarda) do Wartune Ultra
// Implementa ativação, fortalecimento de equipamentos, evolução de estrelas,
// habilidades, renomear, formação de combate, acompanhamento (follow) e
// recrutamento/loteria (GuardDraw).
// ==========================================================================

const fs = require('node:fs');
const path = require('node:path');
const configRoot = path.resolve(__dirname, '../res/release/config');

function loadCatalog(prefix) {
  try {
    const file = fs.readdirSync(configRoot).find(f => f.startsWith(prefix + '-') && f.endsWith('.json'));
    if (!file) return [];
    const data = JSON.parse(fs.readFileSync(path.join(configRoot, file), 'utf8'));
    return data[prefix] || [];
  } catch (_) {
    return [];
  }
}

const guardTemplates = loadCatalog('t_s_guardtemplate');
const guardStars = loadCatalog('t_s_guardstar');
const guardEquips = loadCatalog('t_s_guardequiptemplate');
const guardSkills = loadCatalog('t_s_guardskill');
const guardQualities = loadCatalog('t_s_guardquailty');
const guardEquipStrengthen = loadCatalog('t_s_guardequipstrengthen');
const guardBooks = loadCatalog('t_s_guardhandbook');
const gachaPools = loadCatalog('t_s_gachacontrol');
const gachaRewards = new Map(loadCatalog('t_s_gachaset').map(row=>[Number(row.TemplateId),row]));
const guardConfig = loadCatalog('t_s_config');
const secondSkillCost = Number(guardConfig.find(c=>c.ConfigName==='guard_skillpoint')?.ConfigValue);
const guardStarCostByKey = new Map(guardStars.map(row => [`${row.GuardId}:${row.StarLevel}`,row]));
const attributeCalculator = require('./attribute-calculator');
const guardStarByKey = new Map(guardStars.map(row => [`${row.GuardId}:${row.StarLevel}`, row]));
const guardEquipById = new Map(guardEquips.map(row => [Number(row.TemplateId), row]));

function bookLevel(guardId, type, rawLevel) {
  const levels=guardBooks.filter(row=>Number(row.GuardId)===Number(guardId)&&Number(row.Type)===type)
    .map(row=>Number(row.TypeLv)).filter(Number.isSafeInteger);
  if (!levels.length) return 0;
  const level=Number(rawLevel);
  return Math.max(Math.min(...levels),Math.min(Math.max(...levels),Number.isSafeInteger(level)?level:0));
}

function parseAttributes(spec) {
  const values = new Map();
  for (const part of String(spec || '').split('|')) {
    const [id, amount] = part.split(',').map(Number);
    if (Number.isSafeInteger(id) && Number.isFinite(amount)) values.set(id, amount);
  }
  return values;
}

function payUpgrade(saved, gold, materials) {
  const cost = Math.max(0,Number(gold)||0);
  saved.wallet ||= {gold:0};
  const bag = require('./inventory-state').inventory(saved);
  const requirements = String(materials || '').split('|').filter(Boolean).map(part => {
    const [id,count] = part.split(',').map(Number);
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(count) || count < 1)
      throw Error('Material de Guarda invalido');
    return {id,count};
  });
  if (Number(saved.wallet?.gold || 0) < cost) throw Error('Ouro insuficiente para Guarda');
  for (const {id,count} of requirements) {
    const held=bag.items.filter(item=>Number(item.bagType)===1&&Number(item.templateId)===id)
      .reduce((sum,item)=>sum+Number(item.count||0),0);
    if (held<count) throw Error(`Material de Guarda ${id} insuficiente`);
  }
  saved.wallet.gold-=cost;
  for (const {id,count} of requirements) {
    let remaining=count;
    for (const item of bag.items) {
      if (remaining===0) break;
      if (Number(item.bagType)!==1||Number(item.templateId)!==id) continue;
      const used=Math.min(Number(item.count),remaining);
      item.count-=used;
      remaining-=used;
    }
  }
  bag.items=bag.items.filter(item=>Number(item.count)>0);
}

const OP = {
  OP_ACTIVE: 1,
  OP_UPDATE_STAR: 2,
  OP_AWARK: 3,
  OP_UPDATE_EQUIP: 4,
  OP_UPDATE_SKILL: 5,
  OP_OPEN_SECOND_SKILL: 6,
  OP_CHANGE_SKILL_CHOICE: 7,
  OP_UPDATE_FAST_SKILL: 8,
  OP_CHANGE_NAME: 9,
  OP_ACTIVE_BOOK: 10,
  OP_CHANGE_POSITION: 11,
  OP_SET_BATTLE_STATUS: 12,
  OP_LOOK_GUARD_INFO: 13,
  OP_CHANGE_FOLLOW: 15,
  OP_RESOLVE: 16
};

function getDefaultEquips(guardId, profile = 0) {
  const gId = Number(guardId) || 1;
  const p = Math.max(0, Math.min(4, Number(profile) || 0));
  const q = guardQualities.find(row => Number(row.GuardId) === gId && Number(row.Profile) === p) ||
            guardQualities.find(row => Number(row.GuardId) === gId) ||
            guardQualities[0];
  const initialIds = String(q?.InitialEquip || '').split(',').map(Number);
  const equips = [];
  for (let type = 1; type <= 8; type++) {
    const eqId = initialIds.find(id => Number(guardEquipById.get(id)?.EquipType) === type) ||
                 (10200 + type);
    equips.push({
      equipId: eqId,
      equipLv: 1,
      equipType: type
    });
  }
  return equips;
}

function calculateGuardAttributes(guard, saved, heroBase = null) {
  const values = new Map();
  if (!guard) return values;
  const id = Number(guard.guardId) || 1;
  const starLevel = Math.max(0, Math.min(5, Number(guard.guardStar) || 0));
  const star = guardStarByKey.get(`${id}:${starLevel}`) || guardStarByKey.get(`${id}:0`);
  if (!star) return values;
  const activateAttrs = parseAttributes(star.ActivateAttr);
  for (const [attrId, amount] of activateAttrs) values.set(attrId, amount);
  const rates = parseAttributes(star.AttrResonance);
  const elementRates = parseAttributes(star.ElementResonance);
  const grade = Number(saved?.grade || saved?.hero?.grade || 0);
  const hero = heroBase || (grade > 0 ? attributeCalculator.calculateAttributes(
    {grade, job:saved?.job, state_json:saved}, {skipGuard:true}) : null);
  const source = new Map([
    [6,hero?.totalPhyAttack],[7,hero?.totalPhyDefence],[8,hero?.totalMagicAttack],
    [9,hero?.totalMagicDefence],[10,hero?.totalLive],[12,hero?.totalForceHit],
    [13,hero?.totalParry],[14,hero?.fireResi],[15,hero?.waterResi],
    [16,hero?.electResi],[17,hero?.windResi],[18,hero?.darkResi],
    [19,hero?.lightResi],[20,hero?.reduceResi]
  ]);
  const resonance = Number(star.Resonance || 0);
  for (const [attributeId, heroValue] of source) {
    const rate = rates.get(attributeId) ?? elementRates.get(attributeId) ?? 0;
    if (Number(heroValue) > 0 && rate > 0)
      values.set(attributeId,(values.get(attributeId)||0)+Math.floor(heroValue * resonance * rate / 100000000));
  }
  for (const equip of guard.equipInfos || []) {
    const template = guardEquipById.get(Number(equip.equipId));
    if (!template) continue;
    const base = parseAttributes(template.EquipAttr);
    const perLevel = parseAttributes(template.EquipLvAttr);
    for (const [attributeId, amount] of base) values.set(attributeId,(values.get(attributeId)||0)+amount);
    const safeLv = Math.max(0, Math.min(Number(template.LimitLv) || 80, Number(equip.equipLv) || 0));
    for (const [attributeId, amount] of perLevel)
      values.set(attributeId,(values.get(attributeId)||0)+amount * safeLv);
  }
  return values;
}

function calculateFighting(guard, saved) {
  const a = calculateGuardAttributes(guard, saved);
  const value = id => Math.max(0, Number(a.get(id)||0));
  return Math.floor(value(6)+value(8)+value(7)+value(9)+Math.floor(value(10)/5)+
    value(12)+value(13)+3*value(20)+2*(value(14)+value(15)+value(16)+value(17)+value(18)+value(19)));
}

function ensureGuardians(saved) {
  saved.guardians ||= {};
  saved.guardians.activeId ||= 0;
  saved.guardians.fightIndex ||= '1,2,3';
  saved.guardians.challengePos ||= '1,2,3';
  saved.guardians.lottery ||= {
    drawCount: 0,
    epicCountdown: 80,
    freeCount: 1
  };
  saved.guardians.list ||= [];

  return saved.guardians;
}

function formatSingleGuardInfoMsg(guard, op = 0, saved = null) {
  const gId = Number(guard.guardId) || 1;
  const gStar = Math.max(0, Math.min(5, Number(guard.guardStar) || 0));
  const gStage = Math.max(0, Math.min(4, Number(guard.guardStage) || 0));
  const fighting = calculateFighting(guard, saved);

  const defaults = getDefaultEquips(gId, gStage);
  const rawEquips = Array.isArray(guard.equipInfos) ? guard.equipInfos : defaults;
  const normalizedEquips = [];

  for (let type = 1; type <= 8; type++) {
    let eq = rawEquips.find(e => Number(e.equipType) === type);
    const def = defaults.find(e => e.equipType === type) || { equipId: 10204, equipLv: 1, equipType: type };
    if (!eq || !guardEquipById.has(Number(eq.equipId))) {
      eq = def;
    }
    const template = guardEquipById.get(Number(eq.equipId));
    const maxLv = Number(template?.LimitLv) || 20;
    const safeLv = Math.max(0, Math.min(maxLv, Number(eq.equipLv) || 1));
    normalizedEquips.push({
      equipId: Number(eq.equipId),
      equipLv: safeLv,
      equipType: type
    });
  }

  return {
    guardId: gId,
    guardName: String(guard.guardName || 'Cavaleiro Sagrado'),
    guardStar: gStar,
    guardStage: gStage,
    skills: String(guard.skills || '10010101,10010201,10010301'),
    equipInfos: normalizedEquips,
    firstKey: String(guard.firstKey || '10010101,10010201'),
    isActiveSecond: Boolean(guard.isActiveSecond),
    skillIndex: Number(guard.skillIndex || 0),
    secondKey: String(guard.secondKey || '10010301,10010401'),
    illustrationStar: bookLevel(gId,1,guard.illustrationStar),
    fighting,
    isFight: Boolean(guard.isFight),
    isFollowing: Boolean(guard.isFollowing),
    op: Number(op),
    talentLv: Number(guard.talentLv || 1),
    illustrationStage: bookLevel(gId,2,guard.illustrationStage),
    illustrationTalentLv: bookLevel(gId,3,guard.illustrationTalentLv),
    attackProps: [],
    resiProps: []
  };
}

function formatGuardTotalInfoMsg(saved) {
  const gs = ensureGuardians(saved);
  return {
    guard: (gs.list || []).filter(g => Number.isSafeInteger(Number(g.guardId)) && Number(g.guardId) >= 1 && Number(g.guardId) <= 8)
      .map(g => formatSingleGuardInfoMsg(g, 0, saved))
  };
}

function handleGuardReq(saved, req) {
  const gs = ensureGuardians(saved);
  const op = Number(req.op || 0);
  const guardId = Number(req.guardId || 1);

  let guard = gs.list.find(g => Number(g.guardId) === guardId);

  // 1. OP_ACTIVE: Ativação de Guardião
  if (op === OP.OP_ACTIVE) {
    if (!guard) {
      const template = guardTemplates.find(t => Number(t.TemplateId) === guardId);
      if (!template) throw Error('Guardiao ausente do catalogo');
      const activation = String(template.ActivateItem || '').split(',').map(Number);
      if (!Number.isSafeInteger(activation[0]) || !Number.isSafeInteger(activation[1]) || activation[1] < 1)
        throw Error('Custo de ativacao do Guardiao invalido');
      payUpgrade(saved, 0, template.ActivateItem);
      const initialSkills = String(template.DefaultSkills || '').split(',').filter(Boolean);
      guard = {
        guardId,
        guardName: template.TemplateName_pt || 'Guardião',
        guardStar: 1,
        guardStage: 1,
        skills: initialSkills.join(','),
        equipInfos: getDefaultEquips(guardId),
        firstKey: initialSkills.join(','),
        secondKey: '',
        skillIndex: 0,
        fighting: 0,
        isFight: false,
        isFollowing: false,
        talentLv: 1,
        illustrationStar: 1,
        illustrationStage: 1,
        illustrationTalentLv: 1,
        isActiveSecond: false
      };
      gs.list.push(guard);
      guard.fighting = calculateFighting(guard, saved);
      return { ok: true, guard, op, changed: true };
    }
    return { ok: true, guard, op };
  }

  if (!guard) throw Error('Guardiao nao ativado');

  // 2. OP_UPDATE_STAR: Evolução de Estrela
  if (op === OP.OP_UPDATE_STAR) {
    const curStar = Math.max(0, Math.min(5, Number(guard.guardStar) || 0));
    if (curStar >= 5) throw Error('Estrela maxima da Guarda');
    const cost = guardStarCostByKey.get(`${guardId}:${curStar}`);
    if (!cost) throw Error('Custo da estrela ausente no catalogo');
    payUpgrade(saved, cost.Consume, cost.Item);
    guard.guardStar = curStar + 1;
    guard.fighting = calculateFighting(guard, saved);
    return { ok: true, guard, op, changed: true };
  }

  // 3. OP_AWARK: Despertar
  if (op === OP.OP_AWARK) {
    const currentStage = Math.max(0, Math.min(4, Number(guard.guardStage) || 0));
    if (currentStage >= 4) throw Error('Estagio maximo da Guarda');
    const currentQuality = guardQualities.find(row => Number(row.GuardId) === guardId && Number(row.Profile) === currentStage);
    if (!currentQuality) throw Error('Configuracao de estagio ausente');
    const conditions = parseAttributes(currentQuality.Condition);
    const minEquip = Math.min(...(guard.equipInfos || []).map(eq => Number(eq.equipLv) || 0));
    if (minEquip < (conditions.get(1) || 0) || Number(guard.guardStar) < (conditions.get(2) || 0))
      throw Error('Requisitos de despertar da Guarda nao cumpridos');
    const nextStage = currentStage + 1;
    guard.guardStage = nextStage;
    const nextQuality = guardQualities.find(row => Number(row.GuardId) === guardId && Number(row.Profile) === nextStage);
    if (nextQuality) {
      const nextIds = String(nextQuality.InitialEquip || '').split(',').map(Number);
      guard.equipInfos = [];
      for (let type = 1; type <= 8; type++) {
        const replacement = nextIds.find(id => Number(guardEquipById.get(id)?.EquipType) === type);
        guard.equipInfos.push({
          equipId: replacement || (10200 + type),
          equipLv: 0,
          equipType: type
        });
      }
    }
    guard.fighting = calculateFighting(guard, saved);
    return { ok: true, guard, op, changed: true };
  }

  // 4. OP_UPDATE_EQUIP: Fortalecimento de Equipamento
  if (op === OP.OP_UPDATE_EQUIP) {
    const eqType = Number(req.equipType || 1);
    const stage = Math.max(0, Math.min(4, Number(guard.guardStage) || 0));
    guard.equipInfos ||= getDefaultEquips(guardId, stage);
    let eq = guard.equipInfos.find(e => Number(e.equipType) === eqType);
    if (!eq || !guardEquipById.has(Number(eq.equipId))) {
      const defs = getDefaultEquips(guardId, stage);
      eq = defs.find(e => e.equipType === eqType) || { equipId: 10204, equipLv: 1, equipType: eqType };
      guard.equipInfos = guard.equipInfos.filter(e => Number(e.equipType) !== eqType);
      guard.equipInfos.push(eq);
    }
    const template = guardEquipById.get(Number(eq.equipId));
    if (!template) throw Error('Equipamento da Guarda ausente do catalogo');
    if (Number(eq.equipLv) >= Number(template.LimitLv)) throw Error('Equipamento da Guarda no nivel maximo');
    const cost = guardEquipStrengthen.find(row => Number(row.EquipProfile) === Number(template.EquipProfile) && Number(row.EquipLv) === Number(eq.equipLv));
    if (!cost) throw Error('Custo do equipamento ausente no catalogo');
    payUpgrade(saved, cost.Consume, cost.Item);
    eq.equipLv = (Number(eq.equipLv) || 0) + 1;
    guard.fighting = calculateFighting(guard, saved);
    return { ok: true, guard, op, changed: true };
  }

  // 5. OP_UPDATE_SKILL: Habilidade
  if (op === OP.OP_UPDATE_SKILL) {
    const oldSkill = Number(req.oldSkillId);
    const newSkill = Number(req.newSkillId);
    const skillList = (guard.skills || '').split(',').filter(Boolean);
    if (!skillList.includes(String(oldSkill)) || newSkill !== oldSkill + 1 ||
        Math.floor(newSkill / 100) !== Math.floor(oldSkill / 100))
      throw Error('Evolucao de habilidade de Guarda invalida');
    const next = guardSkills.find(row=>Number(row.SkillId)===newSkill);
    if (!next || Number(guard.guardStar)<Number(next.GuardStarLimit||0))
      throw Error('Habilidade de Guarda indisponivel');
    payUpgrade(saved,next.Consume,next.Item);
    skillList.splice(skillList.indexOf(String(oldSkill)),1,String(newSkill));
    guard.skills = skillList.join(',');
    guard.fighting=calculateFighting(guard,saved);
    return { ok: true, guard, op, changed:true };
  }

  // 6. OP_OPEN_SECOND_SKILL: Segundo Slot
  if (op === OP.OP_OPEN_SECOND_SKILL) {
    if (guard.isActiveSecond) throw Error('Segundo slot da Guarda ja ativo');
    if (!Number.isSafeInteger(secondSkillCost) || secondSkillCost<=0)
      throw Error('Custo do segundo slot de Guarda ausente do catalogo');
    const payType=Number(req.payType ?? 0);
    if (![0,1].includes(payType)) throw Error('Pagamento de Guarda invalido');
    const balanceKey=payType===0?'boundBalens':'balens';
    saved.wallet ||= {};
    if (Number(saved.wallet[balanceKey]||0)<secondSkillCost) throw Error('Diamantes insuficientes para Guarda');
    saved.wallet[balanceKey]-=secondSkillCost;
    guard.isActiveSecond=true;
    return {ok:true,guard,op,changed:true};
  }

  // 7. OP_CHANGE_SKILL_CHOICE: Alternar Seleção de Habilidade
  if (op === OP.OP_CHANGE_SKILL_CHOICE) {
    guard.skillIndex = Number(req.skillIndex || 0);
    return { ok: true, guard, op };
  }

  // 8. OP_UPDATE_FAST_SKILL: Teclas Rápidas
  if (op === OP.OP_UPDATE_FAST_SKILL) {
    if (req.sonTypes) guard.firstKey = String(req.sonTypes);
    return { ok: true, guard, op };
  }

  // 9. OP_CHANGE_NAME: Renomear Guardião
  if (op === OP.OP_CHANGE_NAME) {
    if (req.name && req.name.trim()) {
      guard.guardName = req.name.trim().slice(0, 20);
    }
    return { ok: true, guard, op };
  }

  // 10. OP_ACTIVE_BOOK: Manual / Coleção
  if (op === OP.OP_ACTIVE_BOOK) {
    const type=Number(req.type);
    const fields={1:['illustrationStar','guardStar'],2:['illustrationStage','guardStage'],3:['illustrationTalentLv','talentLv']};
    const pair=fields[type];
    if (!pair) throw Error('Tipo de manual da Guarda invalido');
    const current=Number(guard[pair[0]]||0);
    const next=guardBooks.find(row=>Number(row.GuardId)===guardId&&Number(row.Type)===type&&Number(row.TypeLv)===current+1);
    if (!next) throw Error('Nivel maximo do manual da Guarda');
    if (Number(guard[pair[1]]||0)<Number(next.Condition||0))
      throw Error('Requisito do manual da Guarda nao cumprido');
    guard[pair[0]]=current+1;
    return {ok:true,guard,op,changed:true};
  }

  // 11. OP_CHANGE_POSITION: Formação
  if (op === OP.OP_CHANGE_POSITION) {
    if (req.challengePos) gs.challengePos = String(req.challengePos);
    if (req.fightIndex) gs.fightIndex = String(req.fightIndex);
    return { ok: true, guard, op, formation: true };
  }

  // 12. OP_SET_BATTLE_STATUS: Status de Combate
  if (op === OP.OP_SET_BATTLE_STATUS) {
    guard.isFight = typeof req.isFight !== 'undefined' ? Boolean(req.isFight) : !guard.isFight;
    if (guard.isFight) for (const other of gs.list) {
      if (other !== guard) other.isFight = false;
    }
    gs.activeId = guard.isFight ? guardId : (Number(gs.activeId) === guardId ? 0 : gs.activeId);
    return { ok: true, guard, op, changed: true };
  }

  // 15. OP_CHANGE_FOLLOW: Acompanhamento
  if (op === OP.OP_CHANGE_FOLLOW) {
    guard.isFollowing = !guard.isFollowing;
    return { ok: true, guard, op };
  }

  return { ok: true, guard, op };
}

function drawEntries(spec) {
  return String(spec||'').split('|').map(part=>part.split(',').map(Number))
    .filter(([id,weight])=>Number.isSafeInteger(id)&&Number.isFinite(weight)&&weight>0);
}

function handleGuardDraw(saved, req, random = Math.random, now = Date.now()) {
  const gs=ensureGuardians(saved), op=Number(req.op||0);
  if (![0,1,2].includes(op)) throw Error('Operacao de sorteio de Guardiao invalida');
  gs.lottery.pools ||= {};
  gs.lottery.history ||= [];
  const today=new Date(now).toISOString().slice(0,10);
  const poolState=id=>(gs.lottery.pools[id] ||= {hadDrawTimes:0,sinceRare:0,lastFreeDay:'',lastDrawAt:0,lastDrawKey:''});
  const infoRes=()=>({infos:gachaPools.filter(pool=>Number(pool.Open)===1).map(pool=>{
    const progress=poolState(Number(pool.TemplateId));
    return {templateId:Number(pool.TemplateId),hadDrawTimes:Math.max(0,Number(progress.hadDrawTimes)||0),
      freeTime:Number(pool.FreeReset)===1&&progress.lastFreeDay!==today?0:1};
  })});
  const recordRes=()=>({record:gs.lottery.history.slice(-20).reverse().map(entry=>({
    templateId:entry.itemId,count:entry.count,drawTime:entry.at,groupId:entry.poolId
  }))});
  if(op!==1)return {infoRes:infoRes(),awardRes:{awards:[]},recordRes:recordRes(),op,changed:false};

  const poolId=Number(req.templateId),times=Number(req.drawTimes);
  const pool=gachaPools.find(row=>Number(row.TemplateId)===poolId&&Number(row.Open)===1);
  if(!pool)throw Error('Recrutamento de Guarda indisponivel');
  const [start,end]=String(pool.OpenTime||'').split('|').map(value=>Date.parse(value.replace(' ','T')));
  if(!Number.isFinite(start)||!Number.isFinite(end)||now<start||now>end)
    throw Error('Recrutamento fora do periodo de abertura');
  if(![1,10].includes(times))throw Error('Quantidade de recrutamentos invalida');
  const progress=poolState(poolId),key=`${poolId}:${times}`;
  if(progress.lastDrawKey===key&&now-Number(progress.lastDrawAt)<800)
    return {infoRes:infoRes(),awardRes:{awards:[]},recordRes:recordRes(),op,changed:false,duplicate:true};
  const [ticketId,ticketCount]=String(pool.Cost||'').split('|')[0].split(',').map(Number);
  if(!Number.isSafeInteger(ticketId)||ticketId<1||!Number.isSafeInteger(ticketCount)||ticketCount<1)
    throw Error('Custo de recrutamento invalido no catalogo');
  const free=times===1&&Number(pool.FreeReset)===1&&progress.lastFreeDay!==today;
  const cost=(times-(free?1:0))*ticketCount;
  const bag=require('./inventory-state').inventory(saved);
  const ticketItems=bag.items.filter(item=>Number(item.bagType)===1&&Number(item.templateId)===ticketId);
  if(ticketItems.reduce((sum,item)=>sum+Number(item.count),0)<cost)
    throw Error('Cupons de Recrutamento de Guarda insuficientes');
  let pending=cost;
  for(const item of ticketItems){const used=Math.min(pending,item.count);item.count-=used;pending-=used;if(!pending)break;}
  bag.items=bag.items.filter(item=>item.count>0);

  const weighted=drawEntries(pool.GachaBox).filter(([id])=>gachaRewards.has(id));
  if(!weighted.length)throw Error('Pool de recompensas de Guarda vazio');
  const pity=drawEntries(pool.PityCounter)[0];
  const assurance=drawEntries(pool.Assurance);
  const pick=options=>{
    const total=options.reduce((sum,[,weight])=>sum+weight,0);
    let roll=Math.min(0.999999999,Math.max(0,Number(random())))*total;
    for(const [id,weight] of options){roll-=weight;if(roll<0)return gachaRewards.get(id);}
    return gachaRewards.get(options.at(-1)[0]);
  };
  const inventoryState=require('./inventory-state'),awards=[];
  for(let index=0;index<times;index++){
    let options=weighted;
    if(pity&&Number(progress.hadDrawTimes)>=pity[1]-1)
      options=weighted.filter(([id])=>Number(gachaRewards.get(id).PoolId)===pity[0]);
    else if(assurance.length&&Number(progress.sinceRare)>=assurance[0][1]-1)
      options=weighted.filter(([id])=>Number(gachaRewards.get(id).Rare)>=2);
    if(!options.length)throw Error('Garantia de recrutamento sem recompensa no catalogo');
    const reward=pick(options),itemId=Number(reward.ItemId),count=Number(reward.Data);
    if(!Number.isSafeInteger(itemId)||itemId<1||!Number.isSafeInteger(count)||count<1)
      throw Error('Recompensa de Guarda invalida no catalogo');
    inventoryState.addItem(saved,itemId,count);
    awards.push({templateId:itemId,count});
    const rare=Number(reward.Rare);
    progress.hadDrawTimes=rare>=3?0:Number(progress.hadDrawTimes)+1;
    progress.sinceRare=rare>=2?0:Number(progress.sinceRare)+1;
    gs.lottery.history.push({poolId,itemId,count,at:now});
  }
  gs.lottery.history=gs.lottery.history.slice(-20);
  if(free)progress.lastFreeDay=today;
  progress.lastDrawAt=now;progress.lastDrawKey=key;
  return {infoRes:infoRes(),awardRes:{awards},recordRes:recordRes(),op,changed:true,cost,ticketId};
}

module.exports = {
  OP,
  getDefaultEquips,
  ensureGuardians,
  calculateFighting,
  calculateGuardAttributes,
  formatSingleGuardInfoMsg,
  formatGuardTotalInfoMsg,
  handleGuardReq,
  handleGuardDraw
};
