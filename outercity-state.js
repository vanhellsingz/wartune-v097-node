'use strict';

const path = require('node:path');
const fs = require('node:fs');

let configLoaded = false;
let physicMap = new Map();
let mineByPos = new Map();
let physicPosList = [];
let bossConfigList = [];
let bossTempMap = new Map();
let treasureList = [];
let dropItemList = [];

function monsterTemplate(monster) {
  if (!monster || ![4,5,6].includes(Number(monster.Type))) return null;
  const candidates=[...bossTempMap.values()].filter(t=>Number(t.MasterType)===21 &&
    Number(t.SonType)===Number(monster.SonType));
  return candidates.find(t=>String(t.MapPhysicsTempName_pt||'')===String(monster.Name_pt||'')) ||
    candidates.find(t=>String(t.MapPhysicsTempName_en||'')===String(monster.Name_en||'')) ||
    candidates.find(t=>Number(t.Grades)===Number(monster.Grade)) ||
    (candidates.length===1 ? candidates[0] : null);
}

function getDropsForMonster(monster) {
  const dropId = Number(monster.Property1);
  const matched = dropItemList.filter(d => Number(d.DropId) === dropId);
  const drops = [];
  for (const m of matched) {
    drops.push({ itemId: Number(m.ItemId), count: Number(m.Data) || 1, random: Number(m.Random) || 100 });
  }
  if (!drops.length) {
    if (monster.Type === 4) {
      drops.push({ itemId: -100, count: 80000, random: 100 });
      drops.push({ itemId: 208014, count: 12, random: 100 });
      drops.push({ itemId: 208012, count: 4, random: 100 });
    } else if (monster.Type === 5) {
      drops.push({ itemId: -100, count: 40000, random: 100 });
      drops.push({ itemId: 208014, count: 6, random: 100 });
    } else {
      drops.push({ itemId: -100, count: 15000, random: 100 });
      drops.push({ itemId: 208014, count: 3, random: 100 });
    }
  }
  return drops;
}

// Shared world occupancy for mine slots: posId_nodeId_sonNodeId -> { occupyPlayerId, playerName, guildId, isOccupy: true }
const activeMinesOccupy = new Map();

function initOuterCityData(configDir) {
  if (configLoaded) return;
  try {
    const files = fs.readdirSync(configDir);
    
    // Find files by prefix
    const posFile = files.find(f => f.startsWith('t_s_mapphysicposition-') && f.endsWith('.json'));
    const physicFile = files.find(f => f.startsWith('t_s_physic-') && f.endsWith('.json'));
    const mineFile = files.find(f => f.startsWith('t_s_mapmine-') && f.endsWith('.json'));
    const bossConfigFile = files.find(f => f.startsWith('t_s_mapbossconfig-') && f.endsWith('.json'));
    const bossTempFile = files.find(f => f.startsWith('t_s_mapphysicstemplate-') && f.endsWith('.json'));
    const treasureFile = files.find(f => f.startsWith('t_s_mapphysicstreasure-') && f.endsWith('.json'));

    if (posFile) {
      const data = JSON.parse(fs.readFileSync(path.join(configDir, posFile), 'utf8'));
      physicPosList = data.t_s_mapphysicposition || [];
    }

    if (physicFile) {
      const data = JSON.parse(fs.readFileSync(path.join(configDir, physicFile), 'utf8'));
      const rows = data.t_s_physic || [];
      for (const p of rows) {
        physicMap.set(p.Id, p);
      }
    }

    if (mineFile) {
      const data = JSON.parse(fs.readFileSync(path.join(configDir, mineFile), 'utf8'));
      const rows = data.t_s_mapmine || [];
      for (const m of rows) {
        if (!mineByPos.has(m.Positionid)) mineByPos.set(m.Positionid, []);
        mineByPos.get(m.Positionid).push(m);
      }
    }

    if (bossConfigFile) {
      const data = JSON.parse(fs.readFileSync(path.join(configDir, bossConfigFile), 'utf8'));
      bossConfigList = data.t_s_mapbossconfig || [];
    }

    if (bossTempFile) {
      const data = JSON.parse(fs.readFileSync(path.join(configDir, bossTempFile), 'utf8'));
      const rows = data.t_s_mapphysicstemplate || [];
      for (const bt of rows) {
        bossTempMap.set(bt.TemplateId, bt);
      }
    }

    if (treasureFile) {
      const data = JSON.parse(fs.readFileSync(path.join(configDir, treasureFile), 'utf8'));
      treasureList = data.t_s_mapphysicstreasure || [];
    }

    const dropFile = files.find(f => f.startsWith('t_s_dropitem-') && f.endsWith('.json'));
    if (dropFile) {
      const data = JSON.parse(fs.readFileSync(path.join(configDir, dropFile), 'utf8'));
      dropItemList = data.t_s_dropitem || [];
    }

    configLoaded = true;
  } catch (err) {
    console.error('[OUTERCITY] Failed to load outer city configs:', err.message);
  }
}

