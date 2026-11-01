'use strict';

let canonicalConfigs;
try {
  canonicalConfigs = require('./canonical-config-repository');
} catch (_) {}

const DEFAULT_SKILL_POOL = [501, 801, 601, 701, 2001];
const sylphEquipment = require('./sylph-equipment-state');

function ensureItemRandomSkills(item, template) {
  if (!item) return;
  let tmpl = template;
  if (!tmpl && canonicalConfigs && item.templateId) {
    if (typeof canonicalConfigs.getItemTemplate === 'function') {
      tmpl = canonicalConfigs.getItemTemplate(item.templateId);
    } else if (typeof canonicalConfigs.getById === 'function') {
      tmpl = canonicalConfigs.getById('t_s_itemtemplate', item.templateId);
    }
  }
  if (!tmpl || tmpl.MasterType !== 1) return;
  const count = Number(tmpl.RandomSkillCount || 0);
  if (count <= 0) return;
  for (let i = 1; i <= Math.min(5, count); i++) {
    const key = 'randomSkill_' + i;
    if (item[key] === undefined || item[key] === null) {
      item[key] = DEFAULT_SKILL_POOL[i - 1] || 501;
    }
  }
}

// Estado persistente de bolsa/equipamento. BagType 1 e 4 seguem o enum oficial
// do cliente (Player e HeroEquipment); somente slots com mapeamento confirmado
// são aceitos para equipar.

function parseState(raw) {
  if (raw == null || raw === '') return {};
  const state = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw Error('state_json invalido');
  return structuredClone(state);
}

function inventory(state) {
  if (!state.inventory) state.inventory = { nextInstanceId: 1, items: [], equipment: {}, testGrants: {} };
  const bag = state.inventory;
  if (!bag.testGrants || typeof bag.testGrants !== 'object') bag.testGrants = {};
  if (!bag.equipment || typeof bag.equipment !== 'object') bag.equipment = {};
  if (!Array.isArray(bag.items)) bag.items = [];
  if (!Number.isSafeInteger(bag.nextInstanceId) || bag.nextInstanceId < 1) bag.nextInstanceId = 1;
  const ids = new Set(), positions=new Set();
  for (const item of bag.items) {
    if (!item || !Number.isSafeInteger(item.instanceId) || item.instanceId < 1 || ids.has(item.instanceId) ||
        !Number.isSafeInteger(item.templateId) || item.templateId < 1 || !Number.isSafeInteger(item.count) || item.count < 1 ||
        !Number.isSafeInteger(item.pos) || item.pos < 0 || ![0, 1, 4, 27, 28].includes(item.bagType) ||
        (item.bagType === 28 && (!Number.isSafeInteger(item.objectId) || item.objectId < 1)))
      throw Error('item persistido invalido ou duplicado');
    ids.add(item.instanceId);
    const owner = item.bagType === 28 ? item.objectId : 0;
    let positionKey=`${item.bagType}:${owner}:${item.pos}`;
    if(positions.has(positionKey)) {
      let p = 0;
      while(positions.has(`${item.bagType}:${owner}:${p}`)) p++;
      item.pos = p;
      positionKey = `${item.bagType}:${owner}:${p}`;
    }
    positions.add(positionKey);
  }
  let maxId=0;for(const id of ids)if(id>maxId)maxId=id;
  if(!bag.nextInstanceId||bag.nextInstanceId<=maxId)bag.nextInstanceId=maxId+1;
  const equippedIds=new Set();
  for(const [slot,id] of Object.entries(bag.equipment)){
    if(!/^\d{1,6}$/.test(slot)||!Number.isSafeInteger(id)||id<1||equippedIds.has(id))throw Error('equipamento persistido invalido ou duplicado');
    const item=bag.items.find(candidate=>candidate.instanceId===id);
    if(!item||item.bagType!==4||item.pos!==Number(slot))throw Error('equipamento referencia item ausente ou inconsistente');
    equippedIds.add(id);
  }
  if(bag.items.some(item=>(item.bagType===4)!==equippedIds.has(item.instanceId)))throw Error('estado de bolsa/equipamento inconsistente');
  return bag;
}

function firstFreeBagPos(items){
  const used=new Set(items.filter(item=>item.bagType===1).map(item=>item.pos));
  let pos=0;while(used.has(pos))pos++;
  return pos;
}

function validateTemplate(template) {
  if (!template || !Number.isSafeInteger(template.TemplateId) || template.TemplateId < 1 ||
      !Number.isInteger(template.MasterType) || !Number.isInteger(template.SonType) ||
      !Number.isInteger(template.NeedGrades) || template.NeedGrades < 1 ||
      !Number.isInteger(template.MaxCount) || template.MaxCount < 1 ||
      !Array.isArray(template.Job) || !template.Job.every(Number.isInteger)) throw Error('template ausente ou invalido');
}

