'use strict';

const fs = require('fs');
const path = require('path');

const configRoot = path.resolve(__dirname, '../res/release/config');

function loadCatalog(prefix) {
  try {
    const file = fs.readdirSync(configRoot).find(f => f.startsWith(prefix + '-'));
    if (!file) return [];
    const content = JSON.parse(fs.readFileSync(path.join(configRoot, file), 'utf8'));
    return content[prefix] || [];
  } catch (e) {
    return [];
  }
}

const rawSkillTemplates = loadCatalog('t_s_skilltemplate');
const rawSkillPropertyTemplates = loadCatalog('t_s_skillpropertytemplate');

const byId = new Map();
const byJob = new Map();
const bySonType = new Map();

for (const tpl of rawSkillTemplates) {
  byId.set(tpl.TemplateId, tpl);
  if (!byJob.has(tpl.MasterType)) byJob.set(tpl.MasterType, []);
  byJob.get(tpl.MasterType).push(tpl);

  if (!bySonType.has(tpl.SonType)) bySonType.set(tpl.SonType, []);
  bySonType.get(tpl.SonType).push(tpl);
}

// Sort each sonType list by Grades ascending
for (const [_, list] of bySonType) {
  list.sort((a, b) => a.Grades - b.Grades);
}

// Default initial skill and hotbar per class:
// Job 1: Warrior -> 10711 (Dilacerador Lv 1), SonType 107
// Job 2: Archer  -> 20711 (Golpe de Flecha Lv 1), SonType 207
// Job 3: Mage    -> 30711 (Raio Elétrico Lv 1), SonType 307
const CLASS_DEFAULTS = {
  1: { defaultSkillId: 10711, defaultSonType: 107, fastKey: '107,-1,-1,-1,-1,-1' },
  2: { defaultSkillId: 20711, defaultSonType: 207, fastKey: '207,-1,-1,-1,-1,-1' },
  3: { defaultSkillId: 30711, defaultSonType: 307, fastKey: '307,-1,-1,-1,-1,-1' }
};

/**
 * Canonical skill point calculation matching client Zj.Instance.calcSkillPoint
 * Every 2 levels from level 1 to 80 gives 1 skill point.
 * Every 5 levels from 81 to 160 gives 1 skill point.
 */
function calcTotalSkillPoints(grade, extraSkillPoint = 0) {
  let pts = 0;
  for (let s = 0; s < grade; s++) {
    let mod, lvl = s + 1;
    lvl <= 80 ? mod = lvl % 2 : lvl < 160 && (mod = lvl % 5);
    if (mod === 0) pts += 1;
  }
  return pts + (Number.isSafeInteger(extraSkillPoint) && extraSkillPoint > 0 ? extraSkillPoint : 0);
}

function getSkillsState(saved, job = 1) {
  const def = CLASS_DEFAULTS[job] || CLASS_DEFAULTS[1];
  if (!saved.skills) {
    saved.skills = {
      learned: [def.defaultSkillId],
      fastKey: def.fastKey,
      extraSkillPoint: 0
    };
  }
  if (Array.isArray(saved.skills.learned)) {
    saved.skills.learned = saved.skills.learned
      .map(item => Number(typeof item === 'object' && item !== null ? item.templateId : item))
      .filter(id => Number.isSafeInteger(id) && id > 0);
  }
  if (!Array.isArray(saved.skills.learned) || saved.skills.learned.length === 0) {
    saved.skills.learned = [def.defaultSkillId];
  }
  if (Array.isArray(saved.skills.fastKey)) {
    saved.skills.fastKey = saved.skills.fastKey.join(',') + ',';
  }
  if (typeof saved.skills.fastKey !== 'string' || !saved.skills.fastKey.trim()) {
    saved.skills.fastKey = def.fastKey;
  }
  if (!Number.isSafeInteger(saved.skills.extraSkillPoint)) {
    saved.skills.extraSkillPoint = 0;
  }
  return saved.skills;
}

/**
 * Calculate total skill points spent by the character.
 * The initial class skill (rank 1) is free. Additional ranks or new skills cost 1 point per rank.
 */
function calcSpentSkillPoints(learnedSkills, job = 1) {
  const def = CLASS_DEFAULTS[job] || CLASS_DEFAULTS[1];
  let spent = 0;
  for (const skillId of learnedSkills) {
    const tpl = byId.get(skillId);
    if (!tpl) continue;
    if (tpl.SonType === def.defaultSonType) {
      // Free base rank 1
      spent += Math.max(0, tpl.Grades - 1);
    } else {
      spent += Math.max(0, tpl.Grades);
    }
  }
  return spent;
}

function getAvailableSkillPoints(saved, job = 1, grade = 1) {
  const skills = getSkillsState(saved, job);
  const total = calcTotalSkillPoints(grade, skills.extraSkillPoint);
  const spent = calcSpentSkillPoints(skills.learned, job);
  return Math.max(0, total - spent);
}

function getSkillScript(saved, job = 1) {
  const skills = getSkillsState(saved, job);
  return skills.learned.join(',');
}

function getFastKey(saved, job = 1) {
  const skills = getSkillsState(saved, job);
  return skills.fastKey;
}

function getExtraSkillPoints(saved) {
  return saved.skills?.extraSkillPoint || 0;
}

/**
 * Check if the character already has learned a skill with this sonType at >= minGrade.
 */
