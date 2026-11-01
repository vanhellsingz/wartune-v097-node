'use strict';
// Wartune Ultra v0.9.7 — resolves the official PetSaveWnd flow.
// C_PLAYER_PET_OP (8621), opType=16, petIds=[IDs TO DISSOLVE].
const fs = require('node:fs');
const path = require('node:path');

function readUniqueCatalog(prefix, key) {
  const dir = path.resolve(__dirname, '../res/release/config');
  const found = fs.readdirSync(dir).filter(f => f === prefix + '.json' || (f.startsWith(prefix + '-') && f.endsWith('.json')));
  if (found.length !== 1) throw Error(`Catalogo ${prefix} ausente ou ambiguo (${found.length} arquivo(s))`);
  const rows = JSON.parse(fs.readFileSync(path.join(dir, found[0]), 'utf8'))[key];
  if (!Array.isArray(rows)) throw Error(`Catalogo ${prefix} invalido`);
  return rows;
}
function asInteger(value, label, minimum = 0) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < minimum) throw Error(`${label} invalido`);
  return n;
}
function immutableId(id) { return asInteger(id, 'petId', 1); }

function getPetType(pet, petCatalogue) {
  const template = petCatalogue.get(asInteger(pet.templateId, 'templateId', 1));
  if (!template) throw Error('Silfo sem template no t_s_pettemplate; operacao cancelada');
  return asInteger(template.PetType, 'PetType', 1);
}

function calculateRefund(pet, petCatalogue, upgradeRows) {
  const template = petCatalogue.get(Number(pet.templateId));
  if (!template) throw Error('Template de Silfo nao encontrado');
  // Actual formulas in the supplied LayaAir bundle: Fy.calcResolveCornea/SoulStone.
  const cornea = ['addPowerApti', 'addIntelApti', 'addPhysiApti', 'addArmorApti']
    .reduce((v, k) => v + asInteger(pet[k] ?? 0, k), 2);
  const quality = asInteger(pet.initQuality ?? template.Quality, 'initQuality', 1);
  let qualityPool = asInteger(pet.totalQualityGp ?? 0, 'totalQualityGp');
  const grades = upgradeRows.filter(t => Number(t.Types) === 27 && asInteger(t.Grades, 'Grades') <= quality);
  if (!grades.length) throw Error('Tabela de refinamento de Silfos (Types=27) incompleta; preservado');
  for (const grade of grades) qualityPool += asInteger(grade.Data, 'Data de refinamento');
  const soulStone = Math.ceil(qualityPool / 12);
  return {sepulcrum:cornea, mahra:soulStone};
}

function dissolveChosenDuplicates(saved, petIds, deps) {
  const {petCatalogue, upgradeRows, itemTemplates, inventoryState} = deps;
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.sylphs?.list)) throw Error('Lista de Silfos invalida');
  if (!Array.isArray(petIds) || !petIds.length || petIds.length > 120) throw Error('Selecao de Silfos invalida');
  const requested = petIds.map(immutableId);
  if (new Set(requested).size !== requested.length) throw Error('PetIDs duplicados na requisicao');
  const original = saved.sylphs.list.filter(p => p && !p.isDel);
  const byId = new Map();
  for (const p of original) {
    const id = immutableId(p.petId);
    if (byId.has(id)) throw Error('PetIDs duplicados no banco; nenhuma exclusao efetuada');
    byId.set(id, p);
  }
  const removeIds = new Set(requested);
  if (removeIds.size >= original.length) throw Error('Nao e permitido remover todos os Silfos');
  for (const id of removeIds) if (!byId.has(id)) throw Error(`Silfo ${id} ausente ou ja removido; solicitacao recusada`);
  const remaining = original.filter(p => !removeIds.has(Number(p.petId)));
  const beforeTypes = new Map(), afterTypes = new Map();
  for (const p of original) {
    const type = getPetType(p, petCatalogue);
    beforeTypes.set(type, (beforeTypes.get(type) || 0) + 1);
  }
  for (const p of remaining) {
    const type = getPetType(p, petCatalogue);
    afterTypes.set(type, (afterTypes.get(type) || 0) + 1);
  }
  for (const [type, before] of beforeTypes) {
    const after = afterTypes.get(type) || 0;
    if (before > 1 && after !== 1) throw Error(`Tipo ${type} deve manter exatamente um Silfo`);
    if (before === 1 && after !== 1) throw Error(`Nao pode descartar Silfo unico do tipo ${type}`);
  }
  const removed = original.filter(p => removeIds.has(Number(p.petId)));
  let sepulcrum = 0, mahra = 0;
  for (const pet of removed) {
    const refund = calculateRefund(pet, petCatalogue, upgradeRows);
    sepulcrum += refund.sepulcrum;
    mahra += refund.mahra;
  }
  if (![sepulcrum, mahra].every(n => Number.isSafeInteger(n) && n >= 0)) throw Error('Devolucao calculada invalida');
  for (const id of [3040001, 208023]) if (!itemTemplates.has(id)) throw Error(`Item de reembolso ${id} nao encontrado em t_s_itemtemplate`);
  // Inventory and pet changes happen under the same DB row transaction.
  const bag = inventoryState.inventory(saved);
  function reward(templateId, amount) {
    if (!amount) return;
    const template = itemTemplates.get(templateId);
    const cap = asInteger(template.MaxCount, 'MaxCount', 1);
    const existing = bag.items.find(i => Number(i.bagType) === 1 && Number(i.templateId) === templateId && i.count + amount <= cap);
    if (existing) { existing.count += amount; return; }
    if (amount > cap) throw Error(`Reembolso ${templateId} excede pilha; preservado`);
    inventoryState.addItem(saved, templateId, amount, id => itemTemplates.get(id));
  }
  reward(3040001, sepulcrum);  // Sepulcrum de Silfo — cornea
  reward(208023, mahra);      // Mahra — soul stone
  saved.sylphs.list = saved.sylphs.list.filter(p => !p || !removeIds.has(Number(p.petId)));
  if (removeIds.has(Number(saved.sylphs.activePetId))) {
    const priorFight = remaining.find(p => p.isFight);
    const chosen = priorFight || remaining[0];
    for (const p of remaining) p.isFight = p === chosen;
    saved.sylphs.activePetId = Number(chosen.petId);
  }
  return {state:saved, removed, kept:remaining, refund:{sepulcrum,mahra}, opType:16};
}

function createCatalogContext(inventoryState, itemTemplates) {
  return {
    petCatalogue:new Map(readUniqueCatalog('t_s_pettemplate', 't_s_pettemplate').map(r => [Number(r.TemplateId), r])),
    upgradeRows:readUniqueCatalog('t_s_upgradetemplate', 't_s_upgradetemplate'),
    itemTemplates, inventoryState
  };
}
module.exports = {dissolveChosenDuplicates, createCatalogContext, calculateRefund};
