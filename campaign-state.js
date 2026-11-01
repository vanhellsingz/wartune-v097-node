'use strict';

const fs = require('fs');
const path = require('path');
const pb = require('./original-protobuf');
const hero = require('./hero-state');
const inventory = require('./inventory-state');
const resource = require('./resource-state');

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

const rawCampaigns = loadCatalog('t_s_campaign');
const rawCampaignData = loadCatalog('t_s_campaigndata');
const rawMaps = loadCatalog('t_s_map');

const campaignById = new Map();
for (const c of rawCampaigns) {
  campaignById.set(Number(c.CampaignId), c);
}

const mapById = new Map();
for (const m of rawMaps) {
  mapById.set(Number(m.Id), m);
}

const CAMPAIGN_TO_MAP = {
  1: 10001,
  1001: 1021,
  1002: 1141,
  1003: 1031,
  1004: 1061,
  1005: 1081,
  1006: 1161,
  1007: 1181,
  1101: 1111,
  1102: 1201,
  1103: 1211,
  1104: 1091,
  1105: 1231,
  1106: 1261,
  1107: 1271,
  1201: 1301,
  1202: 1311,
  1203: 1341,
  1204: 1351,
  1205: 1371,
  1206: 1401
};

const MAP_TO_CAMPAIGN = {
  10001: 1, 10002: 1,
  1021: 1001,
  1141: 1002, 1142: 1002,
  1031: 1003, 1032: 1003,
  1061: 1004,
  1081: 1005, 1082: 1005, 1083: 1005,
  1161: 1006,
  1181: 1007, 1182: 1007,
  1111: 1101,
  1201: 1102, 1202: 1102,
  1211: 1103, 1212: 1103,
  1091: 1104,
  1231: 1105, 1232: 1105,
  1261: 1106, 1262: 1106,
  1271: 1107, 1272: 1107,
  1301: 1201, 1302: 1201,
  1311: 1202, 1312: 1202, 1313: 1202,
  1341: 1203, 1342: 1203,
  1351: 1204, 1352: 1204,
  1371: 1205,
  1401: 1206, 1402: 1206
};

for (const [cId, mId] of Object.entries(CAMPAIGN_TO_MAP)) {
  if (!MAP_TO_CAMPAIGN[mId]) MAP_TO_CAMPAIGN[mId] = Number(cId);
}

// Ordena por Id crescente para sempre associar o 1º estágio à campanha
const sortedMaps = [...rawMaps].sort((a, b) => Number(a.Id) - Number(b.Id));
const catalogFirstMap = new Set(Object.keys(CAMPAIGN_TO_MAP).map(Number));
for (const map of sortedMaps) {
  const campaignId = Number(map.CampaignId), mapId = Number(map.Id);
  if (!campaignById.has(campaignId)) continue;
  MAP_TO_CAMPAIGN[mapId] = campaignId;
  if (!catalogFirstMap.has(campaignId)) {
    CAMPAIGN_TO_MAP[campaignId] = mapId;
    catalogFirstMap.add(campaignId);
  }
}

// Mapeamento EXCLUSIVO das campanhas multiplayer extraido do t_s_map original.
// Os mapas e a campanha sao coisas distintas: 9000 e campanha; 2091 e mapa inicial.
// Mantem os pares mesmo se a copia instalada do t_s_map estiver com CampaignId=0.
const MPD_MAPS_CONFERIDOS = {
  2311: [2311],
  5902: [2351, 2352, 2353],
  5911: [5911, 5912, 5913, 5914, 5915],
  5921: [5921, 5922, 5923, 5924, 5925],
  5931: [5931, 5932, 5933, 5934, 5935],
  9000: [2091, 2092],
  9001: [2011, 2012],
  9002: [2031, 2032, 2033],
  9003: [2051, 2052, 2053, 2054],
  9004: [2071, 2072, 2073, 2074, 2075],
  9005: [2111, 2112, 2114],
  9006: [2131, 2132, 2133],
  9007: [2151, 2152, 2153],
  9008: [2171, 2172, 2173],
  9009: [2191, 2192, 2193],
  9010: [2211, 2212, 2213, 2214, 2215],
  9011: [2231, 2232, 2233],
  9012: [2251, 2252, 2253],
  9013: [2271],
  9104: [2081, 2082, 2083, 2084, 2085],
  9105: [2121, 2122, 2124],
  9106: [2141, 2142, 2143],
  9107: [2161, 2162, 2163],
  9108: [2181, 2182, 2183],
  9109: [2201, 2202, 2203],
  9110: [2221, 2222, 2223, 2224, 2225],
  9111: [2241, 2242, 2243],
  9112: [2261, 2262, 2263],
  9113: [2281],
  9213: [2341],
};
for (const [campaignIdText, stageIds] of Object.entries(MPD_MAPS_CONFERIDOS)) {
  const campaignId = Number(campaignIdText);
  CAMPAIGN_TO_MAP[campaignId] = stageIds[0];
  for (const mapId of stageIds) MAP_TO_CAMPAIGN[mapId] = campaignId;
}