function grantTestItem(stateRaw, template, { grantKey, count = 1, enabled = process.env.WARTUNE_DEV_TEST_ITEMS === '1' } = {}) {
  if (!enabled) throw Error('concessao de teste desabilitada');
  validateTemplate(template);
  if (typeof grantKey !== 'string' || !/^[a-z0-9][a-z0-9._:-]{2,79}$/i.test(grantKey)) throw Error('chave de concessao invalida');
  if (!Number.isSafeInteger(count) || count < 1 || count > template.MaxCount) throw Error('quantidade invalida');
  const state = parseState(stateRaw), bag = inventory(state);
  if (bag.testGrants[grantKey]) return { state, item: null, duplicate: true };
  const item = { instanceId: bag.nextInstanceId++, templateId: template.TemplateId, pos: firstFreeBagPos(bag.items),
    count, bagType: 1, bind: true, used: false };
  bag.items.push(item); bag.testGrants[grantKey] = { templateId: template.TemplateId, count };
  return { state, item: structuredClone(item), duplicate: false };
}

const SON_TYPE_TO_SLOTS = {
  101: [0],      // SONTYPE_WEAPON
  103: [1],      // SONTYPE_HEADDRESS
  104: [2],      // SONTYPE_CLOTHES
  106: [3],      // SONTYPE_NECKLACE
  107: [4, 5],   // SONTYPE_RING
  108: [6, 7],   // SONTYPE_TRINKET
  109: [8],      // SONTYPE_WING
  110: [9],      // FASHION_HEADDRESS
  111: [10],     // FASHION_CLOTHES
  112: [11],     // FASHION_WEAPON
  113: [12],     // SONTYPE_HERALDRY
  114: [13]      // SONTYPE_RELIC
};

function validEquipmentPositions(template) {
  const sonType = Number(template?.SonType);
  if (SON_TYPE_TO_SLOTS[sonType]) return SON_TYPE_TO_SLOTS[sonType];
  return [];
}

function equipmentPosition(template, requestedPos = null) {
  const slots = validEquipmentPositions(template);
  if (slots.length === 0) throw Error('slot de equipamento sem mapeamento confirmado');
  if (requestedPos != null && slots.includes(requestedPos)) return requestedPos;
  return slots[0];
}

function addItem(stateRaw, templateId, count = 1, resolveTemplate = null) {
  const state = (typeof stateRaw === 'object' && stateRaw !== null && !Array.isArray(stateRaw)) ? stateRaw : parseState(stateRaw);
  const bag = inventory(state);
  const tId = Number(templateId);
  if (!Number.isSafeInteger(tId) || tId < 1) throw Error('templateId invalido');
  const addCount = Number(count) || 1;
  if (!Number.isSafeInteger(addCount) || addCount < 1) throw Error('quantidade invalida');
  if (resolveTemplate) {
    const template = resolveTemplate(tId);
    if (template) validateTemplate(template);
  }
  const template = resolveTemplate ? resolveTemplate(tId) : canonicalConfigs?.getItemTemplate?.(tId);
  const petEquipment = sylphEquipment.isSylphEquipment(template);
  const added = [];
  for (let index = 0; index < (petEquipment ? addCount : 1); index++) {
    const item = {
      instanceId: bag.nextInstanceId++, templateId: tId,
      pos: petEquipment ? sylphEquipment.firstFreePos(bag.items) : firstFreeBagPos(bag.items),
      count: petEquipment ? 1 : addCount, bagType: petEquipment ? 27 : 1,
      bind: true, used: false
    };
    ensureItemRandomSkills(item, template);
    if (petEquipment) sylphEquipment.initializeAttributes(item, template);
    bag.items.push(item);
    added.push(structuredClone(item));
  }
  return { state, item: added[0], items: added };
}

function grantInitialWeapon(stateRaw,template,sex){
 validateTemplate(template);const state=parseState(stateRaw),bag=inventory(state);
 const version=state.creation?.version;
 if(!['v095','v096','v097'].includes(version)||template.MasterType!==1||template.SonType!==101||template.NeedGrades!==1||!template.Job.includes(state.job)||(template.Sexs!==2&&template.Sexs!==sex))throw Error('Invalid initial class weapon');
 bag.initialGrants??={};const key=version+'-initial-weapon';
 if(bag.initialGrants[key])return {state,duplicate:true};
 const item={instanceId:bag.nextInstanceId++,templateId:template.TemplateId,pos:firstFreeBagPos(bag.items),count:1,bagType:1,bind:true,used:false};
 bag.items.push(item);bag.initialGrants[key]={templateId:template.TemplateId,count:1,source:'Ultra level-1 class-compatible weapon'};
 return {state,item,duplicate:false};
}

