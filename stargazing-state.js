'use strict';

/**
 * stargazing-state.js — Sistema Completo de Astrologia / Constelações de Wartune Ultra
 * 
 * Implementa:
 * - Desejo Estelar (Wish / Star Wish - PU.NOMAL_REWARD = 1)
 *   Pools de drop oficiais: 132001 (1x) e 132010 (10x) de t_s_dropitem
 *   Consumo de fichas 2125149 ou diamantes (star_number = 180)
 *   Retorno de dropItemIds para parar a roleta e abrir StarGazingWishResultWnd
 * 
 * - Potencial Estelar (Formation / "Encantar" - PU.UPGRADE_STAR = 2)
 *   12 Signos Zodiacais (1: Áries a 12: Peixes)
 *   Configuração de t_s_starformation: Rank, StarGrade (0..5), Cell (0..9)
 *   Consumo de Ouro e Item 2125148
 *   Atributos: Ataque (6), Defesa (7), Ataque Mágico (8), Defesa Mágica (9), HP (10)
 * 
 * - Mapa Estelar (Star Map - PU.ACTIVATE_MAP_FRAGMENT = 3)
 *   Configuração de t_s_starmap: Rank, StarGrade, Cell (0..7)
 *   Consumo de Ouro e Item 2125135 / 2125149
 *   Atributos somados diretamente aos Heróis e ao Poder de Combate (BR)
 */

const fs = require('node:fs');
const path = require('node:path');

// Enums oficiais do cliente
const StargazingOp = {
  OPEN: 0,
  NOMAL_REWARD: 1,
  UPGRADE_STAR: 2,
  ACTIVATE_MAP_FRAGMENT: 3,
  OPEN_WORLDMAP: 4,
  STARGAZING: 5
};

// Caches de catálogos
let starFormationMap = new Map(); // key `${type}_${rank}_${starGrade}_${cell}` -> obj
let starMapMap = new Map();       // key `${type}_${rank}_${starGrade}_${cell}` -> obj
let dropPool132001 = [];          // 1x wish drops
let dropPool132010 = [];          // 10x wish drops
let loaded = false;

function loadCatalogs() {
  if (loaded) return;
  loaded = true;

  try {
    const p = path.resolve(__dirname, '../res/release/config/t_s_starformation-3b1373fad5.json');
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')).t_s_starformation;
      for (const row of raw) {
        const key = `${row.Type}_${row.Rank}_${row.StarGrade}_${row.Cell}`;
        starFormationMap.set(key, row);
      }
    }
  } catch (err) {
    console.warn('[StargazingState] Falha ao carregar t_s_starformation:', err.message);
  }

  try {
    const p = path.resolve(__dirname, '../res/release/config/t_s_starmap-5baf6d204e.json');
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')).t_s_starmap;
      for (const row of raw) {
        const key = `${row.Type}_${row.Rank}_${row.StarGrade}_${row.Cell}`;
        starMapMap.set(key, row);
      }
    }
  } catch (err) {
    console.warn('[StargazingState] Falha ao carregar t_s_starmap:', err.message);
  }

  try {
    const p = path.resolve(__dirname, '../res/release/config/t_s_dropitem-358e5cbc6e.json');
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')).t_s_dropitem;
      dropPool132001 = raw.filter(x => x.DropId === 132001);
      dropPool132010 = raw.filter(x => x.DropId === 132010);
    }
  } catch (err) {
    console.warn('[StargazingState] Falha ao carregar t_s_dropitem:', err.message);
  }
}

// Inicializa catálogos imediatamente
loadCatalogs();

/**
 * Garante estrutura de estado persistido de stargazing no objeto state_json do personagem
 */
