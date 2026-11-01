'use strict';
// Only actual learned skills with a matching property template affect permanent stats.
// AddType 0 is percent, 1 is flat. Never mix flat points into a percentage bucket.
const FIELDS=['Power','Agility','Intellect','Physique','Captain','Attack','Defence','MagicAttack',
 'MagicDefence','Live','Conat','ForceHit','Parry'];
const EMPTY=()=>Object.fromEntries(FIELDS.map(k=>[k,0]));
function collect(learned,propertyCatalog){
 const flat=EMPTY(),percent=EMPTY(),used=new Set();
 for(const item of learned||[]){
  const id=Number(typeof item==='object'&&item!==null?item.templateId:item);
  if(!Number.isSafeInteger(id)||used.has(id))continue;
  used.add(id);
  const row=propertyCatalog.get(id);
  if(!row)continue;
  const type=Number(row.AddType);
  if(type!==0&&type!==1)throw Error('Skill AddType invalido '+id);
  const output=type===0?percent:flat;
  for(const k of FIELDS){
   const n=Number(row[k]||0);
   if(!Number.isFinite(n))throw Error('Bonus invalido '+id+'/'+k);
   output[k]+=n;
  }
 }
 return {flat,percent};
}
function apply(base,key,bonuses){
 const total=Number(base)+bonuses.flat[key];
 const value=Math.floor(total*(1+bonuses.percent[key]/100));
 if(!Number.isSafeInteger(value)||value<0)throw Error('Atributo fora do limite: '+key);
 return value;
}
module.exports={collect,apply,FIELDS};
