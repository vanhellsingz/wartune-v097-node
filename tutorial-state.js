'use strict';
const fs = require('node:fs'), path = require('node:path');
const pb = require('./original-protobuf'), hero = require('./hero-state'), inventory = require('./inventory-state');
const resource = require('./resource-state');
const { readTiles } = require('./world-state');
const configRoot = path.resolve(__dirname, '../res/release/config');

function catalog(name) {
  const file = fs.readdirSync(configRoot).find(f => f.startsWith(name + '-'));
  return JSON.parse(fs.readFileSync(path.join(configRoot, file), 'utf8'))[name];
}

const maps = new Map(catalog('t_s_map').filter(r => [10001, 10002].includes(r.Id)).map(r => [r.Id, r]));
const nodes = new Map(catalog('t_s_campaigndata').filter(r => maps.has(r.CampaignId)).map(r => [r.Id, r]));

const tileMaps = new Map([...maps.keys()].map(id => {
  const dir = path.resolve(__dirname, '../res/animation/maps/' + id);
  const file = fs.readdirSync(dir).find(f => f.startsWith(id + '-') && f.endsWith('.bin'));
  return [id, readTiles(path.join(dir, file))];
}));

const SOURCE = 'Ultra t_s_campaigndata; bundle rN.nodelist';

function copy(state) {
  return structuredClone(inventory.parseState(state));
}

function fail(message) {
  const e = new Error(message);
  e.code = 'ETUTORIAL';
  throw e;
}

function valid(mapId, x, y) {
  const m = maps.get(mapId);
  return !!m && Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < m.Width / 20 && y < m.Height / 20 && !!tileMaps.get(mapId)[x + '_' + y];
}

function current(state) {
  const t = state.tutorial;
  if (!t || t.version !== 1 || !maps.has(t.mapId) || !valid(t.mapId, t.position?.x, t.position?.y)) {
    fail('Tutorial state unavailable or invalid');
  }
  return t;
}

function packet(code, type, data) {
  return { code, type, data, payload: pb.encode(type, data) };
}

function nodeData(row, t) {
  const won = t.wonNodes.includes(row.Id);
  return {
    nodeId: row.Id,
    campDataId: row.Id,
    nodeName: row.NodeName_pt || row.NodeName_en || '',
    masterType: row.MasterType,
    sonType: row.SonType,
    preNodeIds: row.PreNodeIds,
    nextNodeIds: row.NextNodeIds,
    state: won ? 8 : row.NodeState,
    refreshSpeed: row.RefreshSpeed,
    posX: row.Property1,
    posY: row.Property2,
    curX: row.Property1,
    curY: row.Property2,
    level: row.Level,
    styleType: row.StyleType,
    attackTypes: row.AttackTypes,
    nameColor: row.NameColor,
    sizeType: row.SizeType,
    toward: row.Toward,
    resource: row.Resource,
    resetX: row.Property3,
    resetY: row.Property4,
    fixX: row.FixX,
    fixY: row.FixY,
    heroTempId: Number((row.Heros || '').split(',')[0]) || 0,
    handlerRange: row.HandlerRange,
    param1: row.Param1,
    param2: row.Param2,
    param3: row.Param3,
    param4: row.Param4,
    param5: row.Param5,
    visitUserIds: [],
    visitServerName: []
  };
}

function entryPackets(character, state = inventory.parseState(character.state_json), createdType = 1) {
  const t = current(state), m = maps.get(t.mapId);
  const { h, t: template } = hero.model({ ...character, state_json: state });
  const appearance = hero.appearance({ ...character, state_json: state });
  const player = {
    roomId: character.id,
    count: 1,
    currentRoomIndex: 0,
    playerState: 2,
    heroId: h.id,
    playerId: character.id,
    grades: character.grade,
    nickName: character.nickname,
    sex: character.sex,
    templateId: template.TemplateId,
    ...appearance,
    armyId: h.armyId,
    curPosX: t.position.x,
    curPosY: t.position.y,
    campaignId: t.mapId,
    onlineState: true,
    armyState: 0,
    teamId: 1,
    headId: h.headId,
    serverName: '',
    consortiaName: '',
    hp: template.Live,
    maxHp: template.Live,
    hide: false,
    hat: '',
    fashionArm: '',
    fashionCloth: ''
  };
  const room = {
    roomId: character.id,
    campaignId: t.mapId,
    masterId: character.id,
    name: m.MapName_pt || m.MapName_en,
    count: 1,
    capacity: 1,
    roomState: 1,
    roomType: 0,
    isSetPassword: false,
    roomPlayer: [player],
    masterServerName: ''
  };
  return [
    packet(125, 'room.RoomCreatedMsg', { createdType, room, isCross: false, campignId: m.CampaignId }),
    packet(21, 'room.RoomEnterMsg', { result: 1, player: [player], userIds: [character.id] }),
    packet(127, 'campaign.CampaignNodeListMsg', { node: [...nodes.values()].filter(r => r.CampaignId === t.mapId).map(r => nodeData(r, t)) })
  ];
}

function enter(state, request = { type: 1 }, now = Date.now()) {
  const next = copy(state);
  if (request.type !== 1) fail('Only initial tutorial request supported');
  if (!next.tutorial) {
    const start = nodes.get(1000101);
    next.tutorial = {
      version: 1,
      mapId: 10001,
      position: { x: start.Property1, y: start.Property2 },
      enteredAt: now,
      completed: [],
      wonNodes: [],
      source: SOURCE
    };
  }
  current(next);
  return next;
}

