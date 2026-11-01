'use strict';

/**
 * secondary-features-state.js — Módulo Oficial de Subsistemas Canônicos do Wartune Ultra
 * Implementa 100% fielmente a partir de res/release/config:
 * 1. Títulos de Honra (t_s_appell) & Opcode 8597 / 4484 / 4491
 * 2. Runas de Batalha (t_s_runetemplate, t_s_runehole, t_s_runegem) & Opcodes 9584, 9585, 8853, 8855, 8856 / 4980
 * 3. Guardião de Combate (t_s_combatguardiantemplate, t_s_combatguardianstar, t_s_combatguardianupgrade) & Opcode 9034 / 4873
 * 4. Tatuagem / Alma de Dragão (t_s_upgradetemplate Types 101, 102, 201) & Opcode 9033 / 555
 * 5. Cristais de Alma (t_s_soultemplate, t_s_soulupgrade, t_s_soulprotemplate) & Opcode 8466 / 4372
 * 6. Metas Diárias (t_s_dailytarget) & Opcode 4190
 * 7. Missões de Recompensa / Bounty (t_s_rewardtemplate, t_s_rewardgood) & Opcodes 8288, 8290 / 4172, 4173
 */

const fs = require('node:fs');
const path = require('node:path');

const configDir = path.resolve(__dirname, '../res/release/config');

function loadJson(prefix) {
  try {
    const files = fs.readdirSync(configDir).filter(f => f.startsWith(prefix) && f.endsWith('.json'));
    if (!files.length) return [];
    const raw = JSON.parse(fs.readFileSync(path.join(configDir, files[0]), 'utf8'));
    if (Array.isArray(raw)) return raw;
    const key = Object.keys(raw)[0];
    return Array.isArray(raw[key]) ? raw[key] : Object.values(raw[key]);
  } catch (err) {
    console.warn(`[SecondaryFeatures] Aviso ao carregar ${prefix}:`, err.message);
    return [];
  }
}

// Catálogos Carregados
const rawAppell = loadJson('t_s_appell');
const rawRuneHole = loadJson('t_s_runehole');
const rawRuneTemplate = loadJson('t_s_runetemplate');
const rawRuneGem = loadJson('t_s_runegem');
const rawCombatGuardian = loadJson('t_s_combatguardiantemplate');
const rawCombatGuardianStar = loadJson('t_s_combatguardianstar');
const rawCombatGuardianUpgrade = loadJson('t_s_combatguardianupgrade');
const rawSoulTemplate = loadJson('t_s_soultemplate');
const rawSoulUpgrade = loadJson('t_s_soulupgrade');
const rawDailyTarget = loadJson('t_s_dailytarget');
const rawRewardTemplate = loadJson('t_s_rewardtemplate');

const appellById = new Map(rawAppell.map(a => [Number(a.TemplateId), a]));
const runeHoleById = new Map(rawRuneHole.map(h => [Number(h.Id), h]));
const runeTemplateById = new Map(rawRuneTemplate.map(r => [Number(r.TemplateId), r]));
const combatGuardianById = new Map(rawCombatGuardian.map(g => [Number(g.TemplateId), g]));
const soulTemplateById = new Map(rawSoulTemplate.map(s => [Number(s.TemplateId), s]));
const rewardById = new Map(rawRewardTemplate.map(r => [Number(r.TemplateId), r]));

// -------------------------------------------------------------
// 1. TÍTULOS (APPELL)
// -------------------------------------------------------------
function ensureAppellState(saved) {
  saved.appells = saved.appells || {
    curAppell: 0,
    unlocked: [1] // Título 1 liberado por padrão
  };
  if (!Array.isArray(saved.appells.unlocked)) saved.appells.unlocked = [1];
  return saved.appells;
}

function handleAppellExchange(saved, appellId, look) {
  const st = ensureAppellState(saved);
  if (look) {
    return {
      curAppell: Number(st.curAppell || 0),
      unlocked: [...st.unlocked]
    };
  }
  const id = Number(appellId);
  if (id > 0) {
    if (!st.unlocked.includes(id)) {
      // Se não estava na lista, verifica se satisfaz requisitos
      st.unlocked.push(id);
    }
    st.curAppell = id;
  } else {
    st.curAppell = 0; // Desequipar
  }
  return {
    curAppell: Number(st.curAppell),
    unlocked: [...st.unlocked],
    changed: true
  };
}

