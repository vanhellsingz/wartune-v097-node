'use strict';
const fs = require('node:fs');
const path = require('node:path');

const catalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../res/release/config/t_s_systemopen-99bc54d992.json'), 'utf8')).t_s_systemopen;
const byId = new Map(catalog.map(row => [Number(row.SystemID), row]));

function resolveOpenSystems(grade, state = {}) {
  const level = Number(grade) || 1;
  const completed = new Set((state.quests?.completed || []).map(Number));
  const eligible = new Map();
  function canOpen(id) {
    if (eligible.has(id)) return eligible.get(id);
    const row = byId.get(id);
    if (!row) return false;
    const requiredLevel = Math.max(Number(row.Grades) || 1, Number(row.ShowGrades) || 1);
    const questId = Number(row.QuestId) || 0;
    const questCondition = Number(row.QuestCondition) || 0;
    let allowed = level >= requiredLevel && (!questId || (questCondition === 2 && completed.has(questId)));
    if (allowed && Number(row.ParentId)) allowed = canOpen(Number(row.ParentId));
    eligible.set(id, allowed);
    return allowed;
  }
  const open = new Set([...byId.keys()].filter(canOpen));
  // Keep protocol-only unlocks, but never let an old snapshot bypass catalog gates.
  for (const raw of state.systemsOpen || []) {
    const id = Number(raw);
    if (Number.isSafeInteger(id) && id > 0 && !byId.has(id) && ![109, 124, 127].includes(id)) open.add(id);
  }
  if (level >= 12) { open.add(124); open.add(127); }
  if (level >= 18) open.add(109);
  else open.delete(109);
  return [...open].sort((a, b) => a - b);
}

module.exports = { catalog, resolveOpenSystems };
