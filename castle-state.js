'use strict';

const fs = require('fs');
const path = require('path');
const questState = require('./quest-state');

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

const buildingTemplates = new Map(loadCatalog('t_s_buildingtemplate').map(b => [Number(b.TemplateId), b]));

function formatNow() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Garante e inicializa a estrutura do castelo do jogador no state_json
 */
function ensureCastleState(savedState, playerGrade = 1) {
  if (!savedState || typeof savedState !== 'object') savedState = {};
  if (!savedState.castle || typeof savedState.castle !== 'object') {
    savedState.castle = {
      castleId: 1,
      name: 'Castelo Real',
      createdDate: formatNow(),
      buildings: {}
    };
  }
  if (!savedState.castle.buildings || typeof savedState.castle.buildings !== 'object') {
    savedState.castle.buildings = {};
  }

  const hasAdvancedBuildings = Boolean(savedState.castle?.buildings && Object.keys(savedState.castle.buildings).length > 5);
  const pGrade = Number(playerGrade || savedState.grade || savedState.progression?.grade || savedState.progression?.level || (hasAdvancedBuildings ? 80 : 1));

  // Layout canônico de edifícios iniciais
  // Edifícios 1 a 5 disponíveis desde o início.
  // Edifício 6 (Academia / Seminário sonType 501) e 7 a 17 (Tecnologias) exigem ESTRITAMENTE Nível 18!
  const basicLayout = [
    { buildingId: 1, sonType: 901, templateId: 90101, grade: 1 },  // Prefeitura
    { buildingId: 2, sonType: 101, templateId: 10101, grade: 1 },  // Refinaria de Ouro
    { buildingId: 3, sonType: 301, templateId: 30101, grade: 1 },  // Tesouraria / Armazém
    { buildingId: 4, sonType: 1201, templateId: 120101, grade: 1 }, // Cabana / Residência
    { buildingId: 5, sonType: 402, templateId: 40201, grade: 1 }   // Quartel / Caserna
  ];

  const academyLayout = [
    { buildingId: 6, sonType: 501, templateId: 50101, grade: 1 }   // Academia / Seminário (Nv. 18+)
  ];

  const defaultTechLayout = [
    { buildingId: 7, sonType: 1304, templateId: 130400, grade: 0 },  // Produção de Ouro
    { buildingId: 8, sonType: 1420, templateId: 142000, grade: 0 },  // PV da Tropa
    { buildingId: 9, sonType: 1421, templateId: 142100, grade: 0 },  // ATQ da Tropa
    { buildingId: 10, sonType: 1423, templateId: 142300, grade: 0 }, // ATQM da Tropa
    { buildingId: 11, sonType: 1424, templateId: 142400, grade: 0 }, // DEFM da Tropa
    { buildingId: 12, sonType: 1441, templateId: 144100, grade: 0 }, // ATQ de Herói
    { buildingId: 13, sonType: 1442, templateId: 144200, grade: 0 }, // ATQM de Herói
    { buildingId: 14, sonType: 1443, templateId: 144300, grade: 0 }, // DEF de Herói
    { buildingId: 15, sonType: 1444, templateId: 144400, grade: 0 }, // DEFM de Herói
    { buildingId: 16, sonType: 1445, templateId: 144500, grade: 0 }, // PV do Herói
    { buildingId: 17, sonType: 1446, templateId: 144600, grade: 0 }  // Volume de Tropas
  ];

  const advancedTechLayout = [
    { buildingId: 18, sonType: 2304, templateId: 230400, grade: 0 }, // Produção de Ouro Avanç.
    { buildingId: 19, sonType: 2420, templateId: 242000, grade: 0 }, // PV de Tropa Avanç.
    { buildingId: 20, sonType: 2421, templateId: 242100, grade: 0 }, // ATQ de Tropa Avanç.
    { buildingId: 21, sonType: 2422, templateId: 242200, grade: 0 }, // DEF de Tropa Avanç.
    { buildingId: 22, sonType: 2423, templateId: 242300, grade: 0 }, // ATQM de Tropa Avanç.
    { buildingId: 23, sonType: 2424, templateId: 242400, grade: 0 }, // DEFM de Tropa Avanç.
    { buildingId: 24, sonType: 2441, templateId: 244100, grade: 0 }, // ATQ de Herói Avanç.
    { buildingId: 25, sonType: 2442, templateId: 244200, grade: 0 }, // ATQM de Herói Avanç.
    { buildingId: 26, sonType: 2443, templateId: 244300, grade: 0 }, // DEF de Herói Avanç.
    { buildingId: 27, sonType: 2444, templateId: 244400, grade: 0 }, // DEFM de Herói Avanç.
    { buildingId: 28, sonType: 2445, templateId: 244500, grade: 0 }, // PV de Herói Avanç.
    { buildingId: 29, sonType: 2446, templateId: 244600, grade: 0 }  // Volume de Tropas Avanç.
  ];

  if (!savedState.castle.technologies) savedState.castle.technologies = {};

  // Se player < 18 (e nao possuir edifícios avançados previamente estabelecidos), remove QUALQUER resquício de Academia ou Tecnologia do castle.buildings
  if (pGrade < 18 && !hasAdvancedBuildings) {
    for (const key of Object.keys(savedState.castle.buildings)) {
      const b = savedState.castle.buildings[key];
      if (!b) continue;
      const bId = Number(b.buildingId);
      const sType = Number(b.sonType);
      if (bId >= 6 || sType === 501 || [1304, 1420, 1421, 1422, 1423, 1424, 1441, 1442, 1443, 1444, 1445, 1446, 2304, 2420, 2421, 2422, 2423, 2424, 2441, 2442, 2443, 2444, 2445, 2446].includes(sType)) {
        delete savedState.castle.buildings[key];
      }
    }
  }

  let allowedLayout = basicLayout;
  if (pGrade >= 18) {
    allowedLayout = [...allowedLayout, ...academyLayout, ...defaultTechLayout];
  }
  if (pGrade >= 50) {
    allowedLayout = [...allowedLayout, ...advancedTechLayout];
  }

  for (const b of allowedLayout) {
    if (!savedState.castle.buildings[b.buildingId] && !savedState.castle.buildings[String(b.buildingId)]) {
      const existingGrade = Number(savedState.castle.technologies[b.sonType] || b.grade || 0);
      const effectiveTemplateId = (b.buildingId >= 7 && existingGrade > 0)
        ? (b.sonType * 100 + existingGrade)
        : b.templateId;
      const t = buildingTemplates.get(effectiveTemplateId) || buildingTemplates.get(b.templateId);
      const isPrefeitura = (b.sonType === 901);
      savedState.castle.buildings[b.buildingId] = {
        buildingId: b.buildingId,
        sonType: b.sonType,
        templateId: effectiveTemplateId,
        grade: existingGrade,
        property1: isPrefeitura ? 0 : (t ? Number(t.Property1 || 0) : 0),
        property2: isPrefeitura ? 30 : (t ? Number(t.Property2 || 0) : 0),
        levyNum: 0,
        createdDate: formatNow(),
        updatedDate: formatNow()
      };
    }
  }

  const pref = Object.values(savedState.castle.buildings).find(b => Number(b.sonType) === 901);
  if (pref) {
    if (pref.property1 === undefined || pref.property1 === null || pref.property1 > 30) {
      pref.property1 = 0;
    }
    if (!pref.property2 || pref.property2 !== 30) pref.property2 = 30;
    if (pref.levyNum === undefined || pref.levyNum === null) pref.levyNum = 0;
  }

  return savedState;
}

