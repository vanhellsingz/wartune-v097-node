'use strict';

const fs = require('fs');
const path = require('path');
const questState = require('./quest-state');
const castleState = require('./castle-state');

const configRoot = path.resolve(__dirname, '../res/release/config');

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

const pawnTemplates = new Map(loadCatalog('t_s_pawntemplate').map(p => [Number(p.TemplateId), p]));
const buildingTemplates = new Map(loadCatalog('t_s_buildingtemplate').map(b => [Number(b.TemplateId), b]));
const upgradeTemplates = new Map(loadCatalog('t_s_upgradetemplate').map(u => [`${u.Types}_${u.TemplateId}`, u]));

const BASE_TROOPS = [
  { sonType: 101, templateId: 10101, reqBuilding: 40201 }, // Lanceiro (Quartel Nv 1)
  { sonType: 102, templateId: 10201, reqBuilding: 40204 }, // Caçador (Quartel Nv 4)
  { sonType: 103, templateId: 10301, reqBuilding: 40220 }, // Paladino (Quartel Nv 20)
  { sonType: 104, templateId: 10401, reqBuilding: 40230 }, // Grifo (Quartel Nv 30)
  { sonType: 105, templateId: 10501, reqBuilding: 40220 }, // Sacerdote (Quartel Nv 20)
  { sonType: 106, templateId: 10601, reqBuilding: 40240 }, // Cavaleiro (Quartel Nv 40)
  { sonType: 107, templateId: 10701, reqBuilding: 40240 }, // Anjo (Quartel Nv 40)
  { sonType: 108, templateId: 10801, reqBuilding: 40250 }, // Templário (Quartel Nv 50)
  { sonType: 109, templateId: 10901, reqBuilding: 40250 }, // Bruxo (Quartel Nv 50)
  { sonType: 110, templateId: 11001, reqBuilding: 40270 }, // Cavaleiro Demônio (Quartel Nv 70)
  { sonType: 111, templateId: 11101, reqBuilding: 40270 }  // Anjo Demônio (Quartel Nv 70)
];

function formatNow() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Cria o vetor canônico de 6 atributos pawnLive exigido pelo cliente LayaAir (readArmyPawnInfo e readPawnInfo).
 * Impede que a iteração de 0 a 5 dispare TypeError ao acessar .bag_Data, eliminando o travamento em "Preparing data 0%".
 */
function makeDefaultPawnLive() {
  return [0, 1, 2, 3, 4, 5].map(() => ({
    tempData: 0,
    effect_Per: 0,
    effect_Data: 0,
    bag_Per: 0,
    bag_Data: 0,
    star_Per: 0,
    star_Data: 0,
    skill_Per: 0,
    skill_Data: 0
  }));
}

/**
 * Garante e inicializa a estrutura de tropas/exército no state_json com sanitização automática.
 */
function ensureArmyPawns(savedState) {
  if (!savedState || typeof savedState !== 'object') savedState = {};
  if (!savedState.army || typeof savedState.army !== 'object') {
    savedState.army = {
      pawns: {},
      formation: { 0: 101 },
      autoRecruit: false
    };
  }
  if (!savedState.army.pawns || typeof savedState.army.pawns !== 'object') {
    savedState.army.pawns = {};
  }
  if (!savedState.army.formation || typeof savedState.army.formation !== 'object') {
    savedState.army.formation = { 0: 101 };
  }

  // Inicializa o catálogo base de tropas no quartel do jogador
  for (const b of BASE_TROOPS) {
    const sType = Number(b.sonType);
    if (!savedState.army.pawns[sType]) {
      savedState.army.pawns[sType] = {
        id: sType,
        sonType: sType,
        templateId: Number(b.templateId),
        ownPawns: 0,
        sites: (sType === 101 ? 0 : -1),
        fightPos: (sType === 101 ? 1 : 0),
        createdDate: formatNow(),
        updatedDate: formatNow()
      };
    } else {
      const p = savedState.army.pawns[sType];
      p.sonType = sType;
      p.templateId = Number(p.templateId || b.templateId);
      p.ownPawns = Number(p.ownPawns || 0);
      if (sType === 101 && (p.sites === undefined || p.sites < 0)) {
        p.sites = 0;
        p.fightPos = 1;
      }
    }
  }

  return savedState;
}

function getPawnTemplate(templateId) {
  return pawnTemplates.get(Number(templateId)) || null;
}

