'use strict';

/**
 * astral-state.js — Sistema Completo de Astrologia (Astrals) de Wartune Ultra
 * Fiel ao Wartune Oficial:
 * - 5 Esferas/Orbes progressivas de iluminação (Custos: 4k, 5k, 6k, 8k, 10k Ouro)
 * - Tabelas oficiais de Drop (19001..19005 de t_s_dropitem) e 76 templates (t_s_startemplate)
 * - Curvas oficiais de EXP (Types 9, 10, 11, 12, 13 do t_s_upgradetemplate)
 * - Inventário (Rm.PLAYER=1), Astrolábio/Drops (Rm.TEMP=0), Equipados no Herói (Rm.THANE=2)
 * - Síntese / Fusão / "Engolir" com soma automática de EXP e subida de nível até o teto
 * - Equipamento com trava por nível (4 a 8 slots) e verificação de tipo único (MasterType)
 * - Cálculo de atributos direto no HeroInfo e Battle Rating (AttributeCalculatorService)
 */

const fs = require('node:fs');
const path = require('node:path');

// Enums oficiais do cliente
const StarBagType = {
  RECYCLE: -1,
  TEMP: 0,
  PLAYER: 1,
  THANE: 2,
  SHOP: 3,
  SYS: 4,
  SUBLIMATION: 5,
  SUBLIMATION_BAG: 6
};

const SPHERE_COSTS = [4000, 5000, 6000, 8000, 10000];
const MAX_TEMP_SLOTS = 16;
const MAX_BAG_SLOTS = 24;
const BASE_EQUIP_SLOTS = 4;
const MAX_EQUIP_SLOTS = 8;
const UNLOCK_BASE_LEVEL = 25;

// Tabelas de EXP por qualidade (Profile) oficial de t_s_upgradetemplate
// Profile 2 (Verde - Type 9)
// Profile 3 (Azul - Type 10)
// Profile 4 (Roxo - Type 11)
// Profile 5 (Laranja - Type 12)
// Profile 6/7 (Vermelho/Dourado - Type 13)
const EXP_CURVES_BY_PROFILE = {
  2: [0, 50, 200, 600, 1200, 2400, 4800, 9600, 19200, 38400],
  3: [0, 70, 500, 1400, 2800, 5600, 11200, 22400, 44800, 89600],
  4: [0, 100, 600, 3000, 6000, 12000, 24000, 48000, 96000, 192000],
  5: [0, 150, 1000, 7200, 14400, 28800, 57600, 115200, 230400, 460800],
  6: [0, 150, 1000, 7200, 14400, 28800, 57600, 115200, 230400, 460800],
  7: [0, 150, 1000, 7200, 14400, 28800, 57600, 115200, 230400, 460800]
};

// Cache de catálogos
let templatesById = new Map();
let dropPoolsBySphere = new Map(); // 0..4 -> array de { itemId, weight }
let sublimationRecipesByMaterial = new Map();
let skillPropertiesById = new Map();

function loadCatalogs() {
  if (templatesById.size > 0 && sublimationRecipesByMaterial.size > 0) return;

  try {
    const starPath = path.resolve(__dirname, '../res/release/config/t_s_startemplate-2bd161795d.json');
    if (fs.existsSync(starPath)) {
      const raw = JSON.parse(fs.readFileSync(starPath, 'utf8')).t_s_startemplate;
      for (const t of raw) {
        templatesById.set(Number(t.TemplateId), t);
      }
    }
  } catch (e) {
    console.warn('[AstralState] Erro ao carregar t_s_startemplate:', e.message);
  }

  try {
    const subPath = path.resolve(__dirname, '../res/release/config/t_s_starsublimation-d6e3149366.json');
    if (fs.existsSync(subPath)) {
      const raw = JSON.parse(fs.readFileSync(subPath, 'utf8')).t_s_starsublimation;
      for (const r of raw) {
        sublimationRecipesByMaterial.set(Number(r.Material), r);
      }
    }
  } catch (e) {
    console.warn('[AstralState] Erro ao carregar t_s_starsublimation:', e.message);
  }

  try {
    const propPath = path.resolve(__dirname, '../res/release/config/t_s_skillpropertytemplate-5a02eea60a.json');
    if (fs.existsSync(propPath)) {
      const raw = JSON.parse(fs.readFileSync(propPath, 'utf8')).t_s_skillpropertytemplate;
      for (const p of raw) {
        skillPropertiesById.set(Number(p.TemplateId), p);
      }
    }
  } catch (e) {
    console.warn('[AstralState] Erro ao carregar t_s_skillpropertytemplate:', e.message);
  }

  try {
    const dropPath = path.resolve(__dirname, '../res/release/config/t_s_dropitem-358e5cbc6e.json');
    if (fs.existsSync(dropPath)) {
      const raw = JSON.parse(fs.readFileSync(dropPath, 'utf8')).t_s_dropitem;
      for (let s = 0; s < 5; s++) {
        const dropId = 19001 + s;
        const items = raw.filter(x => x.DropId === dropId).map(x => ({
          itemId: Number(x.ItemId),
          weight: Number(x.Random) || 1
        }));
        dropPoolsBySphere.set(s, items);
      }
    }
  } catch (e) {
    console.warn('[AstralState] Erro ao carregar t_s_dropitem:', e.message);
  }
}

