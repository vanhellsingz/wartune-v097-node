'use strict';
/** Validated Sylph skill state. Never grants skillbooks or removes items on failure. */
const fs=require('node:fs');
const path=require('node:path');
const MAX_BAR=6;
function cleanIds(raw){
  const ids=Array.isArray(raw)?raw:typeof raw==='string'?raw.split(','):[];
  return ids.map(Number).filter(x=>Number.isSafeInteger(x)&&x>0);
}
function readSkillCatalogue(configDir){
  let names=[];
  try {names=fs.readdirSync(configDir).filter(n=>/^t_s_skilltemplate(?:-.*)?\.json$/i.test(n));}catch(_){return []}
  if(names.length!==1) return []; // ambiguous or missing: fail closed
  try {
    const data=JSON.parse(fs.readFileSync(path.join(configDir,names[0]),'utf8')).t_s_skilltemplate;
    return Array.isArray(data)?data:[];
  }catch(_){return []}
}
function toIdMap(catalogue){return new Map((catalogue||[]).map(x=>[Number(x.TemplateId),x]));}
function initialBar(pet,template,catalogue){
  const skillMap=toIdMap(catalogue);
  // Work ONLY from the skill IDs already transmitted for this individual Sylph.
  const chosen=[];
  for(const id of cleanIds(pet.changeSkills)){
    const skill=skillMap.get(id);
    if(!skill||Number(skill.UseWay)!==1) continue;
    const son=Number(skill.SonType);
    if(Number.isSafeInteger(son)&&son>0&&!chosen.includes(son))chosen.push(son);
  }
  return [...chosen.slice(0,MAX_BAR),...Array(MAX_BAR).fill(-1)].slice(0,MAX_BAR).join(',');
}
function validBar(value,pet,catalogue){
  if(typeof value!=='string'||value.length>160)throw Error('Barra de Silfo inválida');
  const tokens=value.replace(/,$/,'').split(',');
  if(tokens.length!==MAX_BAR||tokens.some(x=>!/^(-1|\d+)$/.test(x)))throw Error('Barra deve conter seis SonType/-1');
  const known=toIdMap(catalogue);
  const sonTypes=new Set(cleanIds(pet.changeSkills).map(id=>known.get(id)).filter(skill=>Number(skill?.UseWay)===1).map(skill=>Number(skill.SonType)).filter(x=>x>0));
  const seen=new Set();
  for(const item of tokens){
    const id=Number(item);
    if(id===-1)continue;
    if(!sonTypes.has(id))throw Error('Habilidade não aprendida no Silfo: SonType '+id);
    if(seen.has(id))throw Error('Habilidade duplicada na barra');
    seen.add(id);
  }
  return tokens.join(',');
}
function ensurePet(state,petId){
  const id=Number(petId);
  if(!Number.isSafeInteger(id)||id<=0)throw Error('ID de Silfo inválido');
  const pet=(state?.sylphs?.list||[]).find(p=>Number(p.petId)===id&&!p.isDel);
  if(!pet)throw Error('Silfo não encontrado');
  return pet;
}
function setFastKey(saved,petId,raw,catalogue){
  const pet=ensurePet(saved,petId);
  pet.fastKey=validBar(raw,pet,catalogue);
  return pet;
}
function setSkillIndex(saved,petId,value){
  const pet=ensurePet(saved,petId);
  const n=Number(value);
  if(!Number.isInteger(n)||![0,1].includes(n))throw Error('Índice de habilidades inválido');
  if(n===1&&!pet.isActiveSecond)throw Error('Conjunto secundário não desbloqueado');
  pet.skillIndex=n;
  return pet;
}
function prepareLearn({saved,petId,skillId,skillCatalogue,petCatalogue}){
  const pet=ensurePet(saved,petId);
  if(!Number.isSafeInteger(Number(skillId))||Number(skillId)<=0)throw Error('SkillId inválido');
  const byId=toIdMap(skillCatalogue);
  const tpl=byId.get(Number(skillId));
  if(!tpl)throw Error('Skill não está no catálogo t_s_skilltemplate');
  const petTemplate=petCatalogue.get(Number(pet.templateId));
  if(!petTemplate)throw Error('Template do Silfo ausente');
  const job=Number(tpl.MasterType);
  if(job!==107&&job!==Number(petTemplate.PetType))throw Error('Habilidade não pertence ao tipo do Silfo');
  const required=Number(tpl.Parameter4||0);
  if(required>Number(pet.curGrade||1))throw Error('Nível do Silfo insuficiente para habilidade');
  if(![1,2].includes(Number(tpl.UseWay)))throw Error('Tipo de skill não é aprendível');
  const learned=cleanIds(pet.changeSkills);
  const son=Number(tpl.SonType);
  if(!Number.isSafeInteger(son)||son<=0)throw Error('SonType ausente');
  const matching=learned.filter(id=>Number(byId.get(id)?.SonType)===son);
  if(matching.includes(Number(skillId)))throw Error('Skill já aprendida');
  if(matching.length&&matching.some(id=>Number(byId.get(id)?.Grades||0)>=Number(tpl.Grades||1)))
    throw Error('Nova skill não aprimora a habilidade atual');
  const pre=String(tpl.PreTemplateId||'').split(/[,|]/).map(Number).filter(x=>x>0);
  for(const pid of pre){if(!learned.includes(pid))throw Error('Pré-requisito não aprendido: '+pid)}
  const next=learned.filter(id=>Number(byId.get(id)?.SonType)!==son);
  next.push(Number(skillId));
  if(next.length>30)throw Error('Quantidade de skills fora do limite de segurança');
  return {pet,tpl,next};
}
function learnFromBook({saved,petId,skillId,itemPos,skillCatalogue,petCatalogue,inventoryState,bookTemplateLookup}){
  const {pet,next}=prepareLearn({saved,petId,skillId,skillCatalogue,petCatalogue});
  // The client maps book via t_s_itemtemplate.Property1 == skill.TemplateId.
  const bag=inventoryState.inventory(saved);
  const pos=Number(itemPos);
  if(!Number.isSafeInteger(pos)||pos<0)throw Error('Posição do livro inválida');
  const item=bag.items.find(i=>Number(i.bagType)===1&&Number(i.pos)===pos&&Number(i.count)>0);
  if(!item)throw Error('Livro de habilidade não encontrado na mochila');
  const itemTemplate=bookTemplateLookup(Number(item.templateId));
  if(!itemTemplate||Number(itemTemplate.Property1)!==Number(skillId))throw Error('Livro não corresponde à habilidade pedida');
  const itemId=Number(item.templateId);
  pet.changeSkills=next.join(',');
  item.count=Number(item.count)-1;
  if(item.count===0)bag.items.splice(bag.items.indexOf(item),1);
  return {pet,skillId:Number(skillId),itemId,spent:1,changedPositions:[pos]};
}
/**
 * Verified client PetSkillTips.btnStudyClick:
 * learnSkill(petId, undefined, skillId, Fy.SPECIAL_SKILL, false)
 * payType=1 consumes Parameter3 of nh.TEMP_ID_PET_SKILL_SCROLL (208061).
 */