function equipItem(stateRaw, instanceId, character, resolveTemplate, requestedPos) {
  if (!Number.isSafeInteger(instanceId) || instanceId < 1) throw Error('identificador de instancia invalido');
  const state = parseState(stateRaw), bag = inventory(state);
  const index = bag.items.findIndex(item => item.instanceId === instanceId);
  if (index < 0) throw Error('item nao encontrado na bolsa');
  const item = bag.items[index], template = resolveTemplate(item.templateId); validateTemplate(template);
  const characterState = parseState(character.state_json);
  const job = Number.isInteger(character.job) ? character.job : characterState.job;
  if (!Number.isInteger(job) || job < 1 || job > 3) throw Error('classe do personagem nao persistida; equipamento bloqueado');
  if (template.MasterType !== 1) throw Error('template nao e equipamento');
  if (template.NeedGrades > Math.max(1, Number(character.grade) || 1)) throw Error('nivel insuficiente');
  if (!template.Job.includes(0) && !template.Job.includes(job)) throw Error('classe incompatível');
  const sex = Number(character.sex) || 0;
  if (Number.isInteger(template.Sexs) && template.Sexs !== 2 && template.Sexs !== sex)
    throw Error('sexo/aparencia incompatível');

  const allowedSlots = validEquipmentPositions(template);
  if (allowedSlots.length === 0) throw Error('slot de equipamento sem mapeamento confirmado');

  let position;
  if (requestedPos != null && allowedSlots.includes(requestedPos)) {
    position = requestedPos;
  } else {
    const emptySlot = allowedSlots.find(s => bag.equipment[String(s)] == null);
    position = emptySlot !== undefined ? emptySlot : allowedSlots[0];
  }

  if (Object.values(bag.equipment).includes(instanceId)) return { state, changed: false };
  const slot = String(position);
  const previousId = bag.equipment[slot];
  if (previousId != null) {
    const oldIndex = bag.items.findIndex(candidate => candidate.instanceId === previousId);
    if (oldIndex < 0) throw Error('equipamento referencia item ausente');
    const freePos=firstFreeBagPos(bag.items);bag.items[oldIndex].bagType = 1; bag.items[oldIndex].pos = freePos;
  }
  bag.items[index].bagType = 4; bag.items[index].pos = Number(slot);
  bag.equipment[slot] = instanceId;
  return { state, changed: true, slot: Number(slot), swappedInstanceId: previousId || null };
}

function unequipItem(stateRaw, slot) {
  const state = parseState(stateRaw), bag = inventory(state), key = String(slot), instanceId = bag.equipment[key];
  if (instanceId == null) return { state, changed: false };
  const item = bag.items.find(candidate => candidate.instanceId === instanceId);
  if (!item) throw Error('equipamento referencia item ausente');
  const freePos=firstFreeBagPos(bag.items);delete bag.equipment[key]; item.bagType = 1; item.pos = freePos;
  return { state, changed: true };
}

function itemProtocolView(item, template, userId) {
  validateTemplate(template);
  const isEquip = (template.MasterType === 1);
  if (sylphEquipment.isSylphEquipment(template)) sylphEquipment.initializeAttributes(item, template);
  return {
    id: item.instanceId,
    objectId: item.bagType === 4 ? userId : (item.bagType === 28 ? item.objectId : 0),
    templateId: item.templateId,
    pos: item.pos,
    exist: true,
    bagType: item.bagType,
    bind: item.bind !== false,
    used: item.used === true,
    count: item.count || 1,
    attack: template.Attack || 0,
    defence: template.Defence || 0,
    agility: template.Agility || 0,
    ability: template.Ability || 0,
    captain: template.Captain || 0,
    userId,
    strengthenGrade: item.strengthenGrade || 0,
    validDate: item.validDate || 0,
    beginDate: item.beginDate || '',
    join_1: item.join_1 !== undefined ? item.join_1 : (isEquip ? 0 : 0),
    join_2: item.join_2 !== undefined ? item.join_2 : (isEquip ? -1 : -1),
    join_3: item.join_3 !== undefined ? item.join_3 : (isEquip ? -1 : -1),
    join_4: item.join_4 !== undefined ? item.join_4 : (isEquip ? -1 : -1),
    randomSkill_1: item.randomSkill_1 || 0,
    randomSkill_2: item.randomSkill_2 || 0,
    randomSkill_3: item.randomSkill_3 || 0,
    randomSkill_4: item.randomSkill_4 || 0,
    randomSkill_5: item.randomSkill_5 || 0,
    masterAttr: item.masterAttr || '',
    sonAttr: item.sonAttr || '',
    suitId: item.suitId || 0,
    entryId: item.entryId || 0
  };
}

module.exports = { parseState, inventory, firstFreeBagPos, validateTemplate, grantTestItem, grantInitialWeapon, equipItem, unequipItem, equipmentPosition, validEquipmentPositions, addItem, SON_TYPE_TO_SLOTS,
  itemProtocolView, ensureItemRandomSkills };