// Inicializa catálogos imediatamente
loadCatalogs();

/**
 * Garante estrutura de estado persistido de astrais no objeto state_json do personagem
 */
function ensureAstralState(saved) {
  if (!saved.astrals || typeof saved.astrals !== 'object') {
    saved.astrals = {
      nextId: 1,
      spheres: [1, 0, 0, 0, 0], // Esfera 0 sempre liberada
      points: 0,
      temp: [],     // Rm.TEMP = 0 (max 16)
      bag: [],      // Rm.PLAYER = 1 (max 24)
      equipped: []  // Rm.THANE = 2 (max 8)
    };
  }

  const a = saved.astrals;
  if (!Number.isSafeInteger(a.nextId) || a.nextId < 1) a.nextId = 1;
  if (!Array.isArray(a.spheres) || a.spheres.length < 5) a.spheres = [1, 0, 0, 0, 0];
  a.spheres[0] = 1; // Esfera inicial sempre acesa
  if (!Number.isSafeInteger(a.points) || a.points < 0) a.points = 0;

  if (!Array.isArray(a.temp)) a.temp = [];
  if (!Array.isArray(a.bag)) a.bag = [];
  if (!Array.isArray(a.equipped)) a.equipped = [];

  // Higieniza itens
  for (const item of a.temp) item.bagType = StarBagType.TEMP;
  for (const item of a.bag) item.bagType = StarBagType.PLAYER;
  for (const item of a.equipped) item.bagType = StarBagType.THANE;

  return a;
}

function getTemplate(templateId) {
  loadCatalogs();
  return templatesById.get(Number(templateId)) || null;
}

/**
 * Calcula total de slots de equipamento liberados de acordo com o nível do herói
 * Nível 25: 4 slots
 * Nível 30: 5 slots
 * Nível 35: 6 slots
 * Nível 40: 7 slots
 * Nível 45+: 8 slots
 */
function getUnlockedEquipSlots(grade) {
  const g = Math.max(1, Number(grade) || 1);
  if (g < UNLOCK_BASE_LEVEL) return 0;
  const extra = Math.floor((g - UNLOCK_BASE_LEVEL) / 5);
  return Math.min(MAX_EQUIP_SLOTS, BASE_EQUIP_SLOTS + extra);
}

/**
 * Retorna curva de EXP oficial por perfil
 */
function getExpCurve(profile) {
  return EXP_CURVES_BY_PROFILE[profile] || EXP_CURVES_BY_PROFILE[2];
}

/**
 * Calcula o Total de EXP acumulado que um astral carrega
 * TotalExp = Soma dos degraus de nível até o nível atual + gp atual + SellGp do template
 */
function getAstralTotalExp(astral) {
  if (!astral) return 0;
  const t = getTemplate(astral.templateId);
  if (!t) return 0;
  if (t.Profile <= 1) return 0; // Cinza não tem EXP

  const curve = getExpCurve(t.Profile);
  let total = 0;
  const grade = Math.min(10, Math.max(1, Number(astral.grade) || 1));
  for (let g = 1; g <= grade; g++) {
    total += (curve[g - 1] || 0);
  }
  total += (Number(astral.gp) || 0) + (Number(t.SellGp) || 0);
  return total;
}

/**
 * Recalcula o nível (grade) e o excedente de EXP (gp) de um astral após absorver EXP
 */
function applyExpToAstral(astral, addExp) {
  const t = getTemplate(astral.templateId);
  if (!t || t.Profile <= 1) return;

  const curve = getExpCurve(t.Profile);
  let grade = Math.min(10, Math.max(1, Number(astral.grade) || 1));
  let gp = (Number(astral.gp) || 0) + Math.max(0, Number(addExp) || 0);

  while (grade < 10) {
    const nextCost = curve[grade]; // Custo para atingir grade + 1
    if (gp >= nextCost) {
      gp -= nextCost;
      grade++;
    } else {
      break;
    }
  }

  astral.grade = grade;
  astral.gp = gp;
}

/**
 * Encontra a primeira posição livre em um array de slots
 */
function findFirstFreePos(items, maxSlots) {
  const used = new Set(items.map(i => i.pos));
  for (let p = 0; p < maxSlots; p++) {
    if (!used.has(p)) return p;
  }
  return -1;
}

/**
 * Rola a captura em uma esfera específica (0..4)
 */