function getBuildingTemplate(templateId) {
  return buildingTemplates.get(Number(templateId)) || null;
}

function getBuilding(savedState, buildingId) {
  const state = ensureCastleState(savedState);
  return state.castle.buildings[buildingId] || null;
}

function getBuildingBySonType(savedState, sonType) {
  const state = ensureCastleState(savedState);
  return Object.values(state.castle.buildings).find(b => Number(b.sonType) === Number(sonType)) || null;
}

/**
 * Calcula rendimentos e capacidades em tempo real com base nos edifícios
 */
function calculateYields(savedState) {
  const state = ensureCastleState(savedState);
  let goldYield = 0;
  let goldMax = 1250000; // Valor padrão base
  let maxPopulation = 900; // Valor padrão base
  let curPopulation = 100;

  for (const b of Object.values(state.castle.buildings)) {
    const t = buildingTemplates.get(Number(b.templateId));
    if (!t) continue;

    // Refinaria de Ouro (SonType 101): Property1 = ouro/hora
    if (b.sonType === 101) {
      goldYield += Number(t.Property1 || 0);
    }
    // Tesouraria / Armazém (SonType 301): Property2 = capacidade máxima de ouro
    else if (b.sonType === 301) {
      const cap = Number(t.Property2 || 0);
      if (cap > 0) goldMax = cap;
    }
    // Cabana / Residência (SonType 1201): Property2 = capacidade populacional
    else if (b.sonType === 1201) {
      const pop = Number(t.Property2 || 0);
      if (pop > 0) maxPopulation = pop;
    }
  }

  const goldTotalCount = Number(state.wallet?.gold || 0);
  const crystalsCount = Number(state.wallet?.crystals || 0);

  return {
    goldYield,
    goldTotalCount,
    goldMax,
    curPopulation,
    maxPopulation,
    crystalsCount
  };
}