function hasLearnedSkill(learnedSkills, sonType, minGrade = 1) {
  for (const id of learnedSkills) {
    const tpl = byId.get(id);
    if (tpl && tpl.SonType === sonType && tpl.Grades >= minGrade) {
      return true;
    }
  }
  return false;
}

/**
 * Find the currently learned template for a given sonType (if any).
 */
function getCurrentLearnedForSonType(learnedSkills, sonType) {
  for (const id of learnedSkills) {
    const tpl = byId.get(id);
    if (tpl && tpl.SonType === sonType) {
      return tpl;
    }
  }
  return null;
}

/**
 * Validate if a skill can be learned or upgraded.
 */
function canUpgradeSkill(saved, job, grade, targetTemplateId) {
  const target = byId.get(targetTemplateId);
  if (!target) {
    return { canUpgrade: false, reason: `Template de habilidade ${targetTemplateId} inexistente` };
  }

  if (target.MasterType !== job) {
    return { canUpgrade: false, reason: `Habilidade ${targetTemplateId} pertence a outra classe (${target.MasterType} != ${job})` };
  }

  if (grade < target.NeedPlayerGrade) {
    return { canUpgrade: false, reason: `Nível de jogador insuficiente: requer ${target.NeedPlayerGrade}, atual ${grade}` };
  }

  const available = getAvailableSkillPoints(saved, job, grade);
  if (available < 1) {
    return { canUpgrade: false, reason: `Pontos de habilidade insuficientes: disponíveis ${available}` };
  }

  const skills = getSkillsState(saved, job);
  const current = getCurrentLearnedForSonType(skills.learned, target.SonType);

  if (current) {
    if (current.NextTemplateId !== target.TemplateId) {
      return { canUpgrade: false, reason: `Próximo nível esperado é ${current.NextTemplateId}, recebido ${target.TemplateId}` };
    }
  } else {
    if (target.Grades !== 1) {
      return { canUpgrade: false, reason: `Habilidade inédita deve iniciar no nível 1 (solicitado nível ${target.Grades})` };
    }
  }

  // Check prerequisites from PreTemplateId (e.g. "10711" or "10121,10721")
  if (target.PreTemplateId && typeof target.PreTemplateId === 'string' && target.PreTemplateId.trim()) {
    const preIds = target.PreTemplateId.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
    for (const preId of preIds) {
      const preTpl = byId.get(preId);
      if (preTpl) {
        if (!hasLearnedSkill(skills.learned, preTpl.SonType, preTpl.Grades)) {
          return {
            canUpgrade: false,
            reason: `Pré-requisito não atendido: requer ${preTpl.TemplateName_pt || preTpl.TemplateName_en} nível ${preTpl.Grades}`
          };
        }
      }
    }
  }

  return { canUpgrade: true, targetTemplate: target, currentTemplate: current };
}

/**
 * Execute skill learning or upgrading. Mutates saved.skills.
 */
function upgradeSkill(saved, job, grade, targetTemplateId) {
  const check = canUpgradeSkill(saved, job, grade, targetTemplateId);
  if (!check.canUpgrade) {
    throw new Error(check.reason);
  }

  const skills = getSkillsState(saved, job);
  const target = check.targetTemplate;
  const current = check.currentTemplate;

  if (current) {
    const idx = skills.learned.indexOf(current.TemplateId);
    if (idx !== -1) {
      skills.learned[idx] = target.TemplateId;
    } else {
      skills.learned.push(target.TemplateId);
    }
  } else {
    skills.learned.push(target.TemplateId);
  }

  const remaining = getAvailableSkillPoints(saved, job, grade);
  const script = getSkillScript(saved, job);

  return {
    success: true,
    targetTemplate: target,
    index: target.Index,
    remainingSkillPoints: remaining,
    skillScript: script
  };
}

/**
 * Update hotbar fastKey configuration.
 */
function setFastKey(saved, job, fastKey) {
  if (typeof fastKey !== 'string') throw new Error('fastKey deve ser uma string');
  const skills = getSkillsState(saved, job);
  skills.fastKey = fastKey;
  return { success: true, fastKey: skills.fastKey };
}

/**
 * Reset all learned skills, refunding skill points.
 * Cost is 500 * grade gold.
 */
function resetSkills(saved, job, grade, payType = 0, currentGold = 0) {
  const cost = 500 * Math.max(1, grade);
  if (payType === 0 && currentGold < cost) {
    throw new Error(`Ouro insuficiente para redefinir habilidades: necessário ${cost}, atual ${currentGold}`);
  }

  const def = CLASS_DEFAULTS[job] || CLASS_DEFAULTS[1];
  const skills = getSkillsState(saved, job);

  // Reset to initial base skill only
  skills.learned = [def.defaultSkillId];

  const totalPoints = calcTotalSkillPoints(grade, skills.extraSkillPoint);

  return {
    success: true,
    cost: payType === 0 ? cost : 0,
    refundedPoints: totalPoints,
    skillScript: getSkillScript(saved, job),
    fastKey: skills.fastKey
  };
}

module.exports = {
  rawSkillTemplates,
  byId,
  byJob,
  bySonType,
  CLASS_DEFAULTS,
  calcTotalSkillPoints,
  calcSpentSkillPoints,
  getSkillsState,
  getAvailableSkillPoints,
  getSkillScript,
  getFastKey,
  getExtraSkillPoints,
  canUpgradeSkill,
  upgradeSkill,
  setFastKey,
  resetSkills
};