function rollSphereCapture(saved, sphereIndex, currentGold) {
  ensureAstralState(saved);
  const a = saved.astrals;
  const idx = Math.max(0, Math.min(4, Number(sphereIndex) || 0));

  // Valida se a esfera está acesa
  if (idx > 0 && !a.spheres[idx]) {
    throw new Error(`Esfera ${idx + 1} não está ativa no astrolábio`);
  }

  // Valida custo em ouro
  const cost = SPHERE_COSTS[idx];
  if (currentGold < cost) {
    throw new Error(`Ouro insuficiente para capturar na esfera ${idx + 1} (necessário: ${cost})`);
  }

  // Valida espaço na bolsa temporária do astrolábio
  if (a.temp.length >= MAX_TEMP_SLOTS) {
    throw new Error('A bolsa temporária do astrolábio está cheia (16/16 slots)');
  }

  const freePos = findFirstFreePos(a.temp, MAX_TEMP_SLOTS);
  if (freePos === -1) {
    throw new Error('Sem posições livres na bolsa temporária');
  }

  // Rola drop da esfera correspondente
  loadCatalogs();
  const pool = dropPoolsBySphere.get(idx) || [];
  if (pool.length === 0) {
    throw new Error(`Tabela de drop para esfera ${idx + 1} indisponível`);
  }

  const totalWeight = pool.reduce((acc, x) => acc + x.weight, 0);
  let rnd = Math.random() * totalWeight;
  let chosenItemId = pool[0].itemId;
  for (const entry of pool) {
    if (rnd <= entry.weight) {
      chosenItemId = entry.itemId;
      break;
    }
    rnd -= entry.weight;
  }

  const tpl = getTemplate(chosenItemId);
  if (!tpl) {
    throw new Error(`Template do astral ${chosenItemId} não encontrado`);
  }

  // Cria instância do astral
  const astralId = a.nextId++;
  const newAstral = {
    id: astralId,
    templateId: chosenItemId,
    pos: freePos,
    bagType: StarBagType.TEMP,
    grade: 1,
    gp: 0,
    isLock: false
  };
  a.temp.push(newAstral);

  // Pontos de Astrologia oficiais (StarPoint0..4: [1, 2, 3, 4, 5])
  const pts = [1, 2, 3, 4, 5][idx] || 1;
  a.points = (Number(a.points) || 0) + pts;

  // Mecânica de Orbes Progressivos (NUNCA retrocede):
  // Orbes 0 a 3: avançam sempre para a próxima esfera (idx + 1).
  // Orbe 4 (5º orbe / Polaris): após capturado, reinicia o ciclo no orbe 0.
  // As esferas até a alcançada permanecem ativas para que as setas iluminem
  // e o orbe mais alto ganhe a animação amarela no cliente (StarWnd.__randomPosHandler).
  const newSpheres = [1, 0, 0, 0, 0];
  if (idx < 4) {
    for (let s = 0; s <= idx + 1; s++) {
      newSpheres[s] = 1;
    }
  } else {
    // idx === 4 (última esfera coletada): volta para a inicial [1, 0, 0, 0, 0]
    newSpheres[0] = 1;
  }

  a.spheres = newSpheres;

  return {
    astral: newAstral,
    template: tpl,
    spheres: newSpheres,
    goldCost: cost,
    dropSite: freePos,
    earnedPoints: pts,
    totalPoints: a.points
  };
}

/**
 * Captura Automática / One-Click Capture em Lote
 * Suporta sellMaxQuality (1: Comum, 2: Incomum, 3: Raro, etc.)
 * Suporta composeMaxQuality (síntese automática dos restantes com Profile <= composeMaxQuality)
 * Suporta golden (limite de gasto em ouro)
 */
