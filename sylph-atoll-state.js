'use strict';
// Transicao de mapa do Atol dos Silfos. Nao concede itens, XP ou recompensas.
// Os IDs/destinos sao conferidos no catalogo; nunca usa spawn inventado.
const fs = require('node:fs');
const path = require('node:path');
const configRoot = path.resolve(__dirname, '../res/release/config');
const catalogCache = new Map();

function loadCatalogue(prefix) {
  if (catalogCache.has(prefix)) return catalogCache.get(prefix);
  const filename = fs.readdirSync(configRoot).find(f => f.startsWith(prefix + '-') && f.endsWith('.json'));
  if (!filename) throw Error(`Catalogo ${prefix} nao encontrado em ${configRoot}`);
  const rows = JSON.parse(fs.readFileSync(path.join(configRoot, filename), 'utf8'))[prefix];
  if (!Array.isArray(rows)) throw Error(`Catalogo ${prefix} invalido`);
  catalogCache.set(prefix,rows);
  return rows;
}

function getAtollMap(mapId, catalog = loadCatalogue('t_s_map')) {
  const id = Number(mapId);
  if (![20001,20002,20003,20004].includes(id)) throw Error(`Mapa ${id} nao pertence ao Atol dos Silfos`);
  const map = catalog.find(r => Number(r.Id) === id && Number(r.CampaignId) === 20000);
  if (!map) throw Error(`Mapa ${id} nao esta vinculado a campanha 20000 no t_s_map`);
  return map;
}
function isAtollMap(mapId) { return [20001,20002,20003,20004].includes(Number(mapId)); }

function resolvePortal(config = {}) {
  const mapNodes = config.mapNodes || loadCatalogue('t_s_mapnode');
  const maps = config.maps || loadCatalogue('t_s_map');
  const node = mapNodes.find(r => Number(r.Id) === 5 && Number(r.MapId) === 10000);
  if (!node || Number(node.MasterType) !== 171 || Number(node.MoveToMapId) !== 20001 || Number(node.MoveToNodeId) !== 2000101)
    throw Error('Portal dos Silfos (nó 5) diverge do t_s_mapnode original');
  const map = getAtollMap(Number(node.MoveToMapId), maps);
  return {node, map, mapId: Number(map.Id), targetNodeId: Number(node.MoveToNodeId)};
}

function resolveArrival(campaignNodes, config = {}) {
  const portal = resolvePortal(config);
  const arrival = campaignNodes?.get(portal.targetNodeId);
  if (!arrival || Number(arrival.CampaignId) !== portal.mapId)
    throw Error(`No ${portal.targetNodeId} do mapa ${portal.mapId} nao foi encontrado no t_s_campaigndata; entrada cancelada sem alterar personagem`);
  const x = Number(arrival.Property1), y = Number(arrival.Property2);
  const limitX = Number(portal.map.Width) / 20, limitY = Number(portal.map.Height) / 20;
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= limitX || y >= limitY)
    throw Error(`Coordenadas do no ${portal.targetNodeId} invalidas no mapa ${portal.mapId}: ${x},${y}`);
  return {...portal, spawn: {x,y}};
}

function enter(saved, grade, arrival) {
  if (Number(saved?.position?.mapId) !== 10000) throw Error('Portal acionado fora da Cidade das Nuvens');
  if (Number(grade) < Number(arrival.map.MinLevel) || !Number.isFinite(Number(grade)))
    throw Error(`Atol dos Silfos exige nivel ${arrival.map.MinLevel}`);
  const previous = saved.position;
  // Dentro do alcance real do portal (coordenadas em tiles do mapa Cloud).
  if (Math.hypot(Number(previous.x) - Number(arrival.node.PosX), Number(previous.y) - Number(arrival.node.PosY)) > Math.max(10, Number(arrival.node.HandlerRange) + 6))
    throw Error('Personagem distante do portal dos Silfos');
  saved.sylphAtoll = {returnX:Number(previous.x),returnY:Number(previous.y), mapId:arrival.mapId, entryNodeId:arrival.targetNodeId};
  saved.position = {...previous, mapId:arrival.mapId, x:arrival.spawn.x, y:arrival.spawn.y};
  return {state:saved,position:saved.position};
}
function leave(saved, cloudMapId = 10000) {
  if (!isAtollMap(saved.position?.mapId)) throw Error('Personagem nao esta no Atol');
  const info = saved.sylphAtoll;
  const x = (info && Number.isSafeInteger(info.returnX)) ? info.returnX : 245;
  const y = (info && Number.isSafeInteger(info.returnY)) ? info.returnY : 175;
  saved.position = {...saved.position,mapId:cloudMapId,x,y};
  delete saved.sylphAtoll;
  return {state:saved,position:saved.position};
}
function move(saved, playerId, request, map) {
  if (!isAtollMap(saved?.position?.mapId)) throw Error('Movimento fora do Atol');
  const actor = Array.isArray(request?.players) ? request.players.find(p=>Number(p.playerId)===Number(playerId)) : null;
  if (!actor || !Array.isArray(actor.path) || actor.path.length < 1 || actor.path.length > 200)
    throw Error('Trajeto do Atol invalido');
  const maxX = Number(map.Width), maxY = Number(map.Height);
  let x = Number(saved.position.x)*20, y = Number(saved.position.y)*20, length = 0;
  for (const p of actor.path) {
    if (!Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.y) || p.x < 0 || p.y < 0 || p.x >= maxX || p.y >= maxY)
      throw Error('Ponto fora dos limites do mapa do Atol');
    length += Math.hypot(p.x-x,p.y-y);
    if (length > 8000) throw Error('Caminho do Atol longo demais');
    x=p.x;y=p.y;
  }
  saved.position.x = Math.floor(x/20);
  saved.position.y = Math.floor(y/20);
  return {state:saved,position:saved.position};
}
module.exports={loadCatalogue,getAtollMap,isAtollMap,resolvePortal,resolveArrival,enter,leave,move};
