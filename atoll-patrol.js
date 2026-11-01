'use strict';
// Movimento de NPCs hostis do Atol baseado em PatrolPos do catalogo original.
// Nada e gravado em DB ou modificado em catalogos; estado isolado por sessao.
const MAPS=new Set([20001,20002,20003,20004]);
function isHostile(row){return !!row&&MAPS.has(Number(row.CampaignId))&&Number(row.MasterType)===1003&&Number(row.NodeState)===1&&/CNPetIslandRageMonsterAi/.test(String(row.AI||''));}
function validPoint(x,y){return Number.isSafeInteger(x)&&Number.isSafeInteger(y)&&x>0&&y>0&&x<2000&&y<2000;}
function points(row){
  const entries=String(row.PatrolPos||'').split('|').map(s=>s.split(',').map(Number)).filter(([x,y])=>validPoint(x,y));
  return entries.map(([x,y])=>({x,y}));
}
function key(x,y){return `${x},${y}`;}
function uniqueCandidate(origin,path,occupied,id){
  if(!occupied.has(key(origin.x,origin.y)))return origin;
  // Um segundo NPC usa o waypoint do proprio catalogo, preferindo o mais proximo.
  const nearby=path.filter(p=>Math.hypot(p.x-origin.x,p.y-origin.y)<=30)
    .sort((a,b)=>Math.hypot(a.x-origin.x,a.y-origin.y)-Math.hypot(b.x-origin.x,b.y-origin.y));
  for(const p of nearby)if(!occupied.has(key(p.x,p.y)))return p;
  // Ultima opcao: desvio pequeno e deterministico, nunca para outro mapa.
  const offsets=[];
  for(let radius=2;radius<=9;radius+=2){
    for(const [dx,dy] of [[radius,0],[-radius,0],[0,radius],[0,-radius],[radius,radius],[-radius,-radius],[radius,-radius],[-radius,radius]])offsets.push([dx,dy]);
  }
  const start=Math.abs(Number(id)||0)%offsets.length;
  for(let i=0;i<offsets.length;i++){
    const [dx,dy]=offsets[(start+i)%offsets.length], x=origin.x+dx,y=origin.y+dy;
    if(validPoint(x,y)&&!occupied.has(key(x,y)))return {x,y};
  }
  return origin;
}
function createLayout(rows,formatter){
  if(!Array.isArray(rows)||typeof formatter!=='function')throw Error('Parametros de layout invalidos');
  const occupied=new Set();
  // Reserva os nos que nao serao movimentados (captura, portais etc).
  for(const row of rows){if(isHostile(row))continue;const x=Number(row.Property1),y=Number(row.Property2);if(validPoint(x,y))occupied.add(key(x,y));}
  const blocked=new Set(occupied);
  const entries=[];
  const nodes=rows.map(row=>{
    const data=formatter(row);
    if(!isHostile(row))return data;
    const origin={x:Number(row.Property1),y:Number(row.Property2)};
    if(!validPoint(origin.x,origin.y))return data;
    const patrol=points(row), home=uniqueCandidate(origin,patrol,occupied,row.Id);
    occupied.add(key(home.x,home.y));
    const route=[home,...patrol].filter((p,i,a)=>a.findIndex(v=>v.x===p.x&&v.y===p.y)===i);
    entries.push({id:Number(row.Id),mapId:Number(row.CampaignId),home,current:{...home},route,step:1});
    const dx=Number(row.FixX)-20*origin.x,dy=Number(row.FixY)-20*origin.y;
    return {...data,posX:home.x,posY:home.y,curX:home.x,curY:home.y,
      fixX:20*home.x+(Number.isFinite(dx)?dx:0),fixY:20*home.y+(Number.isFinite(dy)?dy:0)};
  });
  return {nodes,entries,blocked,positions:new Map(entries.map(e=>[e.id,e.current]))};
}
function nextMoves(patrol,player,max=12,skipIds=new Set()){
  if(!patrol?.entries?.length)return [];
  const out=[],occupied=new Set(patrol.entries.map(e=>key(e.current.x,e.current.y)));
  const px=Number(player?.x),py=Number(player?.y),len=patrol.entries.length;
  let visited=0;
  while(visited<len&&out.length<max){
    const e=patrol.entries[patrol.cursor%len];patrol.cursor=(patrol.cursor+1)%len;visited++;
    if(skipIds.has(e.id)||!validPoint(px,py)||Math.hypot(px-e.current.x,py-e.current.y)>42)continue;
    if(e.route.length<2)continue;
    let destination=null;
    for(let tries=0;tries<e.route.length;tries++){
      const p=e.route[e.step%e.route.length];e.step++;
      if(!occupied.has(key(p.x,p.y))&&key(p.x,p.y)!==key(e.current.x,e.current.y)) {destination=p;break;}
    }
    if(!destination)continue;
    occupied.delete(key(e.current.x,e.current.y));occupied.add(key(destination.x,destination.y));
    const from={...e.current};e.current={...destination};patrol.positions.set(e.id,e.current);
    out.push({id:e.id,posX:from.x,posY:from.y,curPosX:destination.x,curPosY:destination.y});
  }
  return out;
}
module.exports={MAPS,isHostile,points,createLayout,nextMoves};