function autoCapture(saved, availableGold, sellParam = [1], maxCapture = 16, composeMaxQuality = 0, goldenLimit = 0) {
  ensureAstralState(saved);
  const a = saved.astrals;

  // Normalizar sellQualities
  let sellQualities = [1];
  let composeMax = Number(composeMaxQuality) || 0;
  let maxSpend = Number(goldenLimit) || 0;

  if (typeof sellParam === 'object' && !Array.isArray(sellParam) && sellParam !== null) {
    const opts = sellParam;
    if (opts.sellMaxQuality !== undefined) {
      const smq = Number(opts.sellMaxQuality) || 0;
      sellQualities = smq > 0 ? [1, 2, 3, 4, 5].filter(q => q <= smq) : [];
    }
    if (opts.composeMaxQuality !== undefined) composeMax = Number(opts.composeMaxQuality) || 0;
    if (opts.golden !== undefined) maxSpend = Number(opts.golden) || 0;
    if (opts.maxCapture !== undefined) maxCapture = Number(opts.maxCapture) || 16;
  } else if (Array.isArray(sellParam)) {
    sellQualities = sellParam;
  } else if (typeof sellParam === 'number') {
    const smq = sellParam;
    sellQualities = smq > 0 ? [1, 2, 3, 4, 5].filter(q => q <= smq) : [];
  }

  // Limite de ouro configurado pelo usuário (golden)
  const goldBudget = maxSpend > 0 ? Math.min(availableGold, maxSpend) : availableGold;
  let gold = availableGold;
  let spentFromBudget = 0;

  const generated = [];
  let soldCount = 0;
  let soldGold = 0;
  let earnedPoints = 0;

  // 1. Limpeza prévia: vende itens já existentes no temp que casam com sellQualities
  for (let i = a.temp.length - 1; i >= 0; i--) {
    const item = a.temp[i];
    if (item.isLock) continue;
    const t = getTemplate(item.templateId);
    if (t && sellQualities.includes(t.Profile)) {
      a.temp.splice(i, 1);
      soldCount++;
      const goldGain = t.SellGold || 0;
      soldGold += goldGain;
      gold += goldGain;
    }
  }

  // 2. Loop de captura automática
  let iterations = 0;
  const maxIterations = 50;

  while (iterations < maxIterations && a.temp.length < MAX_TEMP_SLOTS && generated.length < maxCapture) {
    iterations++;

    // Achar a esfera ativa mais alta
    let targetSphere = 0;
    for (let s = 4; s >= 0; s--) {
      if (a.spheres[s] === 1) {
        targetSphere = s;
        break;
      }
    }

    const cost = SPHERE_COSTS[targetSphere];
    if (gold < cost) break;
    if (maxSpend > 0 && spentFromBudget + cost > goldBudget) break;

    try {
      const res = rollSphereCapture(saved, targetSphere, gold);
      gold -= res.goldCost;
      spentFromBudget += res.goldCost;
      earnedPoints += res.earnedPoints;

      // Verificar se é qualidade de auto-venda (ex: cinza = 1, verde = 2, azul = 3)
      if (sellQualities.includes(res.template.Profile)) {
        // Remove do temp imediatamente e adiciona ouro de venda
        const idxInTemp = a.temp.findIndex(x => x.id === res.astral.id);
        if (idxInTemp !== -1) a.temp.splice(idxInTemp, 1);
        soldCount++;
        const goldGain = res.template.SellGold || 0;
        soldGold += goldGain;
        gold += goldGain;
      } else {
        generated.push(res.astral);
      }
    } catch (_) {
      break;
    }
  }

  // 3. Auto-Síntese (se composeMaxQuality configurada e restarem 2+ astrais no temp)
  let composeOutcome = null;
  if (composeMax > 0 && a.temp.length > 1) {
    try {
      composeOutcome = composeBag(saved, -1, StarBagType.TEMP, composeMax);
    } catch (_) {}
  }

  return {
    generated,
    soldCount,
    soldGold,
    remainingGold: gold,
    spheres: a.spheres,
    earnedPoints,
    totalPoints: a.points,
    composeOutcome
  };
}

/**
 * Troca de Astrais por Pontos de Astrologia (Star Shop / [Trocar])
 */
function buyStarShop(saved, templateId, count = 1) {
  ensureAstralState(saved);
  const a = saved.astrals;
  const num = Math.max(1, Number(count) || 1);
  const tpl = getTemplate(templateId);
  if (!tpl) {
    throw new Error(`Template do astral ${templateId} inexistente`);
  }
  const costPerUnit = Number(tpl.StarPoint) || 0;
  if (costPerUnit <= 0) {
    throw new Error(`Astral ${templateId} não está disponível para troca por pontos`);
  }
  const totalCost = costPerUnit * num;
  const currentPoints = Number(a.points) || 0;
  if (currentPoints < totalCost) {
    throw new Error(`Pontos insuficientes para troca (necessário: ${totalCost}, atual: ${currentPoints})`);
  }
  if (a.bag.length + num > MAX_BAG_SLOTS) {
    throw new Error(`A bolsa de astrais está cheia (capacidade: ${MAX_BAG_SLOTS})`);
  }

  // Deduz pontos
  a.points = currentPoints - totalCost;

  // Cria itens na bolsa do jogador (Rm.PLAYER)
  const added = [];
  for (let i = 0; i < num; i++) {
    const freePos = findFirstFreePos(a.bag, MAX_BAG_SLOTS);
    if (freePos === -1) break;
    const item = {
      id: a.nextId++,
      templateId: Number(templateId),
      pos: freePos,
      bagType: StarBagType.PLAYER,
      grade: 1,
      gp: 0,
      isLock: false
    };
    a.bag.push(item);
    added.push(item);
  }

  return {
    template: tpl,
    added,
    cost: totalCost,
    remainingPoints: a.points
  };
}

/**
 * Coletar / Pegar astral da bolsa temporária para a mochila
 * dropSite === -2: Recolher Tudo (Quick Pickup de todos com Profile > 1)
 * dropSite === -1: Venda Rápida (Quick Sell de lixos/cinzas com Profile <= way)
 * dropSite >= 0: Coletar (way=1) ou Vender (way=2) um astral específico
 */