function learnWithScroll({saved,petId,skillId,skillCatalogue,petCatalogue,inventoryState}){
  const {pet,tpl,next}=prepareLearn({saved,petId,skillId,skillCatalogue,petCatalogue});
  const needed=Number(tpl.Parameter3);
  if(!Number.isSafeInteger(needed)||needed<=0||needed>1000000)
    throw Error('Custo em Pergaminhos de Habilidade inválido');
  const bag=inventoryState.inventory(saved);
  const stacks=bag.items.filter(i=>Number(i.bagType)===1&&Number(i.templateId)===208061&&Number.isSafeInteger(Number(i.count))&&Number(i.count)>0).sort((a,b)=>Number(a.pos)-Number(b.pos));
  const total=stacks.reduce((n,i)=>n+Number(i.count),0);
  if(total<needed)throw Error('Pergaminhos de Habilidade insuficientes: '+total+'/'+needed);
  let remaining=needed;
  const changedPositions=[];
  for(const item of stacks){
    if(remaining<=0)break;
    const take=Math.min(remaining,Number(item.count));
    item.count=Number(item.count)-take;
    remaining-=take;
    changedPositions.push(Number(item.pos));
    if(item.count===0)bag.items.splice(bag.items.indexOf(item),1);
  }
  pet.changeSkills=next.join(',');
  return {pet,skillId:Number(skillId),itemId:208061,spent:needed,changedPositions};
}
/**
 * C_PET_CHALLENGE_SKILL (8726) sends a pet.PetInfoMsg with
 * petId and chaSkillIndexs, a comma-separated list of THREE zero-based
 * indexes into the current changeSkills array (not SonTypes/template IDs).
 * In the Laya client, the string normally ends with a trailing comma.
 * Nothing here grants or removes learned abilities or items.
 */
