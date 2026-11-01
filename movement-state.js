'use strict';
const world=require('./world-state');
function validate(request,character){
 const state=require('./inventory-state').parseState(character.state_json),pos=state.position,h=state.hero;
 if(!pos||request.mapId!==pos.mapId||request.armyId!==h?.armyId)throw Error('Map or army ownership mismatch');
 const routes=request.routes;
 if(!Array.isArray(routes)||!routes.length||routes.length>200)throw Error('Invalid route count');
 let x=pos.x*20,y=pos.y*20,total=0;
 for(const p of routes){
  if(!Number.isInteger(p.x)||!Number.isInteger(p.y)||p.x<0||p.y<0||p.x>=30000||p.y>=30000)throw Error('Position out of bounds');
  const distance=Math.hypot(p.x-x,p.y-y);total+=distance;if(total>2000)throw Error('Movement too long for minimal local flow');
  const steps=Math.max(1,Math.ceil(distance/10));for(let i=1;i<=steps;i++)
   if(!world.valid(Math.floor((x+(p.x-x)*i/steps)/20),Math.floor((y+(p.y-y)*i/steps)/20)))throw Error('Route crosses original obstacle');
  x=p.x;y=p.y;
 }
 return {mapId:pos.mapId,x:Math.floor(x/20),y:Math.floor(y/20),source:pos.source};
}
module.exports={validate};