function pickAstral(saved, dropSite, way = 1) {
  ensureAstralState(saved);
  const a = saved.astrals;

  // 1. Quick Pickup (-2): Coletar todos os astrais válidos (Profile > 1) para a mochila do jogador
  if (dropSite === -2) {
    const picked = [];
    const deletedDropSites = [];
    const candidates = a.temp.filter(x => {
      const t = getTemplate(x.templateId);
      return t && t.Profile > 1;
    });

    if (candidates.length === 0) {
      throw new Error('Nenhum astral elegível para recolher');
    }

    for (const astral of candidates) {
      const freePos = findFirstFreePos(a.bag, MAX_BAG_SLOTS);
      if (freePos === -1) break; // Mochila cheia

      const idx = a.temp.findIndex(x => x.id === astral.id);
      if (idx !== -1) {
        a.temp.splice(idx, 1);
        deletedDropSites.push(astral.pos);
        astral.bagType = StarBagType.PLAYER;
        astral.pos = freePos;
        a.bag.push(astral);
        picked.push({
          astral,
          dropSite: deletedDropSites[deletedDropSites.length - 1],
          newPos: freePos
        });
      }
    }

    if (picked.length === 0) {
      throw new Error('A mochila de Astrais está cheia (24/24 slots)');
    }

    return {
      type: 'quick_pick',
      picked,
      deletedDropSites,
      goldEarned: 0
    };
  }

  // 2. Quick Sell (-1): Vender todos os astrais de qualidade baixa (cinzas Profile <= way)
  if (dropSite === -1) {
    const maxQuality = Math.max(1, way || 1);
    const deletedDropSites = [];
    let totalGold = 0;

    for (let i = a.temp.length - 1; i >= 0; i--) {
      const item = a.temp[i];
      const t = getTemplate(item.templateId);
      if (t && t.Profile <= maxQuality && (Number(item.grade) || 1) === 1 && (Number(item.gp) || 0) === 0) {
        deletedDropSites.push(item.pos);
        totalGold += (t.SellGold || 0);
        a.temp.splice(i, 1);
      }
    }

    if (deletedDropSites.length === 0) {
      throw new Error('Nenhum astral para venda rápida');
    }

    return {
      type: 'quick_sell',
      deletedDropSites,
      goldEarned: totalGold
    };
  }

  // 3. Slot individual (dropSite >= 0)
  const idx = a.temp.findIndex(x => x.pos === dropSite);
  if (idx === -1) {
    throw new Error(`Astral não encontrado no slot temporário ${dropSite}`);
  }

  const astral = a.temp[idx];
  const tpl = getTemplate(astral.templateId);

  // way === 2 ou Profile === 1: Vender por ouro
  if (way === 2 || (tpl && tpl.Profile === 1)) {
    a.temp.splice(idx, 1);
    const goldEarned = tpl ? (tpl.SellGold || 0) : 0;
    return {
      type: 'sell',
      astral,
      dropSite,
      deletedDropSites: [dropSite],
      goldEarned
    };
  }

  // way === 1: Coletar para mochila
  const freePos = findFirstFreePos(a.bag, MAX_BAG_SLOTS);
  if (freePos === -1) {
    throw new Error('A mochila de Astrais está cheia (24/24 slots)');
  }

  a.temp.splice(idx, 1);
  astral.bagType = StarBagType.PLAYER;
  astral.pos = freePos;
  a.bag.push(astral);

  return {
    type: 'pick',
    astral,
    dropSite,
    newPos: freePos,
    deletedDropSites: [dropSite],
    picked: [{
      astral,
      dropSite,
      newPos: freePos
    }],
    goldEarned: 0
  };
}

/**
 * Síntese / Fusão / "Engolir" em lote ("One-Key Compose")
 */
function composeBag(saved, targetPos = -1, bagType = StarBagType.PLAYER, maxQuality = 0) {
  ensureAstralState(saved);
  const a = saved.astrals;
  const list = (bagType === StarBagType.TEMP) ? a.temp : a.bag;

  if (list.length <= 1) {
    throw new Error('Não há astrais suficientes para sintetizar');
  }

  // Determinar astral alvo (o que vai engolir os outros)
  let target = null;
  if (targetPos >= 0) {
    target = list.find(x => x.pos === targetPos);
  }

  if (!target) {
    // Escolhe automaticamente o de maior Profile, maior nível e maior EXP que não esteja travado
    let bestScore = -1;
    for (const item of list) {
      if (item.isLock) continue;
      const t = getTemplate(item.templateId);
      if (!t || t.Profile <= 1) continue;
      const score = t.Profile * 1000000 + item.grade * 10000 + (item.gp || 0);
      if (score > bestScore) {
        bestScore = score;
        target = item;
      }
    }
  }

  if (!target) {
    throw new Error('Nenhum astral elegível encontrado para receber a fusão');
  }

  let totalExpGained = 0;
  const deletedAstrals = [];
  const remaining = [];

  for (const item of list) {
    if (item.id === target.id || item.isLock) {
      remaining.push(item);
      continue;
    }

    const tpl = getTemplate(item.templateId);
    if (tpl && tpl.Profile > 1) {
      if (maxQuality > 0 && tpl.Profile > maxQuality) {
        remaining.push(item);
        continue;
      }
      const exp = getAstralTotalExp(item);
      totalExpGained += exp;
      deletedAstrals.push(item);
    } else {
      deletedAstrals.push(item);
    }
  }

  if (deletedAstrals.length === 0) {
    throw new Error('Todos os outros astrais estão travados ou protegidos');
  }

  // Atualiza lista na memória
  if (bagType === StarBagType.TEMP) a.temp = remaining;
  else a.bag = remaining;

  // Aplica EXP no alvo
  const oldGrade = target.grade;
  applyExpToAstral(target, totalExpGained);

  return {
    targetAstral: target,
    expGained: totalExpGained,
    leveledUp: target.grade > oldGrade,
    oldGrade,
    newGrade: target.grade,
    deletedAstrals
  };
}