function getTotalPawnsCount(savedState) {
  const state = ensureArmyPawns(savedState);
  let total = 0;
  for (const p of Object.values(state.army.pawns)) {
    total += Number(p.ownPawns || 0);
  }
  return total;
}

/**
 * Recruta tropas no Quartel (Opcode C2S 5155 / U_C_ARMY_RECRUITED)
 */
function recruitPawn(savedState, templateId, count = 1) {
  const state = ensureArmyPawns(savedState);
  const tId = Number(templateId);
  const recruitCount = Number(count);

  if (recruitCount <= 0 || !Number.isSafeInteger(recruitCount)) {
    throw new Error(`Quantidade de recrutamento inválida: ${count}`);
  }

  const template = pawnTemplates.get(tId);
  if (!template) {
    throw new Error(`Template de tropa ${tId} não encontrado no catálogo`);
  }

  // 1. Validação de Edifício de Pré-requisito (Ex: Quartel 40201)
  const reqBuildingId = Number(template.NeedBuilding || 0);
  if (reqBuildingId > 0) {
    const reqBuildingTemplate = buildingTemplates.get(reqBuildingId);
    if (reqBuildingTemplate) {
      const castle = castleState.ensureCastleState(state);
      const reqSonType = Number(reqBuildingTemplate.SonType);
      const reqGrade = Number(reqBuildingTemplate.BuildingGrade || 1);
      const playerBuilding = Object.values(castle.castle.buildings).find(b => Number(b.sonType) === reqSonType);
      if (!playerBuilding || Number(playerBuilding.grade) < reqGrade) {
        throw new Error(`Requer ${reqBuildingTemplate.BuildingName_pt || 'Quartel'} nível ${reqGrade} para recrutar esta unidade`);
      }
    }
  }

  // 2. Validação de Capacidade Populacional (Cabanas / Residências)
  const yields = castleState.calculateYields(state);
  const maxPopulation = Number(yields.maxPopulation || 900);
  const currentTotalPawns = getTotalPawnsCount(state);
  const popNeeded = recruitCount * Number(template.NeedPopulation || 1);

  if (currentTotalPawns + popNeeded > maxPopulation) {
    throw new Error(`Capacidade populacional insuficiente: requer ${popNeeded} vagas (atual: ${currentTotalPawns}/${maxPopulation})`);
  }

  // 3. Validação e Dedução de Ouro
  const unitGoldCost = Number(template.GoldConsume || 0);
  const totalGoldCost = unitGoldCost * recruitCount;

  if (!state.wallet) state.wallet = { gold: 0, balens: 0, boundBalens: 0 };
  const currentGold = Number(state.wallet.gold || 0);
  if (currentGold < totalGoldCost) {
    throw new Error(`Ouro insuficiente para recrutamento: requer ${totalGoldCost} Ouro (possui ${currentGold})`);
  }

  // Aplica dedução de ouro
  state.wallet.gold = currentGold - totalGoldCost;

  // 4. Registra ou incrementa o batalhão da tropa
  const sonType = Number(template.SonType);
  if (!state.army.pawns[sonType]) {
    state.army.pawns[sonType] = {
      id: sonType,
      sonType: sonType,
      templateId: tId,
      ownPawns: 0,
      sites: (sonType === 101 ? 0 : -1),
      fightPos: (sonType === 101 ? 1 : 0),
      createdDate: formatNow()
    };
  }

  const pawnEntry = state.army.pawns[sonType];
  pawnEntry.templateId = tId;
  pawnEntry.ownPawns = Number(pawnEntry.ownPawns || 0) + recruitCount;
  pawnEntry.updatedDate = formatNow();

  // Se a tropa for Lanceiro e não houver tropa alocada no slot 0, aloca automaticamente
  if (sonType === 101 && (!state.army.formation || state.army.formation[0] === undefined)) {
    state.army.formation[0] = 101;
    pawnEntry.sites = 0;
    pawnEntry.fightPos = 1;
  }

  // 5. Integração com Sistema de Missões (Ex: Missão 52 - Recrutar 200 Lanceiros)
  const questResult = questState.onRecruitPawn(state, sonType, recruitCount, pawnEntry.ownPawns);

  return {
    state,
    pawn: template,
    recruitCount,
    totalOwnPawns: pawnEntry.ownPawns,
    goldCost: totalGoldCost,
    remainingGold: state.wallet.gold,
    currentPopulation: currentTotalPawns + popNeeded,
    maxPopulation,
    questsChanged: questResult.changed,
    updatedQuests: questResult.updatedQuests
  };
}