function getPlayerState(state) {
  if (!state) return {};
  if (state.player) return state.player;
  if (state.character) {
    if (!state.character._parsedState) {
      try {
        state.character._parsedState = typeof state.character.state_json === 'string'
          ? JSON.parse(state.character.state_json)
          : (state.character.state_json || {});
      } catch (_) {
        state.character._parsedState = {};
      }
    }
    return state.character._parsedState;
  }
  if (!state._fallbackPlayer) {
    state._fallbackPlayer = {};
  }
  return state._fallbackPlayer;
}

function ensurePlayerOuterCityState(player) {
  if (!player.outerCityKills) {
    player.outerCityKills = { count1: 0, count2: 0, count3: 0, lastReset: Date.now() };
  }
  // Daily reset check (if lastReset was yesterday)
  const now = new Date();
  const last = new Date(player.outerCityKills.lastReset || 0);
  if (now.toDateString() !== last.toDateString()) {
    player.outerCityKills.count1 = 0;
    player.outerCityKills.count2 = 0;
    player.outerCityKills.count3 = 0;
    player.outerCityKills.lastReset = Date.now();
  }
  if (!Array.isArray(player.occupiedMines)) {
    player.occupiedMines = [];
  }
}

function getOuterCityAllInfoMsg(state, targetMapId = 5) {
  const allInfo = [];
  const mapFilter = Number(targetMapId || 5);

  for (const p of physicPosList) {
    const coord = physicMap.get(p.PhysicId);
    const nodeMapId = coord?.MapId || 5;
    // Se o mapa tiver nós específicos definidos, respeita o filtro
    if (mapFilter > 0 && nodeMapId !== mapFilter && (p.Grade && p.Grade > 0 && nodeMapId === 5 && mapFilter !== 5)) {
      continue;
    }
    const posX = coord ? coord.PosX : (p.PhysicId ? Math.floor((p.PhysicId % 10000) / 100) : 500);
    const posY = coord ? coord.PosY : (p.PhysicId ? (p.PhysicId % 100) : 500);

    if (p.Type === 1) { // Castelo
      allInfo.push({
        id: p.ID,
        mapId: mapFilter,
        posX,
        posY,
        templateId: p.ID,
        type: 1, // u5.TYPE_CASTLE
        state: 1, // Peace
        occupyPlayerId: 0,
        occupyPlayerName: '',
        occupyLeagueName: ''
      });
    } else if (p.Type === 2) { // Mina de Tesouro
      allInfo.push({
        id: p.ID,
        mapId: mapFilter,
        posX,
        posY,
        templateId: p.ID,
        type: 2, // u5.TYPE_TREASURE
        state: 1,
        level: p.Grade || 50,
        occupyPlayerId: 0,
        occupyPlayerName: '',
        occupyLeagueName: ''
      });
    } else if (p.Type === 3 || p.Type === 8) { // Minas de Recursos (Ouro, Daru, Ametista, Mithril)
      const subnodes = mineByPos.get(p.ID) || [];
      const occupyNodeInfo = [];
      const allNodeInfo = subnodes.map(sn => {
        let occupiedCount = 0;
        for (let sonId = 1; sonId <= (sn.TotalNum || 10); sonId++) {
          const slot = activeMinesOccupy.get(`${p.ID}_${sn.ID}_${sonId}`);
          if (slot) {
            occupiedCount++;
            occupyNodeInfo.push({
              posId: p.ID,
              nodeId: sn.ID,
              sonNodeId: sonId,
              occupyPlayerId: slot.occupyPlayerId,
              playerName: slot.playerName,
              guildId: slot.guildId || 0,
              isOccupy: true
            });
          }
        }
        return {
          posId: p.ID,
          nodeId: sn.ID,
          occupyNum: occupiedCount,
          allOccupyNum: sn.TotalNum || 100,
          posX,
          posY
        };
      });

      allInfo.push({
        id: p.ID,
        mapId: mapFilter,
        posX,
        posY,
        templateId: p.ID,
        type: 3, // u5.TYPE_MINE
        level: p.Grade || 30,
        state: 1,
        occupyPlayerId: 0,
        occupyPlayerName: '',
        occupyLeagueName: '',
        occupyGuildId: 0,
        allNodeInfo,
        occupyNodeInfo
      });
    } else if (p.Type === 4 || p.Type === 5 || p.Type === 6) { // Monstros da Cidade Externa (4=Boss, 5=Elite, 6=Comum)
      const template=monsterTemplate(p);
      if (!template) continue; // Sem modelo no cliente: não anunciar alvo invisível.
      let mPosX = posX;
      let mPosY = posY;
      if (p.RefreshCoordinateRange) {
        const ranges = p.RefreshCoordinateRange.split('|')[0].split(',');
        if (ranges.length >= 4) {
          const [minX,maxX,minY,maxY]=ranges.map(Number);
          if ([minX,maxX,minY,maxY].every(Number.isFinite) && maxX>=minX && maxY>=minY) {
            mPosX=minX+(Math.imul(Number(p.ID),127) >>> 0)%(maxX-minX+1);
            mPosY=minY+(Math.imul(Number(p.ID),283) >>> 0)%(maxY-minY+1);
          }
        }
      }

      allInfo.push({
        id: p.ID,
        mapId: mapFilter,
        posX: mPosX,
        posY: mPosY,
        // The client resolves this field in t_s_mapphysicposition, then uses
        // its SonType to load the creature asset. A mapphysicstemplate ID
        // leaves tempInfo undefined and the node invisible.
        templateId: p.ID,
        type: p.Type, // 4 = Boss, 5 = Elite, 6 = Comum
        level: Number(p.Grade) || 30,
        state: 1, // Existente / Vivo
        occupyPlayerId: 0,
        occupyPlayerName: p.Name_pt || 'Monstro',
        occupyLeagueName: '',
        occupyGuildId: 0
      });
    }
  }

  return { allInfo };
}

