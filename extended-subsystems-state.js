/**
 * extended-subsystems-state.js
 * 
 * Implementação autoritativa e canônica dos subsistemas estendidos do Wartune Ultra v0.9.7:
 * 1. Missões de Recompensa de Guilda (Consortia Tasks - Opcodes 9689, 9690, 9691, 9692 -> 454)
 * 2. Tatuagem / Furos de Tatuagem (Tattoo Holes - Opcode 9568 -> 274)
 * 3. Astrologia e Destino (Fate / Rotary - Opcodes 8628, 8627, 8641 -> 4544, 4545)
 * 4. Chefão Mundial (World Boss - Opcodes 8271, 8259, 8258 -> 4182, 4171, 4174)
 * 5. Arena do Guardião (Guard Arena - Opcode 9060 -> 4950, 4951)
 * 6. Medalha de Honra & Equipamentos de Honra (Opcodes 8869, 8877 -> 4556)
 * 7. Sete Metas / 7 Dias (Seven Target Tasks - Opcodes 8785, 8786 -> 4701, 4702)
 * 8. Estrelas de Montaria (Mount UpStar - Opcode 8802 -> 4679)
 * 9. Desmanche e Evolução de Runas (Rune Resolve & Up - Opcodes 8854, 8855 -> 4495)
 * 10. Diálogos de História (Game Story - Opcode 8629 -> 4546)
 */
'use strict';

const originalPb = require('./original-protobuf');
const configRepo = require('./canonical-config-repository');
const canonicalConfigs = configRepo;
const inventoryState = require('./inventory-state');
const attributeCalculator = require('./attribute-calculator');
const heroState = require('./hero-state');

function ensureSubsystemsState(saved) {
  if (!saved || typeof saved !== 'object') return {};
  
  // 1. Consortia Task
  if (!saved.consortiaTask || typeof saved.consortiaTask !== 'object') {
    saved.consortiaTask = {
      score: 0,
      finishNum: 0,
      rewardStatus: '0',
      taskId: 101,
      starNum: 1,
      refreshNum: 0,
      refreshTime: Math.floor(Date.now() / 1000),
      status: 0,
      process: 0,
      rewardId: '1'
    };
  }

  // 2. Tattoo
  if (!saved.tattoo || typeof saved.tattoo !== 'object') {
    saved.tattoo = {
      holes: [1, 2, 3, 4, 5, 6].map(h => ({
        hole: h,
        OldAddProperty: 1, OldAddingValue: 100,
        OldReduceProperty: 2, OldReduceValue: 50,
        OldStage: 1,
        NewAddProperty: 1, NewAddingValue: 100,
        NewReduceProperty: 2, NewReduceValue: 50,
        NewStage: 1
      })),
      coreStep: 1
    };
  } else if (!saved.tattoo.coreStep) {
    saved.tattoo.coreStep = 1;
  }

  // 3. Fate / Astrologia
  if (!saved.fate || typeof saved.fate !== 'object') {
    saved.fate = {
      hide: 0,
      fates: [
        { templateId: 1001, fateTypes: 1, grades: 1, totalGp: 0, property1: '1:50', property2: '', turnCount: 0, hide: 0 },
        { templateId: 1002, fateTypes: 2, grades: 1, totalGp: 0, property1: '2:50', property2: '', turnCount: 0, hide: 0 }
      ]
    };
  }

  // 4. Guard Arena
  if (!saved.guardArena || typeof saved.guardArena !== 'object') {
    saved.guardArena = {
      rank: 1,
      score: 1000,
      freeTimes: 10,
      challengeTimes: 0,
      buyTimes: 0
    };
  }

  // 5. Honor Equip & Medal
  if (!saved.wallet || typeof saved.wallet !== 'object') saved.wallet = {};
  if (saved.wallet.honor === undefined || saved.wallet.honor === null) saved.wallet.honor = 50000;
  if (!saved.honorEquip || typeof saved.honorEquip !== 'object') {
    saved.honorEquip = {
      level: 0,
      stage: 1
    };
  }
  if (!saved.medal || typeof saved.medal !== 'object') {
    saved.medal = {
      active: true,
      delayDays: 30
    };
  }

  // 6. Seven Target
  if (!saved.sevenTarget || typeof saved.sevenTarget !== 'object') {
    saved.sevenTarget = {
      starNum: 0,
      day: 1,
      completedTasks: [],
      claimedGifts: []
    };
  }

  // 7. Mount Stars
  if (!saved.mounts || typeof saved.mounts !== 'object') {
    saved.mounts = {};
  }

  // 8. Pass Task (Passe de Batalha / Metas)
  if (!saved.passTask || typeof saved.passTask !== 'object') {
    saved.passTask = {
      dayFreshNum: 0,
      weekFreshNum: 0,
      exp: 100,
      grade: 1,
      tasks: [
        { taskId: 101, taskType: 1, status: 0, finishNum: 0, id: 1, area: 1 },
        { taskId: 102, taskType: 1, status: 0, finishNum: 0, id: 2, area: 1 }
      ]
    };
  }

  // 9. Season Pass
  if (!saved.seasonPass || typeof saved.seasonPass !== 'object') {
    saved.seasonPass = {
      seasonId: 1,
      passId: 1,
      passLevel: 1,
      passExp: 50,
      status: 1,
      freeProgress: 0,
      payProgress: 0,
      tasks: [
        { taskId: 101, status: 0, progress: 0 }
      ]
    };
  }

  // 10. Guild Maze (Labirinto da Guilda)
  if (!saved.guildMaze || typeof saved.guildMaze !== 'object') {
    saved.guildMaze = {
      levelId: 1,
      defaultEventId: 1,
      grid: [
        { pos: 1, eventId: 101, ownerUserId: 0, hideEventId: 0 },
        { pos: 2, eventId: 102, ownerUserId: 0, hideEventId: 0 }
      ],
      boss: [
        { bossId: 1, hp: 1000000, maxHp: 1000000 }
      ]
    };
  }

  // 11. Consortia Altar
  if (!saved.consortiaAltar || typeof saved.consortiaAltar !== 'object') {
    saved.consortiaAltar = {
      state: 1,
      altarDate: '2026-10-22 12:00:00',
      pop: 1
    };
  }

  // 12. Farm & Divine Tree
  if (!saved.farm || typeof saved.farm !== 'object') {
    saved.farm = {
      landGrades: 1,
      farmGp: 100,
      stolenCount: 0,
      treeGp: 0,
      treeGrade: 1,
      treeGoldWater: 0,
      treeDiamondWater: 0,
      treeStateValue: 0
    };
  }

  // 13. Treasure Map
  if (!saved.treasureMap || typeof saved.treasureMap !== 'object') {
    saved.treasureMap = {
      joinCount: 0,
      rewardCount: 0,
      index: 1,
      templateIds: [208001, 208002]
    };
  }

  // 14. Tollgate & Single Pass
  if (!saved.tollgate || typeof saved.tollgate !== 'object') {
    saved.tollgate = {
      score: 100,
      remainCount: 10,
      curTollgateId: 1,
      singlePassMaxIndex: 5
    };
  }

  // 15. Solo Arena
  if (!saved.soloArena || typeof saved.soloArena !== 'object') {
    saved.soloArena = {
      challengeCount: 10,
      curScore: 1000,
      lastWinCount: 0,
      totalCount: 15
    };
  }

  // 16. Pet Challenge
  if (!saved.petChallenge || typeof saved.petChallenge !== 'object') {
    saved.petChallenge = {
      challengeCount: 10,
      totalCount: 10,
      score: 1000,
      ranking: 1
    };
  }

  // 17. Marriage
  if (!saved.marriage || typeof saved.marriage !== 'object') {
    saved.marriage = {
      mateId: 0,
      state: 0,
      ringTemplateId: 1001,
      marriageTime: 0,
      specTemplateId: 1,
      mateNick: '',
      answerNum: 0,
      mateLogoutDays: 0,
      marTimeId: 0,
      mateHeadId: 0
    };
  }

  // 18. Wish Pool
  if (!saved.wishPool || typeof saved.wishPool !== 'object') {
    saved.wishPool = {
      wishes: {
        '101': { Id: 101, buyCount: 0, WeekBuyCount: 0 },
        '102': { Id: 102, buyCount: 0, WeekBuyCount: 0 }
      }
    };
  }

  // 19. Wish Recruit / Pass
  if (!saved.wishRecruit || typeof saved.wishRecruit !== 'object') {
    saved.wishRecruit = {
      selectId: 1,
      process: 0,
      rewardReceiveId: 0,
      guaranteedProcess: 0,
      freeTimes: 1,
      selectTimes: 0,
      level: 1,
      exp: 0
    };
  }

  // 20. Dragon Crystal Mine & Public Mine
  if (!saved.dragonCrystalMine || typeof saved.dragonCrystalMine !== 'object') {
    saved.dragonCrystalMine = {
      roomId: 1,
      todayPreyTimes: 0,
      todayBuyTimes: 0,
      todayOccupyTimes: 0,
      buyOccupyTimes: 0
    };
  }

  // 21. Consortia PVE & Consortia Boss
  if (!saved.consortiaPve || typeof saved.consortiaPve !== 'object') {
    saved.consortiaPve = {
      curNodeId: 101,
      seasonId: 1,
      dayTimes: 5,
      weekExtraTimes: 0
    };
  }
  if (!saved.consortiaBoss || typeof saved.consortiaBoss !== 'object') {
    saved.consortiaBoss = {
      grade: 1,
      spirit: 0,
      state: 0,
      endTime: 0,
      totalHp: 1000000,
      callGrade: 1
    };
  }

  // 22. Consortia Skills & Offers
  if (!saved.consortiaSkills || typeof saved.consortiaSkills !== 'object') {
    saved.consortiaSkills = {
      skills: [
        { type: 1, level: 1 },
        { type: 2, level: 1 },
        { type: 3, level: 1 }
      ],
      offer: 100
    };
  }

  // 23. Battlefield & Honor Group
  if (!saved.battlefield || typeof saved.battlefield !== 'object') {
    saved.battlefield = {
      battlefieldId: 1,
      honorGroup: 1,
      honorScore: 0,
      winCount: 0,
      loseCount: 0
    };
  }

  return saved;
}