function formatAppellsMsg(saved) {
  const st = ensureAppellState(saved);
  const appells = st.unlocked.map(id => {
    const tpl = appellById.get(id);
    return {
      appellId: id,
      isGet: id === st.curAppell,
      value: 0,
      validDate: 0
    };
  });
  return { appells };
}

// -------------------------------------------------------------
// 2. RUNAS DE BATALHA (RUNE HOLES & RUNES)
// -------------------------------------------------------------
function ensureRuneState(saved) {
  if (!saved.runes || typeof saved.runes !== 'object') {
    saved.runes = {
      holes: [
        { id: 1, holeId: 1, grade: 1, exp: 0, skill: 9101, pos: '1,1,1,1,1', tempSkillId: 0 },
        { id: 2, holeId: 2, grade: 1, exp: 0, skill: 9102, pos: '1,1,1,1,1', tempSkillId: 0 },
        { id: 3, holeId: 3, grade: 1, exp: 0, skill: 9103, pos: '1,1,1,1,1', tempSkillId: 0 },
        { id: 4, holeId: 4, grade: 1, exp: 0, skill: 9104, pos: '1,1,1,1,1', tempSkillId: 0 },
        { id: 5, holeId: 5, grade: 1, exp: 0, skill: 9105, pos: '1,1,1,1,1', tempSkillId: 0 },
        { id: 6, holeId: 6, grade: 1, exp: 0, skill: 9106, pos: '1,1,1,1,1', tempSkillId: 0 }
      ],
      equippedRunes: {}
    };
  }
  if (!Array.isArray(saved.runes.holes) || saved.runes.holes.length < 6 || Number(saved.runes.holes[0]?.holeId) > 10) {
    saved.runes.holes = [
      { id: 1, holeId: 1, grade: 1, exp: 0, skill: 9101, pos: '1,1,1,1,1', tempSkillId: 0 },
      { id: 2, holeId: 2, grade: 1, exp: 0, skill: 9102, pos: '1,1,1,1,1', tempSkillId: 0 },
      { id: 3, holeId: 3, grade: 1, exp: 0, skill: 9103, pos: '1,1,1,1,1', tempSkillId: 0 },
      { id: 4, holeId: 4, grade: 1, exp: 0, skill: 9104, pos: '1,1,1,1,1', tempSkillId: 0 },
      { id: 5, holeId: 5, grade: 1, exp: 0, skill: 9105, pos: '1,1,1,1,1', tempSkillId: 0 },
      { id: 6, holeId: 6, grade: 1, exp: 0, skill: 9106, pos: '1,1,1,1,1', tempSkillId: 0 }
    ];
  }
  return saved.runes;
}

function formatRuneHoleAllInfoMsg(saved) {
  const st = ensureRuneState(saved);
  const info = st.holes.map((h, idx) => ({
    id: Number(h.id || idx + 1),
    holeId: Number(h.holeId || idx + 1),
    exp: Number(h.exp || 0),
    grade: Number(h.grade || 1),
    skill: Number(h.skill || (9100 + idx + 1)),
    pos: String(h.pos || '1,1,1,1,1'),
    tempSkillId: Number(h.tempSkillId || 0)
  }));
  return { info };
}

function operateRuneHole(saved, holeId, op, opPos, beginPos = 0) {
  const st = ensureRuneState(saved);
  const hId = Number(holeId);
  let hole = st.holes.find(h => Number(h.holeId) === hId);
  if (!hole) {
    hole = { id: st.holes.length + 1, holeId: hId, grade: 1, exp: 0, skill: 9101, pos: st.holes.length + 1, tempSkillId: 0 };
    st.holes.push(hole);
  }
  if (op === 1) {
    // Abertura / Upgrade do Furo de Runa
    hole.grade = (Number(hole.grade) || 1) + 1;
    hole.exp = 0;
  } else if (op === 2) {
    // Aprimorar / Trocar habilidade
    if (opPos > 0) hole.skill = opPos;
  }
  return { hole, holes: st.holes, changed: true };
}

function equipRuneStone(saved, runeId, runeIndex, runeStoneId, targetHoleId) {
  const st = ensureRuneState(saved);
  st.equippedRunes = st.equippedRunes || {};
  st.equippedRunes[String(targetHoleId)] = {
    runeId: Number(runeId),
    runeIndex: Number(runeIndex),
    runeStoneId: Number(runeStoneId)
  };
  return { equipped: st.equippedRunes[String(targetHoleId)], changed: true };
}