/**
 * Dispensa tropas para liberar população
 */
function dismissPawn(savedState, sonType, count = 1) {
  const state = ensureArmyPawns(savedState);
  const sType = Number(sonType);
  const dismissCount = Number(count);
  const pawnEntry = state.army.pawns[sType];

  if (!pawnEntry || Number(pawnEntry.ownPawns || 0) < dismissCount) {
    throw new Error(`Tropas insuficientes para dispensa: possui ${pawnEntry?.ownPawns || 0}`);
  }

  pawnEntry.ownPawns -= dismissCount;
  return {
    state,
    dismissedCount: dismissCount,
    remainingPawns: pawnEntry.ownPawns
  };
}

/**
 * Formata apenas as tropas alocadas na formação do herói (slots 0 e 1).
 * Essencial para ArmyMsg (150) e ArmyUpdatedGridMsg (169), garantindo que
 * getPawnByIndex(sites) nunca acerte índice inexistente (> 1) no cliente LayaAir.
 */
function formatHeroArmyPawns(savedState, armyId = 0) {
  const state = ensureArmyPawns(savedState);
  const aId = Number(armyId) || 0;
  const deployed = [];

  for (const slot of [0, 1]) {
    const sonType = state.army.formation?.[slot];
    if (sonType && state.army.pawns[sonType]) {
      const p = state.army.pawns[sonType];
      deployed.push({
        id: slot + 1,
        armyId: aId,
        sites: slot,
        sonType: Number(p.sonType),
        tempateId: Number(p.templateId),
        ownPawns: Number(p.ownPawns || 0),
        pawnLive: makeDefaultPawnLive(),
        fightPos: Number(p.fightPos || (slot === 0 ? 1 : 2)),
        specialTempIds: '',
        comprehednTempIds: '',
        blessNum: Number(p.blessNum || 0)
      });
    }
  }

  return deployed;
}

/**
 * Formata lista completa de tropas do Quartel para o protocolo S2C 92 / 100 (ArmyPawnUpdatedMsg).
 * Informa o catálogo completo ao cliente para que canRecruit seja desbloqueado em todos os soldados disponíveis.
 */
function formatArmyPawnUpdatedMsg(savedState, armyId = 0) {
  const state = ensureArmyPawns(savedState);
  const aId = Number(armyId) || 0;

  const armyPawn = Object.values(state.army.pawns).map((p, idx) => ({
    id: idx + 1,
    armyId: aId,
    sites: Number(p.sites !== undefined ? p.sites : 0),
    sonType: Number(p.sonType),
    tempateId: Number(p.templateId), // Grafia oficial do Protobuf
    ownPawns: Number(p.ownPawns || 0),
    pawnLive: makeDefaultPawnLive(),
    fightPos: Number(p.fightPos || 1),
    specialTempIds: '',
    comprehednTempIds: '',
    blessNum: Number(p.blessNum || 0)
  }));

  return {
    armyPawn
  };
}

/**
 * Melhora tropa para o próximo nível (Opcode C2S 5158 / U_C_ARMY_UPGRADEPAWN)
 */
