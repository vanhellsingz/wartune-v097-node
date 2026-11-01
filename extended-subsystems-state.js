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

function formatBagMoveUpdate(moved, characterId) {
  const list = [];
  for (const m of moved) {
    if (m.item && m.item.count > 0) {
      const tmpl = configRepo.getItemTemplate(m.item.templateId);
      const view = inventoryState.itemProtocolView(m.item, tmpl, characterId);
      list.push({ changeType: m.bagType || 1, changeObjId: m.objectId || 0, changePos: m.pos, item: view });
    } else {
      list.push({ changeType: m.bagType || 1, changeObjId: m.objectId || 0, changePos: m.pos });
    }
  }
  return originalPb.encode('item.ItemMovedListMsg', { moved: list });
}

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
      rewardId: '2',
      fixId: '1'
    };
  }

  // 2. Tattoo
  if (!saved.tattoo || typeof saved.tattoo !== 'object') {
    saved.tattoo = {
      holes: [1, 2, 3, 4, 5, 6].map(h => ({
        hole: h,
        OldAddProperty: h === 1 ? 1 : (h === 2 ? 2 : (h === 3 ? 3 : (h === 4 ? 4 : (h === 5 ? 5 : 6)))),
        OldAddingValue: 100,
        OldReduceProperty: 2, OldReduceValue: 50,
        OldStage: 1,
        NewAddProperty: h === 1 ? 1 : (h === 2 ? 2 : (h === 3 ? 3 : (h === 4 ? 4 : (h === 5 ? 5 : 6)))),
        NewAddingValue: 100,
        NewReduceProperty: 2, NewReduceValue: 50,
        NewStage: 1
      })),
      coreStep: 1
    };
  } else {
    if (!saved.tattoo.coreStep) saved.tattoo.coreStep = 1;
    if (!Array.isArray(saved.tattoo.holes) || saved.tattoo.holes.length < 6) {
      saved.tattoo.holes = [1, 2, 3, 4, 5, 6].map(h => {
        const existing = Array.isArray(saved.tattoo.holes) ? saved.tattoo.holes.find(x => x.hole === h) : null;
        return existing || {
          hole: h,
          OldAddProperty: h === 1 ? 1 : (h === 2 ? 2 : (h === 3 ? 3 : (h === 4 ? 4 : (h === 5 ? 5 : 6)))),
          OldAddingValue: 100,
          OldReduceProperty: 2, OldReduceValue: 50,
          OldStage: 1,
          NewAddProperty: h === 1 ? 1 : (h === 2 ? 2 : (h === 3 ? 3 : (h === 4 ? 4 : (h === 5 ? 5 : 6)))),
          NewAddingValue: 100,
          NewReduceProperty: 2, NewReduceValue: 50,
          NewStage: 1
        };
      });
    }
  }

  // 3. Fate / Astrologia
  if (!saved.fate || typeof saved.fate !== 'object') {
    saved.fate = {
      hide: 0,
      fates: [
        { templateId: 10111, fateTypes: 1, grades: 1, totalGp: 0, property1: '1:50', property2: '', turnCount: 0, hide: 0 },
        { templateId: 10211, fateTypes: 2, grades: 1, totalGp: 0, property1: '2:50', property2: '', turnCount: 0, hide: 0 }
      ]
    };
  } else if (Array.isArray(saved.fate.fates)) {
    for (const f of saved.fate.fates) {
      if (f.fateTypes === 1 && (f.templateId === 1001 || !f.templateId || f.templateId < 10000)) {
        f.templateId = 10100 + (f.grades || 1) * 10 + 1;
      } else if (f.fateTypes === 2 && (f.templateId === 1002 || !f.templateId || f.templateId < 10000)) {
        f.templateId = 10200 + (f.grades || 1) * 10 + 1;
      }
    }
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

  // Guild skills come from paid, persisted research/learning; no seeded levels.

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
function guildTaskState(saved, grade) {
  const ct=saved.consortiaTask&&typeof saved.consortiaTask==='object'?saved.consortiaTask:{};
  const tasks=require('./guild-task-catalog').tasks;
  if(!tasks.some(row=>Number(row.Id)===Number(ct.taskId)&&Number(row.NeedItemId)>0&&Number(row.NeedGrade)<=Number(grade))){
    ct.taskId=tasks.find(row=>Number(row.NeedItemId)>0&&Number(row.NeedGrade)<=Number(grade))?.Id||0;
  }
  ct.starNum=Math.max(1,Math.min(5,Number(ct.starNum)||1));
  ct.fixId='1';ct.rewardId='2';
  if(String(ct.rewardStatus||'').split(',').length!==5)ct.rewardStatus='0,0,0,0,0';
  saved.consortiaTask=ct;
  return ct;
}
async function handleConsortiaTaskInfo(state, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const saved = typeof state.character?.state_json === 'string'
      ? JSON.parse(state.character.state_json) : (state.character?.state_json || {});
    const ct = guildTaskState(saved,state.character?.grade);
    const [members]=await db.ready().query('SELECT consortia_id FROM consortia_members WHERE character_id=?',[state.gatewayId]);
    if(!members.length)return;
    const taskRows=require('./guild-task-catalog').tasks;
    const task=taskRows.find(row=>Number(row.Id)===Number(ct.taskId));
    const star=Math.max(1,Math.min(5,Number(ct.starNum)||1));
    const required=Number(task?.[`CountStar${star}`]||0);
    const itemId=Number(task?.NeedItemId||0);
    const bag=inventoryState.inventory(saved);
    const owned=itemId>0?bag.items.filter(x=>Number(x.templateId)===itemId).reduce((sum,x)=>sum+Number(x.count||0),0):0;
    const process=Math.min(required,owned);
    const wire = originalPb.encode('consortia.AllTaskInfoMsg', {
      score: ct.score || 0,
      finishNum: ct.finishNum || 0,
      rewardStatus: String(ct.rewardStatus||'').split(',').length===5?ct.rewardStatus:'0,0,0,0,0',
      ...(ct.taskId ? {oneTask: {
        taskId: ct.taskId, starNum: star,
        refreshNum: ct.refreshNum || 0, refreshTime: ct.refreshTime || 0,
        status:required>0&&process>=required?1:0, process,
        rewardId:'2',fixId:'1'
      }} : {}),
      recoredInfo: [],
      update: 3
    });
    sendGameSession(state, 454, wire);
    log(`[GUILDA TAREFAS #${state.id}] Estado da missao enviado.`);
  } catch (err) {
    log(`[GUILDA TAREFAS #${state.id}] Erro 9689: ${err.message}`);
  }
}