function ensureStargazingState(saved) {
  if (!saved.stargazing || typeof saved.stargazing !== 'object') {
    saved.stargazing = {
      zodiacs: {}
    };
  }

  if (!saved.stargazing.zodiacs || typeof saved.stargazing.zodiacs !== 'object') {
    saved.stargazing.zodiacs = {};
  }

  const z = saved.stargazing.zodiacs;
  for (let i = 1; i <= 12; i++) {
    if (!z[i] || typeof z[i] !== 'object') {
      z[i] = {
        mapRank: 1,
        mapStarGrade: 0,
        mapFragments: 0,
        formationRank: 1,
        formationStarGrade: 0,
        formationLuck: 0,
        formationPoints: 0
      };
    } else {
      z[i].mapRank = Math.min(18, Math.max(1, Number(z[i].mapRank) || 1));
      z[i].mapStarGrade = Math.min(5, Math.max(0, Number(z[i].mapStarGrade) || 0));
      z[i].mapFragments = Math.min(9, Math.max(0, Number(z[i].mapFragments) || 0));
      // Rank em t_s_starformation é estritamente 1 (não existem Ranks > 1 no cliente)
      z[i].formationRank = 1;
      z[i].formationStarGrade = Math.min(5, Math.max(0, Number(z[i].formationStarGrade) || 0));
      z[i].formationLuck = Math.min(100, Math.max(0, Number(z[i].formationLuck) || 0));
      z[i].formationPoints = Math.min(9, Math.max(0, Number(z[i].formationPoints) || 0));
    }
  }

  return saved.stargazing;
}

/**
 * Converte string '6,176|7,176|8,176|9,176|10,881' em objeto de propriedades BasePropertiesMsg
 */
function parseAttributeValue(attrStr) {
  const res = {
    attack: 0,
    defence: 0,
    magicattack: 0,
    magicdefence: 0,
    live: 0
  };
  if (!attrStr || typeof attrStr !== 'string') return res;

  const parts = attrStr.split('|');
  for (const part of parts) {
    const pair = part.split(',');
    if (pair.length < 2) continue;
    const k = Number(pair[0]);
    const v = Number(pair[1]) || 0;
    if (k === 6) res.attack = v;
    else if (k === 7) res.defence = v;
    else if (k === 8) res.magicattack = v;
    else if (k === 9) res.magicdefence = v;
    else if (k === 10) res.live = v;
  }
  return res;
}

/**
 * Retorna mensagem de informações de um signo individual para Protobuf
 */
function getZodiacSignMsg(saved, index) {
  loadCatalogs();
  ensureStargazingState(saved);
  const z = saved.stargazing.zodiacs[index];

  // Atributos de Star Map
  const mapKey = `${index}_${z.mapRank}_${z.mapStarGrade}_${z.mapFragments}`;
  const mapRow = starMapMap.get(mapKey) || starMapMap.get(`${index}_1_0_0`) || null;
  const mapProperty = parseAttributeValue(mapRow ? mapRow.AttributeValue : '');

  // Atributos de Star Formation
  const formationKey = `${index}_${z.formationRank}_${z.formationStarGrade}_${z.formationPoints}`;
  const formRow = starFormationMap.get(formationKey) || starFormationMap.get(`${index}_1_0_0`) || null;
  const formationProperty = parseAttributeValue(formRow ? formRow.AttributeValue : '');

  return {
    index,
    mapRank: z.mapRank,
    mapStarGrade: z.mapStarGrade,
    mapFragments: z.mapFragments,
    mapProerty: mapProperty, // Note o spelling oficial 'mapProerty'
    formationPoints: z.formationPoints,
    formationRank: z.formationRank,
    formationStarGrade: z.formationStarGrade,
    formationProperty: formationProperty,
    formationLuck: z.formationLuck
  };
}

/**
 * Calcula totalProperty somando todos os 12 signos
 */
function getTotalProperty(saved) {
  const total = {
    attack: 0,
    defence: 0,
    magicattack: 0,
    magicdefence: 0,
    live: 0
  };

  for (let i = 1; i <= 12; i++) {
    const sign = getZodiacSignMsg(saved, i);
    if (sign.mapProerty) {
      total.attack += (sign.mapProerty.attack || 0);
      total.defence += (sign.mapProerty.defence || 0);
      total.magicattack += (sign.mapProerty.magicattack || 0);
      total.magicdefence += (sign.mapProerty.magicdefence || 0);
      total.live += (sign.mapProerty.live || 0);
    }
    if (sign.formationProperty) {
      total.attack += (sign.formationProperty.attack || 0);
      total.defence += (sign.formationProperty.defence || 0);
      total.magicattack += (sign.formationProperty.magicattack || 0);
      total.magicdefence += (sign.formationProperty.magicdefence || 0);
      total.live += (sign.formationProperty.live || 0);
    }
  }

  return total;
}