function acknowledge(state, id, now = Date.now()) {
  const next=copy(state),t=current(next);
  if(!Number.isInteger(id))fail('Invalid tutorial step');
  if(t.completed.includes(id))return {state:next,duplicate:true,completed150:false};
  const won=n=>t.wonNodes.includes(n),done=n=>t.completed.includes(n);
  const allowed={10:t.mapId===10001&&now-t.enteredAt>=1000,20:won(1000103),50:won(1000104),70:won(1000106),90:t.mapId===10001&&won(1000106),110:t.mapId===10001&&won(1000106)&&done(90),140:t.mapId===10002&&won(1000203),150:t.mapId===10002&&won(1000205)};
  if(!allowed[id])fail('Tutorial step prerequisites not satisfied');
  t.completed.push(id);next.newNoviceProcess=t.completed.join('_');
  if(id===10)t.position={x:29,y:65};
  if(id===150)next.systemsOpen=[...new Set([...(next.systemsOpen||[]),101,10101,10102])];
  return {state:next,duplicate:false,completed150:id===150};
}

function arrive(state, nodeId, currentGrade = 1, now = Date.now()) {
  const next = copy(state), t = current(next);
  const node = nodes.get(nodeId);
  if (!node || node.CampaignId !== t.mapId) fail('Node is outside current tutorial map');

  // Node 1000107 is Dinah (NPC dialogue). Must NOT be destroyed or added to wonNodes.
  if (nodeId === 1000107) {
    return {
      state: next,
      duplicate: false,
      isNpc: true,
      newGrade: currentGrade,
      gold: next.wallet?.gold || 0,
      totalXp: next.progression?.totalXp || 0,
      currentXp: next.progression?.currentXp || 0,
      packets: []
    };
  }

  // Node 1000108 is the portal from Map 10001 to Map 10002.
  // Must NOT be destroyed or added to wonNodes. Signals map transfer.
  if (nodeId === 1000108) {
    return {
      state: next,
      duplicate: false,
      isTransfer: true,
      mapId: 10001,
      nodeId: 1000108,
      cmd: 2,
      newGrade: currentGrade,
      gold: next.wallet?.gold || 0,
      totalXp: next.progression?.totalXp || 0,
      currentXp: next.progression?.currentXp || 0,
      packets: []
    };
  }

  // Obstacle nodes (1000110, 1000208) - unblock path without awarding XP or gold
  if (nodeId === 1000110 || nodeId === 1000208) {
    if (!t.wonNodes.includes(nodeId)) t.wonNodes.push(nodeId);
    const nodeUpdatePacket = packet(128, 'campaign.CampaignNodeUpdateMsg', {
      nodeId,
      nodeState: 8,
      visitUserIds: [],
      userIds: [],
      visitServerName: []
    });
    return {
      state: next,
      duplicate: false,
      isObstacle: true,
      newGrade: currentGrade,
      gold: next.wallet?.gold || 0,
      totalXp: next.progression?.totalXp || 0,
      currentXp: next.progression?.currentXp || 0,
      packets: [nodeUpdatePacket]
    };
  }

  if (t.wonNodes.includes(nodeId)) return { state: next, duplicate: true, packets: [] };
  // Arrival is not a battle result. Never grant XP or a victory without a server battle engine.
  fail('Combate bloqueado: resultado de batalha autoritativo ainda nao implementado; nenhuma recompensa concedida.');

}

function transferMap(character, state, mapId = 10001, nodeId = 1000108, cmd = 2) {
  const next = copy(state), t = current(next);
  if (t.mapId === 10002) {
    // Already in Map 10002; idempotent
    return { state: next, packets: entryPackets(character, next, 3) };
  }
  if (mapId === 10001 && [1000106, 1000108].includes(Number(nodeId)) && Number(cmd) === 2 && t.wonNodes.includes(1000106)) {
    if (!t.completed.includes(90)) t.completed.push(90);
    if (!t.completed.includes(110)) t.completed.push(110);
    next.newNoviceProcess = t.completed.join('_');
    t.mapId = 10002;
    t.position = { x: 71, y: 69 };
  } else {
    fail('Invalid campaign transfer parameters');
  }
  const entry = entryPackets(character, next, 3);
  return { state: next, packets: entry };
}

function movement(state, request) {
  const next = copy(state), t = current(next);
  if (request.mapId !== t.mapId || (request.armyId && next.hero?.armyId && request.armyId !== next.hero?.armyId)) {
    fail('Tutorial map or army ownership mismatch');
  }
  if (!Array.isArray(request.routes) || !request.routes.length || request.routes.length > 200) {
    fail('Invalid tutorial route');
  }
  let x = t.position.x * 20, y = t.position.y * 20, total = 0;
  for (const point of request.routes) {
    if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) fail('Invalid tutorial route point');
    const distance = Math.hypot(point.x - x, point.y - y);
    total += distance;
    if (total > 3500) fail('Tutorial route too long');
    const steps=Math.max(1,Math.ceil(distance/10));
    for(let step=1;step<=steps;step++){
      const tileX=Math.floor((x+(point.x-x)*step/steps)/20);
      const tileY=Math.floor((y+(point.y-y)*step/steps)/20);
      if(!valid(t.mapId,tileX,tileY))fail('Tutorial route crosses obstacle');
    }
    x = point.x;
    y = point.y;
  }
  t.position = { x: Math.floor(x/20), y: Math.floor(y/20) };
  return next;
}

module.exports = {
  maps,
  nodes,
  valid,
  enter,
  current,
  entryPackets,
  acknowledge,
  arrive,
  transferMap,
  movement
};
