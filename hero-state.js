'use strict';
const fs=require('node:fs'),path=require('node:path'),inventory=require('./inventory-state');
const rows=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../res/release/config/t_s_herotemplate-9489abd820.json'),'utf8')).t_s_herotemplate;
const heroes=new Map(rows.map(row=>[row.TemplateId,row]));
const items=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../res/release/config/t_s_itemtemplate-43b07d7a92.json'),'utf8')).t_s_itemtemplate;
const byItem=new Map(items.map(row=>[row.TemplateId,row]));
function model(character){
 const saved=inventory.parseState(character.state_json),h=saved.hero,t=heroes.get(h?.templateId);
 if(!h||!t||t.HeroType!==1||!Number.isSafeInteger(h.id)||h.id<1||h.headId!==h.templateId||
   t.Job!==saved.job||t.Sexs!==character.sex)throw Error('Persisted hero identity missing or inconsistent');
 return {saved,h,t};
}
function appearance(character){
 const {saved}=model(character),bag=inventory.inventory(saved),view={arm:'',cloth:'',wing:'',hat:'',fashionArm:'',fashionCloth:''};
 for(const item of bag.items.filter(i=>i.bagType===4)){
  const t=byItem.get(item.templateId);
  if(!t)continue;
  if(t.SonType===101)view.arm=t.Avata||'';
  if(t.SonType===104)view.cloth=t.Avata||'';
  if(t.SonType===109)view.wing=t.Avata||'';
  if(t.SonType===110)view.hat=t.Avata||'';
  if(t.SonType===111){view.cloth=t.Avata||'';view.fashionCloth=t.Avata||'';}
  if(t.SonType===112){view.arm=t.Avata||'';view.fashionArm=t.Avata||'';}
 }
 if(saved.fashionDisplay){
  const fd=saved.fashionDisplay;
  if(fd.wingAvata){const wt=byItem.get(Number(fd.wingAvata));if(wt&&wt.Avata)view.wing=wt.Avata;}
  if(fd.hatAvata){const ht=byItem.get(Number(fd.hatAvata));if(ht&&ht.Avata)view.hat=ht.Avata;}
  if(fd.clothAvata){const ct=byItem.get(Number(fd.clothAvata));if(ct&&ct.Avata){view.cloth=ct.Avata;view.fashionCloth=ct.Avata;}}
  if(fd.armAvata){const at=byItem.get(Number(fd.armAvata));if(at&&at.Avata){view.arm=at.Avata;view.fashionArm=at.Avata;}}
 }
 return view;
}
const attributeCalculator = require('./attribute-calculator');

function calculateHeroAttributes(character) {
  return attributeCalculator.calculateAttributes(character);
}

function heroInfo(character){
  const {saved,h,t}=model(character);
  const skillsState=require('./skills-state');
  const skillScript=skillsState.getSkillScript(saved,t.Job);
  const fastKey=skillsState.getFastKey(saved,t.Job);
  const skillPoint=skillsState.getAvailableSkillPoints(saved,t.Job,character.grade);
  const extraSkillPoint=skillsState.getExtraSkillPoints(saved);
  const attrs=calculateHeroAttributes(character);
  const app=appearance(character);

  return {
    heroId:h.id, nickName:character.nickname, tempateId:t.TemplateId, playerId:character.id, headId:h.headId,
    grade:character.grade,
    basePower:attrs.basePower, baseAgility:attrs.baseAgility, baseIntellect:attrs.baseIntellect,
    baseCaptain:attrs.baseCaptain, basePhysique:attrs.basePhysique,
    basePhyAttack:attrs.basePhyAttack, basePhyDefence:attrs.basePhyDefence,
    baseMagicAttack:attrs.baseMagicAttack, baseMagicDefence:attrs.baseMagicDefence,
    baseForceHit:attrs.baseForceHit, baseParry:attrs.baseParry, baseConatArmy:attrs.baseConatArmy,
    baseLive:attrs.baseLive, baseStrength:attrs.baseStrength, baseTenacity:attrs.baseTenacity,
    hp:attrs.totalLive, blood:attrs.totalLive,
    totalPower:attrs.totalPower, totalAgility:attrs.totalAgility, totalIntellect:attrs.totalIntellect,
    totalCaptain:attrs.totalCaptain, totalPhysique:attrs.totalPhysique,
    totalPhyAttack:attrs.totalPhyAttack, totalPhyDefence:attrs.totalPhyDefence,
    totalMagicAttack:attrs.totalMagicAttack, totalMagicDefence:attrs.totalMagicDefence,
    totalForceHit:attrs.totalForceHit, totalParry:attrs.totalParry,
    totalConatArmy:attrs.totalConatArmy, totalLive:attrs.totalLive,
    totalStrength:attrs.totalStrength, totalTenacity:attrs.totalTenacity,
    fireResi:attrs.fireResi, waterResi:attrs.waterResi, electResi:attrs.electResi,
    windResi:attrs.windResi, darkResi:attrs.darkResi, lightResi:attrs.lightResi, reduceResi:attrs.reduceResi,
    defensePenetration:attrs.defensePenetration || 0,
    criticalResistance:attrs.criticalResistance || 0,
    parryResistance:attrs.parryPenetration || 0,
    remainPoint:attrs.remainPoint || 0,
    powerPoint:attrs.allocatedPoints?.power || 0,
    agilityPoint:attrs.allocatedPoints?.agility || 0,
    intellectPoint:attrs.allocatedPoints?.intellect || 0,
    physiquePoint:attrs.allocatedPoints?.physique || 0,
    captainPoint:attrs.allocatedPoints?.captain || 0,
    fightingCapacity:attrs.fightingCapacity, totalPre:attrs.totalPre,
    skillScript, fastKey, skillPoint, extraSkillPoint, talentSkill:'',
    arm: app.arm || '', cloth: app.cloth || '', wing: app.wing || '', hat: app.hat || '',
    storeGrade: Number(saved.jewelGrades || 0),
    honorEquipLevel: Number(saved.honorEquip?.level || 0),
    honorEquipStage: Number(saved.honorEquip?.stage || 0),
    geste: Number(saved.wallet?.honor ?? saved.honor ?? 0),
    mountAvata: (saved.mounts?.riding && saved.mounts?.mountTempId) ? '/mount_horse_white' : ''
  };
}