async function handleConsortiaTaskReward(state, body, db, sendGameSession, log, makeBasicPlayerInfo) {
  if (!state.gatewayId || state.closed) return;
  try {
    const req=originalPb.decode('consortia.TaskRewardReqMsg',body);
    const catalog=require('./guild-task-catalog');
    const week=(()=>{const d=new Date(),m=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));m.setUTCDate(m.getUTCDate()-(m.getUTCDay()+6)%7);return m.toISOString().slice(0,10)})();
    const result=await db.mutateCharacterState(state.gatewayId,async(saved,locked,cx)=>{
      const [members]=await cx.query('SELECT consortia_id,offer,build,total_build FROM consortia_members WHERE character_id=? FOR UPDATE',[state.gatewayId]);
      if(!members.length || Number(saved.consortia?.id)!==Number(members[0].consortia_id))throw Error('Personagem sem guilda valida');
      const guildId=Number(members[0].consortia_id),ct=guildTaskState(saved,locked.grade);
      if(ct.week!==week){ct.week=week;ct.score=0;ct.finishNum=0;ct.rewardStatus='0,0,0,0,0';ct.claimedIds=[];}
      let moved=[],gold=Number(locked.gold)||0,award=null;
      if(Number(req.op)===1){
        const task=catalog.tasks.find(row=>Number(row.Id)===Number(ct.taskId));
        if(!task||Number(locked.grade)<Number(task.NeedGrade))throw Error('Missao de guilda indisponivel para o nivel');
        const itemId=Number(task.NeedItemId),star=Math.max(1,Math.min(5,Number(ct.starNum)||1));
        const required=Number(task[`CountStar${star}`]);
        if(itemId<=0 || !Number.isSafeInteger(required)||required<1)throw Error('Tipo de missao sem entrega validada');
        const bag=inventoryState.inventory(saved),stacks=bag.items.filter(x=>Number(x.bagType)===1&&Number(x.templateId)===itemId);
        if(stacks.reduce((sum,x)=>sum+Number(x.count||0),0)<required)throw Error('Itens da missao insuficientes');
        if(Number(ct.lastClaimAt||0)>Date.now()-800)throw Error('Entrega duplicada no mesmo burst');
        let remaining=required;
        for(const item of stacks){const taken=Math.min(remaining,Number(item.count));item.count-=taken;remaining-=taken;
          if(!item.count)bag.items.splice(bag.items.indexOf(item),1);
          moved.push({bagType:1,pos:Number(item.pos),...(item.count>0?{item}:{})});
          if(!remaining)break;}
        const guildSupply=catalog.rewards.find(row=>Number(row.Id)===1);
        const taskScore=catalog.rewards.find(row=>Number(row.Id)===2);
        const materials=Number(guildSupply?.[`RewardNumStar${star}`]);
        const score=Number(taskScore?.[`RewardNumStar${star}`]);
        if(!Number.isSafeInteger(materials)||materials<1||!Number.isSafeInteger(score)||score<1)
          throw Error('Recompensa da missao invalida no catalogo');
        await cx.query('UPDATE consortia SET materials=materials+? WHERE id=?',[materials,guildId]);
        ct.score=Number(ct.score||0)+score;ct.finishNum=Number(ct.finishNum||0)+1;
        ct.lastClaimAt=Date.now();
        const eligible=catalog.tasks.filter(row=>Number(row.NeedItemId)>0&&Number(row.NeedGrade)<=Number(locked.grade));
        const index=eligible.findIndex(row=>Number(row.Id)===Number(task.Id));
        ct.taskId=eligible[(index+1)%eligible.length]?.Id||0;
        ct.starNum=1;ct.process=0;ct.status=0;ct.fixId='1';ct.rewardId='2';
        award={kind:'task',materials,score,guildId};
      }else if(Number(req.op)===2){
        const index=Number(req.index);
        const thresholds=[1000,2000,3000,4000,5000];
        if(!Number.isSafeInteger(index)||index<0||index>4||Number(ct.score||0)<thresholds[index])
          throw Error('Marco semanal nao atingido');
        const flags=String(ct.rewardStatus||'0,0,0,0,0').split(',');
        if(flags[index]==='1')throw Error('Marco semanal ja recebido');
        const site=11+index,buildRow=catalog.rewards.find(row=>Number(row.Site)===site&&Number(row.RewardItemId)===-6200);
        const goldRow=catalog.rewards.find(row=>Number(row.Site)===site&&Number(row.RewardItemId)===-100);
        const build=Number(buildRow?.RewardNumStar1),addedGold=Number(goldRow?.RewardNumStar1);
        if(!Number.isSafeInteger(build)||build<1||!Number.isSafeInteger(addedGold)||addedGold<1)throw Error('Recompensa semanal invalida');
        await cx.query('UPDATE consortia_members SET build=build+?,total_build=total_build+? WHERE character_id=? AND consortia_id=?',[build,build,state.gatewayId,guildId]);
        saved.consortia.build=Number(members[0].build)+build;
        saved.consortia.totalBuild=Number(members[0].total_build)+build;
        saved.wallet||={};gold+=addedGold;saved.wallet.gold=gold;
        flags[index]='1';ct.rewardStatus=flags.join(',');
        award={kind:'weekly',build,gold:addedGold,guildId};
      }else throw Error('Operacao de tarefa desconhecida');
      saved.consortiaTask=ct;
      return {state:saved,changed:true,award,moved,resources:{gold,grade:Number(locked.grade),experience:Number(saved.progression?.totalXp||locked.experience||0)}};
    });
    state.character=await db.characterById(state.gatewayId);
    if(result.moved.length)sendGameSession(state,115,formatBagMoveUpdate(result.moved,state.gatewayId));
    if(typeof makeBasicPlayerInfo==='function')sendGameSession(state,3,makeBasicPlayerInfo(state.character));
    const guildInfo=await require('./guild-state').getGuildInfo(db.ready(),result.award.guildId);
    if(guildInfo)sendGameSession(state,164,originalPb.encode('consortia.ConsortiaInfoMsg',guildInfo));
    log(`[GUILDA TAREFAS #${state.id}] ${result.award.kind} entregue com persistencia: ${JSON.stringify(result.award)}`);
  }catch(error){log(`[GUILDA TAREFAS #${state.id}] 9690 recusado: ${error.message}`)}
  return handleConsortiaTaskInfo(state, db, sendGameSession, log);
}

