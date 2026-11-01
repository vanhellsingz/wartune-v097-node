'use strict';
// ==========================================================================
// uiplay-state.js — Campanha dos Silfos (UiPlay) e Expedição dos Silfos (RemotePet)
// Carrega catálogos oficiais e implementa lógica de desafio, blitz e recompensas.
// Nunca inventa IDs, drops, monstros ou requisitos.
// ==========================================================================
const fs = require('node:fs');
const path = require('node:path');
const characterResources = require('./character-repository');
const configRoot = path.resolve(__dirname, '../res/release/config');

function loadCatalog(prefix) {
  const file = fs.readdirSync(configRoot).find(f => f.startsWith(prefix + '-') && f.endsWith('.json'));
  if (!file) return [];
  const data = JSON.parse(fs.readFileSync(path.join(configRoot, file), 'utf8'));
  return data[prefix] || [];
}

// Catálogos
const uiPlayBase = loadCatalog('t_s_uiplaybase');      // PlayId 100, 101, 211
const uiPlayLevel = loadCatalog('t_s_uiplaylevel');     // Fases por PlayId
const remotePetCatalog = loadCatalog('t_s_remotepet');   // Expedição dos Silfos
const dropItemCatalog = loadCatalog('t_s_dropitem');     // Drops
const configCatalog = loadCatalog('t_s_config');
const remotePetEnergyCost = Number(configCatalog.find(c => c.ConfigName === 'Remotepet_Weary')?.ConfigValue);
if (!Number.isSafeInteger(remotePetEnergyCost) || remotePetEnergyCost <= 0)
  throw Error('Custo de energia da Expedição ausente no catálogo');

// Índices
const levelsByPlayId = new Map();
for (const lv of uiPlayLevel) {
  const pid = Number(lv.UiPlayId);
  if (!levelsByPlayId.has(pid)) levelsByPlayId.set(pid, []);
  levelsByPlayId.get(pid).push(lv);
}
for (const [, arr] of levelsByPlayId) arr.sort((a, b) => Number(a.UiLevelSort) - Number(b.UiLevelSort));

const levelById = new Map();
for (const lv of uiPlayLevel) levelById.set(Number(lv.UiLevelId), lv);

const remotePetByIndex = new Map();
for (const rp of remotePetCatalog) remotePetByIndex.set(Number(rp.IndexID), rp);

const dropsByDropId = new Map();
for (const d of dropItemCatalog) {
  const did = Number(d.DropId);
  if (!dropsByDropId.has(did)) dropsByDropId.set(did, []);
  dropsByDropId.get(did).push(d);
}

// ---- Drop resolution (official Random weights) ----
function rollDrop(dropId) {
  const pool = dropsByDropId.get(Number(dropId));
  if (!pool || !pool.length) return [];
  const items = [];
  for (const entry of pool) {
    const odds = Number(entry.Random) || 0;
    // Random: weight out of ~1000 (per catalog convention). Roll independently.
    if (odds > 0 && Math.random() * 1000 < odds) {
      items.push({ itemId: Number(entry.ItemId), count: Number(entry.Data) || 1, bind: Number(entry.IsBind) || 0 });
    }
  }
  return items;
}

// ---- UiPlay state helpers ----
function ensureUiPlayState(saved) {
  if (!saved.uiPlay) saved.uiPlay = {};
  // Per-playId state: { [playId]: { levelSort, rewardCount, firstCleared: [levelId,...] } }
  for (const base of uiPlayBase) {
    const pid = String(base.UiPlayId);
    if (!saved.uiPlay[pid]) saved.uiPlay[pid] = { levelSort: 0, rewardCount: 0, firstCleared: [] };
  }
  return saved.uiPlay;
}

function formatUiPlayListMsg(saved, userId) {
  ensureUiPlayState(saved);
  const list = uiPlayBase.map(base => {
    const pid = Number(base.UiPlayId);
    const ps = saved.uiPlay[String(pid)] || { levelSort: 0, rewardCount: 0, firstCleared: [] };
    return {
      playId: pid,
      levelSort: Number(ps.levelSort) || 0,
      uiPlayRewardCount: Number(ps.rewardCount) || 0,
      firstRewardSet: Array.isArray(ps.firstCleared) ? ps.firstCleared.map(Number) : []
    };
  });
  return { uiPlayInfoList: list, uiPlayRewardCount: 0 };
}

function formatUiPlayInfoMsg(saved, playId) {
  ensureUiPlayState(saved);
  const ps = saved.uiPlay[String(playId)] || { levelSort: 0, rewardCount: 0, firstCleared: [] };
  return {
    playId: Number(playId),
    levelSort: Number(ps.levelSort) || 0,
    uiPlayRewardCount: Number(ps.rewardCount) || 0,
    firstRewardSet: Array.isArray(ps.firstCleared) ? ps.firstCleared.map(Number) : []
  };
}

