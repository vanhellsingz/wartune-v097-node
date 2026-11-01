'use strict';
function move(saved, request, options = {}) {
  const next = structuredClone(saved);
  const current = next.campaigns?.current;
  const reqMapId = Number(request.mapId);
  const reqArmyId = Number(request.armyId);
  const validArmyIds = new Set([
    Number(next.hero?.armyId),
    Number(next.hero?.id),
    Number(options.characterId),
    1
  ].filter(n => Number.isFinite(n) && n > 0));

  const curMapId = Number(next.position?.mapId || current?.mapId || next.tutorial?.mapId || 0);
  const matchMap = (reqMapId === curMapId || reqMapId === Number(current?.mapId) || reqMapId === Number(next.position?.mapId));
  if (!matchMap || (reqArmyId > 0 && !validArmyIds.has(reqArmyId))) {
    throw Error('Campanha ou exercito nao confere');
  }
  if (!Array.isArray(request.routes) || request.routes.length < 1 || request.routes.length > 300) {
    throw Error('Rota da campanha invalida');
  }
  const curPos = (reqMapId === Number(next.position?.mapId)) ? next.position : (current?.position || next.position || { x: 20, y: 20 });
  let x = (Number(curPos.x) || 20) * 20;
  let y = (Number(curPos.y) || 20) * 20;
  let total = 0;
  for (const point of request.routes) {
    if (!Number.isInteger(point.x) || !Number.isInteger(point.y) || point.x < 0 || point.y < 0 || point.x >= 50000 || point.y >= 50000) {
      throw Error('Ponto da campanha fora do mapa');
    }
    total += Math.hypot(point.x - x, point.y - y);
    if (total > 12000) throw Error('Rota da campanha longa demais');
    x = point.x;
    y = point.y;
  }
  const endPos = { x: Math.floor(x / 20), y: Math.floor(y / 20) };
  if (current && Number(current.mapId) === reqMapId) current.position = endPos;
  next.position = { mapId: reqMapId, x: endPos.x, y: endPos.y };
  return { state: next, position: endPos, mapId: reqMapId };
}
module.exports = { move };