function upgradePawn(savedState, templateId) {
  const state = ensureArmyPawns(savedState);
  const tId = Number(templateId);
  const currentTemplate = pawnTemplates.get(tId);
  if (!currentTemplate) {
    throw new Error(`Template de tropa ${tId} não encontrado no catálogo`);
  }

  const nextTemplateId = Number(currentTemplate.NextLevelTemplateId || 0);
  if (!nextTemplateId) {
    throw new Error(`Tropa ${tId} já está no nível máximo`);
  }

  const nextTemplate = pawnTemplates.get(nextTemplateId);
  if (!nextTemplate) {
    throw new Error(`Próximo nível de tropa ${nextTemplateId} não encontrado no catálogo`);
  }

  // 1. Validação do Nível do Quartel (Edifício SonType 402)
  const barracksBuilding = castleState.getBuildingBySonType(state, 402);
  const barracksGrade = Number(barracksBuilding?.grade || 1);
  if (Number(nextTemplate.Level || 1) > barracksGrade) {
    throw new Error(`Requer Quartel nível ${nextTemplate.Level} para evoluir esta tropa (Quartel atual: nível ${barracksGrade})`);
  }

  // 2. Validação e Dedução de Custo (Ouro / Alma do catálogo t_s_upgradetemplate)
  const upgKey = `1_${nextTemplateId}`;
  const upgTpl = upgradeTemplates.get(upgKey);
  const cost = upgTpl ? Number(upgTpl.Data || 0) : 0;

  if (!state.wallet) state.wallet = { gold: 0, balens: 0, boundBalens: 0 };
  const currentGold = Number(state.wallet.gold || 0);
  if (cost > 0 && currentGold < cost) {
    throw new Error(`Ouro/Daru insuficiente para evolução: requer ${cost} (possui ${currentGold})`);
  }

  if (cost > 0) {
    state.wallet.gold = currentGold - cost;
  }

  const sonType = Number(currentTemplate.SonType);
  if (!state.army.pawns[sonType]) {
    state.army.pawns[sonType] = {
      id: sonType,
      sonType: sonType,
      templateId: tId,
      ownPawns: 0,
      sites: (sonType === 101 ? 0 : -1),
      fightPos: (sonType === 101 ? 1 : 0),
      createdDate: formatNow()
    };
  }

  const pawnEntry = state.army.pawns[sonType];
  pawnEntry.templateId = nextTemplateId;
  pawnEntry.updatedDate = formatNow();

  // Integração com Missões (Ex: Missão 101 - Melhorar Lanceiro)
  const questResult = questState.onPawnUpgrade(state, sonType, nextTemplate.Level, nextTemplateId);

  return {
    state,
    sonType,
    oldTemplate: currentTemplate,
    newTemplate: nextTemplate,
    newLevel: nextTemplate.Level,
    newTemplateId: nextTemplateId,
    goldCost: cost,
    remainingGold: state.wallet.gold,
    questsChanged: questResult.changed,
    updatedQuests: questResult.updatedQuests
  };
}

/**
 * Ajusta formação / posicionamento de tropas (Opcode C2S 5156 / 93 U_C_ARMY_EDIT)
 */
function editArmyPawn(savedState, sites, templateId, count) {
  const state = ensureArmyPawns(savedState);
  const tId = Number(templateId);
  const s = Number(sites !== undefined ? sites : 0);
  const c = Number(count || 0);

  const template = pawnTemplates.get(tId);
  const sonType = template ? Number(template.SonType) : 101;

  if (!state.army.formation) state.army.formation = {};
  state.army.formation[s] = sonType;

  if (!state.army.pawns[sonType]) {
    state.army.pawns[sonType] = {
      id: sonType,
      sonType: sonType,
      templateId: tId,
      ownPawns: c,
      sites: s,
      fightPos: (s === 0 ? 1 : 2),
      createdDate: formatNow(),
      updatedDate: formatNow()
    };
  } else {
    const p = state.army.pawns[sonType];
    p.templateId = tId;
    p.sites = s;
    p.fightPos = (s === 0 ? 1 : 2);
    if (c > 0) p.ownPawns = c;
    p.updatedDate = formatNow();
  }

  // Notificar sistema de missões para formação ajustada
  const questResult = questState.onPositionPawn(state);

  return {
    state,
    sonType,
    templateId: tId,
    sites: s,
    ownPawns: state.army.pawns[sonType].ownPawns,
    questsChanged: questResult.changed,
    updatedQuests: questResult.updatedQuests
  };
}

/**
 * Retorna tabela completa de escalonamento dinâmico (Níveis 1 a 80) de uma tropa específica.
 */
function getTroopScalingTable(sonType) {
  const sType = Number(sonType);
  const levels = [];
  let pawnName = '';

  for (let lv = 1; lv <= 80; lv++) {
    const tId = sType * 100 + lv;
    const t = pawnTemplates.get(tId);
    if (!t) continue;
    if (!pawnName) pawnName = t.PawnName_pt || t.PawnName_en || `Tropa ${sType}`;

    const upgKey = `1_${tId}`;
    const upg = upgradeTemplates.get(upgKey);
    const upgradeCost = upg ? Number(upg.Data || 0) : 0;
    const reqBuildingId = Number(t.NeedBuilding || 0);
    const barracksGrade = reqBuildingId % 100;

    levels.push({
      level: lv,
      templateId: tId,
      attack: Number(t.Attack || 0),
      defence: Number(t.Defence || 0),
      magicDefence: Number(t.MagicDefence || 0),
      live: Number(t.Live || 0),
      maxHp: Math.max(100, Number(t.Live || 0) * 10),
      needBuilding: reqBuildingId,
      barracksGrade: barracksGrade,
      goldConsume: Number(t.GoldConsume || 0),
      upgradeCost: upgradeCost,
      needPopulation: Number(t.NeedPopulation || 1)
    });
  }

  return {
    sonType: sType,
    pawnName,
    maxLevel: levels.length,
    levels
  };
}

