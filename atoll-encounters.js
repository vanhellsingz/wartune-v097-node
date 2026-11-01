'use strict';
// Atol dos Silfos: somente monstros hostis ativos de CNPetIslandRageMonsterAi.
// Nos 91/CNFamCollectionAi sao colecao/captura e ficam fora deste combate.
const fs=require('node:fs');
const path=require('node:path');
const MAPS=new Set([20001,20002,20003,20004]);
const CONDITION_TYPE=14;
const DEFAULT_ROLL_DENOMINATOR=10000; // ASSUMIDO, nao comprovado pelo catalogo.
const DEFAULT_RESPAWN_MS=60000;       // RefreshSpeed=1, unidade nao especificada.
function hostile(node) {
  return !!node && MAPS.has(Number(node.CampaignId)) &&
    Number(node.MasterType)===1003 && Number(node.NodeState)===1 &&
    /CNPetIslandRageMonsterAi/.test(String(node.AI||'')) &&
    /^\d+,\d+$/.test(String(node.Heros||''));
}
function capture(node){return !!node && MAPS.has(Number(node.CampaignId)) && Number(node.MasterType)===91;}
function heroIds(node){return String(node?.Heros||'').split('|').map(v=>Number(v.split(',')[0])).filter(Number.isSafeInteger).filter(v=>v>0);}
// Override LOCAL dos encontros hostis do Atol. Nunca altera catálogos em disco.
// Os 12 herois evoluidos do cadastro original sao substituidos pelas 4 formas
// basicas SOMENTE quando o mapa e o tipo do no conferem.
const BASIC_HERO_BY_MAP=new Map([[20001,75102],[20002,75104],[20003,75101],[20004,75103]]);
const EVOLVED_HERO_IDS=new Set([75111,75112,75113,75114,75121,75122,75123,75124]);
const SEAL_ID_BY_MAP=new Map([[20001,2060404],[20002,2060405],[20003,2060406],[20004,2060408]]);
const PURE_ESSENCE_ID=3101061;
function normalizedMonster(node){
  if(!hostile(node))return node;
  const first=String(node.Heros||'').split('|')[0].split(',');
  const monsterId=Number(first[0]);
  if(!EVOLVED_HERO_IDS.has(monsterId))return node; // chefes especiais 510x continuam autenticos
  const basic=BASIC_HERO_BY_MAP.get(Number(node.CampaignId));
  if(!basic)return node;
  return {...node,Heros:String(node.Heros).replace(/^\d+(?=,)/,String(basic))};
}
function configChance(name,defaultValue){
  const raw=process.env[name];
  const value=raw===undefined?defaultValue:Number(raw);
  if(!Number.isSafeInteger(value)||value<0||value>10000)throw Error(`${name} deve estar entre 0 e 10000`);
  return value;
}
function readRows(root,prefix){
  let files;
  try{files=fs.readdirSync(root).filter(n=>n.startsWith(prefix+'-')&&n.endsWith('.json')).sort();}
  catch(e){throw Error(`Catalogos inacessiveis (${root}): ${e.message}`);}
  if(files.length!==1)throw Error(`Esperado 1 arquivo ${prefix}-*.json, encontrados ${files.length}: ${files.join(',')}`);
  const rows=JSON.parse(fs.readFileSync(path.join(root,files[0]),'utf8'))[prefix];
  if(!Array.isArray(rows))throw Error(`Catalogo ${prefix} invalido`);
  return rows;
}
function positiveInt(v){return Number.isSafeInteger(Number(v))&&Number(v)>0;}
function buildResolver({conditions,dropItems,itemTemplates}={}){
  if(!Array.isArray(conditions)||!Array.isArray(dropItems)||!Array.isArray(itemTemplates))throw Error('Catalogos de drops incompletos');
  const items=new Set(itemTemplates.map(r=>Number(r.TemplateId)));
  const groups=new Map();
  for(const d of dropItems){const id=Number(d.DropId);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(d);}
  // CondictionType=37 aponta os quatro tipos do Atol (101..104) para DropId 37000;
  // somente os itens explicitamente cadastrados no grupo entram no sorteio.
  const officialPureGroup=conditions.find(r=>Number(r.CondictionType)===37 &&
    Array.isArray(r.Para2) && [101,102,103,104].every(id=>r.Para2.map(Number).includes(id)));
  const pureRows=(groups.get(Number(officialPureGroup?.DropId))||[]).filter(d=>
    Number(d.ItemId)===PURE_ESSENCE_ID && items.has(PURE_ESSENCE_ID) &&
    Number(d.Data)>0 && Number(d.Random)>0);
  const monsterConditions=conditions.filter(r=>Number(r.CondictionType)===CONDITION_TYPE &&
    Array.isArray(r.Para2) && r.Para2.some(positiveInt));
  function entriesForNode(node){
    if(!hostile(node))return [];
    const heroSet=new Set(heroIds(node));
    const seen=new Set(),out=[];
    for(const c of monsterConditions){
      if(!c.Para2.some(id=>heroSet.has(Number(id))) || seen.has(Number(c.DropId)))continue;
      seen.add(Number(c.DropId));
      const group=groups.get(Number(c.DropId))||[];
      for(const d of group){
        const itemId=Number(d.ItemId),count=Number(d.Data),chance=Number(d.Random);
        if(!positiveInt(itemId)||!positiveInt(count)||!Number.isFinite(chance)||chance<0||chance>100||!items.has(itemId))continue;
        const conditionRoll=Number(c.Para1?.[0]);
        if(!Number.isFinite(conditionRoll)||conditionRoll<0)continue;
        out.push({dropId:Number(c.DropId),itemId,count,weight:chance,conditionRoll,
          heroIds:heroIds(node),conditionType:Number(c.CondictionType)});
      }
    }
    return out;
  }
  function rollForNode(node,random=Math.random){
    const denominator=Number(process.env.ATOL_CONDITION14_DENOMINATOR||DEFAULT_ROLL_DENOMINATOR);
    if(!Number.isSafeInteger(denominator)||denominator<1)throw Error('ATOL_CONDITION14_DENOMINATOR invalido');
    const out=[];
    for(const d of entriesForNode(node)) {
      // IMPORTANTISSIMO: Para1=920 NAO declara unidade. 920/10000 e hipotese configuravel.
      if(d.conditionRoll>denominator)throw Error('Limiar do drop excede denominador; revise a configuracao');
      if(process.env.ATOL_TEST_FORCE_DROP!=='1') {
        if(random()*denominator>=d.conditionRoll)continue;
        if(random()*100>=d.weight)continue;
      }
      out.push({templateId:d.itemId,count:d.count,dropId:d.dropId});
    }
    return out;
  }
  function rollExtraForNode(node,random=Math.random){
    const projected=normalizedMonster(node);
    if(!hostile(projected))return [];
    const basicId=BASIC_HERO_BY_MAP.get(Number(projected.CampaignId));
    if(!basicId || Number(heroIds(projected)[0])!==basicId)return [];
    const out=[];
    const sealId=SEAL_ID_BY_MAP.get(Number(projected.CampaignId));
    // Taxa LOCAL configuravel. Os catalogos NAO confirmam a taxa de drop de selos.
    if(sealId && items.has(sealId) && random()*10000<configChance('ATOL_SYLPH_SEAL_CHANCE_PER_10000',100)) {
      out.push({templateId:sealId,count:1,source:'selo_basico'});
    }
    // Chance LOCAL da Essencia Pura: usa EXATAMENTE as quantidades e pesos
    // 60000/30000/10000 (2/4/6) do grupo 37000 do cliente.
    if(pureRows.length && random()*10000<configChance('ATOL_PURE_ESSENCE_CHANCE_PER_10000',1000)){
      const total=pureRows.reduce((acc,d)=>acc+Number(d.Random),0);
      let point=random()*total;
      for(const d of pureRows){
        point-=Number(d.Random);
        if(point<0){out.push({templateId:PURE_ESSENCE_ID,count:Number(d.Data),dropId:Number(d.DropId),source:'essencia_pura'});break;}
      }
    }
    return out;
  }
  return {entriesForNode,rollForNode,rollExtraForNode,monsterConditions:monsterConditions.length};
}
let cache=null;
function resolver(){
  if(!cache){const root=path.resolve(__dirname,'../res/release/config');cache=buildResolver({
    conditions:readRows(root,'t_s_dropcondition'),dropItems:readRows(root,'t_s_dropitem'),
    itemTemplates:readRows(root,'t_s_itemtemplate')
  });}
  return cache;
}

