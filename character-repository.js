'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const skillsState = require('./skills-state');

const configRoot = path.resolve(__dirname, '../res/release/config');

const ENERGY_MAX = 200;
const ENERGY_REGEN_PER_HOUR = 20;
const ENERGY_HOUR_MS = 60 * 60 * 1000;

function recoverTimedEnergy(saved, nowMs = Date.now()) {
  if (!saved || typeof saved !== 'object' || !Number.isFinite(nowMs)) {
    throw new Error('Estado de energia/tempo invalido');
  }
  const currentHour = Math.floor(nowMs / ENERGY_HOUR_MS);
  const legacy = typeof saved.energy === 'number' ? saved.energy : saved.energy?.value;
  const original = Number(legacy);
  const before = Number.isFinite(original)
    ? Math.max(0, Math.min(ENERGY_MAX, Math.trunc(original))) : 0;
  if (!saved.energy || typeof saved.energy !== 'object' || Array.isArray(saved.energy)) {
    saved.energy = { value: before, lastTickHour: currentHour };
  }
  saved.energy.value = before;
  const last = Number(saved.energy.lastTickHour);
  if (!Number.isSafeInteger(last) || last <= 0 || last > currentHour) {
    saved.energy.lastTickHour = currentHour;
    return { before, after: before, gained: 0, elapsedHours: 0 };
  }
  const hours = currentHour - last;
  if (hours <= 0) return { before, after: before, gained: 0, elapsedHours: 0 };
  const gained = Math.min(ENERGY_MAX - before, hours * ENERGY_REGEN_PER_HOUR);
  saved.energy.value = before + gained;
  saved.energy.lastTickHour = currentHour;
  return { before, after: saved.energy.value, gained, elapsedHours: hours };
}

function spendEnergy(saved, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Custo de energia invalido');
  const result = recoverTimedEnergy(saved);
  if (result.after < amount) throw new Error(`Energia insuficiente: ${result.after}/${amount}`);
  saved.energy.value -= amount;
  return { before: result.after, after: saved.energy.value, cost: amount };
}

function grantPotionEnergy(saved, template, count) {
  const expected = new Map([[2030500, 5], [2030501, 10], [2030502, 20], [2030503, 50]]);
  const id = Number(template?.TemplateId);
  if (!expected.has(id) || Number(template.MasterType) !== 2 ||
      Number(template.SonType) !== 203 || Number(template.Property1) !== 5 ||
      Number(template.Property2) !== expected.get(id)) return null;
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Quantidade de pocoes invalida');
  recoverTimedEnergy(saved);
  const before = saved.energy.value;
  if (before >= ENERGY_MAX) throw new Error('Energia ja esta cheia; pocao preservada');
  const after = Math.min(ENERGY_MAX, before + expected.get(id) * count);
  saved.energy.value = after;
  return { before, after, granted: after - before, itemId: id, unitEnergy: expected.get(id) };
}

function loadCatalog(prefix) {
  try {
    const file = fs.readdirSync(configRoot).find(f => f.startsWith(prefix + '-'));
    if (!file) return [];
    const content = JSON.parse(fs.readFileSync(path.join(configRoot, file), 'utf8'));
    return content[prefix] || [];
  } catch (err) {
    return [];
  }
}

const itemTemplatesJson = new Map(loadCatalog('t_s_itemtemplate').map(i => [Number(i.TemplateId), i.TemplateName_pt || i.TemplateName_en || i.TemplateName || 'Item']));
const questTemplatesJson = new Map(loadCatalog('t_s_questtemplate').map(q => [Number(q.TemplateId), {
  title: q.Title_pt || q.Title_en || q.Title || `Missão #${q.TemplateId}`,
  type: Number(q.TemplateType || 0)
}]));
const skillTemplatesJson = new Map(loadCatalog('t_s_skilltemplate').map(s => [Number(s.TemplateId), s.TemplateName_pt || s.TemplateName_en || s.TemplateName || `Habilidade #${s.TemplateId}`]));

let dbItemNamesCache = null;