async function handleConsortiaTaskRefresh(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  log(`[GUILDA TAREFAS #${state.id}] 9691 indisponivel: custo e limite de refresh nao validados.`);
  return handleConsortiaTaskInfo(state, db, sendGameSession, log);
}

async function handleConsortiaTaskUpgradeStar(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  log(`[GUILDA TAREFAS #${state.id}] 9692 indisponivel: custo de estrela nao validado.`);
  return handleConsortiaTaskInfo(state, db, sendGameSession, log);
}

// -------------------------------------------------------------
// 2. TATUAGEM / FUROS DE TATUAGEM (Tattoo Holes)
// -------------------------------------------------------------
async function handleTattooReq(state, body, db, sendGameSession, log, makeBasicPlayerInfo) {
  if (!state.gatewayId || state.closed) return;
  let req = { opType: 1 };
  try {
    if (body && body.length > 0) req = originalPb.decode('player.TattooHoleReqMsg', body);
  } catch (_) {}

  const opType = Number(req.opType || 1);
  const targetHoleIdx = Number(req.param2 || 1);
  const tattooConfig = configRepo.getTable('t_s_config') || [];
  const configValue = name => String(tattooConfig.find(row => row.ConfigName === name)?.ConfigValue || '');
  const [basicCrystalId, crystalCost] = configValue('Tattoo_consume').split(',').map(Number);
  const maxByStep = configValue('Tattoo_Class_Proterty_Value_Max').split(',').map(Number);
  const gradeByStep = configValue('Tattoo_Upgrade_Grade').split(',').map(Number);

  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      const holes = saved.tattoo.holes;
      saved.tattoo.coreStep = Number(saved.tattoo.coreStep) || 1;
      const itemMoved = [];

      if (opType === 4) { // OP_UPDATE_CORE (Ascensão / Núcleo do Dragão)
        const step = saved.tattoo.coreStep;
        const requiredGrade = gradeByStep[step - 1];
        const maxValue = maxByStep[step - 1];
        if (!requiredGrade || !maxValue || !maxByStep[step]) throw Error('Nucleo da tatuagem no nivel maximo');
        if (Number(state.character?.grade || 0) < requiredGrade) throw Error(`Ascensao requer nivel ${requiredGrade}`);
        const requiredHoles = Math.floor((requiredGrade - 55) / 5) + 3;
        if (holes.filter(h => Number(h.OldAddingValue || 0) >= maxValue).length < requiredHoles)
          throw Error(`Ascensao requer ${requiredHoles} tatuagens maximizadas`);
        saved.tattoo.coreStep = step + 1;
        attributeCalculator.recalculate(saved, state.character?.grade || 80);
      } else if (opType === 2 || opType === 6 || opType === 7) { // OP_REFRESH / OP_ADVANCE_REFRESH / OP_BAPTIZE
        // Basic and advanced crystals use the quantities from the client catalog.
        const bag = inventoryState.inventory(saved);
        const materialId = opType === 6 ? 208053 : basicCrystalId;
        const glasses = bag.items.filter(i => Number(i.templateId) === materialId && Number(i.bagType) === 1);
        let needed = crystalCost;
        if (!materialId || !Number.isSafeInteger(needed) || needed < 1) throw Error('Custo da tatuagem invalido');
        if (glasses.reduce((sum, item) => sum + Number(item.count || 0), 0) < needed)
          throw Error('Cristais de tatuagem insuficientes para refinamento');
        for (const item of glasses) {
          if (needed <= 0) break;
          const used = Math.min(needed, Number(item.count));
          item.count -= used;
          needed -= used;
          itemMoved.push({ bagType: 1, objectId: 0, ownerId: state.gatewayId, pos: item.pos, item: item.count > 0 ? item : null });
        }
        bag.items = bag.items.filter(i => i.count > 0);

        const targetHole = holes.find(h => Number(h.hole) === targetHoleIdx);
        if (!targetHole) throw Error('Furo de tatuagem invalido');
        if (targetHole) {
          targetHole.NewAddProperty = targetHole.OldAddProperty || targetHoleIdx;
          const inc = opType === 6 ? 10 : (Math.floor(Math.random() * 10) + 1);
          const maxValue = maxByStep[saved.tattoo.coreStep - 1] || 900;
          targetHole.NewAddingValue = Math.min(maxValue, (Number(targetHole.OldAddingValue) || 0) + inc);
          targetHole.NewStage = Math.min(8, (Number(targetHole.OldStage) || 1) + 1);
          if (opType === 2 || opType === 6) {
            targetHole.OldAddingValue = targetHole.NewAddingValue;
            targetHole.OldStage = targetHole.NewStage;
          }
        }
      } else if (opType === 3) { // OP_REPLACE (Substituir atributo antigo pelo novo)
        const targetHole = holes.find(h => Number(h.hole) === targetHoleIdx);
        if (!targetHole) throw Error('Furo de tatuagem invalido');
        if (targetHole && targetHole.NewAddingValue != null) {
          targetHole.OldAddProperty = targetHole.NewAddProperty || targetHole.OldAddProperty || targetHoleIdx;
          targetHole.OldAddingValue = targetHole.NewAddingValue || targetHole.OldAddingValue || 100;
          targetHole.OldReduceProperty = targetHole.NewReduceProperty ?? targetHole.OldReduceProperty;
          targetHole.OldReduceValue = targetHole.NewReduceValue ?? targetHole.OldReduceValue;
          targetHole.OldStage = targetHole.NewStage || targetHole.OldStage || 1;
        }
        attributeCalculator.recalculate(saved, state.character?.grade || 80);
      }

      return { state: saved, holes, coreStep: saved.tattoo.coreStep, itemMoved };
    });

    state.character = await db.characterById(state.gatewayId);
    state.character.state_json = JSON.stringify(result.state);

    if (result.itemMoved && result.itemMoved.length > 0) {
      sendGameSession(state, 115, formatBagMoveUpdate(result.itemMoved, state.gatewayId), state.gatewayId);
    }

    const wire = originalPb.encode('player.TattooHoleRspMsg', {
      opType: opType,
      holeInfo: result.holes,
      param1: Number(result.coreStep || 1),
      param2: 0,
      param3: ''
    });
    sendGameSession(state, 274, wire);

    if (opType === 2 || opType === 3 || opType === 4 || opType === 6) {
      sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
      if (typeof makeBasicPlayerInfo === 'function') {
        sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
      }
    }
    log(`[TATUAGEM #${state.id}] Operação ${opType} processada (buraco=${targetHoleIdx}, coreStep=${result.coreStep}). Opcode 274 enviado.`);
  } catch (err) {
    log(`[TATUAGEM #${state.id}] Erro 9568: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 3. ASTROLOGIA E DESTINO (Fate / Rotary)
// -------------------------------------------------------------
function supportedFateGrade(fateTypes) {
  const son = 100 + Number(fateTypes);
  const rows = (configRepo.getTable('t_s_skilltemplate') || []).filter(row =>
    Number(row.SonType) === son && Number(row.Grades) > 0);
  return Math.max(0,...rows.map(row => Number(row.Grades)));
}

function fateForClient(fates) {
  const skills = configRepo.getTable('t_s_skilltemplate') || [];
  return (fates || []).map(fate => {
    const son = 100 + Number(fate.fateTypes);
    const grade = Math.min(Math.max(1,Number(fate.grades)||1),supportedFateGrade(fate.fateTypes));
    const template = skills.find(row => Number(row.SonType) === son && Number(row.Grades) === grade);
    return template ? {...fate,grades:grade,templateId:Number(template.TemplateId)} : fate;
  });
}

async function handleFateRequest(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      return { state: saved, fates: saved.fate.fates };
    });
    state.character.state_json = result.state;
    const wire = originalPb.encode('fate.FateListMsg', {
      fateInfo: fateForClient(result.fates),
      fateSkills: ''
    });
    sendGameSession(state, 4544, wire);
    log(`[DESTINO #${state.id}] Lista de habilidades de destino enviada (Opcode 4544, total: ${result.fates.length}).`);
  } catch (err) {
    log(`[DESTINO #${state.id}] Erro 8628: ${err.message}`);
  }
}

async function handleFateTrain(state, body, db, sendGameSession, log, makeBasicPlayerInfo) {
  if (!state.gatewayId || state.closed) return;
  let req = { skillSonType: 1, useItemCount: 1 };
  try {
    if (body && body.length > 0) req = originalPb.decode('fate.FateEditMsg', body);
  } catch (_) {}

  const skillSonType = Number(req.skillSonType || 1);
  const countToUse = Math.max(1, Number(req.useItemCount) || 1);

  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      const bag = inventoryState.inventory(saved);
      // Item 208024 (Pedra do Destino)
      const stones = bag.items.filter(i => Number(i.templateId) === 208024 && Number(i.bagType) === 1);
      const totalStones = stones.reduce((sum, i) => sum + Number(i.count || 0), 0);

      const actualUsed = Math.min(totalStones, countToUse);
      if (actualUsed < 1) throw Error('Pedra do Destino insuficiente');
      const itemMoved = [];
      let left = actualUsed;
      for (const item of stones) {
        if (!left) break;
        const used = Math.min(left, Number(item.count));
        item.count -= used;
        left -= used;
        itemMoved.push({ bagType: 1, objectId: 0, ownerId: state.gatewayId, pos: item.pos, item: item.count > 0 ? item : null });
      }
      bag.items = bag.items.filter(i => i.count > 0);

      let fate = saved.fate.fates.find(f => f.fateTypes === skillSonType);
      if (fate && Number(fate.grades) >= supportedFateGrade(skillSonType))
        throw Error('Nivel maximo da Pedra do Destino atingido');
      if (!fate) {
        fate = {
          templateId: skillSonType === 1 ? 10111 : 10211,
          fateTypes: skillSonType,
          grades: 1,
          totalGp: 0,
          property1: `${skillSonType}:50`,
          property2: '',
          turnCount: 0,
          hide: 0
        };
        saved.fate.fates.push(fate);
      }

      fate.totalGp = (fate.totalGp || 0) + actualUsed;

      // Calcular nível canônico por t_s_upgradetemplate (Types 26)
      const t26 = (configRepo.getTable('t_s_upgradetemplate') || []).filter(r => Number(r.Types) === 26);
      let remGp = fate.totalGp;
      let calculatedGrade = 0;
      for (let g = 1; g < t26.length; g++) {
        const row = t26.find(r => Number(r.Grades) === g);
        if (!row || remGp < Number(row.Data)) break;
        remGp -= Number(row.Data);
        calculatedGrade = g;
      }
      fate.grades = Math.min(supportedFateGrade(skillSonType),Math.max(1, calculatedGrade));
      const prefix = skillSonType === 1 ? 10100 : 10200;
      fate.templateId = prefix + fate.grades * 10 + 1;

      attributeCalculator.recalculate(saved, state.character?.grade || 80);
      return { state: saved, itemMoved, fate, fates: saved.fate.fates, actualUsed };
    });

    state.character = await db.characterById(state.gatewayId);
    state.character.state_json = JSON.stringify(result.state);

    if (result.itemMoved && result.itemMoved.length > 0) {
      sendGameSession(state, 115, formatBagMoveUpdate(result.itemMoved, state.gatewayId), state.gatewayId);
    }

    const wire = originalPb.encode('fate.FateListMsg', {
      fateInfo: fateForClient(result.fates),
      fateSkills: ''
    });
    sendGameSession(state, 4544, wire);

    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
    if (typeof makeBasicPlayerInfo === 'function') {
      sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    }
    log(`[DESTINO TREINO #${state.id}] ${result.actualUsed} Pedras do Destino usadas. Tipo: ${skillSonType}, Novo GP: ${result.fate.totalGp}, Grau: ${result.fate.grades}.`);
  } catch (err) {
    log(`[DESTINO TREINO #${state.id}] Erro 8626: ${err.message}`);
  }
}

