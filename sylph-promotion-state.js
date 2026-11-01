'use strict';

const fs = require('node:fs');
const path = require('node:path');
const inventoryState = require('./inventory-state');

const configDir = path.resolve(__dirname, '../res/release/config');
function read(prefix) {
  const file = fs.readdirSync(configDir).find(name => name.startsWith(prefix + '-') && name.endsWith('.json'));
  if (!file) throw Error('Catalogo ausente: ' + prefix);
  return JSON.parse(fs.readFileSync(path.join(configDir, file), 'utf8'))[prefix];
}
const promotions = read('t_s_petpromotion');
const ascensions = read('t_s_compose').filter(row => Number(row.Types) === 7);
const templates = new Map(read('t_s_pettemplate').map(row => [Number(row.TemplateId), row]));
const byMaterial = new Map(promotions.map(row => [Number(row.Material), row]));

function parseItems(spec) {
  return String(spec || '').split('|').filter(Boolean).map(part => {
    const match = /^(\d+),(\d+)$/.exec(part.trim());
    if (!match) throw Error('Material de promocao invalido: ' + part);
    return { id: Number(match[1]), count: Number(match[2]) };
  });
}
function verifyConditions(pet, template, row) {
  for (const part of String(row.NeedType || '').split('|').filter(Boolean)) {
    const [kind, minimum] = part.split(',').map(Number);
    if (kind === 1 && Number(template.Property2) < minimum) throw Error('Divindade insuficiente');
    if (kind === 2 && Number(pet.quality || 0) < 21) throw Error('Qualidade ainda nao esta no maximo');
    if (kind === 3) {
      for (const [field, key] of [['PowerApt','powerApti'], ['ArmorApt','armorApti'], ['IntelApt','intelApti'], ['PhysiApt','physiApti']]) {
        if (Number(pet[key] || 0) < Number(template[field]?.[1] || 0)) throw Error('Aptidao ainda nao esta no maximo');
      }
    }
  }
}
function promote(saved, petId, payType = 0, playerLevel = Infinity) {
  const pet = saved.sylphs?.list?.find(item => Number(item.petId) === Number(petId) && !item.isDel);
  if (!pet) throw Error('Silfo nao encontrado');
  const template = templates.get(Number(pet.templateId));
  const row = byMaterial.get(Number(pet.templateId));
  if (!template || !row || !templates.has(Number(row.Product))) throw Error('Silfo nao possui promocao catalogada');
  if (Number(playerLevel) < Number(templates.get(Number(row.Product)).NeedGrade || 1)) throw Error('Nivel do personagem insuficiente');
  verifyConditions(pet, template, row);
  const needs = parseItems(row.NeedItem);
  const bag = inventoryState.inventory(saved);
  for (const {id, count} of needs) {
    const held = bag.items.filter(item => item.bagType === 1 && item.templateId === id)
      .reduce((sum, item) => sum + item.count, 0);
    if (held < count) throw Error('Material de promocao insuficiente: ' + id);
  }
  saved.wallet ||= {};
  if (Number(saved.wallet.gold || 0) < Number(row.NeedGold || 0)) throw Error('Ouro insuficiente');
  const diamonds = Number(row.NeedDiamond || 0);
  if (diamonds && ![1, 2].includes(payType)) throw Error('Forma de pagamento nao selecionada');
  const diamondKey = payType === 2 ? 'boundBalens' : 'balens';
  if (Number(saved.wallet[diamondKey] || 0) < diamonds) throw Error('Diamantes insuficientes');
  for (const {id, count} of needs) {
    let remaining = count;
    for (const item of [...bag.items]) {
      if (item.bagType !== 1 || item.templateId !== id || !remaining) continue;
      const take = Math.min(item.count, remaining);
      item.count -= take;
      remaining -= take;
      if (!item.count) bag.items.splice(bag.items.indexOf(item), 1);
    }
  }
  saved.wallet.gold -= Number(row.NeedGold || 0);
  if (diamonds) saved.wallet[diamondKey] -= diamonds;
  const previousTemplateId = Number(pet.templateId);
  pet.templateId = Number(row.Product);
  pet.petName = String(templates.get(pet.templateId).TemplateName_pt || templates.get(pet.templateId).TemplateName_en || pet.petName);
  return { petId: Number(petId), previousTemplateId, templateId: pet.templateId, spent: needs };
}

function ascend(saved, petId, playerLevel = Infinity) {
  const pet = saved.sylphs?.list?.find(item => Number(item.petId) === Number(petId) && !item.isDel);
  if (!pet) throw Error('Silfo nao encontrado');
  const template = templates.get(Number(pet.templateId));
  if (!template) throw Error('Template de Silfo ausente');
  const row = ascensions.find(entry => Number(entry.Material1) === Number(template.PetType) &&
    Number(entry.Count1) === Number(template.Property2));
  if (!row) throw Error('Divindade maxima para esta forma');
  const target = [...templates.values()].find(entry => Number(entry.PetType) === Number(template.PetType) &&
    Number(entry.Property2) === Number(row.NewMaterial) && Number(entry.Quality) === Number(template.Quality));
  if (!target) throw Error('Proxima forma de Divindade ausente');
  if (Number(playerLevel) < Number(target.NeedGrade || 1)) throw Error('Nivel do personagem insuficiente');
  const needs = [{id:Number(row.Material2),count:Number(row.Count2)},
    {id:Number(row.Material3),count:Number(row.Count3)}].filter(entry=>entry.id>0&&entry.count>0);
  const bag = inventoryState.inventory(saved);
  for (const {id,count} of needs) {
    const held = bag.items.filter(item=>item.bagType===1&&item.templateId===id)
      .reduce((sum,item)=>sum+item.count,0);
    if (held < count) throw Error('Material de Divindade insuficiente: ' + id);
  }
  saved.wallet ||= {};
  const gold = Number(row.NeedGold || 0);
  if (Number(saved.wallet.gold || 0) < gold) throw Error('Ouro insuficiente');
  for (const {id,count} of needs) {
    let remaining=count;
    for (const item of [...bag.items]) {
      if (item.bagType!==1 || item.templateId!==id || !remaining) continue;
      const take=Math.min(remaining,item.count);
      item.count-=take;remaining-=take;
      if (!item.count) bag.items.splice(bag.items.indexOf(item),1);
    }
  }
  saved.wallet.gold-=gold;
  const previousTemplateId=Number(pet.templateId);
  pet.templateId=Number(target.TemplateId);
  pet.petName=String(target.TemplateName_pt || target.TemplateName_en || pet.petName);
  return {petId:Number(petId),previousTemplateId,templateId:pet.templateId,spent:needs};
}

module.exports = { promote, ascend, promotions, ascensions, templates, parseItems, verifyConditions };