/**
 * Executa a melhoria de um edifício (Opcode C2S 8203)
 */
function upgradeBuilding(savedState, buildingId, playerLevel = 5) {
  const pLevel = Number(playerLevel || 1);
  const state = ensureCastleState(savedState, pLevel);
  const bId = Number(buildingId);
  const building = state.castle.buildings[bId];

  if (!building) {
    if ((bId === 6 || bId >= 7) && pLevel < 18) {
      throw new Error(`A Academia e suas tecnologias exigem Nível 18 (nível atual: ${pLevel})`);
    }
    throw new Error(`Edifício com ID ${bId} não encontrado no castelo`);
  }

  // Trava estrita de Nível 18 para Academia (501) e Tecnologias Básicas
  if ((bId === 6 || (bId >= 7 && bId <= 17) || Number(building.sonType) === 501 || [1304, 1420, 1421, 1422, 1423, 1424, 1441, 1442, 1443, 1444, 1445, 1446].includes(Number(building.sonType))) && pLevel < 18) {
    throw new Error(`A Academia e suas tecnologias exigem Nível 18 (nível atual: ${pLevel})`);
  }
  // Trava estrita de Nível 50 para Tecnologias Avançadas
  if ((bId >= 18 || [2304, 2420, 2421, 2422, 2423, 2424, 2441, 2442, 2443, 2444, 2445, 2446].includes(Number(building.sonType))) && pLevel < 50) {
    throw new Error(`As tecnologias avançadas exigem Nível 50 (nível atual: ${pLevel})`);
  }

  const currentTemplate = buildingTemplates.get(Number(building.templateId));
  if (!currentTemplate) {
    throw new Error(`Template atual ${building.templateId} não existe no catálogo`);
  }

  const nextTemplateId = Number(currentTemplate.NextGradeTemplateId);
  if (!nextTemplateId || nextTemplateId === 0) {
    throw new Error(`Edifício já atingiu o nível máximo (${building.grade})`);
  }

  const nextTemplate = buildingTemplates.get(nextTemplateId);
  if (!nextTemplate) {
    throw new Error(`Próximo template ${nextTemplateId} não encontrado no catálogo`);
  }

  // 1. Validação de Nível do Jogador
  const reqPlayerGrade = Number(nextTemplate.PlayerGrades || 1);
  if (playerLevel < reqPlayerGrade) {
    throw new Error(`Nível insuficiente: requer personagem nível ${reqPlayerGrade}`);
  }

  // 2. Validação de Ouro
  const goldCost = Number(nextTemplate.GoldConsume || 0);
  if (!state.wallet) state.wallet = { gold: 0, balens: 0, boundBalens: 0 };
  const currentGold = Number(state.wallet.gold || 0);
  if (currentGold < goldCost) {
    throw new Error(`Ouro insuficiente: requer ${goldCost} Ouro (possui ${currentGold})`);
  }

  // 3. Validação de Pré-requisitos (PreTemplateId)
  if (nextTemplate.PreTemplateId && String(nextTemplate.PreTemplateId).trim() !== '' && nextTemplate.PreTemplateId !== '0') {
    const preTId = Number(nextTemplate.PreTemplateId);
    const preTemplate = buildingTemplates.get(preTId);
    if (preTemplate) {
      const requiredSonType = Number(preTemplate.SonType);
      const requiredGrade = Number(preTemplate.BuildingGrade || 1);
      const prereqBuilding = Object.values(state.castle.buildings).find(b => Number(b.sonType) === requiredSonType);
      if (!prereqBuilding || Number(prereqBuilding.grade) < requiredGrade) {
        const reqName = preTemplate.BuildingName_pt || preTemplate.BuildingName_en || `Edifício ${requiredSonType}`;
        throw new Error(`Pré-requisito não atendido: requer ${reqName} nível ${requiredGrade}`);
      }
    }
  }

  // 4. Aplica Dedução de Recursos
  state.wallet.gold = currentGold - goldCost;

  // 5. Atualiza o Edifício
  building.templateId = nextTemplate.TemplateId;
  building.grade = Number(nextTemplate.BuildingGrade || (building.grade + 1));
  building.property1 = Number(nextTemplate.Property1 || 0);
  building.property2 = Number(nextTemplate.Property2 || 0);
  building.updatedDate = formatNow();

  if (!state.castle.technologies) state.castle.technologies = {};
  if (bId >= 7 || [1304, 1420, 1421, 1422, 1423, 1424, 1441, 1442, 1443, 1444, 1445, 1446, 2304, 2420, 2421, 2422, 2423, 2424, 2441, 2442, 2443, 2444, 2445, 2446].includes(Number(building.sonType))) {
    state.castle.technologies[building.sonType] = building.grade;
  }

  // 6. Atualiza Rendimentos
  const yields = calculateYields(state);

  // 7. Notifica Sistema de Missões (Ex: Missão 51 - Melhorar Prefeitura para Nv. 5)
  const questResult = questState.onBuildingUpgrade(state, building.sonType, building.grade);

  return {
    state,
    building: { ...building },
    grade: Number(building.grade),
    nextTemplate,
    goldCost,
    remainingGold: state.wallet.gold,
    yields,
    questsChanged: questResult.changed,
    updatedQuests: questResult.updatedQuests
  };
}