const nodesByCampaign = new Map();
const nodeById = new Map();

for (const n of rawCampaignData) {
  nodeById.set(Number(n.Id), n);
  const cId = Number(n.CampaignId);
  if (!nodesByCampaign.has(cId)) nodesByCampaign.set(cId, []);
  nodesByCampaign.get(cId).push(n);
}

const CAMPAIGN_ALIASES = {
  1008: 1101, 1009: 1102, 1010: 1103,
  2000: 9000, 2001: 9001, 2002: 9002, 2003: 9003, 2004: 9004,
  2005: 9005, 2006: 9006, 2007: 9007, 2008: 9008, 2009: 9009, 2010: 9010
};

function resolveMapForCampaign(campaignId) {
  let cId = Number(campaignId);
  if (CAMPAIGN_ALIASES[cId]) cId = CAMPAIGN_ALIASES[cId];
  if (CAMPAIGN_TO_MAP[cId]) return CAMPAIGN_TO_MAP[cId];
  const fromMap = rawMaps.find(m => Number(m.CampaignId) === cId);
  if (fromMap) {
    const mId = Number(fromMap.Id);
    CAMPAIGN_TO_MAP[cId] = mId;
    MAP_TO_CAMPAIGN[mId] = cId;
    return mId;
  }
  if (nodesByCampaign.has(cId) || mapById.has(cId)) return cId;
  throw new Error(`Campanha ${cId} sem mapa no catalogo`);
}

function resolveCampaignForMap(mapId) {
  let mId = Number(mapId);
  if (CAMPAIGN_ALIASES[mId]) return CAMPAIGN_ALIASES[mId];
  if (MAP_TO_CAMPAIGN[mId]) return MAP_TO_CAMPAIGN[mId];
  const fromMap = rawMaps.find(m => Number(m.Id) === mId);
  if (fromMap && Number(fromMap.CampaignId) > 0) {
    const cId = Number(fromMap.CampaignId);
    MAP_TO_CAMPAIGN[mId] = cId;
    return cId;
  }
  if (campaignById.has(mId)) return mId;
  throw new Error(`Mapa ${mId} sem campanha no catalogo`);
}

function getNodesForMap(mapId) {
  const mId = Number(mapId);
  if (nodesByCampaign.has(mId)) {
    return nodesByCampaign.get(mId);
  }
  const cId = resolveCampaignForMap(mId);
  const firstMap = CAMPAIGN_TO_MAP[cId];
  if (firstMap && nodesByCampaign.has(firstMap)) {
    return nodesByCampaign.get(firstMap);
  }
  if (nodesByCampaign.has(cId)) {
    return nodesByCampaign.get(cId);
  }
  return [];
}

function getAllNodesForCampaign(campaignId) {
  const cId = Number(campaignId);
  const result = [];
  for (const [mId, mappedCampId] of Object.entries(MAP_TO_CAMPAIGN)) {
    if (Number(mappedCampId) === cId && nodesByCampaign.has(Number(mId))) {
      result.push(...nodesByCampaign.get(Number(mId)));
    }
  }
  return result;
}

function towerFloor(mapId) {
  const id = Number(mapId);
  if (id >= 8001 && id <= 8100) return { campaignId: 8001, floor: id - 8000 };
  if (id >= 8101 && id <= 8130) return { campaignId: 8101, floor: id - 8100 };
  if (id >= 8301 && id <= 8330) return { campaignId: 8301, floor: id - 8300 };
  return null;
}

function advanceTowerFloor(saved, currentMapId, nextMapId) {
  const from = towerFloor(currentMapId), to = towerFloor(nextMapId);
  if (!from) return null;
  if (!to || to.campaignId !== from.campaignId || to.floor !== from.floor + 1)
    throw Error('Transicao de andar invalida');
  const tower = saved.towers?.[from.campaignId];
  if (!tower || Number(tower.floor) !== from.floor)
    throw Error('Andar atual do labirinto inconsistente');
  const defeated = saved.campaigns?.current?.runWonNodes || [];
  const monsters = getNodesForMap(currentMapId).filter(n => [41, 42].includes(Number(n.MasterType)));
  if (monsters.some(n => !defeated.includes(Number(n.Id))))
    throw Error('Derrote os monstros deste andar antes de avancar');
  tower.floor = to.floor;
  tower.maxIndex = Math.max(Number(tower.maxIndex) || 0, to.floor);
  if (to.campaignId === 8001)
    saved.catacombs_max_floor = Math.max(Number(saved.catacombs_max_floor) || 0, to.floor);
  return to;
}