/**
 * Movimentação, Troca, Fusão manual e Equipamento de Astrais (C_STAR_MOVE - 8267)
 */
function moveAstral(saved, heroGrade, req) {
  ensureAstralState(saved);
  const a = saved.astrals;

  const { beginStarType, beginPos, endStarType, endPos, eat } = req;

  function getList(bType) {
    if (bType === StarBagType.TEMP) return a.temp;
    if (bType === StarBagType.PLAYER) return a.bag;
    if (bType === StarBagType.THANE) return a.equipped;
    throw new Error(`Tipo de bolsa inválido: ${bType}`);
  }

  const srcList = getList(beginStarType);
  const dstList = getList(endStarType);

  const srcItem = srcList.find(x => x.pos === beginPos);
  if (!srcItem) {
    throw new Error(`Astral de origem não encontrado na bolsa ${beginStarType} pos ${beginPos}`);
  }

  const dstItem = dstList.find(x => x.pos === endPos);

  // Fusão manual (arrastar para cima com eat=true ou sobreposição com intenção de engolir)
  if (eat && dstItem) {
    if (srcItem.isLock || dstItem.isLock) {
      throw new Error('Astrais travados não podem ser consumidos em fusão');
    }

    const srcTpl = getTemplate(srcItem.templateId);
    const dstTpl = getTemplate(dstItem.templateId);

    // O de maior raridade engole o menor; se igual, o destino engole a origem
    let consumer = dstItem;
    let consumed = srcItem;
    let consumerList = dstList;
    let consumedList = srcList;

    if (srcTpl && dstTpl && srcTpl.Profile > dstTpl.Profile) {
      consumer = srcItem;
      consumed = dstItem;
      consumerList = srcList;
      consumedList = dstList;
    }

    const exp = getAstralTotalExp(consumed);
    applyExpToAstral(consumer, exp);

    // Remove consumido
    const idx = consumedList.findIndex(x => x.id === consumed.id);
    if (idx !== -1) consumedList.splice(idx, 1);

    return {
      type: 'fuse',
      consumer,
      consumed,
      heroStatsChanged: (beginStarType === StarBagType.THANE || endStarType === StarBagType.THANE)
    };
  }

  // Validação ao equipar no herói (Rm.THANE = 2)
  if (endStarType === StarBagType.THANE) {
    const maxSlots = getUnlockedEquipSlots(heroGrade);
    if (endPos >= maxSlots) {
      throw new Error(`Slot ${endPos + 1} de equipamento astral está bloqueado para seu nível atual`);
    }

    const srcTpl = getTemplate(srcItem.templateId);
    if (srcTpl) {
      if (srcTpl.Profile <= 1) {
        throw new Error('Astrais cinzas/lixo não podem ser equipados');
      }

      // Valida unicidade de MasterType (não pode equipar 2 do mesmo tipo)
      for (const eq of a.equipped) {
        if (eq.pos !== endPos) {
          const eqTpl = getTemplate(eq.templateId);
          if (eqTpl && eqTpl.MasterType === srcTpl.MasterType) {
            throw new Error(`Você já possui um astral do tipo "${eqTpl.TemplateName_pt || eqTpl.MasterType}" equipado`);
          }
        }
      }
    }
  }

  // Movimentação simples ou troca de slots
  if (!dstItem) {
    // Slot de destino vazio: move diretamente
    srcItem.pos = endPos;
    srcItem.bagType = endStarType;

    if (srcList !== dstList) {
      const idx = srcList.findIndex(x => x.id === srcItem.id);
      if (idx !== -1) srcList.splice(idx, 1);
      dstList.push(srcItem);
    }

    return {
      type: 'move',
      moved: [{ changeType: endStarType, changePos: endPos, astral: srcItem }],
      deleted: [{ changeType: beginStarType, changePos: beginPos }],
      heroStatsChanged: (beginStarType === StarBagType.THANE || endStarType === StarBagType.THANE)
    };
  } else {
    // Slot de destino ocupado: efetua troca (swap)
    // Valida também se o item que volta para o THANE satisfaz as restrições
    if (beginStarType === StarBagType.THANE) {
      const dstTpl = getTemplate(dstItem.templateId);
      if (dstTpl) {
        if (dstTpl.Profile <= 1) throw new Error('Astrais cinzas não podem ser equipados');
        for (const eq of a.equipped) {
          if (eq.pos !== beginPos && eq.pos !== endPos) {
            const eqTpl = getTemplate(eq.templateId);
            if (eqTpl && eqTpl.MasterType === dstTpl.MasterType) {
              throw new Error(`Conflito de tipo duplicado ao trocar astral`);
            }
          }
        }
      }
    }

    // Troca coordenadas e bolsas
    srcItem.pos = endPos;
    srcItem.bagType = endStarType;
    dstItem.pos = beginPos;
    dstItem.bagType = beginStarType;

    if (srcList !== dstList) {
      const idxSrc = srcList.findIndex(x => x.id === srcItem.id);
      if (idxSrc !== -1) srcList.splice(idxSrc, 1);
      const idxDst = dstList.findIndex(x => x.id === dstItem.id);
      if (idxDst !== -1) dstList.splice(idxDst, 1);

      dstList.push(srcItem);
      srcList.push(dstItem);
    }

    return {
      type: 'swap',
      moved: [
        { changeType: endStarType, changePos: endPos, astral: srcItem },
        { changeType: beginStarType, changePos: beginPos, astral: dstItem }
      ],
      deleted: [],
      heroStatsChanged: (beginStarType === StarBagType.THANE || endStarType === StarBagType.THANE)
    };
  }
}