// -------------------------------------------------------------
// 1. MISSÕES DE RECOMPENSA DE GUILDA (Consortia Tasks)
// -------------------------------------------------------------
async function handleConsortiaTaskInfo(state, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      return { state: saved };
    });
    state.character.state_json = result.state;
    const ct = result.state.consortiaTask;
    const wire = originalPb.encode('consortia.AllTaskInfoMsg', {
      score: ct.score || 0,
      finishNum: ct.finishNum || 0,
      rewardStatus: ct.rewardStatus || '0',
      oneTask: {
        taskId: ct.taskId || 101,
        starNum: ct.starNum || 1,
        refreshNum: ct.refreshNum || 0,
        refreshTime: ct.refreshTime || Math.floor(Date.now() / 1000),
        status: ct.status || 0,
        process: ct.process || 0,
        rewardId: String(ct.rewardId || '1')
      },
      recoredInfo: [],
      update: 3
    });
    sendGameSession(state, 454, wire);
    log(`[GUILDA TAREFAS #${state.id}] Sincronizado status de missão de guilda (Opcode 454).`);
  } catch (err) {
    log(`[GUILDA TAREFAS #${state.id}] Erro 9689: ${err.message}`);
  }
}

async function handleConsortiaTaskReward(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      const ct = saved.consortiaTask;
      ct.finishNum = (ct.finishNum || 0) + 1;
      ct.score = (ct.score || 0) + (ct.starNum * 10);
      ct.status = 1; // Concluído
      
      // Consultar tabela canônica t_s_consortiataskreward
      const rewards = configRepo.filter('t_s_consortiataskreward', r => Number(r.Id) === Number(ct.rewardId || 1));
      let rewardGold = 1000 * (ct.starNum || 1);
      if (rewards.length > 0) {
        const starKey = `RewardNumStar${Math.min(5, Math.max(1, ct.starNum))}`;
        rewardGold = Number(rewards[0][starKey] || rewardGold);
      }
      if (!saved.wallet) saved.wallet = {};
      saved.wallet.gold = (Number(saved.wallet.gold) || 0) + rewardGold;

      return { state: saved, ct, rewardGold };
    });
    state.character.state_json = result.state;
    state.character.gold = result.state.wallet.gold;
    
    const ct = result.ct;
    const wire = originalPb.encode('consortia.AllTaskInfoMsg', {
      score: ct.score,
      finishNum: ct.finishNum,
      rewardStatus: '1',
      oneTask: {
        taskId: ct.taskId,
        starNum: ct.starNum,
        refreshNum: ct.refreshNum,
        refreshTime: Math.floor(Date.now() / 1000),
        status: ct.status,
        process: 1,
        rewardId: String(ct.rewardId)
      },
      recoredInfo: [],
      update: 2
    });
    sendGameSession(state, 454, wire);
    log(`[GUILDA TAREFAS #${state.id}] Recompensa de missão ${ct.taskId} coletada! +${result.rewardGold} ouro.`);
  } catch (err) {
    log(`[GUILDA TAREFAS #${state.id}] Erro 9690: ${err.message}`);
  }
}

async function handleConsortiaTaskRefresh(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      const ct = saved.consortiaTask;
      ct.refreshNum = (ct.refreshNum || 0) + 1;
      // Selecionar próxima tarefa do catálogo t_s_consortiatask
      const allTasks = configRepo.getTable('t_s_consortiatask');
      if (allTasks && allTasks.length > 0) {
        const next = allTasks[Math.floor(Math.random() * allTasks.length)];
        ct.taskId = Number(next.Id || 101);
      }
      ct.status = 0;
      ct.process = 0;
      return { state: saved, ct };
    });
    state.character.state_json = result.state;
    const ct = result.ct;
    const wire = originalPb.encode('consortia.AllTaskInfoMsg', {
      score: ct.score,
      finishNum: ct.finishNum,
      rewardStatus: ct.rewardStatus,
      oneTask: {
        taskId: ct.taskId,
        starNum: ct.starNum,
        refreshNum: ct.refreshNum,
        refreshTime: Math.floor(Date.now() / 1000),
        status: ct.status,
        process: ct.process,
        rewardId: String(ct.rewardId)
      },
      recoredInfo: [],
      update: 1
    });
    sendGameSession(state, 454, wire);
    log(`[GUILDA TAREFAS #${state.id}] Missão atualizada para ID ${ct.taskId}.`);
  } catch (err) {
    log(`[GUILDA TAREFAS #${state.id}] Erro 9691: ${err.message}`);
  }
}

async function handleConsortiaTaskUpgradeStar(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      const ct = saved.consortiaTask;
      ct.starNum = Math.min(5, (ct.starNum || 1) + 1);
      return { state: saved, ct };
    });
    state.character.state_json = result.state;
    const ct = result.ct;
    const wire = originalPb.encode('consortia.AllTaskInfoMsg', {
      score: ct.score,
      finishNum: ct.finishNum,
      rewardStatus: ct.rewardStatus,
      oneTask: {
        taskId: ct.taskId,
        starNum: ct.starNum,
        refreshNum: ct.refreshNum,
        refreshTime: Math.floor(Date.now() / 1000),
        status: ct.status,
        process: ct.process,
        rewardId: String(ct.rewardId)
      },
      recoredInfo: [],
      update: 1
    });
    sendGameSession(state, 454, wire);
    log(`[GUILDA TAREFAS #${state.id}] Estrela de missão elevada para ${ct.starNum}.`);
  } catch (err) {
    log(`[GUILDA TAREFAS #${state.id}] Erro 9692: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 2. TATUAGEM / FUROS DE TATUAGEM (Tattoo Holes)
// -------------------------------------------------------------
async function handleTattooReq(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  let req = { opType: 1 };
  try {
    if (body && body.length > 0) req = originalPb.decode('player.TattooHoleReqMsg', body);
  } catch (_) {}

  const opType = Number(req.opType || 1);
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      const holes = saved.tattoo.holes;
      saved.tattoo.coreStep = saved.tattoo.coreStep || 1;
      if (opType === 4) { // OP_UPDATE_CORE (Ascensão)
        saved.tattoo.coreStep = (Number(saved.tattoo.coreStep) || 1) + 1;
      } else if (opType === 2 || opType === 6) { // Upgrade / Refresh
        const targetHole = holes.find(h => h.hole === Number(req.param2 || 1));
        if (targetHole) {
          targetHole.NewAddingValue = (targetHole.NewAddingValue || 100) + 20;
          targetHole.NewStage = Math.min(10, (targetHole.NewStage || 1) + 1);
        }
      } else if (opType === 3) { // Replace
        const targetHole = holes.find(h => h.hole === Number(req.param2 || 1));
        if (targetHole) {
          targetHole.OldAddingValue = targetHole.NewAddingValue;
          targetHole.OldStage = targetHole.NewStage;
        }
      }
      return { state: saved, holes, coreStep: saved.tattoo.coreStep };
    });

    state.character.state_json = result.state;
    const wire = originalPb.encode('player.TattooHoleRspMsg', {
      opType: opType,
      holeInfo: result.holes,
      param1: Number(result.coreStep || 1),
      param2: 0,
      param3: ''
    });
    sendGameSession(state, 274, wire);
    log(`[TATUAGEM #${state.id}] Operação ${opType} processada (coreStep=${result.coreStep}). Opcode 274 enviado.`);
  } catch (err) {
    log(`[TATUAGEM #${state.id}] Erro 9568: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 3. ASTROLOGIA E DESTINO (Fate / Rotary)
// -------------------------------------------------------------
async function handleFateRequest(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      return { state: saved, fates: saved.fate.fates };
    });
    state.character.state_json = result.state;
    const wire = originalPb.encode('fate.FateListMsg', {
      fateInfo: result.fates,
      fateSkills: ''
    });
    sendGameSession(state, 4544, wire);
    log(`[DESTINO #${state.id}] Lista de habilidades de destino enviada (Opcode 4544).`);
  } catch (err) {
    log(`[DESTINO #${state.id}] Erro 8628: ${err.message}`);
  }
}

async function handleFateTurn(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      const fate = saved.fate.fates[0];
      if (fate) {
        fate.turnCount = (fate.turnCount || 0) + 1;
        fate.totalGp = (fate.totalGp || 0) + 50;
      }
      return { state: saved, fate };
    });
    state.character = await db.characterById(state.gatewayId);
    state.character.state_json = JSON.stringify(result.state);
    const wire = originalPb.encode('fate.FateEditMsg', {
      skillSonType: 1,
      useItemCount: 1,
      isDisable: false,
      turnNum: 1,
      param1: '',
      param2: '',
      isSuccess: true,
      currCount: 1,
      count: [1],
      payType: 0
    });
    sendGameSession(state, 4545, wire);
    attributeCalculator.recalculate(result.state, state.character.grade);
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
    log(`[DESTINO #${state.id}] Roleta de destino girada com sucesso (Opcode 4545). Atributos e FC recalculados.`);
  } catch (err) {
    log(`[DESTINO #${state.id}] Erro 8627: ${err.message}`);
  }
}

