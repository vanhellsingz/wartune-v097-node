'use strict';
const db=require('./db'),rs=require('./resource-state');
function mirrors(state,grade){return {gold:rs.wallet(state).gold,grade,experience:state.progression.currentXp};}
async function refresh(id,now=Date.now()){
 const character=await db.characterById(id);if(!character)throw Error('Character missing');
 const parsed=typeof character.state_json==='string'?JSON.parse(character.state_json):character.state_json;
 if(!['v095','v096','v097'].includes(parsed?.creation?.version)||!parsed.energy)return character;
 await db.mutateCharacterState(id,state=>{const result=rs.regenerate(state,now);return {state:result.state};});return db.characterById(id);
}
async function sell(id,positions,templates){
 const character=await db.characterById(id);if(!character)throw Error('Character missing');
 return db.mutateCharacterState(id,(state,locked)=>{
  if(!['v095','v096','v097'].includes(state.creation?.version))throw Error('Existing character has no validated resource migration');
  const result=rs.sell(state,positions,templates);
  return {...result,resources:mirrors(result.state,locked.grade)};
 });
}
async function developmentGrant(id,{ref,currency,amount,xp=0},options={}){
 const enabled=options.enabled??process.env.WARTUNE_DEV_RESOURCES==='1';if(!enabled)throw Error('Development resources disabled');
 const character=await db.characterById(id);if(!character||!/^V095_DEV_[1-6]$|^V095_RES_TEST$/.test(character.username))throw Error('Not an allowed development account');
 if(!Number.isSafeInteger(amount)||amount<0||amount>1000||!Number.isSafeInteger(xp)||xp<0||xp>100000||(!amount&&!xp))throw Error('Development grant outside limits');
 return db.mutateCharacterState(id,(state,locked)=>{
  if(state.creation?.version!=='v095')throw Error('Invalid development ownership');
  const source=Object.values(state.resourceLedger||{}).filter(e=>e.payload?.reason==='development-test');
  if(!state.resourceLedger?.[ref+':currency']&&source.reduce((sum,e)=>sum+Math.max(0,e.payload.delta),0)+amount>2000)throw Error('Development lifetime currency cap reached');
  let result={state,grade:locked.grade};
  if(amount)result=rs.currency(state,{ref:ref+':currency',currency,delta:amount,reason:'development-test'});
  if(xp)result=rs.experience(result.state,locked.grade,{ref:ref+':xp',amount:xp,source:'development-test'});
  const grade=result.grade||locked.grade;return {...result,resources:mirrors(result.state,grade)};
 });
}
module.exports={refresh,sell,developmentGrant,mirrors};