function getMapBossMsg(state, reqMapId = 5) {
  const player = getPlayerState(state);
  ensurePlayerOuterCityState(player);

  const mId = Number(reqMapId || 5);
  const visibleBosses=getOuterCityAllInfoMsg(state,mId).allInfo.filter(node=>Number(node.type)===4);

  const mapPositions = {
    1: [
      { posX: 2046, posY: 2457 },
      { posX: 2478, posY: 2369 },
      { posX: 1705, posY: 1770 },
      { posX: 1900, posY: 2100 }
    ],
    2: [
      { posX: 2146, posY: 2185 },
      { posX: 1630, posY: 1675 },
      { posX: 1817, posY: 1950 },
      { posX: 1950, posY: 1800 }
    ],
    3: [
      { posX: 1681, posY: 1724 },
      { posX: 1799, posY: 1485 },
      { posX: 1376, posY: 1205 },
      { posX: 1550, posY: 1400 }
    ],
    4: [
      { posX: 1173, posY: 1389 },
      { posX: 945, posY: 1222 },
      { posX: 1135, posY: 1138 },
      { posX: 1050, posY: 1280 }
    ],
    5: [
      { posX: 666, posY: 460 },
      { posX: 582, posY: 560 },
      { posX: 465, posY: 522 },
      { posX: 850, posY: 620 },
      { posX: 1100, posY: 350 },
      { posX: 450, posY: 850 },
      { posX: 320, posY: 540 },
      { posX: 780, posY: 920 },
      { posX: 950, posY: 750 },
      { posX: 250, posY: 1200 },
      { posX: 400, posY: 1100 },
      { posX: 600, posY: 700 }
    ]
  };

  const bosslist = visibleBosses.map(node=>{
    const position=physicPosList.find(row=>Number(row.ID)===Number(node.id));
    return {
      bossName: position?.Name_pt || 'Chefe',
      grade: node.level,
      type: 1, // 1 = vivo
      posId: node.id,
      leftTime: 0,
      posX: node.posX,
      posY: node.posY,
      state: 1,
      uuid: String(node.id)
    };
  });

  return {
    count1: Number(player.outerCityKills?.count1 || 0),
    count2: Number(player.outerCityKills?.count2 || 0),
    count3: Number(player.outerCityKills?.count3 || 0),
    leftFogTime: 0,
    bosslist
  };
}