async function handleFateHide(state, body, db, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      saved.fate.hide = saved.fate.hide ? 0 : 1;
      return { state: saved };
    });
    log(`[DESTINO #${state.id}] Ocultação de efeito de destino atualizada.`);
  } catch (err) {
    log(`[DESTINO #${state.id}] Erro 8641: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 4. CHEFÃO MUNDIAL (World Boss)
// -------------------------------------------------------------
async function handleWorldBossState(state, body, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const wire = originalPb.encode('campaign.WorldBossStateMsg', {
      worldBossInfo: [
        { campaignId: 5001, state: 0 },
        { campaignId: 5002, state: 0 },
        { campaignId: 5003, state: 0 },
        { campaignId: 5004, state: 0 }
      ]
    });
    sendGameSession(state, 4182, wire);
    log(`[CHEFÃO MUNDIAL #${state.id}] Estado de chefões mundiais enviado (Opcode 4182 - 5001..5004 ABERTOS).`);
  } catch (err) {
    log(`[CHEFÃO MUNDIAL #${state.id}] Erro 8271: ${err.message}`);
  }
}

async function handleWorldBossReq(state, body, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const wire = originalPb.encode('campaign.WorldBossStateMsg', {
      worldBossInfo: [
        { campaignId: 5001, state: 0 },
        { campaignId: 5002, state: 0 },
        { campaignId: 5003, state: 0 },
        { campaignId: 5004, state: 0 }
      ]
    });
    sendGameSession(state, 4171, wire);
    log(`[CHEFÃO MUNDIAL #${state.id}] Dados de entrada no chefão mundial enviados (Opcode 4171 - 5001..5004 ABERTOS).`);
  } catch (err) {
    log(`[CHEFÃO MUNDIAL #${state.id}] Erro 8259: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 5. ARENA DO GUARDIÃO (Guard Arena)
// -------------------------------------------------------------
async function handleGuardArenaReq(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  let req = { op: 0 };
  try {
    if (body && body.length > 0) req = originalPb.decode('carnival.GuardArenaReq', body);
  } catch (_) {}

  const op = Number(req.op || 0);
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      return { state: saved, arena: saved.guardArena };
    });
    state.character.state_json = result.state;
    const ga = result.arena;

    if (op === 2) {
      // Lista de Ranking
      const rankWire = originalPb.encode('carnival.GuardArenaRankRes', {
        rank: ga.rank || 1,
        rankers: [
          { rank: 1, nickName: state.character?.name || 'ValiantP0', score: 3000 }
        ]
      });
      sendGameSession(state, 4951, rankWire);
    } else {
      // Info Base / Refresh Opponents
      const infoWire = originalPb.encode('carnival.GuardArenaInfoRes', {
        freeTimes: ga.freeTimes || 10,
        nextFreeTime: 0,
        rank: ga.rank || 1,
        score: ga.score || 1000,
        fight: 25000,
        challengeTimes: ga.challengeTimes || 0,
        buyTimes: ga.buyTimes || 0,
        opponent: [
          { id: 101, name: 'Guardião Voraz', rank: 2, fight: 18000, profession: 1, level: 35 },
          { id: 102, name: 'Sentinela Titã', rank: 3, fight: 20000, profession: 2, level: 38 },
          { id: 103, name: 'Comandante Solar', rank: 4, fight: 22000, profession: 3, level: 40 }
        ]
      });
      sendGameSession(state, 4950, infoWire);
    }
    log(`[ARENA GUARDIÃO #${state.id}] Operação ${op} processada.`);
  } catch (err) {
    log(`[ARENA GUARDIÃO #${state.id}] Erro 9060: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 6. MEDALHA DE HONRA & EQUIPAMENTOS DE HONRA
// -------------------------------------------------------------
async function handleMedalItem(state, body, db, log) {
  if (!state.gatewayId || state.closed) return;
  let req = { op: 1, delayDays: 30 };
  try {
    if (body && body.length > 0) req = originalPb.decode('medal.MedalOpReq', body);
  } catch (_) {}
  try {
    await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      saved.medal.active = true;
      saved.medal.delayDays = (saved.medal.delayDays || 0) + Number(req.delayDays || 30);
      return { state: saved };
    });
    log(`[MEDALHA #${state.id}] Medalha de honra ativada/estendida por ${req.delayDays} dias.`);
  } catch (err) {
    log(`[MEDALHA #${state.id}] Erro 8869: ${err.message}`);
  }
}

async function handleHonorEquipLevelUp(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    let req = { param1: 1 };
    try {
      if (body && body.length > 0) req = originalPb.decode('simple.HonorEquipReq', body);
    } catch (_) {}
    const opType = Number(req.param1 || 1);

    const list = configRepo.getTable('t_s_honorequip') || [];
    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
      ensureSubsystemsState(saved);
      saved.wallet = saved.wallet || {};

      if (opType === 2) {
        // Ascender (UpgradeType 1)
        const currentStage = Number(saved.honorEquip.stage || 0);
        const nextStage = currentStage + 1;
        const tmpl = list.find(x => Number(x.UpgradeType) === 1 && Number(x.Level) === nextStage)
          || list.find(x => Number(x.UpgradeType) === 1 && Number(x.Level) === currentStage)
          || list.find(x => Number(x.UpgradeType) === 1 && Number(x.Level) === 0);
        const honorCost = tmpl ? Number(tmpl.Honor || 1000) : 1000;
        const currentHonor = Number(saved.wallet.honor ?? saved.honor ?? 50000);
        saved.wallet.honor = Math.max(0, currentHonor - Math.min(currentHonor, honorCost));
        saved.honorEquip.stage = nextStage;
      } else {
        // Melhorar Nível (UpgradeType 0)
        const currentLevel = Number(saved.honorEquip.level || 0);
        const tmpl = list.find(x => Number(x.UpgradeType) === 0 && Number(x.Level) === currentLevel)
          || list.find(x => Number(x.UpgradeType) === 0 && Number(x.Level) === 0);

        const goldCost = tmpl ? Number(tmpl.ConsumeGold || 0) : 10000;
        let neededItem = 208001;
        let neededCount = 40;
        if (tmpl && tmpl.ConsumeItem) {
          const parts = String(tmpl.ConsumeItem).split(',');
          if (parts.length >= 2) {
            neededItem = Number(parts[0]);
            neededCount = Number(parts[1]);
          }
        }

        const currentGold = Number(saved.wallet.gold || locked.gold || 0);
        if (goldCost > 0 && currentGold < goldCost) {
          throw new Error(`Ouro insuficiente para elevar equipamento de honra: requer ${goldCost}, possui ${currentGold}`);
        }

        const bag = inventoryState.inventory(saved);
        const medalItems = bag.items.filter(i => Number(i.templateId) === neededItem && Number(i.count) > 0);
        const totalMedals = medalItems.reduce((acc, i) => acc + Number(i.count || 0), 0);
        const honorCoins = Number(saved.wallet.honor || saved.honor || 0);
        if (neededCount > 0 && totalMedals + honorCoins < neededCount) {
          throw new Error(`Medalhas de honra insuficientes: requer ${neededCount}, possui ${totalMedals + honorCoins}`);
        }

        if (goldCost > 0) {
          saved.wallet.gold = currentGold - goldCost;
        }

        let remainingMedals = neededCount;
        for (const item of medalItems) {
          if (remainingMedals <= 0) break;
          if (item.count <= remainingMedals) {
            remainingMedals -= item.count;
            item.count = 0;
          } else {
            item.count -= remainingMedals;
            remainingMedals = 0;
          }
        }
        bag.items = bag.items.filter(i => i.count > 0);

        if (remainingMedals > 0 && saved.wallet.honor) {
          saved.wallet.honor = Math.max(0, (saved.wallet.honor || 0) - remainingMedals);
        }

        saved.honorEquip.level = currentLevel + 1;
      }

      const attributeCalculator = require('./attribute-calculator');
      attributeCalculator.recalculate(saved);

      return {
        state: saved,
        honorEquip: saved.honorEquip,
        gold: saved.wallet.gold
      };
    });

    state.character = await db.characterById(state.gatewayId);
    state.character.state_json = JSON.stringify(result.state);

    const wire = originalPb.encode('simple.HonorEquipInfoMsg', {
      level: result.honorEquip.level,
      stage: result.honorEquip.stage
    });
    sendGameSession(state, 4556, wire);

    const heroState = require('./hero-state');
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
    log(`[EQUIPAMENTO HONRA #${state.id}] Nível elevado para ${result.honorEquip.level} (Estágio ${result.honorEquip.stage}).`);
  } catch (err) {
    log(`[EQUIPAMENTO HONRA #${state.id}] Erro 8877: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 7. SETE METAS / 7 DIAS (Seven Target Tasks)
// -------------------------------------------------------------
async function handleSevenTargetInfo(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      return { state: saved, st: saved.sevenTarget };
    });
    state.character.state_json = result.state;
    const st = result.st;
    const wire = originalPb.encode('active.SevenTargetInfoRsp', {
      startTime: Math.floor(Date.now() / 1000) - 86400,
      rewardSite: 0,
      giftSite: 0,
      starNum: st.starNum || 5,
      day: st.day || 1,
      residualTime: 604800,
      sevenTask: [
        { taskId: 1001, taskType: 1, status: 0, finishNum: 1 },
        { taskId: 1002, taskType: 2, status: 0, finishNum: 1 }
      ]
    });
    sendGameSession(state, 4701, wire);
    log(`[SETE METAS #${state.id}] Dados de 7 dias enviados (Opcode 4701).`);
  } catch (err) {
    log(`[SETE METAS #${state.id}] Erro 8785: ${err.message}`);
  }
}

async function handleSevenTargetTaskReceive(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  let taskId = 1001;
  try {
    const dec = originalPb.decode('active.TaskReceiveReq', body);
    taskId = Number(dec.taskId || 1001);
  } catch (_) {}

  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      if (!saved.sevenTarget.completedTasks.includes(taskId)) {
        saved.sevenTarget.completedTasks.push(taskId);
      }
      saved.sevenTarget.starNum = (saved.sevenTarget.starNum || 0) + 1;
      return { state: saved };
    });
    state.character.state_json = result.state;
    const wire = originalPb.encode('active.TaskReceiveRsp', {
      starNum: result.state.sevenTarget.starNum,
      status: {
        taskId: taskId,
        taskType: 1,
        status: 1,
        finishNum: 1
      }
    });
    sendGameSession(state, 4702, wire);
    log(`[SETE METAS #${state.id}] Recompensa da meta ${taskId} resgatada (Opcode 4702).`);
  } catch (err) {
    log(`[SETE METAS #${state.id}] Erro 8786: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 8. ESTRELAS DE MONTARIA (Mount UpStar)
// -------------------------------------------------------------
async function handleMountUpStar(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  let req = { param1: 1001, param2: 1 };
  try {
    if (body && body.length > 0) req = originalPb.decode('campaign.MountEditMsg', body);
  } catch (_) {}

  const mountTempId = Number(req.param1 || 1001);
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      if (!saved.mounts[mountTempId]) {
        saved.mounts[mountTempId] = {
          mountTempId,
          starLevel: 1,
          activeDate: '2026-10-22 00:00:00',
          expairDate: '2099-12-31 23:59:59',
          isExist: true
        };
      }
      saved.mounts[mountTempId].starLevel = (saved.mounts[mountTempId].starLevel || 1) + 1;
      return { state: saved, mount: saved.mounts[mountTempId] };
    });

    state.character.state_json = result.state;
    const m = result.mount;
    const wire = originalPb.encode('campaign.AvatarInfoMsg', {
      mountTempId: m.mountTempId,
      activeDate: m.activeDate,
      expairDate: m.expairDate,
      isExist: true,
      param1: 100,
      param2: 1,
      starLevel: m.starLevel
    });
    sendGameSession(state, 4679, wire);
    log(`[MONTARIA ESTRELA #${state.id}] Montaria ${mountTempId} avançada para estrela ${m.starLevel} (Opcode 4679).`);
  } catch (err) {
    log(`[MONTARIA ESTRELA #${state.id}] Erro 8802: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 9. DIÁLOGOS DE HISTÓRIA (Game Story)
// -------------------------------------------------------------
async function handleGameStoryReq(state, body, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  let req = { index: 1, isAccess: true, isDrop: true };
  try {
    if (body && body.length > 0) req = originalPb.decode('active.GameStoryMsg', body);
  } catch (_) {}

  try {
    const wire = originalPb.encode('active.GameStoryMsg', {
      index: Number(req.index || 1),
      isAccess: true,
      isDrop: true
    });
    sendGameSession(state, 4546, wire);
    log(`[HISTÓRIA #${state.id}] Cena de história ${req.index} sincronizada (Opcode 4546).`);
  } catch (err) {
    log(`[HISTÓRIA #${state.id}] Erro 8629: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 10. RUNAS - RESOLVER E SUBIR NÍVEL
// -------------------------------------------------------------
async function handleRuneResolve(state, body, db, sendGameSession, sendInventorySnapshot, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 4495, Buffer.alloc(0));
    sendInventorySnapshot(state);
    log(`[RUNA #${state.id}] Decomposição de runa concluída (Opcode 4495).`);
  } catch (err) {
    log(`[RUNA #${state.id}] Erro 8854: ${err.message}`);
  }
}

async function handleRuneUp(state, body, db, sendGameSession, sendInventorySnapshot, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 4495, Buffer.alloc(0));
    sendInventorySnapshot(state);
    log(`[RUNA #${state.id}] Evolução de runa concluída (Opcode 4495).`);
  } catch (err) {
    log(`[RUNA #${state.id}] Erro 8855: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 11. PASS TASK (Passe de Metas Diárias/Semanais - Opcodes 8804, 8805 -> 4726, 4727)
// -------------------------------------------------------------
async function handlePassTaskInfo(state, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      return { state: saved };
    });
    state.character.state_json = result.state;
    const pt = result.state.passTask;
    const taskConfig = configRepo.getTable('t_s_passchecktask') || [];
    const tasks = (pt.tasks && pt.tasks.length > 0) ? pt.tasks : [
      { taskId: Number(taskConfig[0]?.TaskId || 101), taskType: 1, status: 0, finishNum: 0, id: 1, area: 1 },
      { taskId: Number(taskConfig[1]?.TaskId || 102), taskType: 1, status: 0, finishNum: 0, id: 2, area: 1 }
    ];

    const wire = originalPb.encode('active.PassTaskAllInfoMsg', {
      passTask: tasks,
      dayFreshNum: pt.dayFreshNum || 0,
      weekFreshNum: pt.weekFreshNum || 0,
      exp: pt.exp || 100,
      grade: pt.grade || 1,
      opType: 1
    });
    sendGameSession(state, 4726, wire);
    log(`[PASS TASK #${state.id}] Informações de tarefas do passe sincronizadas (Opcode 4726).`);
  } catch (err) {
    log(`[PASS TASK #${state.id}] Erro 8804: ${err.message}`);
  }
}

async function handlePassTaskFresh(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      saved.passTask.dayFreshNum = (saved.passTask.dayFreshNum || 0) + 1;
      return { state: saved };
    });
    state.character.state_json = result.state;
    const pt = result.state.passTask;

    const wire = originalPb.encode('active.PassTaskAllInfoMsg', {
      passTask: pt.tasks || [],
      dayFreshNum: pt.dayFreshNum,
      weekFreshNum: pt.weekFreshNum || 0,
      exp: pt.exp || 100,
      grade: pt.grade || 1,
      opType: 2
    });
    sendGameSession(state, 4726, wire);
    sendGameSession(state, 4727, Buffer.alloc(0));
    log(`[PASS TASK #${state.id}] Tarefas atualizadas com sucesso (Opcode 4726, 4727).`);
  } catch (err) {
    log(`[PASS TASK #${state.id}] Erro 8805: ${err.message}`);
  }
}

async function handlePassRewardInfo(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 4725, Buffer.alloc(0));
    log(`[PASS REWARD #${state.id}] Recompensa de passe processada (Opcode 4725).`);
  } catch (err) {
    log(`[PASS REWARD #${state.id}] Erro 8803: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 12. SEASON PASS (Passe de Batalha de Temporada - Opcode 9076 -> 816)
// -------------------------------------------------------------
async function handleSeasonPassReq(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      return { state: saved };
    });
    state.character.state_json = result.state;
    const sp = result.state.seasonPass;
    const seasonTasks = configRepo.getTable('t_s_seasonpass_task') || [];
    const tasks = (sp.tasks && sp.tasks.length > 0) ? sp.tasks : [
      { taskId: Number(seasonTasks[0]?.TaskId || 101), status: 0, progress: 0 }
    ];

    const wire = originalPb.encode('gamebox.SeasonPassInfoRes', {
      seasonId: sp.seasonId || 1,
      passId: sp.passId || 1,
      passLevel: sp.passLevel || 1,
      passExp: sp.passExp || 50,
      status: sp.status || 1,
      freeProgress: sp.freeProgress || 0,
      payProgress: sp.payProgress || 0,
      tasks: tasks
    });
    sendGameSession(state, 816, wire);
    log(`[SEASON PASS #${state.id}] Sincronizado Season Pass Res (Opcode 816).`);
  } catch (err) {
    log(`[SEASON PASS #${state.id}] Erro 9076: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 13. GUILD MAZE (Labirinto da Guilda - Opcode 9098 -> 869)
// -------------------------------------------------------------
async function handleGuildMazeOp(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      return { state: saved };
    });
    state.character.state_json = result.state;
    const gm = result.state.guildMaze;

    const wire = originalPb.encode('guildmaze.GuildMazeMsg', {
      levelId: gm.levelId || 1,
      defaultEventId: gm.defaultEventId || 1,
      grid: gm.grid || [
        { pos: 1, eventId: 101, ownerUserId: 0, hideEventId: 0 },
        { pos: 2, eventId: 102, ownerUserId: 0, hideEventId: 0 }
      ],
      boss: gm.boss || [
        { bossId: 1, hp: 1000000, maxHp: 1000000 }
      ]
    });
    sendGameSession(state, 869, wire);
    log(`[GUILD MAZE #${state.id}] Informações de Labirinto de Guilda sincronizadas (Opcode 869).`);
  } catch (err) {
    log(`[GUILD MAZE #${state.id}] Erro 9098: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 14. CONSORTIA ALTAR (Altar da Guilda - Opcodes 8541, 8542 -> 4436, 4437)
// -------------------------------------------------------------
async function handleConsortiaAltarOpen(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const wire = originalPb.encode('consortia.ConsortiaAltarOpenRspMsg', {
      consortiaId: 1,
      chairmanId: Number(state.gatewayId),
      chairmanName: state.character?.NickName || 'Lorde',
      result: 1,
      altarDate: '2026-10-22 12:00:00',
      pop: 1
    });
    sendGameSession(state, 4436, wire);
    log(`[ALTAR GUILDA #${state.id}] Altar da Guilda aberto com sucesso (Opcode 4436).`);
  } catch (err) {
    log(`[ALTAR GUILDA #${state.id}] Erro 8541: ${err.message}`);
  }
}

async function handleConsortiaAltarEnter(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const wire = originalPb.encode('consortia.ConsortiaAltarOpenRspMsg', {
      consortiaId: 1,
      chairmanId: Number(state.gatewayId),
      chairmanName: state.character?.NickName || 'Lorde',
      result: 1,
      altarDate: '2026-10-22 12:00:00',
      pop: 1
    });
    sendGameSession(state, 4436, wire);
    log(`[ALTAR GUILDA #${state.id}] Entrou no Altar da Guilda (Opcode 4436).`);
  } catch (err) {
    log(`[ALTAR GUILDA #${state.id}] Erro 8542: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 15. FARM & DIVINE TREE (Fazenda e Árvore Sagrada - Opcodes 8231, 8773 -> 4386, 4987)
// -------------------------------------------------------------
async function handleFarmInfoReq(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      return { state: saved };
    });
    state.character.state_json = result.state;
    const f = result.state.farm;

    const wire = originalPb.encode('farm.FarmInfoRspMsg', {
      userId: Number(state.gatewayId),
      nickName: state.character?.NickName || 'Lorde',
      grades: Number(state.character?.Grade || 30),
      landGrades: f.landGrades || 1,
      gp: f.farmGp || 100,
      totalGp: f.farmGp || 100,
      todayFromFriendGp: 0,
      farmLandInfo: [
        { userId: Number(state.gatewayId), type: 1, pos: 1, itemTemplateId: 0, plantingTime: 0, matureTime: 0, cropState: 0, accelerateCount: 0, stolenCount: 0, rewardCount: 0 }
      ],
      treeInfo: {
        userId: Number(state.gatewayId),
        nickName: state.character?.NickName || 'Lorde',
        waterCount: 0,
        fruitCount: 0,
        isFirstFruit: 0,
        canWater: 1
      },
      todayStolenCount: f.stolenCount || 0,
      petInfo: [],
      guardPetInfo: null,
      divineTreeInfo: {
        userId: Number(state.gatewayId),
        treeGp: f.treeGp || 0,
        treeGrade: f.treeGrade || 1,
        treeGoldWater: f.treeGoldWater || 0,
        treeDiamondWater: f.treeDiamondWater || 0,
        treeStateValue: f.treeStateValue || 0
      },
      todayFeedCount: 0
    });
    sendGameSession(state, 4386, wire);
    log(`[FAZENDA #${state.id}] Informações de Fazenda enviadas (Opcode 4386).`);
  } catch (err) {
    log(`[FAZENDA #${state.id}] Erro 8231: ${err.message}`);
  }
}

async function handleDivineTreeReq(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      saved.farm.treeGp = (saved.farm.treeGp || 0) + 10;
      return { state: saved };
    });
    state.character.state_json = result.state;
    const f = result.state.farm;

    const wire = originalPb.encode('farm.DivineTreeRspMsg', {
      opType: 1,
      data: {
        userId: Number(state.gatewayId),
        treeGp: f.treeGp,
        treeGrade: f.treeGrade || 1,
        treeGoldWater: f.treeGoldWater || 0,
        treeDiamondWater: f.treeDiamondWater || 0,
        treeStateValue: f.treeStateValue || 0
      }
    });
    sendGameSession(state, 4987, wire);
    log(`[ÁRVORE SAGRADA #${state.id}] Árvore Sagrada cultivada com sucesso (Opcode 4987).`);
  } catch (err) {
    log(`[ÁRVORE SAGRADA #${state.id}] Erro 8773: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 16. TREASURE MAP (Mapa do Tesouro - Opcodes 8746, 8744 -> 4633, 4634)
// -------------------------------------------------------------
async function handleTreasureMapReq(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      return { state: saved };
    });
    state.character.state_json = result.state;
    const tm = result.state.treasureMap;

    const wire = originalPb.encode('treasuremap.PlayerTreasureMsg', {
      userId: Number(state.gatewayId),
      joinCount: tm.joinCount || 0,
      rewardCount: tm.rewardCount || 0,
      index: tm.index || 1,
      templateIds: tm.templateIds || [208001, 208002],
      opType: 0,
      payType: 0,
      refreshType: 0,
      isReward: 0,
      isFirstQuest: 0,
      isFirstGet: 0,
      isFirstUse: 0
    });
    sendGameSession(state, 4633, wire);
    log(`[MAPA TESOURO #${state.id}] Dados do Mapa do Tesouro sincronizados (Opcode 4633).`);
  } catch (err) {
    log(`[MAPA TESOURO #${state.id}] Erro 8746: ${err.message}`);
  }
}

async function handleTreasureMapOp(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 4634, Buffer.alloc(0));
    log(`[MAPA TESOURO #${state.id}] Operação de Mapa do Tesouro concluída (Opcode 4634).`);
  } catch (err) {
    log(`[MAPA TESOURO #${state.id}] Erro 8744: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 17. TOLLGATE & SINGLE PASS (Portão de Pedágio / Desafio Solo - Opcodes 8753, 8636 -> 4645, 4552)
// -------------------------------------------------------------
async function handleTollgateReq(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      return { state: saved };
    });
    state.character.state_json = result.state;
    const tg = result.state.tollgate;

    const wire = originalPb.encode('tollgate.TollgateMsg', {
      type: 1,
      userId: Number(state.gatewayId),
      endTime: 0,
      order: 1,
      score: tg.score || 100,
      remainCount: tg.remainCount || 10,
      remainTime: 0,
      challengeInfo: [],
      scoreInfo: [
        {
          userId: Number(state.gatewayId),
          tollgateId: tg.curTollgateId || 1,
          score: tg.score || 100,
          order: 1,
          isLucky: false,
          nickName: state.character?.NickName || 'Lorde',
          isVip: 0,
          grade: Number(state.character?.Grade || 30),
          consortiaName: '',
          fightCapacity: 5000
        }
      ],
      isOpen: 1,
      curTollgateId: tg.curTollgateId || 1,
      luckyReward: 0,
      remainBuyCount: 5,
      startTime: 0,
      addTimeCount: 0
    });
    sendGameSession(state, 4645, wire);
    log(`[TOLLGATE #${state.id}] Estado de Tollgate sincronizado (Opcode 4645).`);
  } catch (err) {
    log(`[TOLLGATE #${state.id}] Erro 8753: ${err.message}`);
  }
}

async function handleSinglePassAreaUpdate(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      return { state: saved };
    });
    state.character.state_json = result.state;
    const tg = result.state.tollgate;

    const wire = originalPb.encode('tollgate.SinglePassMsg', {
      userId: Number(state.gatewayId),
      area: 1,
      maxIndex: tg.singlePassMaxIndex || 5,
      areaReward: 0,
      count: 0,
      itemCount: 0,
      from: 0,
      rankInfo: [{ index: 1, rank: 1 }]
    });
    sendGameSession(state, 4552, wire);
    log(`[SINGLE PASS #${state.id}] SinglePassMsg sincronizado (Opcode 4552).`);
  } catch (err) {
    log(`[SINGLE PASS #${state.id}] Erro 8636: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 18. SOLO ARENA (Arena Solo / Desafios - Opcodes 8256, 8879, 8329 -> 4169, 4243, 4244)
// -------------------------------------------------------------
async function handleSoloChallengeInfo(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      return { state: saved };
    });
    state.character.state_json = result.state;
    const sa = result.state.soloArena;
    const arenaRewards = configRepo.getTable('t_s_singlearenarewards') || [];

    const wire = originalPb.encode('simple.ChallengeInfoMsg', {
      lastWinCount: sa.lastWinCount || 0,
      challengeCount: sa.challengeCount || 10,
      curScore: sa.curScore || 1000,
      simplePlayer: [
        {
          userId: 99991,
          nickName: 'Gladiador Audaz',
          isExist: true,
          sexs: 1,
          grades: 30,
          gpOrder: 1,
          fightingCapacity: 8500,
          job: 1
        }
      ],
      challengeLog: [],
      noticMsg: '',
      avater: [],
      totalCount: sa.totalCount || 15,
      winCountReward: 0,
      nextRefreshTime: 0,
      freeRefreshTimes: 5,
      payRefreshTimes: 0,
      totalBuyCount: 0
    });
    sendGameSession(state, 4169, wire);
    log(`[ARENA SOLO #${state.id}] Sincronizado ChallengeInfoMsg (Opcode 4169).`);
  } catch (err) {
    log(`[ARENA SOLO #${state.id}] Erro 8256: ${err.message}`);
  }
}

async function handleSoloChallengeAttack(state, body, db, sendGameSession, sendInventorySnapshot, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      saved.soloArena.lastWinCount = (saved.soloArena.lastWinCount || 0) + 1;
      saved.soloArena.curScore = (saved.soloArena.curScore || 1000) + 20;
      saved.soloArena.challengeCount = Math.max(0, (saved.soloArena.challengeCount || 10) - 1);
      return { state: saved };
    });
    state.character.state_json = result.state;

    // Conceder recompensa de Insígnias de Arena e Ouro ao jogador
    try {
      await db.ready().execute(
        'UPDATE `characters` SET `Gold` = `Gold` + 2000, `Honor` = `Honor` + 50 WHERE `Id` = ?',
        [Number(state.gatewayId)]
      );
    } catch (_) {}

    const wire = originalPb.encode('player.ChallengeRankRewardMsg', {
      isTake: 1,
      param1: 2000,
      param2: 50,
      param3: 0,
      param4: 0
    });
    sendGameSession(state, 4243, wire);
    sendInventorySnapshot(state);
    log(`[ARENA SOLO #${state.id}] Desafio da Arena concluído com vitória e recompensas (Opcode 4243).`);
  } catch (err) {
    log(`[ARENA SOLO #${state.id}] Erro 8879: ${err.message}`);
  }
}

async function handleSoloChallengeReward(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const wire = originalPb.encode('player.ChallengeRankRewardMsg', {
      isTake: 1,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0
    });
    sendGameSession(state, 4244, wire);
    log(`[ARENA SOLO #${state.id}] Recompensa de ranking da Arena coletada (Opcode 4244).`);
  } catch (err) {
    log(`[ARENA SOLO #${state.id}] Erro 8329: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 19. PET CHALLENGE (Desafio de Mascotes / Silfos - Opcode 8724 -> 4611)
// -------------------------------------------------------------
async function handlePetChallengeInfo(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      return { state: saved };
    });
    state.character.state_json = result.state;
    const pc = result.state.petChallenge;

    const wire = originalPb.encode('pet.PetChallengeInfoMsg', {
      playerInfo: {
        leftTime: 0,
        challengeCount: pc.challengeCount || 10,
        totalCount: pc.totalCount || 10,
        score: pc.score || 1000,
        order: pc.ranking || 1
      },
      playerPets: [
        {
          userId: Number(state.gatewayId),
          nickName: state.character?.NickName || 'Lorde',
          order: pc.ranking || 1,
          chaPos: 1,
          score: pc.score || 1000,
          petCount: 1,
          op: 0,
          fightIndex: 1
        }
      ],
      challengeLog: []
    });
    sendGameSession(state, 4611, wire);
    log(`[DESAFIO PET #${state.id}] Lista de desafio de mascotes sincronizada (Opcode 4611).`);
  } catch (err) {
    log(`[DESAFIO PET #${state.id}] Erro 8724: ${err.message}`);
  }
}

async function persistSubsystemsState(state, db, saved) {
  if (db && db.mutateCharacterState && state.gatewayId) {
    const result = await db.mutateCharacterState(state.gatewayId, prev => {
      ensureSubsystemsState(prev);
      Object.assign(prev, saved);
      return { state: prev };
    });
    if (result && result.state) {
      state.character.state_json = result.state;
      return result.state;
    }
  }
  if (state.character) {
    state.character.state_json = saved;
  }
  return saved;
}

// -------------------------------------------------------------
// 17. CASAMENTO / MARRIAGE (Opcodes 9712, 9713, 9714 -> 466, 484)
// -------------------------------------------------------------
async function handleMarriageReq(state, buffer, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const saved = inventoryState.parseState(state.character?.state_json || {});
    ensureSubsystemsState(saved);
    const m = saved.marriage;
    const wire = originalPb.encode('marriage.MarriageMsg', {
      mateId: m.mateId || 0,
      state: m.state || 0,
      ringTemplateId: m.ringTemplateId || 1001,
      marriageTime: m.marriageTime || 0,
      specTemplateId: m.specTemplateId || 1,
      mateNick: m.mateNick || '',
      answerNum: m.answerNum || 0,
      mateLogoutDays: m.mateLogoutDays || 0,
      marTimeId: m.marTimeId || 0,
      mateHeadId: m.mateHeadId || 0
    });
    sendGameSession(state, 466, wire);
    log(`[CASAMENTO #${state.id}] Estado de casamento sincronizado (Opcode 466).`);
  } catch (err) {
    log(`[CASAMENTO #${state.id}] Erro 9712: ${err.message}`);
  }
}

async function handleMarriageHeart(state, buffer, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const saved = inventoryState.parseState(state.character?.state_json || {});
    ensureSubsystemsState(saved);
    saved.marriage.answerNum = (saved.marriage.answerNum || 0) + 1;
    await persistSubsystemsState(state, db, saved);
    handleMarriageReq(state, buffer, db, sendGameSession, log);
  } catch (err) {
    log(`[CASAMENTO HEART #${state.id}] Erro 9713: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 18. POÇO DOS DESEJOS (Wishing Pool - Opcodes 9020, 197 -> 197, 198, 199)
// -------------------------------------------------------------
async function handleWishPoolInfo(state, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const saved = inventoryState.parseState(state.character?.state_json || {});
    ensureSubsystemsState(saved);
    const wishes = Object.values(saved.wishPool.wishes);
    const wire = originalPb.encode('active.WishPoolAllMsg', {
      allWishes: wishes
    });
    sendGameSession(state, 197, wire);
    log(`[POÇO DOS DESEJOS #${state.id}] Lista de desejos sincronizada (Opcode 197).`);
  } catch (err) {
    log(`[POÇO DOS DESEJOS #${state.id}] Erro 197: ${err.message}`);
  }
}

async function handleWishPoolOp(state, buffer, db, sendGameSession, sendInventorySnapshot, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const saved = inventoryState.parseState(state.character?.state_json || {});
    ensureSubsystemsState(saved);
    let poolId = 101;
    let optype = 1;
    try {
      const dec = originalPb.decode('active.WishPoolReqMsg', buffer);
      if (dec.poolId) poolId = dec.poolId;
      if (dec.optype) optype = dec.optype;
    } catch (_) {}

    const key = String(poolId);
    if (!saved.wishPool.wishes[key]) {
      saved.wishPool.wishes[key] = { Id: poolId, buyCount: 0, WeekBuyCount: 0 };
    }
    saved.wishPool.wishes[key].buyCount += 1;
    saved.wishPool.wishes[key].WeekBuyCount += 1;

    const rewardItem = { templateId: 208056, count: 1, isBinds: true };
    inventoryState.addItem(saved, rewardItem.templateId, rewardItem.count);
    await persistSubsystemsState(state, db, saved);

    if (sendInventorySnapshot) sendInventorySnapshot(state);

    const respWire = originalPb.encode('active.WishPoolRespMsg', {
      wishResult: 1,
      items: [{ itemId: rewardItem.templateId, count: rewardItem.count }]
    });
    sendGameSession(state, 198, respWire);

    const updateWire = originalPb.encode('active.WishPoolInfoMsg', {
      Id: poolId,
      buyCount: saved.wishPool.wishes[key].buyCount,
      WeekBuyCount: saved.wishPool.wishes[key].WeekBuyCount
    });
    sendGameSession(state, 199, updateWire);

    log(`[POÇO DOS DESEJOS #${state.id}] Sorteio realizado no poço ${poolId} (Opcodes 198, 199).`);
  } catch (err) {
    log(`[POÇO DOS DESEJOS #${state.id}] Erro 9020: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 19. RECRUTAMENTO / GACHA DE DESEJOS (Wish Recruit - Opcodes 4992, 4993, 776)
// -------------------------------------------------------------
async function handleWishRecruitReq(state, buffer, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const saved = inventoryState.parseState(state.character?.state_json || {});
    ensureSubsystemsState(saved);
    const wr = saved.wishRecruit;
    const wire = originalPb.encode('active.WishRecruitActiveAllRes', {
      info: {
        selectId: wr.selectId || 1,
        process: wr.process || 0,
        rewardReceiveId: wr.rewardReceiveId || 0,
        guaranteedProcess: wr.guaranteedProcess || 0,
        freeTimes: wr.freeTimes !== undefined ? wr.freeTimes : 1,
        selectTimes: wr.selectTimes || 0
      },
      sign: {
        signProcess: 1,
        daySingState: 1
      },
      order: {
        taskList: [],
        level: wr.level || 1,
        exp: wr.exp || 0,
        receiveProcess: 0,
        payFlag: 0,
        appendTimes: 0
      }
    });
    sendGameSession(state, 4993, wire);
    log(`[RECRUTAMENTO DESEJOS #${state.id}] Dados de recrutamento sincronizados (Opcode 4993).`);
  } catch (err) {
    log(`[RECRUTAMENTO DESEJOS #${state.id}] Erro 4993: ${err.message}`);
  }
}

async function handleWishRecruitReward(state, buffer, db, sendGameSession, sendInventorySnapshot, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const saved = inventoryState.parseState(state.character?.state_json || {});
    ensureSubsystemsState(saved);
    const wr = saved.wishRecruit;
    wr.process = (wr.process || 0) + 1;
    wr.selectTimes = (wr.selectTimes || 0) + 1;
    await persistSubsystemsState(state, db, saved);

    const wire = originalPb.encode('active.WishRecruitAwardsRes', {
      awards: [
        { id: 208001, count: 5, type: 1 }
      ]
    });
    sendGameSession(state, 776, wire);
    log(`[RECRUTAMENTO RECOMPENSA #${state.id}] Recompensa de recrutamento sincronizada (Opcode 776).`);
  } catch (err) {
    log(`[RECRUTAMENTO RECOMPENSA #${state.id}] Erro 776: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 20. MINA DE CRISTAIS DE DRAGÃO & MINAS PÚBLICAS (Opcodes 9071, 8633, 4548, 4549 -> 807, 808, 4548)
// -------------------------------------------------------------
async function handleDragonCrystalMineReq(state, buffer, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const saved = inventoryState.parseState(state.character?.state_json || {});
    ensureSubsystemsState(saved);
    const dcm = saved.dragonCrystalMine;
    const wire = originalPb.encode('dragoncrystal.DragonCrystalRoomRes', {
      roomId: dcm.roomId || 1,
      mineList: [
        {
          mineId: 1,
          quality: 1,
          occupiedTime: Math.floor(Date.now() / 1000),
          endTime: Math.floor(Date.now() / 1000) + 7200,
          occupied: 0,
          configId: 101,
          plunderCount: 0,
          state: 1,
          lossCount: 0,
          startProtectTime: 0,
          protectSecond: 0
        }
      ],
      todayPreyTimes: dcm.todayPreyTimes || 0,
      todayBuyTimes: dcm.todayBuyTimes || 0,
      todayOccupyTimes: dcm.todayOccupyTimes || 0,
      buyOccupyTimes: dcm.buyOccupyTimes || 0
    });
    sendGameSession(state, 807, wire);
    log(`[MINA CRISTAL DRAGÃO #${state.id}] Sala de mineração sincronizada (Opcode 807).`);
  } catch (err) {
    log(`[MINA CRISTAL DRAGÃO #${state.id}] Erro 9071: ${err.message}`);
  }
}

async function handleMineFieldReq(state, buffer, db, sendGameSession, log, handleCampaignEnter) {
  if (!state.gatewayId || state.closed) return;
  try {
    state.heroSent = true;
    state.sceneStateSent = true;
    state.worldRequested = true;
    const tramcarMsg = {
      count: 10,
      multiple: 1,
      carInfo: [],
      activeTime: 1800
    };
    sendGameSession(state, 4549, originalPb.encode('campaign.TramcarInfoMsg', tramcarMsg));

    if (typeof handleCampaignEnter === 'function') {
      const enterBody = originalPb.encode('campaign.CampaignReqMsg', { campaignId: 30000, paraInt1: 30000, paraInt2: 30000 });
      await handleCampaignEnter(state, enterBody);
    }
    log(`[CAMPO DE MINAS #${state.id}] Jogador entrou na Mina de Ametista (Campanha 30000, Opcode 4549).`);
  } catch (err) {
    log(`[CAMPO DE MINAS #${state.id}] Erro 8633: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 21. GUILDA PVE & CHEFÃO DA GUILDA (Consortia PVE & Boss - Opcodes 8554, 8847 -> 4884, 4886, 4887, 4890, 4739)
// -------------------------------------------------------------
async function handleConsortiaPveReq(state, buffer, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const saved = inventoryState.parseState(state.character?.state_json || {});
    ensureSubsystemsState(saved);
    const cp = saved.consortiaPve;

    const dataWire = originalPb.encode('consortiapve.ConsortiaPveDataMsg', {
      curNodeId: cp.curNodeId || 101,
      boxs: [],
      nodes: [
        {
          nodeId: 101,
          state: 1,
          passCount: 1
        }
      ],
      serverName: 'S1 - Local',
      extraTimes: cp.weekExtraTimes || 0
    });
    sendGameSession(state, 4884, dataWire);

    const nodeWire = originalPb.encode('consortiapve.ConsortiaPveCurNodeMsg', {
      curNodeId: cp.curNodeId || 101,
      bossHp: 800000,
      bossMaxHp: 1000000,
      attackCount: 1,
      buffers: [],
      players: []
    });
    sendGameSession(state, 4886, nodeWire);

    const seasonWire = originalPb.encode('consortiapve.ConsortiaPveSeasonMsg', {
      seasonId: cp.seasonId || 1,
      state: 1,
      beginTime: Math.floor(Date.now() / 1000) - 86400,
      endTime: Math.floor(Date.now() / 1000) + 86400 * 7
    });
    sendGameSession(state, 4887, seasonWire);

    const playerWire = originalPb.encode('consortiapve.ConsortiaPlayerDataMsg', {
      dayTimes: cp.dayTimes || 5,
      weekExtraTimes: cp.weekExtraTimes || 0
    });
    sendGameSession(state, 4890, playerWire);

    log(`[GUILDA PVE #${state.id}] Dados de PVE da Guilda sincronizados (Opcodes 4884, 4886, 4887, 4890).`);
  } catch (err) {
    log(`[GUILDA PVE #${state.id}] Erro 8554: ${err.message}`);
  }
}

async function handleConsortiaBossReq(state, buffer, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const saved = inventoryState.parseState(state.character?.state_json || {});
    ensureSubsystemsState(saved);
    const cb = saved.consortiaBoss;
    const wire = originalPb.encode('consortia.ConsortiaBossMsg', {
      grade: cb.grade || 1,
      spirit: cb.spirit || 0,
      state: cb.state || 0,
      endTime: cb.endTime || 0,
      totalHp: cb.totalHp || 1000000,
      callGrade: cb.callGrade || 1
    });
    sendGameSession(state, 4739, wire);
    log(`[CHEFÃO DA GUILDA #${state.id}] Estado do Chefão da Guilda sincronizado (Opcode 4739).`);
  } catch (err) {
    log(`[CHEFÃO DA GUILDA #${state.id}] Erro 8847/4739: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 22. HABILIDADES DE GUILDA & OFERTAS (Consortia Skills & Offers)
// -------------------------------------------------------------
async function handleConsortiaSkillOfferReq(state, buffer, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const saved = inventoryState.parseState(state.character?.state_json || {});
    ensureSubsystemsState(saved);
    const cs = saved.consortiaSkills;
    sendGameSession(state, 4157, originalPb.encode('consortia.ConsortiaInfoMsg', {
      site: 1,
      hiSkillList: cs.skills.map(s => ({ type: s.type, level: s.level }))
    }));
    log(`[HABILIDADES GUILDA #${state.id}] Habilidades sincronizadas (Opcode 4157).`);
  } catch (err) {
    log(`[HABILIDADES GUILDA #${state.id}] Erro: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 23. CAMPO DE BATALHA & GRUPO DE HONRA (Battlefield & Honor Group)
// -------------------------------------------------------------
async function handleBattlefieldReq(state, buffer, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const saved = inventoryState.parseState(state.character?.state_json || {});
    ensureSubsystemsState(saved);
    sendGameSession(state, 516, Buffer.from([0x08, 0x01, 0x10, 0x01]));
    log(`[CAMPO DE BATALHA #${state.id}] Campo de batalha sincronizado (Opcode 516).`);
  } catch (err) {
    log(`[CAMPO DE BATALHA #${state.id}] Erro 8779: ${err.message}`);
  }
}

// 25. SISTEMA DE CONQUISTAS (Achievement - t_s_achievement, t_s_achievement_award, t_s_achievement_level)
// -------------------------------------------------------------
async function handleAchievementReq(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    let req;
    try {
      req = originalPb.decode('active.AchieveRequestInfoMsg', body);
    } catch (_) {
      req = { op: 1, id: 0 };
    }

    const awardConfigs = canonicalConfigs.getTable('t_s_achievement_award') || [];

    const targetId = Number(req.id) || 1;
    const activeRspInfo = awardConfigs.slice(0, 20).map((a, idx) => {
      const achId = Number(a.Id || (idx + 1));
      return {
        id: achId,
        value: 10,
        status: (req.op === 2 && achId === targetId) ? 2 : 1
      };
    });

    // Opcode 532: AchieveListInfoMsg
    sendGameSession(state, 532, originalPb.encode('active.AchieveListInfoMsg', { activeRspInfo }));

    // Opcode 541: AchieveTotalPointInfoMsg
    sendGameSession(state, 541, originalPb.encode('active.AchieveTotalPointInfoMsg', {
      totalPoint: 250,
      pointInfo: [
        { type1: 1, point: 100 },
        { type1: 2, point: 80 },
        { type1: 3, point: 70 }
      ]
    }));

    // Opcode 531: AchieveBoardListInfoMsg
    sendGameSession(state, 531, originalPb.encode('active.AchieveBoardListInfoMsg', {
      activeRspInfo: [
        { activeId: 1, title: 'Conquistas da Campanha', description: 'Complete as masmorras', sort: 1 },
        { activeId: 2, title: 'Conquistas de Combate', description: 'Vença batalhas na Arena', sort: 2 }
      ]
    }));

    if (req.op === 2) {
      log(`[CONQUISTAS #${state.id}] Recompensa de conquista ${req.id} resgatada (532/541).`);
    } else {
      log(`[CONQUISTAS #${state.id}] Lista de conquistas sincronizada (Opcodes 532, 541, 531).`);
    }
  } catch (err) {
    log(`[CONQUISTAS #${state.id}] Erro 8780: ${err.message}`);
  }
}

// 26. SISTEMA DE SETE DIAS & LOGIN (SevenSign / SevenDay - t_s_sevensignin, t_s_sevendaylogin, t_s_sevengiftbag)
// -------------------------------------------------------------
async function handleSevenSignInfo(state, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const signinConfigs = canonicalConfigs.getTable('t_s_sevensignin') || [];
    const rewardInfo = signinConfigs.slice(0, 7).map((s, idx) => ({
      days: idx + 1,
      item: String(s.Reward || s.reward || '208001,10|208003,5')
    }));

    const payload = {
      startTime: Math.floor(Date.now() / 1000) - 86400 * 2, // Dia 3
      days: 7,
      rewardSite: 3,
      rewardInfo
    };

    sendGameSession(state, 4705, originalPb.encode('active.SevenSignInfoRsp', payload));
    log(`[SETE DIAS #${state.id}] Info de 7 dias de login enviada (Opcode 4705, dia atual: 3/7).`);
  } catch (err) {
    log(`[SETE DIAS #${state.id}] Erro 8790: ${err.message}`);
  }
}

async function handleSevenSignReceive(state, body, db, sendGameSession, sendInventorySnapshot, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 4704, originalPb.encode('active.SevenSignReceiveRsp', { rewardSite: 7 }));
    log(`[SETE DIAS #${state.id}] Recompensa de 7 dias resgatada com sucesso (Opcode 4704).`);
  } catch (err) {
    log(`[SETE DIAS #${state.id}] Erro 8789: ${err.message}`);
  }
}

// 27. SISTEMA VIP & PACOTES DIÁRIOS (VipPackage - t_s_vippackage, t_s_vipprerogativetemplate, t_s_dailygiftpackage)
// -------------------------------------------------------------
async function handleVipInfo(state, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const vipConfigs = canonicalConfigs.getTable('t_s_vippackage') || [];
    const giftState = vipConfigs.slice(0, 10).map((v, idx) => ({
      vipGrade: idx + 1,
      dayGiftState: 1, // pronto para coletar
      dayGiftTime: 0,
      isFreeGift: true,
      isPayGift: false
    }));

    const wire = originalPb.encode('vip.VipInfoMsg', {
      vipGrade: 5,
      vipGp: 2500,
      isGainBuff: true,
      buffGainTime: Math.floor(Date.now() / 1000),
      buffEndTime: Math.floor(Date.now() / 1000) + 86400 * 30,
      giftState
    });

    sendGameSession(state, 4410, wire);
    log(`[VIP #${state.id}] Informações de VIP sincronizadas (Opcode 4410, VIP Nv. 5).`);
  } catch (err) {
    log(`[VIP #${state.id}] Erro 8513: ${err.message}`);
  }
}

async function handleVipOpenGift(state, body, db, sendGameSession, sendInventorySnapshot, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 4409, Buffer.from([1, 1]));
    log(`[VIP #${state.id}] Pacote VIP diário resgatado com sucesso (Opcode 4409).`);
  } catch (err) {
    log(`[VIP #${state.id}] Erro 8504: ${err.message}`);
  }
}

module.exports = {
  ensureSubsystemsState,
  handleConsortiaTaskInfo,
  handleConsortiaTaskReward,
  handleConsortiaTaskRefresh,
  handleConsortiaTaskUpgradeStar,
  handleTattooReq,
  handleFateRequest,
  handleFateTurn,
  handleFateHide,
  handleWorldBossState,
  handleWorldBossReq,
  handleGuardArenaReq,
  handleMedalItem,
  handleHonorEquipLevelUp,
  handleSevenTargetInfo,
  handleSevenTargetTaskReceive,
  handleMountUpStar,
  handleGameStoryReq,
  handleRuneResolve,
  handleRuneUp,
  handlePassTaskInfo,
  handlePassTaskFresh,
  handlePassRewardInfo,
  handleSeasonPassReq,
  handleGuildMazeOp,
  handleConsortiaAltarOpen,
  handleConsortiaAltarEnter,
  handleFarmInfoReq,
  handleDivineTreeReq,
  handleTreasureMapReq,
  handleTreasureMapOp,
  handleTollgateReq,
  handleSinglePassAreaUpdate,
  handleSoloChallengeInfo,
  handleSoloChallengeAttack,
  handleSoloChallengeReward,
  handlePetChallengeInfo,
  handleMarriageReq,
  handleMarriageHeart,
  handleWishPoolInfo,
  handleWishPoolOp,
  handleWishRecruitReq,
  handleWishRecruitReward,
  handleDragonCrystalMineReq,
  handleMineFieldReq,
  handleConsortiaPveReq,
  handleConsortiaBossReq,
  handleConsortiaSkillOfferReq,
  handleBattlefieldReq,
  handleAchievementReq,
  handleSevenSignInfo,
  handleSevenSignReceive,
  handleVipInfo,
  handleVipOpenGift
};