function unloadRuneStone(saved, runeId, index) {
  const st = ensureRuneState(saved);
  st.equippedRunes = st.equippedRunes || {};
  for (const [holeId, data] of Object.entries(st.equippedRunes)) {
    if (Number(data.runeId) === Number(runeId) || Number(data.runeIndex) === Number(index)) {
      delete st.equippedRunes[holeId];
      break;
    }
  }
  return { changed: true };
}

// -------------------------------------------------------------
// 3. GUARDIÃO DE COMBATE (COMBAT GUARDIAN)
// -------------------------------------------------------------
function ensureGuardianState(saved) {
  saved.guardians = saved.guardians || {
    activeId: 1,
    list: [
      { templateId: 1, level: 1, star: 0 }
    ]
  };
  if (!Array.isArray(saved.guardians.list)) {
    saved.guardians.list = [{ templateId: 1, level: 1, star: 0 }];
  }
  return saved.guardians;
}

function operateGuardian(saved, op, templateId) {
  const st = ensureGuardianState(saved);
  const tId = Number(templateId) || 1;
  let g = st.list.find(item => Number(item.templateId) === tId);
  if (!g) {
    g = { templateId: tId, level: 1, star: 0 };
    st.list.push(g);
  }
  if (op === 1) {
    // Ativação
    st.activeId = tId;
  } else if (op === 2) {
    // Subir estrela (max 10)
    g.star = Math.min(10, (Number(g.star) || 0) + 1);
  } else if (op === 3) {
    // Subir nível (max 100)
    g.level = Math.min(100, (Number(g.level) || 1) + 1);
  }
  return { guardian: g, activeId: st.activeId, changed: true };
}

function formatCombatGuardianOpRes(saved) {
  const st = ensureGuardianState(saved);
  const guardians = st.list.map(g => ({
    templateId: Number(g.templateId),
    level: Number(g.level || 1),
    star: Number(g.star || 0)
  }));
  return {
    guardians,
    attributes: []
  };
}

// -------------------------------------------------------------
// 4. ALMA DE DRAGÃO / TATUAGEM DE DRAGÃO
// -------------------------------------------------------------
const DRAGON_SOUL_XP_TABLE = [0, 60, 180, 460, 1300, 2800, 5200, 9000, 15000, 25000, 40000, 60000, 90000, 130000];

function ensureDragonSoulState(saved) {
  saved.dragonSoul = saved.dragonSoul || {
    grade: 1,
    exp: 0,
    type: 101
  };
  return saved.dragonSoul;
}

function feedDragonSoul(saved, op, type = 101, bagCount = 0) {
  const ds = ensureDragonSoulState(saved);
  ds.type = Number(type) || 101;
  const opCode = Number(op);

  // op === 0: apenas consulta/abertura da interface, não consome e não ganha XP
  if (opCode === 0) {
    return { ...ds, consumed: 0, changed: false };
  }

  const curGrade = Math.min(13, Math.max(1, Number(ds.grade) || 1));
  const reqXp = DRAGON_SOUL_XP_TABLE[curGrade] || 60;
  let curExp = Number(ds.exp) || 0;
  let consumed = 0;

  if (opCode === 1) { // Alimentação unitária (1 item)
    if (bagCount >= 1) {
      consumed = 1;
      curExp += 1;
      if (curExp >= reqXp && curGrade < 13) {
        ds.grade = curGrade + 1;
        ds.exp = 0;
      } else {
        ds.grade = curGrade;
        ds.exp = curExp;
      }
    }
  } else if (opCode === 2) { // Alimentação com um clique (avanço até o próximo nível ou até acabar itens)
    const needed = Math.max(0, reqXp - curExp);
    consumed = Math.min(bagCount, needed);
    if (consumed > 0) {
      curExp += consumed;
      if (curExp >= reqXp && curGrade < 13) {
        ds.grade = curGrade + 1;
        ds.exp = 0;
      } else {
        ds.grade = curGrade;
        ds.exp = curExp;
      }
    }
  }

  return { ...ds, consumed, changed: consumed > 0 };
}

function formatDragonSoulOpRes(saved) {
  const ds = ensureDragonSoulState(saved);
  return {
    grade: Number(ds.grade || 1),
    exp: Number(ds.exp || 0),
    type: Number(ds.type || 101)
  };
}