function getTreasureMineMsg(state, reqMapId = 5) {
  const minerals = [
    { id: 201, mapId: reqMapId, posX: 311, posY: 616, templateId: 201, type: 2, state: 1, occupyPlayerId: 0, occupyPlayerName: '', occupyGuildId: 0, occupyGuildName: '', startFightTime: 0 },
    { id: 202, mapId: reqMapId, posX: 891, posY: 1133, templateId: 202, type: 2, state: 1, occupyPlayerId: 0, occupyPlayerName: '', occupyGuildId: 0, occupyGuildName: '', startFightTime: 0 },
    { id: 203, mapId: reqMapId, posX: 1134, posY: 415, templateId: 203, type: 2, state: 1, occupyPlayerId: 0, occupyPlayerName: '', occupyGuildId: 0, occupyGuildName: '', startFightTime: 0 }
  ];

  return {
    state: 1,
    stateEndTime: Math.floor(Date.now() / 1000) + 7200,
    failCount: 0,
    skipCount: 0,
    sumCD: 0,
    isDeath: false,
    minerals,
    consortiaMinerals: []
  };
}

async function handleOutCityGoldList(state, body, sendGameSession, originalPb, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    let reqMapId = 5;
    try {
      if (body && body.length > 0) {
        const req = originalPb.decode('worldmap.MapPhysicAttackMsg', body);
        if (req.mapId) reqMapId = Number(req.mapId);
      }
    } catch (_) {}

    // Opcode 436: U_C_OUTCITY_NODE_INFO (army.OutCityAllInfoMsg)
    const allInfoMsg = getOuterCityAllInfoMsg(state, reqMapId);
    sendGameSession(state, 436, originalPb.encode('army.OutCityAllInfoMsg', allInfoMsg));

    // Opcode 4741: U_C_TREASURE_MINE_INFO (treasuremine.TreasureMineMsg)
    const treasureMsg = getTreasureMineMsg(state, reqMapId);
    sendGameSession(state, 4741, originalPb.encode('treasuremine.TreasureMineMsg', treasureMsg));

    // Opcode 448: U_C_OUT_CITY_VEHICLE_INFO (outercity.VehicleAllInfoMsg)
    sendGameSession(state, 448, originalPb.encode('outercity.VehicleAllInfoMsg', { allVehicleInfo: [] }));

    // Sempre sincroniza dados de chefões do mapa imediatamente para preencher contadores 0/5, 0/3, 0/1 sem undefined
    const bossMsg = getMapBossMsg(state, reqMapId);
    sendGameSession(state, 4938, originalPb.encode('army.MapBossMsg', bossMsg));

    // Envia lista de física por grid (Opcode 4129) contendo as minas e nós reais do chão
    sendGameSession(state, 4129, originalPb.encode('army.PhysicListUpdateMsg', {
      reqGrid: '',
      wildLand: allInfoMsg.allInfo,
      baseCastle: []
    }));

    // Sincroniza exército do jogador no mapa para que o avatar apareça
    const heroState = require('./hero-state');
    const outerArmy = heroState.armyInfo(state.character, reqMapId);
    sendGameSession(state, 169, originalPb.encode('army.ArmyUpdatedGridMsg', { updatedArmy: [outerArmy] }));
    sendGameSession(state, 150, originalPb.encode('army.ArmyMsg', outerArmy));

    log(`[CIDADE EXTERIOR #${state.id}] Minas e nós da cidade exterior sincronizados (Opcodes 436, 4129, 4938, mapa ${reqMapId}, ${allInfoMsg.allInfo.length} nós).`);
  } catch (err) {
    log(`[CIDADE EXTERIOR #${state.id}] Erro em handleOutCityGoldList: ${err.message}`);
  }
}