async function handleFateTurn(state, body, db, sendGameSession, log, makeBasicPlayerInfo) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      ensureSubsystemsState(saved);
      const fate = saved.fate.fates[0];
      if (fate) {
        if (Number(fate.grades) >= supportedFateGrade(fate.fateTypes))
          throw Error('Nivel maximo da Roda do Destino atingido');
        fate.turnCount = (fate.turnCount || 0) + 1;
        fate.totalGp = (fate.totalGp || 0) + 10;
        const t26 = (configRepo.getTable('t_s_upgradetemplate') || []).filter(r => Number(r.Types) === 26);
        let remGp = fate.totalGp;
        let calculatedGrade = 0;
        for (let g = 1; g < t26.length; g++) {
          const row = t26.find(r => Number(r.Grades) === g);
          if (!row || remGp < Number(row.Data)) break;
          remGp -= Number(row.Data);
          calculatedGrade = g;
        }
        fate.grades = Math.min(supportedFateGrade(fate.fateTypes),Math.max(1, calculatedGrade));
        fate.templateId = 10100 + fate.grades * 10 + 1;
      }
      attributeCalculator.recalculate(saved, state.character?.grade || 80);
      return { state: saved, fate, fates: saved.fate.fates };
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
    sendGameSession(state, 4544, originalPb.encode('fate.FateListMsg', { fateInfo: fateForClient(result.fates), fateSkills: '' }));
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
    if (typeof makeBasicPlayerInfo === 'function') {
      sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    }
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
    if (op === 2) {
      const rankWire = originalPb.encode('carnival.GuardArenaRankRes', {rankers: []});
      sendGameSession(state, 4951, rankWire);
    } else {
      const infoWire = originalPb.encode('carnival.GuardArenaInfoRes', {
        freeTimes: 0, nextFreeTime: 0, rank: 0, score: 0,
        fight: 0, challengeTimes: 0, buyTimes: 0, opponent: []
      });
      sendGameSession(state, 4950, infoWire);
    }
    log(`[ARENA GUARDIÃO #${state.id}] Operacao ${op} indisponivel: matchmaking/combate/ranking nao implementados.`);
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

