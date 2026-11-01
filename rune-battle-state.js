'use strict';

const fs = require('fs');
const path = require('path');

const configRoot = path.resolve(__dirname, '../res/release/config');
const file = fs.readdirSync(configRoot).find(name => name.startsWith('t_s_runetemplate-'));
const catalog = file ? JSON.parse(fs.readFileSync(path.join(configRoot, file), 'utf8')).t_s_runetemplate : [];
const templates = new Map(catalog.map(row => [Number(row.TemplateId), row]));

function equippedRuneSkills(saved, grade) {
  return equippedRuneItems(saved, grade).map(item => item.skillTempId);
}

function equippedRuneItems(saved, grade) {
  const runes = Array.isArray(saved?.army?.runes) ? saved.army.runes : [];
  const learned = new Set(runes.map(r => Number(r.runeId)));
  const keys = String(saved?.army?.runeKey || '').split(',').slice(0, 3);
  return keys.flatMap((value, slot) => {
    if (Number(grade) < 35 + slot * 5) return [];
    const runeId = Number(value);
    if (!learned.has(runeId)) return [];
    const template = templates.get(runeId);
    const skillId = Number(template?.SkillTemplateId);
    return Number.isInteger(skillId) && skillId > 0 ? [{
      tempId: runeId, bagPos: slot, skillTempId: skillId,
      count: Math.max(0, Number(template.UseCount) || 0),
      sonType: Number(template.RuneType) || 0
    }] : [];
  });
}

module.exports = { equippedRuneSkills, equippedRuneItems };
