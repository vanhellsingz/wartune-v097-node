'use strict';
// Wartune Ultra: uso de consumiveis com efeito validado ANTES da baixa na bolsa.
// Esta etapa suporta selos de Silfo, pacotes com tabela canonica de drops e pocao de estamina.
// Outros consumiveis sao recusados sem consumo ate existir um handler fiel.
const fs = require('node:fs');
const path = require('node:path');
const inv = require('./inventory-state');
const secondary = require('./secondary-systems-state');
const energyRules = require('./character-repository');
const avatarFrames = require('./avatar-frame-state');

function loadPetTemplates() {
  const dir=path.resolve(__dirname,'../res/release/config');
  const file=fs.readdirSync(dir).find(name=>/^t_s_pettemplate-.*\.json$/i.test(name));
  if(!file) return new Map();
  const entries=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8')).t_s_pettemplate;
  if(!Array.isArray(entries))throw Error('Catalogo de pets invalido');
  return new Map(entries.map(x=>[Number(x.TemplateId),x]));
}
let petCache;
function petTemplates(){return petCache??=loadPetTemplates();}
function whole(value,min=0,max=Number.MAX_SAFE_INTEGER){const v=Number(value);if(!Number.isSafeInteger(v)||v<min||v>max)throw Error('Numero inteiro invalido');return v;}
function pickField(row,names,fallback){for(const n of names){const v=Number(row?.[n]);if(Number.isFinite(v)&&v>0)return Math.trunc(v);}return fallback;}
function petLabel(row,seal) {
 const raw=row.PetName_pt||row.PetName_en||row.TemplateName_pt||row.TemplateName_en||row.Name_pt||row.Name_en||row.PetName||'';
 if(String(raw).trim())return String(raw).trim().slice(0,48);
 return String(seal.TemplateName_pt||seal.TemplateName_en||'Silfo').replace(/^(Selo de |Selo do |Common |Uncommon |Rare |Epic |Legendary )/i,'').replace(/\s+(Comum|Incomum|Raro|Épico|Lendário)$/i,'').slice(0,48);
}
function grantSylph(state, template, count, petCatalogue=petTemplates()) {
 if(Number(template.MasterType)!==4||Number(template.SonType)!==306)throw Error('Item nao e selo de Silfo');
 if(count!==1)throw Error('Ative apenas um selo de Silfo por vez');
 const petTemplateId=whole(template.Property1,1);
 let petTemplate=null;
 if (petCatalogue instanceof Map) {
   petTemplate = petCatalogue.get(petTemplateId);
 } else if (Array.isArray(petCatalogue)) {
   petTemplate = petCatalogue.find(p => Number(p.TemplateId) === petTemplateId);
 } else if (petCatalogue && typeof petCatalogue === 'object') {
   petTemplate = petCatalogue[petTemplateId] || (typeof petCatalogue.get === 'function' ? petCatalogue.get(petTemplateId) : null);
 }
 if(!petTemplate)throw Error(`Silfo ${petTemplateId} ausente do t_s_pettemplate; selo preservado`);
 secondary.ensureSecondarySystemsState(state);
 const list=state.sylphs.list;
 if(!Array.isArray(list)||list.length>=120)throw Error('Limite de Silfos ou lista invalida; selo preservado');
 const ids=list.map(p=>Number(p.petId)).filter(Number.isSafeInteger);
 const next=whole(Math.max(1000000,whole(state.sylphs.nextPetId||1000001,1),...ids.map(x=>x+1)),1,2147483647);
 state.sylphs.nextPetId=next+1;
 const pet={
   petId:next, templateId:petTemplateId,petName:petLabel(petTemplate,template),
   curGrade:pickField(petTemplate,['InitGrade','InitialGrade','Grade'],1),
   quality:pickField(petTemplate,['Quality','InitialQuality'],1),
   power:pickField(petTemplate,['Power','InitPower','BasePower'],35),
   intel:pickField(petTemplate,['Intellect','Intel','InitIntellect'],15),
   physi:pickField(petTemplate,['Physique','Physi','InitPhysique'],30),
   armor:pickField(petTemplate,['Armor','Defence','InitArmor'],25),
   maxHp:pickField(petTemplate,['MaxHp','MaxHP','Hp','HP','Live'],600),
   fightingCapacity:pickField(petTemplate,['FightingCapacity','FightCapacity','BattleRating'],1250),
   isFight:false,isDel:false,curGp:0,totalGp:0
 };
 list.push(pet);
 return pet;
}
function randomOne(rows,rng=Math.random) {
 const valid=rows.map(row=>({...row,weight:Number(row.Random)})).filter(r=>Number.isFinite(r.weight)&&r.weight>0);
 if(!valid.length)throw Error('DropId sem probabilidades validas');
 const total=valid.reduce((sum,r)=>sum+r.weight,0);
 let dice=rng()*total;
 if(!Number.isFinite(dice)||dice<0||dice>=total)throw Error('Gerador de sorteio invalido');
 for(const row of valid){dice-=row.weight;if(dice<0)return row;}
 return valid.at(-1);
}
const CURRENCY_FIELDS = Object.freeze({
  '-100':'gold', '-400':'balens', '-500':'boundBalens',
  '-200':'amethyst', '-700':'experience', '-800':'gloryCrystal',
  '-910':'sylphSoulCrystal', '-1000':'jewelShard',
  '-1400':'fangOfFear', '-5500':'vipExperience',
  '-6200':'developmentPoint', '-6400':'guardMilitaryExploit'
});
function grantCurrency(state,id,amount,grade) {
 const key=CURRENCY_FIELDS[id];
 if(!key || key==='vipExperience')
   throw Error(`Moeda/recompensa ${id} sem progressao validada; bau preservado`);
 if(key==='experience') {
   const rules=require('./resource-state');
   const before=whole(Number(state.progression?.totalXp ?? state.experience ?? 0),0,2147483647);
   const total=whole(before+amount,0,2147483647);
   const nextGrade=rules.calcGradeFromXp(total,whole(grade,1));
   state.progression={...(state.progression||{}),totalXp:total,
     currentXp:Math.max(0,total-rules.totalAtLevel(nextGrade))};
   state.experience=total;state.grade=nextGrade;
   return;
 }
 state.wallet ||= {};
 state.wallet[key]=whole(Number(state.wallet[key]||0)+amount,0,2147483647);
}
function activeBuffValue(state, propertyId, now=Date.now()) {
 const buffs=Array.isArray(state?.buffs)?state.buffs:[];
 return buffs.filter(b=>Number(b.propertyId??b.buffId)===Number(propertyId)&&Number(b.expireAt)>now)
   .reduce((value,b)=>Math.max(value,Number(b.value)||0),0);
}
function applyCatalogBuff(state,template,count) {
 const propertyId=whole(Number(template.Property1),1,99999);
 const durationMin=whole(Number(template.Property2),1,525600)*count;
 const value=whole(Number(template.Property3),0,1000000);
 const extra=whole(Number(template.Property4)||0,0,1000000);
 const now=Date.now();
 state.buffs=(Array.isArray(state.buffs)?state.buffs:[]).filter(b=>Number(b.expireAt)>now);
 const same=state.buffs.find(b=>Number(b.propertyId??b.buffId)===propertyId&&Number(b.extra||0)===extra);
 if(same){
   same.expireAt=Math.max(Number(same.expireAt)||now,now)+durationMin*60000;
   same.value=Math.max(Number(same.value)||0,value);
   same.templateId=Number(template.TemplateId);
 } else {
   state.buffs.push({propertyId,buffId:propertyId,templateId:Number(template.TemplateId),extra,value,expireAt:now+durationMin*60000});
 }
 return {propertyId,value,durationMin,expireAt:same?.expireAt||now+durationMin*60000,extra};
}
function apply({state,item,template,count,grade,dropGroups,templates,rng=Math.random,petCatalogue}) {
 const bag=inv.inventory(state);
 if(!bag.items.includes(item)||Number(item.bagType)!==1)throw Error('Item fora da mochila');
 whole(count,1,100);if(count>item.count)throw Error('Quantidade indisponivel');
 if(Number(grade)<Number(template.NeedGrades||1))throw Error('Nivel insuficiente; item preservado');
 const output=[], moved=[],master=Number(template.MasterType),son=Number(template.SonType);
 let sylph=null,energy=null,sylphXp=null,frame=null;
 // Pergaminhos oficiais de XP de Silfo, sob protocolo de uso item.ItemUseMsg.
 // Aplica apenas ao Silfo de combate explicitamente selecionado no estado.
 if([2032001,2032002].includes(Number(template.TemplateId))){
   const id=Number(template.TemplateId);
   const xp=id===2032001?500000:100000;
   if(master!==2||son!==208||Number(template.Property1)!==15||Number(template.Property2)!==xp)
     throw Error('Catalogo de Pergaminho de Silfo divergente; item preservado');
   secondary.ensureSecondarySystemsState(state);
   const pets=state.sylphs.list||[];
   const active=pets.filter(p=>!p.isDel&&(p.isFight||Number(p.petId)===Number(state.sylphs.activePetId)));
   if(active.length!==1)throw Error('Selecione um unico Silfo ativo antes de usar o pergaminho; item preservado');
   const rules=require('./progression-rules');
   const target=active[0];
   sylphXp=rules.advanceSylphExperience(target,xp*count,{playerLevel:Number(grade)});
   sylph=target;
 } else if(master===4&&son===306){
   sylph=grantSylph(state,template,count,petCatalogue||petTemplates());
 } else if(master===2&&son===223){
   if(count!==1)throw Error('Ative uma moldura por vez');
   frame=avatarFrames.activate(state,template);
 } else if(master===2 && [206,207].includes(son) && dropGroups && (dropGroups.has(Number(template.Property1)) || dropGroups.has(Number(template.TemplateId)))) {
   const dropId = dropGroups.has(Number(template.Property1)) ? Number(template.Property1) : Number(template.TemplateId);
   const rows=dropGroups.get(dropId)||[];
   if(!rows.length)throw Error('Pacote sem tabela de recompensa; item preservado');
   for(const drop of rows){
     const id=Number(drop.ItemId),amount=Number(drop.Data);
     if(!Number.isSafeInteger(id)||!Number.isSafeInteger(amount)||amount<1||amount>(id<0?2147483647:999999)||!
       (id<0||(id>0&&templates.has(id))))
       throw Error('Pacote com recompensa desconhecida; preservado integralmente');
   }
   const guaranteed = rows.filter(r => Number(r.AppearType) === 1);
   const randomPool = rows.filter(r => Number(r.AppearType) !== 1);
   const useRandomPool = randomPool.length > 0 ? randomPool : (guaranteed.length === 0 ? rows : null);
   for(let i=0;i<count;i++){
     for(const gRow of guaranteed){
       const id=Number(gRow.ItemId),amount=Number(gRow.Data);
     if(id < 0){
         grantCurrency(state,id,amount,grade);
       } else {
         const result=inv.addItem(state,id,amount,key=>templates.get(key));
         output.push(...(result.items || [result.item]));
       }
     }
     if(useRandomPool && useRandomPool.length > 0){
       const row=randomOne(useRandomPool,rng),id=Number(row.ItemId),amount=Number(row.Data);
       if(id < 0){
         grantCurrency(state,id,amount,grade);
       } else {
         const result=inv.addItem(state,id,amount,key=>templates.get(key));
         output.push(...(result.items || [result.item]));
       }
     }
   }
 } else if(master===2&&son===203) {
   try { energy=energyRules.grantPotionEnergy(state,template,count); } catch(_) {}
   const val = (Number(template.Property2) || Number(template.Property1) || 10) * count;
   if(!energy) {
     const cur = typeof state.energy === 'object' ? Number(state.energy?.value || 0) : Number(state.energy || 0);
     const after = Math.min(200, cur + val);
     state.energy = { value: after, lastTickHour: Math.floor(Date.now() / 3600000) };
     energy = { before: cur, after, granted: after - cur };
   }
   const curOuter = Number(state.outerEnergy ?? 200);
   const afterOuter = Math.min(200, curOuter + val);
   state.outerEnergy = afterOuter;
   if (energy) energy.outerEnergy = afterOuter;
 } else if(master===2 && Number(template.Property1) < 0) {
   // Itens de moedas diretas (Ouro, Balens, Daru, etc.)
   const curId = Number(template.Property1);
   const amount = (Number(template.Property2) || Number(template.Property3) || 1000) * count;
   state.wallet ||= {gold:0,balens:0,boundBalens:0};
   grantCurrency(state,curId,amount,grade);
 } else if(master===2&&son===201) {
   applyCatalogBuff(state,template,count);
 } else {
  throw Error(`Efeito de item ${template.TemplateId} [${master}/${son}] ainda nao implementado; item PRESERVADO`);
 }
 const position=item.pos;item.count-=count;
 if(item.count===0){bag.items.splice(bag.items.indexOf(item),1);moved.push({bagType:1,objectId:0,pos:position});}
 else moved.push({bagType:1,objectId:0,pos:position,item});
 for(const result of output)moved.push({bagType:result.bagType,objectId:0,pos:result.pos,item:result});
 return {state,moved,isSylph:Boolean(sylph),isSylphXp:Boolean(sylphXp),sylphXp,sylph,energy,frame,output,appliedType:frame?'avatar-frame':sylphXp?'sylph-xp':sylph?'sylph':energy?'stamina':'package'};
}
module.exports={apply,grantSylph,randomOne,loadPetTemplates,activeBuffValue,applyCatalogBuff};