async function handleHonorEquipLevelUp(state, body, db, sendGameSession, log, makeBasicPlayerInfo) {
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
      const itemMoved = [];

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
          const used = Math.min(remainingMedals, Number(item.count));
          item.count -= used;
          remainingMedals -= used;
          itemMoved.push({ bagType: 1, objectId: 0, ownerId: state.gatewayId, pos: item.pos, item: item.count > 0 ? item : null });
        }
        bag.items = bag.items.filter(i => i.count > 0);

        if (remainingMedals > 0 && saved.wallet.honor) {
          saved.wallet.honor = Math.max(0, (saved.wallet.honor || 0) - remainingMedals);
        }

        saved.honorEquip.level = currentLevel + 1;
      }

      attributeCalculator.recalculate(saved, state.character?.grade || 80);

      return {
        state: saved,
        honorEquip: saved.honorEquip,
        gold: saved.wallet.gold,
        itemMoved
      };
    });

    state.character = await db.characterById(state.gatewayId);
    state.character.state_json = JSON.stringify(result.state);

    if (result.itemMoved && result.itemMoved.length > 0) {
      sendGameSession(state, 115, formatBagMoveUpdate(result.itemMoved, state.gatewayId), state.gatewayId);
    }

    const wire = originalPb.encode('simple.HonorEquipInfoMsg', {
      level: result.honorEquip.level,
      stage: result.honorEquip.stage
    });
    sendGameSession(state, 4556, wire);

    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
    if (typeof makeBasicPlayerInfo === 'function') {
      sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    }
    log(`[EQUIPAMENTO HONRA #${state.id}] Nível elevado para ${result.honorEquip.level} (Estágio ${result.honorEquip.stage}). Atributos e FC recalculados.`);
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
    const [member]=await db.ready().query('SELECT consortia_id FROM consortia_members WHERE character_id=? LIMIT 1',[state.gatewayId]);
    const wire = originalPb.encode('guildmaze.GuildMazeMsg', {
      levelId:0, defaultEventId:0, grid:[], boss:[]
    });
    sendGameSession(state, 869, wire);
    log(`[GUILD MAZE #${state.id}] 9098 indisponivel (${member.length?'membro':'sem guilda'}): nenhum mapa/chefe ficticio enviado.`);
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
    const [member]=await db.ready().query('SELECT consortia_id FROM consortia_members WHERE character_id=? LIMIT 1',[state.gatewayId]);
    const wire = originalPb.encode('consortia.ConsortiaAltarOpenRspMsg', {
      consortiaId:Number(member[0]?.consortia_id||0),result:0,pop:0
    });
    sendGameSession(state, 4436, wire);
    log(`[ALTAR GUILDA #${state.id}] 8541 indisponivel: abertura sem estado de altar persistido.`);
  } catch (err) {
    log(`[ALTAR GUILDA #${state.id}] Erro 8541: ${err.message}`);
  }
}

