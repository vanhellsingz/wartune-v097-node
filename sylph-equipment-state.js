'use strict';

const fs = require('node:fs');
const path = require('node:path');

const configDir = path.resolve(__dirname, '../res/release/config');
function table(name) {
  const file = fs.readdirSync(configDir).find(entry => entry.startsWith(`${name}-`) && entry.endsWith('.json'));
  if (!file) throw Error(`catalogo ${name} ausente`);
  return JSON.parse(fs.readFileSync(path.join(configDir, file), 'utf8'))[name];
}
const drops = table('t_s_dropitem');
const attributes = new Map(table('t_s_petequipattr').map(row => [Number(row.TemplateId), row]));
const qualities = new Map(table('t_s_petequipquality').map(row => [Number(row.Profile), row]));

function isSylphEquipment(template) {
  return Number(template?.MasterType) === 5 && Number(template.SonType) >= 501 && Number(template.SonType) <= 506;
}
function firstFreePos(items) {
  const occupied = new Set(items.filter(item => item.bagType === 27).map(item => item.pos));
  for (let pos = 0; pos < 100; pos++) if (!occupied.has(pos)) return pos;
  throw Error('bolsa de equipamentos de Silfo cheia');
}
function pickAttribute(dropId, seed) {
  const choices = drops.filter(row => Number(row.DropId) === Number(dropId) && attributes.has(Number(row.ItemId)));
  if (!choices.length) return null;
  const row = choices[seed % choices.length];
  const attribute = attributes.get(Number(row.ItemId));
  const [lower, upper] = String(attribute.BaseValue).split(',').map(Number);
  if (!Number.isSafeInteger(lower) || !Number.isSafeInteger(upper) || upper < lower) return null;
  const value = lower + ((seed >>> 4) % (upper - lower + 1));
  return `${Number(attribute.AttributeId)}:${value}`;
}
function initializeAttributes(item, template) {
  if (!isSylphEquipment(template)) return item;
  const seed = (Math.imul(item.instanceId, 2654435761) + Number(template.TemplateId)) >>> 0;
  if (!item.masterAttr) item.masterAttr = pickAttribute(template.Property1, seed) || '';
  if (item.sonAttr === undefined) {
    const count = Math.max(0, Number(qualities.get(Number(template.Profile))?.SonAttrNum) || 0);
    const values = [];
    for (let index = 0; index < count; index++) {
      const value = pickAttribute(template.Property2, (seed + Math.imul(index + 1, 2246822519)) >>> 0);
      if (value) values.push(value);
    }
    item.sonAttr = values.join(';');
  }
  item.suitId = Number(item.suitId || template.SuiteId || 0);
  return item;
}
function equipmentStats(items, petId) {
  const result = {power:0,armor:0,intel:0,physi:0,bagAttack:0,bagDefence:0,bagMagicattack:0,bagMagicdefence:0,bagLiving:0};
  const field = {1:'power',2:'armor',3:'intel',4:'physi',6:'bagAttack',7:'bagDefence',8:'bagMagicattack',9:'bagMagicdefence',10:'bagLiving'};
  for (const item of items) {
    if (item.bagType !== 28 || Number(item.objectId) !== Number(petId)) continue;
    for (const part of `${item.masterAttr || ''};${item.sonAttr || ''}`.split(';')) {
      const [id, amount] = part.split(':').map(Number);
      if (field[id] && Number.isFinite(amount)) result[field[id]] += amount;
    }
  }
  return result;
}

function refineAttributes(item, template, seed) {
  const current = initializeAttributes(item, template);
  const masterAttr = pickAttribute(template.Property1, seed >>> 0) || current.masterAttr;
  const sonAttr = String(current.sonAttr || '').split(';').filter(Boolean).map((value, index) =>
    pickAttribute(template.Property2, (seed + Math.imul(index + 1, 2246822519)) >>> 0) || value).join(';');
  return {masterAttr, sonAttr};
}

function consumeRefineMaterial(items, materialId, cost) {
  if (!Number.isSafeInteger(materialId) || materialId < 1 || !Number.isSafeInteger(cost) || cost < 1)
    throw Error('receita de refinamento invalida');
  const stacks = items.filter(item => item.bagType === 1 && item.templateId === materialId);
  if (stacks.reduce((total, item) => total + item.count, 0) < cost)
    throw Error('material de refinamento insuficiente');
  let remaining = cost;
  for (const stack of stacks) {
    const amount = Math.min(remaining, stack.count);
    stack.count -= amount;
    remaining -= amount;
    if (!remaining) break;
  }
  return items.filter(item => item.count > 0);
}

function moveLegacyEquipmentToPetBag(state, resolveTemplate) {
  const bag = state.inventory;
  if (!bag || !Array.isArray(bag.items)) return [];
  const moved = [];
  for (const item of bag.items) {
    const template = resolveTemplate(Number(item.templateId));
    if (Number(item.bagType) !== 1 || !isSylphEquipment(template)) continue;
    const oldPos = item.pos;
    item.pos = firstFreePos(bag.items);
    item.bagType = 27;
    initializeAttributes(item, template);
    moved.push({instanceId:item.instanceId, fromBagType:1, fromPos:oldPos, toBagType:27, toPos:item.pos});
  }
  return moved;
}

module.exports = {isSylphEquipment, firstFreePos, initializeAttributes, equipmentStats, refineAttributes, consumeRefineMaterial, moveLegacyEquipmentToPetBag};
