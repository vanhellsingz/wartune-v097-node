'use strict';

const MAX_AWAKE = 3000;
const ACTION_GAIN = 500;

function clamp(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_AWAKE, Math.trunc(n))) : 0;
}

function startingAwake(saved) {
  const value = saved?.sylphs?.awake;
  return value === undefined || value === null ? 100 : clamp(value);
}

function gainAwake(value) {
  return clamp(clamp(value) + ACTION_GAIN);
}

function saveAwake(saved, value) {
  if (!saved.sylphs || typeof saved.sylphs !== 'object') saved.sylphs = {};
  saved.sylphs.awake = clamp(value);
  return saved.sylphs.awake;
}

module.exports = { MAX_AWAKE, ACTION_GAIN, clamp, startingAwake, gainAwake, saveAwake };
