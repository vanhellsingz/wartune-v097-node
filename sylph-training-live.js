'use strict';
/**
 * Wartune Ultra local — Sylph training bridge.
 * Sources: client bundle (quality interpolation, packet operations 4 and 7),
 * t_s_upgradetemplate (Types 27/29/107/108), t_s_pettemplate, item IDs from client.
 * COMPATIBILITY POLICY, not verified server-side original RNG:
 * 1 Mahra => 1 growth progress point; 1 Sepulcrum => 1 random aptitude point.
 * Never charges balens, never silently substitutes materials.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const MATERIAL=Object.freeze({4:208023,7:3040001});
const STAGES=Object.freeze({1:{type:27,max:21},2:{type:29,max:21},3:{type:107,max:31},4:{type:108,max:36}});
const APT=Object.freeze([
 ['powerApti','PowerApt'],['armorApti','ArmorApt'],['intelApti','IntelApt'],['physiApti','PhysiApt']
]);
let catalogCache;
function whole(value,min,max,label){
 if(!Number.isSafeInteger(value)||value<min||value>max)throw Error(label+' invalido: '+value);
 return value;
}
function loadCatalogs(){
 if(catalogCache)return catalogCache;
 const dir=path.resolve(__dirname,'../res/release/config');
 const matches=(key)=>fs.readdirSync(dir).filter(n=>new RegExp('^'+key+'(?:-.*)?\\.json$','i').test(n));
 const load=(key)=>{
  const names=matches(key);
  if(names.length!==1)throw Error('Catalogo '+key+': esperado exatamente 1 arquivo; encontrados '+names.length);
  const rows=JSON.parse(fs.readFileSync(path.join(dir,names[0]),'utf8'))[key];
  if(!Array.isArray(rows)||!rows.length)throw Error('Catalogo '+key+' vazio/invalido');
  return rows;
 };
 const pets=new Map(load('t_s_pettemplate').map(r=>[Number(r.TemplateId),r]));
 const grades=new Map();
 for(const row of load('t_s_upgradetemplate')){
  const stage=Object.values(STAGES).find(s=>s.type===Number(row.Types));
  if(!stage)continue;
  const id=Number(row.Types)+':'+Number(row.Grades);
  if(grades.has(id))throw Error('Progressao Sylph duplicada: '+id);
  grades.set(id,Number(row.Data));
 }
 for(const s of Object.values(STAGES))for(let q=1;q<=s.max;q++)if(!Number.isSafeInteger(grades.get(s.type+':'+q))||grades.get(s.type+':'+q)<0)throw Error('Progressao ausente: '+s.type+'/'+q);
 return catalogCache={pets,grades};
}
/** Mirrors Fy.calculateCoeLimit / data interpolation in the original LayaAir bundle.
 * The modern JSON field [minimum,maximum] corresponds to Init*CoeLimitMin, Init*CoeLimit.
 */
