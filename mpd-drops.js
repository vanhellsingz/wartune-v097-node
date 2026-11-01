'use strict';
// Drops de encontros multiplayer do catalogo ORIGINAL: CondictionType 4 -> node.Id.
// Apenas entradas AppearType 1 / Random 100, cuja semantica e clara neste grupo.
// Outros grupos (condicao 3, AppearType 4) permanecem separados e sem premios ficticios.
const fs=require('node:fs');
const path=require('node:path');
const CONFIG=path.resolve(__dirname,'../res/release/config');
let cache=null;
function rows(prefix){
  const f=fs.readdirSync(CONFIG).filter(s=>s.startsWith(prefix+'-')&&s.endsWith('.json'));
  if(f.length!==1)throw Error(`Catalogo ${prefix}: esperado um JSON; encontrados ${f.length}`);
  const res=JSON.parse(fs.readFileSync(path.join(CONFIG,f[0]),'utf8'))[prefix];
  if(!Array.isArray(res))throw Error(`Catalogo ${prefix}: estrutura invalida`);
  return res;
}
function resolver({conditions,items,itemTemplates}){
  if(!Array.isArray(conditions)||!Array.isArray(items)||!Array.isArray(itemTemplates))throw Error('Catalogos de MPD incompletos');
  const validItems=new Set(itemTemplates.map(r=>Number(r.TemplateId)));
  const groups=new Map();
  for(const it of items){const d=Number(it.DropId);if(!groups.has(d))groups.set(d,[]);groups.get(d).push(it);}
  const byNode=new Map();
  for(const c of conditions){
    if(Number(c.CondictionType)!==4||!Array.isArray(c.Para2))continue;
    const dropId=Number(c.DropId);
    for(const nodeId of c.Para2){
      const id=Number(nodeId);
      if(!Number.isSafeInteger(id)||id<=0)continue;
      if(!byNode.has(id))byNode.set(id,[]);
      for(const item of groups.get(dropId)||[]){
        const itemId=Number(item.ItemId),count=Number(item.Data);
        if(Number(item.AppearType)!==1||Number(item.Random)!==100||!validItems.has(itemId)||
           !Number.isSafeInteger(count)||count<1||count>1000)continue;
        byNode.get(id).push({templateId:itemId,count,dropId});
      }
    }
  }
  return {entriesForNode(nodeId){return (byNode.get(Number(nodeId))||[]).map(x=>({...x}));}};
}
function getResolver(){
  if(!cache)cache=resolver({conditions:rows('t_s_dropcondition'),items:rows('t_s_dropitem'),itemTemplates:rows('t_s_itemtemplate')});
  return cache;
}
function isMpd(node,campaignId,campaignById){
  if(!node||![41,42].includes(Number(node.MasterType))||Number(node.NodeState)!==1)return false;
  const camp=campaignById?.get(Number(campaignId));
  return !!camp&&[1,2,3,4].includes(Number(camp.DungeonId))&&Number(camp.Capacity)>=2;
}
function commitVictory(saved,node,campaignId,{campaignById,addItem,dropResolver=null}={}){
  if(!isMpd(node,campaignId,campaignById))return null;
  const current=saved?.campaigns?.current;
  if(!current||Number(current.mapId)!==Number(node.CampaignId)||
    Number(current.campaignId)!==Number(campaignId))return null;
  if(typeof addItem!=='function')throw Error('MPD: inventario nao disponivel');
  const entries=(dropResolver||getResolver()).entriesForNode(Number(node.Id));
  if(entries.length===0)return null;
  current.mpdLootClaims ||= {};
  const key=String(node.Id);
  if(current.mpdLootClaims[key])return {items:[],alreadyClaimed:true,nodeId:Number(node.Id)};
  for(const e of entries)addItem(saved,e.templateId,e.count);
  current.mpdLootClaims[key]=true;
  return {items:entries,alreadyClaimed:false,nodeId:Number(node.Id)};
}
module.exports={rows,resolver,getResolver,isMpd,commitVictory};