/**
 * Trava / Destrava astral contra fusão acidental (C_STAR_LOCK - 8330)
 */
function toggleAstralLock(saved, starType, pos) {
  ensureAstralState(saved);
  const a = saved.astrals;
  const list = (starType === StarBagType.THANE) ? a.equipped : a.bag;
  const item = list.find(x => x.pos === pos);
  if (!item) {
    throw new Error(`Astral não encontrado no tipo ${starType} pos ${pos}`);
  }
  item.isLock = !item.isLock;
  return item;
}

/**
 * Venda em lote ou operações rápidas (C_STAR_BATCH_OP - 8794)
 */
function batchOperation(saved, way, mergePos, beginType, endType, itemInfo) {
  ensureAstralState(saved);
  const a = saved.astrals;

  // way === 1: Venda Rápida (Quick Sell)
  if (way === 1) {
    let goldGain = 0;
    const deleted = [];
    const positions = (itemInfo && itemInfo.length > 0) ? new Set(itemInfo.map(i => i.pos)) : null;

    // Vende da bolsa temporária
    const remainingTemp = [];
    for (const item of a.temp) {
      const tpl = getTemplate(item.templateId);
      const shouldSell = positions ? positions.has(item.pos) : (tpl && tpl.Profile === 1);
      if (shouldSell && !item.isLock) {
        goldGain += (tpl ? tpl.SellGold || 0 : 0);
        deleted.push({ bagType: StarBagType.TEMP, pos: item.pos });
      } else {
        remainingTemp.push(item);
      }
    }
    a.temp = remainingTemp;

    // Vende da mochila se especificado
    if (positions) {
      const remainingBag = [];
      for (const item of a.bag) {
        if (positions.has(item.pos) && !item.isLock) {
          const tpl = getTemplate(item.templateId);
          goldGain += (tpl ? tpl.SellGold || 0 : 0);
          deleted.push({ bagType: StarBagType.PLAYER, pos: item.pos });
        } else {
          remainingBag.push(item);
        }
      }
      a.bag = remainingBag;
    }

    return {
      type: 'quick_sell',
      goldGain,
      deleted
    };
  }

  // way === 2: Fusão Rápida
  if (way === 2) {
    return composeBag(saved, mergePos, beginType || StarBagType.PLAYER);
  }

  // way === 3: Sublimação de Astral Laranja para Cosmo Vermelho (Red Astral / Dual Attribute)
  if (way === 3) {
    loadCatalogs();
    const sourceBag = (beginType === StarBagType.THANE) ? a.equipped : a.bag;
    const targetAstral = sourceBag.find(x => x.pos === mergePos);
    if (!targetAstral) {
      throw new Error(`Astral para sublimação não encontrado na pos ${mergePos} da bolsa ${beginType}`);
    }

    const recipe = sublimationRecipesByMaterial.get(Number(targetAstral.templateId));
    if (!recipe) {
      throw new Error(`Astral ${targetAstral.templateId} não possui receita de sublimação para Cosmo Vermelho`);
    }

    const goldCost = Number(recipe.NeedGold) || 100000;
    targetAstral.templateId = Number(recipe.Product);
    const newTpl = templatesById.get(Number(targetAstral.templateId));
    const currentGrade = Math.max(1, Number(targetAstral.grade) || 1);
    if (newTpl && Array.isArray(newTpl.SublimationSkill) && newTpl.SublimationSkill.length > 0) {
      const sIdx = Math.min(newTpl.SublimationSkill.length - 1, currentGrade - 1);
      targetAstral.subSkill = [newTpl.SublimationSkill[sIdx]];
    }

    return {
      type: 'sublimation',
      goldCost,
      targetAstral,
      heroStatsChanged: (beginType === StarBagType.THANE)
    };
  }

  throw new Error(`Operação em lote way=${way} não suportada`);
}

/**
 * Calcula a soma dos bônus de atributos de TODOS os astrais equipados no herói (Rm.THANE)
 * Utilizado diretamente por attribute-calculator.js
 */