async function handleMapBossDatas(state, body, sendGameSession, originalPb, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    let reqMapId = 5;
    try {
      if (body && body.length > 0) {
        const req = originalPb.decode('army.MapBossQuestMsg', body);
        if (req.mapId) reqMapId = Number(req.mapId);
      }
    } catch (_) {}

    const bossMsg = getMapBossMsg(state, reqMapId);
    sendGameSession(state, 4938, originalPb.encode('army.MapBossMsg', bossMsg));
    log(`[CIDADE EXTERIOR #${state.id}] Dados de chefões sincronizados (Opcode 4938, mapa ${reqMapId}, ${bossMsg.bosslist.length} chefões, tentativas: C=${bossMsg.count1}/5, E=${bossMsg.count2}/3, B=${bossMsg.count3}/1).`);
  } catch (err) {
    log(`[CIDADE EXTERIOR #${state.id}] Erro em handleMapBossDatas: ${err.message}`);
  }
}

async function handleArmyAttack(state, body, sendGameSession, originalPb, log, inventoryState, db, battleEngine, makeBasicPlayerInfo) {
  if (!state.gatewayId || state.closed) return;
  try {
    let req;
    try {
      req = originalPb.decode('worldmap.MapPhysicAttackMsg', body);
    } catch (e) {
      req = {};
    }

    const mapId = Number(req.mapId || 5);
    const nodeId = Number(req.nodeId || 0);
    const sonNodeId = Number(req.sonNodeId || 0);
    const posId = req.posId ? Number(req.posId) : Math.floor(nodeId / 100);

    const player = getPlayerState(state);
    ensurePlayerOuterCityState(player);

    // Identifica se o alvo é um monstro da Cidade Externa (Tipos 4=Boss, 5=Elite, 6=Comum)
    const visibleMonsters=getOuterCityAllInfoMsg(state,mapId).allInfo.filter(node=>
      [4,5,6].includes(Number(node.type)));
    const target=visibleMonsters.find(node=>Number(node.id)===nodeId) ||
      (nodeId===0 ? visibleMonsters.find(node=>Number(node.posX)===Number(req.posX) &&
        Number(node.posY)===Number(req.posY)) : null);
    let monster=target&&physicPosList.find(p=>Number(p.ID)===Number(target.id));
    const isMonster = !!monster || nodeId === 0 || (nodeId >= 400 && nodeId <= 450);

    if (!isMonster && nodeId > 0) {
      // Ocupação de mina de recursos
      const sonId = sonNodeId > 0 ? sonNodeId : 1;
      const targetPosId = posId > 0 ? posId : 301;
      const slotKey = `${targetPosId}_${nodeId}_${sonId}`;

      activeMinesOccupy.set(slotKey, {
        occupyPlayerId: state.id,
        playerName: player.nickName || state.character?.nickname || 'mano',
        guildId: player.consortiaId || 0,
        isOccupy: true
      });

      player.occupiedMines.push({ posId: targetPosId, nodeId, sonNodeId: sonId, occupyTime: Date.now() });

      player.gold = (Number(player.gold) || 0) + 20000;
      player.daru = (Number(player.daru) || 0) + 10000;

      // Sincroniza nó atualizado via 436 e 4129
      const allInfoMsg = getOuterCityAllInfoMsg(state, mapId);
      sendGameSession(state, 436, originalPb.encode('army.OutCityAllInfoMsg', allInfoMsg));
      sendGameSession(state, 4129, originalPb.encode('army.PhysicListUpdateMsg', {
        reqGrid: '',
        wildLand: allInfoMsg.allInfo,
        baseCastle: []
      }));

      log(`[CIDADE EXTERIOR #${state.id}] Mina ocupada: PosId=${targetPosId}, NodeId=${nodeId}, SonId=${sonId}. Recompensas creditadas.`);
      if (db && state.gatewayId && typeof db.mutateCharacterState === 'function') {
        await db.mutateCharacterState(state.gatewayId, saved => {
          saved.occupiedMines = player.occupiedMines;
          saved.wallet = saved.wallet || {};
          saved.wallet.gold = (Number(saved.wallet.gold) || 0) + 20000;
          return { state: saved, resources: { gold: saved.wallet.gold } };
        });
      }
    } else {
      // Only a real visible monster may start a battle. Rewards are committed
      // by BattleEngine after victory, never when this request arrives.
      if (!monster) throw Error(`Monstro externo ${nodeId} nao encontrado`);
      if (!battleEngine || typeof battleEngine.initiateBattle !== 'function')
        throw Error('Motor de batalha indisponivel');
      battleEngine.initiateBattle(state, monster.ID, {
        outerMonster: monster,
        outerRewards: getDropsForMonster(monster)
      });
      log(`[CIDADE EXTERIOR #${state.id}] Combate iniciado: monstro ${monster.ID}; recompensa pendente de vitoria.`);
    }
  } catch (err) {
    log(`[CIDADE EXTERIOR #${state.id}] Erro em handleArmyAttack: ${err.message}`);
  }
}