function recordTowerVictory(saved, mapId, nodeId, xp, gold) {
  const info = towerFloor(mapId);
  if (!info) return null;
  const tower = saved.towers?.[info.campaignId];
  if (!tower || Number(tower.floor) !== info.floor) return null;
  tower.rewardedNodes = Array.isArray(tower.rewardedNodes) ? tower.rewardedNodes : [];
  if (tower.rewardedNodes.includes(Number(nodeId))) return info;
  tower.rewardedNodes.push(Number(nodeId));
  tower.totalGp = (Number(tower.totalGp) || 0) + Number(xp || 0);
  tower.totalGold = (Number(tower.totalGold) || 0) + Number(gold || 0);
  if (info.campaignId === 8001 && info.floor === 100)
    saved.catacombs_max_floor = 100;
  return info;
}

function ensureCampaignState(savedState, grade = 5) {
  if (!savedState) savedState = {};
  if (!savedState.campaigns || typeof savedState.campaigns !== 'object') {
    savedState.campaigns = {
      unlocked: [1001],
      completed: [],
      current: null,
      wonNodes: {}
    };
  }
  const cState = savedState.campaigns;
  if (!Array.isArray(cState.unlocked)) cState.unlocked = [1001];
  if (!Array.isArray(cState.completed)) cState.completed = [];
  if (!cState.wonNodes || typeof cState.wonNodes !== 'object') cState.wonNodes = {};

  if (!cState.unlocked.includes(1001)) {
    cState.unlocked.push(1001);
  }

  const playerGrade = Number(grade) || 1;
  for (const c of campaignById.values()) {
    const minLvl = Number(c.MinLevel) || 1;
    const preId = Number(c.PreCampaignId) || 0;
    const campId = Number(c.CampaignId);
    if (campId >= 1000 && playerGrade >= minLvl) {
      if (preId === 0 || cState.completed.includes(preId)) {
        if (!cState.unlocked.includes(campId)) {
          cState.unlocked.push(campId);
        }
      }
    }
  }
  return savedState;
}

function packet(code, typeName, data) {
  return { code, type: typeName, data, payload: pb.encode(typeName, data) };
}

function unlockNextCampaigns(state, campaignId) {
  if (!state.campaigns) state.campaigns = { unlocked: [1001], completed: [] };
  if (!Array.isArray(state.campaigns.unlocked)) state.campaigns.unlocked = [1001];
  if (!Array.isArray(state.campaigns.completed)) state.campaigns.completed = [];
  const cId = Number(campaignId);
  if (cId > 0 && !state.campaigns.completed.includes(cId)) {
    state.campaigns.completed.push(cId);
  }
  const camp = campaignById.get(cId);
  if (camp && camp.NextCampaignId && !state.campaigns.unlocked.includes(Number(camp.NextCampaignId))) {
    state.campaigns.unlocked.push(Number(camp.NextCampaignId));
  }
  for (const c of campaignById.values()) {
    if (Number(c.PreCampaignId) === cId && !state.campaigns.unlocked.includes(Number(c.CampaignId))) {
      state.campaigns.unlocked.push(Number(c.CampaignId));
    }
  }
}

function trialChallengeNodes(mapId) {
  if (![8201, 8205].includes(Number(mapId))) return [];
  return getNodesForMap(mapId).filter(row => Number(row.SonType) === 2174 &&
    String(row.Heros || '').trim()).sort((a, b) => Number(a.Id) - Number(b.Id));
}

function isTrialGuard(row) {
  return [8201, 8205].includes(Number(row?.CampaignId)) &&
    String(row?.AI || '').endsWith('.CNTrialAi') && !String(row?.Heros || '').trim();
}

function nextTrialChallenge(mapId, wonNodes = []) {
  const won = new Set(wonNodes.map(Number));
  return trialChallengeNodes(mapId).find(row => !won.has(Number(row.Id))) || null;
}