function calculateEquippedAstralAttributes(saved) {
  const result = {
    Power: 0,
    Agility: 0,
    Intellect: 0,
    Physique: 0,
    Captain: 0,
    Attack: 0,
    Defence: 0,
    MagicAttack: 0,
    MagicDefence: 0,
    Live: 0,
    ForceHit: 0,
    Parry: 0,
    Conat: 0
  };

  if (!saved || !saved.astrals || !Array.isArray(saved.astrals.equipped)) {
    return result;
  }

  loadCatalogs();
  for (const item of saved.astrals.equipped) {
    const t = templatesById.get(Number(item.templateId));
    if (!t) continue;
    const grade = Math.max(1, Number(item.grade) || 1);

    result.Power += (Number(t.Power) || 0) * grade;
    result.Agility += (Number(t.Agility) || 0) * grade;
    result.Intellect += (Number(t.Intellect) || 0) * grade;
    result.Physique += (Number(t.Physique) || 0) * grade;
    result.Captain += (Number(t.Captain) || 0) * grade;
    result.Attack += (Number(t.Attack) || 0) * grade;
    result.Defence += (Number(t.Defence) || 0) * grade;
    result.MagicAttack += (Number(t.MagicAttack) || 0) * grade;
    result.MagicDefence += (Number(t.MagicDefence) || 0) * grade;
    result.Live += (Number(t.Live) || 0) * grade;
    result.ForceHit += (Number(t.ForceHit) || 0) * grade;
    result.Parry += (Number(t.Parry) || 0) * grade;
    result.Conat += (Number(t.Conat) || 0) * grade;

    // Atributos duplos / SublimationSkill de Cosmos Vermelhos
    let subSkills = [];
    if (Array.isArray(t.SublimationSkill) && t.SublimationSkill.length > 0) {
      const sIdx = Math.min(t.SublimationSkill.length - 1, Math.max(0, grade - 1));
      subSkills = [t.SublimationSkill[sIdx]];
    } else if (Array.isArray(item.subSkill) && item.subSkill.length > 0) {
      subSkills = item.subSkill;
    }
    for (const sId of subSkills) {
      const prop = skillPropertiesById.get(Number(sId));
      if (prop) {
        result.Power += (Number(prop.Power) || 0);
        result.Agility += (Number(prop.Agility) || 0);
        result.Intellect += (Number(prop.Intellect) || 0);
        result.Physique += (Number(prop.Physique) || 0);
        result.Captain += (Number(prop.Captain) || 0);
        result.Attack += (Number(prop.Attack) || 0);
        result.Defence += (Number(prop.Defence) || 0);
        result.MagicAttack += (Number(prop.MagicAttack) || 0);
        result.MagicDefence += (Number(prop.MagicDefence) || 0);
        result.Live += (Number(prop.Live) || 0);
        result.ForceHit += (Number(prop.ForceHit) || 0);
        result.Parry += (Number(prop.Parry) || 0);
        result.Conat += (Number(prop.Conat) || 0);
      }
    }
  }

  return result;
}

/**
 * Formata pacote S2C 4178 (StarMoveRspMsg) com todos os astrais do jogador
 */
function formatAllAstralsMoveMsg(saved, playerId) {
  ensureAstralState(saved);
  const a = saved.astrals;
  const move = [];

  for (const item of a.bag) {
    move.push({
      changeType: StarBagType.PLAYER,
      changePos: item.pos,
      star_Info: {
        id: item.id,
        templateId: item.templateId,
        userId: playerId,
        objectId: 0,
        pos: item.pos,
        exist: true,
        bagType: StarBagType.PLAYER,
        grade: item.grade,
        gp: item.gp,
        isLock: Boolean(item.isLock)
      }
    });
  }

  for (const item of a.equipped) {
    move.push({
      changeType: StarBagType.THANE,
      changePos: item.pos,
      star_Info: {
        id: item.id,
        templateId: item.templateId,
        userId: playerId,
        objectId: 0,
        pos: item.pos,
        exist: true,
        bagType: StarBagType.THANE,
        grade: item.grade,
        gp: item.gp,
        isLock: Boolean(item.isLock)
      }
    });
  }

  return { move };
}

/**
 * Formata starInfo individual para mensagens S2C
 */
function formatStarInfo(item, playerId) {
  if (!item) return null;
  return {
    id: item.id || 0,
    templateId: item.templateId || 0,
    userId: playerId || 0,
    objectId: 0,
    pos: item.pos !== undefined ? item.pos : 0,
    exist: true,
    bagType: item.bagType !== undefined ? item.bagType : StarBagType.TEMP,
    grade: item.grade || 1,
    gp: item.gp || 0,
    isLock: Boolean(item.isLock)
  };
}

/**
 * Formata pacote S2C 4180 (StarRandRspMsg)
 */
function formatStarRandRspMsg(spheres, starRandList, playerId) {
  return {
    site: spheres || [1, 0, 0, 0, 0],
    starRand: (starRandList || []).map(item => ({
      dropSite: item.pos,
      starInfo: formatStarInfo(item, playerId)
    }))
  };
}

module.exports = {
  StarBagType,
  SPHERE_COSTS,
  MAX_TEMP_SLOTS,
  MAX_BAG_SLOTS,
  MAX_EQUIP_SLOTS,
  EXP_CURVES_BY_PROFILE,
  loadCatalogs,
  getTemplate,
  ensureAstralState,
  getUnlockedEquipSlots,
  getExpCurve,
  getAstralTotalExp,
  applyExpToAstral,
  rollSphereCapture,
  autoCapture,
  pickAstral,
  composeBag,
  moveAstral,
  toggleAstralLock,
  batchOperation,
  calculateEquippedAstralAttributes,
  formatAllAstralsMoveMsg,
  formatStarRandRspMsg,
  formatStarInfo,
  buyStarShop
};

