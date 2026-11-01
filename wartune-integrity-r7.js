'use strict';
// R7: pure catalog-backed helpers. Never saves/migrates a character while reading.
const fs=require('node:fs'),path=require('node:path');
const FIELDS=[null,'Power','Agility','Intellect','Physique','Captain','Attack','Defence','MagicAttack','MagicDefence','Live','Conat','ForceHit','Parry','FireResi','WaterResi','WindResi','ElectResi','DarkResi','LightResi','ReduceResi',null,null,'DefensePenetration','CriticalResistance','ParryPenetration'];
const number=(v,fallback=0)=>{const n=Number(v??fallback);if(!Number.isFinite(n)||n<0)throw Error('R7 atributo invalido: '+v);return n;};
const cache=new Map();
function catalog(key){
 if(cache.has(key))return cache.get(key);
 const dir=path.resolve(__dirname,'../res/release/config');
 const names=fs.readdirSync(dir).filter(n=>n===key+'.json'||n.startsWith(key+'-')&&n.endsWith('.json'));
 if(names.length!==1)throw Error('R7 catalogo ausente/ambiguo: '+key);
 const rows=JSON.parse(fs.readFileSync(path.join(dir,names[0]),'utf8'))[key];
 if(!Array.isArray(rows)||!rows.length)throw Error('R7 catalogo vazio: '+key);
 cache.set(key,rows);return rows;
}
function pairs(raw){
 const out={};
 if(raw==null||raw==='')return out;
 for(const part of String(raw).split('|')){
  const [id,v]=part.split(',').map(Number);
  if(!Number.isInteger(id)||!Number.isFinite(v))throw Error('R7 atributo de catalogo invalido: '+part);
  out[id]=(out[id]||0)+v;
 }
 return out;
}
function guardianAttributes(saved,upgrades=catalog('t_s_combatguardianupgrade'),stars=catalog('t_s_combatguardianstar')){
 const out={},seen=new Set();
 for(const g of saved.combatGuardians?.guardians||[]){
  if(!g||g.isDel)continue;
  const id=Number(g.templateId);if(seen.has(id))continue;seen.add(id);
  const u=upgrades.find(r=>Number(r.GuardianID)===id&&Number(r.Level)===Number(g.level));
  const s=stars.find(r=>Number(r.GuardianID)===id&&Number(r.StarLevel)===Number(g.star??0));
  if(!u||!s)throw Error('R7 guardiao sem nivel/estrela no catalogo: '+id);
  const level=pairs(u.Attribute),star=pairs(s.Attribute);
  // kZ.getAllAdd: scale level values when the same attribute appears in star data.
  for(const [k,v] of Object.entries(level)){
   out[k]=(out[k]||0)+(Object.hasOwn(star,k)?Math.ceil(v*(10000+number(s.AllAttribute))/10000)+star[k]:v);
   delete star[k];
  }
  for(const [k,v] of Object.entries(star))out[k]=(out[k]||0)+v;
 }
 return out;
}
function equipment(saved){
 const bag=saved.inventory??saved.bag??{},ids=new Set(),slots=new Set(),out=[];
 for(const item of bag.items||[]){
  if(!item||Number(item.bagType)!==4||Number(item.count??1)<=0)continue;
  const id=item.instanceId??item.itemId,slot=Number(item.pos);
  if(bag.equipment&&Object.keys(bag.equipment).length&&Number(bag.equipment[String(slot)])!==Number(id))continue;
  if(id!=null&&ids.has(String(id)))continue;
  if(Number.isInteger(slot)&&slots.has(slot))throw Error('R7 dois equipamentos no mesmo slot: '+slot);
  if(id!=null)ids.add(String(id));if(Number.isInteger(slot))slots.add(slot);out.push(item);
 }
 return out;
}
function ownedMounts(saved,now=Date.now()){
 // Same identity as the client Zp._data[templateId]: one contribution per mount.
 const byId=new Map();for(const m of saved.mounts?.avatarInfo||[])if(m)byId.set(Number(m.mountTempId),m);
 return [...byId.values()].filter(m=>{
  if(!(m.isExist===true||m.isExist===1))return false;
  const raw=m.expairDate??m.expireDate;
  if(!raw||String(raw).startsWith('2000-'))return true; // client permanent-date sentinel
  const ms=Date.parse(String(raw).replace(' ','T'));return Number.isFinite(ms)&&ms>now;
 });
}
function equipmentValue(item,template,key,equipRows){
 const base=number(template[key]),grade=number(item.strengthenGrade),mould=number(item.mouldGrade);
 if(Number(template.Property6)===1){
  const row=(equipRows||catalog('t_s_equip_attr')).find(r=>Number(r.ItemId)===Number(template.TemplateId));
  if(!row&&(grade||mould))throw Error('R7 equipamento avancado sem catalogo: '+template.TemplateId);
  const id=FIELDS.indexOf(key);
  return base+grade*number(pairs(row?.StrengthenValue)[id])+mould*number(pairs(row?.GodforgeValue)[id]);
 }
 // Client getCurr and Jo.getMouldAddition. Do not strengthen zero properties.
 if(!base)return 0;
 const forge=mould<=80?Math.floor(base*mould*.3):mould<=160?
  Math.ceil(base*80*.3)+Math.ceil(base*(mould-80)*.4):
  Math.ceil(base*80*.3)+Math.ceil(base*80*.4)+Math.ceil(base*(mould-160)*.25);
 return base+Math.floor(base*grade*.1+5*grade)+forge;
}
function normalizePet(pet,template,templates){
 if(!template)throw Error('R7 template de Silfo ausente: '+pet.templateId);
 const p={...pet},q=number(p.quality,(number(template.Quality,1)-1)*5+1),grade=number(p.curGrade,1);
 const first=templates.get(Number(template.TemplateId)+Math.floor((q-1)/5)+1-Number(template.Quality));
 if(!first)throw Error('R7 qualidade de Silfo sem catalogo: '+q);
 const next=templates.get(Number(first.TemplateId)+1),fraction=(q-1)%5;
 const interp=(key,index)=>{
  const a=number(index==null?first[key]:first[key]?.[index]);
  if(!next||Number(next.PetType)!==Number(first.PetType))return a;
  const b=number(index==null?next[key]:next[key]?.[index]);return a+Math.floor((b-a)/5)*fraction;
 };
 p.quality=q;p.curGrade=grade;p.growthRate=interp('GrowthRate');
 for(const [key,field,apt] of [['power','Power','PowerApt'],['intel','Intel','IntelApt'],['physi','Physi','PhysiApt'],['armor','Armor','ArmorApt']]){
  // Legacy pets can retain the level-1 base even after curGrade increased.
  // Values above the level floor include allocated points and must be preserved.
  const base=number(template[field]),levelFloor=base+Math.floor((grade-1)*p.growthRate/80);
  const stored=number(p[key],base);
  p[key]=stored>=levelFloor?stored:levelFloor+Math.max(0,stored-base);
  p[key+'Apti']=number(p[key+'Apti'],interp(apt,0));
 }
 const d=require('./wartune-combat-math').sylphDerived(p,template);
 p.maxHp=d.hp;p.fightingCapacity=d.fightingCapacity;return p;
}
module.exports={FIELDS,number,catalog,pairs,guardianAttributes,equipment,ownedMounts,equipmentValue,normalizePet};