function formatNodeData(row, wonNodes = [], trialStarted = false) {
  const isWon = wonNodes.includes(Number(row.Id));
  const trialNodes = trialChallengeNodes(row.CampaignId);
  const isTrialChallenge = trialNodes.some(node => Number(node.Id) === Number(row.Id));
  const activeTrial = trialStarted && Number(nextTrialChallenge(row.CampaignId, wonNodes)?.Id) === Number(row.Id);
  return {
    nodeId: Number(row.Id),
    campDataId: Number(row.Id),
    nodeName: row.NodeName_pt || row.NodeName_en || '',
    masterType: Number(row.MasterType),
    sonType: Number(row.SonType),
    preNodeIds: Number(row.PreNodeIds) || 0,
    nextNodeIds: Number(row.NextNodeIds) || 0,
    state: isTrialGuard(row) ? 1 : isWon ? 8 : isTrialChallenge ? (activeTrial ? 1 : 9) : (Number(row.NodeState) || 1),
    refreshSpeed: Number(row.RefreshSpeed) || 1,
    posX: Number(row.Property1) || 0,
    posY: Number(row.Property2) || 0,
    curX: Number(row.Property1) || 0,
    curY: Number(row.Property2) || 0,
    level: Number(row.Level) || 0,
    styleType: Number(row.StyleType) || 1,
    attackTypes: Number(row.AttackTypes) || 0,
    nameColor: Number(row.NameColor) || 0,
    sizeType: Number(row.SizeType) || 0,
    toward: Number(row.Toward) || 0,
    resource: [41, 42].includes(Number(row.MasterType)) ? 1 : (Number(row.Resource) || 1),
    resetX: Number(row.Property3) || 0,
    resetY: Number(row.Property4) || 0,
    fixX: Number(row.FixX) || 0,
    fixY: Number(row.FixY) || 0,
    heroTempId: Number((row.Heros || '').split(',')[0]) || 0,
    handlerRange: Number(row.HandlerRange) || 0,
    param1: Number(row.Param1) || 0,
    param2: Number(row.Param2) || 0,
    param3: row.Param3 ? String(row.Param3) : '',
    param4: row.Param4 ? String(row.Param4) : '',
    param5: row.Param5 ? String(row.Param5) : '',
    visitUserIds: [],
    visitServerName: []
  };
}

function resolveHeroAndAppearance(character, state) {
  try {
    const { h, t: template } = hero.model({ ...character, state_json: state });
    const appearance = hero.appearance({ ...character, state_json: state });
    return { heroId: h.id, templateId: template.TemplateId, armyId: h.armyId, headId: h.headId, live: template.Live, appearance };
  } catch (e) {
    const job = Number(character.job) || 1;
    const sex = Number(character.sex) || 1;
    let templateId = 1;
    if (job === 1 && sex === 1) templateId = 1;
    else if (job === 1 && sex === 0) templateId = 4;
    else if (job === 2 && sex === 1) templateId = 2;
    else if (job === 2 && sex === 0) templateId = 5;
    else if (job === 3 && sex === 1) templateId = 3;
    else if (job === 3 && sex === 0) templateId = 6;
    return {
      heroId: character.id || 1,
      templateId,
      armyId: 1,
      headId: templateId,
      live: 4000,
      appearance: { arm: '', cloth: '', wing: '' }
    };
  }
}