async function handleUnoccupyWildLand(state, body, sendGameSession, originalPb, log, db) {
  if (!state.gatewayId || state.closed) return;
  try {
    const player = getPlayerState(state);
    ensurePlayerOuterCityState(player);
    for (const [key, slot] of activeMinesOccupy.entries()) {
      if (slot.occupyPlayerId === state.id) {
        activeMinesOccupy.delete(key);
      }
    }
    player.occupiedMines = [];

    // Sincroniza nó atualizado via 436 e 4129
    const allInfoMsg = getOuterCityAllInfoMsg(state, 5);
    sendGameSession(state, 436, originalPb.encode('army.OutCityAllInfoMsg', allInfoMsg));
    sendGameSession(state, 4129, originalPb.encode('army.PhysicListUpdateMsg', {
      reqGrid: '',
      wildLand: allInfoMsg.allInfo,
      baseCastle: []
    }));

    log(`[CIDADE EXTERIOR #${state.id}] Mina desocupada com sucesso.`);
    if (db && state.gatewayId && typeof db.mutateCharacterState === 'function') {
      await db.mutateCharacterState(state.gatewayId, saved => {
        saved.occupiedMines = [];
        return { state: saved };
      });
    }
  } catch (err) {
    log(`[CIDADE EXTERIOR #${state.id}] Erro em handleUnoccupyWildLand: ${err.message}`);
  }
}

async function handleArmyReturnHome(state, body, sendGameSession, originalPb, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const player = getPlayerState(state);
    player.mapId = 10000; // Cidade / Castelo Principal
    log(`[CIDADE EXTERIOR #${state.id}] Exército retornou ao castelo com sucesso.`);
  } catch (err) {
    log(`[CIDADE EXTERIOR #${state.id}] Erro em handleArmyReturnHome: ${err.message}`);
  }
}

async function handleOutCityVehicleFixPos(state, body, sendGameSession, originalPb, log, db) {
  if (!state.gatewayId || state.closed) return;
  try {
    let req = { posX: 361, posY: 1314 };
    try {
      if (body && body.length > 0) req = originalPb.decode('outercity.VehicleReqMsg', body);
    } catch (_) {}
    const posX = Number(req.posX) || 361;
    const posY = Number(req.posY) || 1314;

    const player = getPlayerState(state);
    player.curPosX = posX;
    player.curPosY = posY;
    player.position = { mapId: 5, x: posX, y: posY };

    if (db && typeof db.mutateCharacterState === 'function') {
      await db.mutateCharacterState(state.gatewayId, saved => {
        saved.position = { mapId: 5, x: posX, y: posY };
        return { state: saved };
      });
      state.character = await db.characterById(state.gatewayId);
    }

    const heroState = require('./hero-state');
    const outerArmy = heroState.armyInfo(state.character, 5);
    outerArmy.curPosX = posX;
    outerArmy.curPosY = posY;

    sendGameSession(state, 169, originalPb.encode('army.ArmyUpdatedGridMsg', { updatedArmy: [outerArmy] }));
    sendGameSession(state, 150, originalPb.encode('army.ArmyMsg', outerArmy));
    log(`[CIDADE EXTERIOR #${state.id}] Posicao do jogador fixada para (${posX}, ${posY}). Opcodes 169/150 sincronizados.`);
  } catch (err) {
    log(`[CIDADE EXTERIOR #${state.id}] Erro em handleOutCityVehicleFixPos: ${err.message}`);
  }
}

