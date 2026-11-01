'use strict';

const fs = require('node:fs');
const path = require('node:path');

const configDir = path.resolve(__dirname, '../res/release/config');
function catalog(prefix) {
  const name = fs.readdirSync(configDir).find(file => file.startsWith(prefix + '-'));
  return name ? JSON.parse(fs.readFileSync(path.join(configDir, name), 'utf8'))[prefix] || [] : [];
}

const templates = new Map(catalog('t_s_mounttemplate').map(row => [Number(row.TemplateId), row]));
const upgrades = catalog('t_s_upgradetemplate').filter(row => Number(row.Types) === 18)
  .sort((a, b) => Number(a.Grades) - Number(b.Grades));
const TRAINING_ITEM = 208017;
const BASE_MOUNT = 1000;
const mountByItem = new Map([...templates.values()]
  .filter(row => Number(row.NeedItemId) > 0)
  .map(row => [Number(row.NeedItemId), Number(row.TemplateId)]));

const STABLE_MOUNTS = {
  1: 1000,
  2: 1006,
  3: 2001,
  4: 3001,
  5: 4001,
  6: 5001,
  7: 6001,
  8: 7001
};

function syncUnlockedMounts(mounts) {
  const maxGrade = Math.min(8, Math.max(1, Number(mounts.levelMax) || 1));
  for (let g = 1; g <= maxGrade; g++) {
    const mId = STABLE_MOUNTS[g];
    if (mId && !mounts.avatarInfo.some(item => Number(item.mountTempId) === mId)) {
      mounts.avatarInfo.push({ mountTempId: mId, isExist: true, starLevel: 0, blessing: 0 });
    }
  }
}

function ensure(saved) {
  const mounts = saved.mounts && typeof saved.mounts === 'object' ? saved.mounts : (saved.mounts = {});
  mounts.avatarInfo = Array.isArray(mounts.avatarInfo) ? mounts.avatarInfo : [];
  for (const key of ['power', 'intellect', 'physique', 'agility', 'powerGp', 'intellectGp', 'physiqueGp', 'agilityGp', 'mountTotalGp']) {
    mounts[key] = Math.max(0, Number(mounts[key]) || 0);
  }
  const grade = Number(saved.progression?.grade || saved.grade || 1);
  if (grade < 40 && (!mounts.avatarInfo || mounts.avatarInfo.length === 0)) {
    mounts.mountTempId = 0;
    mounts.levelMax = 0;
    return mounts;
  }
  mounts.mountTempId = Number(mounts.mountTempId) || BASE_MOUNT;
  // Property grade starts at 1; a cap of 1 makes the client's Treinar button
  // reject 0/25 as already maxed before it sends C_MOUNT_EDIT.
  mounts.levelMax = Math.max(2, Math.min(8, Number(mounts.levelMax) || 2));
  syncUnlockedMounts(mounts);
  return mounts;
}

function payloads(saved) {
  const mounts = ensure(saved);
  return {
    info: {
      mountTempId: mounts.mountTempId, power: mounts.power, intellect: mounts.intellect,
      physique: mounts.physique, agility: mounts.agility, speed: 0,
      powerGp: mounts.powerGp, intellectGp: mounts.intellectGp,
      physiqueGp: mounts.physiqueGp, agilityGp: mounts.agilityGp,
      mountTotalGp: mounts.mountTotalGp, levelMax: mounts.levelMax, discount: 0
    },
    avatars: { avatarInfo: mounts.avatarInfo.filter(item => templates.has(Number(item.mountTempId))), soulScore: 0 }
  };
}

function activate(saved, templateId) {
  const mounts = ensure(saved);
  const id = Number(templateId);
  const template = templates.get(id);
  if (!template) throw Error('Montaria desconhecida');
  const unlocked = mounts.avatarInfo.some(item => Number(item.mountTempId) === id && item.isExist);
  const needItemId = Number(template.NeedItemId);
  if (!needItemId) {
    if (unlocked) return { changed:false, moved:[] };
    throw Error('Esta montaria nao pode ser ativada por item');
  }
  const items = saved.inventory?.items || [];
  const tokens = items.filter(entry => Number(entry.templateId) === needItemId && Number(entry.bagType) === 1 && Number(entry.count) >= 1);
  if (!tokens.length) {
    if (unlocked) return { changed: false, moved: [] };
    throw Error(`Item ${needItemId} necessario para ativar montaria ${id}`);
  }
  // Um item desbloqueia a montaria; copias excedentes ficam preservadas no estado
  // da colecao, fora da mochila, para eventual compensacao ou reversao.
  mounts.archivedActivationItems = Array.isArray(mounts.archivedActivationItems) ? mounts.archivedActivationItems : [];
  const moved = [];
  let activationCost = unlocked ? 0 : 1;
  for (const token of tokens) {
    const archived = structuredClone(token);
    archived.count -= activationCost;
    activationCost = 0;
    if (archived.count > 0) mounts.archivedActivationItems.push({ ...archived, mountTempId: id });
    items.splice(items.indexOf(token), 1);
    moved.push({ bagType: 1, objectId: 0, pos: Number(token.pos) });
  }
  if (!items.length) saved.inventory.explicitlyCleared = true;
  if (!unlocked) mounts.avatarInfo.push({ mountTempId: id, isExist: true, starLevel: 0, blessing: 0 });
  return { changed: true, moved };
}

