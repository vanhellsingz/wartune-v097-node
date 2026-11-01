'use strict';
// Existing state_json is read only. No sign/reward mutations are implemented.
function signSnapshot(char){
 let state={};
 if(char.state_json){try{state=typeof char.state_json==='string'?JSON.parse(char.state_json):char.state_json;}catch{throw Error('state_json invalido; beneficios nao podem ser inferidos');}}
 const sign=state?.signIn || state?.signInfo;
 if(sign){
  if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(sign.signDate)||!Number.isFinite(Date.parse(sign.signDate.replace(/-/g,'/'))))throw Error('signIn.signDate invalido');
  for(const key of ['signTimes','signSite','reissueNum'])if(!Number.isInteger(sign[key])||sign[key]<0||sign[key]>2147483647)throw Error('signIn.'+key+' invalido');
  if(typeof sign.rewardState!=='string'||!/^([01](,[01])*)?$/.test(sign.rewardState))throw Error('signIn.rewardState invalido');
  return sign;
 }
 // No persisted sign system exists in v089: expose a read-only empty cycle from creation date.
 const date=char.created_at?new Date(char.created_at):new Date();
 if(!Number.isFinite(date.getTime()))throw Error('created_at invalido');
 const signDate=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')+' 05:00:00';
 return {signDate,signTimes:0,signSite:0,reissueNum:0,rewardState:''};
}
module.exports={signSnapshot};
