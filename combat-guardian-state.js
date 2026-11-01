'use strict';

const fs = require('node:fs');
const path = require('node:path');
const inventoryState = require('./inventory-state');
const integrity = require('./wartune-integrity-r7');

const configDir = path.resolve(__dirname, '../res/release/config');
function catalog(prefix) {
  const file = fs.readdirSync(configDir).find(name => name.startsWith(prefix + '-') && name.endsWith('.json'));
  if (!file) throw Error('Catalogo ausente: ' + prefix);
  return JSON.parse(fs.readFileSync(path.join(configDir, file), 'utf8'))[prefix];
}
const templates = catalog('t_s_combatguardiantemplate');
const upgrades = catalog('t_s_combatguardianupgrade');
const stars = catalog('t_s_combatguardianstar');
const upgradeByKey = new Map(upgrades.map(row => [`${row.GuardianID}:${row.Level}`, row]));
const starByKey = new Map(stars.map(row => [`${row.GuardianID}:${row.StarLevel}`, row]));
const templateIds = new Set(templates.map(row => Number(row.TemplateId)));

function ensure(saved) {
  saved.combatGuardians ||= { guardians: [] };
  saved.combatGuardians.guardians ||= [];
  for (const template of templates) {
    const id = Number(template.TemplateId);
    if (!saved.combatGuardians.guardians.some(g => Number(g.templateId) === id && !g.isDel)) {
      saved.combatGuardians.guardians.push({ templateId: id, level: Number(template.InitialLevel || 0), star: Number(template.InitialStar || 0), exp: 0 });
    }
  }
  return saved.combatGuardians.guardians;
}

function costs(spec) {
  if (!spec) return [];
  return String(spec).split('|').map(part => {
    const match = /^(-?\d+),(\d+)$/.exec(part.trim());
    if (!match) throw Error('Custo de guardiao invalido: ' + part);
    return { id: Number(match[1]), count: Number(match[2]) };
  }).filter(c => c.count > 0);
}

function spend(saved, requirements) {
  const bag = inventoryState.inventory(saved);
  saved.wallet ||= {};
  for (const {id, count} of requirements) {
    if (id === -100) {
      if (Number(saved.wallet.gold || 0) < count) throw Error('Ouro insuficiente');
    } else {
      const held = bag.items.filter(item => item.bagType === 1 && item.templateId === id)
        .reduce((sum, item) => sum + item.count, 0);
      if (held < count) throw Error('Material de guardiao insuficiente: ' + id);
    }
  }
  for (const {id, count} of requirements) {
    if (id === -100) { saved.wallet.gold -= count; continue; }
    let remaining = count;
    for (const item of [...bag.items]) {
      if (item.bagType !== 1 || item.templateId !== id || remaining === 0) continue;
      const take = Math.min(item.count, remaining);
      item.count -= take;
      remaining -= take;
      if (item.count === 0) bag.items.splice(bag.items.indexOf(item), 1);
    }
  }
}

function operate(saved, op, templateId) {
  const list = ensure(saved);
  if (op === 0) return { changed: false, attributes: integrity.guardianAttributes(saved) };
  const id = Number(templateId);
  if (!templateIds.has(id)) throw Error('Guardiao nao consta do catalogo');
  const guardian = list.find(g => Number(g.templateId) === id && !g.isDel);
  let row;
  if (op === 1) {
    row = upgradeByKey.get(`${id}:${Number(guardian.level || 0) + 1}`);
    if (!row) throw Error('Nivel maximo do guardiao');
    const gate = Number(row.BreakCondition || 0);
    if (gate && list.some(g => Number(g.level || 0) < gate)) throw Error('Outros guardioes ainda nao cumprem o requisito de nivel');
  } else if (op === 2) {
    row = starByKey.get(`${id}:${Number(guardian.star || 0) + 1}`);
    if (!row) throw Error('Estrela maxima do guardiao');
  } else throw Error('Operacao de guardiao desconhecida');
  spend(saved, costs(row.Consume));
  if (op === 1) guardian.level = Number(guardian.level || 0) + 1;
  else guardian.star = Number(guardian.star || 0) + 1;
  return { changed: true, guardian, attributes: integrity.guardianAttributes(saved) };
}

module.exports = { ensure, operate, costs, templates, upgrades, stars };