function saveChallengeSkills(saved,petId,raw,skillCatalogue){
  const pet=ensurePet(saved,petId);
  if(typeof raw!=='string'||raw.length>48)throw Error('Lista de habilidades da Arena inválida');
  const tokens=raw.endsWith(',')?raw.slice(0,-1).split(','):raw.split(',');
  if(tokens.length!==3||tokens.some(x=>!/^(-1|0|[1-9]\d*)$/.test(x)))
    throw Error('Arena exige três índices de habilidades válidos');
  const skillMap=toIdMap(skillCatalogue);
  const learned=cleanIds(pet.changeSkills);
  const seen=new Set();
  for(const token of tokens){
    const index=Number(token);
    if(index===-1)continue;
    if(!Number.isSafeInteger(index)||index>=learned.length)
      throw Error('Índice da Arena não aprendido: '+token);
    const skill=skillMap.get(learned[index]);
    if(!skill || Number(skill.UseWay)!==1)
      throw Error('A Arena aceita apenas habilidades ativas conhecidas');
    if(seen.has(index))throw Error('Habilidade repetida na Arena');
    seen.add(index);
  }
  // Canonical wire format sent by the client omits a trailing comma on response.
  pet.chaSkillIndexs=tokens.join(',');
  return pet;
}
/**
 * C_PET_CHALLENGE_FORMATION (8725) uses pet.PlayerPetMsg.
 * chaPos: six pet IDs in the actual 6 displayed fight positions.
 * fightIndex: optional three reserve/order pet IDs; UI sends no fightIndex
 * when only moving the front formation, so do not reset the old one.
 * Zero is treated as an empty slot only for old/compatibility clients.
 */
function parseArenaPetSlots(raw, expected, name, saved){
  if (typeof raw !== 'string' || raw.length > 192) throw Error(name+' inválida');
  const tokens=raw.split(',');
  if (tokens.length!==expected || tokens.some(x=>!/^(-1|0|[1-9]\d*)$/.test(x)))
    throw Error(name+' deve ter '+expected+' posições (-1 ou IDs)');
  const seen=new Set();
  for(const token of tokens){
    const id=Number(token);
    if(id<=0)continue;
    if(!Number.isSafeInteger(id))throw Error(name+': ID fora do limite');
    ensurePet(saved,id);
    if(seen.has(id))throw Error(name+': Silfo repetido');
    seen.add(id);
  }
  return tokens.map(x=>Number(x)===0?'-1':x).join(',');
}
function saveArenaFormation(saved, req){
  if(!saved?.sylphs || typeof saved.sylphs!=='object')throw Error('Estado de Silfos ausente');
  // Validate both before updating either; never partially persist.
  const chaPos=parseArenaPetSlots(req?.chaPos,6,'Formação da Arena',saved);
  const fightIndex=(req.fightIndex === undefined || req.fightIndex === null || req.fightIndex === '')
    ? null : parseArenaPetSlots(req.fightIndex,3,'Ordem da Arena',saved);
  saved.sylphs.chaPos=chaPos;
  if(fightIndex!==null)saved.sylphs.fightIndex=fightIndex;
  return {chaPos:saved.sylphs.chaPos,fightIndex:saved.sylphs.fightIndex};
}
/**
 * The official RemotePetAdjustWnd uses a 12-position map, with six usable
 * coordinates 2,5,8,3,6,9. A second official client path (saveRemotePetInfo)
 * sometimes sends eight -1 entries as an empty fallback. Support both.
 * Verify ownership of every deployed pet before changing persistent state.
 */
