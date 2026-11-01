'use strict';
// Wartune Ultra: uso de consumiveis com efeito validado ANTES da baixa na bolsa.
// Esta etapa suporta selos de Silfo, pacotes com tabela canonica de drops e pocao de estamina.
// Outros consumiveis sao recusados sem consumo ate existir um handler fiel.
const fs = require('node:fs');
const path = require('node:path');
const inv = require('./inventory-state');
const secondary = require('./secondary-systems-state');
const energyRules = require('./character-repository');

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
function apply({state,item,template,count,grade,dropGroups,templates,rng=Math.random,petCatalogue}) {
 const bag=inv.inventory(state);
 if(!bag.items.includes(item)||Number(item.bagType)!==1)throw Error('Item fora da mochila');
 whole(count,1,100);if(count>item.count)throw Error('Quantidade indisponivel');
 if(Number(grade)<Number(template.NeedGrades||1))throw Error('Nivel insuficiente; item preservado');
 const output=[], moved=[],master=Number(template.MasterType),son=Number(template.SonType);
 let sylph=null,energy=null,sylphXp=null;
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
 } else if(dropGroups && (dropGroups.has(Number(template.Property1)) || dropGroups.has(Number(template.TemplateId)))) {
   const dropId = dropGroups.has(Number(template.Property1)) ? Number(template.Property1) : Number(template.TemplateId);
   const rows=dropGroups.get(dropId)||[];
   if(!rows.length)throw Error('Pacote sem tabela de recompensa; item preservado');
   for(const drop of rows){
     const id=Number(drop.ItemId),amount=Number(drop.Data);
     if(!Number.isSafeInteger(id)||!Number.isSafeInteger(amount)||amount<1||amount>999999||!
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
         state.wallet ||= {gold:0,balens:0,boundBalens:0};
         if(id === -100) state.wallet.gold = whole(Number(state.wallet.gold || 0) + amount, 0, 2147483647);
         else if(id === -500) state.wallet.boundBalens = whole(Number(state.wallet.boundBalens || 0) + amount, 0, 2147483647);
         else if(id === -600) state.wallet.balens = whole(Number(state.wallet.balens || 0) + amount, 0, 2147483647);
         else if(id === -200) state.wallet.daru = whole(Number(state.wallet.daru || 0) + amount, 0, 2147483647);
         else if(id === -300) state.wallet.kyanite = whole(Number(state.wallet.kyanite || 0) + amount, 0, 2147483647);
         else state.wallet.gold = whole(Number(state.wallet.gold || 0) + amount, 0, 2147483647);
       } else {
         const result=inv.addItem(state,id,amount,key=>templates.get(key));
         output.push(...(result.items || [result.item]));
       }
     }
     if(useRandomPool && useRandomPool.length > 0){
       const row=randomOne(useRandomPool,rng),id=Number(row.ItemId),amount=Number(row.Data);
       if(id < 0){
         state.wallet ||= {gold:0,balens:0,boundBalens:0};
         if(id === -100) state.wallet.gold = whole(Number(state.wallet.gold || 0) + amount, 0, 2147483647);
         else if(id === -500) state.wallet.boundBalens = whole(Number(state.wallet.boundBalens || 0) + amount, 0, 2147483647);
         else if(id === -600) state.wallet.balens = whole(Number(state.wallet.balens || 0) + amount, 0, 2147483647);
         else if(id === -200) state.wallet.daru = whole(Number(state.wallet.daru || 0) + amount, 0, 2147483647);
         else if(id === -300) state.wallet.kyanite = whole(Number(state.wallet.kyanite || 0) + amount, 0, 2147483647);
         else state.wallet.gold = whole(Number(state.wallet.gold || 0) + amount, 0, 2147483647);
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
 } else if(Number(template.Property1) < 0) {
   // Itens de moedas diretas (Ouro, Balens, Daru, etc.)
   const curId = Number(template.Property1);
   const amount = (Number(template.Property2) || Number(template.Property3) || 1000) * count;
   state.wallet ||= {gold:0,balens:0,boundBalens:0};
   if(curId === -100) state.wallet.gold = whole(Number(state.wallet.gold || 0) + amount, 0, 2147483647);
   else if(curId === -500) state.wallet.boundBalens = whole(Number(state.wallet.boundBalens || 0) + amount, 0, 2147483647);
   else if(curId === -600) state.wallet.balens = whole(Number(state.wallet.balens || 0) + amount, 0, 2147483647);
   else if(curId === -200) state.wallet.daru = whole(Number(state.wallet.daru || 0) + amount, 0, 2147483647);
   else if(curId === -300) state.wallet.kyanite = whole(Number(state.wallet.kyanite || 0) + amount, 0, 2147483647);
   else state.wallet.gold = whole(Number(state.wallet.gold || 0) + amount, 0, 2147483647);
 } else if(master===2&&son===201) {
   const buffId = Number(template.Property1) || 0;
   const durationMin = (Number(template.Property2) || 60) * count;
   const value = Number(template.Property3) || 0;
   state.buffs = Array.isArray(state.buffs) ? state.buffs : [];
   const now = Date.now();
   const existing = state.buffs.find(b => Number(b.buffId) === buffId);
   if (existing) {
     existing.expireAt = Math.max(Number(existing.expireAt) || now, now) + durationMin * 60000;
     existing.value = Math.max(Number(existing.value) || 0, value);
   } else {
     state.buffs.push({ buffId, templateId: Number(template.TemplateId), value, expireAt: now + durationMin * 60000 });
   }
 } else if(master===2) {
   // Demais consumíveis de MasterType 2 (pergaminhos, itens de efeito direto)
   state.buffs = Array.isArray(state.buffs) ? state.buffs : [];
   state.buffs.push({ buffId: Number(template.Property1) || Number(template.TemplateId), templateId: Number(template.TemplateId), value: Number(template.Property2) || 1, expireAt: Date.now() + 3600000 * count });
 } else {
  throw Error(`Efeito de item ${template.TemplateId} [${master}/${son}] ainda nao implementado; item PRESERVADO`);
 }
 const position=item.pos;item.count-=count;
 if(item.count===0){bag.items.splice(bag.items.indexOf(item),1);moved.push({bagType:1,objectId:0,pos:position});}
 else moved.push({bagType:1,objectId:0,pos:position,item});
 for(const result of output)moved.push({bagType:result.bagType,objectId:0,pos:result.pos,item:result});
 return {state,moved,isSylph:Boolean(sylph),isSylphXp:Boolean(sylphXp),sylphXp,sylph,energy,output,appliedType:sylphXp?'sylph-xp':sylph?'sylph':energy?'stamina':'package'};
}
module.exports={apply,grantSylph,randomOne,loadPetTemplates};