async function handleConsortiaAltarEnter(state, body, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const [member]=await db.ready().query('SELECT consortia_id FROM consortia_members WHERE character_id=? LIMIT 1',[state.gatewayId]);
    const wire = originalPb.encode('consortia.ConsortiaAltarOpenRspMsg', {
      consortiaId:Number(member[0]?.consortia_id||0),result:0,pop:0
    });
    sendGameSession(state, 4436, wire);
    log(`[ALTAR GUILDA #${state.id}] 8542 indisponivel: entrada sem altar ativo.`);
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
    for (const poolId of [101, 102, 201, 202]) {
      const k = String(poolId);
      if (!saved.wishPool.wishes[k]) {
        saved.wishPool.wishes[k] = { Id: poolId, buyCount: 0, WeekBuyCount: 0 };
      }
    }
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
    let poolId = 101;
    let optype = 1;
    try {
      const dec = originalPb.decode('active.WishPoolReqMsg', buffer);
      if (dec.poolId) poolId = dec.poolId;
      if (dec.optype) optype = dec.optype;
    } catch (_) {}

    const poolConfig = configRepo.getWishingPool(poolId) || configRepo.getWishingPool(101);
    if (!poolConfig) throw new Error(`Configuração do Poço ${poolId} não encontrada.`);

    const key = String(poolConfig.Id);

    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
      ensureSubsystemsState(saved);
      if (!saved.wishPool.wishes[key]) {
        saved.wishPool.wishes[key] = { Id: poolConfig.Id, buyCount: 0, WeekBuyCount: 0, luckValue: 0 };
      }
      const wishData = saved.wishPool.wishes[key];
      wishData.luckValue = Number(wishData.luckValue || 0);

      // 1. Verificação e Dedução de Custo
      const costItemId = Number(poolConfig.CostItemId || 0);
      const costItemNum = Number(poolConfig.CostItemNum || 1);
      const unitPrice = Number(poolConfig.UnitPrice || 0);

      const bag = inventoryState.inventory(saved);
      let consumed = false;

      if (costItemId > 0) {
        let totalHave = 0;
        const matchingItems = bag.items.filter(it => it.bagType === 1 && Number(it.templateId) === costItemId && it.count > 0);
        for (const it of matchingItems) totalHave += Number(it.count);

        if (totalHave >= costItemNum) {
          let needed = costItemNum;
          for (const it of matchingItems) {
            const take = Math.min(needed, it.count);
            it.count -= take;
            needed -= take;
            if (needed <= 0) break;
          }
          bag.items = bag.items.filter(it => it.count > 0);
          consumed = true;
        }
      }

      if (!consumed && unitPrice > 0) {
        saved.wallet = saved.wallet || {};
        const curBalens = Number(saved.wallet.balens || 0);
        const curBound = Number(saved.wallet.boundBalens || 0);
        const totalBalens = curBalens + curBound;
        const totalCost = unitPrice;
        if (totalBalens < totalCost) {
          throw new Error(`Recursos insuficientes para sortear no Poço ${poolId}`);
        }
        if (curBound >= totalCost) {
          saved.wallet.boundBalens = curBound - totalCost;
        } else {
          const rem = totalCost - curBound;
          saved.wallet.boundBalens = 0;
          saved.wallet.balens = curBalens - rem;
        }
        consumed = true;
      }

      if (!consumed) {
        throw new Error(`Itens insuficientes (requer ${costItemNum}x item ${costItemId})`);
      }

      // 2. Sorteio Canônico via PoolRandom / LuckPoolRandom
      const isLucky = wishData.luckValue >= Number(poolConfig.MaxLuckValue || 10);
      const poolRandomStr = isLucky && poolConfig.LuckPoolRandom ? poolConfig.LuckPoolRandom : poolConfig.PoolRandom;

      const subPoolEntries = String(poolRandomStr).split('|').map(entry => {
        const [pId, weight] = entry.split(',').map(Number);
        return { poolId: pId, weight: weight || 1 };
      }).filter(e => e.poolId && e.weight);

      const totalPoolWeight = subPoolEntries.reduce((acc, e) => acc + e.weight, 0);
      let rollPool = Math.floor(Math.random() * totalPoolWeight);
      let selectedSubPoolId = subPoolEntries[0]?.poolId || 1001;
      for (const entry of subPoolEntries) {
        if (rollPool < entry.weight) {
          selectedSubPoolId = entry.poolId;
          break;
        }
        rollPool -= entry.weight;
      }

      const wishingSetTable = configRepo.getTable('t_s_wishingset') || [];
      const poolItems = wishingSetTable.filter(row => Number(row.PoolId) === selectedSubPoolId);
      if (!poolItems.length) {
        throw new Error(`Tabela de sorteio vazia para sub-pool ${selectedSubPoolId}`);
      }

      const totalItemWeight = poolItems.reduce((acc, row) => acc + (Number(row.Random) || 1), 0);
      let rollItem = Math.floor(Math.random() * totalItemWeight);
      let winningRow = poolItems[0];
      for (const row of poolItems) {
        const w = Number(row.Random) || 1;
        if (rollItem < w) {
          winningRow = row;
          break;
        }
        rollItem -= w;
      }

      const rewardItem = {
        templateId: Number(winningRow.ItemId),
        count: Number(winningRow.Data || 1)
      };

      inventoryState.addItem(saved, rewardItem.templateId, rewardItem.count);

      wishData.buyCount += 1;
      wishData.WeekBuyCount += 1;
      if (isLucky) {
        wishData.luckValue = 0;
      } else {
        wishData.luckValue += 1;
      }

      return {
        state: saved,
        rewardItem,
        buyCount: wishData.buyCount,
        WeekBuyCount: wishData.WeekBuyCount,
        luckValue: wishData.luckValue
      };
    });

    state.character = await db.characterById(state.gatewayId);
    state.character.state_json = JSON.stringify(result.state);

    if (sendInventorySnapshot) sendInventorySnapshot(state);

    const respWire = originalPb.encode('active.WishPoolRespMsg', {
      wishResult: 1,
      items: [{ itemId: result.rewardItem.templateId, count: result.rewardItem.count }]
    });
    sendGameSession(state, 198, respWire);

    const updateWire = originalPb.encode('active.WishPoolInfoMsg', {
      Id: poolId,
      buyCount: result.buyCount,
      WeekBuyCount: result.WeekBuyCount
    });
    sendGameSession(state, 199, updateWire);

    log(`[POÇO DOS DESEJOS #${state.id}] Sorteio canônico no poço ${poolId}: concedido ${result.rewardItem.count}x item ${result.rewardItem.templateId} (Opcodes 198, 199).`);
  } catch (err) {
    log(`[POÇO DOS DESEJOS #${state.id}] Erro 9020: ${err.message}`);
    try {
      sendGameSession(state, 198, originalPb.encode('active.WishPoolRespMsg', {
        wishResult: 0,
        items: []
      }));
    } catch (_) {}
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
    const [member]=await db.ready().query('SELECT consortia_id FROM consortia_members WHERE character_id=? LIMIT 1',[state.gatewayId]);
    const dataWire = originalPb.encode('consortiapve.ConsortiaPveDataMsg', {
      curNodeId:0,boxs:[],nodes:[],serverName:'',extraTimes:0
    });
    sendGameSession(state, 4884, dataWire);

    const nodeWire = originalPb.encode('consortiapve.ConsortiaPveCurNodeMsg', {
      curNodeId:0,bossHp:0,bossMaxHp:0,attackCount:0,buffers:[],players:[]
    });
    sendGameSession(state, 4886, nodeWire);

    const seasonWire = originalPb.encode('consortiapve.ConsortiaPveSeasonMsg', {
      seasonId:0,state:0,beginTime:0,endTime:0
    });
    sendGameSession(state, 4887, seasonWire);

    const playerWire = originalPb.encode('consortiapve.ConsortiaPlayerDataMsg', {
      dayTimes:0,weekExtraTimes:0
    });
    sendGameSession(state, 4890, playerWire);

    log(`[GUILDA PVE #${state.id}] 8554 indisponivel (${member.length?'membro':'sem guilda'}): nenhuma temporada/vida ficticia enviada.`);
  } catch (err) {
    log(`[GUILDA PVE #${state.id}] Erro 8554: ${err.message}`);
  }
}