function validateRemoteFormation(saved, raw){
  if(typeof raw!=='string'||raw.length>256)throw Error('Formação de Expedição inválida');
  const tokens=raw.split(',');
  if(![8,12].includes(tokens.length)||tokens.some(x=>!/^(-1|0|[1-9]\d*)$/.test(x)))
    throw Error('Formação de Expedição exige 12 posições (ou oito no fallback do cliente)');
  const used=new Set();
  const playable=new Set([2,3,5,6,8,9]);
  for(let i=0;i<tokens.length;i++){
    const n=Number(tokens[i]);
    if(n<=0)continue;
    if(!Number.isSafeInteger(n))throw Error('Pet ID de Expedição fora do limite');
    if(tokens.length===12&&!playable.has(i))throw Error('Posição de Expedição não utilizada: '+i);
    ensurePet(saved,n);
    if(used.has(n))throw Error('Silfo duplicado na formação da Expedição');
    used.add(n);
  }
  return tokens.map(x=>Number(x)===0?'-1':x).join(',');
}
/** C_REMOTE_PET_OP op=2: save expedition Sylph formation and skill indices. */
function saveRemoteSkills(saved,req){
  if(Number(req?.op)!==2)throw Error('Apenas op=2 salva habilidades da Expedição');
  if(!Array.isArray(req.pets)||req.pets.length>8)throw Error('Lista de Silfos da Expedição inválida');
  // Validate formation first: no pet skill should be updated if it is invalid.
  const formation=req.pos!==undefined && req.pos!==null && req.pos!==''
    ? validateRemoteFormation(saved,String(req.pos)):null;
  const usedPetIds=new Set(), usedSites=new Set(), sites=[];
  for(const x of req.pets){
    const pet=ensurePet(saved,x.petId);
    if(usedPetIds.has(Number(pet.petId)))throw Error('Silfo duplicado na Expedição');
    usedPetIds.add(Number(pet.petId));
    // The original ED.saveRemotePetInfo may transmit empty skills for a newly
    // positioned Sylph whose skill bar has never been configured. Preserve an
    // existing bar; for a fresh Sylph initialize three empty slots.
    const rawSkills=x.skills===undefined||x.skills===null?'':String(x.skills);
    const arr=rawSkills===''?null:rawSkills.replace(/,$/,'').split(',');
    if(arr!==null){
      if(arr.length!==3 || arr.some(v=>!/^(-1|\d+)$/.test(v)))throw Error('Índices de habilidades remotas inválidos');
      const known=cleanIds(pet.changeSkills).length;
      for(const v of arr){if(Number(v)>=known)throw Error('Skill remota não aprendida: '+v)}
      pet.remotePetSkillIndexs=arr.join(',');
    } else if(pet.remotePetSkillIndexs===undefined||pet.remotePetSkillIndexs===null){
      pet.remotePetSkillIndexs='-1,-1,-1';
    }
    const site=Number(x.site||0);
    if(site!==0){
      if(!Number.isSafeInteger(site)||site<1||site>8||usedSites.has(site))throw Error('Slot da Expedição inválido');
      usedSites.add(site);sites.push({site,petId:Number(pet.petId)});
    }
  }
  if(formation!==null){
    saved.remotePet.pos=formation;
    // Compatible with ED.__remotePetHandler: site,petId|site,petId.
    saved.remotePet.pets=sites.map(x=>x.site+','+x.petId).join('|');
  }
  if(req.isFirst!==undefined)saved.remotePet.isFirst=Boolean(req.isFirst);
  return {saved,count:req.pets.length};
}
module.exports={cleanIds,readSkillCatalogue,initialBar,validBar,ensurePet,setFastKey,setSkillIndex,learnFromBook,learnWithScroll,saveRemoteSkills,saveChallengeSkills,parseArenaPetSlots,saveArenaFormation,validateRemoteFormation};