/**
 * Formata lista completa de edifícios para o protocolo 4130 / 4154 (BuildingInfoListMsg)
 */
function formatBuildingListMsg(savedState, userId, playerGrade) {
  const pGrade = Number(playerGrade || savedState?.grade || savedState?.progression?.level || 1);
  const state = ensureCastleState(savedState, pGrade);
  const uId = Number(userId) || 0;

  const buildings = Object.values(state.castle.buildings)
    .filter(b => {
      const bId = Number(b.buildingId);
      const sType = Number(b.sonType);
      if (pGrade < 18) {
        if (bId >= 6 || sType === 501 || [1304, 1420, 1421, 1422, 1423, 1424, 1441, 1442, 1443, 1444, 1445, 1446, 2304, 2420, 2421, 2422, 2423, 2424, 2441, 2442, 2443, 2444, 2445, 2446].includes(sType)) {
          return false;
        }
      }
      if (pGrade < 50) {
        if (bId >= 18 || [2304, 2420, 2421, 2422, 2423, 2424, 2441, 2442, 2443, 2444, 2445, 2446].includes(sType)) {
          return false;
        }
      }
      return true;
    })
    .map(b => ({
      userId: uId,
      buildingId: Number(b.buildingId),
      castleId: Number(state.castle.castleId || 1),
      createdDate: b.createdDate || formatNow(),
      isExist: true,
      templateId: Number(b.templateId),
      sonType: Number(b.sonType),
      propterty1: Number(b.property1 || 0),
      propterty2: Number(b.property2 || 0),
      levyNum: Number(b.levyNum || 0)
    }));

  return {
    result: true,
    building: buildings
  };
}