/**
 * Formata StargazingInfoMsg completo com 12 signos e totalProperty
 */
function formatStargazingInfo(saved) {
  ensureStargazingState(saved);
  const signs = [];
  for (let i = 1; i <= 12; i++) {
    signs.push(getZodiacSignMsg(saved, i));
  }
  return {
    totalProperty: getTotalProperty(saved),
    zodiacSign: signs
  };
}

/**
 * Desejo Estelar (Wish - PU.NOMAL_REWARD = 1)
 * Rola de dropPool132001 (1x) ou dropPool132010 (10x)
 */
function doWish(saved, count = 1) {
  loadCatalogs();
  const numRolls = (count >= 10) ? 10 : 1;
  const pool = (numRolls === 10) ? dropPool132010 : dropPool132001;

  if (!pool || pool.length === 0) {
    throw new Error('Pool de drop de Desejo Estelar não configurado');
  }

  // Calcula soma dos pesos
  let totalWeight = 0;
  for (const entry of pool) {
    totalWeight += (Number(entry.Random) || 1);
  }

  const dropItemIds = [];
  const awardedItems = [];

  for (let r = 0; r < numRolls; r++) {
    let roll = Math.floor(Math.random() * totalWeight);
    let chosen = pool[0];

    for (const entry of pool) {
      const w = Number(entry.Random) || 1;
      if (roll < w) {
        chosen = entry;
        break;
      }
      roll -= w;
    }

    dropItemIds.push(Number(chosen.Id));
    awardedItems.push({
      dropId: Number(chosen.Id),
      itemId: Number(chosen.ItemId),
      count: Number(chosen.Data) || 1
    });
  }

  return {
    dropItemIds,
    awardedItems
  };
}

function getFormationCost(signIndex, rank = 1, starGrade = 0, points = 0) {
  loadCatalogs();
  const idx = Math.min(12, Math.max(1, Number(signIndex) || 1));
  const r = 1; // strictly 1
  const sg = Math.min(5, Math.max(0, Number(starGrade) || 0));
  const pt = Math.min(9, Math.max(0, Number(points) || 0));
  const currentKey = `${idx}_${r}_${sg}_${pt}`;
  const currentCfg = starFormationMap.get(currentKey) || starFormationMap.get(`${idx}_1_0_0`);

  const goldCost = currentCfg ? (Number(currentCfg.Consume) || 50000) : 50000;
  let expendItemId = 2125148;
  let expendItemCount = 10;
  if (currentCfg && currentCfg.Expend) {
    const parts = String(currentCfg.Expend).split(',');
    if (parts.length >= 2) {
      expendItemId = Number(parts[0]) || 2125148;
      expendItemCount = Number(parts[1]) || 10;
    }
  }
  const probably = currentCfg ? (Number(currentCfg.Probably) || 100) : 100;
  return { goldCost, expendItemId, expendItemCount, probably };
}

function getMapCost(signIndex, rank = 1, starGrade = 0, fragments = 0) {
  loadCatalogs();
  const idx = Math.min(12, Math.max(1, Number(signIndex) || 1));
  const r = Math.min(18, Math.max(1, Number(rank) || 1));
  const sg = Math.min(5, Math.max(0, Number(starGrade) || 0));
  const frag = Math.min(9, Math.max(0, Number(fragments) || 0));
  const currentKey = `${idx}_${r}_${sg}_${frag}`;
  const currentCfg = starMapMap.get(currentKey) || starMapMap.get(`${idx}_1_0_0`);

  const goldCost = currentCfg ? (Number(currentCfg.Consume) || 1000) : 1000;
  let expendItemId = 2125135;
  let expendItemCount = 3;
  if (currentCfg && currentCfg.Expend) {
    const parts = String(currentCfg.Expend).split(',');
    if (parts.length >= 2) {
      expendItemId = Number(parts[0]) || 2125135;
      expendItemCount = Number(parts[1]) || 3;
    }
  }
  return { goldCost, expendItemId, expendItemCount };
}