function enterCampaign(character, savedState, campaignOrMapId, options = {}) {
  const state = ensureCampaignState(savedState, character.grade);
  let id = Number(campaignOrMapId);
  if (!id || id <= 0) id = 1001;
  if (CAMPAIGN_ALIASES[id]) id = CAMPAIGN_ALIASES[id];

  let camp = options.resumeTower ? null : campaignById.get(id);
  let mapId;
  let campaignId;

  if (camp) {
    campaignId = id;
    mapId = resolveMapForCampaign(campaignId);
  } else {
    mapId = id;
    campaignId = resolveCampaignForMap(mapId);
    camp = campaignById.get(campaignId);
  }

  if (!camp) throw new Error(`Campanha ${id} desconhecida`);
  if (Number(camp.Capacity) < 1)
    throw new Error(`Campanha ${campaignId} com capacidade invalida`);
  const isTowerStage = Boolean(towerFloor(mapId) && towerFloor(mapId).campaignId === campaignId);
  if (mapId !== resolveMapForCampaign(campaignId) && !isTowerStage)
    throw new Error(`Entrada direta no estagio ${mapId} nao permitida`);

  if (camp.MinLevel && character.grade < camp.MinLevel) {
    throw new Error(`Nivel insuficiente para entrar em ${camp.CampaignName_pt || camp.CampaignName_en}: necessario ${camp.MinLevel}, atual ${character.grade}`);
  }

  if (campaignId === 8001 || (mapId >= 8001 && mapId <= 8030)) {
    if (character.grade < 23) {
      throw new Error(`As Catacumbas Esquecidas exigem Nível 23 (atual: ${character.grade})`);
    }
  }
  if (campaignId === 8101 || (mapId >= 8101 && mapId <= 8130)) {
    if (character.grade < 23) {
      throw new Error(`A Necrópole exige Nível 23 (atual: ${character.grade})`);
    }
    const catacombsFloor = Number(savedState.catacombs_max_floor || savedState.towerInfo1?.maxIndex || savedState.towers?.[8001]?.maxIndex || 0);
    if (character.grade < 50 && !state.campaigns.unlocked.includes(8101) && catacombsFloor < 100) {
      throw new Error(`A Necrópole está bloqueada! Requer atingir o Piso 100 das Catacumbas Esquecidas (atual: Piso ${catacombsFloor})`);
    }
  }

  const previous = Number(camp.PreCampaignId);
  if (previous && !state.campaigns.completed.includes(previous) &&
     !state.campaigns.unlocked.includes(campaignId)) {
    throw new Error(`Conclua a campanha ${previous} antes de entrar em ${campaignId}`);
  }

  const mapRow = mapById.get(mapId) || { MapName_pt: camp.CampaignName_pt, MapName_en: camp.CampaignName_en };
  const nodeList = getNodesForMap(mapId);

  if (!state.campaigns.wonNodes[campaignId]) {
    state.campaigns.wonNodes[campaignId] = [];
  }

  const spawnNode = nodeList.find(n => n.MasterType === 40) || nodeList[0] || { Property1: 18, Property2: 86 };

  const towerResume = options.resumeTower ? towerFloor(mapId) : null;
  const towerProgress = towerResume ? state.towers?.[towerResume.campaignId] : null;
  const resumedNodes = towerProgress ? [
    ...(towerProgress.rewardedNodes || []), ...(towerProgress.openedChests || []),
    ...(Number(state.campaigns.current?.mapId) === mapId
      ? state.campaigns.current.runWonNodes || [] : [])
  ].map(Number).filter(nId => nodeList.some(node => Number(node.Id) === nId)) : [];

  state.campaigns.current = {
    campaignId,
    mapId,
    position: { x: spawnNode.Property1, y: spawnNode.Property2 },
    enteredAt: Date.now(),
    runWonNodes: [...new Set(resumedNodes)]
  };
  state.lastScene = (Number(savedState.position?.mapId) === 10000) ? 'cloud' : 'castle';
  const wonList = state.campaigns.current.runWonNodes;

  const heroData = resolveHeroAndAppearance(character, state);

  const mpdRoom = options.mpdRoom && Number.isSafeInteger(Number(options.mpdRoom.roomId))
    ? options.mpdRoom : null;
  const effectiveRoomId = mpdRoom ? Number(mpdRoom.roomId) : character.id;
  const player = {
    roomId: effectiveRoomId,
    count: 1,
    currentRoomIndex: 0,
    playerState: 2,
    heroId: heroData.heroId,
    playerId: character.id,
    grades: character.grade,
    nickName: character.nickname,
    sex: character.sex,
    templateId: heroData.templateId,
    ...heroData.appearance,
    armyId: heroData.armyId,
    curPosX: spawnNode.Property1,
    curPosY: spawnNode.Property2,
    campaignId: mapId,
    onlineState: true,
    armyState: 0,
    teamId: 1,
    headId: heroData.headId,
    serverName: '',
    consortiaName: '',
    hp: heroData.live,
    maxHp: heroData.live,
    hide: false,
    hat: '',
    fashionArm: '',
    fashionCloth: ''
  };

  const room = {
    roomId: effectiveRoomId,
    campaignId: mapId,
    masterId: mpdRoom ? Number(mpdRoom.masterId) : character.id,
    name: mapRow.MapName_pt || mapRow.MapName_en || camp.CampaignName_pt,
    count: 1,
    capacity: mpdRoom ? Math.max(1, Math.min(4, Number(mpdRoom.capacity) || 1)) : 1,
    roomState: 1,
    roomType: mpdRoom ? Number(mpdRoom.roomType) || 1 : 0,
    isSetPassword: false,
    roomPlayer: [player],
    masterServerName: ''
  };

  const formattedNodes = nodeList.map(n => formatNodeData(n, wonList, Boolean(state.campaigns.current.trialStarted)));

  const packets = [
    packet(125, 'room.RoomCreatedMsg', { createdType: 1, room, isCross: false, campignId: campaignId }),
    packet(21, 'room.RoomEnterMsg', { result: 1, player: [player], userIds: [character.id] }),
    packet(127, 'campaign.CampaignNodeListMsg', { node: formattedNodes }),
    packet(6, 'player.LoginStateMsg', { playerId: character.id, state: 4 })
  ];

  return {
    state,
    campaign: camp,
    mapId,
    packets
  };
}

function calcGradeFromXp(totalXp, currentGrade = 5) {
  let grade = currentGrade;
  while (grade < 80) {
    try {
      const nextTotal = resource.totalAtLevel(grade + 1);
      if (totalXp >= nextTotal) {
        grade++;
      } else {
        break;
      }
    } catch (e) {
      break;
    }
  }
  return grade;
}

