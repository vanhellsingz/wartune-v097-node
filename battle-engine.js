'use strict';

const fs = require('fs');
const path = require('path');
const pb = require('./original-protobuf');
const heroState = require('./hero-state');
const resource = require('./resource-state');
const questState = require('./quest-state');
const campaignState = require('./campaign-state');
const db = require('./db');
const attributeCalculator = require('./attribute-calculator');
const skillsState = require('./skills-state');
const inventoryState = require('./inventory-state');
const sylphEquipment = require('./sylph-equipment-state');
const atollEncounters = require('./atoll-encounters');
const targetResolver = require('./wartune-battle-targets');
const remotePetState = require('./uiplay-state');
const runeBattleState = require('./rune-battle-state');
const hallExperience = require('./hall-experience-state');
const guardSystem = require('./guard-system-state');
const sylphAwakening = require('./sylph-awakening-state');

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

const rawCampaignData = loadCatalog('t_s_campaigndata');
const rawPawns = loadCatalog('t_s_pawntemplate');
const rawHeros = loadCatalog('t_s_herotemplate');
const rawSkills = loadCatalog('t_s_skilltemplate');
const rawPets = loadCatalog('t_s_pettemplate');
const rawKingTowerBoss = loadCatalog('t_s_kingtowerboss');
const rawSkillBuffers = loadCatalog('t_s_skillbuffertemplate');
const skillBufferById = new Map(rawSkillBuffers.map(row => [Number(row.Id), row]));

const petById = new Map();
for (const p of rawPets) {
  petById.set(Number(p.TemplateId), p);
}

const kingTowerBossByOrder = new Map();
for (const b of rawKingTowerBoss) {
  kingTowerBossByOrder.set(Number(b.OrderId), b);
}

const nodeById = new Map();
for (const n of rawCampaignData) {
  nodeById.set(Number(n.Id), n);
}

const pawnById = new Map();
for (const p of rawPawns) {
  pawnById.set(Number(p.TemplateId), p);
}

const heroById = new Map();
for (const h of rawHeros) {
  heroById.set(Number(h.TemplateId), h);
}

const skillById = new Map();
for (const s of rawSkills) {
  skillById.set(Number(s.TemplateId), s);
}

function calcGradeFromXp(totalXp, currentGrade = 1, state = {}) {
  return resource.calcGradeFromXp(totalXp,currentGrade,state);
}

