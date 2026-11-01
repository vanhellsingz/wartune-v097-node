'use strict';
const fs=require('node:fs'),path=require('node:path');
// Transicoes da Cidade das Nuvens e do Erandel/Wild, aplicadas sob o lock da linha DB.
const CLOUD=10000,WILD=5;
const cloudSpawn={mapId:CLOUD,x:245,y:175};
const wildSpawn={mapId:WILD,x:69,y:29};
const configRoot=path.resolve(__dirname,'../res/release/config');
const nodesFile=fs.readdirSync(configRoot).find(file=>file.startsWith('t_s_mapnode-'));
const rawNodes = nodesFile ? JSON.parse(fs.readFileSync(path.join(configRoot,nodesFile),'utf8')).t_s_mapnode : [];
const cloudNodes=new Map(rawNodes
  .filter(node=>Number(node.MapId)===CLOUD)
  .map(node=>[Number(node.Id),{
    ...node,
    tileX: Math.round(Number(node.FixX||0)/20),
    tileY: Math.round(Number(node.FixY||0)/20)
  }]));
const clone=v=>structuredClone(v);
const validCloud=p=>p&&p.mapId===CLOUD&&Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.x<450&&p.y>=0&&p.y<300;
function enterCloud(saved){
  const next=clone(saved);
  next.position=validCloud(next.position)?{mapId:CLOUD,x:next.position.x,y:next.position.y}:clone(cloudSpawn);
  return {state:next,position:next.position};
}
function wildGate(grade,saved){
  if(!Number.isInteger(grade)||grade<20)return {allowed:false,reason:'Alcance o nível 20 para acessar Wild.'};
  if(!Array.isArray(saved.quests?.completed)||!saved.quests.completed.includes(52))
    return {allowed:false,reason:'Conclua a missão 52: Recrute 200 Lanceiros primeiro.'};
  return {allowed:true,reason:null};
}
function leaveCloud(saved,grade){
  const gate=wildGate(grade,saved);
  if(!gate.allowed)return {state:clone(saved),gate};
  const next=clone(saved);
  if(!validCloud(next.position))throw Error('Personagem nao esta na Cidade das Nuvens');
  next.position=clone(wildSpawn);
  return {state:next,gate};
}
function moveCloud(saved,playerId,move){
  const next=clone(saved);
  if(!validCloud(next.position))throw Error('Movimento fora da Cidade das Nuvens');
  if(!Array.isArray(move?.players)||move.players.length!==1)throw Error('Movimento exige somente o jogador atual');
  const player=move.players[0];
  if(Number(player.playerId||player.heroId)!==playerId)throw Error('Jogador do movimento nao confere');
  if(!Array.isArray(player.path)||player.path.length<1||player.path.length>100)throw Error('Rota Cloud invalida');
  let last=next.position,total=0;
  for(const point of player.path){
    const p={mapId:CLOUD,x:Number(point.x),y:Number(point.y)};
    if(!validCloud(p))throw Error('Ponto Cloud fora do mapa');
    total+=Math.hypot(p.x-last.x,p.y-last.y);
    if(total>120)throw Error('Rota Cloud longa demais');
    last=p;
  }
  next.position=last;
  return {state:next,position:last};
}
function triggerCloudNpc(saved,nodeId){
  const nId = Number(nodeId);
  const node = cloudNodes.get(nId);
  if(!node) return {id:nId,name:`NPC ${nId}`,dialogue:''};
  return {
    id: node.Id,
    name: node.NodeName_pt || node.NodeName_en || `NPC ${node.Id}`,
    dialogue: node.Dialogue_pt || node.Dialogue_en || '',
    param1: node.Param1,
    param2: node.Param2,
    param3: node.Param3_pt || node.Param3_en || node.Param3
  };
}
function resumeScene(saved,grade,tutorialScene){
  if(!saved || typeof saved.newNoviceProcess!=='string'||!saved.newNoviceProcess.includes('150')) return Number(tutorialScene !== undefined ? tutorialScene : 2);
  // O login sempre deve inicializar na Cidade/Castelo (cena 2) para carregar todas as toolbars,
  // edificacoes e menus. A entrada para o mapa externo e feita de forma controlada via portal/botoes.
  return 2;
}
module.exports={CLOUD,WILD,cloudSpawn,wildSpawn,validCloud,enterCloud,wildGate,leaveCloud,moveCloud,triggerCloudNpc,resumeScene};