async function handleOutCityVehicleInfo(state, body, sendGameSession, originalPb, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    // Opcode 448: U_C_OUT_CITY_VEHICLE_INFO (outercity.VehicleAllInfoMsg)
    sendGameSession(state, 448, originalPb.encode('outercity.VehicleAllInfoMsg', { allVehicleInfo: [] }));
    log(`[CIDADE EXTERIOR #${state.id}] Informações de veículos sincronizadas (Opcode 448).`);
  } catch (err) {
    log(`[CIDADE EXTERIOR #${state.id}] Erro em handleOutCityVehicleInfo: ${err.message}`);
  }
}

async function handleArmyUpdateGrid(state, body, sendGameSession, originalPb, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const heroState = require('./hero-state');
    const outerArmy = heroState.armyInfo(state.character, 5);
    sendGameSession(state, 169, originalPb.encode('army.ArmyUpdatedGridMsg', { updatedArmy: [outerArmy] }));
    log(`[CIDADE EXTERIOR #${state.id}] Grid de exército atualizado (Opcode 169).`);
  } catch (err) {
    log(`[CIDADE EXTERIOR #${state.id}] Erro em handleArmyUpdateGrid: ${err.message}`);
  }
}

async function handlePhysicListByGrid(state, body, sendGameSession, originalPb, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    let reqMapId = 5;
    let reqGrid = '';
    try {
      if (body && body.length > 0) {
        const req = originalPb.decode('worldmap.PosMoveMsg', body);
        if (req.mapId) reqMapId = Number(req.mapId);
        if (req.reqGrid) reqGrid = req.reqGrid;
      }
    } catch (_) {}

    const allInfoMsg = getOuterCityAllInfoMsg(state, reqMapId);
    sendGameSession(state, 4129, originalPb.encode('army.PhysicListUpdateMsg', {
      reqGrid: reqGrid || '',
      wildLand: allInfoMsg.allInfo,
      baseCastle: []
    }));
    log(`[CIDADE EXTERIOR #${state.id}] Lista de física por grid sincronizada (Opcode 4129, mapa ${reqMapId}, ${allInfoMsg.allInfo.length} nós).`);
  } catch (err) {
    log(`[CIDADE EXTERIOR #${state.id}] Erro em handlePhysicListByGrid: ${err.message}`);
  }
}

async function handleMapBossRevive(state, body, sendGameSession, originalPb, log, db) {
  if (!state.gatewayId || state.closed) return;
  try {
    const bossMsg = getMapBossMsg(state);
    sendGameSession(state, 4938, originalPb.encode('army.MapBossMsg', bossMsg));
    log(`[CIDADE EXTERIOR #${state.id}] Chefe do mapa revivido/sincronizado (Opcode 4938).`);
  } catch (err) {
    log(`[CIDADE EXTERIOR #${state.id}] Erro em handleMapBossRevive: ${err.message}`);
  }
}

module.exports = {
  initOuterCityData,
  getPlayerState,
  getOuterCityAllInfoMsg,
  getMapBossMsg,
  getTreasureMineMsg,
  handleOutCityGoldList,
  handleMapBossDatas,
  handleArmyAttack,
  handleUnoccupyWildLand,
  handleArmyReturnHome,
  handleOutCityVehicleFixPos,
  handleOutCityVehicleInfo,
  handleArmyUpdateGrid,
  handlePhysicListByGrid,
  handleMapBossRevive
};