const DAILY_REWARD_LIMIT=60;
function dailyDate(now=Date.now()) {
  const tz=process.env.ATOL_DAY_TIMEZONE||'America/Sao_Paulo';
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date(now));
  const read=k=>parts.find(p=>p.type===k)?.value;
  return `${read('year')}-${read('month')}-${read('day')}`;
}
function rewardTimes(saved,now=Date.now()) {
  if(String(saved?.atoll?.rewardDate||'')!==dailyDate(now))return 0;
  const n=Number(saved?.atoll?.rewardTimes||0);
  return Number.isSafeInteger(n)?Math.min(DAILY_REWARD_LIMIT,Math.max(0,n)):0;
}

function cooldownUntil(saved,nodeId){return Number(saved?.atoll?.respawnUntil?.[String(nodeId)]||0);}
function canFight(saved,node,now=Date.now()){
  return hostile(node) && Number(saved?.position?.mapId)===Number(node.CampaignId) &&
    Number(saved?.campaigns?.current?.campaignId)===20000 &&
    Number(saved?.campaigns?.current?.mapId)===Number(node.CampaignId) &&
    now>=cooldownUntil(saved,node.Id);
}
function commitVictory(saved,node,{now=Date.now(),random=Math.random,addItem,dropResolver=null}={}){
  if(!canFight(saved,node,now))throw Error('Atol: encontro fora do mapa ou aguardando ressurgimento');
  if(typeof addItem!=='function')throw Error('Atol: gravacao do inventario indisponivel');
  const previousRewardTimes=rewardTimes(saved,now);
  const eligibleForReward=previousRewardTimes<DAILY_REWARD_LIMIT;
  // O contador representa oportunidades de recompensa, independente de ter drop.
  // Depois de 60 vitorias validas no dia, combate/respawn seguem; itens nao.
  const effectiveResolver=dropResolver||resolver();
  const drops=eligibleForReward?effectiveResolver.rollForNode(node,random):[];
  if(eligibleForReward && typeof effectiveResolver.rollExtraForNode==='function'){
    drops.push(...effectiveResolver.rollExtraForNode(node,random));
  }
  // Se o inventario falhar, a transacao de DB nao concede itens nem consome tentativa.
  for(const d of drops)addItem(saved,d.templateId,d.count);
  saved.atoll ||= {};
  saved.atoll.rewardDate=dailyDate(now);
  saved.atoll.rewardTimes=Math.min(DAILY_REWARD_LIMIT,previousRewardTimes+1);
  saved.atoll.respawnUntil ||= {};
  const minutes=Number(node.RefreshSpeed)||1;
  const respawnMs=Math.max(DEFAULT_RESPAWN_MS,Math.min(60*60*1000,minutes*60*1000));
  const until=now+respawnMs;
  saved.atoll.respawnUntil[String(node.Id)]=until;
  return {drops,respawnAt:until,respawnMs,rewardTimes:saved.atoll.rewardTimes,
    dailyLimit:DAILY_REWARD_LIMIT,eligibleForReward};
}
module.exports={MAPS,hostile,capture,heroIds,normalizedMonster,BASIC_HERO_BY_MAP,SEAL_ID_BY_MAP,PURE_ESSENCE_ID,readRows,buildResolver,canFight,commitVictory,cooldownUntil,rewardTimes,dailyDate,DAILY_REWARD_LIMIT};
