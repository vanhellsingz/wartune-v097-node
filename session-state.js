'use strict';
const transitions={CONNECTED:['AUTHENTICATED'],AUTHENTICATED:['CHARACTER_LOADED'],CHARACTER_LOADED:['BASE_DATA_SENT'],
 BASE_DATA_SENT:['SCENE_REQUESTED'],SCENE_REQUESTED:['SCENE_SENT'],SCENE_SENT:['WORLD_SYNCED'],WORLD_SYNCED:['PLAYER_READY']};
function advance(session,next,event){
 const current=session.phase||'CONNECTED';if(current===next)return false;
 if(!transitions[current]?.includes(next))throw Error(`Invalid session transition ${current} -> ${next}`);
 session.phase=next;session.transitions??=[];session.transitions.push({time:new Date().toISOString(),from:current,to:next,event});return true;
}
module.exports={advance};