function arriveNode(character, savedState, nodeId) {
  const state = ensureCampaignState(savedState, character.grade);
  const nId = Number(nodeId);
  const node = nodeById.get(nId);
  if (!node) {
    throw new Error(`No de campanha ${nId} nao encontrado`);
  }

  const currentCamp = state.campaigns.current;
  const campaignId = currentCamp ? currentCamp.campaignId : resolveCampaignForMap(node.CampaignId);
  if (!state.campaigns.wonNodes[campaignId]) {
    state.campaigns.wonNodes[campaignId] = [];
  }
  const persistentWonList = state.campaigns.wonNodes[campaignId];
  if (!currentCamp || !Array.isArray(currentCamp.runWonNodes)) {
    state.campaigns.current = { ...(currentCamp || {}), campaignId, runWonNodes: [] };
  }
  const wonList = state.campaigns.current.runWonNodes;

  const mType = Number(node.MasterType);
  const isMonster = (mType === 41 || mType === 42 || node.AI === 'com.road.yishi.mapphysics.node.ai.CNKingTowerBossAi' || (Number(node.CampaignId) === 8200 && Number(node.Id) >= 820002 && Number(node.Id) <= 820006));
  const isChest = (mType === 61 && !isMonster);
  const isPortal = (mType === 62 || mType === 63 || mType === 81 || (Array.isArray(node.MoveToNodeIds) && node.MoveToNodeIds.length > 0));

  let xpAwarded = 0;
  let goldAwarded = 0;
  let isBoss = (mType === 41);
  let isFinished = false;
  let addedItems = [];
  const packets = [];

  if (isMonster) {
    if (!wonList.includes(nId)) {
      wonList.push(nId);
      if (!persistentWonList.includes(nId)) persistentWonList.push(nId);
      xpAwarded = isBoss ? 1500 : 500;
      goldAwarded = isBoss ? 500 : 100;

      state.progression = state.progression || { currentXp: 0, totalXp: resource.totalAtLevel(character.grade) };
      state.progression.totalXp += xpAwarded;

      const newGrade = calcGradeFromXp(state.progression.totalXp, character.grade);
      const atLevel = resource.totalAtLevel(newGrade);
      state.progression.currentXp = Math.max(0, state.progression.totalXp - atLevel);

      state.wallet = state.wallet || {};
      state.wallet.gold = (state.wallet.gold || 0) + goldAwarded;

      packets.push(packet(128, 'campaign.CampaignNodeUpdateMsg', {
        nodeId: nId,
        nodeState: 8,
        userId: character.id,
        sonType: Number(node.SonType) || 0
      }));

      if (isBoss) {
        isFinished = true;
        unlockNextCampaigns(state, campaignId);

        packets.push(packet(134, 'campaign.CampaignReportMsg', {
          time: 120,
          woundValue: 0,
          hurtValue: 3500,
          failedCount: 0,
          woundAppraisal: 1,
          hurtAppraisal: 1,
          failedAppraisal: 1,
          totalAppraisal: 1,
          batter: 1,
          teamJoin: 0,
          friendJoin: 0,
          vipJoin: 0,
          propJoin: 0,
          otherJoin: 0,
          totalGp: xpAwarded,
          petGp: 0,
          endBossTime: 30,
          endBossAppraisal: 1,
          isSendReward: true
        }));

        packets.push(packet(135, 'campaign.CampaignCardsMsg', {
          sceneType: 3,
          cardCount: 4,
          payCardCount: 0,
          price: 0,
          dropItems: [208005, 2040105]
        }));
      }

      return {
        state,
        node,
        campaignId,
        isMonster: true,
        isBoss,
        isFinished,
        xpAwarded,
        goldAwarded,
        newGrade,
        totalXp: state.progression.totalXp,
        leveledUp: newGrade > character.grade,
        packets
      };
    }
  } else if (isChest) {
    if (!wonList.includes(nId)) {
      wonList.push(nId);
      if (!persistentWonList.includes(nId)) persistentWonList.push(nId);
      const towerInfo = towerFloor(node.CampaignId);
      if (towerInfo) {
        const amount = towerInfo.floor % 5 === 0
          ? (towerInfo.floor % 10 === 0 ? 10 : 5) *
            (Number(state.towers?.[towerInfo.campaignId]?.rewardMultiplier) === 2 ? 2 : 1)
          : 0;
        if (amount) {
          const reward = inventory.addItem(state, 208009, amount);
          addedItems.push(reward.item);
        }
        const tower = state.towers?.[towerInfo.campaignId];
        if (tower) {
          tower.openedChests = Array.isArray(tower.openedChests) ? tower.openedChests : [];
          if (!tower.openedChests.includes(nId)) tower.openedChests.push(nId);
        }
        packets.push(packet(128, 'campaign.CampaignNodeUpdateMsg', {
          nodeId: nId, nodeState: 8, userId: character.id,
          sonType: Number(node.SonType) || 0
        }));
        return { state, node, campaignId, isChest: true, isTowerChest: true,
          goldAwarded: 0, addedItems, packets };
      }
      goldAwarded = 500;
      state.wallet = state.wallet || {};
      state.wallet.gold = (state.wallet.gold || 0) + goldAwarded;

      const bag = inventory.inventory(state);
      const keyItem = bag.items.find(i => Number(i.templateId) === 208005 && Number(i.bagType) === 1 && Number(i.count) >= 1);
      if (keyItem) {
        const keyPos = keyItem.pos;
        keyItem.count -= 1;
        if (keyItem.count <= 0) {
          bag.items.splice(bag.items.indexOf(keyItem), 1);
          addedItems.push({ pos: keyPos, bagType: 1, isRemovedSlot: true });
        } else {
          addedItems.push(keyItem);
        }
      }

      try {
        const ringRes = inventory.addItem(state, 1070001, 1);
        if (ringRes?.item) addedItems.push(ringRes.item);
        const stoneRes = inventory.addItem(state, 208001, 2);
        if (stoneRes?.item) addedItems.push(stoneRes.item);
      } catch (e) {
        console.error('[CHEST ITEM ERROR]', e.message);
      }

      packets.push(packet(128, 'campaign.CampaignNodeUpdateMsg', {
        nodeId: nId,
        nodeState: 8,
        userId: character.id,
        sonType: Number(node.SonType) || 0
      }));
    }
    return { state, node, campaignId, isChest: true, goldAwarded, addedItems, packets };
  } else if (isPortal) {
    if (Array.isArray(node.MoveToNodeIds) && node.MoveToNodeIds.length > 0) {
      const targetNodeId = Number(node.MoveToNodeIds[0]);
      const targetNode = nodeById.get(targetNodeId);
      if (targetNode && Number(targetNode.CampaignId) !== Number(node.CampaignId)) {
        const nextMapId = Number(targetNode.CampaignId);
        const nextCampId = resolveCampaignForMap(nextMapId);
        const nextNodes = getNodesForMap(nextMapId);
        const mapRow = mapById.get(nextMapId) || { MapName_pt: '', MapName_en: '' };
        const spawnX = Number(targetNode.Property1) || 20;
        const spawnY = Number(targetNode.Property2) || 85;

        state.campaigns.current = {
          campaignId: nextCampId,
          mapId: nextMapId,
          position: { x: spawnX, y: spawnY },
          enteredAt: Date.now(),
          runWonNodes: []
        };

        const heroData = resolveHeroAndAppearance(character, state);
        const player = {
          roomId: character.id,
          count: 1,
          currentRoomIndex: 0,
          playerState: 2,
          heroId: heroData.heroId,
          playerId: character.id,
          grades: character.grade,
          nickName: character.nickname,
          sex: character.sex,
          templateId: heroData.templateId,
          ...heroData.appearance,
          armyId: heroData.armyId,
          curPosX: spawnX,
          curPosY: spawnY,
          campaignId: nextMapId,
          onlineState: true,
          armyState: 0,
          teamId: 1,
          headId: heroData.headId,
          serverName: '',
          consortiaName: '',
          hp: heroData.live,
          maxHp: heroData.live,
          hide: false,
          hat: '',
          fashionArm: '',
          fashionCloth: ''
        };

        const room = {
          roomId: character.id,
          campaignId: nextMapId,
          masterId: character.id,
          name: mapRow.MapName_pt || mapRow.MapName_en || '',
          count: 1,
          capacity: 1,
          roomState: 1,
          roomType: 0,
          isSetPassword: false,
          roomPlayer: [player],
          masterServerName: ''
        };

        const formattedNodes = nextNodes.map(n => formatNodeData(n, []));

        packets.push(packet(125, 'room.RoomCreatedMsg', { createdType: 1, room, isCross: false, campignId: nextCampId }));
        packets.push(packet(21, 'room.RoomEnterMsg', { result: 1, player: [player], userIds: [character.id] }));
        packets.push(packet(127, 'campaign.CampaignNodeListMsg', { node: formattedNodes }));
        packets.push(packet(6, 'player.LoginStateMsg', { playerId: character.id, state: 4 }));

        return { state, node, campaignId: nextCampId, isPortal: true, isStageTransition: true, nextMapId, packets };
      }
    }

    const hasNext = node.NextNodeIds && String(node.NextNodeIds).trim() !== '' && String(node.NextNodeIds).trim() !== '0';
    if (hasNext) {
      return { state, node, campaignId, isPortal: true, isStageTransition: false, isFinished: false, packets };
    }

    isFinished = true;
    unlockNextCampaigns(state, campaignId);

    packets.push(packet(134, 'campaign.CampaignReportMsg', {
      time: 60,
      woundValue: 0,
      hurtValue: 1000,
      failedCount: 0,
      woundAppraisal: 1,
      hurtAppraisal: 1,
      failedAppraisal: 1,
      totalAppraisal: 1,
      batter: 1,
      totalGp: 0,
      petGp: 0,
      endBossTime: 0,
      endBossAppraisal: 1,
      isSendReward: true
    }));
    packets.push(packet(135, 'campaign.CampaignCardsMsg', {
      sceneType: 3,
      cardCount: 4,
      payCardCount: 0,
      price: 0,
      dropItems: [208005, 2040105]
    }));
    return { state, node, campaignId, isPortal: true, isFinished: true, packets };
  }

  return { state, node, campaignId, packets };
}

