'use strict';
/**
 * Client-referenced formulas from bundle_release-ad60bfe795.js:
 * Fy.calculatefightPower, Fy.hp/physicalAttack/magicAttack/defense getters,
 * Xo.calculatePlayerFightCapacity, Xo.calculateGuardFightCapacity.
 * Pure functions; do not silently replace the existing attribute-calculator.
 */
const ATTR_KEYS = Object.freeze([
  'Power','Agility','Intellect','Physique','Captain','Attack','Defence',
  'MagicAttack','MagicDefence','Live','Conat','ForceHit','Parry',
  'FireResi','WaterResi','WindResi','ElectResi','DarkResi','LightResi',
  'ReduceResi','DefensePenetration','CriticalResistance','ParryPenetration'
]);
const val=(obj,key,fallback=0)=>{
  const raw=obj?.[key];
  const n=Number(raw === undefined || raw === null || raw === '' ? fallback : raw);
  if(!Number.isFinite(n)) throw new Error('Atributo inválido: '+key);
  return n;
};
const apt=(pet,key,template,templateKey)=>{
  if(pet?.[key]!==undefined && pet[key]!==null) return val(pet,key);
  const tpl=template?.[templateKey];
  return Array.isArray(tpl)?Number(tpl[0]||0):Number(tpl||0);
};
function sylphDerived(pet,template){
  if(!pet || !template) throw Error('Silfo e template são obrigatórios');
  const grade=val(pet,'curGrade',1);
  const growth=val(template,'GrowthRate')/80;
  // The *display* stats are sent by the server; do not manufacture attribute points.
  const strength=val(pet,'power',val(template,'Power'));
  const intellect=val(pet,'intel',val(template,'Intel'));
  const stamina=val(pet,'physi',val(template,'Physi'));
  const armor=val(pet,'armor',val(template,'Armor'));
  const coeStrength=apt(pet,'powerApti',template,'PowerApt');
  const coeIntellect=apt(pet,'intelApti',template,'IntelApt');
  const coeStamina=apt(pet,'physiApti',template,'PhysiApt');
  const coeArmor=apt(pet,'armorApti',template,'ArmorApt');
  const physicalAttack=Math.floor(1.8*strength*coeStrength/1000)+val(pet,'bagAttack');
  const magicAttack=Math.floor(1.8*intellect*coeIntellect/1000)+val(pet,'bagMagicattack');
  const physicalDefense=Math.floor((0.9*armor*coeArmor+0.9*strength*coeStrength)/1000)+val(pet,'bagDefence');
  const magicDefense=Math.floor((0.9*armor*coeArmor+0.9*intellect*coeIntellect)/1000)+val(pet,'bagMagicdefence');
  const hp=val(template,'InitHp')+Math.floor(6*stamina*coeStamina/1000)+val(pet,'bagLiving');
  // The growth delta is informational here: current power/intel/etc already include levels.
  const growthPerStat=Math.floor((grade-1)*growth);
  const fightingCapacity=Math.ceil(700+physicalAttack+magicAttack+physicalDefense+magicDefense+hp/5);
  if (![hp,physicalAttack,magicAttack,physicalDefense,magicDefense,fightingCapacity].every(Number.isSafeInteger))
    throw Error('Atributos de Silfo fora do limite seguro');
  return {hp,physicalAttack,magicAttack,physicalDefense,magicDefense,fightingCapacity,
    growthPerStat,coeStrength,coeIntellect,coeStamina,coeArmor};
}
/**
 * t_s_skillpropertytemplate: AddType=1 is flat; AddType=0 is percent.
 * Preserve percentage and flat as distinct types until applied to correct base.
 */
function groupSkillBonuses(rows){
  const flat=Object.fromEntries(ATTR_KEYS.map(k=>[k,0]));
  const percent=Object.fromEntries(ATTR_KEYS.map(k=>[k,0]));
  for(const row of rows||[]){
    if(!row)continue;
    if(row.AddType!==0 && row.AddType!==1) throw Error('AddType inválido: '+row.AddType);
    const group=row.AddType===1?flat:percent;
    for(const key of ATTR_KEYS) group[key]+=val(row,key);
  }
  return {flat,percent};
}
function applySkillBonuses(base,rows){
  const {flat,percent}=groupSkillBonuses(rows);
  const result={...base};
  for(const key of ATTR_KEYS){
    const b=val(base,key);
    // Percent of base: round only when applying to base, not while collecting effects.
    result[key]=b+flat[key]+Math.floor(b*percent[key]/100);
  }
  return result;
}
/** Xo.calculatePlayerFightCapacity: multipliers in baseInfo are percentages. */
function playerFightCapacity(stats,baseInfo){
  if(!baseInfo)throw Error('baseFightingCapacity do personagem é obrigatório');
  const s={}; for(const k of ATTR_KEYS)s[k]=val(stats,k);
  const b=(...keys)=>{for(const k of keys)if(baseInfo[k]!==undefined)return val(baseInfo,k);throw Error('Multiplicador ausente: '+keys.join('/'))};
  const power=Math.floor(s.Power*b('power','Power')/100);
  const intel=Math.floor(s.Intellect*b('intel','Intellect')/100);
  const physi=Math.floor(s.Physique*b('physi','Physique')/100);
  const agility=Math.floor(s.Agility*b('agility','Agility')/100);
  const captain=Math.floor(s.Captain*b('captain','Captain')/100);
  const attack=Math.floor((power*4+s.Attack)*b('attack','Attack')/100);
  const magicAttack=Math.floor((intel*4+s.MagicAttack)*b('magicattack','MagicAttack')/100);
  const defence=Math.floor((power+agility*4+s.Defence)*b('defence','Defence')/100);
  const magicDefence=Math.floor((intel+agility*4+s.MagicDefence)*b('magicdefence','MagicDefence')/100);
  const live=Math.floor((physi*20+s.Live)*b('live','Live')/100);
  const conat=Math.floor((captain+s.Conat)*b('conat','Conat')/100);
  const forcehit=Math.floor(s.ForceHit*b('forcehit','ForceHit')/100);
  const parry=Math.floor(s.Parry*b('parry','Parry')/100);
  const extra=2*s.DefensePenetration+s.CriticalResistance+s.ParryPenetration+3*s.ReduceResi+
    2*(s.WaterResi+s.FireResi+s.ElectResi+s.WindResi+s.DarkResi+s.LightResi);
  return attack+Math.floor(1.05*magicAttack)+defence+magicDefence+Math.floor(live/5)+conat+forcehit+parry+extra;
}
module.exports={sylphDerived,groupSkillBonuses,applySkillBonuses,playerFightCapacity,ATTR_KEYS};