/**
 * Formata pacote de rendimento para o protocolo 109 (CastleYieldMsg)
 */
function formatCastleYieldMsg(savedState) {
  const yields = calculateYields(savedState);
  return {
    goldYield: yields.goldYield,
    goldWildLandYield: 0,
    goldTechnology: 0,
    goldWonder: 0,
    goldDower: 0,
    goldTotalCount: yields.goldTotalCount,
    goldMax: yields.goldMax,
    curPopulation: yields.curPopulation,
    maxPopulation: yields.maxPopulation,
    wildYield: [],
    crystalsCount: yields.crystalsCount,
    treasureMineYield: []
  };
}

/**
 * Formata fila de construção para o protocolo 4155 / 4187 (BuildOrderList)
 */
function formatBuildOrderListMsg(savedState, userId) {
  const uId = Number(userId) || 0;
  return {
    buildOrder: [
      { orderId: 1, orderType: 1, remainTime: 0, userId: uId, beginTime: formatNow(), needTime: 0 },
      { orderId: 2, orderType: 1, remainTime: 0, userId: uId, beginTime: formatNow(), needTime: 0 },
      { orderId: 3, orderType: 2, remainTime: 0, userId: uId, beginTime: formatNow(), needTime: 0 },
      { orderId: 4, orderType: 3, remainTime: 0, userId: uId, beginTime: formatNow(), needTime: 0 }
    ]
  };
}

function levyTaxes(savedState, payType = 1) {
  const state = ensureCastleState(savedState);
  const prefeitura = Object.values(state.castle.buildings).find(b => Number(b.sonType) === 901);
  if (!prefeitura) throw new Error('Prefeitura nao encontrada no castelo');
  
  const template = buildingTemplates.get(Number(prefeitura.templateId)) || { Property1: 500 };
  const goldPerLevy = (Number(template.Property1) || 500) * 12;

  let usedLevies = Number(prefeitura.property1 || 0);
  let maxLevies = Number(prefeitura.property2 || 30);
  let payImpose = Number(prefeitura.levyNum || 0);

  if (payType === 0) {
    state.wallet = state.wallet || { gold: 0, balens: 0, boundBalens: 0 };
    const balens = Number(state.wallet.balens || 0);
    const bound = Number(state.wallet.boundBalens || 0);
    if (balens + bound < 10) throw new Error('Diamantes insuficientes para Taxa Extra');
    if (bound >= 10) state.wallet.boundBalens = bound - 10;
    else {
      const rem = 10 - bound;
      state.wallet.boundBalens = 0;
      state.wallet.balens = balens - rem;
    }
    payImpose += 1;
    prefeitura.levyNum = payImpose;
  } else {
    if (usedLevies >= maxLevies) throw new Error('Nao ha arrecadacoes gratuitas restantes hoje');
    usedLevies += 1;
    prefeitura.property1 = usedLevies;
  }

  state.wallet = state.wallet || { gold: 0, balens: 0, boundBalens: 0 };
  state.wallet.gold = (Number(state.wallet.gold) || 0) + goldPerLevy;

  return {
    state,
    usedLevies,
    leftImpose: usedLevies, // No cliente Laya: __levyUpdateHandler atribui i.property1 = e.leftImpose
    maxImpose: maxLevies,
    payImpose,
    goldEarned: goldPerLevy,
    totalGold: state.wallet.gold,
    prefeitura
  };
}

module.exports = {
  getTemplate: getBuildingTemplate,
  ensureCastleState,
  getBuilding,
  getBuildingBySonType,
  calculateYields,
  upgradeBuilding,
  levyTaxes,
  formatBuildingListMsg,
  formatCastleYieldMsg,
  formatBuildOrderListMsg
};