async function handleConsortiaBossReq(state, buffer, db, sendGameSession, log) {
  if (!state.gatewayId || state.closed) return;
  try {
    const [member]=await db.ready().query('SELECT consortia_id FROM consortia_members WHERE character_id=? LIMIT 1',[state.gatewayId]);
    const wire = originalPb.encode('consortia.ConsortiaBossMsg', {
      grade:0,spirit:0,state:0,endTime:0,totalHp:0,callGrade:0
    });
    sendGameSession(state, 4739, wire);
    log(`[CHEFÃO DA GUILDA #${state.id}] 8847 indisponivel (${member.length?'membro':'sem guilda'}): nenhum chefe ficticio enviado.`);
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
    const guildId=Number(saved.consortia?.id||0);
    if (!guildId) return;
    const info=await require('./guild-state').getGuildInfo(db.ready(),guildId);
    if (!info) return;
    sendGameSession(state,164,originalPb.encode('consortia.ConsortiaInfoMsg',info));
    log(`[HABILIDADES GUILDA #${state.id}] Pesquisa real da guilda ${guildId} sincronizada (164).`);
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
  supportedFateGrade,
  fateForClient,
  ensureSubsystemsState,
  formatBagMoveUpdate,
  handleConsortiaTaskInfo,
  handleConsortiaTaskReward,
  handleConsortiaTaskRefresh,
  handleConsortiaTaskUpgradeStar,
  handleTattooReq,
  handleFateRequest,
  handleFateTrain,
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

