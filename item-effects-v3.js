'use strict';
const fs=require('node:fs'),path=require('node:path');
const ENERGY=new Map([[2030500,5],[2030501,10],[2030502,20],[2030503,50]]);
function integer(v,min=0,max=2147483647){v=Number(v);if(!Number.isSafeInteger(v)||v<min||v>max)throw Error('Valor inteiro invalido: '+v);return v;}
let catalogue;
let canonicalFormatter = null;
function pets(){
 if(catalogue)return catalogue;
 const dir=path.resolve(__dirname,'../res/release/config');
 const files=fs.readdirSync(dir).filter(x=>/^t_s_pettemplate(?:-.*)?\.json$/i.test(x));
 if(files.length!==1)throw Error('Esperado um catalogo t_s_pettemplate; encontrados '+files.length);
 const rows=JSON.parse(fs.readFileSync(path.join(dir,files[0]),'utf8')).t_s_pettemplate;
 if(!Array.isArray(rows))throw Error('Catalogo de Silfos invalido');
 return catalogue=new Map(rows.map(r=>[Number(r.TemplateId),r]));
}
function kind(t){return Number(t?.MasterType)===4&&Number(t.SonType)===306?'sylph':ENERGY.has(Number(t?.TemplateId))?'energy':null;}
function listString(v){return Array.isArray(v)?v.join(','):String(v??'');}
function newPet(row,id,bind){
 const q=integer(row.Quality,1,9);
 const p={petId:id,templateId:integer(row.TemplateId,1),petName:String(row.TemplateName_pt||row.PetName_pt||row.TemplateName_en||row.TemplateName||'Silfo'),curGrade:1,curGp:0,totalGp:0,
 quality:(q-1)*5+1,initQuality:q,isFight:false,isDel:false,isBind:Boolean(bind),remainPoints:0,curQualityGp:0,
 followSkills:listString(row.FollowSkills),changeSkills:listString(row.ChangeSkills),chaSkillIndexs:'',remotePetSkillIndexs:'',fastKey:'',growthRate:integer(row.GrowthRate)};
 for(const [key,field,apt] of [['power','Power','PowerApt'],['intel','Intel','IntelApt'],['physi','Physi','PhysiApt'],['armor','Armor','ArmorApt']]){
  p[key]=integer(row[field]);
  if(!Array.isArray(row[apt])||row[apt].length!==2)throw Error('Aptidao ausente no catalogo: '+apt);
  p[key+'Apti']=integer(row[apt][0],1);
 }
 for(const field of ['FireResi','WaterResi','ElectResi','WindResi','DarkResi','LightResi'])p[field[0].toLowerCase()+field.slice(1)]=integer(row[field]??0);
 p.maxHp=Math.floor(6*p.physi*p.physiApti/1000)+integer(row.InitHp);
 p.fightingCapacity=Math.ceil(700+Math.floor(1.8*p.power*p.powerApti/1000)+Math.floor(1.8*p.intel*p.intelApti/1000)+Math.floor((.9*p.armor*p.armorApti+.9*p.power*p.powerApti)/1000)+Math.floor((.9*p.armor*p.armorApti+.9*p.intel*p.intelApti)/1000)+p.maxHp/5);
 p.itemEffectsVersion=3;
 return p;
}
function petMessage(saved,userId){
 if(canonicalFormatter) return canonicalFormatter(saved,userId,0);
 const ss=saved.sylphs||{};
 const list=(ss.list||[]).filter(p=>p&&!p.isDel).map(p=>({...p,petName:String(p.petName||''),followSkills:listString(p.followSkills),changeSkills:listString(p.changeSkills),chaSkillIndexs:listString(p.chaSkillIndexs),remotePetSkillIndexs:listString(p.remotePetSkillIndexs),fastKey:listString(p.fastKey)}));
 return {userId:integer(userId),petInfo:list,nickName:'',order:0,chaPos:listString(ss.chaPos),score:0,petCount:Math.max(list.length,Number(ss.maxCount)||0),op:0,fightIndex:listString(ss.fightIndex)};
}
function installFormatter(secondary){
 // Preserve the full R1-R5 formatter (including current aptitude-based BR).
 // Previously this file silently replaced it with a stale persisted BR snapshot.
 if(typeof secondary.formatPlayerPetMsg==='function'){
   canonicalFormatter=secondary.formatPlayerPetMsg;
 }else{
   secondary.formatPlayerPetMsg=(saved,userId,op=0)=>petMessage(saved,userId,op);
 }
}
function apply({saved,item,template,count,grade,petCatalogue,recoverEnergy,now=Date.now()}){
 count=integer(count,1,100);grade=integer(grade,1);const type=kind(template);
 if(!type)throw Error('Item fora do escopo deste modulo');
 if(Number(item.bagType)!==1||!saved.inventory?.items?.includes(item))throw Error('Item fora da mochila');
 if(Number(item.templateId)!==Number(template.TemplateId)||integer(item.count,1)<count)throw Error('Quantidade ou item invalido');
 if(grade<Number(template.NeedGrades||1))throw Error('Nivel insuficiente; item preservado');
 let pet,energy;
 if(type==='sylph'){
  if(count!==1)throw Error('Use um selo por vez');
  const row=(petCatalogue||pets()).get(Number(template.Property1));
  if(!row)throw Error('Silfo ausente do catalogo; selo preservado');
  const ss=saved.sylphs||{activePetId:0,list:[]};
  if(!Array.isArray(ss.list)||ss.list.filter(p=>!p.isDel).length>=120)throw Error('Lista de Silfos cheia ou invalida');
  const id=integer(Math.max(1000001,Number(ss.nextPetId)||0,...ss.list.map(p=>integer(p.petId,1)+1)),1,2147483646);
  pet=newPet(row,id,item.bind??item.isBind);
  ss.list.push(pet);ss.nextPetId=id+1;saved.sylphs=ss;
 }else{
  const unit=ENERGY.get(Number(template.TemplateId));
  if(Number(template.MasterType)!==2||Number(template.SonType)!==203||Number(template.Property1)!==5||Number(template.Property2)!==unit)throw Error('Regra de estamina diverge do catalogo');
  if(recoverEnergy)recoverEnergy(saved,now);
  const before=integer(typeof saved.energy==='number'?saved.energy:saved.energy?.value??0,0,200);
  if(before===200)throw Error('Estamina cheia (200/200); pocao preservada');
  if(count>Math.ceil((200-before)/unit))throw Error('Quantidade excede o necessario para encher a estamina; pocoes preservadas');
  const after=Math.min(200,before+unit*count);
  saved.energy={...(typeof saved.energy==='object'?saved.energy:{}),value:after,lastTickHour:Number(saved.energy?.lastTickHour)||Math.floor(now/3600000)};
  energy={before,after,granted:after-before};
 }
 const pos=item.pos;item.count-=count;
 if(!item.count)saved.inventory.items.splice(saved.inventory.items.indexOf(item),1);
 if(!saved.inventory.items.length)saved.inventory.explicitlyCleared=true;
 return {state:saved,changed:true,pet,energy,pos,remaining:item.count,templateId:Number(item.templateId),type};
}
async function handle(ctx){
 const {state,body,db,inventoryState,originalPb,itemTemplates,sendGameSession,makeBagMoveUpdate,log}=ctx;
 if(!state.gatewayId||!state.character||state.closed)return false;
 let req;
 try{req=originalPb.decode('item.ItemUseMsg',body);}catch(_){return false;}
 const initial=inventoryState.parseState(state.character.state_json);
 const selected=inventoryState.inventory(initial).items.find(i=>Number(i.pos)===Number(req.pos)&&Number(i.bagType)===Number(req.bagType??1));
 if(!selected||!kind(itemTemplates.get(Number(selected.templateId))))return false;
 let committed=false;
 try{
  const count=integer(req.count??1,1,100),pos=integer(req.pos),bagType=integer(req.bagType??1);
  if(bagType!==1)throw Error('Use o item da mochila');
  const result=await db.mutateCharacterState(state.gatewayId,(raw,locked={})=>{
   const saved=inventoryState.parseState(raw),bag=inventoryState.inventory(saved);
   const item=bag.items.find(i=>Number(i.pos)===pos&&Number(i.bagType)===bagType);
   if(!item||Number(item.templateId)!==Number(selected.templateId))throw Error('Item mudou de posicao; tente novamente');
   const out=apply({saved,item,template:itemTemplates.get(Number(item.templateId)),count,grade:locked.grade??state.character.grade,petCatalogue:ctx.petCatalogue,recoverEnergy:ctx.recoverEnergy});
   // Validate the actual protocol encoder BEFORE committing inventory or rewards.
   out.rewardWire=out.pet?originalPb.encode('pet.PlayerPetMsg',petMessage(saved,state.gatewayId)):originalPb.encode('player.PlayerMsg',{playerId:state.gatewayId,weary:out.energy.after,wearyLimit:200});
   return out;
  });
  committed=true;
  state.character=await db.characterById(state.gatewayId);
  if(!state.character)throw Error('Personagem ausente apos gravacao');
  const saved=inventoryState.parseState(state.character.state_json);
  const actual=inventoryState.inventory(saved).items.find(i=>Number(i.pos)===result.pos&&Number(i.bagType)===1);
  if(result.pet&&!(saved.sylphs?.list||[]).some(p=>p.petId===result.pet.petId))throw Error('Repositorio descartou o Silfo; verificar state_json');
  if(result.energy&&Number(saved.energy?.value)!==result.energy.after)throw Error('Repositorio descartou a estamina; verificar coluna energy');
  sendGameSession(state,result.pet?4540:3,result.rewardWire);
  sendGameSession(state,115,makeBagMoveUpdate([{bagType:1,objectId:0,ownerId:state.gatewayId,pos:result.pos,...(actual?{item:actual}:{})}]),state.gatewayId);
  if(result.pet && typeof ctx.syncHeroAfterSylph==='function')ctx.syncHeroAfterSylph();
  log(`[ITENS V3] ${result.templateId}: ${result.pet?'Silfo '+result.pet.templateId+' petId='+result.pet.petId:'estamina '+result.energy.before+' -> '+result.energy.after}; gravado e sincronizado.`);
 }catch(err){
  log(`[ITENS V3] ${committed?'EFEITO GRAVADO, FALHA DE SINCRONIZACAO (reentre; nao repetir consumo)':'RECUSADO, ITEM PRESERVADO'}: ${err.message}`);
 }
 return true;
}
module.exports={kind,newPet,petMessage,installFormatter,apply,handle};