/**
 * Potencial Estelar ("Encantar" / Formation - PU.UPGRADE_STAR = 2)
 */
function upgradeFormation(saved, signIndex) {
  loadCatalogs();
  ensureStargazingState(saved);
  const idx = Math.min(12, Math.max(1, Number(signIndex) || 1));
  const z = saved.stargazing.zodiacs[idx];

  // Nível Máximo: Rank 1, StarGrade 5, Points 9
  if (z.formationStarGrade >= 5 && z.formationPoints >= 9) {
    return {
      success: false,
      maxLevel: true,
      goldCost: 0,
      expendItemId: 2125148,
      expendItemCount: 0,
      zodiac: z,
      infoMsg: formatStargazingInfo(saved)
    };
  }

  const cost = getFormationCost(idx, 1, z.formationStarGrade, z.formationPoints);
  const roll = Math.random() * 100;
  const isSuccess = (roll <= cost.probably) || (z.formationLuck >= 100);

  let leveledUp = false;
  if (isSuccess) {
    z.formationLuck = 0;
    z.formationPoints++;
    if (z.formationPoints > 9) {
      if (z.formationStarGrade < 5) {
        z.formationPoints = 0;
        z.formationStarGrade++;
        leveledUp = true;
      } else {
        z.formationPoints = 9; // Máximo atingido
      }
    }
    z.formationRank = 1; // NUNCA deve ser > 1
  } else {
    // Sorte aumenta em caso de falha
    z.formationLuck = Math.min(100, z.formationLuck + 10);
  }

  return {
    success: isSuccess,
    leveledUp,
    goldCost: cost.goldCost,
    expendItemId: cost.expendItemId,
    expendItemCount: cost.expendItemCount,
    zodiac: z,
    infoMsg: formatStargazingInfo(saved)
  };
}

/**
 * Mapa Estelar (Star Map - PU.ACTIVATE_MAP_FRAGMENT = 3)
 */
function upgradeMap(saved, signIndex) {
  loadCatalogs();
  ensureStargazingState(saved);
  const idx = Math.min(12, Math.max(1, Number(signIndex) || 1));
  const z = saved.stargazing.zodiacs[idx];

  // Nível Máximo: Rank 18, StarGrade 5, Fragments 9
  if (z.mapRank >= 18 && z.mapStarGrade >= 5 && z.mapFragments >= 9) {
    return {
      success: false,
      maxLevel: true,
      goldCost: 0,
      expendItemId: 2125135,
      expendItemCount: 0,
      zodiac: z,
      infoMsg: formatStargazingInfo(saved)
    };
  }

  const cost = getMapCost(idx, z.mapRank, z.mapStarGrade, z.mapFragments);

  z.mapFragments++;
  let starUp = false;
  if (z.mapFragments > 9) {
    z.mapFragments = 0;
    z.mapStarGrade++;
    starUp = true;
    if (z.mapStarGrade > 5) {
      z.mapStarGrade = 0;
      if (z.mapRank < 18) {
        z.mapRank++;
      } else {
        z.mapStarGrade = 5;
        z.mapFragments = 9;
      }
    }
  }

  return {
    success: true,
    starUp,
    goldCost: cost.goldCost,
    expendItemId: cost.expendItemId,
    expendItemCount: cost.expendItemCount,
    zodiac: z,
    infoMsg: formatStargazingInfo(saved)
  };
}

/**
 * Retorna atributos somados de Stargazing para cálculo no Combat Power / Hero Stats
 */
function calculateStargazingAttributes(saved) {
  if (!saved || !saved.stargazing) {
    return { Attack: 0, Defence: 0, MagicAttack: 0, MagicDefence: 0, Live: 0 };
  }
  const total = getTotalProperty(saved);
  return {
    Attack: total.attack || 0,
    Defence: total.defence || 0,
    MagicAttack: total.magicattack || 0,
    MagicDefence: total.magicdefence || 0,
    Live: total.live || 0
  };
}

module.exports = {
  StargazingOp,
  ensureStargazingState,
  getZodiacSignMsg,
  getTotalProperty,
  formatStargazingInfo,
  doWish,
  getFormationCost,
  getMapCost,
  upgradeFormation,
  upgradeMap,
  calculateStargazingAttributes
};