async function getItemName(cx, tId) {
  const id = Number(tId);
  if (!dbItemNamesCache) {
    try {
      const [rows] = await cx.query('SELECT template_id, name FROM item_templates');
      dbItemNamesCache = new Map(rows.map(r => [Number(r.template_id), r.name]));
    } catch (_) {
      dbItemNamesCache = new Map();
    }
  }
  if (dbItemNamesCache.has(id)) return dbItemNamesCache.get(id);
  if (itemTemplatesJson.has(id)) return itemTemplatesJson.get(id);
  return `Item #${id}`;
}

function getQuestTitle(qId) {
  const id = Number(qId);
  if (questTemplatesJson.has(id)) return questTemplatesJson.get(id).title;
  return `Missão #${id}`;
}

function getQuestType(qId) {
  const id = Number(qId);
  if (questTemplatesJson.has(id)) return questTemplatesJson.get(id).type;
  return 0;
}

function getSkillName(sId) {
  const id = Number(sId);
  if (skillTemplatesJson.has(id)) return skillTemplatesJson.get(id);
  return `Habilidade #${id}`;
}

async function hydrateCharacter(row, cx) {
  if (!row) return null;
  const charId = Number(row.id);
  let state = {};
  if (row.state_json) {
    state = typeof row.state_json === 'string' ? JSON.parse(row.state_json) : row.state_json;
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};

  state.wallet = state.wallet || {};
  const balens = row.crystals !== undefined && row.crystals !== null
    ? Number(row.crystals)
    : Number(state.wallet.balens || 0);
  const boundBalens = row.bound_crystals !== undefined && row.bound_crystals !== null
    ? Number(row.bound_crystals)
    : Number(state.wallet.boundBalens || 0);
  const gold = row.gold !== undefined && row.gold !== null
    ? Number(row.gold)
    : Number(state.wallet.gold || state.gold || 0);

  state.wallet.gold = gold;
  state.wallet.balens = balens;
  state.wallet.boundBalens = boundBalens;
  state.gold = gold;
  row.crystals = balens;
  row.bound_crystals = boundBalens;
  row.gold = gold;

  state.position = {
    mapId: Number(row.map_id || state.position?.mapId || 10000),
    x: Number(row.pos_x || state.position?.x || 250),
    y: Number(row.pos_y || state.position?.y || 250)
  };

  const canonicalGrade = Number(row.grade || state.grade || state.hero?.grade || 1);
  const canonicalXp = Number(row.experience !== undefined && row.experience !== null
    ? row.experience
    : (state.progression?.totalXp ?? state.hero?.totalXp ?? 0));

  state.hero = state.hero || {};
  state.hero.grade = canonicalGrade;
  state.hero.totalXp = canonicalXp;
  state.grade = canonicalGrade;
  state.experience = canonicalXp;
  state.progression = state.progression || { currentXp: 0, totalXp: canonicalXp };
  state.progression.totalXp = canonicalXp;
  row.grade = canonicalGrade;
  row.experience = canonicalXp;

  const currentHour = Math.floor(Date.now() / 3600000);
  const stateEnergyValue = Number(state.energy?.value !== undefined ? state.energy.value :
    (typeof state.energy === 'number' ? state.energy : NaN));
  let energyVal = Number(row.energy !== undefined && row.energy !== null ? row.energy : (state.energy?.value !== undefined ? state.energy.value : (typeof state.energy === 'number' ? state.energy : 0)));
  energyVal = Math.max(0, Math.min(200, energyVal));
  state.energy = {
    value: energyVal,
    lastTickHour: Number.isFinite(stateEnergyValue) && stateEnergyValue !== energyVal
      ? currentHour : Number(state.energy?.lastTickHour || currentHour)
  };
  row.energy = energyVal;

  const [invRows] = await cx.execute(
    'SELECT id, template_id, amount, location, slot_number, upgrade_level, bound_flag, extra_json FROM inventory_items WHERE character_id = ? ORDER BY slot_number ASC',
    [charId]
  );

  const items = [];
  const equipment = {};
  let maxInstId = 0;
  const usedPositions = new Set();

  for (const it of invRows) {
    const instId = Number(it.id);
    if (instId > maxInstId) maxInstId = instId;
    const isForge = (it.location === 'FORGE');
    const isEquip = (it.location === 'EQUIP');
    let extra = {};
    if (it.extra_json) {
      try { extra = JSON.parse(it.extra_json); } catch (_) {}
    }
    const storedBagType = Number(extra.bagType);
    const bagType = [27,28].includes(storedBagType) ? storedBagType :
      (isForge ? 0 : (isEquip ? 4 : (it.location === 'STORAGE' ? 2 : 1)));
    delete extra.instanceId;
    delete extra.pos;
    delete extra.bagType;
    delete extra.templateId;
    delete extra.count;

    let pos = Number(it.slot_number !== null ? it.slot_number : 0);
    const owner = bagType === 28 ? Number(extra.objectId || 0) : 0;
    let key = `${bagType}:${owner}:${pos}`;
    if (usedPositions.has(key)) {
      pos = 0;
      while (usedPositions.has(`${bagType}:${owner}:${pos}`)) pos++;
      key = `${bagType}:${owner}:${pos}`;
    }
    usedPositions.add(key);

    const itemObj = {
      instanceId: instId,
      templateId: Number(it.template_id),
      pos,
      count: Number(it.amount || 1),
      bagType,
      bind: it.bound_flag === 1,
      used: isEquip,
      strengthenGrade: Number(it.upgrade_level || 0),
      ...extra
    };
    items.push(itemObj);

    if (isEquip) {
      equipment[String(pos)] = instId;
    }
  }

  if (invRows.length > 0) {
    state.inventory = {
      nextInstanceId: Math.max(Number(state.inventory?.nextInstanceId || 1), maxInstId + 1),
      items,
      equipment,
      testGrants: state.inventory?.testGrants || {}
    };
  } else if (state.inventory && Array.isArray(state.inventory.items) && state.inventory.items.length > 0) {
    for (const it of state.inventory.items) {
      if (!it || !it.templateId) continue;
      const oldInstId = Number(it.instanceId || 0);
      const tId = Number(it.templateId);
      const itemName = await getItemName(cx, tId);
      const amount = Number(it.count || 1);
      const location = it.bagType === 0 ? 'FORGE' : (it.bagType === 4 ? 'EQUIP' : (it.bagType === 2 ? 'STORAGE' : 'BAG'));
      const slot_number = Number(it.pos !== undefined ? it.pos : 0);
      const upgrade_level = Number(it.strengthenGrade || 0);
      const bound_flag = it.bind ? 1 : 0;
      const extra_json = JSON.stringify({
        bagType: it.bagType,
        objectId: it.objectId,
        masterAttr: it.masterAttr,
        sonAttr: it.sonAttr,
        suitId: it.suitId,
        entryId: it.entryId,
        randomSkill_1: it.randomSkill_1,
        randomSkill_2: it.randomSkill_2,
        randomSkill_3: it.randomSkill_3,
        randomSkill_4: it.randomSkill_4,
        randomSkill_5: it.randomSkill_5,
        used: it.bagType === 4,
        originBagType: it.originBagType,
        originPos: it.originPos,
        join_1: it.join_1 !== undefined ? it.join_1 : 0,
        join_2: it.join_2 !== undefined ? it.join_2 : -1,
        join_3: it.join_3 !== undefined ? it.join_3 : -1,
        join_4: it.join_4 !== undefined ? it.join_4 : -1,
        validDate: it.validDate || 0,
        beginDate: it.beginDate || ''
      });

      const [res] = await cx.execute(
        `INSERT INTO inventory_items (character_id, template_id, item_name, amount, location, slot_number, upgrade_level, bound_flag, extra_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [charId, tId, itemName, amount, location, slot_number, upgrade_level, bound_flag, extra_json]
      );
      it.instanceId = res.insertId;
      if (it.bagType === 4 && state.inventory.equipment) {
        for (const [eqSlot, eqInst] of Object.entries(state.inventory.equipment)) {
          if (Number(eqInst) === oldInstId || Number(eqSlot) === slot_number) {
            state.inventory.equipment[eqSlot] = res.insertId;
          }
        }
      }
      if (res.insertId > maxInstId) maxInstId = res.insertId;
    }
    state.inventory.nextInstanceId = Math.max(Number(state.inventory.nextInstanceId || 1), maxInstId + 1);
  } else {
    state.inventory = {
      nextInstanceId: Math.max(Number(state.inventory?.nextInstanceId || 1), 1),
      items: [],
      equipment: state.inventory?.equipment || {},
      testGrants: state.inventory?.testGrants || {}
    };
  }

  const [questRows] = await cx.execute(
    'SELECT quest_template_id, status, progress_json FROM character_quests WHERE character_id = ?',
    [charId]
  );

  const active = {};
  const completed = [];
  for (const q of questRows) {
    const qId = Number(q.quest_template_id);
    if (!Number.isSafeInteger(qId) || qId <= 0) continue;
    if (q.status === 'completed') {
      if (!completed.includes(qId)) completed.push(qId);
    } else {
      let prog = {};
      if (q.progress_json) {
        try { prog = JSON.parse(q.progress_json); } catch (_) {}
      }
      active[qId] = {
        templateId: qId,
        isComplete: !!prog.isComplete,
        condition_1: prog.condition_1 || 0,
        condition_2: prog.condition_2 || 0,
        condition_3: prog.condition_3 || 0,
        condition_4: prog.condition_4 || 0,
        completedDate: prog.completedDate || '2000-01-01 00:00:00',
        addDate: prog.addDate || '2000-01-01 00:00:00'
      };
    }
  }

  if (Array.isArray(state.quests?.completed)) {
    for (const cId of state.quests.completed) {
      const qId = Number(cId);
      if (Number.isSafeInteger(qId) && qId > 0 && !completed.includes(qId)) {
        completed.push(qId);
      }
    }
  }

  for (const cId of completed) {
    delete active[cId];
  }

  state.quests = { active, completed };

  const [skillRows] = await cx.execute(
    'SELECT skill_template_id, level, equipped, fast_key FROM character_skills WHERE character_id = ? ORDER BY fast_key ASC',
    [charId]
  );

  const job = Number(state.job || state.hero?.job || 1);
  const def = skillsState.CLASS_DEFAULTS[job] || skillsState.CLASS_DEFAULTS[1];

  let learned = [];
  if (skillRows.length > 0) {
    learned = skillRows
      .map(sk => Number(sk.skill_template_id))
      .filter(id => Number.isSafeInteger(id) && id > 0);
  } else if (Array.isArray(state.skills?.learned) && state.skills.learned.length > 0) {
    learned = state.skills.learned
      .map(item => Number(typeof item === 'object' && item !== null ? item.templateId : item))
      .filter(id => Number.isSafeInteger(id) && id > 0);
  }

  if (learned.length === 0) {
    learned = [def.defaultSkillId];
  }

  const slots = [-1, -1, -1, -1, -1, -1];
  let hasDbFastKey = false;

  for (const sk of skillRows) {
    if (sk.fast_key !== null && sk.fast_key !== undefined && sk.fast_key >= 0 && sk.fast_key < 6) {
      const tpl = skillsState.byId.get(Number(sk.skill_template_id));
      const sonType = tpl ? tpl.SonType : Math.floor(Number(sk.skill_template_id) / 100);
      if (sonType > 0) {
        slots[Number(sk.fast_key)] = sonType;
        hasDbFastKey = true;
      }
    }
  }

  if (!hasDbFastKey && typeof state.skills?.fastKey === 'string' && state.skills.fastKey.trim().length > 0) {
    const parts = state.skills.fastKey.split(',').map(s => Number(s.trim()));
    for (let i = 0; i < 6; i++) {
      if (i < parts.length && !isNaN(parts[i]) && parts[i] > 0) {
        slots[i] = parts[i];
        hasDbFastKey = true;
      }
    }
  }

  if (slots[0] <= 0) {
    slots[0] = def.defaultSonType;
  }

  const usedSonTypes = new Set(slots.filter(s => s > 0));
  for (const sId of learned) {
    const tpl = skillsState.byId.get(sId);
    if (tpl && tpl.UseWay === 1 && !usedSonTypes.has(tpl.SonType)) {
      const emptyIdx = slots.findIndex(s => s <= 0);
      if (emptyIdx === -1) break;
      slots[emptyIdx] = tpl.SonType;
      usedSonTypes.add(tpl.SonType);
    }
  }

  const fastKey = slots.join(',') + ',';
  state.skills = {
    learned,
    fastKey,
    extraSkillPoint: Number(state.skills?.extraSkillPoint || 0)
  };

  row.state_json = state;
  return row;
}

async function persistCharacterState(cx, charId, state, prevRow = {}) {
  const id = Number(charId);

  const gold = Math.max(0, Math.trunc(Number(state.wallet?.gold !== undefined ? state.wallet.gold : (state.gold !== undefined ? state.gold : (prevRow.gold || 0))) || 0));
  const crystals = Math.max(0, Math.trunc(Number(state.wallet?.balens !== undefined ? state.wallet.balens : (prevRow.crystals || 0)) || 0));
  const bound_crystals = Math.max(0, Math.trunc(Number(state.wallet?.boundBalens !== undefined ? state.wallet.boundBalens : (prevRow.bound_crystals || 0)) || 0));
  const energy = Math.max(0, Math.min(200, Math.trunc(Number(state.energy?.value !== undefined ? state.energy.value : (typeof state.energy === 'number' ? state.energy : (prevRow.energy || 0))) || 0)));
  const map_id = Number(state.position?.mapId || prevRow.map_id || 10000);
  const pos_x = Number(state.position?.x || prevRow.pos_x || 250);
  const pos_y = Number(state.position?.y || prevRow.pos_y || 250);

  const experience = Math.max(
    0,
    Math.trunc(Number(
      state.progression?.totalXp !== undefined
        ? state.progression.totalXp
        : (state.experience !== undefined ? state.experience : (state.hero?.totalXp ?? prevRow.experience ?? 0))
    ) || 0)
  );
  const grade = Math.max(
    1,
    Math.trunc(Number(
      state.grade !== undefined
        ? state.grade
        : (state.hero?.grade ?? prevRow.grade ?? 1)
    ) || 1)
  );

  // Evita colisão de IDs em inventory_items entre personagens distintos
  if (state.inventory && Array.isArray(state.inventory.items)) {
    const [existingRows] = await cx.execute('SELECT id FROM inventory_items WHERE character_id = ?', [id]);
    const ownedIds = new Set(existingRows.map(r => Number(r.id)));
    const currentItemIds = [];

    for (const it of state.inventory.items) {
      if (!it || !it.templateId) continue;
      const oldInstId = Number(it.instanceId || 0);
      const tId = Number(it.templateId);
      const itemName = await getItemName(cx, tId);
      const amount = Number(it.count || 1);
      const isForge = (it.bagType === 0);
      const isEquip = (it.bagType === 4);
      const location = isForge ? 'FORGE' : (isEquip ? 'EQUIP' : (it.bagType === 2 ? 'STORAGE' : 'BAG'));
      const slot_number = Number(it.pos !== undefined ? it.pos : 0);
      const upgrade_level = Number(it.strengthenGrade || 0);
      const bound_flag = it.bind ? 1 : 0;
      const extra_json = JSON.stringify({
        instanceId: it.instanceId,
        bagType: it.bagType,
        objectId: it.objectId,
        masterAttr: it.masterAttr,
        sonAttr: it.sonAttr,
        suitId: it.suitId,
        entryId: it.entryId,
        randomSkill_1: it.randomSkill_1,
        randomSkill_2: it.randomSkill_2,
        randomSkill_3: it.randomSkill_3,
        randomSkill_4: it.randomSkill_4,
        randomSkill_5: it.randomSkill_5,
        used: isEquip,
        originBagType: it.originBagType,
        originPos: it.originPos,
        join_1: it.join_1 !== undefined ? it.join_1 : 0,
        join_2: it.join_2 !== undefined ? it.join_2 : -1,
        join_3: it.join_3 !== undefined ? it.join_3 : -1,
        join_4: it.join_4 !== undefined ? it.join_4 : -1,
        validDate: it.validDate || 0,
        beginDate: it.beginDate || ''
      });

      if (oldInstId > 0 && ownedIds.has(oldInstId)) {
        await cx.execute(
          `UPDATE inventory_items
           SET template_id=?, item_name=?, amount=?, location=?, slot_number=?, upgrade_level=?, bound_flag=?, extra_json=?
           WHERE id=? AND character_id=?`,
          [tId, itemName, amount, location, slot_number, upgrade_level, bound_flag, extra_json, oldInstId, id]
        );
        currentItemIds.push(oldInstId);
      } else {
        const [res] = await cx.execute(
          `INSERT INTO inventory_items (character_id, template_id, item_name, amount, location, slot_number, upgrade_level, bound_flag, extra_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, tId, itemName, amount, location, slot_number, upgrade_level, bound_flag, extra_json]
        );
        it.instanceId = res.insertId;
        ownedIds.add(res.insertId);
        currentItemIds.push(res.insertId);
        if (isEquip && state.inventory.equipment) {
          for (const [eqSlot, eqInst] of Object.entries(state.inventory.equipment)) {
            if (Number(eqInst) === oldInstId || Number(eqSlot) === slot_number) {
              state.inventory.equipment[eqSlot] = res.insertId;
            }
          }
        }
      }
    }

    if (currentItemIds.length > 0) {
      await cx.query(`DELETE FROM inventory_items WHERE character_id = ? AND id NOT IN (${currentItemIds.join(',')})`, [id]);
    } else if (state.inventory?.explicitlyCleared === true) {
      await cx.execute('DELETE FROM inventory_items WHERE character_id = ?', [id]);
    }
  }

  if (state.quests) {
    for (const [qIdStr, qData] of Object.entries(state.quests.active || {})) {
      const qId = Number(qIdStr);
      const title = getQuestTitle(qId);
      const type = getQuestType(qId);
      const progress_json = JSON.stringify({
        isComplete: !!qData.isComplete,
        condition_1: qData.condition_1 || 0,
        condition_2: qData.condition_2 || 0,
        condition_3: qData.condition_3 || 0,
        condition_4: qData.condition_4 || 0,
        completedDate: qData.completedDate || '2000-01-01 00:00:00'
      });
      await cx.execute(
        `INSERT INTO character_quests (character_id, quest_template_id, quest_title, quest_type, status, progress_json)
         VALUES (?, ?, ?, ?, 'active', ?)
         ON DUPLICATE KEY UPDATE quest_title=VALUES(quest_title), quest_type=VALUES(quest_type), status='active', progress_json=VALUES(progress_json)`,
        [id, qId, title, type, progress_json]
      );
    }
    for (const cId of (state.quests.completed || [])) {
      const qId = Number(cId);
      const title = getQuestTitle(qId);
      const type = getQuestType(qId);
      await cx.execute(
        `INSERT INTO character_quests (character_id, quest_template_id, quest_title, quest_type, status, progress_json)
         VALUES (?, ?, ?, ?, 'completed', NULL)
         ON DUPLICATE KEY UPDATE status='completed'`,
        [id, qId, title, type]
      );
    }
  }

  if (state.skills && Array.isArray(state.skills.learned)) {
    const learnedIds = state.skills.learned
      .map(item => Number(typeof item === 'object' && item !== null ? item.templateId : item))
      .filter(sId => Number.isSafeInteger(sId) && sId > 0);

    const fastKeyArray = (typeof state.skills.fastKey === 'string'
      ? state.skills.fastKey.split(',').map(s => Number(s.trim()))
      : (Array.isArray(state.skills.fastKey) ? state.skills.fastKey.map(Number) : [])).slice(0, 6);

    for (const sId of learnedIds) {
      const tpl = skillsState.byId.get(sId);
      const sName = tpl ? (tpl.TemplateName_pt || tpl.TemplateName_en || tpl.TemplateName) : getSkillName(sId);
      const lvl = tpl ? Number(tpl.Grades || 1) : 1;
      const sonType = tpl ? tpl.SonType : Math.floor(sId / 100);
      const fIdx = sonType ? fastKeyArray.indexOf(sonType) : -1;
      const equipped = (fIdx >= 0 && fIdx < 6) ? 1 : 0;
      const fast_key = (fIdx >= 0 && fIdx < 6) ? fIdx : null;

      await cx.execute(
        `INSERT INTO character_skills (character_id, skill_template_id, skill_name, level, equipped, fast_key)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE skill_name=VALUES(skill_name), level=VALUES(level), equipped=VALUES(equipped), fast_key=VALUES(fast_key)`,
        [id, sId, sName, lvl, equipped, fast_key]
      );
    }

    if (learnedIds.length > 0) {
      await cx.query(`DELETE FROM character_skills WHERE character_id = ? AND skill_template_id NOT IN (${learnedIds.join(',')})`, [id]);
    } else {
      await cx.execute('DELETE FROM character_skills WHERE character_id = ?', [id]);
    }
  }

  if (state.resourceLedger && typeof state.resourceLedger === 'object') {
    for (const [, entry] of Object.entries(state.resourceLedger)) {
      if (!entry) continue;
      const txUuid = crypto.randomUUID();
      const opType = entry.payload?.reason || entry.payload?.currency || 'sale';
      const costGold = Number(entry.payload?.delta || 0);
      const details = JSON.stringify(entry);
      const createdAt = entry.time ? new Date(entry.time) : new Date();

      await cx.execute(
        `INSERT INTO item_operations_ledger (transaction_uuid, character_id, operation_type, cost_gold, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [txUuid, id, opType, costGold, details, createdAt]
      );
    }
    delete state.resourceLedger;
  }

  const leanState = structuredClone(state);
  delete leanState.resourceLedger;
  delete leanState.gold;
  if (leanState.inventory) {
    leanState.inventory = {
      nextInstanceId: Number(state.inventory.nextInstanceId || 1),
      equipment: state.inventory.equipment || {},
      testGrants: state.inventory.testGrants || {},
      items: state.inventory.items || []
    };
  }
  if (leanState.quests) {
    leanState.quests = {
      active: state.quests.active || {},
      completed: Array.from(new Set((state.quests.completed || []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0)))
    };
  }
  if (leanState.skills) {
    leanState.skills = {
      learned: state.skills.learned
        .map(item => Number(typeof item === 'object' && item !== null ? item.templateId : item))
        .filter(sId => Number.isSafeInteger(sId) && sId > 0),
      fastKey: typeof state.skills.fastKey === 'string'
        ? state.skills.fastKey
        : (Array.isArray(state.skills.fastKey) ? state.skills.fastKey.join(',') + ',' : ''),
      extraSkillPoint: Number(state.skills.extraSkillPoint || 0)
    };
  }
  if (!leanState.wallet) leanState.wallet = {};
  leanState.wallet.gold = gold;
  leanState.wallet.balens = crystals;
  leanState.wallet.boundBalens = bound_crystals;

  leanState.energy = {
    value: energy,
    lastTickHour: Number(state.energy?.lastTickHour || Math.floor(Date.now() / 3600000))
  };
  leanState.position = { mapId: map_id, x: pos_x, y: pos_y };
  leanState.grade = grade;
  leanState.experience = experience;
  if (leanState.hero) {
    leanState.hero.grade = grade;
    leanState.hero.totalXp = experience;
  }

  const leanStateJson = JSON.stringify(leanState);

  await cx.execute(
    `UPDATE characters SET grade=?, experience=?, gold=?, crystals=?, bound_crystals=?, energy=?, map_id=?, pos_x=?, pos_y=?, state_json=?, updated_at=NOW()
     WHERE id=?`,
    [grade, experience, gold, crystals, bound_crystals, energy, map_id, pos_x, pos_y, leanStateJson, id]
  );
}

module.exports = {
  hydrateCharacter,
  persistCharacterState,
  getItemName,
  getQuestTitle,
  getSkillName,
  recoverTimedEnergy,
  spendEnergy,
  grantPotionEnergy
};