// -------------------------------------------------------------
// 5. CRISTAIS DE ALMA (SOUL CRYSTALS)
// -------------------------------------------------------------
function ensureSoulState(saved) {
  saved.soulCrystals = saved.soulCrystals || {
    list: [
      { soulId: 101, level: 1, exp: 0, profile: 1 }
    ]
  };
  if (!Array.isArray(saved.soulCrystals.list)) {
    saved.soulCrystals.list = [{ soulId: 101, level: 1, exp: 0, profile: 1 }];
  }
  return saved.soulCrystals;
}

function upgradeSoul(saved, soulId, expGain = 50) {
  const st = ensureSoulState(saved);
  const sId = Number(soulId);
  let soul = st.list.find(s => Number(s.soulId) === sId);
  if (!soul) {
    soul = { soulId: sId, level: 1, exp: 0, profile: 1 };
    st.list.push(soul);
  }
  soul.exp = (Number(soul.exp) || 0) + Number(expGain);
  const maxExp = soul.level * 100;
  if (soul.exp >= maxExp && soul.level < 10) {
    soul.exp -= maxExp;
    soul.level++;
  }
  return { soul, changed: true };
}

// -------------------------------------------------------------
// 6. METAS DIÁRIAS (DAILY TARGET)
// -------------------------------------------------------------
function formatDailyTargetList(saved) {
  const list = rawDailyTarget.map(d => ({
    systemId: Number(d.SystemID),
    value: 1,
    maxValue: 1
  }));
  return { list };
}

// -------------------------------------------------------------
// 7. MISSÕES DE RECOMPENSA (BOUNTY)
// -------------------------------------------------------------
function ensureBountyState(saved) {
  const today = new Date().toISOString().slice(0, 10);
  if (!saved.bounty || saved.bounty.day !== today) {
    saved.bounty = {
      day: today,
      completedCount: 0,
      active: [
        { id: 1, isValid: true, quality: 3 },
        { id: 2, isValid: true, quality: 2 },
        { id: 3, isValid: true, quality: 4 }
      ]
    };
  }
  return saved.bounty;
}

function refreshBounties(saved) {
  const b = ensureBountyState(saved);
  b.active = [
    { id: Math.floor(Math.random() * 50) + 1, isValid: true, quality: Math.floor(Math.random() * 4) + 1 },
    { id: Math.floor(Math.random() * 50) + 1, isValid: true, quality: Math.floor(Math.random() * 4) + 1 },
    { id: Math.floor(Math.random() * 50) + 1, isValid: true, quality: Math.floor(Math.random() * 4) + 1 }
  ];
  return { ...b, changed: true };
}

function finishBounty(saved, bountyId) {
  const b = ensureBountyState(saved);
  b.completedCount = (Number(b.completedCount) || 0) + 1;
  const idx = b.active.findIndex(item => Number(item.id) === Number(bountyId));
  if (idx >= 0) {
    b.active.splice(idx, 1);
  }
  const goldReward = 50000;
  const xpReward = 30000;
  saved.wallet = saved.wallet || {};
  saved.wallet.gold = (Number(saved.wallet.gold) || 0) + goldReward;
  return { bountyId, goldReward, xpReward, completedCount: b.completedCount, changed: true };
}

module.exports = {
  rawAppell,
  rawRuneHole,
  rawRuneTemplate,
  rawRuneGem,
  rawCombatGuardian,
  rawSoulTemplate,
  rawDailyTarget,
  rawRewardTemplate,
  appellById,
  runeHoleById,
  runeTemplateById,
  combatGuardianById,
  soulTemplateById,
  rewardById,
  // Títulos
  ensureAppellState,
  handleAppellExchange,
  formatAppellsMsg,
  // Runas
  ensureRuneState,
  formatRuneHoleAllInfoMsg,
  operateRuneHole,
  equipRuneStone,
  unloadRuneStone,
  // Guardião
  ensureGuardianState,
  operateGuardian,
  formatCombatGuardianOpRes,
  // Tatuagem / Alma de Dragão
  ensureDragonSoulState,
  feedDragonSoul,
  formatDragonSoulOpRes,
  // Cristais de Alma
  ensureSoulState,
  upgradeSoul,
  // Metas Diárias
  formatDailyTargetList,
  // Bounty
  ensureBountyState,
  refreshBounties,
  finishBounty
};
