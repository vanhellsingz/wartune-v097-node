'use strict';

// Frames use the item TemplateId as frameId in the LayaAir frame model.
// This is evidenced by the client resolving FrameInfoMsg.frameId through
// getGoodsTemplatesByTempleteId(frameId).
function frames(state) {
  const saved = state.avatarFrames && typeof state.avatarFrames === 'object' ? state.avatarFrames : {};
  const owned = Array.isArray(saved.owned) ? saved.owned.map(Number) : [];
  const unique = [...new Set(owned.filter(id => Number.isSafeInteger(id) && id > 0))];
  const equipped = Number(saved.equipped || 0);
  return state.avatarFrames = { owned: unique, equipped: unique.includes(equipped) ? equipped : 0 };
}

function activate(state, template) {
  const id = Number(template?.TemplateId);
  if (Number(template?.MasterType) !== 2 || Number(template?.SonType) !== 223 ||
      !Number.isSafeInteger(id) || id < 1 || !String(template?.Avata || '').startsWith('/headframe_')) {
    throw Error('Template nao e uma moldura de avatar valida');
  }
  const saved = frames(state);
  if (saved.owned.includes(id)) throw Error('Moldura ja ativada; item preservado');
  saved.owned.push(id);
  return { frameId: id, duplicate: false };
}

function equip(state, frameId) {
  const id = Number(frameId);
  if (!Number.isSafeInteger(id) || id < 0) throw Error('frameId invalido');
  const saved = frames(state);
  if (id !== 0 && !saved.owned.includes(id)) throw Error('Moldura nao ativada');
  saved.equipped = id;
  return id;
}

function formatList(state) {
  const saved = frames(state);
  return { op: 0, frames: saved.owned.map(frameId => ({ frameId, isUse: frameId === saved.equipped ? 1 : 0 })) };
}

module.exports = { frames, activate, equip, formatList };
