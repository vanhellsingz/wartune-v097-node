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
        if (p.MapId === 5) {
          physicMap.set(p.Id, p);
        }
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

function getOuterCityAllInfoMsg(state) {
  const allInfo = [];

  for (const p of physicPosList) {
    const coord = physicMap.get(p.PhysicId);
    const posX = coord ? coord.PosX : (p.PhysicId ? Math.floor((p.PhysicId % 10000) / 100) : 500);
    const posY = coord ? coord.PosY : (p.PhysicId ? (p.PhysicId % 100) : 500);

    if (p.Type === 1) { // Castelo
      allInfo.push({
        id: p.ID,
        mapId: 5,
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
        mapId: 5,
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
        mapId: 5,
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
    }
  }

  return { allInfo };
}

function getMapBossMsg(state) {
  const player = getPlayerState(state);
  ensurePlayerOuterCityState(player);

  const bossPositions = [
    { posX: 666, posY: 460 },
    { posX: 850, posY: 620 },
    { posX: 1100, posY: 350 },
    { posX: 450, posY: 850 },
    { posX: 320, posY: 540 },
    { posX: 780, posY: 920 },
    { posX: 950, posY: 750 },
    { posX: 250, posY: 1200 },
    { posX: 400, posY: 1100 },
    { posX: 600, posY: 700 }
  ];

  const map5BossConfigs = bossConfigList.filter(b => b.MapId === 5);
  const bosslist = [];
  let idx = 0;
  for (const bc of map5BossConfigs) {
    const bt = bossTempMap.get(bc.TemplateId);
    if (!bt) continue;
    const pos = bossPositions[idx % bossPositions.length];
    bosslist.push({
      bossName: bt.MapPhysicsTempName_pt || bt.MapPhysicsTempName_zhcn || 'Chefe',
      grade: bt.Grades || 50,
      type: 1, // 1 = alive/active (so 0 != i.bossStatus is true)
      posId: bc.TemplateId,
      leftTime: 0,
      posX: pos.posX,
      posY: pos.posY,
      state: 1,
      uuid: bc.TemplateId
    });
    idx++;
  }

  return {
    count1: player.outerCityKills.count1 || 0,
    count2: player.outerCityKills.count2 || 0,
    count3: player.outerCityKills.count3 || 0,
    leftFogTime: 0,
    bosslist
  };
}

function getTreasureMineMsg(state) {
  const minerals = [
    { id: 201, mapId: 5, posX: 311, posY: 616, templateId: 201, type: 2, state: 1, occupyPlayerId: 0, occupyPlayerName: '', occupyGuildId: 0, occupyGuildName: '', startFightTime: 0 },
    { id: 202, mapId: 5, posX: 891, posY: 1133, templateId: 202, type: 2, state: 1, occupyPlayerId: 0, occupyPlayerName: '', occupyGuildId: 0, occupyGuildName: '', startFightTime: 0 },
    { id: 203, mapId: 5, posX: 1134, posY: 415, templateId: 203, type: 2, state: 1, occupyPlayerId: 0, occupyPlayerName: '', occupyGuildId: 0, occupyGuildName: '', startFightTime: 0 }
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
    // Opcode 436: U_C_OUTCITY_NODE_INFO (army.OutCityAllInfoMsg)
    const allInfoMsg = getOuterCityAllInfoMsg(state);
    sendGameSession(state, 436, originalPb.encode('army.OutCityAllInfoMsg', allInfoMsg));

    // Opcode 4741: U_C_TREASURE_MINE_INFO (treasuremine.TreasureMineMsg)
    const treasureMsg = getTreasureMineMsg(state);
    sendGameSession(state, 4741, originalPb.encode('treasuremine.TreasureMineMsg', treasureMsg));

    // Opcode 448: U_C_OUT_CITY_VEHICLE_INFO (outercity.VehicleAllInfoMsg)
    sendGameSession(state, 448, originalPb.encode('outercity.VehicleAllInfoMsg', { allVehicleInfo: [] }));

    // Sincroniza exército do jogador no mapa 5 (Cidade Exterior) para que o avatar apareça
    const heroState = require('./hero-state');
    const outerArmy = heroState.armyInfo(state.character, 5);
    sendGameSession(state, 169, originalPb.encode('army.ArmyUpdatedGridMsg', { updatedArmy: [outerArmy] }));
    sendGameSession(state, 150, originalPb.encode('army.ArmyMsg', outerArmy));

    log(`[CIDADE EXTERIOR #${state.id}] Minas e nós da cidade exterior sincronizados (Opcode 436, ${allInfoMsg.allInfo.length} nós).`);
  } catch (err) {
    log(`[CIDADE EXTERIOR #${state.id}] Erro em handleOutCityGoldList: ${err.message}`);
  }
}

async function handleMapBossDatas(state, body, sendGameSession, originalPb, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const bossMsg = getMapBossMsg(state);
    sendGameSession(state, 4938, originalPb.encode('army.MapBossMsg', bossMsg));
    log(`[CIDADE EXTERIOR #${state.id}] Dados de chefões sincronizados (Opcode 4938, ${bossMsg.bosslist.length} chefões, tentativas: C=${bossMsg.count1}/5, E=${bossMsg.count2}/3, B=${bossMsg.count3}/1).`);
  } catch (err) {
    log(`[CIDADE EXTERIOR #${state.id}] Erro em handleMapBossDatas: ${err.message}`);
  }
}

async function handleArmyAttack(state, body, sendGameSession, originalPb, log, inventoryState, db) {
  if (!state.gatewayId || state.closed) return;
  try {
    let req;
    try {
      req = originalPb.decode('worldmap.MapPhysicAttackMsg', body);
    } catch (e) {
      req = {};
    }

    const { mapId = 5, posX = 0, posY = 0, nodeId = 0, sonNodeId = 0 } = req;
    const player = getPlayerState(state);
    ensurePlayerOuterCityState(player);

    if (nodeId > 0) {
      // Ocupação de mina de recursos
      const sonId = sonNodeId > 0 ? sonNodeId : 1;
      const posId = Math.floor(nodeId / 100);
      const slotKey = `${posId}_${nodeId}_${sonId}`;

      activeMinesOccupy.set(slotKey, {
        occupyPlayerId: state.id,
        playerName: player.nickName || state.character?.nickname || 'Jogador',
        guildId: player.consortiaId || 0,
        isOccupy: true
      });

      player.occupiedMines.push({ posId, nodeId, sonNodeId: sonId, occupyTime: Date.now() });

      // Recompensa imediata de ocupação (Ouro e Daru)
      player.gold = (player.gold || 0) + 10000;
      player.daru = (player.daru || 0) + 5000;

      // Sincroniza nó atualizado via 436
      const allInfoMsg = getOuterCityAllInfoMsg(state);
      sendGameSession(state, 436, originalPb.encode('army.OutCityAllInfoMsg', allInfoMsg));

      log(`[CIDADE EXTERIOR #${state.id}] Mina ocupada: NodeId=${nodeId}, SonId=${sonId}. Recompensas creditadas.`);
    } else {
      // Ataque a monstro ou chefão do mapa
      let rewardType = 'comum';
      if (player.outerCityKills.count3 < 1) {
        player.outerCityKills.count3++;
        rewardType = 'chefao';
        player.gold = (player.gold || 0) + 50000;
        player.daru = (player.daru || 0) + 20000;
        inventoryState.addItem(player, 208003, 5, 0); // Cristal de Alma
        inventoryState.addItem(player, 208006, 2, 0); // Gema Nv. 3
      } else if (player.outerCityKills.count2 < 3) {
        player.outerCityKills.count2++;
        rewardType = 'elite';
        player.gold = (player.gold || 0) + 25000;
        player.daru = (player.daru || 0) + 10000;
        inventoryState.addItem(player, 208003, 3, 0); // Cristal de Alma
      } else if (player.outerCityKills.count1 < 5) {
        player.outerCityKills.count1++;
        rewardType = 'comum';
        player.gold = (player.gold || 0) + 10000;
        player.daru = (player.daru || 0) + 5000;
      }

      // Sincroniza contadores de chefão atualizados (Opcode 4938)
      const bossMsg = getMapBossMsg(state);
      sendGameSession(state, 4938, originalPb.encode('army.MapBossMsg', bossMsg));

      log(`[CIDADE EXTERIOR #${state.id}] Batalha contra monstro/chefe concluída (${rewardType}). Contadores: C=${bossMsg.count1}/5, E=${bossMsg.count2}/3, B=${bossMsg.count3}/1.`);
    }

    // Persiste no banco de dados
    if (db && state.gatewayId && typeof db.mutateCharacterState === 'function') {
      db.mutateCharacterState(state.gatewayId, saved => {
        saved.outerCityKills = player.outerCityKills;
        saved.occupiedMines = player.occupiedMines;
        saved.gold = player.gold;
        saved.daru = player.daru;
        return saved;
      }).catch(err => log(`[DB] Erro ao salvar estado outercity: ${err.message}`));
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
    // Limpa minas ocupadas pelo jogador
    for (const [key, slot] of activeMinesOccupy.entries()) {
      if (slot.occupyPlayerId === state.id) {
        activeMinesOccupy.delete(key);
      }
    }
    player.occupiedMines = [];

    // Sincroniza nó atualizado via 436
    const allInfoMsg = getOuterCityAllInfoMsg(state);
    sendGameSession(state, 436, originalPb.encode('army.OutCityAllInfoMsg', allInfoMsg));

    log(`[CIDADE EXTERIOR #${state.id}] Mina desocupada com sucesso.`);
    if (db && state.gatewayId && typeof db.mutateCharacterState === 'function') {
      db.mutateCharacterState(state.gatewayId, saved => {
        saved.occupiedMines = [];
        return saved;
      }).catch(err => log(`[DB] Erro ao salvar estado outercity: ${err.message}`));
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
        return saved;
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
    // Opcode 4129: U_C_PHYSIC_LIST_UPDATE (army.PhysicListUpdateMsg)
    sendGameSession(state, 4129, originalPb.encode('army.PhysicListUpdateMsg', { mapId: 5, wildLand: [] }));
    log(`[CIDADE EXTERIOR #${state.id}] Lista de física por grid sincronizada (Opcode 4129).`);
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
