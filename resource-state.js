'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),inv=require('./inventory-state');
const configRoot=path.resolve(__dirname,'../res/release/config');
function catalogue(name){const f=fs.readdirSync(configRoot).find(f=>f.startsWith(name+'-'));return JSON.parse(fs.readFileSync(path.join(configRoot,f)))[name];}
const configs=new Map(catalogue('t_s_config').map(r=>[r.ConfigName,r]));
function configInt(name){const n=Number(configs.get(name)?.ConfigValue);if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid Ultra config: '+name);return n;}
const energyRules={max:configInt('Player_weary'),perHour:configInt('Weary_Restore'),singleCost:configInt('SingleCampaign_Weary'),multiCost:configInt('MultiCampaign_Weary')};
const curve=new Map(catalogue('t_s_upgradetemplate').filter(r=>r.Types===3).map(r=>[r.Grades,r.Data]));
const quests=new Map(catalogue('t_s_questtemplate').map(r=>[r.TemplateId,r]));
const maxLevel=Math.max(...curve.keys()),jobChangeBoundary=80;
function integer(n,limit=Number.MAX_SAFE_INTEGER){if(!Number.isSafeInteger(n)||n<0||n>limit)throw Error('Invalid nonnegative integer');return n;}
function reference(ref){if(typeof ref!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{2,119}$/.test(ref))throw Error('Invalid operation reference');}
function ledger(state,ref,kind,payload,apply,now=Date.now()){
 reference(ref);integer(now);state.resourceLedger??={};
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify({kind,payload})).digest('hex');
 if(state.resourceLedger[ref]){if(state.resourceLedger[ref].fingerprint!==fingerprint)throw Error('Operation reference conflict');return {duplicate:true,entry:state.resourceLedger[ref]};}
 if(Object.keys(state.resourceLedger).length>=10000)throw Error('Audit ledger full; archive migration required');
 const result=apply();const entry={kind,payload,fingerprint,time:new Date(now).toISOString(),...result};state.resourceLedger[ref]=entry;return {duplicate:false,entry};
}
function wallet(state){if(!state.wallet)throw Error('Wallet not initialized; explicit migration required');for(const k of ['gold','balens','boundBalens'])integer(state.wallet[k],2147483647);return state.wallet;}
function currency(raw,{ref,currency,delta,reason},now){
 const state=inv.parseState(raw);if(!['gold','balens','boundBalens'].includes(currency)||!Number.isSafeInteger(delta)||delta===0||typeof reason!=='string'||reason.length<3||reason.length>120)throw Error('Invalid currency operation');
 const result=ledger(state,ref,'currency',{currency,delta,reason},()=>{const w=wallet(state),before=w[currency],after=integer(before+delta,2147483647);w[currency]=after;return {before,after};},now);
 return {state,...result};
}
function regenerate(raw,now=Date.now()){
 const state=inv.parseState(raw);
 integer(now);
 const currentHour=Math.floor(now/3600000);
 if(!state.energy||typeof state.energy!=='object'){
  state.energy={value:Math.min(energyRules.max,Math.max(0,Number(state.energy||0))),lastTickHour:currentHour};
 }
 const e=state.energy;
 if(!Number.isSafeInteger(e.value))e.value=0;
 if(!Number.isSafeInteger(e.lastTickHour))e.lastTickHour=currentHour;
 integer(e.value,energyRules.max);
 integer(e.lastTickHour);
 const hour=currentHour;
 if(hour<=e.lastTickHour)return {state,gained:0,timeReversed:hour<e.lastTickHour};
 const before=e.value;
 e.value=Math.min(energyRules.max,before+(hour-e.lastTickHour)*energyRules.perHour);
 e.lastTickHour=hour;
 return {state,gained:e.value-before,timeReversed:false};
}
function spendEnergy(raw,{ref,kind},now=Date.now()){
 if(!['single','multi'].includes(kind))throw Error('Energy action not validated');
 const state=regenerate(raw,now).state,cost=kind==='single'?energyRules.singleCost:energyRules.multiCost;
 const result=ledger(state,ref,'energy',{kind,cost},()=>{const before=state.energy.value;state.energy.value=integer(before-cost,energyRules.max);return {before,after:state.energy.value};},now);
 return {state,...result};
}
function totalAtLevel(grade){integer(grade,maxLevel);if(grade<1)throw Error('Invalid grade');let total=0;for(let level=2;level<=grade;level++)total+=integer(curve.get(level));return total;}
function experience(raw,grade,{ref,amount,source},now=Date.now()){
 const state=inv.parseState(raw);integer(grade,maxLevel);if(grade<1||!state.progression)throw Error('Progression not initialized');integer(amount);if(amount<1||!['verified-quest','development-test'].includes(source))throw Error('Unverified XP source');
 integer(state.progression.currentXp);integer(state.progression.totalXp);
 if(source==='verified-quest'){
  const proof=state.verifiedQuestRewards?.[ref],q=quests.get(proof?.questId);
  if(!proof||proof.status!=='SERVER_COMPLETED'||proof.characterId!==state.hero?.id||!q||q.RewardPlayGP!==amount||grade<q.NeedMinLevel||grade>q.NeedMaxLevel)throw Error('Persisted server quest completion and exact Ultra reward required');
 }
 let newGrade=grade;
 const result=ledger(state,ref,'xp',{amount,source},()=>{
  const before={grade,currentXp:state.progression.currentXp,totalXp:state.progression.totalXp};
  state.progression.currentXp=integer(state.progression.currentXp+amount);state.progression.totalXp=integer(state.progression.totalXp+amount);
  while(newGrade<maxLevel&&newGrade<jobChangeBoundary&&state.progression.currentXp>=integer(curve.get(newGrade+1))){state.progression.currentXp-=curve.get(newGrade+1);newGrade++;}
  return {before,after:{grade:newGrade,...state.progression},pendingJobChange:newGrade===jobChangeBoundary};
 },now);
 if(result.duplicate)newGrade=grade;
 return {state,grade:newGrade,...result};
}
function sell(raw,positions,resolveTemplate,now=Date.now()){
 let state=inv.parseState(raw);if(!Array.isArray(positions)||positions.length<1||positions.length>30)throw Error('Invalid sale size');
 const bag=inv.inventory(state),seen=new Set(),sold=[];let total=0;
 for(const request of positions){integer(request.pos,9999);integer(request.count);if(request.count<1||seen.has(request.pos))throw Error('Invalid sale position/count');seen.add(request.pos);
  const item=bag.items.find(i=>i.bagType===1&&i.pos===request.pos);if(!item||request.count>item.count)throw Error('Item not owned in player bag');
  const t=resolveTemplate(item.templateId);inv.validateTemplate(t);const price=integer(t.SellGold,2147483647);if(price<1)throw Error('Item not sellable');
  sold.push({...item,soldCount:request.count});total=integer(total+price*request.count,2147483647);
 }
 const ref='sale:'+sold.map(i=>i.instanceId+'-'+i.count+'-'+i.soldCount).sort().join('_');
 const change=currency(state,{ref,currency:'gold',delta:total,reason:'Ultra ItemTemplate.SellGold'},now);state=change.state;
 if(!change.duplicate){const items=inv.inventory(state).items;for(const sale of sold){const item=items.find(i=>i.instanceId===sale.instanceId);item.count-=sale.soldCount;if(!item.count)items.splice(items.indexOf(item),1);}}
 return {state,sold,total,duplicate:change.duplicate};
}
function calcGradeFromXp(totalXp, currentGrade = 1) {
 let grade = currentGrade;
 while (grade < maxLevel) {
  try {
   const nextTotal = totalAtLevel(grade + 1);
   if (totalXp >= nextTotal) grade++;
   else break;
  } catch (e) { break; }
 }
 return grade;
}
module.exports={energyRules,curve,quests,maxLevel,jobChangeBoundary,totalAtLevel,calcGradeFromXp,currency,regenerate,spendEnergy,experience,sell,wallet,ledger};