/**
 * Desafio de Campanha dos Silfos.
 * op=1: challenge, op=2: blitz
 * Retorna { success, drops[], xp, gold, newLevelSort, isFirstClear, energyCost, error }
 */
function challengeUiPlay(saved, playId, levelId, op, heroGrade, addItemFn) {
  ensureUiPlayState(saved);
  const base = uiPlayBase.find(b => Number(b.UiPlayId) === Number(playId));
  if (!base) return { success: false, error: 'Campanha nao encontrada' };
  if (Number(heroGrade) < Number(base.Grade))
    return { success: false, error: `Nivel ${base.Grade} necessario` };

  // Verificar Silfo ativo para campanhas de Silfos (ParentType 1)
  if (Number(base.ParentType) === 1) {
    const pets = Array.isArray(saved.sylphs?.list) ? saved.sylphs.list : [];
    const activePet = pets.find(p => p && !p.isDel && Number(p.petId) === Number(saved.sylphs?.activePetId));
    if (!activePet) return { success: false, error: 'Silfo ativo necessario' };
  }

  const level = levelById.get(Number(levelId));
  if (!level || Number(level.UiPlayId) !== Number(playId))
    return { success: false, error: 'Fase nao encontrada nesta campanha' };

  const ps = saved.uiPlay[String(playId)];
  const levelSort = Number(level.UiLevelSort);

  // Verificar sequência: fase atual deve ser <= levelSort atual + 1
  if (levelSort > (Number(ps.levelSort) || 0) + 1)
    return { success: false, error: 'Fase ainda nao desbloqueada' };

  // Blitz: só permite fases já completadas
  if (Number(op) === 2 && levelSort > (Number(ps.levelSort) || 0))
    return { success: false, error: 'Blitz so permite fases ja completadas' };

  // Energia (ConsumeType 0 = stamina/energia do heroi)
  const energyCost = Number(level.ConsumeNum) || 50;
  const currentEnergy = characterResources.recoverTimedEnergy(saved).after;
  if (currentEnergy < energyCost)
    return { success: false, error: `Energia insuficiente (${currentEnergy}/${energyCost})` };

  // Tentativas de recompensa (10/dia conforme interface)
  const MAX_REWARD_ATTEMPTS = 10;
  const today = new Date().toISOString().slice(0, 10);
  if (!ps.lastRewardDate || ps.lastRewardDate !== today) {
    ps.lastRewardDate = today;
    ps.rewardCount = 0;
  }

  // Consumir energia
  characterResources.spendEnergy(saved, energyCost);

  // Para op=1 (challenge): vitória automática (servidor autoritativo, sem animação)
  // Para op=2 (blitz): recompensa direta
  const drops = [];
  let isFirstClear = false;

  // Conceder drops se ainda tem tentativas
  if (Number(ps.rewardCount) < MAX_REWARD_ATTEMPTS) {
    ps.rewardCount = (Number(ps.rewardCount) || 0) + 1;
    // Drop normal (Reward field = dropId)
    const normalDropId = Number(level.Reward);
    if (normalDropId) {
      const rolled = rollDrop(normalDropId);
      for (const item of rolled) {
        if (typeof addItemFn === 'function') addItemFn(saved, item.itemId, item.count);
        drops.push(item);
      }
    }
    // Primeira conclusão
    if (!Array.isArray(ps.firstCleared)) ps.firstCleared = [];
    if (!ps.firstCleared.includes(Number(levelId))) {
      isFirstClear = true;
      ps.firstCleared.push(Number(levelId));
      const firstDropId = Number(level.FristReward);
      if (firstDropId) {
        const firstRolled = rollDrop(firstDropId);
        for (const item of firstRolled) {
          if (typeof addItemFn === 'function') addItemFn(saved, item.itemId, item.count);
          drops.push(item);
        }
      }
    }
  }

  // Avançar levelSort se completou nova fase
  if (levelSort > (Number(ps.levelSort) || 0)) {
    ps.levelSort = levelSort;
  }

  return {
    success: true,
    drops,
    energyCost,
    isFirstClear,
    newLevelSort: ps.levelSort,
    rewardCount: ps.rewardCount
  };
}

// ---- RemotePet (Expedição dos Silfos) helpers ----
function ensureRemotePetState(saved) {
  if (!saved.remotePet) saved.remotePet = {};
  const rp = saved.remotePet;
  if (!Number.isInteger(rp.nowIndex)) rp.nowIndex = 0;
  if (!Number.isInteger(rp.MaxIndex)) rp.MaxIndex = 0;
  if (!rp.sweepIndex) rp.sweepIndex = 0;
  if (!rp.fight) rp.fight = 0;
  // A interface usa a energia do personagem. O antigo contador separado era
  // invisível para o jogador e bloqueava tentativas com energia disponível.
  return rp;
}