function formatAttackMillis(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

class BattleEngine {
  constructor(serverContext) {
    this.server = serverContext;
    this.activeBattles = new Map(); // battleId -> battleState
  }

  schedule(state, battle, callback, delay) {
    const timer = setTimeout(() => {
      battle.timers.delete(timer);
      if (!state.closed && state.activeBattle === battle && battle.phase !== 'OVER') {
        try {
          const res = callback();
          if (res && typeof res.catch === 'function') {
            res.catch(err => {
              if (this.server && typeof this.server.log === 'function') {
                this.server.log(`[BATTLE ASYNC ERROR] ${err.message}`);
              }
            });
          }
        } catch (err) {
          if (this.server && typeof this.server.log === 'function') {
            this.server.log(`[BATTLE SCHEDULE ERROR] ${err.message}`);
          }
        }
      }
    }, delay);
    battle.timers.add(timer);
    return timer;
  }

  cancelBattle(state) {
    const battle = state.activeBattle;
    if (!battle) return;
    for (const timer of battle.timers || []) clearTimeout(timer);
    battle.timers?.clear();
    battle.phase = 'OVER';
    this.activeBattles.delete(battle.battleId);
    state.activeBattle = null;
  }

  initiateBattle(state, nodeId, options = {}) {
    if (state.closed) return;
    if (state.activeBattle) {
      if (state.activeBattle.turnTimer) clearTimeout(state.activeBattle.turnTimer);
      state.activeBattle = null;
    }
    const remotePhase = options.remotePetPhase || null;
    const outerMonster = options.outerMonster || null;
    const nodeOriginal = outerMonster ? {
      Id: Number(outerMonster.ID || nodeId),
      CampaignId: Number(state.character.map_id || 5),
      MasterType: 42,
      BattleType: 3841,
      // Monstros comuns da Cidade Externa trazem somente Soldiers. 6120 e
      // template de tropa, nunca de heroi; inventa-lo em Heros aborta a luta.
      Heros: outerMonster.Heroes || '',
      Soldiers: outerMonster.Soldiers || '',
      HeroGP: 0,
      AI: 'com.road.yishi.mapphysics.node.ai.CNCommonAi'
    } : (remotePhase ? {
      Id: -Number(remotePhase.IndexID), CampaignId: Number(state.character.map_id || 5),
      MasterType: 42, BattleType: 0, Heros: remotePhase.Heros,
      Soldiers: remotePhase.Soldiers, HeroGP: 0
    } : nodeById.get(Number(nodeId)));
    const node = (remotePhase || outerMonster) ? nodeOriginal : atollEncounters.normalizedMonster(nodeOriginal);
    if (!node) {
      throw new Error(`No de campanha/tutorial ${nodeId} nao encontrado`);
    }
    const isAtollBattle=atollEncounters.hostile(node);
    const isKingTowerBoss = (node.AI === 'com.road.yishi.mapphysics.node.ai.CNKingTowerBossAi' || (Number(node.CampaignId) === 8200 && Number(nodeId) >= 820002 && Number(nodeId) <= 820006));
    if (![41,42].includes(Number(node.MasterType)) && !isAtollBattle && !isKingTowerBoss && !outerMonster) throw new Error(`No ${nodeId} nao e encontro de combate`);

    const character = state.character;
    const saved = typeof character.state_json === 'string' ? JSON.parse(character.state_json) : (character.state_json || {});
    const mapId = Number(node.CampaignId);
    const isTutorial = mapId === 10001 || mapId === 10002;
    if (remotePhase) {
      // RemotePet is launched from a menu, independent of the map instance.
    } else if (isTutorial) {
      if (Number(saved.tutorial?.mapId) !== mapId && Number(saved.position?.mapId) !== mapId && Number(saved.campaigns?.current?.mapId) !== mapId) {
        throw new Error('No fora do mapa tutorial atual');
      }
    } else if (!outerMonster && Number(saved.campaigns?.current?.mapId) !== mapId && Number(saved.position?.mapId) !== mapId) {
      throw new Error('No fora da instancia de campanha atual');
    }
    if(isAtollBattle && !atollEncounters.canFight(saved,node))
      throw new Error('Atol: monstro fora do mapa ou ainda em ressurgimento');

    const battleId = `b_${character.id}_${Date.now()}`;
    const heroLivingId = 11;
    const monsterLivingId = 21;

    // Catalog stores ordinary enemies in Soldiers and bosses in Heros.
    const soldierEntries=String(node.Soldiers||'').split('|').filter(e=>Boolean(e)&&e!=='0'&&e!=='0,0');
    const heroEntries=String(node.Heros||'').split('|').filter(e=>Boolean(e)&&e!=='0'&&e!=='0,0');
    const heroMonsters=[];

    // Batalhas especiais de Torre dos Reis / Torre da Confusão (Campanha 8200)
    if (node.AI === 'com.road.yishi.mapphysics.node.ai.CNKingTowerBossAi' || mapId === 8200 || (node.Id >= 820002 && node.Id <= 820006)) {
      const order = Number(node.Param2 || (node.Id % 820000) || 1);
      const boss = kingTowerBossByOrder.get(order) || rawKingTowerBoss[0];
      if (boss) {
        const bossHp = Math.max(1000, Number(boss.Live) || 120000);
        const skills = String(boss.SuiteSkill || '1092,1094').split('|').map(Number).filter(Boolean);
        const avParts = String(boss.Avata || '').split('|');
        heroMonsters.push({
          livingId: 21,
          kind: 'hero',
          tempId: Number(boss.Id || 682),
          pos: 2,
          side: 2,
          maxHp: bossHp,
          hp: bossHp,
          skillId: skills[0] || 1092,
          attack: Math.max(100, Number(boss.TotalPhyAttack) || 25000),
          magicAttack: Math.max(100, Number(boss.TotalMagicAttack) || 25000),
          defence: Math.max(100, Number(boss.TotalPhyDefence) || 20000),
          magicDefence: Math.max(100, Number(boss.TotalMagicDefence) || 20000),
          nickName: String(boss.NickName_pt || boss.NickName_en || 'Alma do Rei das Sombras'),
          grade: Number(boss.Grades || 70),
          job: Number(boss.Job || 1),
          slotAvata: avParts[0] || '',
          hairPath: avParts[1] || '',
          clothAvate: avParts[2] || '',
          wingAvata: avParts[11] || ''
        });
      }
    }

    if(!soldierEntries.length&&!heroEntries.length&&!heroMonsters.length) {
      // Fallback para nós especiais/invocadores sem monstros explícitos no nó (Huntera 2001)
      soldierEntries.push('2001,1');
    }
    const pawnMonsters = soldierEntries.map((entry, idx) => {
      const parts = entry.split(',');
      const tempId = Number(parts[0]);
      const pos = Number(parts[1]) || (idx + 1);
      const monsterPawn = pawnById.get(tempId);
      if(!monsterPawn)throw Error(`Soldado ${tempId} ausente do catalogo`);
      const monsterHp = (monsterPawn.Live || 10) * (monsterPawn.LiveCoefficient ? (monsterPawn.LiveCoefficient / 100) : 1);
      const monsterMaxHp = Math.max(100, Math.floor(monsterHp));
      const monsterSkill = monsterPawn.DefaultSkill || 40081;
      return {
        livingId: 21 + idx,
        kind:'pawn',
        tempId,
        pos,
        side: 2,
        maxHp: monsterMaxHp,
        hp: monsterMaxHp,
        skillId: monsterSkill,
        attack: monsterPawn.Attack || 15
      };
    });
    for(let idx = 0; idx < heroEntries.length; idx++){
      const entry = heroEntries[idx];
      const [template,slot]=entry.split(','),tempId=Number(template),position=Number(slot);
      const row=heroById.get(tempId);
      if(!row)throw Error(`Heroi inimigo ${tempId} ausente do catalogo`);
      const maxHp=Math.max(1,Number(row.Live)||1);
      heroMonsters.push({livingId:21+pawnMonsters.length+idx,kind:'hero',tempId,
        pos:position||idx+1,side:2,maxHp,hp:maxHp,
        skillId:Number(row.DefaultSkill)||0,attack:Math.max(1,Number(row.Attack)||1)});
    }
    const monsters=[...pawnMonsters,...heroMonsters];

    // Extrair dados do herói e calcular atributos autênticos
    const heroJob = Number(saved.job || character.job || 1);
    const heroTempId = saved.hero?.templateId || character.icon || (heroJob === 1 ? (character.sex === 0 ? 4 : 1) : heroJob);
    const defaultJobSkill = heroJob === 1 ? 10000 : (heroJob === 2 ? 20000 : 30000);
    const heroTemp = heroById.get(heroTempId) || heroById.get(heroJob) || { Live: 90, DefaultSkill: defaultJobSkill, SkillScript: [10711, 10811] };
    const heroBattleStats = attributeCalculator.getEffectiveBattleStats(character);
    const heroHp = heroBattleStats.maxHp;
    const heroApp = heroState.appearance(character);
    const heroSkillsState = skillsState.getSkillsState(saved, heroJob);
    const learnedSkills = Array.isArray(heroSkillsState.learned) ? heroSkillsState.learned : [];
    const baseSkills = [heroTemp.DefaultSkill || defaultJobSkill].concat(heroTemp.SkillScript || []);
    const runeItems = runeBattleState.equippedRuneItems(saved, character.grade);
    const heroSkills = [...new Set([...baseSkills, ...learnedSkills])].map(Number);

    // Determina formação oficial (Frente vs Trás)
    // No servidor oficial (conforme prints oficiais anexados):
    // Formação Padrão (Herói na Frente):
    // - Herói fica na linha central, coluna da frente (pos: 4)
    // - Tropa do Slot 0 fica na linha superior, coluna de trás (pos: 3)
    // - Tropa do Slot 1 fica na linha inferior, coluna de trás (pos: 9)
    // Formação Invertida (Tropas na Frente, Herói Atrás - fightPos === 3):
    // - Herói fica na linha central, coluna de trás (pos: 6)
    // - Tropa do Slot 0 fica na linha superior, coluna da frente (pos: 1)
    // - Tropa do Slot 1 fica na linha inferior, coluna da frente (pos: 7)
    const heroFightPos = Number(saved.hero?.fightPos || 2);
    const heroIsBack = heroFightPos === 3;
    const heroBattlePos = heroIsBack ? 6 : 4;

    // Tropas da formação do herói (sites 0 e 1 - 2 unidades de tropa)
    const playerSoldiers = [];
    const formation = saved.army?.formation || {};
    const primarySonType = formation[0] || Object.values(saved.army?.pawns || {}).find(item => Number(item.ownPawns || 0) > 0)?.sonType || 101;
    const campaignId = Number(campaignState.MAP_TO_CAMPAIGN[mapId] || mapId);
    const isHeroesHall = Number(campaignState.campaignById.get(campaignId)?.Capacity) === 3;
    const hasPlayerTroops = Boolean(outerMonster || (!remotePhase &&
      !campaignState.towerFloor(mapId) && !isHeroesHall));
    for (const slot of (hasPlayerTroops ? [0, 1] : [])) {
      let sonType = formation[slot] !== undefined ? formation[slot] : primarySonType;
      let p = sonType ? saved.army?.pawns?.[sonType] : null;
      if (!p || Number(p.ownPawns || 0) <= 0) {
        p = Object.values(saved.army?.pawns || {}).find(item => Number(item.ownPawns || 0) > 0);
      }
      if (p && Number(p.ownPawns || 0) > 0) {
        const pTpl = pawnById.get(Number(p.templateId || p.tempateId));
        if (pTpl) {
          const pMaxHp = Math.max(100, (pTpl.Live || 10) * 10);
          const sPos = heroIsBack ? (slot === 0 ? 1 : 7) : (slot === 0 ? 3 : 9);
          playerSoldiers.push({
            livingId: 1 + slot,
            armyPawnId: slot + 1,
            tempId: Number(p.templateId || p.tempateId),
            type: 1,
            side: 1,
            pos: sPos,
            grade: Number(pTpl.Level || 1),
            maxHp: pMaxHp,
            hp: pMaxHp,
            initHp: pMaxHp,
            castTime: 3000,
            qteTime: 0,
            skillId: [Number(pTpl.DefaultSkill || 40081)],
            phyAttack: Number(pTpl.Attack || 20),
            magAttack: Number(pTpl.Attack || 20),
            phyDefence: Number(pTpl.Defence || 10),
            magDefence: Number(pTpl.MagicDefence || 10),
            parry: 10,
            forceHit: 64,
            attackWound: 0,
            hitWound: 0,
            sites: slot,
            hasLivingId: true,
            hasTempId: true,
            hasType: true,
            hasSide: true,
            hasPos: true,
            hasHp: true,
            hasInitHp: true,
            hasCastTime: true,
            hasQteTime: true
          });
        }
      }
    }

    const battleState = {
      battleId,
      nodeId: Number(nodeId),
      outerMonster: outerMonster || null,
      outerRewards: outerMonster ? (options.outerRewards || []) : [],
      remotePetIndex: remotePhase ? Number(remotePhase.IndexID) : 0,
      mapId,
      stateSessionId: state.id,
      characterId: character.id,
      accountId: character.account_id,
      turn: 0,
      timers: new Set(),
      phase: 'PREPARE', // PREPARE -> START -> FIGHT -> OVER
      hero: {
        livingId: heroLivingId,
        heroId: character.id,
        userId: character.id,
        nickName: character.nickname,
        grade: character.grade,
        job: heroJob,
        tempId: heroTempId,
        maxHp: heroHp,
        hp: heroHp,
        sp: 15, // Alinhado com prints oficiais do Wartune (15/100 na entrada de combate)
        spMax: 100,
        shield: 0,
        pos: heroBattlePos,
        side: 1,
        skills: heroSkills,
        attack: heroBattleStats.attack,
        phyAttack: heroBattleStats.phyAttack || heroBattleStats.attack,
        magicAttack: heroBattleStats.magicAttack || heroBattleStats.attack,
        defence: heroBattleStats.phyDefence,
        magicDefence: heroBattleStats.magicDefence,
        forceHit: heroBattleStats.forceHit,
        parry: heroBattleStats.parry,
        fightingCapacity: heroBattleStats.fightingCapacity
      },
      playerSoldiers,
      runeItems: runeItems.map(item => ({...item})),
      monsters,
      monster: monsters[0], // compatibilidade retroativa
      rewards: {
        xp: isAtollBattle ? (Number(node.HeroGP)||0)
          : (hallExperience.hallNodeExperience(node, mapId, campaignState) ?? (Number(node.HeroGP) || 2500)),
        gold: isAtollBattle ? 0 : (outerMonster ? 0 : 100)
      }
    };

    this.activeBattles.set(battleId, battleState);
    state.activeBattle = battleState;
    this.schedule(state,battleState,()=>{
      if(battleState.phase==='PREPARE'){
        this.server.log(`[BATTLE #${state.id}] Timeout de preparo; batalha ${battleId} cancelada sem recompensa.`);
        this.cancelBattle(state);
      }
    },20000);

    // Extrai o Silfo ativo para combate (se houver)
    const availableSylphs = (saved.sylphs?.list || []).filter(p => p && !p.isDel);
    const remoteFormationId = remotePhase ? Number(String(saved.remotePet?.pets || '').split('|')[0]?.split(',')[1] || 0) : 0;
    const baseSylph = availableSylphs.find(p => Number(p.petId) === remoteFormationId) ||
      availableSylphs.find(p => p.isFight || Number(p.petId) === Number(saved.sylphs?.activePetId)) ||
      (remotePhase ? availableSylphs[0] : null);
    const gear = baseSylph ? sylphEquipment.equipmentStats(saved.inventory?.items || [],baseSylph.petId) : null;
    const activeSylph = baseSylph && {
      ...baseSylph,
      power:Number(baseSylph.power||0)+gear.power,
      intel:Number(baseSylph.intel||0)+gear.intel,
      bagAttack:gear.bagAttack,bagMagicattack:gear.bagMagicattack,
      bagLiving:gear.bagLiving
    };
    const battlePets = [];
    let heroAwake = 0;
    let heroChangeSkills = [];
    let heroLivingId2 = 0;

    if (activeSylph) {
      const sylphLivingId = 15;
      heroLivingId2 = sylphLivingId;
      heroAwake = sylphAwakening.startingAwake(saved);
      const petTpl = petById.get(Number(activeSylph.templateId));
      const defaultAttackSkill = (petTpl && Array.isArray(petTpl.DefaultSkills) && petTpl.DefaultSkills[0]) || 701000;
      const rawChange = String(activeSylph.changeSkills || '').split(',').map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
      heroChangeSkills = rawChange.length > 0 ? rawChange : ((petTpl && petTpl.ChangeSkills) || [704001, 708101, 706101]);
      const petQuality = Number(petTpl ? petTpl.Quality : (activeSylph.quality || 5));
      const petHp = Number(activeSylph.hp || activeSylph.maxHp || 1200)+activeSylph.bagLiving;
      const sylphBattlePos = heroBattlePos <= 3 ? (heroBattlePos + 3) : (heroBattlePos > 6 ? (heroBattlePos - 3) : (heroBattlePos + 1));

      battlePets.push({
        livingId: sylphLivingId,
        livingId2: heroLivingId,
        heroId: Number(activeSylph.petId),
        userId: Number(character.id),
        userPics: Number(activeSylph.templateId),
        tempId: Number(activeSylph.templateId),
        headId: Number(activeSylph.templateId),
        petQuality: petQuality,
        type: 5,
        nickName: String(activeSylph.petName || petTpl?.TemplateName_pt || 'Silfo'),
        multiLanNickName: [],
        grade: Number(activeSylph.curGrade || 1),
        side: 1,
        pos: sylphBattlePos,
        maxHp: petHp,
        hp: petHp,
        initHp2: 0,
        hp2: 0,
        sp: 100,
        spMax: 100,
        slotAvata: '',
        clothAvate: '',
        cloakPath: '',
        hairPath: '',
        wingAvata: '',
        fashionClothAvata: '',
        fashionArmAvata: '',
        fateSkillTempIds: '',
        pawnTempId: 0,
        res: '',
        isShow: true,
        hasShadow: true,
        qteTime: 0,
        castTime: 3000,
        skillId: [defaultAttackSkill],
        changeSkillId: heroChangeSkills,
        serverName: character.site || 'S1',
        isChange: false,
        awake: heroAwake
      });
    }

    battleState.activeSylph = activeSylph;
    battleState.battlePets = battlePets;
    battleState.hero.awake = heroAwake;
    battleState.hero.morphed = false;
    battleState.hero.normalSkills = heroSkills;
    battleState.hero.changeSkills = heroChangeSkills;

    const battleGuards = (saved.guardians?.list || []).filter(guard => guard && guard.isFight)
      .slice(0, 3).map((guard, index) => {
        const attributes = guardSystem.calculateGuardAttributes(guard, {...saved, grade: character.grade});
        const value = id => Math.max(0, Number(attributes.get(id) || 0));
        const skills = String(guard.firstKey || guard.skills || '').split(',')
          .map(Number).filter(id => Number.isSafeInteger(id) && id > 0 && skillById.has(id));
        const maxHp = Math.max(1, value(10));
        return {
          heroId: Number(guard.guardId), livingId: 16 + index,
          userId: Number(character.id), tempId: Number(guard.guardId),
          growthGrade: Math.max(0, Math.min(4, Number(guard.guardStage) || 0)),
          type: 1, nickName: String(guard.guardName || ''),
          grade: Number(character.grade), side: 1, pos: [2, 5, 8][index],
          maxHp, hp: maxHp, initHp: maxHp,
          sp: 100, spMax: 100, awake: heroAwake, upaniValue: 100,
          phyAttack: value(6), phyDefence: value(7),
          magAttack: value(8), magDefence: value(9),
          forceHit: value(12), parry: value(13),
          skillId: skills, castTime: 3000, qteTime: 0,
          isShow: true, hasShadow: true, serverName: character.site || 'S1'
        };
      });
    battleState.battleGuards = battleGuards;

    // Monta protobuf battle.BattlePrepareMsg
    const prepareMsg = {
      battleId,
      battleType: node.BattleType || 0,
      mapTempId: mapId,
      needAnimation: true,
      side: 1,
      hasAssault: false,
      useWay: 0,
      attackModel: 0,
      reinforceCount: 0,
      currentReinforce: 0,
      battleCapity: 1,
      countDown: 30,
      damageImprove: 0,
      heros: [
        {
          livingId: heroLivingId,
          livingId2: heroLivingId2,
          heroId: character.id,
          userId: character.id,
          userPics: character.icon || heroTempId,
          tempId: heroTempId,
          type: 1,
          nickName: character.nickname,
          grade: character.grade,
          side: 1,
          pos: heroBattlePos,
          maxHp: heroHp,
          hp: heroHp,
          initHp2: 0,
          hp2: 0,
          sp: 100,
          spMax: 100,
          slotAvata: heroApp.arm || '',
          clothAvate: heroApp.cloth || '',
          cloakPath: heroApp.cloak || '',
          hairPath: heroApp.hat || '',
          wingAvata: heroApp.wing || '',
          fashionClothAvata: heroApp.fashionCloth || '',
          fashionArmAvata: heroApp.fashionArm || '',
          fateSkillTempIds: '',
          pawnTempId: 0,
          res: '',
          isShow: false,
          hasShadow: false,
          qteTime: 0,
          castTime: 3000,
          skillId: heroSkills,
          item: runeItems.map(item => ({
            ...item, userId: character.id, battleId,
            serverName: character.site || 'S1', uItemId: 0
          })),
          changeSkillId: heroChangeSkills,
          serverName: character.site || 'S1',
          multiLanNickName: [],
          isChange: false,
          awake: heroAwake
        },
        ...heroMonsters.map(m=>({livingId:m.livingId,heroId:0,userId:0,tempId:m.tempId,
          type:3,nickName:heroById.get(m.tempId)?.TemplateName_pt||heroById.get(m.tempId)?.TemplateName_en||m.nickName||'',grade:Number(node.Level)||m.grade||1,
          side:2,pos:m.pos,maxHp:m.maxHp,hp:m.hp,sp:0,spMax:100,skillId:[m.skillId],
          slotAvata:m.slotAvata||'',clothAvate:m.clothAvate||'',hairPath:m.hairPath||'',wingAvata:m.wingAvata||'',
          res:heroById.get(m.tempId)?.ResPath||'',isShow:false,hasShadow:true,
          multiLanNickName: [],
          serverName:'',castTime:3000,qteTime:0}))
      ],
      soldiers: [
        ...playerSoldiers,
        ...pawnMonsters.map(m => ({
          livingId: m.livingId,
          armyPawnId: 0,
          tempId: m.tempId,
          type: 1,
          side: 2,
          pos: m.pos,
          grade: 1,
          maxHp: m.maxHp,
          hp: m.hp,
          initHp: m.maxHp,
          castTime: 3000,
          qteTime: 0,
          skillId: [m.skillId],
          phyAttack: m.attack,
          magAttack: m.attack,
          phyDefence: 0,
          magDefence: 0,
          parry: 0,
          forceHit: 64,
          attackWound: 0,
          hitWound: 0,
          sites: 0,
          hasLivingId: true,
          hasTempId: true,
          hasType: true,
          hasSide: true,
          hasPos: true,
          hasHp: true,
          hasInitHp: true,
          hasCastTime: true,
          hasQteTime: true
        }))
      ],
      soldierTemplated: [...new Set([...playerSoldiers.map(p => p.tempId), ...pawnMonsters.map(m => m.tempId)])],
      coolDown: [],
      currentWave: 1,
      pets: battlePets,
      watchHeros: [],
      guards: battleGuards,
      redTeamName: 'Jogador',
      blueTeamName: 'Inimigo',
      curTurn: 0
    };

    try {
      const encoded = pb.encode('battle.BattlePrepareMsg', prepareMsg);
      this.server.sendGameSession(state, 157, encoded);
    } catch (error) {
      this.cancelBattle(state);
      throw error;
    }
    this.server.log(`[BATTLE #${state.id}] Batalha iniciada (${battleId}) no no ${nodeId}. Pacote 157 (U_B_PREPARE) enviado.`);

    return battleState;
  }

  handleLoadOver(state, payload) {
    let req;
    try {
      req = pb.decode('battle.LoadOverMsg', payload);
    } catch (e) {
      this.server.log(`[BATTLE #${state.id}] LoadOver malformado: ${e.message}`);
      return;
    }

    const battle = state.activeBattle;
    if (!battle || battle.phase !== 'PREPARE' || (req.battleId && req.battleId !== battle.battleId)) {
      this.server.log(`[BATTLE #${state.id}] LoadOver recebido mas batalha nao encontrada.`);
      return;
    }

    battle.phase = 'START';

    // 1. Enviar S2C 154 (U_B_PREPARE_OVER)
    this.server.sendGameSession(state, 154, Buffer.alloc(0));

    // 2. Enviar S2C 156 (U_B_START)
    const startMsg = {
      frame: 1,
      mainType: 0,
      countDown: 30
    };
    const encodedStart = pb.encode('battle.BattleStartMsg', startMsg);
    this.server.sendGameSession(state, 156, encodedStart);
    this.server.log(`[BATTLE #${state.id}] LoadOver confirmado. Pacotes 154 (PREPARE_OVER) e 156 (START) enviados.`);

    // Iniciar automaticamente o primeiro turno de combate se o jogador nao usar manualmente
    // Concede tempo confortável para a cena carregar e renderizar os heróis na tela
    battle.waitingHeroAction = true;
    battle.turnTimer = this.schedule(state, battle, () => {
      if (battle.waitingHeroAction) {
        this.executeTurn(state, battle);
      }
    }, 2800);
  }

  handleHeroOrder(state, payload) {
    let req;
    try {
      req = pb.decode('battle.UseSkillMsg', payload);
    } catch (e) {
      this.server.log(`[BATTLE #${state.id}] Comando de skill malformado: ${e.message}`);
      return;
    }

    const battle = state.activeBattle;
    if (!battle || !battle.waitingHeroAction) return;

    if (battle.turnTimer) clearTimeout(battle.turnTimer);
    this.server.log(`[BATTLE #${state.id}] Comando de skill recebido do jogador: ${req.skillId}.`);

    // S2C Opcode 75 (battle.HeroOrderMsg) ACK com result: 0 e targetIndexs
    // Obrigatório para o cliente destravar a seleção da skill (onSkillUseServerBack) e iniciar a animação
    const hero = battle.hero;
    const requestedId = Number(req.skillId);
    if (requestedId === 700001 || requestedId === 700002) {
      const canChange = requestedId === 700001
        ? Boolean(battle.activeSylph && !hero.morphed && hero.awake >= 3000)
        : Boolean(battle.activeSylph && hero.morphed);
      this.server.sendGameSession(state, 75, pb.encode('battle.HeroOrderMsg', {
        battleId: battle.battleId, heroIndexId: hero.livingId,
        skillId: requestedId, result: canChange ? 0 : 1,
        castTime: 0, qteTime: 0, targetIndexs: []
      }));
      if (!canChange) return;
      battle.waitingHeroAction = false;
      battle.turn++;
      hero.morphed = requestedId === 700001;
      if (hero.morphed) battle.awakeningUsed = true;
      hero.skills = hero.morphed ? hero.changeSkills : hero.normalSkills;
      hero.awake = hero.morphed ? 3000 : 0;
      battle.attackSeq = (battle.attackSeq || 0) + 1;
      this.server.sendGameSession(state, 153, pb.encode('battle.AttackOrderMsg', {
        battleId: battle.battleId, frame: battle.attackSeq,
        orderId: requestedId, isPassive: false, livingId: hero.livingId,
        sp: hero.sp, spAdded: 0, damages: [], awakenSoldiers: [],
        attackOrderSeq: battle.attackSeq, curTurn: battle.turn,
        awake: hero.awake, awakeAdd: 0
      }));
      this.server.sendGameSession(state, 4600, pb.encode('battle.AwakeMsg', {
        awake: [{ livingId: hero.livingId, awake: hero.awake }]
      }));
      battle.waitingHeroAction = true;
      battle.turnTimer = this.schedule(state, battle, () => {
        if (battle.waitingHeroAction) this.executeTurn(state, battle);
      }, 2800);
      return;
    }
    // ACK uses the SAME target plan that the damage resolver will execute.
    // Validate the requested skill and rage before choosing hit targets.
    // Passive Sylph skills are equipped effects, never player-cast attacks.
    if (hero.skills.includes(requestedId) && Number(skillById.get(requestedId)?.UseWay) === 2) {
      this.server.sendGameSession(state,75,pb.encode('battle.HeroOrderMsg',{
        battleId:battle.battleId,heroIndexId:hero.livingId,skillId:requestedId,
        result:1,castTime:0,qteTime:0,targetIndexs:[]
      }));
      battle.turnTimer=this.schedule(state,battle,()=>{
        if(battle.waitingHeroAction)this.executeTurn(state,battle);
      },2800);
      return;
    }
    const validId=hero.skills.includes(requestedId) && Number(skillById.get(requestedId)?.UseWay) === 1 ? requestedId : null;
    const requestedTpl=validId===null?null:skillById.get(validId);
    const unaffordable=requestedTpl && Number(requestedTpl.Cost)<0 && hero.sp<Math.abs(Number(requestedTpl.Cost));
    const chosenSkill=validId!==null&&!unaffordable?validId:(hero.skills.find(id=>Number(skillById.get(id)?.UseWay)===1 && Number(skillById.get(id)?.Cost)>0)||hero.skills.find(id=>Number(skillById.get(id)?.UseWay)===1)||hero.normalSkills?.[0]);
    const chosenTemplate=skillById.get(chosenSkill);
    const targets=targetResolver.choose(chosenTemplate,battle.monsters);
    battle.pendingHeroTargets={skillId:chosenSkill,targets};
    this.server.sendGameSession(state, 75, pb.encode('battle.HeroOrderMsg', {
      battleId: battle.battleId,
      heroIndexId: hero.livingId,
      skillId: chosenSkill,
      result: 0,
      castTime: 0,
      qteTime: 0,
      targetIndexs: targets.map(t => t.livingId)
    }));

    this.executeTurn(state, battle, chosenSkill);
  }

  handleBattleRuneItem(state, payload) {
    let req;
    try { req = pb.decode('battle.BattleItemMsg', payload); }
    catch (error) { this.server.log(`[BATTLE RUNE #${state.id}] Pacote invalido: ${error.message}`); return; }
    const battle = state.activeBattle;
    const item = battle?.runeItems?.find(entry => entry.skillTempId === Number(req.skillTempId));
    const valid = Boolean(battle && !state.closed && battle.waitingHeroAction &&
      ['START', 'FIGHT'].includes(battle.phase) &&
      (!req.battleId || req.battleId === battle.battleId) && item && item.count > 0);
    if (!valid) {
      this.server.sendGameSession(state, 158, pb.encode('battle.ItemUseResultMsg', {
        result: 1, tempId: Number(req.skillTempId || 0), count: item?.count || 0,
        livingId: battle?.hero?.livingId || 0
      }));
      return;
    }
    if (battle.turnTimer) clearTimeout(battle.turnTimer);
    battle.waitingHeroAction = false;
    battle.phase = 'FIGHT';
    battle.turn++;
    item.count--;
    const hero = battle.hero;
    const skill = skillById.get(item.skillTempId);
    const oldSp = hero.sp;
    hero.sp = Math.min(100, hero.sp + Math.max(0, Number(skill?.Cost) || 0));
    const buffers = String(skill?.BufferIds || '').split('|').map(Number).filter(Boolean)
      .flatMap(id => {
        const template = skillBufferById.get(id);
        if (!template) return [];
        hero.runeBuffs ||= new Map();
        hero.runeBuffs.set(id, { template, remaining: Math.max(1, Number(template.ValidCount) || 1) });
        return [{bufferId: id, templateId: id, sourceId: hero.livingId,
          targetId: hero.livingId, curTurn: battle.turn, execFrame: 0,
          maxTurn: Math.max(1, Number(template.ValidCount) || 1), seeType: 1, exeWay: 1}];
      });
    this.server.sendGameSession(state, 158, pb.encode('battle.ItemUseResultMsg', {
      uItemId: 0, bagPos: item.bagPos, count: item.count,
      result: 0, livingId: hero.livingId, tempId: item.tempId, type: 0
    }));
    battle.attackSeq = (battle.attackSeq || 0) + 1;
    this.server.sendGameSession(state, 153, pb.encode('battle.AttackOrderMsg', {
      battleId: battle.battleId, frame: battle.attackSeq, orderId: item.skillTempId,
      isPassive: false, livingId: hero.livingId, sp: hero.sp,
      spAdded: hero.sp - oldSp, damages: [], buffers,
      awakenSoldiers: [], attackOrderSeq: battle.attackSeq, curTurn: battle.turn
    }));
    battle.waitingHeroAction = true;
    battle.turnTimer = this.schedule(state, battle, () => {
      if (battle.waitingHeroAction) this.executeTurn(state, battle);
    }, 2800);
  }

  executeTurn(state, battle, requestedSkillId = null) {
    if (state.closed || state.activeBattle !== battle || !['START','FIGHT'].includes(battle.phase)) return;
    battle.phase = 'FIGHT';
    battle.waitingHeroAction = false;
    if (battle.turnTimer) clearTimeout(battle.turnTimer);
    battle.turn++;
    const hero = battle.hero;
    const target = battle.monsters.find(monster => monster.hp > 0);
    if (!target) return this.finishBattleVictory(state, battle);
    const previousAwake = Number(hero.awake || 0);
    if (battle.activeSylph && !hero.morphed) hero.awake = sylphAwakening.gainAwake(previousAwake);
    else if (battle.activeSylph && hero.morphed) hero.awake = Math.max(0, previousAwake - 100);
    const awakeAdd = Number(hero.awake || 0) - previousAwake;

    // 1. Resolver template da habilidade e custo de fúria (Rage)
    let skillId = hero.skills.includes(Number(requestedSkillId)) ? Number(requestedSkillId) : (hero.skills[1] || hero.skills[0] || 10000);
    let skillTpl = skillById.get(skillId);
    
    // Se for habilidade consumidora de fúria (Cost < 0) e o herói não tiver fúria suficiente, usa gerador básico
    const cost = skillTpl ? Number(skillTpl.Cost || 0) : 10;
    if (cost < 0 && hero.sp < Math.abs(cost)) {
      const genSkill = hero.skills.find(s => {
        const t = skillById.get(s);
        return t && Number(t.Cost) > 0;
      }) || hero.skills[0] || 10000;
      skillId = genSkill;
      skillTpl = skillById.get(skillId);
    }

    const actualCost = skillTpl ? Number(skillTpl.Cost || 0) : 10;
    let spAdded = 0;
    if (actualCost > 0) {
      spAdded = actualCost;
      hero.sp = Math.min(100, hero.sp + actualCost);
    } else if (actualCost < 0) {
      spAdded = actualCost;
      hero.sp = Math.max(0, hero.sp - Math.abs(actualCost));
    } else {
      spAdded = 5;
      hero.sp = Math.min(100, hero.sp + 5);
    }

    const p1 = skillTpl ? Number(skillTpl.Parameter1 || 0) : 104;
    const p2 = skillTpl ? Number(skillTpl.Parameter2 || 0) : 15;
    const isMagic = hero.job === 3;
    const effectiveAtk = isMagic ? (hero.magicAttack || hero.attack) : (hero.phyAttack || hero.attack);

    const damages = [];

    // 2. Executar ação da habilidade (Dano, Cura ou Escudo)
    if (p1 < 0) {
      // Habilidade de Cura (ex: Restauração 31211, Luz Abençoada 31411)
      const healAmount = Math.max(1, Math.floor(effectiveAtk * (Math.abs(p1) / 100) + p2));
      hero.hp = Math.min(hero.maxHp, hero.hp + healAmount);
      damages.push({
        livingId: hero.livingId,
        damageType: 6, // Tipo Cura
        isHarmful: false,
        damageValue: healAmount,
        leftValue: hero.hp,
        extraData: 0,
        parry: 0,
        order: 1
      });
      this.server.log(`[BATTLE #${state.id}] Turno ${battle.turn}: heroi cura a si mesmo em ${healAmount} PV com ${skillTpl?.TemplateName_pt || skillId} (HP: ${hero.hp}/${hero.maxHp}).`);
    } else if (p1 === 0 && p2 === 0 && [113, 114, 319].includes(skillTpl?.SonType)) {
      // Habilidade de Escudo (ex: Escudo Agoran 113, Escudo de Apolo 114, Escudo Mágico 319)
      const shieldVal = Math.floor(hero.maxHp * 0.20);
      hero.shield = (hero.shield || 0) + shieldVal;
      damages.push({
        livingId: hero.livingId,
        damageType: 1,
        isHarmful: false,
        damageValue: shieldVal,
        leftValue: hero.hp,
        extraData: 0,
        parry: 0,
        order: 1
      });
      this.server.log(`[BATTLE #${state.id}] Turno ${battle.turn}: heroi ativa escudo de ${shieldVal} PV com ${skillTpl?.TemplateName_pt || skillId}.`);
    } else {
      // Habilidade de Ataque Físico/Mágico (Single ou AoE)
      // AcceptObject=2 (Tiro Multiplo) means TWO hits, not two unique targets.
      // With one enemy the same livingId occurs twice in damages.
      const plan=battle.pendingHeroTargets;
      const targets=plan && plan.skillId===skillId
        ? plan.targets : targetResolver.choose(skillTpl,battle.monsters);

      for (let i = 0; i < targets.length; i++) {
        const tgt = targets[i];
        const tgtDef = isMagic ? (tgt.magDefence || 0) : (tgt.phyDefence || tgt.defence || 0);
        const rawDmg = Math.floor(effectiveAtk * (p1 > 0 ? (p1 / 100) : 1.1) + p2);
        const netDmg = Math.max(1, rawDmg - Math.floor(tgtDef * 0.3));
        const outgoing = [...(hero.runeBuffs?.values() || [])]
          .filter(buff => Number(buff.template.AttackType) === 20 && buff.remaining > 0)
          .reduce((factor, buff) => factor * (1 + Number(buff.template.ValuePercent || 0) / 100), 1);
        const finalDamage = Math.min(tgt.hp, Math.max(1, Math.floor(netDmg * outgoing)));
        tgt.hp -= finalDamage;

        damages.push({
          livingId: tgt.livingId,
          damageType: 6, // CC.BLOOD_TYPE_SELF (essencial para exibir número de dano JE e animar barra de HP)
          isHarmful: true,
          damageValue: finalDamage,
          leftValue: tgt.hp,
          extraData: 0,
          parry: 0,
          order: i + 1
        });
        this.server.log(`[BATTLE #${state.id}] Turno ${battle.turn}: heroi ataca ${tgt.livingId} com ${skillTpl?.TemplateName_pt || skillId}, dano ${finalDamage}, HP restante ${tgt.hp}.`);
      }
    }

    battle.pendingHeroTargets=null;
    for (const [id, buff] of hero.runeBuffs || []) {
      if (Number(buff.template.AttackType) === 20 && --buff.remaining <= 0) hero.runeBuffs.delete(id);
    }
    const appliedBuffers=[];
    if (hero.morphed && skillTpl) {
      for (const id of String(skillTpl.BufferIds || '').split('|').map(Number).filter(Boolean)) {
        const template=skillBufferById.get(id);
        if (!template) continue;
        const type=Number(template.AttackType);
        if (type===20) {
          hero.runeBuffs ||= new Map();
          hero.runeBuffs.set(id,{template,remaining:Math.max(1,Number(template.ValidCount)||1)});
        } else if (type===33) {
          const healed=Math.min(hero.maxHp-hero.hp,Math.max(1,Math.floor(hero.maxHp*Number(template.ValuePercent||0)/100)));
          if (healed>0) {
            hero.hp+=healed;
            damages.push({livingId:hero.livingId,damageType:6,isHarmful:false,damageValue:healed,leftValue:hero.hp,extraData:0,parry:0,order:damages.length+1});
          }
        } else continue;
        appliedBuffers.push({bufferId:id,templateId:id,sourceId:hero.livingId,targetId:hero.livingId,
          curTurn:battle.turn,execFrame:0,maxTurn:Math.max(1,Number(template.ValidCount)||1),seeType:1,exeWay:1});
      }
    }
    battle.attackSeq = (battle.attackSeq || 0) + 1;
    this.server.sendGameSession(state, 153, pb.encode('battle.AttackOrderMsg', {
      battleId: battle.battleId,
      frame: battle.attackSeq,
      orderId: skillId,
      isPassive: false,
      livingId: hero.livingId,
      sp: hero.sp,
      spAdded: spAdded,
      awake: hero.awake || 0,
      awakeAdd,
      damages: damages,
      execFrame: 0,
      frameNum: battle.attackSeq,
      attackMillis: formatAttackMillis(),
      buffers: appliedBuffers,
      awakenSoldiers: [],
      attackOrderSeq: battle.attackSeq,
      cdTime: 0,
      curTurn: battle.turn
    }));
    if (battle.activeSylph && awakeAdd !== 0) {
      this.server.sendGameSession(state, 4600, pb.encode('battle.AwakeMsg', {
        awake: [{ livingId: hero.livingId, awake: hero.awake }]
      }));
    }

    // 3. Ação independente das Tropas da Formação (se houver tropas vivas e monstros vivos)
    if (battle.playerSoldiers && battle.playerSoldiers.length > 0) {
      for (const soldier of battle.playerSoldiers) {
        if (soldier.hp <= 0) continue;
        const aliveTarget = battle.monsters.find(m => m.hp > 0);
        if (!aliveTarget) break;
        const troopDmg = Math.min(aliveTarget.hp, Math.max(1, Math.floor((soldier.phyAttack || 20) * 1.2)));
        aliveTarget.hp -= troopDmg;
        battle.attackSeq = (battle.attackSeq || 0) + 1;
        const troopDamages = [{
          livingId: aliveTarget.livingId,
          damageType: 6, // CC.BLOOD_TYPE_SELF (anima número de dano e barra do monstro)
          isHarmful: true,
          damageValue: troopDmg,
          leftValue: aliveTarget.hp,
          extraData: 0,
          parry: 0,
          order: 1
        }];
        this.server.sendGameSession(state, 153, pb.encode('battle.AttackOrderMsg', {
          battleId: battle.battleId,
          frame: battle.attackSeq,
          orderId: (soldier.skillId && soldier.skillId[0]) || 40081,
          isPassive: false,
          livingId: soldier.livingId,
          sp: 0,
          spAdded: 0,
          damages: troopDamages,
          execFrame: 0,
          frameNum: battle.attackSeq,
          attackMillis: formatAttackMillis(),
          buffers: [],
          awakenSoldiers: [],
          attackOrderSeq: battle.attackSeq,
          cdTime: 0,
          curTurn: battle.turn
        }));
        this.server.log(`[BATTLE #${state.id}] Tropa aliada ${soldier.livingId} atacou ${aliveTarget.livingId}, dano ${troopDmg}, HP restante ${aliveTarget.hp}. Opcode 153 enviado.`);
      }
    }

    // 4. Ação independente do Silfo de Combate equipado
    if (battle.activeSylph && battle.battlePets && battle.battlePets.length > 0) {
      const sylph = battle.battlePets[0];
      const aliveTarget = battle.monsters.find(m => m.hp > 0);
      if (aliveTarget && sylph) {
        const sylphPower = Number(battle.activeSylph.power || battle.activeSylph.intel || 50);
        const sylphApti = Number(battle.activeSylph.powerApti || battle.activeSylph.intelApti || 1000);
        const sylphAtk = Math.max(80, Math.floor((sylphPower * sylphApti) / 100) +
          Number(battle.activeSylph.bagAttack||0) + Number(battle.activeSylph.bagMagicattack||0));
        const sylphDmg = Math.min(aliveTarget.hp, Math.max(15, Math.floor(sylphAtk * 1.3)));
        aliveTarget.hp -= sylphDmg;
        battle.attackSeq = (battle.attackSeq || 0) + 1;
        const sylphSkillId = (sylph.skillId && sylph.skillId[0]) || 701000;
        const sylphDamages = [{
          livingId: aliveTarget.livingId,
          damageType: 6,
          isHarmful: true,
          damageValue: sylphDmg,
          leftValue: aliveTarget.hp,
          extraData: 0,
          parry: 0,
          order: 1
        }];
        this.server.sendGameSession(state, 153, pb.encode('battle.AttackOrderMsg', {
          battleId: battle.battleId,
          frame: battle.attackSeq,
          orderId: sylphSkillId,
          isPassive: false,
          livingId: sylph.livingId,
          sp: 100,
          spAdded: 0,
          damages: sylphDamages,
          execFrame: 0,
          frameNum: battle.attackSeq,
          attackMillis: formatAttackMillis(),
          buffers: [],
          awakenSoldiers: [],
          attackOrderSeq: battle.attackSeq,
          cdTime: 0,
          curTurn: battle.turn
        }));
        this.server.log(`[BATTLE #${state.id}] Silfo ${sylph.nickName} (livingId ${sylph.livingId}) atacou ${aliveTarget.livingId} com skill ${sylphSkillId}, dano ${sylphDmg}, HP restante ${aliveTarget.hp}. Opcode 153 enviado.`);
      }
    }

    if (battle.monsters.every(monster => monster.hp <= 0)) {
      this.schedule(state, battle, () => this.finishBattleVictory(state, battle).catch(err => this.server.log(`[BATTLE #${state.id}] Falha ao finalizar: ${err.message}`)), 1800);
      return;
    }

    // Turno do Inimigo / Contra-ataque
    this.schedule(state, battle, () => {
      const enemy = battle.monsters.find(monster => monster.hp > 0);
      if (!enemy) return;
      // Seleciona alvo prioritário: tropa da linha de frente viva, ou o herói
      const frontSoldier = (battle.playerSoldiers || []).find(s => s.hp > 0 && [1, 7].includes(s.pos));
      const targetUnit = frontSoldier || hero;
      const isTargetHero = targetUnit === hero;

      const tgtDef = isTargetHero ? (hero.defence || 0) : (targetUnit.phyDefence || 10);
      const rawCounter = Math.max(1, Math.floor(enemy.attack) - Math.floor(tgtDef / 15));
      let counterDamage = rawCounter;
      if (isTargetHero) {
        for (const [id, buff] of hero.runeBuffs || []) {
          if (Number(buff.template.AttackType) !== 15 || buff.remaining <= 0) continue;
          counterDamage = Math.max(1, Math.floor(counterDamage *
            (1 + Number(buff.template.ValuePercent || 0) / 100)));
          if (--buff.remaining <= 0) hero.runeBuffs.delete(id);
        }
      }

      if (isTargetHero) {
        // Absorção por escudo do herói
        if (hero.shield && hero.shield > 0) {
          const absorbed = Math.min(hero.shield, counterDamage);
          hero.shield -= absorbed;
          counterDamage -= absorbed;
          this.server.log(`[BATTLE #${state.id}] Escudo absorveu ${absorbed} de dano (Escudo restante: ${hero.shield}).`);
        }
        hero.hp = Math.max(0, hero.hp - counterDamage);
        // Ganho de Fúria ao receber golpe (+5 Fúria conforme prints oficiais)
        hero.sp = Math.min(100, hero.sp + 5);
      } else {
        targetUnit.hp = Math.max(0, targetUnit.hp - counterDamage);
        this.server.log(`[BATTLE #${state.id}] Turno ${battle.turn}: monstro ${enemy.livingId} ataca tropa da frente ${targetUnit.livingId}, dano ${counterDamage}, HP restante ${targetUnit.hp}.`);
      }

      battle.attackSeq++;
      this.server.sendGameSession(state, 153, pb.encode('battle.AttackOrderMsg', {
        battleId: battle.battleId,
        frame: battle.attackSeq,
        orderId: enemy.skillId,
        isPassive: false,
        livingId: enemy.livingId,
        sp: 0,
        spAdded: 0,
        damages: [{
          livingId: targetUnit.livingId,
          damageType: isTargetHero ? 6 : 7, // 6 = Hero (BLOOD_TYPE_SELF), 7 = Tropa (BLOOD_TYPE_ARMY)
          isHarmful: true,
          damageValue: counterDamage,
          leftValue: targetUnit.hp,
          extraData: 0,
          parry: 0,
          order: 1
        }],
        execFrame: 0,
        frameNum: battle.attackSeq,
        attackMillis: formatAttackMillis(),
        buffers: [],
        awakenSoldiers: [],
        attackOrderSeq: battle.attackSeq,
        cdTime: 0,
        curTurn: battle.turn
      }));

      if (isTargetHero) {
        // Sincroniza ganho de +5 Fúria visual do herói via opcode 77 (AttackModeMsg)
        this.server.sendGameSession(state, 77, pb.encode('battle.AttackModeMsg', {
          userId: hero.userId,
          battleId: battle.battleId,
          serverName: hero.serverName || 'S1',
          armyId: 0,
          mode: 0,
          fmTurn: battle.turn,
          heroSp: 5
        }));
        this.server.log(`[BATTLE #${state.id}] Turno ${battle.turn}: monstro ${enemy.livingId} ataca heroi, dano ${counterDamage}, HP ${hero.hp}, Fúria ${hero.sp}/100.`);
      }

      if (hero.hp <= 0 || battle.turn >= 30) {
        this.schedule(state, battle, () => this.finishBattleDefeat(state, battle), 1200);
      } else {
        battle.waitingHeroAction = true;
        battle.turnTimer = this.schedule(state, battle, () => {
          if (battle.waitingHeroAction) this.executeTurn(state, battle);
        }, 2800);
      }
    }, 1400);
  }

  async finishBattleDefeat(state,battle) {
    if(state.activeBattle!==battle || battle.phase==='OVER' || battle.phase==='COMMITTING')return;
    battle.phase='COMMITTING';
    try {
      if (battle.activeSylph) {
        const result=await db.mutateCharacterState(state.gatewayId, saved => {
          sylphAwakening.saveAwake(saved,battle.awakeningUsed ? 0 : battle.hero.awake);
          return {state:saved};
        });
        state.character.state_json=result.state;
      }
      this.sendAwakeningReset(state,battle);
      this.server.sendGameSession(state,4103,pb.encode('battle.BattleReportMsg',{
        battleResult:2,strategyBonus:0,gpBonus:0,posX:0,posY:0,signId:'',baseItem:[],
        battleScene:0,failCount:1,goldBonus:0,petGpBonus:0,param1:0,param2:0,battleId:battle.battleId
      }));
      this.server.sendGameSession(state,159,pb.encode('battle.BattleResultMsg',{
        proxyId:'',combatResult:2,army:[],castleRoomId:0,beatNum:0,startTime:0,recordUri:'',remoteKills:0
      }));
      this.server.log(`[BATTLE #${state.id}] Derrota sem recompensa; despertar ${battle.activeSylph ? state.character.state_json?.sylphs?.awake : 0}/3000 salvo.`);
    } finally {
      this.cancelBattle(state);
    }
  }

  sendAwakeningReset(state,battle) {
    if (!battle.awakeningUsed || !battle.activeSylph) return;
    battle.hero.awake = 0;
    this.server.sendGameSession(state,4600,pb.encode('battle.AwakeMsg',{
      awake:[{livingId:battle.hero.livingId,awake:0}]
    }));
  }

  async finishBattleVictory(state, battle) {
    if (state.closed || state.activeBattle !== battle || battle.phase === 'OVER' || battle.phase === 'COMMITTING') return;
    if (battle.monsters.some(monster => monster.hp > 0)) throw new Error('Vitoria antes da derrota dos monstros');
    battle.phase = 'COMMITTING';

    if (battle.remotePetIndex) {
      try {
        const committed = await db.mutateCharacterState(state.gatewayId, saved => {
          if (battle.activeSylph) sylphAwakening.saveAwake(saved,battle.awakeningUsed ? 0 : battle.hero.awake);
          const outcome = remotePetState.challengeRemotePet(saved, battle.remotePetIndex, inventoryState.addItem);
          if (!outcome.success) throw Error(outcome.error);
          const wire = pb.encode('remotepet.RemotePetMsg',
            require('./secondary-systems-state').formatRemotePetMsg(saved, state.gatewayId));
          const report = pb.encode('battle.BattleReportMsg', {
            battleResult: 1, strategyBonus: 0, gpBonus: 0, posX: 0, posY: 0,
            signId: '', baseItem: [], battleScene: 0, failCount: 0,
            goldBonus: outcome.goldReward, petGpBonus: 0,
            param1: outcome.goldReward, param2: 0, battleId: battle.battleId
          });
          return { state: saved, outcome, wire, report };
        });
        state.character = await db.characterById(state.gatewayId);
        this.sendAwakeningReset(state,battle);
        this.server.sendGameSession(state, 4103, committed.report);
        this.server.sendGameSession(state, 159, pb.encode('battle.BattleResultMsg', {
          proxyId: '', combatResult: 1, army: [], castleRoomId: 0,
          beatNum: 1, startTime: 0, recordUri: '', remoteKills: 0
        }));
        this.server.sendGameSession(state, 4964, committed.wire);
        this.server.sendGameSession(state, 3, this.server.makeBasicPlayerInfo(state.character));
        if (committed.outcome.drops.length) this.server.sendInventorySnapshot(state);
        this.server.log(`[REMOTE PET #${state.id}] Batalha vencida: fase ${battle.remotePetIndex}; energia -${committed.outcome.energyCost}, ouro +${committed.outcome.goldReward}, itens ${committed.outcome.drops.length}.`);
      } finally {
        this.cancelBattle(state);
      }
      return;
    }

    const nodeId = battle.nodeId;
    const cNode = battle.outerMonster ? null : nodeById.get(Number(nodeId));
    const character = state.character;
    const xpReward = battle.rewards.xp;
    const goldReward = battle.rewards.gold;

    // Prepare os pacotes, mas anuncie a vitoria somente depois do COMMIT MariaDB.
    const reportMsg = {
      battleResult: 1, // 1 = Vitória
      strategyBonus: 0,
      gpBonus: xpReward,
      posX: 0,
      posY: 0,
      signId: '',
      baseItem: [],
      battleScene: 0,
      failCount: 0,
      goldBonus: goldReward,
      petGpBonus: 0,
      param1: goldReward,
      param2: 0,
      battleId: battle.battleId
    };
    // 2. Enviar S2C 159 (U_B_GAME_OVER)
    const gameOverMsg = {
      proxyId: '',
      combatResult: 1, // Vitória
      army: [],
      castleRoomId: 0,
      beatNum: 1,
      startTime: 0,
      recordUri: '',
      remoteKills: 0
    };
    const encGameOver = pb.encode('battle.BattleResultMsg', gameOverMsg);

    // 3. Enviar S2C 128 (U_C_CAMPAIGN_NODE_UPDATE) marcando o monstro como derrotado
    const nodeUpdateMsg = {
      nodeId: nodeId,
      nodeState: 8, // 8 = Concluído / Derrotado
      visitUserIds: [],
      userIds: [],
      visitServerName: []
    };
    const encNodeUpdate = pb.encode('campaign.CampaignNodeUpdateMsg', nodeUpdateMsg);

    // 4. Persistir no MariaDB (wonNodes, XP, Gold, Nível, Missões)
    let committed=false;
    try {
      const mutResult = await db.mutateCharacterState(state.gatewayId, saved => {
        const battleMapId = battle.outerMonster ? Number(battle.mapId) : Number(cNode.CampaignId);
        const cId = battle.outerMonster ? battleMapId : (campaignState.resolveCampaignForMap(battleMapId) || battleMapId);
        let finalBoss = false;
        let nextTrialNodeId = 0;
        let trialRewardItem = 0;
        let awardedXp = xpReward, awardedGold = goldReward;
        let atollReward=null;
        if (battle.outerMonster) {
          const kills = saved.outerCityKills || {count1:0,count2:0,count3:0,lastReset:Date.now()};
          const kind = Number(battle.outerMonster.Type);
          const counter = kind === 4 ? 'count3' : kind === 5 ? 'count2' : 'count1';
          const limit = kind === 4 ? 1 : kind === 5 ? 3 : 5;
          if (Number(kills[counter] || 0) < limit) kills[counter] = Number(kills[counter] || 0) + 1;
          saved.outerCityKills = kills;
          for (const drop of battle.outerRewards) {
            const itemId = Number(drop.itemId);
            const count = Math.max(0, Number(drop.count) || 0);
            if (itemId === -100) awardedGold += count;
            else if (itemId > 0 && count > 0) inventoryState.addItem(saved,itemId,count);
          }
        } else if (atollEncounters.hostile(cNode)) {
          atollReward=atollEncounters.commitVictory(saved,cNode,{addItem:inventoryState.addItem});
        } else if (battleMapId === 10001 || battleMapId === 10002) {
          if (!saved.tutorial) saved.tutorial = {version:1,mapId:battleMapId,completed:[],wonNodes:[]};
          if (!Array.isArray(saved.tutorial.wonNodes)) saved.tutorial.wonNodes=[];
          if (!saved.tutorial.wonNodes.includes(nodeId)) saved.tutorial.wonNodes.push(nodeId);
          // Desbloqueia a 2ª skill ao vencer os Ursos no nó 1000103 junto com a Dinah
          if (Number(nodeId) === 1000103) {
            const hJob = Number(saved.job || character.job || 1);
            const secondSkills = { 1: 10811, 2: 20811, 3: 30811 };
            const secondSonTypes = { 1: 108, 2: 208, 3: 308 };
            const sSkill = secondSkills[hJob] || 10811;
            const sSon = secondSonTypes[hJob] || 108;
            if (!saved.skills) saved.skills = { learned: [], fastKey: '' };
            if (!Array.isArray(saved.skills.learned)) saved.skills.learned = [];
            if (!saved.skills.learned.includes(sSkill)) saved.skills.learned.push(sSkill);
            const defaultSon = hJob === 1 ? 107 : (hJob === 2 ? 207 : 307);
            saved.skills.fastKey = `${defaultSon},${sSon},-1,-1,-1,-1`;
          }
        } else {
          if (!saved.campaigns) saved.campaigns = {};
          if (!saved.campaigns.current || Number(saved.campaigns.current.mapId) !== battleMapId) {
            saved.campaigns.current = { campaignId: cId, mapId: battleMapId, runWonNodes: [] };
          }
          const current = saved.campaigns.current;
          if (!Array.isArray(current.runWonNodes)) current.runWonNodes=[];
          const trialFirstVictory = !current.runWonNodes.includes(nodeId);
          if (!current.runWonNodes.includes(nodeId)) current.runWonNodes.push(nodeId);
          if (!saved.campaigns.wonNodes) saved.campaigns.wonNodes={};
          if (!Array.isArray(saved.campaigns.wonNodes[cId])) saved.campaigns.wonNodes[cId]=[];
          if (!saved.campaigns.wonNodes[cId].includes(nodeId)) saved.campaigns.wonNodes[cId].push(nodeId);
          if (campaignState.trialChallengeNodes(battleMapId).some(row => Number(row.Id) === Number(nodeId))) {
            if (trialFirstVictory) {
              // t_s_config Trial_Tower_Reward_*/EXP_*: um baú e EXP por etapa.
              // O nó é persistido junto com a entrega para não duplicar em retries.
              trialRewardItem = battleMapId === 8205 ? 2060505 : 2060045;
              awardedXp = battleMapId === 8205 ? 450000 : 300000;
              inventoryState.addItem(saved, trialRewardItem, 1);
            } else {
              awardedXp = 0;
            }
            const nextTrial = campaignState.nextTrialChallenge(battleMapId, current.runWonNodes);
            nextTrialNodeId = Number(nextTrial?.Id) || 0;
            if (!nextTrialNodeId) current.trialCompleted = true;
          }
          const towerFloor=campaignState.towerFloor(battleMapId);
          if (towerFloor && saved.towers?.[towerFloor.campaignId]?.rewardedNodes?.includes(Number(nodeId))) {
            awardedXp=0;
            awardedGold=0;
          } else if (towerFloor && Number(saved.towers?.[towerFloor.campaignId]?.rewardMultiplier) === 2) {
            awardedXp *= 2;
            awardedGold *= 2;
          }
          campaignState.recordTowerVictory(saved, battleMapId, nodeId, awardedXp, awardedGold);
          if (towerFloor) {
            // Drops canônicos de Labirinto / Catacumbas:
            // Moedas do Labirinto (208006): base 5 + floor * 2
            const mult = Number(saved.towers?.[towerFloor.campaignId]?.rewardMultiplier) === 2 ? 2 : 1;
            const mazeCoinCount = Math.max(5, (towerFloor.floor * 2 + 5)) * mult;
            inventoryState.addItem(saved, 208006, mazeCoinCount);
            if (towerFloor.floor % 5 === 0) {
              // Andares múltiplos de 5: Pedra de Encantamento (208007)
              inventoryState.addItem(saved, 208007, 2 * mult);
            }
          }
          finalBoss=campaignState.isFinalBossNode(cNode);
          if (finalBoss) {
            campaignState.prepareCardReward(saved,cNode,battle.battleId,xpReward);
            campaignState.unlockNextCampaigns(saved, cId);
          }
        }

        // Catalog property 2030 is a percentage bonus to campaign/MPD XP.
        // Trial Tower and labyrinths are explicitly excluded by the scroll text.
        const expScrollPct=require('./item-consumable-state').activeBuffValue(saved,2030);
        const excludedExpMap=Boolean(campaignState.towerFloor(battleMapId)) ||
          (Number(battleMapId)>=8200&&Number(battleMapId)<=8205);
        if(cNode&&expScrollPct>0&&!excludedExpMap)
          awardedXp=Math.floor(awardedXp*(100+expScrollPct)/100);

        // Progression & Wallet
        if (!saved.progression) saved.progression = { currentXp: 0, totalXp: 0 };
        saved.progression.totalXp = (saved.progression.totalXp || 0) + awardedXp;

        const newGrade = calcGradeFromXp(saved.progression.totalXp, character.grade,saved);
        const atLevel = resource.totalAtLevel(newGrade);
        saved.progression.currentXp = Math.max(0, saved.progression.totalXp - atLevel);

        if (!saved.wallet) saved.wallet = { gold: 0, balens: 0, boundBalens: 0 };
        saved.wallet.gold = (saved.wallet.gold || 0) + awardedGold;

        const resources = {
          gold: saved.wallet.gold,
          grade: newGrade,
          experience: saved.progression.totalXp
        };

        const defeatedMonsterIds = battle.monsters ? battle.monsters.map(m => Number(m.tempId)).filter(Boolean) : [];
        const quest = questState.onCombatVictory(saved, nodeId, newGrade, {
          defeatedMonsterIds,
          mapId: battleMapId,
          campaignId: cId
        });
        if (battle.activeSylph) sylphAwakening.saveAwake(quest.state,battle.awakeningUsed ? 0 : battle.hero.awake);
        return { state: quest.state, resources, newGrade, totalXp: saved.progression.totalXp,
          awardedXp, awardedGold, quest, finalBoss, atollReward, nextTrialNodeId, trialRewardItem,
          completedCampaigns: saved.campaigns?.completed || [] };
      });
      committed=true;

      state.character.state_json = mutResult.state;
      state.character.grade = mutResult.newGrade || state.character.grade;
      state.character.experience = mutResult.totalXp;
      state.character.gold = mutResult.state.wallet.gold;

      reportMsg.gpBonus=mutResult.awardedXp;
      if (mutResult.trialRewardItem) reportMsg.baseItem=[{templateId:mutResult.trialRewardItem,count:1,type:0}];
      reportMsg.goldBonus=mutResult.awardedGold;
      reportMsg.param1=mutResult.awardedGold;
      this.sendAwakeningReset(state,battle);
      this.server.sendGameSession(state, 4103, pb.encode('battle.BattleReportMsg', reportMsg));
      this.server.sendGameSession(state, 159, encGameOver);
      this.server.sendGameSession(state, 128, encNodeUpdate);
      if (mutResult.nextTrialNodeId) {
        this.server.sendGameSession(state, 128, pb.encode('campaign.CampaignNodeUpdateMsg', {
          nodeId: mutResult.nextTrialNodeId, nodeState: 1, userId: Number(character.id), sonType: 2174
        }));
        this.server.log(`[PINACULO #${state.id}] Vitoria ${nodeId}; proximo oponente ${mutResult.nextTrialNodeId} liberado.`);
      }

      // Se o nó possuía um próximo nó (ex: portal de transição para próximo andar),
      // desbloqueia o nó com nodeState: 1 (ativo) para permitir interação imediata
      const nextNodeId = Number(cNode?.NextNodeIds || 0);
      if (nextNodeId > 0) {
        const nextNode = nodeById.get(nextNodeId);
        const encNextUpdate = pb.encode('campaign.CampaignNodeUpdateMsg', {
          nodeId: nextNodeId,
          nodeState: 1,
          userId: Number(character.id),
          sonType: Number(nextNode?.SonType || 0)
        });
        this.server.sendGameSession(state, 128, encNextUpdate);
      }
      if(mutResult.atollReward){
        // Contador oficial: U_C_PETLAND_REWARDCOUNT (4643), campaign.PetLandRewardMsg.
        // Atualizado mesmo se a Essencia nao for sorteada; apenas apos COMMIT.
        try {
          this.server.sendGameSession(state,4643,pb.encode('campaign.PetLandRewardMsg',{
            rewardTimes:mutResult.atollReward.rewardTimes
          }));
          this.server.log(`[ATOL CONTADOR #${state.id}] ${mutResult.atollReward.rewardTimes}/${mutResult.atollReward.dailyLimit}; drop=${mutResult.atollReward.drops.length}`);
        } catch(counterError){this.server.log(`[ATOL CONTADOR #${state.id}] Falha ao transmitir 4643: ${counterError.message}`);}
        // Avisos e sincronizacao secundaria NUNCA podem desfazer uma vitoria ja comitada.
        try {
          this.server.log(`[ATOL DROP #${state.id}] No ${nodeId} derrotado; ${mutResult.atollReward.drops.length} item(ns) persistido(s) no commit; respawnMs=${mutResult.atollReward.respawnMs}.`);
          if(mutResult.atollReward.drops.length && typeof this.server.sendInventorySnapshot==='function')
            this.server.sendInventorySnapshot(state);
        } catch(syncErr){
          this.server.log(`[ATOL DROP #${state.id}] Item persistido; falha ao sincronizar mochila: ${syncErr.message}`);
        }
        try {
          if(typeof this.server.scheduleSession==='function')
            this.server.scheduleSession(state,()=>{
              try {
                if(state.closed)return;
                const current=typeof state.character?.state_json==='string'?JSON.parse(state.character.state_json):(state.character?.state_json||{});
                if(Number(current.position?.mapId)!==Number(battle.mapId))return;
                this.server.sendGameSession(state,128,pb.encode('campaign.CampaignNodeUpdateMsg',{
                  nodeId:Number(nodeId),nodeState:1,visitUserIds:[],userIds:[],visitServerName:[]
                }));
                this.server.log(`[ATOL RESPAWN #${state.id}] No ${nodeId} reapareceu no mapa ${battle.mapId}.`);
              } catch(e){this.server.log(`[ATOL RESPAWN #${state.id}] ${e.message}`);}
            },mutResult.atollReward.respawnMs);
        } catch(syncErr){this.server.log(`[ATOL RESPAWN #${state.id}] Falha ao agendar: ${syncErr.message}`);}
      }
      if (battle.outerMonster && battle.outerRewards.some(drop => Number(drop.itemId) > 0))
        this.server.sendInventorySnapshot(state);
      if (mutResult.trialRewardItem) this.server.sendInventorySnapshot(state);
      const completedTowerFloor=campaignState.towerFloor(Number(nodeById.get(Number(nodeId))?.CampaignId));
      if (completedTowerFloor) {
        try {
          const t=mutResult.state.towers?.[completedTowerFloor.campaignId] || {};
          const towerIndex=completedTowerFloor.campaignId === 8001 ? 1 :
            completedTowerFloor.campaignId === 8101 ? 2 : 3;
          this.server.sendGameSession(state,4205,pb.encode('campaign.TowerInfoMsg',{
            campaignId:completedTowerFloor.campaignId,index:towerIndex,
            towerIndex:Number(t.floor)||completedTowerFloor.floor,
            maxIndex:Number(t.maxIndex)||completedTowerFloor.floor,order:0,
            totalGp:Number(t.totalGp)||0,enterCount:Number(t.enterCount)||0,
            maxEnterCount:1,freeEnterCount:Math.max(0,1-(Number(t.enterCount)||0)),
            itemTempIds:'',firstHitId:0,firstHitName:'',passIndex:0,pass:0
          }));
        } catch (towerSyncError) {
          this.server.log(`[TOWER #${state.id}] Recompensa persistida; falha na atualizacao visual: ${towerSyncError.message}`);
        }
      }
      // Informacoes secundarias nao podem impedir a entrega do resultado visual.
      try {
        this.server.sendGameSession(state, 3, this.server.makeBasicPlayerInfo(state.character));
        const heroInfoMsg = heroState.heroInfo(state.character, mutResult.state);
        this.server.sendGameSession(state, 113, pb.encode('army.SimpleHeroInfoMsg', heroInfoMsg));
        if (mutResult.quest.changed && mutResult.quest.updatedQuests.length > 0)
          this.server.sendGameSession(state, 112, pb.encode('quest.QuestUpdatedRspMsg',
            questState.formatQuestUpdatedProtocol(mutResult.state,mutResult.quest.updatedQuests)));

        if (mutResult.finalBoss && Array.isArray(mutResult.completedCampaigns) && mutResult.completedCampaigns.length > 0) {
          const rankMsg = {
            rankInfo: mutResult.completedCampaigns.map(id => ({
              userId: Number(state.gatewayId),
              campaignId: Number(id),
              rank: 1
            }))
          };
          this.server.sendGameSession(state, 4151, pb.encode('campaign.RankListRspMsg', rankMsg));
          this.server.log(`[BATTLE #${state.id}] Opcode 4151 (campaign.RankListRspMsg) despachado com ${mutResult.completedCampaigns.length} campanhas concluidas.`);
        }

        // Notifica ganho de EXP na aba Sistema do chat (Opcode 83)
        const sysMsg = {
          channel: 2, // Sistema (zr.SYSTEM = 2)
          encodeMsg: `Você derrotou o monstro e obteve ${mutResult.awardedXp} EXP!`,
          name: 'Sistema',
          level: 1,
          otherId: 0,
          isCenterTip: true
        };
        this.server.sendGameSession(state, 83, pb.encode('chat.ChatChannelMsg', sysMsg));
        this.server.log(`[BATTLE #${state.id}] Log de EXP enviado ao chat Sistema (Opcode 83: +${mutResult.awardedXp} EXP).`);
      } catch (syncError) {
        this.server.log(`[BATTLE #${state.id}] Resultado persistido; sincronizacao secundaria falhou: ${syncError.message}`);
      }

      this.server.log(`[BATTLE #${state.id}] Vitoria persistida no DB com sucesso! Node ${nodeId} derrotado, XP +${mutResult.awardedXp} (Total: ${mutResult.totalXp}, Nivel: ${state.character.grade}).`);

      const pending=mutResult.state.campaigns?.current?.pendingCard;
      if (pending?.battleId === battle.battleId) {
        this.server.scheduleSession(state,()=>{
          const saved=typeof state.character.state_json==='string'?JSON.parse(state.character.state_json):state.character.state_json;
          if(saved?.campaigns?.current?.pendingCard?.battleId!==battle.battleId)return;
          this.server.sendGameSession(state,137,pb.encode('campaign.CampaignReportMsg',
            campaignState.cardReport(pending)));
          this.server.log(`[CAMPAIGN #${state.id}] Carta da campanha ${pending.campaignId} aberta apos boss ${nodeId} (137).`);
        },3500);
      }

      if (this.server.recorder) {
        try{this.server.recorder.recordServerOutcome({
          category: 'battle',
          handler: 'finishBattleVictory',
          validations: 'passed',
          persistentChanges: {
            nodeId,
            wonNodes: mutResult.state.tutorial?.wonNodes || mutResult.state.campaigns?.current?.runWonNodes || [],
            newGrade: state.character.grade,
            xpReward: mutResult.awardedXp,
            totalXp: mutResult.totalXp
          },
          responseOpcode: 4103,
          finalState: 'SAVED_DB'
        });}catch(recordError){this.server.log(`[BATTLE #${state.id}] Telemetria falhou: ${recordError.message}`)}
      }

    } catch (dbErr) {
      this.server.log(`[BATTLE #${state.id}] ${committed?'Persistido, mas falha ao enviar resultado':'Falha ao persistir vitoria'}: ${dbErr.message}`);
      throw dbErr;
    } finally {
      this.cancelBattle(state);
    }
  }
}

module.exports = BattleEngine;