function isFinalBossNode(node) {
  return Number(node?.MasterType) === 41 && !String(node.NextNodeIds || '').trim() &&
    (!Array.isArray(node.MoveToNodeIds) || node.MoveToNodeIds.length === 0);
}

function prepareCardReward(savedState, node, battleId, xpReward) {
  if (!isFinalBossNode(node)) return null;
  const campaignId = resolveCampaignForMap(node.CampaignId);
  if (!savedState.campaigns) savedState.campaigns = {};
  if (!savedState.campaigns.current) {
    savedState.campaigns.current = { campaignId, mapId: Number(node.CampaignId), runWonNodes: [] };
  }
  const current = savedState.campaigns.current;
  current.campaignId = campaignId;
  current.mapId = Number(node.CampaignId);
  const catalogItems = (campaignById.get(campaignId)?.Item || []).map(Number)
    .filter(id => Number.isSafeInteger(id) && id > 0);
  if (!catalogItems.length) return null;
  const options = Array.from({length: 5}, (_, index) => catalogItems[index % catalogItems.length]);
  current.pendingCard = {battleId, nodeId: Number(node.Id), campaignId, options,
    xpReward, claimedIndex: null, claimedItem: null};
  return current.pendingCard;
}

function cardReport(pendingCard) {
  return {time: 120, woundValue: 0, hurtValue: 0, failedCount: 0,
    woundAppraisal: 1, hurtAppraisal: 1, failedAppraisal: 1, totalAppraisal: 1,
    batter: 1, teamJoin: 0, friendJoin: 0, vipJoin: 0, propJoin: 0, otherJoin: 0,
    totalGp: pendingCard.xpReward, petGp: 0, endBossTime: 30,
    endBossAppraisal: 1, isSendReward: true};
}