function grantRemotePetRewards(saved, phase, addItemFn) {
  let gold = 0;
  const items = [];
  for (const entry of String(phase.DropItems || '').split(',')) {
    if (!entry) continue;
    const [rawId, rawCount] = entry.split('|');
    const id = Number(rawId), count = Number(rawCount);
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(count) || count < 1)
      throw Error('Recompensa de Expedição inválida: ' + entry);
    if (id === -100) gold += count;
    else if (id > 0) {
      if (typeof addItemFn !== 'function') throw Error('Entrega de item indisponível');
      addItemFn(saved, id, count);
      items.push({ itemId: id, count });
    } else throw Error('Tipo de recompensa desconhecido: ' + id);
  }
  if (gold) {
    saved.wallet ??= {};
    saved.wallet.gold = Number(saved.wallet.gold || 0) + gold;
  }
  return { gold, items };
}

/**
 * Desafio de Expedição dos Silfos (op=6).
 * Retorna { success, drops[], goldReward, newIndex, error }
 */
function challengeRemotePet(saved, index, addItemFn) {
  const check = validateRemotePetChallenge(saved, index);
  if (!check.success) return check;
  const { rp, phase, cost } = check;
  characterResources.spendEnergy(saved, cost);
  rp.nowIndex = Number(index);
  if (Number(index) > (Number(rp.MaxIndex) || 0)) rp.MaxIndex = Number(index);
  const reward = grantRemotePetRewards(saved, phase, addItemFn);
  return { success: true, drops: reward.items, goldReward: reward.gold,
    energyCost: cost, newIndex: rp.nowIndex, maxIndex: rp.MaxIndex };
}

function validateRemotePetChallenge(saved, index) {
  const rp = ensureRemotePetState(saved);
  const phase = remotePetByIndex.get(Number(index));
  if (!phase) return { success: false, error: `Fase ${index} nao encontrada na Expedicao` };

  // Deve ser a fase atual + 1 (ou fase 1 se nunca completou)
  const expectedIndex = (Number(rp.nowIndex) || 0) + 1;
  if (Number(index) !== expectedIndex)
    return { success: false, error: `Fase ${index} fora de sequencia (esperado ${expectedIndex})` };

  // Energia (30 por tentativa conforme catálogo)
  const cost = remotePetEnergyCost;
  const energy = characterResources.recoverTimedEnergy(saved).after;
  if (energy < cost)
    return { success: false, error: `Energia insuficiente (${energy}/${cost})` };
  if (!(saved.sylphs?.list || []).some(p => p && !p.isDel))
    return { success: false, error: 'Silfo necessario para a Expedicao' };
  return { success: true, rp, phase, cost };
}

/**
 * Blitz/Sweep de Expedição dos Silfos (op=7).
 * Varre fases já completadas até sweepIndex.
 */
function blitzRemotePet(saved, sweepUpTo, addItemFn) {
  const rp = ensureRemotePetState(saved);
  const maxSweep = Number(rp.MaxIndex) || 0;
  const requested = Number(sweepUpTo);
  const target = Number.isSafeInteger(requested) && requested > 0 ? requested : maxSweep;
  if (target > maxSweep || target <= Number(rp.nowIndex || 0))
    return { success: false, error: 'Nenhuma fase disponivel para blitz' };

  let totalGold = 0;
  let swept = 0;
  const rewards = [];
  const cost = remotePetEnergyCost;

  for (let i = Number(rp.nowIndex || 0) + 1; i <= target; i++) {
    if (characterResources.recoverTimedEnergy(saved).after < cost) break;
    const phase = remotePetByIndex.get(i);
    if (!phase) throw Error('Fase de blitz ausente: ' + i);
    characterResources.spendEnergy(saved, cost);
    swept++;
    const reward = grantRemotePetRewards(saved, phase, addItemFn);
    totalGold += reward.gold;
    rewards.push({ index: i, ...reward });
    rp.nowIndex = i;
  }
  if (!swept) return { success: false, error: 'Energia insuficiente para blitz' };
  rp.sweepIndex = rp.nowIndex;
  return { success: true, totalGold, swept, rewards, sweepIndex: rp.sweepIndex };
}

module.exports = {
  uiPlayBase,
  uiPlayLevel,
  levelsByPlayId,
  levelById,
  remotePetCatalog,
  remotePetByIndex,
  ensureUiPlayState,
  formatUiPlayListMsg,
  formatUiPlayInfoMsg,
  challengeUiPlay,
  ensureRemotePetState,
  challengeRemotePet,
  validateRemotePetChallenge,
  blitzRemotePet,
  rollDrop
};