/**
 * Consulta atributos dinâmicos de qualquer tropa em qualquer nível (1 a 80).
 */
function getTroopAttributes(sonType, level) {
  const tId = Number(sonType) * 100 + Number(level);
  const t = pawnTemplates.get(tId);
  if (!t) return null;

  const upgKey = `1_${tId}`;
  const upg = upgradeTemplates.get(upgKey);
  const upgradeCost = upg ? Number(upg.Data || 0) : 0;

  return {
    templateId: tId,
    sonType: Number(sonType),
    level: Number(level),
    attack: Number(t.Attack || 0),
    defence: Number(t.Defence || 0),
    magicDefence: Number(t.MagicDefence || 0),
    live: Number(t.Live || 0),
    maxHp: Math.max(100, Number(t.Live || 0) * 10),
    needBuilding: Number(t.NeedBuilding || 0),
    upgradeCost
  };
}

/**
 * Escala uma tropa diretamente para um nível alvo (1 a 80) em um único passo atômico,
 * aplicando fórmula de progressão e sincronizando com contratos e missões.
 */
function scaleTroopToLevel(savedState, sonType, targetLevel) {
  const state = ensureArmyPawns(savedState);
  const sType = Number(sonType);
  const lv = Math.max(1, Math.min(80, Number(targetLevel || 1)));
  const tId = sType * 100 + lv;

  const template = pawnTemplates.get(tId);
  if (!template) {
    throw new Error(`Template de tropa ${tId} não encontrado no catálogo para o nível ${lv}`);
  }

  if (!state.army.pawns[sType]) {
    state.army.pawns[sType] = {
      id: sType,
      sonType: sType,
      templateId: tId,
      ownPawns: 0,
      sites: (sType === 101 ? 0 : -1),
      fightPos: (sType === 101 ? 1 : 0),
      createdDate: formatNow()
    };
  }

  const pawnEntry = state.army.pawns[sType];
  pawnEntry.templateId = tId;
  pawnEntry.updatedDate = formatNow();

  // Aciona evento de missão se houver
  const questResult = questState.onPawnUpgrade(state, sType, lv, tId);

  return {
    state,
    sonType: sType,
    level: lv,
    templateId: tId,
    attributes: getTroopAttributes(sType, lv),
    questsChanged: questResult.changed,
    updatedQuests: questResult.updatedQuests
  };
}

/**
 * Escala em lote TODAS as 11 tropas jogáveis do Quartel para o nível desejado (1 a 80)
 * sem necessidade de laço ou testes manuais nível a nível.
 */
function scaleAllTroopsToLevel(savedState, targetLevel) {
  const state = ensureArmyPawns(savedState);
  const lv = Math.max(1, Math.min(80, Number(targetLevel || 1)));
  const results = [];

  for (const b of BASE_TROOPS) {
    const sType = Number(b.sonType);
    const res = scaleTroopToLevel(state, sType, lv);
    results.push(res);
  }

  return {
    state,
    level: lv,
    troopsScaled: results.length,
    troops: results
  };
}

/**
 * Formata resposta para o protocolo S2C 93 / 5156 (ArmyEditRspMsg)
 */
function formatArmyEditRspMsg(savedState, armyId = 0) {
  return {
    armyPawn: formatHeroArmyPawns(savedState, armyId)
  };
}

module.exports = {
  BASE_TROOPS,
  makeDefaultPawnLive,
  getTemplate: getPawnTemplate,
  ensureArmyPawns,
  getTotalPawnsCount,
  recruitPawn,
  dismissPawn,
  upgradePawn,
  editArmyPawn,
  getTroopScalingTable,
  getTroopAttributes,
  scaleTroopToLevel,
  scaleAllTroopsToLevel,
  formatHeroArmyPawns,
  formatArmyEditRspMsg,
  formatArmyPawnUpdatedMsg
};