function armyInfo(character, overrideMapId = null){
  const {saved,h,t}=model(character);
  let pos = saved.position;
  if(!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number'){
    pos = { mapId: 5, x: 361, y: 1314 };
  }
  let currentMapId = overrideMapId !== null ? overrideMapId : (pos.mapId || 5);
  let curPosX = (overrideMapId === 5 && pos.mapId !== 5) ? 361 : (pos.x || 361);
  let curPosY = (overrideMapId === 5 && pos.mapId !== 5) ? 1314 : (pos.y || 1314);

  const simpleHeroInfo=heroInfo(character);
  const barracksState=require('./barracks-state');
  const armyPawns=barracksState.formatHeroArmyPawns(saved,h.armyId) || [];

  const isVip = Boolean(Number(character.vip_level) > 0 && (!character.vip_expire_time || new Date(character.vip_expire_time) > new Date()));
  const vipType = Number(character.vip_type) || 1;

  const mountTempId = saved.mounts?.riding ? (Number(saved.mounts.mountTempId) || 1000) : 0;
  const mountGrade = Number(saved.mounts?.levelMax) || 1;
  const honorEquipLevel = Number(saved.honorEquip?.level || 0);
  const honorEquipStage = Number(saved.honorEquip?.stage || 0);

  let guardShowInfo = null;
  const activeGuard = (saved.guardians?.list || []).find(g => g && g.isFight && Number(g.guardId) === Number(saved.guardians?.activeId || 1));
  if (activeGuard) {
    const gStar = Math.max(0, Math.min(5, Number(activeGuard.guardStar) || 0));
    const gStage = Math.max(0, Math.min(4, Number(activeGuard.guardStage) || 0));
    let gLv = 1;
    if (Array.isArray(activeGuard.equipInfos) && activeGuard.equipInfos.length > 0) {
      const sum = activeGuard.equipInfos.reduce((acc, eq) => acc + (Number(eq.equipLv) || 0), 0);
      gLv = Math.max(1, Math.floor(sum / 8));
    }
    guardShowInfo = {
      guardTemplateId: Number(activeGuard.guardId) || 1,
      guardStage: gStage,
      guardLv: gLv,
      guardName: String(activeGuard.guardName || 'Cavaleiro Sagrado'),
      guardStar: gStar,
      isFollowing: Boolean(activeGuard.isFollowing)
    };
  }

  return {
    armyId:h.armyId, playerId:character.id, nickName:character.nickname,
    mapId:currentMapId, curPosX, curPosY,
    state:0, type:2, armyPawn:armyPawns, simpleHeroInfo, heroTempId:t.TemplateId || 1, headId:h.headId || 1,
    grades:character.grade, job:t.Job || 1, consortiaName:(saved.consortia && saved.consortia.name) ? saved.consortia.name : '',
    consortiaId:(saved.consortia && saved.consortia.id) ? Number(saved.consortia.id) : 0,
    fightingCapacity:simpleHeroInfo.fightingCapacity,
    isVip,
    vipType,
    mountTempId,
    mountGrade,
    honorEquipLevel,
    honorEquipStage,
    appellid: Number(character.appell_id || saved.appells?.curAppell || 0),
    geste: Number(saved.wallet?.honor ?? saved.honor ?? 0),
    onVehicle: false,
    serverName: character.site || 'S1',
    guardShowInfo,
    ...appearance(character)
  };
}

module.exports={heroes,byItem,model,appearance,calculateHeroAttributes,heroInfo,armyInfo};