function claimCampaignCard(savedState, index) {
  const current = savedState.campaigns?.current;
  const card = current?.pendingCard;
  if (!card || !Number.isSafeInteger(index) || index < 0 || index >= card.options.length)
    throw Error('Carta de campanha indisponivel');
  if (card.claimedIndex !== null) {
    if (card.claimedIndex !== index) throw Error('Carta ja selecionada');
    return {state: savedState, card, item: null, duplicate: true};
  }
  const added = inventory.addItem(savedState, card.options[index], 1);
  card.claimedIndex = index;
  card.claimedItem = added.item.instanceId;
  const campaignId = Number(current.campaignId);
  unlockNextCampaigns(savedState, campaignId);
  return {state: savedState, card, item: added.item, duplicate: false};
}

function finishCampaign(character, savedState, campaignId) {
  const state = ensureCampaignState(savedState, character.grade);
  const cId = Number(campaignId) || (state.campaigns.current ? state.campaigns.current.campaignId : 1001);
  const camp = campaignById.get(cId);
  unlockNextCampaigns(state, cId);

  state.campaigns.current = null;

  const packets = [
    packet(22, 'campaign.CampaignExitMsg', {
      result: 1,
      playerId: character.id,
      armyId: 1,
      serverName: '',
      userIds: [character.id]
    }),
    packet(6, 'player.LoginStateMsg', { playerId: character.id, state: 2 })
  ];

  return {
    state,
    completedCampaignId: cId,
    nextCampaignId: camp ? Number(camp.NextCampaignId) : null,
    packets
  };
}

module.exports = {
  rawCampaigns,
  rawCampaignData,
  rawMaps,
  campaignById,
  mapById,
  nodesByCampaign,
  nodeById,
  CAMPAIGN_TO_MAP,
  MAP_TO_CAMPAIGN,
  resolveMapForCampaign,
  resolveCampaignForMap,
  getNodesForMap,
  getAllNodesForCampaign,
  towerFloor,
  advanceTowerFloor,
  recordTowerVictory,
  ensureCampaignState,
  formatNodeData,
  trialChallengeNodes,
  isTrialGuard,
  nextTrialChallenge,
  enterCampaign,
  arriveNode,
  finishCampaign,
  isFinalBossNode,
  prepareCardReward,
  cardReport,
  claimCampaignCard,
  unlockNextCampaigns
};