function interpolate(base, quality, source, catalogs){
 const first=Number(base.Quality),offset=Math.floor((quality-1)/5),position=(quality-1)%5;
 const firstRow=catalogs.pets.get(Number(base.TemplateId)+offset+1-first);
 if(!firstRow)throw Error('Modelo base de qualidade ausente: '+base.TemplateId+'/'+quality);
 const secondRow=catalogs.pets.get(Number(firstRow.TemplateId)+1);
 if(!Array.isArray(firstRow[source])||firstRow[source].length!==2)throw Error('Aptidao base ausente: '+source);
 const output=[0,1].map(index=>{
  const from=Number(firstRow[source][index]);
  if(!Number.isSafeInteger(from)||from<0)throw Error('Limite de aptidao invalido: '+source);
  if(!secondRow || Number(secondRow.PetType)!==Number(firstRow.PetType))return from;
  const to=Number(secondRow[source]?.[index]);
  if(!Number.isSafeInteger(to)||to<from)throw Error('Evolucao de aptidao invalida: '+source);
  return from+Math.floor((to-from)/5)*position;
 });
 return output;
}
function growthAt(base,q,cat){
 const initial=Number(base.Quality),model=cat.pets.get(Number(base.TemplateId)+Math.floor((q-1)/5)+1-initial);
 if(!model)throw Error('Modelo de crescimento inexistente');
 const second=cat.pets.get(Number(model.TemplateId)+1);
 const start=whole(Number(model.GrowthRate),0,1000000,'GrowthRate');
 if(!second||Number(second.PetType)!==Number(model.PetType))return start;
 const end=whole(Number(second.GrowthRate),start,1000000,'GrowthRate seguinte');
 return start+Math.floor((end-start)/5)*((q-1)%5);
}
function currentCap(base,q,src,cat){return interpolate(base,q,src,cat)[1];}
function computedPower(pet,base){
 const power=Number(pet.power??base.Power),intel=Number(pet.intel??base.Intel),armor=Number(pet.armor??base.Armor),physi=Number(pet.physi??base.Physi);
 const a=Number(pet.powerApti||0),b=Number(pet.intelApti||0),c=Number(pet.armorApti||0),d=Number(pet.physiApti||0);
 return Math.ceil(700+Math.floor(1.8*power*a/1000)+Math.floor(1.8*intel*b/1000)+Math.floor((.9*armor*c+.9*power*a)/1000)+Math.floor((.9*armor*c+.9*intel*b)/1000)+(Number(base.InitHp||0)+Math.floor(6*physi*d/1000))/5);
}
function consumeExactItems(state,templateId,count,itemPos){
 const bag=state.inventory;
 if(!bag||!Array.isArray(bag.items))throw Error('Inventario ausente');
 const restrict=Number(itemPos);
 if(![0,1,2].includes(restrict))throw Error('Preferencia de material invalida; item preservado');
 const stacks=bag.items.filter(item=>Number(item.bagType)===1&&Number(item.templateId)===templateId&&Number.isSafeInteger(item.count)&&item.count>0
  &&(restrict===0||(restrict===1?Boolean(item.bind??item.isBind):!Boolean(item.bind??item.isBind))));
 if(stacks.reduce((sum,p)=>sum+p.count,0)<count)throw Error('Materiais insuficientes: '+templateId+' precisa '+count);
 // No write until availability has been checked for ALL stacks.
 const moved=[];let left=count;
 for(const item of stacks){
  if(!left)break;
  const used=Math.min(item.count,left);left-=used;item.count-=used;
  if(item.count===0)bag.items.splice(bag.items.indexOf(item),1);
  moved.push({bagType:1,objectId:0,pos:Number(item.pos),...(item.count>0?{item}:{}),spent:used});
 }
 if(bag.items.length===0)bag.explicitlyCleared=true; // Required by character-repository's safe delete guard.
 return moved;
}
function apply({saved,opType,petId,value,itemPos=0,catalogs,rng}){
 const op=whole(Number(opType),4,7,'Operacao');
 if(op!==4&&op!==7)throw Error('Operacao fora do escopo');
 const quantity=whole(Number(value),1,1000,'Quantidade');
 const id=whole(Number(petId),1,2147483647,'Pet ID');
 const cat=catalogs||loadCatalogs();
 const pet=saved.sylphs?.list?.find(p=>p&&!p.isDel&&Number(p.petId)===id);
 if(!pet)throw Error('Silfo nao encontrado');
 const base=cat.pets.get(Number(pet.templateId));
 if(!base)throw Error('Modelo de Silfo ausente: '+pet.templateId);
 const q=whole(Number(pet.quality),1,36,'Qualidade');
 const stage=STAGES[Number(base.Property2)];
 if(!stage)throw Error('Etapa do Silfo sem regras disponiveis');
 if(q>stage.max)throw Error('Qualidade incompatível com a etapa do modelo');
 const before={growth:growthAt(base,q,cat),quality:q,curQualityGp:Number(pet.curQualityGp||0),fightingCapacity:Number(pet.fightingCapacity||0),aptitudes:Object.fromEntries(APT.map(([key])=>[key,Number(pet[key]||0)]))};
 for(const [key,field] of APT){
  const value=Number(pet[key]??0);
  if(!Number.isSafeInteger(value)||value<0||value>currentCap(base,q,field,cat))throw Error('Aptidao atual corrompida: '+key);
 }
 let upgrades=0, progressBefore=0, progressAfter=0, enchantPoints={};
 if(op===4){
  if(q>=stage.max)throw Error('Crescimento atingiu o nivel maximo; Mahra preservado');
  let gp=whole(Number(pet.curQualityGp??0),0,1e9,'Progressao de qualidade');
  progressBefore=gp;
  gp+=quantity;
  let next=q;
  while(next<stage.max){
   const need=cat.grades.get(stage.type+':'+(next+1));
   if(!Number.isSafeInteger(need)||need<=0)throw Error('Custo de etapa invalido');
   if(gp<need)break;
   gp-=need;
   const from=next;next++;
   const modelIndex=Number(base.TemplateId)+Math.floor((next-1)/5)+1-Number(base.Quality);
   const nextModel=cat.pets.get(modelIndex);
   if(!nextModel||Number(nextModel.PetType)!==Number(base.PetType))throw Error('Modelo destino da evolucao nao existe');
   for(const [key,field] of APT){
    const oldMin=interpolate(base,from,field,cat)[0];
    const newMin=interpolate(base,next,field,cat)[0];
    pet[key]=Number(pet[key]||0)+Math.max(0,newMin-oldMin);
    if(pet[key]>currentCap(base,next,field,cat))pet[key]=currentCap(base,next,field,cat);
   }
   upgrades++;
  }
  if(next>=stage.max && gp>0)throw Error('Quantidade de Mahra excede o ultimo nivel de qualidade; reduza a quantidade');
  pet.quality=next;
  pet.curQualityGp=next>=stage.max?0:gp;
  pet.totalQualityGp=whole(Number(pet.totalQualityGp||0)+quantity,0,Number.MAX_SAFE_INTEGER,'Total de progresso');
  pet.growthRate=growthAt(base,next,cat);
  progressAfter=pet.curQualityGp;
 }else{
  const available=APT.reduce((acc,[key,field])=>acc+currentCap(base,q,field,cat)-Number(pet[key]||0),0);
  if(available<quantity)throw Error('Aptidoes perto do limite: reduza quantidade; Sepulcrum preservado');
  enchantPoints=Object.fromEntries(APT.map(([key])=>[key,0]));
  const sample=typeof rng==='function'?rng:()=>crypto.randomInt(0,0x100000)/0x100000;
  for(let step=0;step<quantity;step++){
   const open=APT.filter(([key,field])=>Number(pet[key]||0)<currentCap(base,q,field,cat));
   if(!open.length)throw Error('Todas as aptidoes atingiram limite');
   const r=sample();
   if(!(r>=0&&r<1))throw Error('Sorteio fora do intervalo');
   const [key]=open[Math.floor(r*open.length)];
   pet[key]=Number(pet[key]||0)+1;enchantPoints[key]++;
  }
 }
 // Preserve allocated points, adjusting only the quality-driven level growth.
 const level=whole(Number(pet.curGrade??1),1,160,'Nivel do Silfo');
 const growth=growthAt(base,Number(pet.quality),cat);
 const delta=Math.floor((level-1)*growth/80)-Math.floor((level-1)*before.growth/80);
 for(const [key,field] of [['power','Power'],['intel','Intel'],['physi','Physi'],['armor','Armor']])
   pet[key]=Number(pet[key]??base[field])+delta;
 const normalized=require('./wartune-integrity-r7').normalizePet(pet,base,cat.pets);
 pet.growthRate=growth;pet.fightingCapacity=normalized.fightingCapacity;pet.maxHp=normalized.maxHp;
 const moved=consumeExactItems(saved,MATERIAL[op],quantity,itemPos);
 return {state:saved,petId:id,opType:op,materialId:MATERIAL[op],spent:quantity,moved,upgrades,progressBefore,progressAfter,
  qualityBefore:before.quality,qualityAfter:Number(pet.quality),enchantPoints,powerBefore:before.fightingCapacity,powerAfter:pet.fightingCapacity};
}
module.exports={apply,loadCatalogs,interpolate,growthAt,MATERIAL,STAGES};