function archiveUnlockedTokens(saved) {
  const mounts = ensure(saved);
  const moved = [];
  for (const entry of [...mounts.avatarInfo]) {
    if (!entry.isExist) continue;
    const id = Number(entry.mountTempId);
    if (!Number(templates.get(id)?.NeedItemId)) continue;
    moved.push(...activate(saved, id).moved);
  }
  return moved;
}

function change(saved, templateId) {
  const mounts = ensure(saved);
  const id = Number(templateId);
  if (!mounts.avatarInfo.some(item => Number(item.mountTempId) === id && item.isExist)) throw Error('Montaria nao ativada');
  mounts.mountTempId = id;
}

function train(saved, propertyType, requestedCount, useBalens = true) {
  const mounts = ensure(saved);
  const property = { 0: ['power', 'powerGp'], 1: ['agility', 'agilityGp'], 2: ['intellect', 'intellectGp'], 5: ['physique', 'physiqueGp'] }[Number(propertyType)];
  if (!property) throw Error('Atributo de montaria invalido');
  const count = Number(requestedCount);
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw Error('Quantidade de treino invalida');
  const items = saved.inventory?.items || [];
  const stocks = items.filter(item => Number(item.templateId) === TRAINING_ITEM && Number(item.bagType) === 1);
  const totalStock = stocks.reduce((total, item) => total + Number(item.count || 0), 0);
  
  const moved = [];
  let whipsUsed = Math.min(count, totalStock);
  let balensNeeded = (count - whipsUsed) * 10;

  if (balensNeeded > 0) {
    saved.wallet = saved.wallet || { gold: 0, balens: 0, boundBalens: 0 };
    const curBound = Number(saved.wallet.boundBalens || 0);
    const curBalens = Number(saved.wallet.balens || 0);
    if (curBound + curBalens < balensNeeded) {
      if (totalStock < 1) {
        throw Error(`Chicotes de treino insuficientes e saldo insuficiente de Balens (requer ${balensNeeded})`);
      }
      // Se não tem balens suficientes para a diferença, usa apenas os chicotes disponíveis
      balensNeeded = 0;
    } else {
      if (curBound >= balensNeeded) {
        saved.wallet.boundBalens -= balensNeeded;
      } else {
        const remaining = balensNeeded - curBound;
        saved.wallet.boundBalens = 0;
        saved.wallet.balens -= remaining;
      }
    }
  }

  const actualCount = whipsUsed + (balensNeeded / 10);
  if (actualCount < 1) throw Error('Chicotes ou Balens insuficientes para o treinamento');

  let left = whipsUsed;
  for (const item of stocks) {
    if (!left) break;
    const used = Math.min(left, Number(item.count));
    item.count -= used;
    left -= used;
    moved.push({ bagType: 1, objectId: 0, pos: Number(item.pos), item: item.count ? item : null });
    if (!item.count) items.splice(items.indexOf(item), 1);
  }

  // Bônus estocástico de crítico (10-15% chance de +5 GP por clique)
  let gpGained = 0;
  for (let i = 0; i < actualCount; i++) {
    gpGained += (Math.random() < 0.12 ? 5 : 1);
  }

  mounts[property[1]] += gpGained;
  mounts.mountTotalGp += gpGained;

  let pointsToAdd = gpGained;
  while (pointsToAdd > 0) {
    const curLevel = Math.max(1, Math.min(8, Number(mounts.levelMax) || 2));
    const curThreshold = Number(upgrades.find(u => Number(u.Grades) === curLevel)?.Data) || (curLevel * 25);
    const neededToCap = Math.max(0, curThreshold - Number(mounts[property[0]] || 0));

    if (neededToCap > 0) {
      const added = Math.min(pointsToAdd, neededToCap);
      mounts[property[0]] += added;
      pointsToAdd -= added;
    }

    if (mounts[property[0]] >= curThreshold && mounts.levelMax < 8) {
      mounts.levelMax++;
      syncUnlockedMounts(mounts);
    } else {
      break;
    }
  }

  syncUnlockedMounts(mounts);
  return { moved, count: actualCount, gpGained, property: property[0] };
}

module.exports = { ensure, payloads, activate, archiveUnlockedTokens, change, train, templates, mountByItem, BASE_MOUNT, syncUnlockedMounts };
