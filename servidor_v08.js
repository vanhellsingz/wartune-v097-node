// WARTUNE_R7_SYNC
/**
 * Wartune Ultra - laboratorio local v0.8.9 (mapa externo validado)
 * API S1 (8899) + receptor WebSocket (8900) + leitura do cabecalho criptografado.
 * Conta de teste local e criacao de personagem persistente. Jogabilidade ainda nao implementada. Nao grava senhas.
 * Somente modulos nativos do Node.js 18+. Escuta apenas em 127.0.0.1.
 */
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const db = require('./db');
const energyRules = require('./character-repository');
const mapConfig = require('./map-config');
const {signSnapshot}=require('./player-state');
const inventoryState=require('./inventory-state');
const sylphEquipment=require('./sylph-equipment-state');
const heroState=require('./hero-state');
const originalPb=require('./original-protobuf');
const sessionState=require('./session-state');
const movementState=require('./movement-state');
const resourceService=require('./resource-service');
const resourceState=require('./resource-state');
const progressionRules=require('./progression-rules');
const tutorialState=require('./tutorial-state');
const cityState=require('./city-state');
const sylphAtoll=require('./sylph-atoll-state');
const atollEncounters=require('./atoll-encounters');
const atollPatrol=require('./atoll-patrol');
const consumables=require('./item-consumable-state');
const campaignMovementState=require('./campaign-movement-state');
const recorder=require('./packet-recorder');
const questState=require('./quest-state');
const castleState=require('./castle-state');
const barracksState=require('./barracks-state');
const shopState=require('./shop-state');
const shopP0=require('./shop-p0-catalog');
const skillsState=require('./skills-state');
const campaignState=require('./campaign-state');
const { MpdRooms } = require('./mpd-room-state');
const BattleEngine=require('./battle-engine');
const itemRepository=require('./item-repository');
const attributeCalculator=require('./attribute-calculator');
const astralState=require('./astral-state');
const stargazingState=require('./stargazing-state');
const navigationState=require('./navigation-state');
const secondarySystemsState=require('./secondary-systems-state');
const wartuneSylphSkills=require('./wartune-sylph-skills');
const mountState=require('./mount-state');
const uiplayState=require('./uiplay-state');
const secondaryFeatures=require('./secondary-features-state');
const extendedSubsystems=require('./extended-subsystems-state');
const outerCityState=require('./outercity-state');
const WORLD_MAP=mapConfig.selection;

const fs = require('node:fs');
const path = require('node:path');
const canonicalConfigs = require('./canonical-config-repository');
canonicalConfigs.loadAll();
outerCityState.initOuterCityData(path.resolve(__dirname, '../res/release/config'));
const protocolLookup=require('./PROTOCOLO_CODIGOS_CLIENTE.json').codes;
const itemTemplatePath=path.resolve(__dirname,'../res/release/config/t_s_itemtemplate-43b07d7a92.json');
const itemTemplateCatalog=fs.existsSync(itemTemplatePath)
  ? JSON.parse(fs.readFileSync(itemTemplatePath,'utf8')).t_s_itemtemplate||[] : [];
const itemTemplates=new Map(itemTemplateCatalog.map(template=>[Number(template.TemplateId),template]));
const dropItemPath=path.resolve(__dirname,'../res/release/config/t_s_dropitem-358e5cbc6e.json');
const dropItemCatalog=fs.existsSync(dropItemPath)
  ? JSON.parse(fs.readFileSync(dropItemPath,'utf8')).t_s_dropitem||[] : [];
const dropItems=new Map();
for(const d of dropItemCatalog){if(!dropItems.has(d.DropId))dropItems.set(d.DropId,[]);dropItems.get(d.DropId).push(d);}
const fashionUpgradePath=fs.readdirSync(path.resolve(__dirname,'../res/release/config'))
  .find(file=>file.startsWith('t_s_upgradetemplate-'));
const fashionUpgrades=fashionUpgradePath
  ? (JSON.parse(fs.readFileSync(path.resolve(__dirname,'../res/release/config',fashionUpgradePath),'utf8')).t_s_upgradetemplate||[])
    .filter(row=>Number(row.Types)===113).sort((a,b)=>Number(a.Grades)-Number(b.Grades)) : [];
const talentUpgrades=fashionUpgradePath
  ? new Map((JSON.parse(fs.readFileSync(path.resolve(__dirname,'../res/release/config',fashionUpgradePath),'utf8')).t_s_upgradetemplate||[])
    .filter(row=>Number(row.Types)===21).map(row=>[Number(row.Grades), row]))
  : new Map();
const fashionSkills=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../res/release/config/t_s_skilltemplate-cd26b32bf4.json'),'utf8'))
  .t_s_skilltemplate.filter(row=>[1090,1100,1110,1120].includes(Number(row.MasterType)));

const systemOpenCatalogPath=path.resolve(__dirname,'../res/release/config/t_s_systemopen-99bc54d992.json');
const systemOpenCatalog=fs.existsSync(systemOpenCatalogPath)
  ? (JSON.parse(fs.readFileSync(systemOpenCatalogPath,'utf8')).t_s_systemopen||[]) : [];

function getSystemsOpenForGrade(grade) {
  const g = Number(grade || 1);
  const open = new Set();
  for (const item of systemOpenCatalog) {
    if (Number(item.Grades) <= g) {
      open.add(Number(item.SystemID));
    }
  }
  if (g >= 12) {
    open.add(124);
    open.add(127);
  }
  if (g >= 18) {
    open.add(109);
  } else {
    open.delete(109);
  }
  return Array.from(open).sort((a, b) => a - b);
}

function buildCampaignRankList(saved, userId, fallbackCampId = 1001) {
  const completedSet = new Set(
    Array.isArray(saved?.campaigns?.completed) ? saved.campaigns.completed.map(Number) : []
  );
  for (const uId of (saved?.campaigns?.unlocked || [])) {
    const cTpl = campaignState.campaignById.get(Number(uId));
    if (cTpl && Number(cTpl.PreCampaignId) > 0) {
      completedSet.add(Number(cTpl.PreCampaignId));
    }
  }
  if (completedSet.size === 0 && fallbackCampId) {
    completedSet.add(Number(fallbackCampId));
  }
  return {
    rankInfo: [...completedSet].filter(id => Number.isSafeInteger(id) && id > 0).map(id => ({
      userId: Number(userId),
      campaignId: Number(id),
      rank: 1
    }))
  };
}

const HOST = '127.0.0.1';
const API_PORT = +process.env.WARTUNE_API_PORT || 8903;
const WS_PORT = +process.env.WARTUNE_WS_PORT || 8904;
// Default client port restored to original 8088 as per P2 requirement
const STATIC_PORT = +process.env.WARTUNE_CLIENT_PORT || 8088;
const ORIGINS = new Set([
  `http://127.0.0.1:${STATIC_PORT}`,
  `http://localhost:${STATIC_PORT}`,
  'http://127.0.0.1:8085',
  'http://localhost:8085',
  'http://127.0.0.1:8081',
  'http://localhost:8081'
]);
const STATIC_HOST = '127.0.0.1';
const APP_VERSION='0.9.7-candidato';
const APP_ENVIRONMENT=process.env.NODE_ENV||'local-candidate';
const BUILD_FILES=['servidor_v08.js','db.js','inventory-state.js','player-state.js','map-config.js','iniciar.js','hero-state.js','attribute-calculator.js','world-state.js','session-state.js','original-protobuf.js','movement-state.js','game-observer.js','character-state.js','resource-state.js','resource-service.js','quest-state.js','castle-state.js','barracks-state.js','shop-state.js','tutorial-state.js','campaign-state.js','skills-state.js','packet-recorder.js','battle-engine.js'];
const BUILD_TIME=new Date(Math.max(...BUILD_FILES.map(name=>{try{return fs.statSync(path.join(__dirname,name)).mtimeMs;}catch(_){return Date.now();}}))).toISOString();
const BUILD_ID=crypto.createHash('sha256').update(BUILD_FILES
  .map(name=>{try{return name+'\0'+fs.readFileSync(path.join(__dirname,name));}catch(_){return name+'\0missing';}}).join('\0')).digest('hex').slice(0,16);
const MAX_FORM = 16 * 1024, MAX_WS_MESSAGE = 1024 * 1024, MAX_PACKET = 65535;
const DEFAULT_KEY = Uint8Array.from([174,191,86,120,171,205,239,241]);
const INIT_EXPERIMENTAL = process.env.WARTUNE_INIT_EXPERIMENTAL !== '0';
const INIT_FARM = process.env.WARTUNE_INIT_FARM !== '0';
const INIT_DELAY_MS = 180;
const INIT_MESSAGE_LIMIT = Math.max(0, Math.min(12, Number.isFinite(Number(process.env.WARTUNE_INIT_LIMIT)) && process.env.WARTUNE_INIT_LIMIT !== undefined ? Number(process.env.WARTUNE_INIT_LIMIT) : 12));
const BOOTSTRAP_PLAYER = process.env.WARTUNE_BOOTSTRAP_PLAYER !== '0';
const SOCKET_SHIM = process.env.WARTUNE_SOCKET_SHIM === '1';
const BOOT_OBSERVER = process.env.WARTUNE_BOOT_OBSERVER === '1';
const SCENE_OBSERVER = process.env.WARTUNE_SCENE_OBSERVER === '1';
const LOGIN_SCENE_STATE = ['2','3'].includes(process.env.WARTUNE_LOGIN_SCENE_STATE) ? Number(process.env.WARTUNE_LOGIN_SCENE_STATE) : 2;
const sceneStateEvents=[];
const gameTraces=[];
const movementEvents=[];
const inventoryEvents=[];
let lastRegisteredRole = null;
const modernManifest=require('./ultra_catalog_manifest.json');
const CODE_NAMES = new Map([
  [28678,'L_CREATE_LOGIN'], [3846,'U_L_CREATE_LOGIN_RSP'],
  [28672,'L_GET_PLAYER_LIST'], [3843,'U_L_GET_PLAYER_LIST'],
  [28674,'L_PREPARE_LOGIN'], [3844,'U_L_PREPARE_LOGIN'],
  [28676,'L_REGISTER_ROLE'], [3845,'U_L_REGISTER_ROLE_RSP'], [28680,'L_SYNC_TIME'],
  [20001,'G_LOGIN_GATEWAY'], [3841,'U_G_LOGIN_GATEWAY'], [3,'U_C_PLAYER_INFO'], [6,'U_C_PLAYER_LOGINSTATEE'],
  [54,'U_C_BAG_MOVE'],[115,'U_C_BAG_MOVE_UPDATE'],
  [5005,'C_BAG_MOVE'],[150,'U_C_SERIAL_ARMY'],[301,'U_C_FASHION_INFO'],[537,'U_C_SYSTEMOPEN_ALLREADY'],
  [5127,'U_C_CAMPAIGN_TRAINING'],[1,'U_C_PLAYER_NOVICE'],[5017,'U_C_PLAYER_NOVICE'],[5125,'U_C_CAMPAIGN_ARRIVE'],[9,'U_C_CAMPAIGN_ARRIVE'],[31,'U_C_CAMPAIGN_CALLBACK'],[134,'U_C_CAMPAIGN_FINISH'],[5180,'U_C_CAMPAIGN_FINISH'],[5124,'U_C_CAMPAIGN_SYNCPOS'],[10,'U_C_CAMPAIGN_SYNCPOS'],
  [125,'room.RoomCreatedMsg'],[21,'room.RoomEnterMsg'],[127,'campaign.CampaignNodeListMsg'],[128,'campaign.CampaignNodeUpdateMsg'],
  [169,'U_C_ARMY_UPDATE_GRID'],[5004,'C_USER_DISPLAY'],[5181,'C_ARMY_UPDATE_GRID'],[8254,'C_MOVE_POS'],[4167,'U_C_BROAD_POS'],
  [20008,'C_SYNCHRONIZED_TIME'],[4234,'U_C_SYNCHRONIZED_TIME'],[4153,'U_C_LOAD_CASTLE'],[4154,'U_C_LOAD_BUILD'],[4155,'U_C_LOAD_BUILD_ORDER'],[4156,'U_C_LOAD_FRIEND_LIST'],[4157,'U_C_LOAD_WATER'],[4160,'U_C_SEND_SYSPROPERTY'],[4173,'U_C_PLAYER_AASREFRESH'],[4176,'U_C_CHALLENGE_TIME'],[4233,'U_C_SEND_VERSION'],[4245,'U_CH_SNS_REQ'],[5035,'U_PLAYER_CLIENT_STATE'],[8224,'C_LONIG_LOAD_REQ'],[8322,'C_LEED_CLIENT'],
  [5155,'U_C_ARMY_RECRUITED'],[92,'U_C_ARMY_RECRUITED'],[5158,'U_C_ARMY_UPGRADEPAWN'],[95,'U_C_ARMY_UPGRADEPAWN'],[116,'U_C_PAWN_INFO'],
  [157,'U_B_PREPARE'],[156,'U_B_START'],[154,'U_B_PREPARE_OVER'],[153,'U_B_ATTACKING'],[159,'U_B_GAME_OVER'],[4103,'U_BATTLE_REPORT'],[10007,'U_B_USER_LOADOVER'],[10008,'U_B_HERO_ORDER'],
  [8196,'C_NODE_LOCKSTATE'],
  [8267,'C_STAR_MOVE'],[8268,'C_STAR_PICK'],[8269,'C_STAR_RAND'],[8331,'C_STAR_COMPOSE'],[8330,'C_STAR_BATCH'],
  [8794,'C_STAR_SELL_SETTING'],[8858,'C_STAR_ARRANGE'],[8876,'C_STAR_LOCK'],
  [8341,'C_STARSHOP_BUY'],[4261,'U_C_STARSHOP_BUY'],[4410,'U_C_VIP_INFO'],[4128,'U_C_SIMPLEUSER_INFO'],[8200,'C_SIMPLEUSER_INFO'],
  [4178,'U_C_START_MOVE_UPDATE'],[4179,'U_C_STAR_PICK'],[4180,'U_C_STAR_RAND'],[4479,'U_C_STAR_COMPOSE'],
  [9041,'C_STARGAZING_OP'],[275,'U_C_STARGAZING_INFO'],[276,'U_C_STARGAZING_DIG_INFO'],
  [8266,'C_PLAYER_SIGN_CMD'],[4177,'U_C_PLAYER_SIGN'],[5157,'U_C_ARMY_DEMOBPAWN'],[94,'U_C_ARMY_DEMOBPAWN'],
  [4105,'U_C_NPC_CHASE_ARMY'],[83,'U_CH_CHANNEL_CHA'],[75,'U_B_HERO_ORDER'],
  [8297,'C_TOWER_INFO'],[4373,'U_C_TOWERLIST'],[4205,'U_C_TOWERINFO'],[8296,'C_ENTER_TOWER'],[8299,'C_TOWER_RESET'],[8300,'C_TOWER_LIVE'],
  [8530,'C_MOUNT_AVATARLIST'],[8567,'C_MOUNT_INFO_SEND'],[8529,'C_MOUNT_EDIT'],[8532,'C_MOUNT_CHANGE'],[8536,'C_MOUNTAVATAR_ACTIVE'],
  [4426,'U_C_MOUNT_UPDATE'],[4427,'U_C_MOUNT_AVATARLIST'],
  [8594,'C_FASHION_COMPOSE'],[4487,'U_C_FASHION_COMPOSE'],[8595,'C_FASHION_SWITCH'],[4488,'U_C_FASHION_SWITCH'],
  [8757,'C_UIPLAY_CHALLENGE'],[4743,'U_C_UIPLAY_LIST'],[4744,'U_C_UIPLAY_INFO'],
  [8528,'C_CAMPAIGN_SWEEP'],[4425,'U_C_CAMPAIGN_SWEEP'],
  [8879,'C_CHALLENGE_REQUEST'],[8329,'C_TAKE_CHALLENGEREWARD'],[4243,'U_C_TAKECHALLENGE_RESULT'],[4244,'U_C_ISTAKE_CHALLENGEREWARD'],
  [8327,'C_GOLD_IMPOSE'],[4242,'U_C_GOLD_IMPOSERESULT'],[8782,'C_ONLINE_REWARD'],[4697,'U_C_ONLINE_REWARD'],
  [8788,'C_ONLINE_REWARD_ENSURE'],[8784,'C_GRADE_PACKET'],[4699,'U_C_GRADE_PACKET'],[4700,'U_C_GRADE_PACKET_RECEIVE'],
  [9972,'C_GROWTH_FUND_LEVEL'],[512,'C_GROWTH_FUND_LEVEL_INFO'],
  [274,'U_C_TATTOO_RSP'],[9568,'C_TATTOO_REQ'],[8450,'C_MARKET_INFO_REQ'],
  [8608,'C_EXTRAJOB_REQ'],[8609,'C_EXTRAJOBEQUIP_REQ'],[449,'U_EXTRAJOB_LIST'],[450,'U_EXTRAJOB_EQUIP_LIST']
]);
const stats = { initLoads:0, initMessages:0, syncResponses:0, worldBootstraps:0, unknownPackets:0, lists: 0, wsConnected: 0, wsTotal: 0, binaryFrames: 0, packets: 0, lastCode: null, loginRequests: 0, responses: 0, badChecksums: 0 };
const diagnosticEvents=[];
const outboundEvents=[];
const diagnosticWarnings=[];
const browserErrors=[];
const staticMissing=[];
const socketShimClient={loaded:false,nativePrototypeHasDestroy:false,seenAt:null};
const bootObserver={enabled:BOOT_OBSERVER, loaded:false, seenAt:null, observedSteps:[], latestStep:0};
const sceneObserver={enabled:SCENE_OBSERVER, loaded:false, seenAt:null, readings:[]};
const loginLoadShapes=[];
function safeBrowserError(kind,msg) {
  if(!['error','rejection','console.error'].includes(kind) || typeof msg!=='string') return null;
  const safe=msg.slice(0,1400)
    .replace(/(?:https?:\/\/|wss?:\/\/)[^\s)]+/gi,'[URL]')
    .replace(/[A-Z]:\\Users\\[^\\\s]+\\/gi,'[PASTA_USUARIO]\\')
    .replace(/\b(password|passwd|pwd|token|secret|cookie|authorization|sessionkey|apikey|hash)\s*[:=]\s*[^\s;,}]+/gi,'$1=[REDACTED]')
    .replace(/(?:\?|&)(?:token|key|password|auth|session)=[^\s&#]+/gi,'[PARAM_PRIVADO]')
    .replace(/\b(sign|username|account|access_token|platformid)\s*=\s*[^&\s;,)\]}]+/gi,'$1=[REDACTED]');
  return {time:new Date().toISOString(),kind,message:safe.slice(0,700)};
}
function recordBrowserError(evt) {
  const last=browserErrors.at(-1);
  if(last && last.kind===evt.kind && last.message===evt.message && Date.parse(evt.time)-Date.parse(last.time)<4000) {
    last.repeats=(last.repeats||1)+1;return;
  }
  browserErrors.push(evt);if(browserErrors.length>60)browserErrors.shift();
}
function noteMissingAsset(reqPath) {
  const pathOnly=String(reqPath||'').split('?')[0].slice(0,240);
  if(!/^\/(?:js|res|libs|misc)\//.test(pathOnly))return;
  const entry=staticMissing.find(x=>x.path===pathOnly);
  if(entry){entry.count++;return;}
  staticMissing.push({path:pathOnly,count:1});if(staticMissing.length>50)staticMissing.shift();
}

function inspectPbShape(data) {
 if(!Buffer.isBuffer(data)||!data.length)return {possibleProtobuf:true,fields:[]};
 if(data.length>65535)return {possibleProtobuf:false,reason:'large'};
 let at=0,count=0,fields=[];
 function vint(){let ret=0n,shift=0n;
   for(let i=0;i<10;i++){
    if(at>=data.length)throw Error('truncated');
    const b=data[at++];ret|=BigInt(b&0x7f)<<shift;
    if(!(b&128))return ret;
    shift+=7n;
   }throw Error('varint');
 }
 try {
  while(at<data.length&&count<70){
   const tag=vint();const field=Number(tag>>3n),wire=Number(tag&7n);
   if(field<1||field>20000)throw Error('field');
   if(![0,1,2,5].includes(wire))throw Error('wire');
   fields.push(`${field}:${wire}`);
   if(wire===0)vint();
   else if(wire===1)at+=8;
   else if(wire===5)at+=4;
   else {const size=vint();if(size>BigInt(data.length-at))throw Error('length');at+=Number(size);}
   if(at>data.length)throw Error('truncated');
   count++;
  }
  return {possibleProtobuf:at===data.length,fields:[...new Set(fields)].slice(0,40),truncated:at!==data.length};
 }catch(e){return {possibleProtobuf:false,fields:[]};}
}

function diagnosticEvent(parsed,id,packet) {
 const shape=(!CODE_NAMES.has(parsed.code)||parsed.code===8224)?inspectPbShape(packet.subarray(20)):undefined;
 if(parsed.code===8224){ loginLoadShapes.push({time:new Date().toISOString(),connection:id,fields:shape.fields||[],bytes:parsed.bodyBytes});if(loginLoadShapes.length>60)loginLoadShapes.shift(); }
 const record={time:new Date().toISOString(),code:parsed.code,
    name:CODE_NAMES.get(parsed.code)||'NAO_IDENTIFICADO',possibleNames:(protocolLookup[String(parsed.code)]||[]).slice(0,12),shape,connection:id,
    length:parsed.length,bytes:parsed.bodyBytes,checksumOk:parsed.checksumOK};
 diagnosticEvents.push(record);
 if(diagnosticEvents.length>150)diagnosticEvents.shift();
 if(!CODE_NAMES.has(parsed.code)){
   stats.unknownPackets++;
   diagnosticWarnings.push({time:record.time,code:parsed.code,
       warning:'Pacote ainda sem interpretacao validada; nenhum payload sensivel foi gravado',
       possibleNames:(protocolLookup[String(parsed.code)]||[]).slice(0,12)});
   if(diagnosticWarnings.length>70)diagnosticWarnings.shift();
 }
 stats.byCode ??={};
 stats.byCode[String(parsed.code)]=(stats.byCode[String(parsed.code)]||0)+1;
}
const log = (...args) => {
  const line=new Date().toISOString()+' '+args.map(String).join(' ').replace(/(sign|password|token)=([^&\s]+)/gi,'$1=[omitido]');
  console.log(line);
  try {
    fs.mkdirSync(path.join(__dirname,'logs'), { recursive: true });
    fs.appendFileSync(path.join(__dirname,'logs','operacao-servidor.log'),line+'\n');
  } catch (_) {}
};
function transition(state,phase,event){if(sessionState.advance(state,phase,event))log(`[SESSAO #${state.id}] ${phase} (${event})`);}

function listData() {
  return {
    ret: 0, msg: 'Laboratorio local v0.8.2', curTime: Date.now(),
    platformId: 1, platformName: 'Local', isWhiteUser: false,
    groups: [{groupId:1, groupName:'Local', order:1, sites:[{
      siteId:1, siteName:'S1', showName:'S1 - Local (teste)', type:1,
      order:1, isOpen:true, isRepair:false, openTime:0, mainSite:'S1',
      loginUrl:`ws://${HOST}:${WS_PORT}/ws`, webUrl:`http://${HOST}:${API_PORT}`
    }]}]
  };
}
function headersCors(req, res) {
  const o = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', o || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length');
  return true;
}
function reply(res, code, body, type='text/plain; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  });
  res.end(body);
}

function proxyStaticAsset(req,res) {
  const dest = http.request({ hostname:STATIC_HOST, port:STATIC_PORT, path:req.url,
    method:'GET', headers:{'Accept':req.headers.accept || '*/*'} }, upstream=>{
    res.writeHead(upstream.statusCode || 502, {
      'Content-Type': upstream.headers['content-type'] || 'application/octet-stream',
      'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'
    }); upstream.pipe(res);
  });
  dest.setTimeout(8000,()=>dest.destroy(new Error('Timeout no servidor estatico 8081')));
  dest.on('error',e=>{log('[RECURSOS] Falha no 8081:',e.message);
    if(!res.headersSent)reply(res,502,'Servidor de arquivos 8081 indisponivel');else res.destroy();});
  dest.end();
}
function parseFormNickname(req,res) {
  let received=0, stopped=false, parts=[];
  req.on('data', chunk=>{received+=chunk.length;if(received>MAX_FORM){
    if(!stopped){stopped=true;reply(res,413,'Formulario excede limite');}return;}
    parts.push(chunk);
  });
  req.on('end',async()=>{if(stopped)return;
    try{
      const params=new URLSearchParams(Buffer.concat(parts).toString('utf8'));
      const nick=(params.get('nickname')||'').trim();
      const valid=nick.length>=2 && nick.length<=24 && !/[\x00-\x1F<>]/.test(nick);
      const available=valid && !(await db.nicknameExists(nick,'S1'));
      const xml=`<?xml version="1.0" encoding="utf-8"?><Result value="${available?'true':'false'}" message="${available?'OK':'Nome indisponivel'}"/>`;
      reply(res,200,xml,'text/xml; charset=utf-8');
      stats.nicknameChecks=(stats.nicknameChecks||0)+1;
      log(`[NICK] Verificacao local ${available?'DISPONIVEL':'INDISPONIVEL'} | consultas:${stats.nicknameChecks}`);
    }catch(e){log('[DB] Erro ao verificar nickname:',e.code||e.message);reply(res,503,'Banco local indisponivel');}
  });
}

const GAME_PORT = STATIC_PORT;
const MIME = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8',
 '.json':'application/json; charset=utf-8','.xml':'application/xml; charset=utf-8',
 '.zip':'application/octet-stream','.png':'image/png','.jpg':'image/jpeg',
 '.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon',
 '.css':'text/css; charset=utf-8','.ogg':'audio/ogg','.mp3':'audio/mpeg',
 '.wav':'audio/wav','.bin':'application/octet-stream','.atlas':'text/plain; charset=utf-8'};
function locateWebroot() {
 const hint=path.join(__dirname,'webroot.path.txt');
 let values=[];
 if(fs.existsSync(hint)){
   const v=fs.readFileSync(hint,'utf8').replace(/^\uFEFF/,'').trim();
   if(v)values.push(path.resolve(__dirname,v));
 }
 values.push(path.resolve(__dirname,'..'),path.resolve(__dirname,'../webroot_web'),
             path.resolve(__dirname,'../../webroot_web'),path.resolve(__dirname,'../..'));
 for(const candidate of values){
   if(fs.existsSync(path.join(candidate,'index.html')) &&
      fs.existsSync(path.join(candidate,'js')) &&
      fs.existsSync(path.join(candidate,'res')))return fs.realpathSync(candidate);
 }
 return null;
}
let webroot=locateWebroot();
const gameHttp=http.createServer((req,res)=>{
  if(req.method==='GET'&&req.url==='/__wartune_game_observer.js')return reply(res,200,fs.readFileSync(path.join(__dirname,'game-observer.js')),'application/javascript; charset=utf-8');
  if(req.method==='POST'&&req.url==='/__wartune_game_probe'){
   let size=0,parts=[];req.on('data',b=>{size+=b.length;if(size<=60000)parts.push(b);});
   req.on('end',()=>{if(size>60000)return reply(res,413,'Too large');
    try{const v=JSON.parse(Buffer.concat(parts));if(!Number.isSafeInteger(v.characterId))return reply(res,400,'Invalid character');
     gameTraces.push({time:new Date().toISOString(),...v});if(gameTraces.length>20)gameTraces.shift();
     const s=[...sessions].find(s=>s.gatewayId===v.characterId&&!s.closed);
     if(s?.phase==='WORLD_SYNCED'&&v.world?.hasView&&v.events?.some(e=>e.name==='__bagUpdateHandler'&&e.detail==='exit'))
       transition(s,'PLAYER_READY','client-observed-hero-and-bag-handler');
     return reply(res,204,'');
    }catch(e){return reply(res,400,'Invalid probe');}});return;
  }
  if(req.method==='GET' && req.url.startsWith('/api/set-vip')){
    const u = new URL(req.url, 'http://127.0.0.1');
    const charId = Number(u.searchParams.get('charId'));
    const nickname = u.searchParams.get('nickname');
    const level = Math.max(0, Math.min(10, Number(u.searchParams.get('level') || 0)));
    const days = Math.max(1, Number(u.searchParams.get('days') || 365));
    const expireTime = level > 0 ? new Date(Date.now() + days * 86400 * 1000) : null;
    (async () => {
      try {
        let targetId = charId;
        if (!targetId && nickname) {
          const [rows] = await db.ready().execute('SELECT id FROM characters WHERE nickname = ? LIMIT 1', [nickname]);
          if (rows.length) targetId = rows[0].id;
        }
        if (!targetId) return reply(res, 400, JSON.stringify({ error: 'Personagem não encontrado' }), 'application/json');
        await db.updateCharacterVip(targetId, {
          vip_level: level,
          vip_type: 1,
          vip_expire_time: expireTime,
          vip_points: level * 1000
        });
        const char = await db.characterById(targetId);
        const session = [...sessions].find(s => s.gatewayId === targetId && !s.closed);
        if (session) {
          session.character = char;
          sendVipInfo(session);
        }
        return reply(res, 200, JSON.stringify({ success: true, charId: targetId, vip_level: level, expire: expireTime }), 'application/json');
      } catch (err) {
        return reply(res, 500, JSON.stringify({ error: err.message }), 'application/json');
      }
    })();
    return;
  }
  if(req.method==='POST' && new URL(req.url||'/', 'http://127.0.0.1').pathname==='/clientlog'){
    let total=0,parts=[];
    req.on('data',buf=>{total+=buf.length;if(total<=65536)parts.push(buf);});
    req.on('end',()=>{
      if(total>65536){res.writeHead(413);return res.end();}
      try{
        const obj=JSON.parse(Buffer.concat(parts).toString('utf8'));
        const evt=safeBrowserError(obj.kind,obj.msg);
        if(evt)recordBrowserError(evt);
      }catch(_){}
      res.writeHead(204,{'Cache-Control':'no-store'});res.end();
    });
    return;
  }
  if(req.method==='POST' && req.url.split('?')[0]==='/__wartune_shim_probe'){
    if(!SOCKET_SHIM)return reply(res,404,'Patch desativado');
    let size=0,parts=[];
    req.on('data',chunk=>{size+=chunk.length;if(size<=256)parts.push(chunk);});
    req.on('end',()=>{
      if(size>256)return reply(res,413,'Payload longo');
      try{
        const status=JSON.parse(Buffer.concat(parts).toString('utf8'));
        socketShimClient.loaded=true;
        socketShimClient.nativePrototypeHasDestroy=status.nativePrototypeHasDestroy===true;
        socketShimClient.seenAt=new Date().toISOString();
      }catch(_){return reply(res,400,'Probe invalido');}
      res.writeHead(204,{'Cache-Control':'no-store'});res.end();
    });
    return;
  }
  if(req.method==='POST' && req.url.split('?')[0]==='/__wartune_boot_probe'){
    if(!BOOT_OBSERVER)return reply(res,404,'Observador desativado');
    let size=0,parts=[];
    req.on('data',buf=>{size+=buf.length;if(size<=256)parts.push(buf);});
    req.on('end',()=>{
      if(size>256)return reply(res,413,'Payload extenso');
      try{
        const data=JSON.parse(Buffer.concat(parts).toString('utf8'));
        if(data.type==='loaded') { bootObserver.loaded=true;bootObserver.seenAt=new Date().toISOString(); }
        else if(data.type==='step'){
          const step=Number(data.step),handler=String(data.handler||'');
          if(!Number.isInteger(step)||step<0||step>20||!/^__[A-Za-z]{3,40}(?:Handler)?$/.test(handler))return reply(res,400,'Etapa invalida');
          const item={time:new Date().toISOString(),step,handler};
          bootObserver.observedSteps.push(item);
          if(bootObserver.observedSteps.length>35)bootObserver.observedSteps.shift();
          bootObserver.latestStep=Math.max(bootObserver.latestStep,step);
        }else return reply(res,400,'Evento invalido');
      }catch(_){return reply(res,400,'JSON invalido');}
      res.writeHead(204,{'Cache-Control':'no-store'});res.end();
    });return;
  }
  if(req.method==='POST' && req.url.split('?')[0]==='/__wartune_scene_probe'){
    if(!SCENE_OBSERVER)return reply(res,404,'Observador desativado');
    let total=0,parts=[];
    req.on('data',c=>{total+=c.length;if(total<=1800)parts.push(c);});
    req.on('end',()=>{
      if(total>1800)return reply(res,413,'Registro longo');
      try{
        const v=JSON.parse(Buffer.concat(parts).toString('utf8'));
        const number=(n,max)=>Number.isInteger(n)&&n>=0&&n<=max?n:null;
        const cls=(arr)=>Array.isArray(arr)?arr.slice(0,8).filter(x=>typeof x==='string'&&/^[\w$.-]{1,65}$/.test(x)):[];
        const record={time:new Date().toISOString(),
          layaReady:v.layaReady===true,
          stageChildren:number(v.stageChildren,10000),
          stageNames:cls(v.stageNames),
          guiReady:v.guiReady===true,
          guiChildren:number(v.guiChildren,10000),
          guiNames:cls(v.guiNames),
          canvasCount:number(v.canvasCount,100),
          visibleCanvases:number(v.visibleCanvases,100),
          tree:v.tree&&typeof v.tree==='object'?{nodes:number(v.tree.nodes,1200),hidden:number(v.tree.hidden,1200),alphaZero:number(v.tree.alphaZero,1200),textured:number(v.tree.textured,1200)}:null,
          event:v.event==='loaded'?'loaded':'sample'};
        if(record.event==='loaded'){sceneObserver.loaded=true;sceneObserver.seenAt=record.time;}
        sceneObserver.readings.push(record);
        if(sceneObserver.readings.length>60)sceneObserver.readings.shift();
      }catch(_){return reply(res,400,'Formato invalido');}
      res.writeHead(204,{'Cache-Control':'no-store'});res.end();
    });return;
  }
  if(req.method==='GET'&&req.url.split('?')[0]==='/__wartune_scene_observer.js'){
    if(!SCENE_OBSERVER)return reply(res,404,'Observador desativado');
    return reply(res,200,fs.readFileSync(path.join(__dirname,'scene-observer.js')),'application/javascript; charset=utf-8');
  }
  if(req.method==='GET'&&req.url.split('?')[0]==='/__wartune_boot_observer.js'){
    if(!BOOT_OBSERVER)return reply(res,404,'Observador desativado');
    return reply(res,200,fs.readFileSync(path.join(__dirname,'boot-observer.js')),'application/javascript; charset=utf-8');
  }
  if(req.method==='GET' && req.url.split('?')[0]==='/__wartune_socket_compat.js'){
    if(!SOCKET_SHIM)return reply(res,404,'Compatibilidade desabilitada');
    return reply(res,200,fs.readFileSync(path.join(__dirname,'socket-compat.js')),'application/javascript; charset=utf-8');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }
  if ((req.method === 'POST' || req.method === 'GET') && (req.url === '/order/clientsiteinfoservlet' || req.url === '/clientsiteinfoservlet' || req.url.includes('clientsiteinfoservlet'))) {
    let received = 0, stopped = false;
    req.on('data', chunk => {
      received += chunk.length;
      if (received > MAX_FORM && !stopped) { stopped = true; reply(res, 413, 'Formulario excede o limite'); req.resume(); }
    });
    req.on('end', () => {
      if (stopped) return;
      const payload = zlib.deflateSync(Buffer.from(JSON.stringify(listData()), 'utf8'));
      stats.lists++;
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Expose-Headers': 'Content-Length',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(payload.length),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(payload);
      log(`[S1-gameHttp] Lista enviada (${payload.length} bytes, zlib) | pedidos:${stats.lists}`);
    });
    return;
  }
  if (req.method==='POST' && new URL(req.url||'/', 'http://127.0.0.1').pathname==='/nicknamecheck') return parseFormNickname(req,res);
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
  if(!webroot){res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Cliente nao localizado. Leia LEIA-ME.md, configure webroot.path.txt.');}
  let pathname;
  try{
    pathname=decodeURIComponent(new URL(req.url||'/', 'http://127.0.0.1').pathname);
  }catch(e){res.writeHead(400);return res.end();}
  if(pathname.includes('\0')||pathname.includes('\\')){res.writeHead(400);return res.end();}
  if(pathname==='/')pathname='/index.html';
  if (pathname === '/siteConfig.json') {
    const dynamicConfig = {
      siteConfig: [
        {
          SITE_ZONE: [
            {
              area: 1, siteID: 1, platformID: "1",
              siteName: { zhcn: "美洲", en: "America", de: "Amerika", es: "América", pt: "América", tr: "Amerika", fr: "Amérique" },
              siteOrder: `http://${HOST}:${API_PORT}/order/`,
              baseUrl: "https://bm-wan-abstract-sdk.wan.com/",
              appId: 10180, packageId: 455, android_packageId: 455, iOS_packageId: 465, official_packageId: 505,
              YOUME: "YOUMED0360EB2D54A2AFFB105335CE6DF3BB23771B383",
              localCDN: "forbidden"
            }
          ],
          ORDER_PATH: `http://${HOST}:${API_PORT}/order/`,
          REQUEST_PATH: `http://${HOST}:${API_PORT}/`,
          ResourcePath: "",
          PAY: "",
          UPLOAD_PATH: "http://121.10.143.167:8085/"
        }
      ]
    };
    return reply(res, 200, JSON.stringify(dynamicConfig, null, 2), 'application/json; charset=utf-8');
  }
  if(pathname==='/imgNetSpeedTest.png')pathname='/netSpeedTest-ca84938e6a.png';
  if(pathname.split('/').some(part=>part.startsWith('.')||/^Wartune_Ultra_Backend/i.test(part)||/^REFERENCIAS_BANCO_LEGADO$/i.test(part)) || /(?:config\.local|candidato\.path|webroot\.path)/i.test(pathname)){res.writeHead(403);return res.end();}
  if(pathname==='/js/bundle_release-ad60bfe795.js'){
    const patchedBundle=path.join(__dirname,'client-p0','js','bundle_release-ad60bfe795.js');
    if (fs.existsSync(patchedBundle)) {
      return fs.stat(patchedBundle,(error,stat)=>{
        if(error||!stat.isFile())return reply(res,503,'Bundle de combate indisponivel');
        res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8',
          'Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        if(req.method==='HEAD')return res.end();
        const stream=fs.createReadStream(patchedBundle);
        stream.on('error',()=>res.destroy());stream.pipe(res);
      });
    }
  }

  function resolveHashedFile(targetPath) {
    if (fs.existsSync(targetPath)) return targetPath;
    const dir = path.dirname(targetPath);
    const ext = path.extname(targetPath);
    const base = path.basename(targetPath, ext);
    if (!fs.existsSync(dir)) return null;
    try {
      const files = fs.readdirSync(dir);
      const found = files.find(f => f.startsWith(base + '-') && f.endsWith(ext));
      return found ? path.join(dir, found) : null;
    } catch (_) {
      return null;
    }
  }

  let file = path.resolve(webroot, '.' + pathname);
  if (!(file === webroot || file.startsWith(webroot + path.sep))) { res.writeHead(403); return res.end(); }
  const hashedCandidate = resolveHashedFile(file);
  if (hashedCandidate) file = hashedCandidate;

  fs.realpath(file, (err, real) => {
    if (err || !(real === webroot || real.startsWith(webroot + path.sep))) {
      if (pathname.startsWith('/res/animation/') && pathname.endsWith('.json')) {
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600'});
        const imgName = path.basename(pathname, '.json') + '.png';
        return res.end(JSON.stringify({frames: {}, meta: {image: imgName, format: 'RGBA8888', size: {w: 1, h: 1}, scale: 1}}));
      }
      if (pathname.startsWith('/res/animation/') && pathname.endsWith('.png')) {
        const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
        res.writeHead(200, {'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600'});
        return res.end(transparentPng);
      }
      noteMissingAsset(req.url); res.writeHead(404); return res.end();
    }
    fs.stat(real, (e, stat) => {
      if (e || !stat.isFile()) {
        if (pathname.startsWith('/res/animation/') && pathname.endsWith('.json')) {
          res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600'});
          const imgName = path.basename(pathname, '.json') + '.png';
          return res.end(JSON.stringify({frames: {}, meta: {image: imgName, format: 'RGBA8888', size: {w: 1, h: 1}, scale: 1}}));
        }
        if (pathname.startsWith('/res/animation/') && pathname.endsWith('.png')) {
          const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
          res.writeHead(200, {'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600'});
          return res.end(transparentPng);
        }
        noteMissingAsset(req.url); res.writeHead(404); return res.end();
      }
      if (pathname.toLowerCase() === '/siteconfig.json') {
        fs.readFile(real,'utf8',(loadErr,raw)=>{
          if(loadErr){res.writeHead(500);return res.end();}
          try{
            const config=JSON.parse(raw),orderUrl=`http://127.0.0.1:${API_PORT}/order/`;
            const groups=Array.isArray(config.siteConfig)?config.siteConfig:[];
            for(const group of groups){
              if(!group||typeof group!=='object')continue;
              group.ORDER_PATH=orderUrl;
              if(Array.isArray(group.SITE_ZONE))for(const zone of group.SITE_ZONE)
                if(zone&&typeof zone==='object')zone.siteOrder=orderUrl;
            }
            const body=JSON.stringify(config);
            res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),
              'Cache-Control':'no-store','X-Wartune-Version':APP_VERSION,'X-Wartune-Api-Port':String(API_PORT)});
            return res.end(body);
          }catch(_){res.writeHead(502);return res.end('siteConfig.json invalido');}
        });
        return;
      }
      if((SOCKET_SHIM||BOOT_OBSERVER||SCENE_OBSERVER) && pathname==='/index.html' && req.method==='GET'){
        fs.readFile(real,'utf8',(loadErr,html)=>{
          if(loadErr){res.writeHead(500);return res.end();}
          const tags=[(BOOT_OBSERVER||SCENE_OBSERVER)?'<script src="/__wartune_game_observer.js"></script>':'',SOCKET_SHIM?'<script src="/__wartune_socket_compat.js"></script>':'',
            BOOT_OBSERVER?'<script src="/__wartune_boot_observer.js"></script>':'',
            SCENE_OBSERVER?'<script src="/__wartune_scene_observer.js"></script>':''].filter(Boolean).join('\n');
          const patched=/<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i,match=>match+'\n'+tags)
                : tags+'\n'+html;
          return reply(res,200,patched,'text/html; charset=utf-8');
        });
        return;
      }
      if((BOOT_OBSERVER||SCENE_OBSERVER)&&pathname==='/js/bundle_release-ad60bfe795.js'){
       const source=fs.readFileSync(real,'utf8'),anchor='FQt.version="4.1.7.0"';
       if(source.split(anchor).length!==2)return reply(res,500,'Unsupported client observation anchor');
       const observer='window.__wartuneTrace&&window.__wartuneTrace.install({hero:()=>n0._instance&&n0._instance.army&&n0._instance.army.userId>0?n0._instance.thane:null,army:()=>n0.Instance.army,world:()=>zS.Instance.model,scene:()=>s6.Instance.currentType,guiRoot:()=>GM.Instance.getMainToolBar()||fgui.GRoot.inst,player:()=>G$.Instance.currentPlayerModel.playerInfo,gold:()=>qo.Instance.gold.count,methods:[[n0.prototype,"__getArmyListHandler"],[n0.prototype,"__uHeroInfoHandler"],[dJ.prototype,"__bagUpdateHandler"],[U5.prototype,"layMapArmy"],[U5.prototype,"createMapArmy"],[Ok.prototype,"handleSystemopenAlready"]]});';
       return reply(res,200,source.replace(anchor,observer+anchor),'application/javascript; charset=utf-8');
      }
      res.writeHead(200,{'Content-Type':MIME[path.extname(real).toLowerCase()]||'application/octet-stream',
        'Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      if(req.method==='HEAD')return res.end();
      const stream=fs.createReadStream(real);
      stream.on('error',()=>res.destroy());stream.pipe(res);
    });
  });
});

const api = http.createServer((req,res)=>{
  const url = new URL(req.url || '/',`http://${HOST}:${API_PORT}`);
  const route=url.pathname.replace(/\/+$/,'') || '/';
  if (!headersCors(req,res)) return reply(res,403,'Origem bloqueada');
  if (req.method==='OPTIONS') return reply(res,204,'');
  const versionInfo={version:APP_VERSION,apiPort:API_PORT,websocketPort:WS_PORT,clientPort:GAME_PORT,
    clientDirectory:webroot||null,environment:APP_ENVIRONMENT,buildId:BUILD_ID,
    developmentModes:{roster:process.env.WARTUNE_DEV_ROSTER==='1',ui:process.env.WARTUNE_DEV_UI==='1',resources:process.env.WARTUNE_DEV_RESOURCES==='1',testItems:process.env.WARTUNE_DEV_TEST_ITEMS==='1',bootObserver:BOOT_OBSERVER,sceneObserver:SCENE_OBSERVER}};
  if(req.method==='GET'&&route==='/versao'){
    return reply(res,200,JSON.stringify(versionInfo,null,2),'application/json; charset=utf-8');
  }
  if(req.method==='GET'&&route==='/diagnostico/ambiente'){
    return reply(res,200,JSON.stringify({...versionInfo,pid:process.pid,buildTime:BUILD_TIME,database:db.status(),
      activeSessions:[...sessions].filter(s=>s.gatewayId&&!s.closed).length,experimentalBootstrap:INIT_EXPERIMENTAL,
      protocol:{clientBundle:'bundle_release-ad60bfe795.js',protobuf:'original 6.7.0',headerBytes:20},
      sessions:[...sessions].map(s=>({connection:s.id,characterId:s.gatewayId||null,phase:s.phase||'CONNECTED',heroSent:!!s.heroSent,
       inventorySent:!!s.inventorySnapshotSent,transitions:s.transitions||[]}))},null,2),'application/json; charset=utf-8');
  }
  if(req.method==='GET'&&route==='/diagnostico/cliente')return reply(res,200,JSON.stringify({versionInfo,readings:gameTraces},null,2),'application/json; charset=utf-8');
  if(req.method==='GET'&&route==='/diagnostico/movimento')return reply(res,200,JSON.stringify({versionInfo,events:movementEvents},null,2),'application/json; charset=utf-8');
  if(req.method==='GET'&&route==='/diagnostico/inventario')return reply(res,200,JSON.stringify({versionInfo,events:inventoryEvents},null,2),'application/json; charset=utf-8');
  if (req.method==='GET' && ['/health','/'].includes(route)) {
    return reply(res,200,JSON.stringify({status:'ok',stage:'v097-candidato',http:API_PORT,ws:WS_PORT,
      versionInfo,gameplay:false, clientHttp:GAME_PORT, webrootFound:Boolean(webroot), bootstrapPlayer:BOOTSTRAP_PLAYER, login:"simulado-local-persistencia-mysql", ...stats}), 'application/json; charset=utf-8');
  }
  if(req.method==='GET' && route==='/diagnostico'){
    return reply(res,200,JSON.stringify({stage:'v097-candidato',versionInfo,mapaImplementado:false,worldMap:WORLD_MAP,mapAssetProbe:mapConfig.probeAssets(webroot),socketShim:SOCKET_SHIM,socketShimClient,bootObserver,sceneObserver,loginLoadShapes, browserErrors:browserErrors.slice(-30), missingAssets:staticMissing.slice(-30),initExperimental:INIT_EXPERIMENTAL,initFarm:INIT_FARM,initMessageLimit:INIT_MESSAGE_LIMIT, initOutbound:outboundEvents.slice(-45),
      lastPacket:stats.lastCode,packets:stats.packets,unknown:stats.unknownPackets,
      recent:diagnosticEvents.slice(-70),codeCount:stats.byCode||{},
      webrootFound:Boolean(webroot),recentWarnings:diagnosticWarnings.slice(-20)},null,2),'application/json; charset=utf-8');
  }
  if(req.method==='GET' && route==='/erros-cliente') {
    return reply(res,200,JSON.stringify({version:APP_VERSION,versionInfo,quantidade:browserErrors.length,
      erros:browserErrors.slice(-35),recursosAusentes:staticMissing.slice(-30),
      dica:'Nao envie senhas, cookies, tokens ou config.local.json.'},null,2),'application/json; charset=utf-8');
  }
  if(req.method==='GET' && route==='/etapas-inicializacao'){
    const byCode={};for(const e of outboundEvents){byCode[String(e.code)]=(byCode[String(e.code)]||0)+1;}
    return reply(res,200,JSON.stringify({version:APP_VERSION,versionInfo,
      observadorAtivo:BOOT_OBSERVER,observadorNoNavegador:bootObserver.loaded,
      etapaInternaObservada:bootObserver.latestStep,
      etapasProcessadas:bootObserver.observedSteps.slice(-35),
      codigosEnviados:byCode, respostasConfiguradas:INIT_MESSAGE_LIMIT,
      codigosRecebidos:stats.byCode||{},errosBrowser:browserErrors.slice(-12),loginLoadShapes:loginLoadShapes.slice(-20),
      nota:'Etapas sao do protocolo de inicializacao, nao percentual de mapa implementado. Um console personalizado pode nao emitir logs capturaveis.'
    },null,2),'application/json; charset=utf-8');
  }
  if(req.method==='GET' && route==='/diagnostico-mapa'){
    return reply(res,200,JSON.stringify({version:APP_VERSION,versionInfo,selectedMap:WORLD_MAP,assets:mapConfig.probeAssets(webroot),
      explanation:'BaseCastleMsg.mapId (campo protobuf 2) deve corresponder ao Id de t_s_map antes da mensagem 6 que troca a cena.',
      sceneMode:LOGIN_SCENE_STATE,sceneMessages:sceneStateEvents.slice(-10)},null,2),'application/json; charset=utf-8');
  }
  if(req.method==='GET' && route==='/teste-estado-cena'){
    return reply(res,200,JSON.stringify({version:APP_VERSION,versionInfo,worldMap:WORLD_MAP,modoAtivo:LOGIN_SCENE_STATE,envios:sceneStateEvents.slice(-25),observador:sceneObserver.readings.slice(-12),observacao:'Resposta 6 experimental; nao garante mapa funcional.'},null,2),'application/json; charset=utf-8');
  }
  if(req.method==='GET' && route==='/estado-cena'){
    return reply(res,200,JSON.stringify({version:APP_VERSION,versionInfo,cenaImplementada:false,loginSceneState:LOGIN_SCENE_STATE,sceneStateEvents:sceneStateEvents.slice(-25),
      observadorAtivo:SCENE_OBSERVER,observadorCarregado:sceneObserver.loaded,
      ultimasLeituras:sceneObserver.readings.slice(-30),
      solicitacoes8224:loginLoadShapes.slice(-25),
      passos:bootObserver.observedSteps.slice(-15),
      errosBrowser:browserErrors.slice(-15),
      observacao:'Leituras do Laya.stage e FairyGUI sao apenas sinais de cena; nao confirmam jogabilidade.'
    },null,2),'application/json; charset=utf-8');
  }
  if(req.method==='GET' && route==='/catalog/ultra/manifesto'){
    return reply(res,200,JSON.stringify({compatibleLegacy:false, modern:true, tables:modernManifest.files.map(({table,rows})=>({table,rows})), totalRows:modernManifest.files.reduce((n,m)=>n+m.rows,0)}), 'application/json; charset=utf-8');
  }
  if(req.method==='GET' && route==='/catalog/ultra/amostra'){
    const table=url.searchParams.get('table')||'t_s_config';
    const id=url.searchParams.get('id')||'';
    db.modernCatalogSample(table,id).then(rows=>reply(res,200,JSON.stringify({table,id,rows,modern:true,officialClientData:true}),'application/json; charset=utf-8'))
      .catch(e=>reply(res,503,JSON.stringify({error:'Tabela moderna nao importada ou identificador invalido',code:e.code||'CATALOG_ERROR'}),'application/json; charset=utf-8'));
    return;
  }
  if (req.method==='POST' && route==='/nicknamecheck') return parseFormNickname(req,res);
  if (route==='/questionreplaylist') {
    const xml = '<?xml version="1.0" encoding="utf-8"?><Result value="true"><Info/></Result>';
    const deflated = zlib.deflateSync(Buffer.from(xml, 'utf8'));
    return reply(res, 200, deflated, 'application/octet-stream');
  }
  if (req.method==='POST' && route==='/api/inventory/move') {
    let body='';
    req.on('data',chunk=>body+=chunk);
    req.on('end',async()=>{
      try{
        const {characterId,fromType,fromPos,toType,toPos,isTakeOff}=JSON.parse(body);
        const s=[...sessions].find(s=>s.gatewayId===characterId&&!s.closed);
        if(!s)return reply(res,404,JSON.stringify({error:'Sessao nao encontrada'}),'application/json');
        const reqBody=originalPb.encode('item.ItemReqMsg',{
          beginBagType:fromType,
          beginObjId:fromType===4?characterId:0,
          beginPos:fromPos,
          endBagType:toType,
          endObjId:toType===4?characterId:0,
          endPos:toPos,
          count:1,
          objectId:fromType===4?characterId:0,
          isTakeOff:Boolean(isTakeOff)
        });
        await handleItemMove(s,reqBody);
        return reply(res,200,JSON.stringify({success:true}),'application/json');
      }catch(e){
        return reply(res,500,JSON.stringify({error:e.message}),'application/json');
      }
    });
    return;
  }
  if (req.method==='POST' && route==='/api/inventory/sync') {
    let body='';
    req.on('data',chunk=>body+=chunk);
    req.on('end',async()=>{
      try{
        const { characterId } = JSON.parse(body || '{}');
        const charSessions = [...sessions].filter(s => s.gatewayId === characterId && !s.closed);
        if (!charSessions.length) return reply(res, 404, JSON.stringify({error: 'Sessao nao encontrada'}), 'application/json');
        const charData = await db.characterById(characterId);
        for (const s of charSessions) {
          s.character = charData;
          s.heroSent = true;
          s.sceneStateSent = true;
          s.worldRequested = true;
          sendGameSession(s, 3, makeBasicPlayerInfo(charData));
          sendInventorySnapshot(s);
          try {
            const raw = inventoryState.parseState(charData.state_json);
            sendGameSession(s, 109, originalPb.encode('castle.CastleYieldMsg', castleState.formatCastleYieldMsg(raw)));
          } catch (_) {}
        }
        return reply(res, 200, JSON.stringify({success: true, character: { id: charData.id, gold: charData.gold, crystals: charData.crystals, bound_crystals: charData.bound_crystals, energy: charData.energy }}), 'application/json');
      }catch(e){
        return reply(res,500,JSON.stringify({error:e.message}),'application/json');
      }
    });
    return;
  }
  if (req.method === 'POST' && route === '/api/qa/restore-energy') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { characterId, nickname } = JSON.parse(body || '{}');
        let targetId = Number(characterId || 0);
        if (!targetId && nickname) {
          const [rows] = await db.ready().execute('SELECT id FROM characters WHERE nickname = ? LIMIT 1', [nickname]);
          if (rows[0]) targetId = rows[0].id;
        }
        if (!targetId) return reply(res, 400, JSON.stringify({ error: 'characterId ou nickname obrigatorio' }), 'application/json');

        const [charRows] = await db.ready().execute(
          'SELECT c.id, c.nickname, a.username FROM characters c JOIN accounts a ON a.id = c.account_id WHERE c.id = ?',
          [targetId]
        );
        if (!charRows.length) return reply(res, 404, JSON.stringify({ error: 'Personagem nao encontrado' }), 'application/json');

        const maxEnergy = 200;
        await db.mutateCharacterState(targetId, saved => {
          saved.energy = { value: maxEnergy, lastTickHour: Math.floor(Date.now() / 3600000) };
          return { state: saved };
        });

        const charData = await db.characterById(targetId);
        const charSessions = [...sessions].filter(s => s.gatewayId === targetId && !s.closed);
        for (const s of charSessions) {
          s.character = charData;
          sendGameSession(s, 3, makeBasicPlayerInfo(charData));
        }

        return reply(res, 200, JSON.stringify({
          success: true,
          characterId: targetId,
          nickname: charRows[0].nickname,
          energy: maxEnergy,
          message: 'Energia restaurada com sucesso para o maximo legitimo (200).'
        }), 'application/json');
      } catch (err) {
        return reply(res, 500, JSON.stringify({ error: err.message }), 'application/json');
      }
    });
    return;
  }
  if(req.method==='GET' && route==='/api/packets/status') {
    recorder.reloadConfig();
    return reply(res, 200, JSON.stringify({
      mode: recorder.mode,
      active: recorder.isActive(),
      sessionId: recorder.sessionId,
      stats: recorder.stats
    }), 'application/json');
  }
  if(req.method==='POST' && route==='/api/packets/session') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (payload.action === 'start') {
          const sid = recorder.startSession(payload.sessionId, payload.mode || 'DIAGNOSTICO');
          return reply(res, 200, JSON.stringify({ success: true, sessionId: sid, mode: recorder.mode }), 'application/json');
        } else if (payload.action === 'stop') {
          const ended = recorder.endSession();
          return reply(res, 200, JSON.stringify({ success: true, endedSessionId: ended }), 'application/json');
        } else if (payload.action === 'reload') {
          recorder.reloadConfig();
          return reply(res, 200, JSON.stringify({ success: true, mode: recorder.mode }), 'application/json');
        }
        return reply(res, 400, JSON.stringify({ error: 'Acao desconhecida' }), 'application/json');
      } catch (err) {
        return reply(res, 500, JSON.stringify({ error: err.message }), 'application/json');
      }
    });
    return;
  }
  if(req.method==='POST' && route==='/api/packets/ui-event') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        recorder.recordUIEvent(payload);
        return reply(res, 200, JSON.stringify({ success: true }), 'application/json');
      } catch (err) {
        return reply(res, 500, JSON.stringify({ error: err.message }), 'application/json');
      }
    });
    return;
  }
  if(req.method==='GET' && route==='/catalog/tables') {
    db.legacyCatalogTables().then(rows=>reply(res,200,JSON.stringify({legacy:true,compatibleWithUltra:false,tables:rows}),
      'application/json; charset=utf-8'))
      .catch(e=>reply(res,503,JSON.stringify({error:'Catalogo ainda nao importado ou MySQL indisponivel',code:e.code||'DB_ERROR'}),'application/json'));
    return;
  }
  if(req.method==='GET' && route==='/catalog/sample') {
    const table=url.searchParams.get('table')||'Map_info';
    const limit=Math.max(1,Math.min(30,Number.parseInt(url.searchParams.get('limit')||'5',10)||5));
    db.legacyCatalogSample(table,limit).then(rows=>reply(res,200,JSON.stringify({table,legacy:true,compatibleWithUltra:false,rows}),
      'application/json; charset=utf-8'))
      .catch(e=>reply(res,503,JSON.stringify({error:'Consulta indisponivel',code:e.code||'DB_ERROR'}),'application/json'));
    return;
  }
  if ((req.method === 'POST' || req.method === 'GET') && (route === '/order/clientsiteinfoservlet' || route === '/clientsiteinfoservlet' || route.endsWith('/clientsiteinfoservlet') || route.includes('clientsiteinfoservlet'))) {
    let received = 0, stopped = false;
    req.on('data', chunk => {
      received += chunk.length;
      if (received > MAX_FORM && !stopped) { stopped = true; reply(res, 413, 'Formulario excede o limite'); req.resume(); }
    });
    req.on('end', () => {
      if (stopped) return;
      const payload = zlib.deflateSync(Buffer.from(JSON.stringify(listData()), 'utf8'));
      stats.lists++;
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Expose-Headers': 'Content-Length',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(payload.length),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(payload);
      log(`[S1] Lista enviada (${payload.length} bytes, zlib) | pedidos:${stats.lists}`);
    });
    return;
  }
  if (req.method === 'GET' && route !== '/health' && route !== '/') { return proxyStaticAsset(req, res); }
  log(`[HTTP PENDENTE] ${req.method}${route}`);
  reply(res, 404, 'Ainda nao implementado nesta etapa');
});

function decrypt(cipher,key) {
  const out=Buffer.allocUnsafe(cipher.length);
  for (let i=0;i<cipher.length;i++) {
    if(i===0) out[0]=cipher[0]^key[0];
    else {
      key[i%8]=((key[i%8]+cipher[i-1])^i)&255;
      out[i]=((cipher[i]-cipher[i-1])^key[i%8])&255;
    }
  }
  return out;
}
function peekHeader(source,key) {
  if(source.length<4) return null;
  const dec=decrypt(source.subarray(0,4),Uint8Array.from(key));
  if(dec.readUInt16BE(0)!==0x71ab) return null;
  const length=dec.readUInt16BE(2);
  return length>=20&&length<=MAX_PACKET ? length : null;
}
function parsePacket(packet){
  const length=packet.readUInt16BE(2), checksum=packet.readUInt16BE(4);
  let sum=119;
  for(let i=6;i<packet.length;i++)sum+=packet[i];
  const expected=sum & 32639;
  return {length, code:packet.readUInt16BE(6), clientId:packet.readUInt32BE(8),
    checksum,expected,checksumOK:checksum===expected, bodyBytes:packet.length-20};
}
function pbVarint(n) {
  let v=BigInt(n), out=[];
  if(v<0n)throw new Error('varint negativo nao permitido neste teste');
  while(v>127n){out.push(Number(v&127n)|128);v>>=7n;}
  out.push(Number(v));return Buffer.from(out);
}
function pbString(field,value) {
  const v=Buffer.from(String(value),'utf8');
  return Buffer.concat([pbVarint(field*8+2), pbVarint(v.length),v]);
}
function pbInt(field,value) {return Buffer.concat([pbVarint(field*8),pbVarint(value)]);}
function pbMessage(field,contents) {return Buffer.concat([pbVarint(field*8+2),pbVarint(contents.length),contents]);}
function pbRecord(chunks){return Buffer.concat(chunks);}
function pbReadSimple(data, fields) {
  const out={};let p=0;
  function readVar(){let v=0n,shift=0n;
    for(let k=0;k<10;k++){if(p>=data.length)throw Error('protobuf truncado');const b=data[p++];
      v|=BigInt(b&127)<<shift;if(!(b&128))return v;shift+=7n;}
    throw Error('varint muito longo');
  }
  while(p<data.length) {
    const tag=Number(readVar()),field=tag>>>3, wire=tag&7;
    if(!field)throw Error('campo 0 invalido');
    if(wire===0){const v=readVar();if(fields.has(field)&&v<=BigInt(Number.MAX_SAFE_INTEGER))out[field]=Number(v);}
    else if(wire===2){const len=Number(readVar());if(!Number.isSafeInteger(len)||len>data.length-p)throw Error('tamanho invalido');
      if(fields.has(field))out[field]=data.subarray(p,p+len).toString('utf8');p+=len;}
    else if(wire===1){if(p+8>data.length)throw Error('protobuf truncado');p+=8;}
    else if(wire===5){if(p+4>data.length)throw Error('protobuf truncado');p+=4;}
    else throw Error('wire type nao suportado '+wire);
  }
  return out;
}
function readGatewayRequest(body) {
  if(body.length>1024) throw Error('gateway payload muito longo');
  let pos=0,playerId=null,hasKey=false,ekeys=[];
  function vint(){let n=0n,shift=0n;
    for(let k=0;k<10;k++){if(pos>=body.length)throw Error('varint truncado');
      const b=body[pos++];n|=BigInt(b&127)<<shift;
      if(!(b&128)){if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('numero fora da faixa');return Number(n);}shift+=7n;}
    throw Error('varint extenso');
  }
  while(pos<body.length){
    const tag=vint(),field=tag>>>3,wire=tag&7;
    if(!field)throw Error('tag protobuf invalida');
    if(field===1&&wire===0){playerId=vint();continue;}
    if(field===2&&wire===2){const len=vint();if(len>128||pos+len>body.length)throw Error('chave truncada');
      hasKey=/^[a-fA-F0-9]{32}$/.test(body.subarray(pos,pos+len).toString('ascii'));pos+=len;continue;}
    if(field===3&&wire===0){ekeys.push(vint());continue;}
    if(field===3&&wire===2){const len=vint(),end=pos+len;if(len>80||end>body.length)throw Error('chave de sessao truncada');
      while(pos<end)ekeys.push(vint());if(pos!==end)throw Error('packed invalido');continue;}
    if(wire===0){vint();continue;}
    if(wire===2){const len=vint();if(len>body.length-pos)throw Error('comprimento invalido');pos+=len;continue;}
    if(wire===1||wire===5){const size=wire===1?8:4;if(pos+size>body.length)throw Error('campo truncado');pos+=size;continue;}
    throw Error('tipo protobuf nao reconhecido');
  }
  if(!Number.isSafeInteger(playerId)||playerId<0) throw Error(`gateway dados invalidos: playerId=${playerId}`);
  if(!hasKey) {
    log(`[GATEWAY] hasKey=${hasKey}, permitindo autenticacao local para playerId=${playerId}`);
  }
  if(ekeys.length!==8||!ekeys.every(k=>Number.isInteger(k)&&k>=0&&k<=255)) throw Error(`gateway dados invalidos: ekeys.length=${ekeys.length}`);
  return {playerId,ekeys};
}

function makePacket(code,body=Buffer.alloc(0),clientId=0){
  const packet=Buffer.alloc(20+body.length);
  packet.writeUInt16BE(0x71AB,0);packet.writeUInt16BE(packet.length,2);
  packet.writeUInt16BE(code,6);packet.writeUInt32BE(clientId>>>0,8);
  body.copy(packet,20);
  let sum=119;for(let i=6;i<packet.length;i++)sum+=packet[i];
  packet.writeUInt16BE(sum&0x7F7F,4);return packet;
}
function encrypt(plain,key){
  const result=Buffer.allocUnsafe(plain.length);
  for(let i=0;i<plain.length;i++){
    if(i===0)result[i]=plain[i]^key[0];
    else{key[i%8]=((key[i%8]+result[i-1])^i)&255;
      result[i]=((plain[i]^key[i%8])+result[i-1])&255;}
  }
  return result;
}
function sendWsBinary(state,payload) {
  if(state.socket.destroyed||state.closed)return;
  let head;if(payload.length<126){head=Buffer.from([0x82,payload.length]);}
  else if(payload.length<65536){head=Buffer.alloc(4);head[0]=0x82;head[1]=126;head.writeUInt16BE(payload.length,2);}
  else throw Error('resposta excedeu limite');
  state.socket.write(Buffer.concat([head,payload]));
}
function sendGame(state,code,body,clientId=0){
  const plain=makePacket(code,body,clientId);
  const wire=encrypt(plain,Uint8Array.from(DEFAULT_KEY));
  sendWsBinary(state,wire);stats.responses++;
  recorder.recordPacket('S2C', code, body, { clientId, characterId: state.character?.id });
  log(`[WS #${state.id}] Resposta ${code} (${plain.length} bytes, checksum OK, encriptado).`);
}
async function handleLoginFlow(state, parsed, packet){
  if(!parsed.checksumOK){stats.badChecksums++;
    log(`[WS #${state.id}] Pacote${parsed.code} rejeitado: checksum diferente. Sem resposta.`);
    return;
  }
  if(parsed.code===28678){
    let req;
    try {
      req = originalPb.decode('login.createLoginReq', packet.subarray(20));
    } catch(e) {
      log(`[WS #${state.id}] Protobuf invalido para 28678:${e.message}`);
      return;
    }
    const username = String(req.userName || '').trim().slice(0, 48);
    const site = String(req.site || 'S1').trim().slice(0, 32);
    if(!username || !/^[\p{L}\p{N}_.-]{2,48}$/u.test(username) || site !== 'S1'){
      log(`[WS #${state.id}] Conta ou site invalido: "${username}" / "${site}".`);
      state.socket.end();
      return;
    }
    let acc = await db.getAccount(username);
    if(!acc) {
      acc = await db.ensureAccount(username);
      log(`[LOGIN #${state.id}] Nova conta registrada e autenticada: ${username} (ID${acc.id}).`);
    } else {
      log(`[LOGIN #${state.id}] Conta autenticada com sucesso: ${username} (ID${acc.id}).`);
    }
    state.user = acc.username;
    state.site = site;
    state.accountId = acc.id;
    stats.loginRequests++;

    const rsp = {
      userName: state.user,
      site: state.site,
      result: 0
    };
    sendGame(state, 3846, originalPb.encode('login.createLoginRsp', rsp));
    log(`[LOGIN #${state.id}] U_L_CREATE_LOGIN_RSP (3846) enviado com sucesso para${state.user}.`);
  }else if(parsed.code===28672){
    let req;
    try {
      req = originalPb.decode('login.GetPlayerListReq', packet.subarray(20));
    } catch(e) {
      log(`[WS #${state.id}] Protobuf invalido para 28672:${e.message}`);
      return;
    }
    const username = String(req.userName || state.user || '').trim().slice(0, 48);
    const site = String(req.site || state.site || 'S1').trim().slice(0, 32);
    state.user = username;
    state.site = site;

    const chars = await db.accountCharacters(username, site);
    const infoList = chars.map(char => ({
      userId: char.id,
      userName: char.username || username,
      nickName: char.nickname,
      grade: char.grade,
      repute: 0,
      sex: char.sex,
      rename: 0,
      active: true,
      site: char.site,
      isOnline: false
    }));

    const rsp = {
      infoList,
      userName: username,
      site: site,
      loginState: 0
    };
    sendGame(state, 3843, originalPb.encode('login.GetPlayerListRsp', rsp));
    log(`[LOGIN #${state.id}] U_L_GET_PLAYER_LIST (3843) enviado:${infoList.length} personagem(ns) encontrado(s) para conta "${username}".`);
  }else if(parsed.code===28674){
    let req;
    try {
      req = originalPb.decode('login.playerLoginReq', packet.subarray(20));
    } catch(e) {
      log(`[WS #${state.id}] Protobuf invalido para 28674:${e.message}`);
      return;
    }
    const username = String(req.userName || state.user || '').trim().slice(0, 48);
    const site = String(req.site || state.site || 'S1').trim().slice(0, 32);
    const requestedUserId = Number(req.userId || 0);
    state.user = username;
    state.site = site;

    let targetUserId = 0;
    let message = 'Login Succeed No Visualize';
    let hasChar = false;

    if (requestedUserId > 0) {
      const char = await db.characterById(requestedUserId);
      if (char && char.username.toLowerCase() === username.toLowerCase()) {
        targetUserId = char.id;
        message = 'Login Succeed';
        hasChar = true;
      }
    }

    if (!hasChar) {
      const char = await db.accountCharacter(username, site);
      if (char) {
        targetUserId = char.id;
        message = 'Login Succeed';
        hasChar = true;
      } else {
        targetUserId = 0;
        message = 'Login Succeed No Visualize';
      }
    }

    const rsp = {
      userName: username,
      site: site,
      result: true,
      message: message,
      userId: targetUserId,
      gateIp: '127.0.0.1',
      port: WS_PORT,
      todayFirstLogin: false
    };
    sendGame(state, 3844, originalPb.encode('login.playerLoginRsp', rsp));
    log(`[LOGIN #${state.id}] U_L_PREPARE_LOGIN (3844) enviado: ${hasChar ? 'personagem ativo ID ' + targetUserId : 'reserva para criacao ID ' + targetUserId} (${message}).`);
  }
}
async function handleRegister(state,parsed,packet){
  if(!parsed.checksumOK){log(`[REGISTRO #${state.id}] checksum invalido; ignorado.`);return;}
  let data;
  try{
    data = originalPb.decode('login.registerRoleReq', packet.subarray(20));
  }catch(e){
    log(`[REGISTRO #${state.id}] erro no protobuf:${e.message}`);
    return;
  }
  const username = String(data.userName || state.user || '').trim();
  const site = String(data.site || state.site || 'S1').trim();
  const nickname = String(data.nickName || '').trim();
  const sex = Number(data.sex || 0);
  const camp = Number(data.camp || 0);
  const icon = Number(data.icon || 0);

  let result;
  if(!username || site !== 'S1' || nickname.length < 2 || nickname.length > 24 || /[\x00-\x1F<>]/.test(nickname) ||
     ![sex, camp, icon].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 65535) || icon < 1 || icon > 6 ||
     heroState.heroes.get(icon)?.Sexs !== sex){
    result = { ok: false, reason: 'Dados de personagem invalidos.' };
  } else {
    result = await db.registerRole({ username, site, nickname, sex, camp, icon });
  }

  const rsp = {
    userName: username,
    site: 'S1',
    value: result.ok,
    type: result.ok ? 0 : 1,
    message: result.ok ? 'Personagem salvo no MySQL' : result.reason,
    gateIp: '127.0.0.1',
    port: WS_PORT,
    userId: result.ok ? result.id : 0
  };
  if (result.ok) {
    lastRegisteredRole = {
      charId: result.id,
      username,
      time: Date.now()
    };
  }
  sendGame(state, 3845, originalPb.encode('login.registerRoleRsp', rsp));
  log(`[REGISTRO #${state.id}]${result.ok ? 'SALVO ID ' + result.id : 'RECUSADO (' + result.reason + ')'}; resposta 3845.`);
}

function sendGatewayAccepted(state,clientId) {
  const plain=makePacket(3841,Buffer.alloc(0),clientId);
  const wire=encrypt(plain,state.txKey);
  sendWsBinary(state,wire);stats.responses++;
  recorder.recordPacket('S2C', 3841, Buffer.alloc(0), { clientId, characterId: state.character?.id });
  log(`[GATEWAY #${state.id}] Resposta 3841 enviada (chave de sessao, checksum OK).`);
}
function makeBasicPlayerInfo(char) {
  let savedState={};
  try{savedState=char.state_json?(typeof char.state_json==='string'?JSON.parse(char.state_json):char.state_json):{};}catch(_){savedState={};}
  const job=Number.isInteger(char.job)?char.job:savedState?.job;
  const grade=Math.max(1,char.grade||1);
  const data={playerId:char.id,nickName:char.nickname,sex:char.sex,pic:char.icon,camp:char.camp,
    grades:grade,gpOrder:0,noviceProcess:0,
    serverName: char.site || 'S1',
    order:{playerId:char.id,fightCapacityOrder:0,geste_Order:0,charm_Order:0,soulScore_Order:0}};
  if(Number.isInteger(job)&&job>=1&&job<=3)data.job=job;
  if(typeof savedState.newNoviceProcess==='string')data.newNoviceProcess=savedState.newNoviceProcess;
  const questSite=questState.completedQuestLog(savedState);
  if(questSite.length){data.questSite=questSite;data.questSiteLen=questSite.length;}

  const balens = (char.crystals !== undefined && char.crystals !== null) ? Number(char.crystals) : Number(savedState.wallet?.balens || 0);
  const boundBalens = (char.bound_crystals !== undefined && char.bound_crystals !== null) ? Number(char.bound_crystals) : Number(savedState.wallet?.boundBalens || 0);
  data.point = balens;
  data.giftToken = boundBalens;
  data.geste = Number(savedState.wallet?.honor ?? savedState.honor ?? 0);

  const energy = Math.min(200, Math.max(0, (char.energy !== undefined && char.energy !== null) ? Number(char.energy) : Number(savedState.energy?.value || 0)));
  data.weary = energy;
  data.wearyLimit = 200;
  if(savedState.progression){
    const totalXp = Number(savedState.progression.totalXp || 0);
    const atLevel = resourceState.totalAtLevel(grade);
    data.gp = Math.max(0, totalXp - atLevel);
    data.totalGp = totalXp;
  }
  data.starpoint = (savedState.astrals && Number.isSafeInteger(savedState.astrals.points)) ? savedState.astrals.points : 0;
  data.campaignCount = 5;
  data.campaignMaxcount = 5;
  data.terraTempleCount = 0;
  data.terraTempleMaxCount = 1;
  data.trialCount = 0;
  data.trialMaxCount = 1;
  data.guardWarCount = 0;
  data.guardWarMaxCount = 1;
  data.storeGrade = Number(savedState.jewelGrades || 0);
  data.storeGp = Number(savedState.jewelGp || 0);
  data.gradeProcess = Number(savedState.jewelGp || 0);
  try {
    const hero = heroState.heroInfo(char);
    if (hero && typeof hero.fightingCapacity === 'number') {
      data.fightingCapacity = hero.fightingCapacity;
    }
  } catch (_) {}
  return originalPb.encode('player.PlayerMsg',data);
}
async function synchronizeResources(state){
 if(!state.gatewayId||state.closed)return;
 await db.mutateCharacterState(state.gatewayId, saved => {
   const energyRecovery = energyRules.recoverTimedEnergy(saved);
   return { state: saved, energyRecovery };
 });
 state.character=await resourceService.refresh(state.gatewayId);
 const raw=inventoryState.parseState(state.character.state_json);
 sendGameSession(state,3,makeBasicPlayerInfo(state.character));
 sendGameSession(state,109,originalPb.encode('castle.CastleYieldMsg',castleState.formatCastleYieldMsg(raw)));
 if(!state.inventorySnapshotSent){
   state.inventorySnapshotSent=sendInventorySnapshot(state);
 }
}
async function handleSale(state,body,batch){
 if(!state.gatewayId||!state.worldRequested||state.closed)return;
 try{
  const request=batch?originalPb.decode('item.ItemSellReqMsg',body):originalPb.decode('item.ItemReqMsg',body);
  const positions=batch?Array.from(request.selledItemInfos||[],i=>({pos:i.pos,count:i.count})):[{pos:request.beginPos,count:1}];
  const bag=inventoryState.inventory(inventoryState.parseState((await db.characterById(state.gatewayId)).state_json));
  for(const p of positions)if(bag.items.find(i=>i.bagType===1&&i.pos===p.pos)?.count!==p.count)throw Error('Only whole-stack sales validated');
  state.saleRequests??=new Set();const requestKey=body.toString('hex');
  if(state.saleRequests.has(requestKey))return;
  const result=await resourceService.sell(state.gatewayId,positions,id=>itemTemplates.get(id));state.saleRequests.add(requestKey);
  state.character=await db.characterById(state.gatewayId);
  sendGameSession(state,115,makeBagMoveUpdate(result.sold.map(i=>({bagType:1,objectId:0,pos:i.pos}))));
  await synchronizeResources(state);
  inventoryEvents.push({time:new Date().toISOString(),characterId:state.gatewayId,accepted:true,operation:'sale',gold:result.total,instances:result.sold.map(i=>i.instanceId)});
 }catch(e){log(`[VENDA #${state.id}] Recusada:${e.message}`);}
}
function makeSignInfo(char) {
  const v=signSnapshot(char);
  return pbRecord([pbString(1,v.signDate),pbInt(2,v.signTimes),pbInt(4,v.signSite),pbInt(5,v.reissueNum),pbString(6,v.rewardState)]);
}
function sendGameSession(state,code,body,clientId=state.gatewayId) {
  if(state.socket.destroyed || state.closed)return;
  const plain=makePacket(code,body,clientId);
  const wire=encrypt(plain,state.txKey);
  sendWsBinary(state,wire);stats.responses++;
  recorder.recordPacket('S2C', code, body, { clientId: clientId || state.gatewayId, characterId: state.character?.id });
  if(code!==4234){outboundEvents.push({time:new Date().toISOString(),connection:state.id,code,bytes:body.length});
    if(outboundEvents.length>100)outboundEvents.shift();}
  if(code!==4234)log(`[WORLD #${state.id}] Enviado ${code} (${body.length} bytes) com chave de sessao.`);
}
const battleEngine = new BattleEngine({
  sendGameSession,
  makeBasicPlayerInfo,
  sendInventorySnapshot,
  log,
  recorder,
  scheduleSession
});
function encodeItemInfo(item,characterId) {
  const template=itemTemplates.get(item.templateId);
  if(!template)throw Error(`template ${item.templateId} nao existe no catalogo local`);
  const view=inventoryState.itemProtocolView(item,template,characterId);
  return originalPb.encode('item.ItemInfoMsg',view);
}
function makeBagMoveUpdate(moved) {
  return pbRecord(moved.map(entry=>{
    const fields=[pbInt(1,entry.bagType),pbInt(2,entry.objectId),pbInt(3,entry.pos)];
    if(entry.item)fields.push(pbMessage(4,encodeItemInfo(entry.item,entry.ownerId)));
    return pbMessage(1,pbRecord(fields));
  }));
}
function inventorySnapshotEntries(characterId,stateRaw) {
  const bag=inventoryState.inventory(inventoryState.parseState(stateRaw));
  return bag.items.map(item=>({bagType:item.bagType,objectId:item.bagType===4?characterId:(item.bagType===28?item.objectId:0),
    ownerId:characterId,pos:item.pos,item}));
}
function makeInventorySnapshot(characterId,stateRaw) {
  const moved=inventorySnapshotEntries(characterId,stateRaw);
  return moved.length?makeBagMoveUpdate(moved):Buffer.alloc(0);
}
function sendInventorySnapshot(state) {
  if(!state.gatewayId||!state.heroSent||!state.sceneStateSent||!state.worldRequested||state.closed||state.socket.destroyed)return false;
  const moved=inventorySnapshotEntries(state.gatewayId,state.character?.state_json);
  const priority={1:0,4:1,27:2,28:3,0:4};
  moved.sort((a,b)=>(priority[a.bagType]??5)-(priority[b.bagType]??5));
  for(let i=0;i<moved.length;i+=12)
    sendGameSession(state,115,makeBagMoveUpdate(moved.slice(i,i+12)),state.gatewayId);
  if(!moved.length)sendGameSession(state,115,Buffer.alloc(0),state.gatewayId);
  sendMountSnapshot(state, inventoryState.parseState(state.character?.state_json));
  log(`[BOLSA #${state.id}] ${moved.length} item(ns) sincronizado(s) pelo protocolo 115 em ${Math.max(1,Math.ceil(moved.length/12))} pacote(s).`);
  return true;
}

async function handleBagArrange(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  try {
    let req = {};
    try {
      req = originalPb.decode('item.ArrangeReq', body);
    } catch (_) {}
    const targetBagType = Number(req.bagType) || 1;

    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      const bag = inventoryState.inventory(saved);
      const bagItems = bag.items.filter(i => Number(i.bagType) === targetBagType);
      const otherItems = bag.items.filter(i => Number(i.bagType) !== targetBagType);

      const oldPositions = new Set(bagItems.map(i => Number(i.pos)));

      const grouped = new Map();
      for (const item of bagItems) {
        if (!item || Number(item.count || 0) <= 0) continue;
        const tId = Number(item.templateId);
        const tpl = itemTemplates.get(tId);
        const maxCount = tId === 208005 ? 9999 : (Number(tpl?.MaxCount) || 99);

        if (!grouped.has(tId)) grouped.set(tId, []);
        const list = grouped.get(tId);

        let remaining = Number(item.count);
        for (const existing of list) {
          if (existing.count < maxCount) {
            const space = maxCount - existing.count;
            const toAdd = Math.min(space, remaining);
            existing.count += toAdd;
            remaining -= toAdd;
            if (!remaining) break;
          }
        }
        if (remaining > 0) {
          list.push({ ...item, count: remaining });
        }
      }

      const newItems = [];
      for (const list of grouped.values()) {
        newItems.push(...list);
      }
      newItems.sort((a, b) => Number(a.templateId) - Number(b.templateId));

      const itemMoved = [];
      const newPositions = new Set();
      for (let p = 0; p < newItems.length; p++) {
        newItems[p].pos = p;
        newPositions.add(p);
        itemMoved.push({
          bagType: targetBagType,
          objectId: 0,
          ownerId: state.gatewayId,
          pos: p,
          item: newItems[p]
        });
      }

      for (const oldPos of oldPositions) {
        if (!newPositions.has(oldPos)) {
          itemMoved.push({
            bagType: targetBagType,
            objectId: 0,
            ownerId: state.gatewayId,
            pos: oldPos,
            item: null
          });
        }
      }

      bag.items = [...otherItems, ...newItems];
      return { state: saved, itemMoved, count: newItems.length };
    });

    state.character.state_json = result.state;
    state.character = await db.characterById(state.gatewayId);

    if (result.itemMoved && result.itemMoved.length > 0) {
      sendGameSession(state, 115, makeBagMoveUpdate(result.itemMoved), state.gatewayId);
    }
    log(`[BAG ARRANGE #${state.id}] Bolsa organizada:${result.count} itens empilhados e ordenados. Opcode 115 enviado (${result.itemMoved.length} operacoes).`);
  } catch (err) {
    log(`[BAG ARRANGE #${state.id}] Falha ao organizar bolsa:${err.message}`);
  }
}

function readItemMoveRequest(body) {
  const req=pbReadSimple(body,new Set([1,2,3,4,5,6,7,8,9]));
  for(const field of [1,2,3,4,5,6,7,8])if(!Number.isSafeInteger(req[field]))throw Error(`campo ${field} ausente`);
  if(req[1]<0||req[1]>255||req[4]<0||req[4]>255||req[2]<0||req[2]>2147483647||
      req[3]<0||req[3]>2147483647||req[5]<0||req[5]>2147483647||req[6]<0||req[6]>2147483647||
      req[7]<0||req[7]>2147483647||req[8]<0||req[8]>2147483647||
      (req[9]!==undefined&&req[9]!==0&&req[9]!==1))throw Error('campo fora da faixa');
  return {beginBagType:req[1],beginObjId:req[2],beginPos:req[3],endBagType:req[4],
    endObjId:req[5],endPos:req[6],count:req[7],objectId:req[8],isTakeOff:req[9]===1};
}
async function handleItemMove(state,body) {
  if(!state.gatewayId||!state.character||state.closed)return;
  let req;
  try{req=readItemMoveRequest(body);}catch(err){log(`[BOLSA #${state.id}] Pedido 54 rejeitado:${err.message}.`);return;}
  if(req.objectId!==req.beginObjId){log(`[BOLSA #${state.id}] Pedido 54 rejeitado: objectId nao corresponde a origem.`);return;}
  try{
    const result=await db.mutateCharacterState(state.gatewayId,(raw,locked={})=>{
      const original=inventoryState.parseState(raw),bag=inventoryState.inventory(original);
      const source=bag.items.find(item=>item.bagType===req.beginBagType&&item.pos===req.beginPos&&
        ((item.bagType===4?state.gatewayId:(item.bagType===28?item.objectId:0))===req.beginObjId ||
          ([1,27].includes(item.bagType) && req.endBagType===28 && req.beginObjId>0 &&
            sylphEquipment.isSylphEquipment(itemTemplates.get(Number(item.templateId))))));
      if(!source)throw Error('item nao encontrado na origem');
      if ([1,27].includes(req.beginBagType) && req.endBagType===28) {
        const petId = req.beginObjId;
        const pet = original.sylphs?.list?.find(candidate => Number(candidate.petId)===petId && !candidate.isDel);
        if (!pet || (req.endObjId!==0 && req.endObjId!==petId)) throw Error('Silfo de destino invalido');
        const template=itemTemplates.get(Number(source.templateId));
        if (!sylphEquipment.isSylphEquipment(template) || source.count!==1 || req.count!==1 ||
            req.endPos!==Number(template.SonType)-501) throw Error('equipamento de Silfo ou slot invalido');
        const petTemplate=secondarySystemsState.petTemplateCatalog.find(row=>Number(row.TemplateId)===Number(pet.templateId));
        const classId=Number(template.Job?.[0] || 0);
        if (classId && classId!==Number(petTemplate?.PetType)) throw Error('tipo de Silfo incompatível');
        sylphEquipment.initializeAttributes(source,template);
        const displaced=bag.items.find(item=>item.bagType===28 && item.objectId===petId && item.pos===req.endPos);
        const moved=[{bagType:req.beginBagType,objectId:0,pos:req.beginPos}];
        if(displaced){
          displaced.bagType=27;
          displaced.pos=sylphEquipment.firstFreePos(bag.items.filter(item=>item!==source));
          delete displaced.objectId;
          moved.push({bagType:27,objectId:0,ownerId:state.gatewayId,pos:displaced.pos,item:displaced});
        }
        source.bagType=28;
        source.objectId=petId;
        source.pos=req.endPos;
        moved.push({bagType:28,objectId:petId,ownerId:state.gatewayId,pos:req.endPos,item:source});
        return {state:original,moved,changed:true,petEquipment:true};
      }
      if(req.beginBagType===28 && req.endBagType===27){
        if(source.objectId!==req.beginObjId || req.endObjId!==0 || req.count!==1 || source.count!==1)
          throw Error('retirada de equipamento de Silfo invalida');
        const target=bag.items.find(item=>item.bagType===27 && item.pos===req.endPos);
        if(target || req.endPos<0 || req.endPos>=100) throw Error('slot da bolsa de Silfo indisponivel');
        const petId=source.objectId;
        source.bagType=27;
        source.pos=req.endPos;
        delete source.objectId;
        return {state:original,changed:true,petEquipment:true,moved:[
          {bagType:28,objectId:petId,pos:req.beginPos},
          {bagType:27,objectId:0,ownerId:state.gatewayId,pos:req.endPos,item:source}
        ]};
      }
      const stackToHidden = (req.beginBagType===1&&req.endBagType===0) ||
        (req.beginBagType===0&&req.endBagType===1);
      if(!stackToHidden&&(req.count!==1||source.count!==1))throw Error('somente movimento de item unitario e suportado');
      if(req.beginBagType===1&&req.endBagType===4){
        if(req.beginObjId!==0||req.endObjId!==state.gatewayId)throw Error('proprietario de bolsa/equipamento invalido');
        const currentCharacter={...state.character,state_json:original,grade:Number.isSafeInteger(locked.grade)?locked.grade:state.character.grade};
        const equipped=inventoryState.equipItem(original,source.instanceId,currentCharacter,
          id=>itemTemplates.get(id),req.endPos);
        const finalSlot = equipped.slot !== undefined ? equipped.slot : req.endPos;
        const tpl = itemTemplates.get(Number(source.templateId));
        if (tpl && [109, 110, 111, 112].includes(Number(tpl.SonType))) {
          equipped.state.fashionDisplay = equipped.state.fashionDisplay || { status: '0,0,0,0' };
          const son = Number(tpl.SonType);
          if (son === 109) equipped.state.fashionDisplay.wingAvata = source.templateId;
          if (son === 110) equipped.state.fashionDisplay.hatAvata = source.templateId;
          if (son === 111) equipped.state.fashionDisplay.clothAvata = source.templateId;
          if (son === 112) equipped.state.fashionDisplay.armAvata = source.templateId;
          equipped.state.fashion = equipped.state.fashion || { unlocked: [] };
          let u = equipped.state.fashion.unlocked.find(x => Number(x.templateId || x.tempId) === source.templateId);
          if (!u) {
            equipped.state.fashion.unlocked.push({ templateId: source.templateId, isSwitch: true, appraisalSkill: 0 });
          } else {
            u.isSwitch = true;
          }
        }
        const moved=[{bagType:1,objectId:0,pos:req.beginPos},
          {bagType:4,objectId:state.gatewayId,ownerId:state.gatewayId,pos:finalSlot,
            item:equipped.state.inventory.items.find(item=>item.instanceId===source.instanceId)}];
        if(equipped.swappedInstanceId) {
          const swapped = equipped.state.inventory.items.find(item=>item.instanceId===equipped.swappedInstanceId);
          if (swapped) {
            moved.push({bagType:1,objectId:0,ownerId:state.gatewayId,pos:swapped.pos,item:swapped});
          }
        }
        if (equipped.changed) {
          questState.syncAutoQuests(equipped.state, state.character?.grade || 5);
        }
        return {state:equipped.state,moved,changed:equipped.changed};
      }
      if(req.beginBagType===4&&req.endBagType===1){
        if(req.beginObjId!==state.gatewayId||req.endObjId!==0)throw Error('proprietario de bolsa/equipamento invalido');
        if(source.pos!==req.beginPos||bag.equipment[String(req.beginPos)]!==source.instanceId)
          throw Error('slot de equipamento inconsistente');
        if(bag.items.some(item=>item.bagType===1&&item.pos===req.endPos))throw Error('slot da bolsa ocupado');
        const removed=inventoryState.unequipItem(original,req.beginPos);
        const item=removed.state.inventory.items.find(candidate=>candidate.instanceId===source.instanceId);
        item.pos=req.endPos;
        const unequippedTpl = itemTemplates.get(Number(source.templateId));
        if (unequippedTpl && [109, 110, 111, 112].includes(Number(unequippedTpl.SonType)) && removed.state.fashionDisplay) {
          const son = Number(unequippedTpl.SonType);
          if (son === 109 && removed.state.fashionDisplay.wingAvata === source.templateId) delete removed.state.fashionDisplay.wingAvata;
          if (son === 110 && removed.state.fashionDisplay.hatAvata === source.templateId) delete removed.state.fashionDisplay.hatAvata;
          if (son === 111 && removed.state.fashionDisplay.clothAvata === source.templateId) delete removed.state.fashionDisplay.clothAvata;
          if (son === 112 && removed.state.fashionDisplay.armAvata === source.templateId) delete removed.state.fashionDisplay.armAvata;
          if (removed.state.fashion?.unlocked) {
            const u = removed.state.fashion.unlocked.find(x => Number(x.templateId || x.tempId) === source.templateId);
            if (u) u.isSwitch = false;
          }
        }
        if (removed.changed) {
          questState.syncAutoQuests(removed.state, state.character?.grade || 5);
        }
        return {state:removed.state,moved:[{bagType:4,objectId:state.gatewayId,pos:req.beginPos},
          {bagType:1,objectId:0,ownerId:state.gatewayId,pos:req.endPos,item}],changed:removed.changed};
      }
      if(req.endBagType===0){
        const moved = [];
        const existing = bag.items.find(item => item !== source && item.bagType === 0 && item.pos === req.endPos);
        if (existing) {
          if (existing.originBagType === 4 && Number.isSafeInteger(existing.originPos)) {
            existing.bagType = 4;
            existing.pos = existing.originPos;
            bag.equipment[String(existing.originPos)] = existing.instanceId;
            delete existing.originBagType;
            delete existing.originPos;
            delete existing.originObjId;
            moved.push({
              bagType: 4,
              objectId: state.gatewayId,
              ownerId: state.gatewayId,
              pos: existing.pos,
              item: existing
            });
          } else {
            let retPos = (existing.originPos !== undefined && !bag.items.some(i => i !== existing && i.bagType === 1 && i.pos === existing.originPos))
              ? existing.originPos
              : inventoryState.firstFreeBagPos(bag.items);
            existing.bagType = 1;
            existing.pos = retPos;
            delete existing.originBagType;
            delete existing.originPos;
            delete existing.originObjId;
            moved.push({
              bagType: 1,
              objectId: 0,
              ownerId: state.gatewayId,
              pos: retPos,
              item: existing
            });
          }
        }

        if(req.beginBagType===1){
          if(req.count<1||req.count>source.count)throw Error('quantidade de moda invalida');
          if(req.count<source.count){
            source.count-=req.count;
            const hidden={...source,instanceId:bag.nextInstanceId++,count:req.count,bagType:0,pos:req.endPos,originBagType:1,originPos:req.beginPos};
            bag.items.push(hidden);
            moved.push(
              {bagType:1,objectId:0,ownerId:state.gatewayId,pos:req.beginPos,item:source},
              {bagType:0,objectId:0,ownerId:state.gatewayId,pos:req.endPos,item:hidden}
            );
            return {state:original,moved,changed:true};
          }
        }

        source.originBagType = req.beginBagType;
        source.originPos = req.beginPos;
        source.originObjId = req.beginObjId;

        if(req.beginBagType===4){
          delete bag.equipment[String(req.beginPos)];
          moved.push({bagType: 4, objectId: state.gatewayId, pos: req.beginPos});
        } else {
          moved.push({bagType: req.beginBagType, objectId: 0, pos: req.beginPos});
        }

        source.bagType=0;
        source.pos=req.endPos;
        moved.push({bagType: 0, objectId: 0, ownerId: state.gatewayId, pos: req.endPos, item: source});

        return {
          state: original,
          moved,
          changed: true
        };
      }
      if(req.beginBagType===0){
        if(req.endBagType===1){
          if(req.count<1||req.count>source.count)throw Error('quantidade de retorno invalida');

          if (source.originBagType === 4 && Number.isSafeInteger(source.originPos) && (!bag.equipment[String(source.originPos)] || bag.equipment[String(source.originPos)] === source.instanceId)) {
            const originPos = source.originPos;
            source.bagType = 4;
            source.pos = originPos;
            bag.equipment[String(originPos)] = source.instanceId;
            delete source.originBagType;
            delete source.originPos;
            delete source.originObjId;
            return {
              state: original,
              moved: [
                {bagType: 0, objectId: 0, ownerId: state.gatewayId, pos: req.beginPos},
                {bagType: 4, objectId: state.gatewayId, ownerId: state.gatewayId, pos: originPos, item: source}
              ],
              changed: true
            };
          }

          const targetOccupied = bag.items.some(i => i !== source && i.bagType === 1 && i.pos === req.endPos);
          let targetPos = req.endPos;
          if (targetOccupied || (source.originBagType === 1 && source.originPos !== undefined && !bag.items.some(i => i !== source && i.bagType === 1 && i.pos === source.originPos))) {
            targetPos = (source.originBagType === 1 && source.originPos !== undefined && !bag.items.some(i => i !== source && i.bagType === 1 && i.pos === source.originPos))
              ? source.originPos
              : inventoryState.firstFreeBagPos(bag.items);
          }
          delete source.originBagType;
          delete source.originPos;
          delete source.originObjId;
          let returned=source;
          if(req.count<source.count){
            source.count-=req.count;
            returned={...source,instanceId:bag.nextInstanceId++,count:req.count,bagType:1,pos:targetPos};
            bag.items.push(returned);
          }else{
            source.bagType=1;
            source.pos=targetPos;
          }
          return {
            state: original,
            moved: [
              {bagType: 0, objectId: 0, ownerId: state.gatewayId, pos: req.beginPos, item: returned===source?null:source},
              {bagType: 1, objectId: 0, ownerId: state.gatewayId, pos: targetPos, item: returned}
            ],
            changed: true
          };
        }
        if(req.endBagType===4){
          delete source.originBagType;
          delete source.originPos;
          delete source.originObjId;
          source.bagType=1;
          const currentCharacter={...state.character,state_json:original,grade:Number.isSafeInteger(locked.grade)?locked.grade:state.character.grade};
          const equipped=inventoryState.equipItem(original,source.instanceId,currentCharacter,id=>itemTemplates.get(id),req.endPos);
          const finalSlot=equipped.slot!==undefined?equipped.slot:req.endPos;
          const moved=[
            {bagType: 0, objectId: 0, pos: req.beginPos},
            {bagType: 4, objectId: state.gatewayId, ownerId: state.gatewayId, pos: finalSlot, item: equipped.state.inventory.items.find(i=>i.instanceId===source.instanceId)}
          ];
          if(equipped.swappedInstanceId){
            const swapped=equipped.state.inventory.items.find(i=>i.instanceId===equipped.swappedInstanceId);
            if(swapped)moved.push({bagType: 1, objectId: 0, ownerId: state.gatewayId, pos: swapped.pos, item: swapped});
          }
          return {state: equipped.state, moved, changed: equipped.changed};
        }
      }
      if(req.beginBagType===1&&req.endBagType===1){
        const targetItem=bag.items.find(i=>i.bagType===1&&i.pos===req.endPos);
        if(targetItem){
          targetItem.pos=req.beginPos;
        }
        source.pos=req.endPos;
        return {
          state: original,
          moved: [
            {bagType: 1, objectId: 0, ownerId: state.gatewayId, pos: req.endPos, item: source},
            ...(targetItem?[{bagType: 1, objectId: 0, ownerId: state.gatewayId, pos: req.beginPos, item: targetItem}]:[])
          ],
          changed: true
        };
      }
      throw Error('combinacao de bolsas nao suportada: ' + req.beginBagType + ' -> ' + req.endBagType);
    });
    if(!result.changed)return;
    state.character = await db.characterById(state.gatewayId);
    sendGameSession(state,115,makeBagMoveUpdate(result.moved),state.gatewayId);
    if(result.petEquipment){
      const saved=inventoryState.parseState(state.character.state_json);
      sendGameSession(state,4540,originalPb.encode('pet.PlayerPetMsg',
        secondarySystemsState.formatPlayerPetMsg(saved,state.gatewayId,0)));
    }
    const updatedHero=heroState.heroInfo(state.character);
    sendGameSession(state,113,originalPb.encode('army.SimpleHeroInfoMsg',updatedHero));
    sendGameSession(state,3,makeBasicPlayerInfo(state.character));
    const currentSaved = (typeof state.character.state_json === 'string') ? JSON.parse(state.character.state_json) : (state.character.state_json || result.state);
    if(currentSaved && currentSaved.fashionDisplay){
      sendGameSession(state, 301, originalPb.encode('simple.FashionInfoMsg', currentSaved.fashionDisplay));
      sendGameSession(state, 4542, originalPb.encode('fashion.FashionMsg', formatFashionBookMsg(currentSaved)));
    }
    if(state.heroSent&&state.worldRequested){
      sendGameSession(state,169,originalPb.encode('army.ArmyUpdatedGridMsg',{updatedArmy:[heroState.armyInfo(state.character)]}));
    }
    const activeQuests = questState.getActiveQuestProtocolList(state.character.state_json);
    if (activeQuests.length > 0) {
      sendGameSession(state, 112, originalPb.encode('quest.QuestUpdatedRspMsg', questState.formatQuestUpdatedProtocol(state.character.state_json, activeQuests)));
    }
    inventoryEvents.push({time:new Date().toISOString(),characterId:state.gatewayId,accepted:true,request:req,moved:result.moved.map(x=>({bagType:x.bagType,pos:x.pos,objectId:x.objectId,instanceId:x.item?.instanceId}))});
    if(inventoryEvents.length>40)inventoryEvents.shift();
    recorder.recordServerOutcome({
      category: 'inventory',
      handler: 'handleItemMove',
      validations: 'passed',
      persistentChanges: { moved: result.moved.map(x=>({bagType:x.bagType,pos:x.pos,objectId:x.objectId,instanceId:x.item?.instanceId})) },
      responseOpcode: 115,
      finalState: 'SAVED_DB'
    });
    log(`[BOLSA #${state.id}] ${req.beginBagType}->${req.endBagType} gravado em transacao; resposta 115 enviada.`);
  }catch(err){inventoryEvents.push({time:new Date().toISOString(),characterId:state.gatewayId,accepted:false,request:req,error:err.message});
    if(inventoryEvents.length>40)inventoryEvents.shift();
    recorder.recordServerOutcome({
      category: 'inventory',
      handler: 'handleItemMove',
      validations: 'failed',
      error: err.message,
      finalState: 'REJECTED'
    });
    log(`[BOLSA #${state.id}] Pedido 5005 sem alteracao:${err.message}`);}
}
async function handleItemStrengthen(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, (raw, locked = {}) => {
      const original = inventoryState.parseState(raw);
      const bag = inventoryState.inventory(original);
      const item = bag.items.find(i => i.bagType === 0 && i.pos === 0);
      if (!item) throw Error('Nenhum equipamento colocado na bigorna do ferreiro para fortalecimento');
      const template = itemTemplates.get(item.templateId);
      if (!template) throw Error('Template do item nao encontrado');

      const needGrades = Number(template.NeedGrades) || 10;
      const profile = Math.min(Number(template.Profile) || 3, 4);
      const curGrade = Number(item.strengthenGrade) || 0;

      const goldCost = Math.floor(Math.pow(1.5, Math.floor(needGrades / 10) + 1) * (profile + 1) * Math.pow(curGrade + 1, 2.2) * 5 + 500);
      const currentGold = Number(locked.gold !== undefined ? locked.gold : original.wallet?.gold || 0);
      if (currentGold < goldCost) throw Error(`Ouro insuficiente: necessario ${goldCost}, possui${currentGold}`);

      const successRate = Math.max(10, Math.min(100, 100 - curGrade * 10));
      const roll = Math.random() * 100;
      const isSuccess = roll < successRate;

      const newGold = currentGold - goldCost;
      original.wallet = original.wallet || {};
      original.wallet.gold = newGold;

      if (isSuccess) {
        item.strengthenGrade = curGrade + 1;
      }

      questState.syncAutoQuests(original, Number(locked.grade || state.character.grade || 10));

      return {
        state: original,
        resources: {
          gold: newGold,
          grade: Number(locked.grade || state.character.grade || 10),
          experience: Number(locked.experience !== undefined ? locked.experience : (original.progression?.totalXp || 84000))
        },
        item,
        isSuccess,
        strengthenGrade: item.strengthenGrade || 0
      };
    });

    state.character = await db.characterById(state.gatewayId);
    const rspMsg = {
      strengResult: result.isSuccess,
      strengthenGrade: result.strengthenGrade,
      pos: 0,
      objectId: 0,
      bagType: 0
    };
    sendGameSession(state, 86, originalPb.encode('store.StoreRspMsg', rspMsg));

    const moved = [{
      bagType: 0,
      objectId: 0,
      ownerId: state.gatewayId,
      pos: 0,
      item: result.item
    }];
    sendGameSession(state, 115, makeBagMoveUpdate(moved), state.gatewayId);

    const updatedHero = heroState.heroInfo(state.character);
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

    const activeQuests = questState.getActiveQuestProtocolList(state.character.state_json);
    if (activeQuests.length > 0) {
      sendGameSession(state, 112, originalPb.encode('quest.QuestUpdatedRspMsg', questState.formatQuestUpdatedProtocol(state.character.state_json, activeQuests)));
    }

    log(`[FORTALECER #${state.id}] Item ${result.item.templateId}${result.isSuccess ? 'SUCESSO -> +' + result.strengthenGrade : 'FALHA'}. Ouro restante: ${result.resources?.gold}`);
  } catch (err) {
    log(`[FORTALECER #${state.id}] Rejeitado:${err.message}`);
  }
}

async function handleItemInlay(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req;
  try {
    req = originalPb.decode('store.StoreReqMsg', body);
  } catch (err) {
    log(`[INCRUSTAR #${state.id}] Pedido 87/5151 invalido:${err.message}`);
    return;
  }

  const mountPos = Number(req.mountPos) || 1;
  const bagPos = Number(req.bagPos);
  const bagType = Number(req.bagType) || 1;

  try {
    const result = await db.mutateCharacterState(state.gatewayId, (raw, locked = {}) => {
      const original = inventoryState.parseState(raw);
      const bag = inventoryState.inventory(original);

      let equip = bag.items.find(i => i.bagType === 0 && i.pos === 0);
      if (!equip) {
        equip = bag.items.find(i => i.bagType === 4 && i.pos === 0) || bag.items.find(i => i.bagType === 4);
      }
      if (!equip) throw Error('Nenhum equipamento selecionado para incrustacao');

      const gemIndex = bag.items.findIndex(i => i.bagType === bagType && i.pos === bagPos);
      if (gemIndex < 0) throw Error(`Gema nao encontrada na posicao ${bagPos} da bolsa${bagType}`);
      const gem = bag.items[gemIndex];
      if (gem.count < 1) throw Error('Quantidade de gema insuficiente');

      const gemTemplate = itemTemplates.get(gem.templateId);
      if (!gemTemplate) throw Error('Template da gema nao encontrado');

      const holeField = 'join_' + mountPos;
      const currentHole = equip[holeField] !== undefined ? equip[holeField] : (mountPos === 1 ? 0 : -1);
      if (currentHole === -1) {
        throw Error(`Buraco ${mountPos} esta bloqueado; abra o buraco primeiro`);
      }
      if (currentHole > 0) {
        throw Error(`Buraco ${mountPos} ja possui uma gema incrustada`);
      }

      for (let h = 1; h <= 4; h++) {
        const existGemId = equip['join_' + h];
        if (existGemId > 0 && h !== mountPos) {
          const existTemplate = itemTemplates.get(existGemId);
          if (existTemplate && existTemplate.Property1 && existTemplate.Property1 === gemTemplate.Property1) {
            throw Error('Nao e permitido incrustar duas gemas do mesmo tipo no mesmo equipamento');
          }
        }
      }

      const moved = [];

      gem.count -= 1;
      if (gem.count <= 0) {
        bag.items.splice(gemIndex, 1);
        moved.push({ bagType, objectId: 0, pos: gem.pos });
      } else {
        moved.push({ bagType, objectId: 0, ownerId: state.gatewayId, pos: gem.pos, item: gem });
      }

      equip[holeField] = gem.templateId;
      moved.push({
        bagType: equip.bagType,
        objectId: equip.bagType === 4 ? state.gatewayId : 0,
        ownerId: state.gatewayId,
        pos: equip.pos,
        item: equip
      });

      questState.syncAutoQuests(original, Number(locked.grade || state.character.grade || 10));

      return {
        state: original,
        equip,
        gemTemplate,
        mountPos,
        moved
      };
    });

    state.character = await db.characterById(state.gatewayId);

    sendGameSession(state, 115, makeBagMoveUpdate(result.moved), state.gatewayId);

    const rspMsg = {
      strengResult: true,
      pos: result.equip.pos,
      objectId: result.equip.bagType === 4 ? state.gatewayId : 0,
      bagType: result.equip.bagType
    };
    sendGameSession(state, 87, originalPb.encode('store.StoreRspMsg', rspMsg));
    sendGameSession(state, 5151, originalPb.encode('store.StoreRspMsg', rspMsg));

    const updatedHero = heroState.heroInfo(state.character);
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

    const activeQuests = questState.getActiveQuestProtocolList(state.character.state_json);
    if (activeQuests.length > 0) {
      sendGameSession(state, 112, originalPb.encode('quest.QuestUpdatedRspMsg', questState.formatQuestUpdatedProtocol(state.character.state_json, activeQuests)));
    }

    recorder.recordServerOutcome({
      category: 'forge',
      handler: 'handleItemInlay',
      validations: 'passed',
      persistentChanges: {
        equipTemplateId: result.equip.templateId,
        mountPos: result.mountPos,
        gemTemplateId: result.gemTemplate.TemplateId
      },
      responseOpcode: 87,
      finalState: 'SAVED_DB'
    });

    log(`[INCRUSTAR #${state.id}] Gema${result.gemTemplate.TemplateId} incrustada no buraco ${result.mountPos} do item${result.equip.templateId}.`);
  } catch (err) {
    log(`[INCRUSTAR #${state.id}] Falha:${err.message}`);
    try {
      const failRsp = {
        strengResult: false,
        pos: 0,
        objectId: 0,
        bagType: 0
      };
      sendGameSession(state, 87, originalPb.encode('store.StoreRspMsg', failRsp));
      sendGameSession(state, 5151, originalPb.encode('store.StoreRspMsg', failRsp));
    } catch (_) {}
    recorder.recordServerOutcome({
      category: 'forge',
      handler: 'handleItemInlay',
      validations: 'failed',
      error: err.message,
      finalState: 'REJECTED'
    });
  }
}

async function handleItemInlayJoin(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req;
  try {
    req = originalPb.decode('store.StoreReqMsg', body);
  } catch (err) {
    log(`[PERFURAR/DESMONTAR #${state.id}] Pedido 88/5152 invalido:${err.message}`);
    return;
  }

  const holePos = Number(req.holePos);
  const operate = Boolean(req.operate);

  try {
    const result = await db.mutateCharacterState(state.gatewayId, (raw, locked = {}) => {
      const original = inventoryState.parseState(raw);
      const bag = inventoryState.inventory(original);

      let equip = bag.items.find(i => i.bagType === 0 && i.pos === 0);
      if (!equip) {
        equip = bag.items.find(i => i.bagType === 4 && i.pos === 0) || bag.items.find(i => i.bagType === 4);
      }
      if (!equip) throw Error('Nenhum equipamento selecionado no Ferreiro');

      const moved = [];
      let costGold = 0;

      if (operate) {
        const targetHole = holePos > 0 ? holePos : 2;
        const holeKey = 'join_' + targetHole;
        const curStatus = equip[holeKey] !== undefined ? equip[holeKey] : (targetHole === 1 ? 0 : -1);
        if (curStatus >= 0) {
          throw Error(`Buraco ${targetHole} ja esta aberto`);
        }

        const bortIndex = bag.items.findIndex(i => i.bagType === 1 && i.templateId === 208004 && i.count >= 1);
        if (bortIndex >= 0) {
          const bort = bag.items[bortIndex];
          bort.count -= 1;
          if (bort.count <= 0) {
            bag.items.splice(bortIndex, 1);
            moved.push({ bagType: 1, objectId: 0, pos: bort.pos });
          } else {
            moved.push({ bagType: 1, objectId: 0, ownerId: state.gatewayId, pos: bort.pos, item: bort });
          }
        } else {
          costGold = 1000;
          const currentGold = Number(locked.gold !== undefined ? locked.gold : original.wallet?.gold || 0);
          if (currentGold < costGold) {
            throw Error('Necessario Furador (Template 208004) ou 1.000 de ouro para abrir o buraco');
          }
          original.wallet = original.wallet || {};
          original.wallet.gold = currentGold - costGold;
        }

        equip[holeKey] = 0;
        moved.push({
          bagType: equip.bagType,
          objectId: equip.bagType === 4 ? state.gatewayId : 0,
          ownerId: state.gatewayId,
          pos: equip.pos,
          item: equip
        });

        questState.syncAutoQuests(original, Number(locked.grade || state.character.grade || 10));

        return {
          state: original,
          resources: costGold > 0 ? {
            gold: original.wallet.gold,
            grade: Number(locked.grade || state.character.grade || 10),
            experience: Number(locked.experience || 0)
          } : undefined,
          equip,
          operate,
          targetHole,
          costGold,
          moved
        };
      } else {
        const holesToUnmount = (holePos === -1) ? [1, 2, 3, 4] : [holePos];
        const gemsToReturn = [];

        for (const h of holesToUnmount) {
          const gemId = equip['join_' + h];
          if (gemId > 0) {
            gemsToReturn.push({ hole: h, templateId: gemId });
          }
        }

        if (gemsToReturn.length === 0) {
          throw Error('Nenhuma gema para desmontar');
        }

        costGold = gemsToReturn.length * 500;
        const currentGold = Number(locked.gold !== undefined ? locked.gold : original.wallet?.gold || 0);
        if (currentGold < costGold) {
          throw Error(`Ouro insuficiente para desmontar gema(s): necessario ${costGold}, disponivel${currentGold}`);
        }
        original.wallet = original.wallet || {};
        original.wallet.gold = currentGold - costGold;

        for (const g of gemsToReturn) {
          const existingGem = bag.items.find(i => i.bagType === 1 && i.templateId === g.templateId && (i.count || 1) < 999);
          if (existingGem) {
            existingGem.count = (existingGem.count || 1) + 1;
            moved.push({ bagType: 1, objectId: 0, ownerId: state.gatewayId, pos: existingGem.pos, item: existingGem });
          } else {
            const usedPos = new Set(bag.items.filter(i => i.bagType === 1).map(i => i.pos));
            let freePos = 0; while (usedPos.has(freePos)) freePos++;

            const returnedGem = {
              instanceId: bag.nextInstanceId++,
              templateId: g.templateId,
              pos: freePos,
              count: 1,
              bagType: 1,
              bind: true,
              used: false
            };
            bag.items.push(returnedGem);
            moved.push({ bagType: 1, objectId: 0, ownerId: state.gatewayId, pos: freePos, item: returnedGem });
          }

          equip['join_' + g.hole] = 0;
        }

        moved.push({
          bagType: equip.bagType,
          objectId: equip.bagType === 4 ? state.gatewayId : 0,
          ownerId: state.gatewayId,
          pos: equip.pos,
          item: equip
        });

        questState.syncAutoQuests(original, Number(locked.grade || state.character.grade || 10));

        return {
          state: original,
          resources: {
            gold: original.wallet.gold,
            grade: Number(locked.grade || state.character.grade || 10),
            experience: Number(locked.experience || 0)
          },
          equip,
          operate,
          costGold,
          unmountedCount: gemsToReturn.length,
          moved
        };
      }
    });

    state.character = await db.characterById(state.gatewayId);

    sendGameSession(state, 115, makeInventorySnapshot(state.gatewayId, state.character?.state_json), state.gatewayId);

    const rspMsg = {
      strengResult: true,
      pos: result.equip.pos,
      objectId: result.equip.bagType === 4 ? state.gatewayId : 0,
      bagType: result.equip.bagType
    };
    sendGameSession(state, 88, originalPb.encode('store.StoreRspMsg', rspMsg));
    sendGameSession(state, 5152, originalPb.encode('store.StoreRspMsg', rspMsg));

    if (result.costGold > 0) {
      sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    }

    const updatedHero = heroState.heroInfo(state.character);
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));

    const activeQuests = questState.getActiveQuestProtocolList(state.character.state_json);
    if (activeQuests.length > 0) {
      sendGameSession(state, 112, originalPb.encode('quest.QuestUpdatedRspMsg', questState.formatQuestUpdatedProtocol(state.character.state_json, activeQuests)));
    }

    recorder.recordServerOutcome({
      category: 'forge',
      handler: 'handleItemInlayJoin',
      validations: 'passed',
      persistentChanges: {
        equipTemplateId: result.equip.templateId,
        operate: result.operate,
        costGold: result.costGold
      },
      responseOpcode: 88,
      finalState: 'SAVED_DB'
    });

    log(`[PERFURAR/DESMONTAR #${state.id}] Operacao (${result.operate ? 'Abrir Buraco' : 'Desmontar Gema'}) concluida no item ${result.equip.templateId}. Custo ouro: ${result.costGold}.`);
  } catch (err) {
    log(`[PERFURAR/DESMONTAR #${state.id}] Falha:${err.message}`);
    try {
      const failRsp = {
        strengResult: false,
        pos: 0,
        objectId: 0,
        bagType: 0
      };
      sendGameSession(state, 88, originalPb.encode('store.StoreRspMsg', failRsp));
      sendGameSession(state, 5152, originalPb.encode('store.StoreRspMsg', failRsp));
    } catch (_) {}
    recorder.recordServerOutcome({
      category: 'forge',
      handler: 'handleItemInlayJoin',
      validations: 'failed',
      error: err.message,
      finalState: 'REJECTED'
    });
  }
}

const CANONICAL_REFINE_SKILLS = [
  501, 502, 503, 504, 505,
  601, 602, 603, 604, 605,
  701, 702, 703, 704, 705,
  801, 802, 803, 804, 805,
  2001, 2002, 2003, 2004, 2005
];

async function handleItemRefreshProperty(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  try {
    let req = {};
    if (body && body.length > 0) {
      try { req = originalPb.decode('store.RefreshPropertyReqMsg', body); } catch (_) {}
    }
    const itemId = Number(req.itemId || 0);
    state.currentRefiningItemId = 0;
    state.pendingRefineSkills = null;
    let skills = [];
    if (itemId > 0) {
      const saved = inventoryState.parseState(state.character.state_json || {});
      const bag = inventoryState.inventory(saved);
      const item = bag.items.find(candidate => candidate.instanceId === itemId);
      const template = item && itemTemplates.get(Number(item.templateId));
      if (item && template?.MasterType === 1 && Number(template.RandomSkillCount) > 0) {
        state.currentRefiningItemId = itemId;
        skills = [
          item.randomSkill_1 || 0,
          item.randomSkill_2 || 0,
          item.randomSkill_3 || 0,
          item.randomSkill_4 || 0,
          item.randomSkill_5 || 0
        ];
      }
    }
    const rspMsg = {
      randomSkill: skills,
      lockPos: [false, false, false, false, false],
      result: state.currentRefiningItemId === itemId && itemId > 0
    };
    sendGameSession(state, 4368, originalPb.encode('store.RefreshPropertyRepMsg', rspMsg));
    log(`[FERREIRO REFINO #${state.id}] Propriedades sincronizadas (4368) para itemId ${itemId}: [${skills.join(', ')}].`);
  } catch (err) {
    log(`[FERREIRO REFINO #${state.id}] Erro: ${err.message}`);
  }
}

async function handleItemRefreshForRandom(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  try {
    let req = { lock: [] };
    if (body && body.length > 0) {
      try { req = originalPb.decode('store.SmithFreshReqMsg', body); } catch (_) {}
    }
    if (!state.currentRefiningItemId) throw Error('Selecione um equipamento refinável');
    const saved = inventoryState.parseState(state.character.state_json || {});
    const item = inventoryState.inventory(saved).items.find(candidate => candidate.instanceId === state.currentRefiningItemId);
    const template = item && itemTemplates.get(Number(item.templateId));
    if (!item || template?.MasterType !== 1 || Number(template.RandomSkillCount) < 1)
      throw Error('Equipamento de refinamento indisponivel');
    const generated = [];
    const count = Math.min(5, Number(template.RandomSkillCount));
    for (let i = 0; i < count; i++) {
      const isLocked = Boolean(req.lock && req.lock[i]);
      if (isLocked) {
        generated.push(Number(state.pendingRefineSkills?.[i] || item['randomSkill_' + (i + 1)] || 0));
      } else {
        const pick = CANONICAL_REFINE_SKILLS[Math.floor(Math.random() * CANONICAL_REFINE_SKILLS.length)];
        generated.push(pick);
      }
    }
    state.pendingRefineSkills = generated;
    state.pendingRefineItemId = item.instanceId;
    const rsp = {
      randomSkill: generated
    };
    sendGameSession(state, 4258, originalPb.encode('store.SmithFreshRspMsg', rsp));
    log(`[FERREIRO REFINO #${state.id}] Atributos aleatórios gerados (4258): [${generated.join(', ')}].`);
  } catch (err) {
    log(`[FERREIRO REFINO #${state.id}] Erro ao sortear: ${err.message}`);
  }
}

async function handleItemRefreshForReplace(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  try {
    if (!state.pendingRefineSkills || !state.currentRefiningItemId ||
        state.pendingRefineItemId !== state.currentRefiningItemId)
      throw Error('Nenhum refinamento pendente para este item');
    if (state.pendingRefineSkills && state.currentRefiningItemId) {
      const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
        const bag = inventoryState.inventory(saved);
        const item = bag.items.find(candidate => candidate.instanceId === state.currentRefiningItemId);
        const template = item && itemTemplates.get(Number(item.templateId));
        if (!item || template?.MasterType !== 1 || Number(template.RandomSkillCount) < 1)
          throw Error('Equipamento refinado nao encontrado');
        if (item) {
          state.pendingRefineSkills.forEach((skillId, idx) => {
            if (skillId > 0 && idx < 5) {
              item['randomSkill_' + (idx + 1)] = skillId;
            }
          });
        }
        return { state: saved };
      });
      state.character = await db.characterById(state.gatewayId);
      state.pendingRefineSkills = null;
      state.pendingRefineItemId = 0;
    }
    sendGameSession(state, 4259, originalPb.encode('store.SmithFreshReplaceRspMsg', { result: true }));
    sendInventorySnapshot(state);
    const updatedHero=heroState.heroInfo(state.character);
    sendGameSession(state,113,originalPb.encode('army.SimpleHeroInfoMsg',updatedHero));
    if(state.heroSent&&state.worldRequested)
      sendGameSession(state,169,originalPb.encode('army.ArmyUpdatedGridMsg',{updatedArmy:[heroState.armyInfo(state.character)]}));
    log(`[FERREIRO REFINO #${state.id}] Substituição de atributos confirmada (4259).`);
  } catch (err) {
    log(`[FERREIRO REFINO #${state.id}] Erro ao substituir: ${err.message}`);
  }
}

async function handlePetEquipRefine(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req;
  try { req = originalPb.decode('pet.PetEquipReqMsg', body); }
  catch (err) { log(`[SILFO REFINO #${state.id}] Pacote invalido: ${err.message}`); return; }
  const op = Number(req.op);
  const bagType = Number(req.bagType);
  const pos = Number(req.pos);
  const petId = Number(req.petId || 0);
  const key = `${bagType}:${pos}:${petId}`;
  let output = {op, result:false, bagType, pos, objectId:petId};
  try {
    if (![0, 1, 2].includes(op) || ![27, 28].includes(bagType) || !Number.isSafeInteger(pos) || pos < 0)
      throw Error('operacao ou slot invalido');
    const saved = inventoryState.parseState(state.character.state_json || {});
    const bag = inventoryState.inventory(saved);
    const item = bag.items.find(candidate => candidate.bagType === bagType && candidate.pos === pos &&
      (bagType !== 28 || Number(candidate.objectId) === petId));
    const template = item && itemTemplates.get(Number(item.templateId));
    if (!item || !sylphEquipment.isSylphEquipment(template)) throw Error('equipamento de Silfo ausente');
    if (bagType === 28 && !saved.sylphs?.list?.some(pet => Number(pet.petId) === petId && !pet.isDel))
      throw Error('Silfo invalido');
    if (op === 1) {
      const pending = state.pendingPetEquipRefine;
      if (!pending || pending.key !== key || pending.instanceId !== item.instanceId)
        throw Error('nenhum refinamento pendente para o item');
      await db.mutateCharacterState(state.gatewayId, raw => {
        const lockedBag = inventoryState.inventory(raw);
        const target = lockedBag.items.find(candidate => candidate.instanceId === pending.instanceId &&
          candidate.bagType === bagType && candidate.pos === pos &&
          (bagType !== 28 || Number(candidate.objectId) === petId));
        if (!target) throw Error('equipamento alterado durante refinamento');
        target.masterAttr = pending.masterAttr;
        target.sonAttr = pending.sonAttr;
        return {state:raw};
      });
      state.pendingPetEquipRefine = null;
      state.character = await db.characterById(state.gatewayId);
      output = {...output, result:true, masterAttr:pending.masterAttr, sonAttr:pending.sonAttr};
      sendInventorySnapshot(state);
      const current = inventoryState.parseState(state.character.state_json);
      sendGameSession(state, 4540, originalPb.encode('pet.PlayerPetMsg',
        secondarySystemsState.formatPlayerPetMsg(current, state.gatewayId, 0)));
    } else if (op === 2) {
      output = {...output, result:true, masterAttr:item.masterAttr || '', sonAttr:item.sonAttr || ''};
    } else {
      const materialId = Number(template.Property6 || 0);
      const cost = 5 + Math.floor(Number(item.strengthenGrade || 0) / 5);
      if (!materialId || !Number.isSafeInteger(cost) || cost < 1) throw Error('equipamento sem receita de refinamento');
      const seed = (Math.random() * 0x100000000) >>> 0;
      const rolled = sylphEquipment.refineAttributes(item, template, seed);
      await db.mutateCharacterState(state.gatewayId, raw => {
        const lockedBag = inventoryState.inventory(raw);
        const target = lockedBag.items.find(candidate => candidate.instanceId === item.instanceId &&
          candidate.bagType === bagType && candidate.pos === pos &&
          (bagType !== 28 || Number(candidate.objectId) === petId));
        if (!target) throw Error('equipamento alterado durante refinamento');
        lockedBag.items = sylphEquipment.consumeRefineMaterial(lockedBag.items, materialId, cost);
        return {state:raw};
      });
      state.character = await db.characterById(state.gatewayId);
      state.pendingPetEquipRefine = {...rolled, key, instanceId:item.instanceId};
      output = {...output, result:true, ...rolled};
      sendInventorySnapshot(state);
    }
  } catch (err) {
    log(`[SILFO REFINO #${state.id}] ${err.message}`);
  }
  sendGameSession(state, 4501, originalPb.encode('pet.PetEquipRefreshRspMsg', output));
}

async function handleItemResolve(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  try {
    sendGameSession(state, 4260, originalPb.encode('store.SmithResolveRspMsg', {}));
    sendGameSession(state, 115, makeInventorySnapshot(state.gatewayId, state.character?.state_json), state.gatewayId);
    log(`[FERREIRO DECOMPOSIÇÃO #${state.id}] Item decomposto com sucesso (4260).`);
  } catch (err) {
    log(`[FERREIRO DECOMPOSIÇÃO #${state.id}] Erro: ${err.message}`);
  }
}

async function handleFashionCompose(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  try {
    const rsp = { strengResult: true };
    sendGameSession(state, 4487, originalPb.encode('store.StoreRspMsg', rsp));
    log(`[MODA SÍNTESE #${state.id}] Moda sintetizada (4487).`);
  } catch (err) {
    log(`[MODA SÍNTESE #${state.id}] Erro: ${err.message}`);
  }
}

async function handleMapBossDatas(state, body) {
  if (!state.gatewayId || state.closed) return;
  await outerCityState.handleMapBossDatas(state, body, sendGameSession, originalPb, log);
}

async function handleDragonCrystalMining(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 807, originalPb.encode('dragoncrystal.DragonCrystalRoomRes', { mineList: [] }));
    log(`[CRISTAIS DE DRAGÃO #${state.id}] Mina de cristais sincronizada (807).`);
  } catch (err) {
    log(`[CRISTAIS DE DRAGÃO #${state.id}] Erro: ${err.message}`);
  }
}

async function handleOutCityGoldList(state, body) {
  if (!state.gatewayId || state.closed) return;
  await outerCityState.handleOutCityGoldList(state, body, sendGameSession, originalPb, log);
}

async function handleArmyAttack(state, body) {
  if (!state.gatewayId || state.closed) return;
  await outerCityState.handleArmyAttack(state, body, sendGameSession, originalPb, log, inventoryState, db);
}

async function handleUnoccupyWildLand(state, body) {
  if (!state.gatewayId || state.closed) return;
  await outerCityState.handleUnoccupyWildLand(state, body, sendGameSession, originalPb, log, db);
}

async function handleArmyReturnHome(state, body) {
  if (!state.gatewayId || state.closed) return;
  await outerCityState.handleArmyReturnHome(state, body, sendGameSession, originalPb, log);
}

async function handleTreasureMineInfo(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 4741, originalPb.encode('treasuremine.TreasureMineMsg', outerCityState.getTreasureMineMsg(state)));
    log(`[CIDADE EXTERIOR #${state.id}] Minas de tesouro sincronizadas (4741).`);
  } catch (err) {
    log(`[CIDADE EXTERIOR #${state.id}] Erro em handleTreasureMineInfo: ${err.message}`);
  }
}

async function handleAdvancedTalentReq(state, body) {
  if (!state.gatewayId || state.closed) return;
  let req = { op: 0, skillTempId: 0, upGrade: 1 };
  try {
    if (body && body.length) {
      req = originalPb.decode('advancedtalent.AdvancedTalentReqMsg', body);
    }
  } catch (_) {}

  const op = Number(req.op || 0);
  const skillTempId = Number(req.skillTempId || 0);
  const upGrade = Math.max(1, Number(req.upGrade || 1));

  try {
    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
      if (!saved.advancedTalent || typeof saved.advancedTalent !== 'object') {
        saved.advancedTalent = {
          talentGrade: Number(saved.talentGrade || 10),
          talentPoint: Number(saved.talentPoint || 10),
          talentSkill: ''
        };
      }
      const at = saved.advancedTalent;
      at.talentGrade = Number(at.talentGrade || 10);
      if (at.talentPoint === undefined) at.talentPoint = at.talentGrade;

      // op 0: TALENT_UPGRADE
      if (op === 0) {
        at.talentGrade += upGrade;
        at.talentPoint += upGrade;
      }
      // op 1: RESET_TALENT_POINT
      else if (op === 1) {
        at.talentPoint = at.talentGrade;
        at.talentSkill = '';
      }
      // op 2: UPGRADE_TALENT_SKILL
      else if (op === 2 && skillTempId > 0) {
        if (at.talentPoint >= 1) {
          at.talentPoint -= 1;
          const skillsMap = new Map();
          if (at.talentSkill && typeof at.talentSkill === 'string') {
            for (const pair of at.talentSkill.split('|')) {
              const p = pair.split(',');
              if (p.length >= 2) skillsMap.set(Number(p[0]), Number(p[1]) || 1);
            }
          }
          const curLvl = skillsMap.get(skillTempId) || 0;
          skillsMap.set(skillTempId, curLvl + 1);
          at.talentSkill = [...skillsMap.entries()].map(([k, v]) => `${k},${v}`).join('|');
        }
      }

      return {
        state: saved,
        talentPoint: at.talentPoint,
        talentGrade: at.talentGrade,
        talentSkill: at.talentSkill || ''
      };
    });

    state.character.state_json = result.state;
    state.character = await db.characterById(state.gatewayId);

    // Envia Opcode 4434 (AdvancedTalentInfoMsg)
    sendGameSession(state, 4434, originalPb.encode('advancedtalent.AdvancedTalentInfoMsg', {
      talentPoint: result.talentPoint,
      talentGrade: result.talentGrade,
      talentSkill: result.talentSkill
    }));

    // Sincroniza hero info e básico
    const updatedHero = heroState.heroInfo(state.character);
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

    log(`[TALENTO AVANÇADO #${state.id}] Sincronizado op=${op} (Pts=${result.talentPoint}, Grade=${result.talentGrade}, Skills="${result.talentSkill}").`);
  } catch (err) {
    log(`[TALENTO AVANÇADO #${state.id}] Erro: ${err.message}`);
  }
}

async function handleWorldBossCmd(state, body) {
  if (!state.gatewayId || !state.heroSent || state.closed) return;
  let req = {};
  try {
    if (body && body.length) {
      req = originalPb.decode('worldmap.WorldBossMsg', body);
    }
  } catch (_) {}
  const campaignId = Number(req.param1) || 5001;
  log(`[CHEFÃO MUNDIAL #${state.id}] Entrando no Chefão Mundial ${campaignId}`);
  await enterCampaignById(state, campaignId);
}

async function handleNavigationReq(state, body) {
  if (!state.gatewayId || state.closed) return;
  let req = { op: 0 };
  try {
    if (body && body.length) {
      req = originalPb.decode('navigation.NavigationOpMsg', body);
    }
  } catch (_) {}

  const op = Number(req.op || 0);

  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      const res = navigationState.handleOperate(saved, op, req.param1, req.param2, req.param3, req.param4);
      return { state: saved, res };
    });

    state.character.state_json = result.state;

    // Opcode 341 (U_C_NAVIGATION_MSG)
    try {
      const resWire = originalPb.encode('navigation.NavigationResMsg', {
        op: result.res.op,
        result: result.res.result,
        data: result.res.data
      });
      sendGameSession(state, 341, resWire);
    } catch (err) {
      log(`[NAVEGAÇÃO #${state.id}] Erro ao codificar 341: ${err.message}`);
    }

    // Opcode 342 (U_C_NAVIGATION_DATA_MSG)
    try {
      const dataWire = originalPb.encode('navigation.NavigationMsg', result.res.data);
      sendGameSession(state, 342, dataWire);
    } catch (err) {
      log(`[NAVEGAÇÃO #${state.id}] Erro ao codificar 342: ${err.message}`);
    }

    log(`[NAVEGAÇÃO #${state.id}] Operação op=${op} concluída. Dados 341/342 sincronizados.`);
  } catch (err) {
    log(`[NAVEGAÇÃO #${state.id}] Erro: ${err.message}`);
  }
}

async function handleTransferReq(state, body) {
  if (!state.gatewayId || state.closed) return;
  let req = { op: 1, type: 1 };
  try {
    if (body && body.length) {
      req = originalPb.decode('recover.TransferOpReq', body);
    }
  } catch (_) {}

  const op = Number(req.op || 1);
  const type = Number(req.type || 1);

  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      saved.numJobChange = type;
      return { state: saved, type };
    });

    state.character.state_json = result.state;
    state.character = await db.characterById(state.gatewayId);

    // Opcode 4974 (TransferInfoRes)
    sendGameSession(state, 4974, originalPb.encode('recover.TransferInfoRes', {
      type: result.type
    }));

    // Sincroniza hero info e básico
    const updatedHero = heroState.heroInfo(state.character);
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

    log(`[AVANÇO CLASSE #${state.id}] Avanço de Classe realizado op=${op}, type=${type} (Opcode 4974).`);
  } catch (err) {
    log(`[AVANÇO CLASSE #${state.id}] Erro: ${err.message}`);
  }
}

async function handleGameBoxReq(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 814, originalPb.encode('gamebox.GameBoxInfoRes', {
      gameInfo: { '1': 3, '2': 3, '3': 3, '4': 3, '5': 3, '6': 3 }
    }));
    log(`[GAME BOX #${state.id}] Minijogos sincronizados (Opcode 814: 3 tentativas para Sudoku e Combinar Peças).`);
  } catch (err) {
    log(`[GAME BOX #${state.id}] Erro: ${err.message}`);
  }
}

async function handleTalentGradeUp(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    let upGrade = 1;
    try {
      const req = originalPb.decode('army.TalentUpGradeReq', body);
      if (req && req.upGrade) upGrade = Math.max(1, Number(req.upGrade));
    } catch (_) {}

    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
      saved.talentGrade = Number(saved.talentGrade || 0);
      saved.talentPoint = Number(saved.talentPoint || 0);
      const nextGrade = saved.talentGrade + upGrade;

      let totalGoldCost = 0;
      let totalExpCost = 0;
      for (let g = saved.talentGrade + 1; g <= nextGrade; g++) {
        const row = talentUpgrades.get(g);
        if (row) {
          totalGoldCost += Number(row.TemplateId || 0);
          totalExpCost += Number(row.Data || 0);
        }
      }

      saved.wallet = saved.wallet || {};
      const currentGold = Number(saved.wallet.gold || locked.gold || 0);
      if (totalGoldCost > 0 && currentGold < totalGoldCost) {
        throw new Error(`Ouro insuficiente para aprimorar talento: requer ${totalGoldCost}, possui ${currentGold}`);
      }

      if (totalGoldCost > 0) {
        saved.wallet.gold = currentGold - totalGoldCost;
      }

      saved.talentGrade = nextGrade;
      saved.talentPoint = saved.talentPoint + upGrade;
      saved.sealOrder = Array.isArray(saved.sealOrder) && saved.sealOrder.length > 0 ? saved.sealOrder : [1, 2, 3];

      return {
        state: saved,
        talentGrade: saved.talentGrade,
        talentPoint: saved.talentPoint,
        sealOrder: saved.sealOrder,
        gold: saved.wallet.gold
      };
    });

    state.character = await db.characterById(state.gatewayId);
    state.character.state_json = JSON.stringify(result.state);

    sendGameSession(state, 4430, originalPb.encode('army.TalentUpGradeMsg', { upresult: true }));
    sendGameSession(state, 4431, originalPb.encode('army.HeroTalentMsg', {
      userId: state.gatewayId,
      talentPoint: result.talentPoint,
      talentGrade: result.talentGrade,
      talentSkill: String(result.state.talentSkill || ''),
      sealOrder: result.sealOrder,
      currentBranch: 1002,
      isActiveSecond: false,
      talentIndex: 0
    }));

    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    log(`[TALENTO GRADE UP #${state.id}] Talento aprimorado para Nv. ${result.talentGrade} (Pontos: ${result.talentPoint}). Opcodes 4430, 4431 e 3 enviados.`);
  } catch (err) {
    log(`[TALENTO GRADE UP #${state.id}] Erro: ${err.message}`);
    try {
      sendGameSession(state, 4430, originalPb.encode('army.TalentUpGradeMsg', { upresult: false }));
    } catch (_) {}
  }
}

async function handleGuardExpeditionary(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 4945, originalPb.encode('guardpatrol.GuardPatrolTaskTotalMsg', { task: [] }));
    log(`[EXPEDIÇÃO GUARDIÃO #${state.id}] Expedição sincronizada (4945).`);
  } catch (err) {
    log(`[EXPEDIÇÃO GUARDIÃO #${state.id}] Erro: ${err.message}`);
  }
}

async function handleMarriageInfoReq(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 466, originalPb.encode('marriage.MarriageMsg', {}));
    log(`[CASAMENTO #${state.id}] Informações de casamento sincronizadas (466).`);
  } catch (err) {
    log(`[CASAMENTO #${state.id}] Erro: ${err.message}`);
  }
}

async function handleHomeHouseInfo(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 801, originalPb.encode('home.HomeHouseResp', { furnitureList: [] }));
    log(`[LAR / CASA #${state.id}] Casa sincronizada (801).`);
  } catch (err) {
    log(`[LAR / CASA #${state.id}] Erro: ${err.message}`);
  }
}

async function handleConsortiaInfoReq(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 4157, originalPb.encode('consortia.ConsortiaInfoMsg', { site: 1, hiSkillList: [] }));
    log(`[GUILDA #${state.id}] Guilda sincronizada (4157).`);
  } catch (err) {
    log(`[GUILDA #${state.id}] Erro: ${err.message}`);
  }
}

async function handleRareWeaponDrawReq(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 802, originalPb.encode('rareweapon.RareWeaponDrawMainInfo', { info: [] }));
    log(`[ARMA RARA #${state.id}] Sorteio de arma rara sincronizado (802).`);
  } catch (err) {
    log(`[ARMA RARA #${state.id}] Erro: ${err.message}`);
  }
}

async function handleRareWeaponMainReq(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 553, originalPb.encode('rareweapon.RareWeaponMainInfo', { info: [] }));
    log(`[ARMA RARA #${state.id}] Informações principais sincronizadas (553).`);
  } catch (err) {
    log(`[ARMA RARA #${state.id}] Erro: ${err.message}`);
  }
}

async function handleMailCheck(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 337, pbRecord([pbInt(1, 0)]));
    log(`[CORREIO #${state.id}] Checagem de novas cartas sincronizada (337).`);
  } catch (err) {
    log(`[CORREIO #${state.id}] Erro: ${err.message}`);
  }
}

async function handleMailList(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 4131, originalPb.encode('mail.MailListRspMsg', { mailInfos: [] }));
    log(`[CORREIO #${state.id}] Lista de mensagens sincronizada (4131).`);
  } catch (err) {
    log(`[CORREIO #${state.id}] Erro: ${err.message}`);
  }
}

async function handleDegreeActivityRefresh(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 8236, originalPb.encode('active.DayActiveRspMsg', { dayActiveRspInfo: [] }));
    log(`[ATIVIDADES #${state.id}] Grau de atividades diárias sincronizado.`);
  } catch (err) {
    log(`[ATIVIDADES #${state.id}] Erro: ${err.message}`);
  }
}

async function handleWishPoolOp(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 197, pbRecord([pbInt(1, 0)]));
    log(`[POÇO DOS DESEJOS #${state.id}] Sorteio sincronizado (197).`);
  } catch (err) {
    log(`[POÇO DOS DESEJOS #${state.id}] Erro: ${err.message}`);
  }
}

async function handleVipRoulette(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 4414, pbRecord([pbInt(1, 1)]));
    log(`[ROLETA VIP #${state.id}] Roleta VIP sincronizada (4414).`);
  } catch (err) {
    log(`[ROLETA VIP #${state.id}] Erro: ${err.message}`);
  }
}

function sendWorldClock(state) {
  if(!state.gatewayId)return;
  const now=new Date();
  const timeString=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),
    String(now.getDate()).padStart(2,'0')].join('-')+' '+
    [now.getHours(),now.getMinutes(),now.getSeconds()].map(v=>String(v).padStart(2,'0')).join(':');
  sendGameSession(state,4234,pbRecord([pbString(1,timeString),pbInt(2,Date.now())]));
  stats.syncResponses++;
}
function scheduleSession(state,callback,delay){
 if(!state.timers)state.timers=new Set();
 const timer=setTimeout(()=>{state.timers.delete(timer);if(!state.closed)callback();},delay);
 state.timers.add(timer);return timer;
}

// Movimentos por sessao, sem alterar estado persistido nem tabelas de drop.
function stopSylphAtollPatrol(state){
  if(state.atollPatrolTimer){clearTimeout(state.atollPatrolTimer);state.timers?.delete(state.atollPatrolTimer);state.atollPatrolTimer=null;}
  state.atollPatrol=null;state.atollAggroTimes=null;
}
function beginSylphAtollPatrol(state,mapId,layout){
  stopSylphAtollPatrol(state);
  const patrol={...layout,mapId:Number(mapId),cursor:0};
  state.atollPatrol=patrol;
  const tick=()=>{
    state.atollPatrolTimer=null;
    if(state.closed||state.socket?.destroyed||state.atollPatrol!==patrol)return;
    let saved;
    try{saved=inventoryState.parseState(state.character?.state_json||{});}catch(err){stopSylphAtollPatrol(state);return;}
    if(Number(saved.position?.mapId)!==patrol.mapId||Number(saved.campaigns?.current?.campaignId)!==20000){stopSylphAtollPatrol(state);return;}
    const now=Date.now(), blocked=new Set();
    for(const e of patrol.entries){
      if(atollEncounters.cooldownUntil(saved,e.id)>now||now-Number(state.atollAggroTimes?.get(e.id)||0)<7000)blocked.add(e.id);
    }
    const player={x:Number(saved.position?.x),y:Number(saved.position?.y)};
    try{
      for(const movement of atollPatrol.nextMoves(patrol,player,12,blocked))
        sendGameSession(state,4122,originalPb.encode('campaign.NPCMoveMsg',movement));
    }catch(err){log(`[ATOL PATRULHA #${state.id}] Movimento recusado: ${err.message}`);stopSylphAtollPatrol(state);return;}
    state.atollPatrolTimer=scheduleSession(state,tick,2700);
  };
  state.atollPatrolTimer=scheduleSession(state,tick,1800);
  log(`[ATOL PATRULHA #${state.id}] Mapa ${mapId}, NPCs hostis=${layout.entries.length}, opcode 4122 agendado.`);
}
function scheduleEnergyRegeneration(state) {
  if (!state.gatewayId || state.closed || state.energyRegenTimer) return;
  const hourMs = 3600000;
  const delay = Math.max(1000, (Math.floor(Date.now() / hourMs) + 1) * hourMs - Date.now() + 250);
  state.energyRegenTimer = scheduleSession(state, () => {
    state.energyRegenTimer = null;
    state.work = state.work.then(async () => {
      if (state.closed || !state.gatewayId) return;
      const result = await db.mutateCharacterState(state.gatewayId, saved => {
        const energyRecovery = energyRules.recoverTimedEnergy(saved);
        return { state: saved, energyRecovery };
      });
      if (result.energyRecovery?.gained > 0 && !state.closed) {
        state.character = await db.characterById(state.gatewayId);
        sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
        log(`[ENERGIA #${state.id}] Regeneracao +${result.energyRecovery.gained}:${result.energyRecovery.after}/200`);
      }
    }).catch(error => {
      log(`[ENERGIA #${state.id}] Erro de regeneracao:${error.message}`);
    }).finally(() => {
      if (!state.closed) scheduleEnergyRegeneration(state);
    });
  }, delay);
}
function scheduleCloudRestore(state,delay){
 if(!state.cloudRestorePosition||!state.character||(state.character.grade&&state.character.grade<15))return;
 if(state.cloudRestoreTimer){clearTimeout(state.cloudRestoreTimer);state.timers?.delete(state.cloudRestoreTimer);}
 state.cloudRestoreTimer=scheduleSession(state,()=>{
   state.cloudRestoreTimer=null;
   const position=state.cloudRestorePosition;state.cloudRestorePosition=null;
   if(!position||!state.character||state.closed)return;
   try{sendCloudScene(state,state.character,position)}
   catch(error){log(`[SPACE #${state.id}] Falha ao restaurar Cloud City:${error.message}`)}
 },delay);
}
function scheduleInventorySnapshot(state,delay){
 if(state.inventorySnapshotSent||state.inventorySnapshotAttempted||state.inventorySnapshotTimer)return;
 state.inventorySnapshotTimer=scheduleSession(state,()=>{
   state.inventorySnapshotTimer=null;state.inventorySnapshotAttempted=true;
   if(!state.inventorySnapshotSent)state.inventorySnapshotSent=sendInventorySnapshot(state);
 },delay);
}
function clearSessionTimers(state){for(const timer of state.timers||[])clearTimeout(timer);state.timers?.clear();}
function bootstrapPlayerInfo(state,char){
  if(!BOOTSTRAP_PLAYER || state.bootstrapSent)return;
  state.bootstrapSent=true;stats.worldBootstraps++;
  if(state.socket.destroyed || state.closed)return;
  try {
    sendWorldClock(state);
    sendGameSession(state,4177,makeSignInfo(char),char.id);
    sendGameSession(state,3,makeBasicPlayerInfo(char),char.id);
    log(`[WORLD #${state.id}] U_C_PLAYER_INFO enviado: personagem${char.id}.`);
  }catch(e){log(`[WORLD #${state.id}] Falha ao enviar player info:`,e.message);}
}
async function handleGatewayLogin(state,parsed,packet) {
  if(!parsed.checksumOK){stats.badChecksums++;log(`[GATEWAY #${state.id}] Checksum invalido; sem resposta.`);return;}
  let payload;
  try{payload=readGatewayRequest(packet.subarray(20));}
  catch(e){log(`[GATEWAY #${state.id}] Pedido rejeitado:${e.message}`);return;}
  let charId = payload.playerId;
  if ((!charId || charId === 0) && lastRegisteredRole && (Date.now() - lastRegisteredRole.time < 30000)) {
    charId = lastRegisteredRole.charId;
    log(`[GATEWAY #${state.id}] Associando conexao inicial pos-registro ao personagem recem-criado ID${charId}.`);
  }
  if(parsed.clientId !== 0 && parsed.clientId !== charId){
    log(`[GATEWAY #${state.id}] ID da mensagem (${charId}) difere do cabecalho (${parsed.clientId}); rejeitado.`);return;
  }
  if (Number.isSafeInteger(charId) && charId > 0) {
    try {
      await db.mutateCharacterState(charId, saved => {
        const energyRecovery = energyRules.recoverTimedEnergy(saved);
        return { state: saved, energyRecovery };
      });
    } catch (error) {
      log(`[ENERGIA LOGIN #${state.id}] Falha na regeneracao:${error.message}`);
    }
  }
  let char=await resourceService.refresh(charId).catch(()=>null);
  if(!char){
    char=await db.characterById(charId).catch(()=>null);
  }
  if(!char||char.site!=='S1'){
    log(`[GATEWAY #${state.id}] Personagem inexistente no MySQL; rejeitado.`);return;
  }
  for(const existing of sessions){
    if(existing!==state && existing.gatewayId===char.id && !existing.closed){
      log(`[GATEWAY #${state.id}] Substituindo sessao anterior #${existing.id} para personagem${char.id}.`);
      existing.closed=true;
      clearSessionTimers(existing);
      try{existing.socket.destroy();}catch(_){}
      sessions.delete(existing);
    }
  }
  state.key=Uint8Array.from(payload.ekeys);
  state.txKey=Uint8Array.from(payload.ekeys);
  state.gatewayId=char.id;
  state.character=char;
  transition(state,'AUTHENTICATED','gateway-20001');
  transition(state,'CHARACTER_LOADED','mysql-character');
  state.initSent=false;state.initFinished=false;state.sceneStateSent=false;state.sceneStateRequested=false;state.sceneStateRequests=0;
  sendGatewayAccepted(state,char.id);
  bootstrapPlayerInfo(state,char);
  scheduleEnergyRegeneration(state);
  log(`[GATEWAY #${state.id}] Handshake concluido para personagem${char.id}.`);
}

function clockString(){
 const d=new Date();return [d.getFullYear(),d.getMonth()+1,d.getDate()].map((x,i)=>i===0?String(x):String(x).padStart(2,'0')).join('-')+' '+
 [d.getHours(),d.getMinutes(),d.getSeconds()].map(x=>String(x).padStart(2,'0')).join(':');
}
function getCharacterVip(char) {
  const vipLevel = Number(char?.vip_level) || 0;
  const vipType = Number(char?.vip_type) || 1;
  const vipPoints = Number(char?.vip_points) || 0;
  let isVip = false;
  let buffEndTime = 0;
  let buffGainTime = 0;

  if (vipLevel > 0) {
    if (char.vip_expire_time) {
      const expDate = new Date(char.vip_expire_time);
      if (expDate.getTime() > Date.now()) {
        isVip = true;
        buffEndTime = Math.floor(expDate.getTime() / 1000);
        buffGainTime = Math.floor(Date.now() / 1000);
      }
    } else {
      isVip = true;
      buffEndTime = Math.floor(new Date('2038-01-01 00:00:00').getTime() / 1000);
      buffGainTime = Math.floor(Date.now() / 1000);
    }
  }

  const effectiveGrade = isVip ? vipLevel : 0;
  const effectivePoints = vipPoints > 0 ? vipPoints : (effectiveGrade * 1000);

  return {
    isVip,
    vipLevel: effectiveGrade,
    vipType,
    vipPoints: effectivePoints,
    buffGainTime,
    buffEndTime
  };
}

function formatVipInfoMsg(char) {
  const vip = getCharacterVip(char);
  return {
    vipGp: vip.vipPoints,
    vipGrade: vip.vipLevel,
    isGainBuff: vip.isVip,
    buffGainTime: vip.buffGainTime,
    buffEndTime: vip.buffEndTime,
    giftState: []
  };
}

function sendVipInfo(state) {
  if (!state.gatewayId || !state.character || state.closed) return;
  try {
    const vipPayload = formatVipInfoMsg(state.character);
    sendGameSession(state, 4410, originalPb.encode('vip.VipInfoMsg', vipPayload));
    log(`[VIP #${state.id}] VipInfo enviado: Nv.${vipPayload.vipGrade} (Buff: ${vipPayload.isGainBuff}, GP:${vipPayload.vipGp})`);
  } catch (err) {
    log(`[VIP #${state.id}] Falha ao enviar VipInfo:${err.message}`);
  }
}

function initialMessages(state) {
 const id=state.gatewayId||0, stamp=clockString();
 const charGrade = state.character?.grade || 1;
 const savedForCastle=state.character?.state_json?inventoryState.parseState(state.character.state_json):{};
 castleState.ensureCastleState(savedForCastle, charGrade);
 const buildingWire=originalPb.encode('building.BuildingInfoListMsg',castleState.formatBuildingListMsg(savedForCastle,id, charGrade));
 const buildOrderWire=originalPb.encode('building.BuildOrderList',castleState.formatBuildOrderListMsg(savedForCastle,id));
 const versionWire=originalPb.encode('player.VersionMsg', { openVersion: true, openStory: true, module: 1 });
 const snsWire=originalPb.encode('simple.SNSInfoMsg', { userId: id, nickname: state.character?.nickname || '' });
 const vipWire=originalPb.encode('vip.VipInfoMsg', formatVipInfoMsg(state.character));
 const uiPlayWire=originalPb.encode('uiplay.UserUiPlayListMsg',
    uiplayState.formatUiPlayListMsg(savedForCastle, id));
 return [
  {code:4233,label:'VersionMsg',data:versionWire},
  {code:4410,label:'VipInfoMsg',data:vipWire},
  {code:4743,label:'UserUiPlayListMsg',data:uiPlayWire},
  {code:4160,label:'SystemPropertyMsg',data:pbRecord([pbString(1,stamp),pbString(2,stamp)])},
  {code:4173,label:'PlayerAASRefreshMsg',data:pbRecord([pbInt(1,0),pbInt(2,1)])},
  {code:4176,label:'ChallengeCoolTimeMsg',data:pbRecord([pbInt(1,0),pbInt(2,0),pbInt(3,0),pbInt(4,0),pbInt(5,0)])},
  {code:4156,label:'FriendRelationList',data:pbRecord([pbInt(3,0),pbInt(4,0)])},
  {code:4153,label:'BaseCastleMsg',data:originalPb.encode('army.BaseCastleMsg', {
    id: id,
    mapId: 5,
    posX: 361,
    posY: 1314,
    templateId: 101,
    type: 1,
    occupyPlayerId: 0,
    occupyPlayerName: '',
    occupyLeagueName: '',
    state: 0,
    defenceLefttime: 0,
    castleName: 'Cidade',
    leftEnergy: Number(savedForCastle.outerEnergy) || 200,
    grade: Number(state.character?.grade) || 1,
    isDefenc: false,
    vipCastleView: 0,
    vipType: 1,
    vipGrade: Number(state.character?.vip_level) || 0
  })},
  {code:4556,label:'HonorEquipInfoMsg',data:originalPb.encode('simple.HonorEquipInfoMsg', {
    level: Number(savedForCastle.honorEquip?.level) || 0,
    stage: Number(savedForCastle.honorEquip?.stage) || 0
  })},
  {code:4154,label:'BuildingInfoListMsg',data:buildingWire},
  {code:4155,label:'BuildOrderList',data:buildOrderWire},
  {code:4245,label:'SNSInfoMsg',data:snsWire},
  {code:4157,label:'LoadFarmRsp',data:pbMessage(2,pbRecord([pbInt(1,id),pbInt(3,1),pbMessage(12,pbInt(2,0))]))}
 ];
}
function buildLoginStateBody(playerId, scene) {
  if(!Number.isSafeInteger(playerId)||playerId<=0||!Number.isInteger(scene)||![0,1,2,3,4,10].includes(scene))
    throw Error('Estado de cena ou ID invalido');
  return pbRecord([pbInt(1,playerId),pbInt(2,scene)]);
}

function classifyLoginDataRequest(body) {
  if(!Buffer.isBuffer(body)||body.length>2048)throw Error('8224 fora do limite');
  const shape=inspectPbShape(body);
  if(!shape.possibleProtobuf)throw Error('8224 protobuf invalido');
  const wanted=new Set([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34]);
  const flags=pbReadSimple(body,wanted);
  const init=Object.entries(flags).some(([key,value])=>key!=='1' && value===1 && [2,3,5,6,7,8,9,10,11,12,13,14,15,16,17,20,23,24,25,26,28,30,31,32].includes(Number(key)));
  return {user:flags[1]===1,army:flags[3]===1,bag:flags[9]===1,init,fieldCount:shape.fields.length};
}
function trySceneState(state,origin){
  if(!LOGIN_SCENE_STATE||!state.gatewayId||!state.initFinished||state.sceneStateSent||state.closed)return;
  if(!state.closed && !state.socket.destroyed && !state.sceneStateSent){
    try {
      const saved = state.character?.state_json ? inventoryState.parseState(state.character.state_json) : {};
      const isFinished = typeof saved.newNoviceProcess === 'string' && saved.newNoviceProcess.includes('150');
      const sceneToSend=cityState.resumeScene(saved,Number(state.character.grade),LOGIN_SCENE_STATE);
      const body=buildLoginStateBody(state.gatewayId, sceneToSend);
      sendGameSession(state,6,body);
      state.sceneStateSent=true;
      if(isFinished&&state.character.grade>=15&&cityState.validCloud(saved.position)){
        state.cloudRestorePosition={...saved.position};
        scheduleCloudRestore(state,5000);
      }
      if(state.phase==='BASE_DATA_SENT')transition(state,'SCENE_REQUESTED','8224-user');
      if(state.phase==='SCENE_REQUESTED')transition(state,'SCENE_SENT','packet-6');
      sceneStateEvents.push({time:new Date().toISOString(),connection:state.id,code:6,scene:sceneToSend,bytes:body.length,reason:origin});
      if(sceneStateEvents.length>35)sceneStateEvents.shift();
      log(`[CENA #${state.id}] U_C_PLAYER_LOGINSTATEE (6) enviado; state=${sceneToSend}; origin=${origin}`);
    }catch(err){log(`[CENA #${state.id}] Falha ao enviar estado:`,err.message);}
  }
}
function handleLoginDataRequest(state,body) {
  if(!state.gatewayId||state.closed)return;
  let req;
  try {req=classifyLoginDataRequest(body);}catch(err){log(`[8224 #${state.id}]${err.message}`);return;}
  log(`[8224 #${state.id}] Inicializacao=${req.init} estadoDeCena=${req.user}, campos=${req.fieldCount}.`);
  if(req.init)runExperimentalInit(state);
  if(req.user){
    state.sceneStateRequests=(state.sceneStateRequests||0)+1;
    state.sceneStateRequested=true;trySceneState(state,'8224-user');
  }
}

function runExperimentalInit(state) {
 if(!state.gatewayId||state.closed)return;
 if(state.initSent && Date.now() - (state.lastInitTime || 0) < 500) return;
 state.lastInitTime = Date.now();
 if(!INIT_EXPERIMENTAL){
   state.initSent=true;state.initFinished=true;trySceneState(state,'init-desabilitada');
   return;
 }
 state.initSent=true;stats.initLoads++;
 try{
   const saved=inventoryState.parseState(state.character.state_json);
   barracksState.ensureArmyPawns(saved);
   campaignState.ensureCampaignState(saved, state.character?.grade || 1);
   castleState.ensureCastleState(saved, state.character?.grade || 1);
   state.character.state_json = JSON.stringify(saved);
   db.mutateCharacterState(state.gatewayId, s => {
     castleState.ensureCastleState(s, state.character?.grade || 1);
     return { state: s };
   }).catch(e => log(`[INIT-CASTLE-DB #${state.id}] ${e.message}`));
   const army=heroState.armyInfo(state.character);
   sendGameSession(state,150,originalPb.encode('army.ArmyMsg',army));state.heroSent=true;
   sendGameSession(state,113,originalPb.encode('army.SimpleHeroInfoMsg',army.simpleHeroInfo));
   sendGameSession(state,113,originalPb.encode('army.SimpleHeroInfoMsg',army.simpleHeroInfo));
   sendVipInfo(state);
   const barracksPawns = barracksState.formatArmyPawnUpdatedMsg(saved, state.gatewayId);
   if(barracksPawns.armyPawn && barracksPawns.armyPawn.length > 0){
     sendGameSession(state,92,originalPb.encode('army.ArmyPawnUpdatedMsg',barracksPawns));
     sendGameSession(state,100,originalPb.encode('army.ArmyPawnUpdatedMsg',barracksPawns));
   }
   if(saved.fashionDisplay)sendGameSession(state,301,originalPb.encode('simple.FashionInfoMsg',saved.fashionDisplay));
   sendGameSession(state,4542,originalPb.encode('fashion.FashionMsg',formatFashionBookMsg(saved)));
   secondarySystemsState.ensureSecondarySystemsState(saved);
   sendGameSession(state, 4540, originalPb.encode('pet.PlayerPetMsg', secondarySystemsState.formatPlayerPetMsg(saved, state.gatewayId, 0)));
   sendGameSession(state, 4873, originalPb.encode('combatguardian.CombatGuardianOpRes', secondarySystemsState.formatCombatGuardianOpRes(saved)));
   sendGameSession(state, 4631, originalPb.encode('watch.HeroWatchMsg', secondarySystemsState.formatHeroWatchMsg(saved)));
   sendGameSession(state, 4964, originalPb.encode('remotepet.RemotePetMsg', secondarySystemsState.formatRemotePetMsg(saved, state.gatewayId)));
   sendGameSession(state, 4484, originalPb.encode('player.AppellsMsg', secondaryFeatures.formatAppellsMsg(saved)));
   sendGameSession(state, 4980, originalPb.encode('army.RuneHoleAllInfoMsg', secondaryFeatures.formatRuneHoleAllInfoMsg(saved)));
   sendGameSession(state, 555, originalPb.encode('dragonsoul.DragonSoulOpRes', secondaryFeatures.formatDragonSoulOpRes(saved)));
   sendGameSession(state, 4190, originalPb.encode('dailytarget.DailyTargetList', secondaryFeatures.formatDailyTargetList(saved)));
   astralState.ensureAstralState(saved);
   const starMoves = astralState.formatAllAstralsMoveMsg(saved, state.gatewayId);
   if (starMoves.move.length > 0) {
     sendGameSession(state, 4178, originalPb.encode('star.StarMoveRspMsg', starMoves));
   }
   sendGameSession(state, 4180, originalPb.encode('star.StarRandRspMsg', {
     site: saved.astrals.spheres || [1, 0, 0, 0, 0],
     starRand: []
   }));
   sendGameSession(state, 4240, originalPb.encode('player.MultiCampaignEnterCountMsg', { campaignCount: 5, campaignMaxcount: 5 }));
   sendGameSession(state, 4900, originalPb.encode('campaign.KingTowerInfoMsg', {
     enterCount: 0,
     currentIndex: 1,
     maxIndex: 10,
     campaignId: 8200,
     currentStep: 1,
     rewardCount: 1
   }));
   const rankMsg = buildCampaignRankList(saved, state.gatewayId, 1001);
   sendGameSession(state, 4151, originalPb.encode('campaign.RankListRspMsg', rankMsg));
   sendGameSession(state, 512, originalPb.encode('growthfund.GrowthFundRes', {
     buyIds: Array.isArray(saved.growthFund?.buyIds) ? saved.growthFund.buyIds : [],
     receiveIds: Array.isArray(saved.growthFund?.receiveIds) ? saved.growthFund.receiveIds : []
   }));
   extendedSubsystems.ensureSubsystemsState(saved);
   sendGameSession(state, 274, originalPb.encode('player.TattooHoleRspMsg', {
     opType: 1,
     holeInfo: Array.isArray(saved.tattoo?.holes) ? saved.tattoo.holes : [1, 2, 3, 4, 5, 6].map(h => ({
       hole: h,
       OldAddProperty: 1, OldAddingValue: 100,
       OldReduceProperty: 2, OldReduceValue: 50,
       OldStage: 1,
       NewAddProperty: 1, NewAddingValue: 100,
       NewReduceProperty: 2, NewReduceValue: 50,
       NewStage: 1
     })),
     param1: Number(saved.tattoo?.coreStep || 1),
     param2: 0,
     param3: ''
   }));
   sendGameSession(state, 4980, originalPb.encode('army.RuneHoleAllInfoMsg', secondaryFeatures.formatRuneHoleAllInfoMsg(saved)));
   sendGameSession(state, 449, originalPb.encode('extrajob.ExtraJobMsg', {
     op: 1,
     activeList: [41, 42, 43, 44].map(j => ({
       jobType: j,
       jobLevel: Number(saved.extraJob?.active?.[j]?.level || 1),
       skillScript: ''
     }))
   }));
   sendGameSession(state, 450, originalPb.encode('extrajob.ExtraJobEquipMsg', {
     op: 1,
     equipList: [1, 2, 3, 4, 5, 6].map(e => ({
       equipType: e,
       equipLevel: Number(saved.extraJob?.equips?.[e]?.level || 1),
       strengthenLevel: Number(saved.extraJob?.equips?.[e]?.strengthenLevel || 0),
       join1: 0, join2: 0, join3: 0, join4: 0
     }))
   }));
   sendGameSession(state, 555, originalPb.encode('dragonsoul.DragonSoulOpRes', secondaryFeatures.formatDragonSoulOpRes(saved)));
   sendGameSession(state, 4556, originalPb.encode('simple.HonorEquipInfoMsg', {
     level: Number(saved.honorEquip?.level || 0),
     stage: Number(saved.honorEquip?.stage || 1)
   }));
   sendGameSession(state, 4431, originalPb.encode('army.HeroTalentMsg', {
     userId: state.gatewayId,
     talentPoint: Number(saved.talentPoint || 0),
     talentGrade: Number(saved.talentGrade || 0),
     talentSkill: String(saved.talentSkill || ''),
     sealOrder: Array.isArray(saved.sealOrder) && saved.sealOrder.length > 0 ? saved.sealOrder : [1, 2, 3],
     currentBranch: 1002,
     isActiveSecond: false,
     talentIndex: 0
   }));
   sendGameSession(state, 4495, originalPb.encode('army.HeroRuneOpMsg', {
     userId: state.gatewayId,
     runeId: 0,
     runeKey: String(saved.army?.runeKey || ''),
     learnRunePos: 0,
     learnRuneCount: 0,
     opType: 0,
     opResult: true,
     runeInfo: {
       userId: state.gatewayId,
       runeKey: String(saved.army?.runeKey || ''),
       runeinfo: Array.isArray(saved.army?.runes) ? saved.army.runes.map(r => ({
         runeId: Number(r.runeId),
         runeGp: Number(r.runeGp || 0),
         swallowCount: Number(r.swallowCount || 0),
         runeHole: String(r.runeHole || '1'),
         tempHole: String(r.tempHole || ''),
         newSkillTempId: Number(r.newSkillTempId || 0),
         baseProperties: String(r.baseProperties || '')
       })) : []
     },
     count: 0
   }));

   // 1. Chefão Mundial - Envia estado ativo de abertura (Opcode 4182)
   sendGameSession(state, 4182, originalPb.encode('campaign.WorldBossStateMsg', {
     worldBossInfo: [
       { campaignId: 5001, state: 0 },
       { campaignId: 5002, state: 0 },
       { campaignId: 5003, state: 0 },
       { campaignId: 5004, state: 0 }
     ]
   }));

   // 2. Aventura de Navegação & Pesca - Envia frota de navios, portos e energia 100/100 (Opcode 342)
   sendGameSession(state, 342, originalPb.encode('navigation.NavigationMsg', navigationState.formatNavigationData(saved)));

   // 3. Especialização de Habilidades - Envia talentos avançados (Opcode 4434)
   sendGameSession(state, 4434, originalPb.encode('advancedtalent.AdvancedTalentInfoMsg', {
     talentPoint: Number(saved.advancedTalent?.talentPoint ?? 10),
     talentGrade: Number(saved.advancedTalent?.talentGrade ?? 10),
     talentSkill: String(saved.advancedTalent?.talentSkill || '')
   }));

   // 4. Avanço de Classe - Envia status de promoção de classe (Opcode 4974)
   sendGameSession(state, 4974, originalPb.encode('recover.TransferInfoRes', {
     type: Number(saved.numJobChange || 1)
   }));

   // 5. Sala de Jogos / Mini-jogos - Envia 3 tentativas para Sudoku e Combinar Peças (Opcode 814)
   sendGameSession(state, 814, originalPb.encode('gamebox.GameBoxInfoRes', {
     gameInfo: { '1': 3, '2': 3, '3': 3, '4': 3, '5': 3, '6': 3 }
   }));

   // 6. Astrologia / Mapa Estelar - Sincroniza info inicial (Opcode 275)
   sendGameSession(state, 275, originalPb.encode('stargazing.StargazingResponseMsg', {
     op: 0,
     dropItemIds: [],
     infoMsg: stargazingState.formatStargazingInfo(saved)
   }));

   log(`[INIT #${state.id}] Opcode 4151, 512, 274, 4556 (honor), 4431 (talent), 4495 (runas), 4182 (boss), 342 (nav), 4434 (adv talent), 4974 (transfer) e 814 (minigames) enviados.`);
 }catch(e){log(`[HEROI #${state.id}] Modelo incompleto:${e.message}`);}
 const list=initialMessages(state).filter(x=>INIT_FARM||x.code!==4157).slice(0,INIT_MESSAGE_LIMIT);
 list.forEach((entry,i)=>{
     if(state.closed||state.socket.destroyed)return;
     try{sendGameSession(state,entry.code,entry.data);
       stats.initMessages++;
       log(`[INIT #${state.id}] ${i+1}/${list.length}: ${entry.code}${entry.label}`);
     }catch(e){log(`[INIT #${state.id}] Falha em${entry.code}:`,e.message);}
 });
 state.initFinished=true;
 if(state.phase==='CHARACTER_LOADED')transition(state,'BASE_DATA_SENT','8224-init-responses');
 trySceneState(state,'fim-inicializacao');
}

function handleWorldRequest(state){
 if(!state.heroSent||!state.sceneStateSent||state.closed)return;
 state.worldRequested=true;
 sendGameSession(state,169,originalPb.encode('army.ArmyUpdatedGridMsg',{updatedArmy:[heroState.armyInfo(state.character)]}));
 if(!state.systemsSent){
  const charGrade = state.character?.grade || 1;
  const saved=inventoryState.parseState(state.character.state_json);
  const gradeSystems = getSystemsOpenForGrade(charGrade);
  let systems = Array.from(new Set([...(saved.systemsOpen || []), ...gradeSystems])).sort((a,b)=>a-b);
  if (charGrade < 18) {
    systems = systems.filter(id => id !== 109);
  }
  sendGameSession(state,537,originalPb.encode('systemopen.SystemOpenHashOpenList',{sysId:systems}));
  state.systemsSent=true;
  log(`[MUNDO #${state.id}] Sincronizado pacote 537 systemsOpen: [${systems.join(', ')}]`);
 }
 const savedWorldState=inventoryState.parseState(state.character.state_json);
 const activeQuests=questState.getActiveQuestProtocolList(savedWorldState);
 if(activeQuests.length > 0){
   sendGameSession(state, 112, originalPb.encode('quest.QuestUpdatedRspMsg', questState.formatQuestUpdatedProtocol(state.character.state_json, activeQuests)));
   log(`[MUNDO #${state.id}] Sincronizada(s)${activeQuests.length} missao(oes) ativa(s) pelo pacote 112.`);
 }
 if(state.phase==='SCENE_SENT')transition(state,'WORLD_SYNCED','client-5004-or-5181');
 if(!state.inventorySnapshotSent)state.inventorySnapshotSent=sendInventorySnapshot(state);
}

async function handleCastleBuildingInit(state){
 if(!state.gatewayId||state.closed)return;
 try{
   const charGrade = state.character?.grade || 1;
   const result=await db.mutateCharacterState(state.gatewayId,saved=>{
     castleState.ensureCastleState(saved, charGrade);
     campaignState.ensureCampaignState(saved, charGrade);
     questState.syncAutoQuests(saved, charGrade);
     const gradeSystems = getSystemsOpenForGrade(charGrade);
     let systems = Array.from(new Set([...(saved.systemsOpen || []), ...gradeSystems])).sort((a,b)=>a-b);
     if (charGrade < 18) {
       systems = systems.filter(id => id !== 109);
     }
     saved.systemsOpen = systems;
     astralState.ensureAstralState(saved);
     return {state:saved};
   });
   state.character.state_json=result.state;
   const saved=inventoryState.parseState(result.state);
   sendGameSession(state,4130,originalPb.encode('building.BuildingInfoListMsg',castleState.formatBuildingListMsg(saved,state.gatewayId, charGrade)));
   sendGameSession(state,109,originalPb.encode('castle.CastleYieldMsg',castleState.formatCastleYieldMsg(saved)));
   sendVipInfo(state);
   sendGameSession(state,4187,originalPb.encode('building.BuildOrderList',castleState.formatBuildOrderListMsg(saved,state.gatewayId)));
   const rankMsg = buildCampaignRankList(saved, state.gatewayId, 1001);
   sendGameSession(state, 4151, originalPb.encode('campaign.RankListRspMsg', rankMsg));
   if(Array.isArray(saved.systemsOpen) && saved.systemsOpen.length > 0 && !state.systemsSent){
    sendGameSession(state,537,originalPb.encode('systemopen.SystemOpenHashOpenList',{sysId:saved.systemsOpen}));
    state.systemsSent=true;
    log(`[CASTLE #${state.id}] Sincronizado pacote 537 systemsOpen: [${saved.systemsOpen.join(', ')}]`);
   }
   const starMoves = astralState.formatAllAstralsMoveMsg(saved, state.gatewayId);
   if (starMoves.move.length > 0) {
     sendGameSession(state, 4178, originalPb.encode('star.StarMoveRspMsg', starMoves));
   }
   sendGameSession(state, 4180, originalPb.encode('star.StarRandRspMsg', astralState.formatStarRandRspMsg(
     saved.astrals?.spheres || [1, 0, 0, 0, 0],
     saved.astrals?.temp || [],
     state.gatewayId
   )));
   secondarySystemsState.ensureSecondarySystemsState(saved);
   sendGameSession(state, 4540, originalPb.encode('pet.PlayerPetMsg', secondarySystemsState.formatPlayerPetMsg(saved, state.gatewayId, 0)));
   sendGameSession(state, 4873, originalPb.encode('combatguardian.CombatGuardianOpRes', secondarySystemsState.formatCombatGuardianOpRes(saved)));
   sendGameSession(state, 4631, originalPb.encode('watch.HeroWatchMsg', secondarySystemsState.formatHeroWatchMsg(saved)));
   sendGameSession(state, 4964, originalPb.encode('remotepet.RemotePetMsg', secondarySystemsState.formatRemotePetMsg(saved, state.gatewayId)));
   sendGameSession(state, 4484, originalPb.encode('player.AppellsMsg', secondaryFeatures.formatAppellsMsg(saved)));
   sendGameSession(state, 4980, originalPb.encode('army.RuneHoleAllInfoMsg', secondaryFeatures.formatRuneHoleAllInfoMsg(saved)));
   sendGameSession(state, 555, originalPb.encode('dragonsoul.DragonSoulOpRes', secondaryFeatures.formatDragonSoulOpRes(saved)));
   sendGameSession(state, 4190, originalPb.encode('dailytarget.DailyTargetList', secondaryFeatures.formatDailyTargetList(saved)));
   if(state.character && !state.heroArmySent){
    sendGameSession(state,169,originalPb.encode('army.ArmyUpdatedGridMsg',{updatedArmy:[heroState.armyInfo(state.character)]}));
    state.heroArmySent=true;
   }
   state.heroSent=true;
   state.sceneStateSent=true;
   state.worldRequested=true;
   if(!state.inventorySnapshotSent){
    state.inventorySnapshotSent=sendInventorySnapshot(state);
    log(`[CASTLE #${state.id}] Sincronizado pacote 115 inventario persistido:${state.inventorySnapshotSent}`);
   }
   const activeQuests=questState.getActiveQuestProtocolList(saved);
   if(activeQuests.length > 0){
    sendGameSession(state,112,originalPb.encode('quest.QuestUpdatedRspMsg', questState.formatQuestUpdatedProtocol(state.character.state_json, activeQuests)));
    log(`[CASTLE #${state.id}] Sincronizada(s)${activeQuests.length} missao(oes) ativa(s) pelo pacote 112.`);
   }
   barracksState.ensureArmyPawns(saved);
   const pawnsProto=barracksState.formatArmyPawnUpdatedMsg(saved,state.gatewayId);
   if(pawnsProto.armyPawn.length > 0){
    sendGameSession(state,100,originalPb.encode('army.ArmyPawnUpdatedMsg',pawnsProto));
    log(`[CASTLE #${state.id}] Sincronizadas${pawnsProto.armyPawn.length} tropas no pacote 100.`);
   }
   if(!state.smithSent){
    try {
      const compPath = path.resolve(__dirname, '../res/release/config/t_s_compose-9b5ac04f09.json');
      if (fs.existsSync(compPath)) {
        const comp = JSON.parse(fs.readFileSync(compPath, 'utf8')).t_s_compose || [];
        const allComposeIds = comp.filter(c => Number(c.Id) < 2000 && Number(c.NewMaterial) > 100).map(c => Number(c.Id)).filter(Boolean);
        sendGameSession(state, 4184, originalPb.encode('item.ItemSmithyMsg', { composeId: allComposeIds }));
        state.smithSent = true;
        log(`[CASTLE #${state.id}] Sincronizado pacote 4184 com${allComposeIds.length} receitas validas de sintese.`);
      }
    } catch (e) {
      log(`[CASTLE #${state.id}] Falha ao enviar receitas:${e.message}`);
    }
   }
   recorder.recordServerOutcome({
     category: 'castle',
     handler: 'handleCastleBuildingInit',
     validations: 'passed',
     buildingsCount: Object.keys(saved.castle?.buildings || {}).length,
     responseOpcode: 4130,
     finalState: 'SAVED_DB'
   });
   log(`[CASTLE #${state.id}] Edifícios e rendimentos do castelo sincronizados com sucesso.`);
 }catch(err){
   log(`[CASTLE #${state.id}] Falha ao processar 8281:${err.message}`);
 }
}
async function handleMovement(state,body){
 if(!state.gatewayId||!state.heroSent||!state.worldRequested)return;
 let req;try{
  req=originalPb.decode('worldmap.PosMoveMsg',body);
  const result=await db.mutateCharacterState(state.gatewayId,(raw,locked)=>{
   if(Number(req.mapId)===cityState.WILD){
     const gate=cityState.wildGate(Number(locked.grade),raw);
     if(!gate.allowed)throw Error(gate.reason);
   }
   const character={...state.character,state_json:raw};const pos=movementState.validate(req,character);
   raw.position=pos;return {state:raw,position:pos};
  });
  state.character.state_json=result.state;
  sendGameSession(state,4241,originalPb.encode('army.ArmyPositionMsg',{mapId:req.mapId,posX:result.position.x,posY:result.position.y}));
  movementEvents.push({time:new Date().toISOString(),characterId:state.gatewayId,accepted:true,routes:req.routes.length,position:result.position});
 }catch(e){movementEvents.push({time:new Date().toISOString(),characterId:state.gatewayId,accepted:false,error:e.message,
    request:req?{mapId:req.mapId,armyId:req.armyId,routes:req.routes?.map(p=>({x:p.x,y:p.y})).slice(0,8)}:null});
    const saved=inventoryState.parseState(state.character.state_json);if(saved.position&&saved.hero)
      sendGameSession(state,4241,originalPb.encode('army.ArmyPositionMsg',{mapId:saved.position.mapId,posX:saved.position.x,posY:saved.position.y}));
 }
 if(movementEvents.length>40)movementEvents.shift();
}

async function handleTutorialTraining(state, body) {
  if (!state.gatewayId || !state.heroSent || !state.sceneStateSent || state.closed) return;
  const request = originalPb.decode('novice.NoviceReqMsgMsg', body);
  const result = await db.mutateCharacterState(state.gatewayId, saved => {
    const updated = tutorialState.enter(saved, request);
    return { state: updated };
  });
  state.character.state_json = result.state;
  state.tutorialEntered = true;
  for (const packet of tutorialState.entryPackets(state.character, result.state)) {
    sendGameSession(state, packet.code, packet.payload);
  }
  log(`[TUTORIAL #${state.id}] Entrada no mapa${result.state.tutorial.mapId}; pacotes 125, 21, 127 enviados.`);
}

async function handleNoviceProcess(state, body) {
  if (!state.gatewayId || !state.heroSent || state.closed) return;
  const request = originalPb.decode('novice.NoviceReqMsgMsg', body);
  const step = Number(request.newNoviceProcess);
  const result = await db.mutateCharacterState(state.gatewayId, saved => {
    const ack = tutorialState.acknowledge(saved, step);
    return { state: ack.state, ack };
  });
  state.character.state_json = result.state;
  if (step === 150) {
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    sendGameSession(state, 6, buildLoginStateBody(state.gatewayId, 2));
    sendGameSession(state, 537, originalPb.encode('systemopen.SystemOpenHashOpenList', { sysId: result.state.systemsOpen || [] }));
    state.systemsSent = true;
    state.worldRequested = true;
    sendInventorySnapshot(state);
    log(`[TUTORIAL #${state.id}] Tutorial concluido (etapa 150); nivel preservado e sistemas persistidos sincronizados.`);
  } else {
    log(`[TUTORIAL #${state.id}] Etapa${step} gravada.`);
  }
}

async function enterCampaignById(state, campId, options = {}) {
  if (!state.gatewayId || !state.heroSent || state.closed) return;
  const result = await db.mutateCharacterState(state.gatewayId, saved => {
    const enterRes = campaignState.enterCampaign(state.character, saved, campId, options);
    return { state: enterRes.state, enterRes };
  });
  state.character.state_json = result.state;
  const enterRes = result.enterRes;
  if (enterRes && enterRes.packets) {
    for (const p of enterRes.packets) sendGameSession(state, p.code, p.payload);
  }
  recorder.recordServerOutcome({
    category: 'campaign',
    handler: 'handleCampaignEnter',
    validations: 'passed',
    persistentChanges: { campaignId: enterRes.campaign?.CampaignId, mapId: enterRes.mapId },
    responseOpcode: 125,
    finalState: 'SAVED_DB'
  });
  log(`[CAMPAIGN #${state.id}] Entrada na campanha${enterRes.campaign?.CampaignId} (${enterRes.campaign?.CampaignName_pt || 'Campanha'}); Mapa ${enterRes.mapId}; pacotes 125, 21, 127, 6 enviados.`);
}

// Entrada direta de campanha OU clique em "Comecar" dentro de uma sala MPD.
// O pacote C2S 5039 observado no cliente pode ter corpo VAZIO: nesse caso o
// servidor deve usar a campanha previamente escolhida na sala autenticada.
async function handleCampaignEnter(state, body) {
  if (!state.gatewayId || !state.heroSent || state.closed) return;
  let requestedId = 0;
  if (body && body.length) {
    const request = originalPb.decode('campaign.CampaignReqMsg', body);
    requestedId = Number(request.paraInt2 || request.paraInt1 || 0);
    if (requestedId !== 0 && (!Number.isSafeInteger(requestedId) || requestedId < 1)) {
      throw Error('ID de campanha informado e invalido');
    }
  }

  const characterId = Number(state.gatewayId);
  const roomId = mpdRooms.memberRooms.get(characterId);
  const room = roomId ? mpdRooms.get(roomId) : null;
  if (room && requestedId && requestedId !== room.campaignId && requestedId !== room.roomId) {
    const charSaved=inventoryState.parseState(state.character.state_json||{});
    const insideMpd=Number(charSaved.campaigns?.current?.campaignId)===Number(room.campaignId);
    if(room.members.size<=1 && !insideMpd){
      mpdRooms.leave(room.roomId,characterId);
      state.mpdEnteredRoomId=null;
      log(`[MPD STALE #${state.id}] Vinculo obsoleto ${room.roomId} descartado; nova campanha=${requestedId}`);
      if (requestedId === 20000) {
        const arrival=sylphAtoll.resolveArrival(campaignState.nodeById);
        const joined=await db.mutateCharacterState(state.gatewayId,(saved,locked) => {
          const res=sylphAtoll.enter(saved,Number(locked.grade),arrival);
          return {state:ensureSylphAtollCampaignState(res.state,arrival.mapId,res.position),
            position:res.position};
        });
        state.character=await db.characterById(state.gatewayId);
        sendSylphAtollScene(state,state.character,joined.position);
        return;
      }
      await enterCampaignById(state,requestedId);
      return;
    }
  }
  if (room) {
    if (!room.members.has(characterId)) throw Error('Personagem nao participa desta sala MPD');
    if (room.state === 'finished') throw Error('Sala MPD encerrada');
    if (room.pendingCampaignSelection) {
      throw Error(`Sala ${room.roomId} ainda aguarda selecao da masmorra pelo opcode 5034; nenhuma campanha sera escolhida no escuro`);
    }
    // O servidor ainda nao sincroniza combate, posição e recompensas de varios
    // personagens dentro da mesma instancia. Nao criar grupos falsos.
    if (room.members.size > 1) throw Error('Masmorra em grupo requer sincronizacao cooperativa ainda nao implementada');
    // A escolha armazenada na sala tem prioridade. Rejeita um ID divergente,
    // em vez de transportar o jogador para outra campanha por acidente.
    if (requestedId && requestedId !== room.campaignId && requestedId !== room.roomId) {
      throw Error('Campanha enviada nao corresponde a sala MPD ativa');
    }
    if (state.mpdEnteredRoomId === room.roomId && room.state === 'running') {
      log(`[MPD #${state.id}] Clique repetido em Comecar ignorado na sala ${room.roomId}.`);
      return;
    }
    const startedNow = room.state === 'forming';
    if (startedNow) mpdRooms.start(room.roomId, characterId);
    try {
      await enterCampaignById(state, room.campaignId, { mpdRoom: {
        roomId: room.roomId, capacity: room.capacity,
        masterId: room.masterId, roomType: room.roomType
      }});
      state.mpdEnteredRoomId = room.roomId;
      log(`[MPD #${state.id}] Sala ${room.roomId} iniciada: campanha ${room.campaignId}, pacote de entrada com ${body?.length || 0} bytes. backend=${__filename} build=${BUILD_ID}`);
    } catch (err) {
      // O estado da sala nao pode ficar travado em running quando a entrada
      // falha na validação do personagem ou na persistencia MySQL.
      if (startedNow && room.state === 'running') room.state = 'forming';
      throw err;
    }
    return;
  }

  if (!requestedId) throw Error('ID de campanha ausente e personagem sem sala MPD ativa');
  await enterCampaignById(state, requestedId);
}

async function handleCampaignSweep(state, body) {
  if (!state.gatewayId || !state.heroSent || state.closed) return;
  const request = originalPb.decode('campaign.CampaignSweepReq', body);
  const campId = Number(request.campaignId) || 1001;
  const count = Number(request.count || 1);
  if (!Number.isSafeInteger(count) || count < 1 || count > 50) throw Error('Quantidade de varreduras invalida');
  const opType = Number(request.opType) || 1;
  const sweepType = Number(request.sweepType) || 1;

  log(`[CAMPAIGN SWEEP #${state.id}] Requisicao recebida: campId=${campId}, opType=${opType}, count=${count}, sweepType=${sweepType}`);

  if (opType === 4) {
    const rsp = {
      result: [],
      status: 11,
      sweepType: sweepType,
      totalGp: 0,
      dropItems: [],
      campaignId: campId
    };
    sendGameSession(state, 4425, originalPb.encode('campaign.CampaignSweepRsp', rsp));
    return;
  }

  if (sweepType === 2) {
    const towerCampId = campId === 1001 ? 8001 : campId;
    const towerIndex = Number(Object.keys(TOWERS).find(k => TOWERS[k] === towerCampId)) || 1;
    const targetFloor = Math.min(100, Math.max(1, Number(request.eIndex) || 10));
    const isDouble = Number(request.enterType) === 2 || Number(request.isDouble) === 2;
    const multiplier = isDouble ? 2 : 1;

    let consumedKey = null;
    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
      const info = towerInfo(saved, towerIndex);
      if (isDouble) {
        const bag = inventoryState.inventory(saved);
        const key = bag.items.find(i => Number(i.templateId) === 208008 && Number(i.count) > 0);
        if (!key) throw Error('Chave de varredura dupla insuficiente');
        if (key) {
          key.count -= 1;
          consumedKey = { pos: key.pos, item: key.count > 0 ? structuredClone(key) : null };
          if (!key.count) bag.items.splice(bag.items.indexOf(key), 1);
        }
      }

      const startFloor = info.towerIndex || 1;
      const sweptFloors = Math.max(1, targetFloor - startFloor + 1);
      const earnedXp = sweptFloors * 3000 * multiplier;
      const earnedGold = sweptFloors * 1200 * multiplier;
      const cryptTokens = Math.max(5, Math.floor(sweptFloors / 5) * 10 * multiplier);
      const enchantStones = Math.max(2, Math.floor(sweptFloors / 5) * 2 * multiplier);

      if (!saved.wallet) saved.wallet = { gold: 0, balens: 0, boundBalens: 0 };
      saved.wallet.gold = (saved.wallet.gold || 0) + earnedGold;

      if (!saved.progression) saved.progression = { currentXp: 0, totalXp: 0 };
      saved.progression.totalXp = (saved.progression.totalXp || 0) + earnedXp;
      const newGrade = resourceState.calcGradeFromXp(saved.progression.totalXp, locked.grade || state.character.grade);
      const atLevel = resourceState.totalAtLevel(newGrade);
      saved.progression.currentXp = Math.max(0, saved.progression.totalXp - atLevel);

      inventoryState.addItem(saved, 208009, cryptTokens);
      inventoryState.addItem(saved, 208005, enchantStones);

      saved.towers = saved.towers || {};
      saved.towers[towerCampId] = {
        ...(saved.towers[towerCampId] || {}),
        day: new Date().toISOString().slice(0, 10),
        enterCount: 1,
        floor: targetFloor,
        maxIndex: Math.max(targetFloor, info.maxIndex),
        totalGp: (Number(saved.towers[towerCampId]?.totalGp) || 0) + earnedXp,
        totalGold: (Number(saved.towers[towerCampId]?.totalGold) || 0) + earnedGold
      };

      return {
        state: saved,
        resources: {
          gold: saved.wallet.gold,
          grade: newGrade,
          experience: saved.progression.totalXp
        },
        earnedXp,
        earnedGold,
        cryptTokens,
        enchantStones,
        targetFloor,
        sweptFloors,
        consumedKey
      };
    });

    state.character = await db.characterById(state.gatewayId);
    if (result.consumedKey) {
      sendGameSession(state, 115, makeBagMoveUpdate([{
        bagType: 1, objectId: 0, ownerId: state.gatewayId,
        pos: result.consumedKey.pos, item: result.consumedKey.item
      }]));
    }

    const dropList = [
      { templateId: 208009, count: result.cryptTokens },
      { templateId: 208005, count: result.enchantStones }
    ];
    const sweepResults = Array.from({ length: result.sweptFloors }, (_, idx) => ({
      type: 1,
      gold: 1200 * multiplier,
      gp: 3000 * multiplier,
      cIndex: (result.targetFloor - result.sweptFloors + 1) + idx,
      eIndex: result.targetFloor,
      items: [
        { templateId: 208009, count: Math.ceil(result.cryptTokens / result.sweptFloors) }
      ]
    }));

    const rsp = {
      result: sweepResults,
      status: 10,
      sweepType: 2,
      totalGp: result.earnedXp,
      dropItems: dropList,
      campaignId: towerCampId
    };
    sendGameSession(state, 4425, originalPb.encode('campaign.CampaignSweepRsp', rsp));
    sendGameSession(state, 4205, originalPb.encode('campaign.TowerInfoMsg', towerInfo(result.state, towerIndex)));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    sendInventorySnapshot(state);
    log(`[MAZE SWEEP #${state.id}] Varredura concluida: ${result.sweptFloors} andares varridos ate o piso${result.targetFloor}.`);
    return;
  }

  if ((opType === 3 || opType === 2) && state.lastSweep && state.lastSweep.campId === campId) {
    const cached = state.lastSweep;
    const rsp = {
      result: cached.sweepResults,
      status: 10,
      sweepType: sweepType,
      totalGp: cached.totalGpEarned,
      dropItems: cached.dropItemsList,
      campaignId: campId
    };
    sendGameSession(state, 4425, originalPb.encode('campaign.CampaignSweepRsp', rsp));
    return;
  }

  const camp = campaignState.campaignById.get(campId);
  if (!camp) throw Error(`Campanha ${campId} inexistente`);
  const baseGp = Number(camp.BaseGp) || 700;
  const gpPerRun = baseGp + 300;
  const goldPerRun = 1200;
  const totalGpEarned = gpPerRun * count;
  const totalGoldEarned = goldPerRun * count;

  const dropItemsList = [];
  if (camp && Array.isArray(camp.Item) && camp.Item.length > 0) {
    for (const itemId of camp.Item) {
      if (itemId > 0) {
        dropItemsList.push({ templateId: itemId, count: 1 * count });
      }
    }
  }
  if (dropItemsList.length === 0) {
    dropItemsList.push({ templateId: 208005, count: 1 * count });
  }

  const wearyCost = 20 * count;
  const openSilverBox = Boolean(request.openSilverBox);
  const openSecretBox = Boolean(request.openSecretBox);
  let questUpdates = [];
  let newGrade = state.character.grade;

  const result = await db.mutateCharacterState(state.gatewayId, saved => {
    if (!Array.isArray(saved.campaigns?.completed) || !saved.campaigns.completed.map(Number).includes(campId)) {
      throw Error('Blitz requer campanha previamente concluida');
    }
    energyRules.spendEnergy(saved, wearyCost);

    if (openSilverBox) {
      const silverCost = 5000 * count;
      if ((saved.wallet?.gold || 0) >= silverCost) {
        if (!saved.wallet) saved.wallet = { gold: 0, balens: 0, boundBalens: 0 };
        saved.wallet.gold -= silverCost;
        dropItemsList.push({ templateId: 208014, count: 2 * count });
      }
    }

    if (openSecretBox) {
      const neededKeys = 1 * count;
      const bag = inventoryState.inventory(saved);
      const keyItems = bag.items.filter(i => Number(i.templateId) === 208005 && Number(i.count) > 0);
      const totalKeys = keyItems.reduce((acc, i) => acc + Number(i.count || 0), 0);
      if (totalKeys >= neededKeys) {
        try {
          inventoryState.removeItem(saved, 208005, neededKeys);
          dropItemsList.push({ templateId: 208014, count: 2 * count });
        } catch (_) {}
      }
    }

    if (!saved.progression) saved.progression = { currentXp: 0, totalXp: 0 };
    saved.progression.totalXp = (saved.progression.totalXp || 0) + totalGpEarned;
    newGrade = resourceState.calcGradeFromXp(saved.progression.totalXp, state.character.grade);
    const atLevel = resourceState.totalAtLevel(newGrade);
    saved.progression.currentXp = Math.max(0, saved.progression.totalXp - atLevel);

    if (!saved.wallet) saved.wallet = { gold: 0, balens: 0, boundBalens: 0 };
    saved.wallet.gold = (saved.wallet.gold || 0) + totalGoldEarned;

    for (const item of dropItemsList) {
      try {
        inventoryState.addItem(saved, item.templateId, item.count);
      } catch (err) {
        log(`[CAMPAIGN SWEEP #${state.id}] Erro ao adicionar item ${item.templateId}:${err.message}`);
      }
    }

    const campSt = campaignState.ensureCampaignState(saved, newGrade);
    campaignState.unlockNextCampaigns(campSt, campId);
    if (!campSt.campaigns.wonNodes[campId]) {
      campSt.campaigns.wonNodes[campId] = [];
    }

    const allCampNodes = campaignState.getAllNodesForCampaign(campId);
    const combatNodes = allCampNodes.filter(n => [41, 42].includes(Number(n.MasterType)));
    for (const cn of combatNodes) {
      const cnId = Number(cn.Id);
      if (!campSt.campaigns.wonNodes[campId].includes(cnId)) {
        campSt.campaigns.wonNodes[campId].push(cnId);
      }
      const soldierIds = String(cn.Soldiers || '').split('|').map(s => Number(s.split(',')[0])).filter(Boolean);
      const heroIds = String(cn.Heros || '').split('|').map(s => Number(s.split(',')[0])).filter(Boolean);
      const defeatedMonsterIds = [...soldierIds, ...heroIds];
      for (let r = 0; r < count; r++) {
        const qRes = questState.onCombatVictory(saved, cnId, newGrade, {
          defeatedMonsterIds,
          mapId: Number(cn.CampaignId),
          campaignId: campId
        });
        if (qRes.changed && qRes.updatedQuests) questUpdates.push(...qRes.updatedQuests);
      }
    }

    for (let r = 0; r < count; r++) {
      const campQRes = questState.onCampaignVictory(saved, campId, newGrade);
      if (campQRes.changed && campQRes.updatedQuests) questUpdates.push(...campQRes.updatedQuests);
    }

    const resources = {
      gold: saved.wallet.gold,
      grade: newGrade,
      experience: saved.progression.totalXp
    };

    return { state: saved, resources, newGrade, totalXp: saved.progression.totalXp, wallet: saved.wallet };
  });

  state.character = await db.characterById(state.gatewayId);

  const sweepResults = [];
  for (let i = 1; i <= count; i++) {
    sweepResults.push({
      type: 1,
      gold: goldPerRun,
      gp: gpPerRun,
      campaignId: campId,
      time: 0,
      items: dropItemsList.map(it => ({ templateId: it.templateId, count: Math.ceil(it.count / count) })),
      cIndex: i,
      finishCount: i,
      count: count,
      level: newGrade
    });
  }

  state.lastSweep = { sweepResults, dropItemsList, totalGpEarned, totalGoldEarned, campId };

  const rsp = {
    result: sweepResults,
    status: 10,
    sweepType: sweepType,
    totalGp: totalGpEarned,
    dropItems: dropItemsList,
    campaignId: campId
  };

  sendGameSession(state, 4425, originalPb.encode('campaign.CampaignSweepRsp', rsp));
  sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

  try {
    const heroInfoMsg = heroState.heroInfo(state.character, result.state);
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroInfoMsg));
  } catch (_) {}

  sendInventorySnapshot(state);

  const activeQuests = questState.getActiveQuestProtocolList(result.state);
  if (questUpdates.length > 0 || activeQuests.length > 0) {
    sendGameSession(state, 112, originalPb.encode('quest.QuestUpdatedRspMsg',
      questState.formatQuestUpdatedProtocol(result.state, activeQuests.length > 0 ? activeQuests : questUpdates)));
  }

  const rankMsg = buildCampaignRankList(result.state, state.gatewayId, campId);
  sendGameSession(state, 4151, originalPb.encode('campaign.RankListRspMsg', rankMsg));
}

const TOWERS = { 1: 8001, 2: 8101, 3: 8301 };
function towerInfo(saved, index) {
  const campaignId = TOWERS[index];
  const tower = saved.towers?.[campaignId] || {};
  const today = new Date().toISOString().slice(0, 10);
  const entered = tower.day === today ? Number(tower.enterCount) || 0 : 0;
  return {
    campaignId, index, towerIndex: Math.max(0, Number(tower.floor) || 0),
    maxIndex: Math.max(0, Number(tower.maxIndex) || 0), order: 0, totalGp: Math.max(0, Number(tower.totalGp) || 0),
    enterCount: entered, maxEnterCount: 1, freeEnterCount: Math.max(0, 1 - entered),
    itemTempIds: '', firstHitId: 0, firstHitName: '', passIndex: 0, pass: 0
  };
}

async function handleTowerInfo(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  const request = originalPb.decode('campaign.TowerInfoReqMsg', body);
  const saved = inventoryState.parseState(state.character.state_json);
  const rawIdx = Number(request.index);
  const index = (rawIdx >= 0 && rawIdx <= 2) ? (rawIdx + 1) : 1;
  const list = [1, 2, 3].map(value => towerInfo(saved, value));
  sendGameSession(state, 4373, originalPb.encode('campaign.TowerListMsg', { towerInfo: list }));
  if (TOWERS[index]) sendGameSession(state, 4205, originalPb.encode('campaign.TowerInfoMsg', list[index - 1]));
  log(`[TOWER #${state.id}] Info ${index} enviado; tentativas${TOWERS[index] ? list[index - 1].freeEnterCount : '-'} (4373/4205).`);
}

async function handleTowerReset(state, body) {
  if (!state.gatewayId || !state.heroSent || state.closed) return;
  const request = originalPb.decode('campaign.TowerInfoReqMsg', body);
  const rawIdx = Number(request.index);
  const index = (rawIdx >= 0 && rawIdx <= 2) ? (rawIdx + 1) : 1;
  const campaignId = TOWERS[index];
  if (!campaignId) return;

  const result = await db.mutateCharacterState(state.gatewayId, saved => {
    saved.towers = saved.towers || {};
    saved.towers[campaignId] = {
      ...(saved.towers[campaignId] || {}),
      floor: 1,
      rewardedNodes: [],
      openedChests: []
    };
    return { state: saved };
  });
  state.character.state_json = result.state;
  const list = [1, 2, 3].map(value => towerInfo(result.state, value));
  sendGameSession(state, 4373, originalPb.encode('campaign.TowerListMsg', { towerInfo: list }));
  sendGameSession(state, 4205, originalPb.encode('campaign.TowerInfoMsg', list[index - 1]));
  log(`[TOWER #${state.id}] Reset efetuado na torre${campaignId} (andar resetado para 1).`);
}

async function handleTowerLive(state, body) {
  if (!state.gatewayId || state.closed) return;
  log(`[TOWER LIVE #${state.id}] Ressurreicao requisitada.`);
  sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
}

async function handleTowerEnter(state, body) {
  if (!state.gatewayId || !state.heroSent || state.closed) return;
  const request = originalPb.decode('campaign.EnterTowerInfoMsg', body);
  const campaignId = Number(request.campaignId);
  const index = Number(Object.keys(TOWERS).find(key => TOWERS[key] === campaignId));
  const choice = Number(request.chooseIndex);
  const rewardMultiplier = Number(request.isDouble) === 2 ? 2 : 1;
  if (!index || ![0, 1].includes(choice)) throw Error('Piso de labirinto invalido');
  let previousTower;
  const result = await db.mutateCharacterState(state.gatewayId, saved => {
    const info = towerInfo(saved, index);
    let consumedKey = null;
    let actualMultiplier = 1;
    if (rewardMultiplier === 2) {
      const bag = inventoryState.inventory(saved);
      const key = bag.items.find(item => Number(item.templateId) === 208008 &&
        Number(item.bagType) === 1 && Number(item.count) > 0);
      if (key) {
        key.count -= 1;
        consumedKey = { pos: key.pos, item: key.count > 0 ? structuredClone(key) : null };
        if (!key.count) bag.items.splice(bag.items.indexOf(key), 1);
        actualMultiplier = 2;
      }
    }
    saved.towers = saved.towers || {};
    previousTower = saved.towers[campaignId] ? structuredClone(saved.towers[campaignId]) : null;
    saved.towers[campaignId] = { ...(saved.towers[campaignId] || {}), day: new Date().toISOString().slice(0, 10),
      enterCount: info.enterCount + (choice === 1 ? 1 : 0), floor: choice === 1 ? 1 : (info.towerIndex || 1),
      maxIndex: Math.max(1, info.maxIndex),
      totalGp: choice === 1 ? 0 : Number(saved.towers[campaignId]?.totalGp) || 0,
      totalGold: choice === 1 ? 0 : Number(saved.towers[campaignId]?.totalGold) || 0,
      rewardedNodes: choice === 1 ? [] : (saved.towers[campaignId]?.rewardedNodes || []),
      openedChests: choice === 1 ? [] : (saved.towers[campaignId]?.openedChests || []),
      rewardMultiplier: actualMultiplier };
    return { state: saved, consumedKey };
  });
  state.character.state_json = result.state;
  try {
    const mapId = choice === 0 ? campaignId + Number(result.state.towers[campaignId].floor) - 1 : campaignId;
    await enterCampaignById(state, mapId, { resumeTower: choice === 0 });
  } catch (error) {
    await db.mutateCharacterState(state.gatewayId, saved => {
      saved.towers = saved.towers || {};
      if (previousTower) saved.towers[campaignId] = previousTower;
      else delete saved.towers[campaignId];
      if (result.consumedKey) inventoryState.addItem(saved, 208008, 1);
      return { state: saved };
    });
    throw error;
  }
  if (result.consumedKey) {
    sendGameSession(state, 115, makeBagMoveUpdate([{
      bagType: 1, objectId: 0, ownerId: state.gatewayId,
      pos: result.consumedKey.pos, item: result.consumedKey.item
    }]));
  }
  sendGameSession(state, 4205, originalPb.encode('campaign.TowerInfoMsg', towerInfo(result.state, index)));
  log(`[TOWER #${state.id}]${choice === 0 ? 'Continuar' : 'Comecar'} ${campaignId}: piso${result.state.towers[campaignId].floor} enviado (125/21/127/6/4205).`);
}

async function handleCampaignArrive(state, body) {
  if (!state.gatewayId || !state.heroSent || state.closed) return;
  const request = originalPb.decode('campaign.CampaignReqMsg', body);
  const nodeId = Number(request.paraInt1);

  const isTutorial = (nodeId >= 1000100 && nodeId <= 1000299) || nodeId === 1000108;
  if (isTutorial) {
    const tutorialCombatNodes = [1000103, 1000104, 1000106, 1000203, 1000205];
    if (tutorialCombatNodes.includes(nodeId)) {
      const saved = typeof state.character.state_json === 'string' ? JSON.parse(state.character.state_json) : (state.character.state_json || {});
      const isReplay = (state.character.grade >= 5);
      const won = !isReplay && (saved.tutorial && saved.tutorial.wonNodes && saved.tutorial.wonNodes.includes(nodeId));
      if (won) {
        log(`[TUTORIAL #${state.id}] No de combate ${nodeId} ja derrotado anteriormente.`);
        sendGameSession(state, 128, originalPb.encode('campaign.CampaignNodeSuccMsg', {
          nodeId: nodeId,
          isMonster: false
        }));
        return;
      }
      log(`[TUTORIAL #${state.id}] Monstro ${nodeId} alcancado! Iniciando combate autoritativo...`);
      sendGameSession(state, 128, originalPb.encode('campaign.CampaignNodeSuccMsg', {
        nodeId: nodeId,
        isMonster: true
      }));
      battleEngine.initiateBattle(state, nodeId);
      return;
    }

    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      if (nodeId === 1000108) {
        const res = tutorialState.transferMap(state.character, saved, 10001, 1000108, 2);
        return { state: res.state, arr: { isTransfer: true, packets: res.packets } };
      }
      const arr = tutorialState.arrive(saved, nodeId, state.character.grade);
      if (arr.isTransfer) {
        const res = tutorialState.transferMap(state.character, saved, 10001, 1000108, 2);
        return { state: res.state, arr: { isTransfer: true, packets: res.packets } };
      }
      const resources = (arr.totalXp !== undefined) ? { gold: arr.gold || 0, grade: arr.newGrade || state.character.grade, experience: arr.totalXp } : undefined;
      return { state: arr.state, resources, arr };
    });
    state.character.state_json = result.state;
    const arr = result.arr;
    recorder.recordServerOutcome({
      category: 'campaign',
      handler: 'handleCampaignArrive',
      validations: 'passed',
      persistentChanges: { nodeId, isTransfer: arr?.isTransfer, newGrade: arr?.newGrade, totalXp: arr?.totalXp },
      responseOpcode: arr?.isTransfer ? 125 : (arr?.packets ? 128 : null),
      finalState: 'SAVED_DB'
    });
    if (arr && arr.isTransfer) {
      if (arr.packets) {
        for (const p of arr.packets) sendGameSession(state, p.code, p.payload);
      }
      log(`[TUTORIAL #${state.id}] Portal 1000108 acionado via arrive! Transferencia para Mapa 10002 concluida.`);
      return;
    }
    if (arr && arr.packets) {
      for (const p of arr.packets) sendGameSession(state, p.code, p.payload);
    }
    if (arr && arr.totalXp !== undefined) {
      const oldGrade = state.character.grade;
      state.character.grade = arr.newGrade || state.character.grade;
      sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
      if (state.character.grade !== oldGrade) {
        const updatedHeroLvl = heroState.heroInfo(state.character);
        sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHeroLvl));
      }
      try {
        const qRes = await db.mutateCharacterState(state.gatewayId, saved => {
          const res = questState.onCombatVictory(saved, nodeId, state.character.grade);
          return { state: res.state, updatedQuests: res.updatedQuests, changed: res.changed };
        });
        if (qRes.changed && qRes.updatedQuests && qRes.updatedQuests.length > 0) {
          state.character.state_json = qRes.state;
          sendGameSession(state, 112, originalPb.encode('quest.QuestUpdatedRspMsg', questState.formatQuestUpdatedProtocol(state.character.state_json, qRes.updatedQuests)));
        }
      } catch (qErr) {
        log(`[QUEST #${state.id}] Erro ao atualizar objetivos de missao:${qErr.message}`);
      }
    }
    return;
  }

  // Processamento de nó de campanha pós-tutorial
  const campaignNode = campaignState.nodeById.get(Number(nodeId));
  const mType = campaignNode ? Number(campaignNode.MasterType) : 0;
  const isMonsterNode = (mType === 41 || mType === 42 || atollEncounters.hostile(campaignNode) ||
    campaignNode?.AI === 'com.road.yishi.mapphysics.node.ai.CNKingTowerBossAi' ||
    (Number(campaignNode?.CampaignId) === 8200 && Number(nodeId) >= 820002 && Number(nodeId) <= 820006));
  if (isMonsterNode) {
    const saved = typeof state.character.state_json === 'string' ? JSON.parse(state.character.state_json) : (state.character.state_json || {});
    const current=saved.campaigns?.current;
    if(Number(current?.mapId)!==Number(campaignNode.CampaignId))throw Error('Monstro fora da instancia atual');
    const atollEnemy=atollEncounters.hostile(campaignNode);
    if(atollEnemy && !atollEncounters.canFight(saved,campaignNode)) {
      log(`[ATOL MONSTRO #${state.id}] No ${nodeId} recusado: mapa incorreto ou ainda aguardando ressurgimento.`);
      return;
    }
    const wonNodes=Array.isArray(current.runWonNodes)?current.runWonNodes:[];
    if (!atollEnemy && wonNodes.includes(nodeId)) {
      log(`[CAMPAIGN #${state.id}] Monstro ${nodeId} ja derrotado nesta campanha.`);
      sendGameSession(state, 128, originalPb.encode('campaign.CampaignNodeSuccMsg', { nodeId, isMonster: false }));
      return;
    }
    log(`[CAMPAIGN #${state.id}] Monstro ${nodeId} (${campaignNode.NodeName_pt || 'Monstro'}) alcancado! Iniciando combate autoritativo...`);
    sendGameSession(state, 128, originalPb.encode('campaign.CampaignNodeSuccMsg', { nodeId, isMonster: true }));
    battleEngine.initiateBattle(state, nodeId);
    return;
  }

  if(atollEncounters.capture(campaignNode)) {
    log(`[ATOL COLETA #${state.id}] No ${nodeId} e de captura/coleta, nao um combate comum; operacao mantida separada.`);
    return;
  }
  const result = await db.mutateCharacterState(state.gatewayId, saved => {
    let towerAdvance = null;
    const currentMapId = Number(saved.campaigns?.current?.mapId);
    const targetNode = campaignState.nodeById.get(Number(campaignNode?.MoveToNodeIds?.[0]));
    if (campaignState.towerFloor(currentMapId) && targetNode &&
        Number(campaignNode?.CampaignId) === currentMapId &&
        Number(targetNode.CampaignId) !== currentMapId) {
      towerAdvance = campaignState.advanceTowerFloor(saved, currentMapId, Number(targetNode.CampaignId));
    }
    const arr = campaignState.arriveNode(state.character, saved, nodeId);
    const resources = arr.totalXp !== undefined ? { gold: arr.state.wallet?.gold || 0, grade: arr.newGrade || state.character.grade, experience: arr.totalXp } : undefined;
    return { state: arr.state, arr, resources, towerAdvance };
  });
  state.character.state_json = result.state;
  const arr = result.arr;
  if (arr.packets) {
    for (const p of arr.packets) sendGameSession(state, p.code, p.payload);
  }
  if (result.towerAdvance) {
    const towerIndex = result.towerAdvance.campaignId === 8001 ? 1 : result.towerAdvance.campaignId === 8101 ? 2 : 3;
    sendGameSession(state, 4205, originalPb.encode('campaign.TowerInfoMsg', towerInfo(result.state, towerIndex)));
    log(`[TOWER #${state.id}] Andar ${result.towerAdvance.floor} persistido; 4205 enviado.`);
  }
  if (arr.xpAwarded > 0) {
    const oldGrade = state.character.grade;
    state.character.grade = arr.newGrade || state.character.grade;
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character, state.character.state_json)));

    // Atualiza missões ativas
    try {
      const qRes = await db.mutateCharacterState(state.gatewayId, saved => {
        let res = questState.onCombatVictory(saved, nodeId, state.character.grade);
        if (arr.isFinished || arr.isBoss) {
          const campRes = questState.onCampaignVictory(res.state, arr.campaignId || 1002, state.character.grade);
          res = {
            state: campRes.state,
            updatedQuests: [...(res.updatedQuests || []), ...(campRes.updatedQuests || [])],
            changed: res.changed || campRes.changed
          };
        }
        return { state: res.state, updatedQuests: res.updatedQuests, changed: res.changed };
      });
      if (qRes.changed && qRes.updatedQuests && qRes.updatedQuests.length > 0) {
        state.character.state_json = qRes.state;
        sendGameSession(state, 112, originalPb.encode('quest.QuestUpdatedRspMsg', questState.formatQuestUpdatedProtocol(state.character.state_json, qRes.updatedQuests)));
        recorder.recordServerOutcome({
          category: 'quest',
          handler: 'onCombatVictory',
          validations: 'passed',
          persistentChanges: { nodeId, updatedQuests: qRes.updatedQuests.map(q => ({ id: q.templateId, count: q.condition_1, complete: q.isComplete })) },
          responseOpcode: 112,
          finalState: 'SAVED_DB'
        });
        log(`[QUEST #${state.id}] Objetivo de missao atualizado apos vitoria no no ${nodeId}: ${qRes.updatedQuests.map(q=>`${q.templateId} (${q.condition_1}/1)`).join(', ')}.`);
      }
    } catch (qErr) {
      log(`[QUEST #${state.id}] Erro ao atualizar objetivos de missao: ${qErr.message}`);
    }

    if (state.character.grade !== oldGrade) {
      log(`[CAMPAIGN #${state.id}] Vitoria no no ${nodeId}; nivel subiu para ${state.character.grade} (XP: ${arr.totalXp})!`);
    } else {
      log(`[CAMPAIGN #${state.id}] Vitoria no no ${nodeId}; XP: +${arr.xpAwarded}, Ouro: +${arr.goldAwarded}.`);
    }
  } else if (arr.isChest) {
    if (arr.addedItems && arr.addedItems.length > 0) {
      const moved = arr.addedItems.map(item => ({
        bagType: 1,
        objectId: 0,
        ownerId: state.gatewayId,
        pos: item.pos,
        item
      }));
      sendGameSession(state, 115, makeBagMoveUpdate(moved), state.gatewayId);
      sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
      log(`[CAMPAIGN #${state.id}] Bau aberto no no ${nodeId}; Ouro: +${arr.goldAwarded}, itens adicionados: [${arr.addedItems.map(i=>i.templateId).join(', ')}].`);
    } else {
      sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
      log(`[CAMPAIGN #${state.id}] Bau aberto no no ${nodeId}; Ouro: +${arr.goldAwarded}.`);
    }
  }
  recorder.recordServerOutcome({
    category: 'campaign',
    handler: 'handleCampaignArrive',
    validations: 'passed',
    persistentChanges: { nodeId, isMonster: arr.isMonster, isBoss: arr.isBoss, isFinished: arr.isFinished },
    responseOpcode: arr.isFinished ? 134 : 128,
    finalState: 'SAVED_DB'
  });
}

async function handleCampaignCallback(state, body) {
  if (!state.gatewayId || !state.heroSent || state.closed) return;
  const request = originalPb.decode('campaign.CallBackReqMsg', body);
  const result = await db.mutateCharacterState(state.gatewayId, saved => {
    const res = tutorialState.transferMap(state.character, saved, request.mapId, request.nodeId, request.cmd);
    return { state: res.state, packets: res.packets };
  });
  state.character.state_json = result.state;
  if (result.packets) {
    for (const p of result.packets) sendGameSession(state, p.code, p.payload);
  }
  recorder.recordServerOutcome({
    category: 'campaign',
    handler: 'handleCampaignCallback',
    validations: 'passed',
    persistentChanges: { mapId: request.mapId, nodeId: request.nodeId, cmd: request.cmd, nextMapId: result.state.tutorial.mapId },
    responseOpcode: 125,
    finalState: 'SAVED_DB'
  });
  log(`[TUTORIAL #${state.id}] Transferencia de mapa para ${result.state.tutorial.mapId} concluida.`);
}

async function handleCampaignCard(state, body) {
  if (!state.gatewayId || !state.heroSent || state.closed) return;
  const request=originalPb.decode('campaign.CampaignReqMsg',body);
  const index=Number(request.paraInt2);
  const result=await db.mutateCharacterState(state.gatewayId,saved=>{
    const claim=campaignState.claimCampaignCard(saved,index);
    return {state:claim.state,claim};
  });
  state.character.state_json=result.state;
  const {card,item,duplicate}=result.claim;
  const awarded=item||inventoryState.inventory(result.state).items.find(entry=>entry.instanceId===card.claimedItem);
  sendGameSession(state,26,originalPb.encode('campaign.CampaignTakeCardsMsg',{
    playerId:state.gatewayId,name:state.character.nickname,pay:false,index:card.claimedIndex,
    templateId:awarded.templateId,count:awarded.count,bind:awarded.bind
  }));
  if(item)sendGameSession(state,115,makeBagMoveUpdate([{
    bagType:item.bagType,objectId:0,ownerId:state.gatewayId,pos:item.pos,item
  }]));
  log(`[CAMPAIGN #${state.id}] Carta ${index} da campanha ${card.campaignId} ${duplicate?'reconfirmada':'entregue e persistida'}; item ${awarded.templateId}.`);
  if(!duplicate)scheduleSession(state,()=>{
    const saved=inventoryState.parseState(state.character.state_json);
    if(Number(saved.campaigns?.current?.campaignId)===Number(card.campaignId)&&
       saved.campaigns.current.pendingCard?.claimedItem===card.claimedItem)
      state.work=state.work.then(()=>handleCampaignFinish(state,Buffer.alloc(0)))
        .catch(error=>log(`[CAMPAIGN #${state.id}] Saida apos carta falhou: ${error.message}`));
  },9500);
}

async function handleCampaignFinish(state, body) {
  if (!state.gatewayId || !state.heroSent || state.closed) return;
  const savedState = state.character.state_json ? inventoryState.parseState(state.character.state_json) : {};
  if(sylphAtoll.isAtollMap(savedState.position?.mapId) &&
     Number(savedState.campaigns?.current?.campaignId)===20000) {
    await exitSylphAtollToCloud(state);
    return;
  }
  const inRegularCampaign = Boolean(savedState.campaigns && savedState.campaigns.current && savedState.campaigns.current.campaignId >= 1000);
  const isTutorial = !inRegularCampaign && !(typeof savedState.newNoviceProcess === 'string' && savedState.newNoviceProcess.includes('150'));

  if (isTutorial) {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      const ack = tutorialState.acknowledge(saved, 150);
      const resources = undefined; // Completion never grants unearned levels or currency.
      return { state: ack.state, resources };
    });
    state.character.state_json = result.state;
    // Preserve earned character grade.
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    sendGameSession(state, 6, buildLoginStateBody(state.gatewayId, 2));
    sendGameSession(state, 537, originalPb.encode('systemopen.SystemOpenHashOpenList', { sysId: result.state.systemsOpen || [] }));
    state.systemsSent = true;
    state.worldRequested = true;
    sendInventorySnapshot(state);
    recorder.recordServerOutcome({
      category: 'campaign',
      handler: 'handleCampaignFinish',
      validations: 'passed',
      persistentChanges: { grade: state.character.grade, systems: result.state.systemsOpen || [] },
      responseOpcode: 537,
      finalState: 'SAVED_DB'
    });
    log(`[TUTORIAL #${state.id}] Campanha tutorial finalizada (134); nivel preservado.`);
    return;
  }

  if (!inRegularCampaign) return; // Late duplicate after automatic exit.

  // Conclusão / saída de campanha pós-tutorial
  const result = await db.mutateCharacterState(state.gatewayId, saved => {
    const fin = campaignState.finishCampaign(state.character, saved);
    return { state: fin.state, fin };
  });
  state.character.state_json = result.state;
  const fin = result.fin;
  if (fin.packets) {
    for (const p of fin.packets) sendGameSession(state, p.code, p.payload);
  }
  let cloud = null;
  if (state.character.grade >= 15 && (result.state.lastScene === 'cloud' || (result.state.position && result.state.position.mapId === 10000))) {
    cloud = cityState.validCloud(result.state.position)
      ? { ...result.state.position }
      : { ...cityState.cloudSpawn };
    scheduleSession(state, () => sendCloudScene(state, state.character, cloud), 800);
  } else {
    scheduleSession(state, () => {
      try {
        sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
        sendGameSession(state, 6, buildLoginStateBody(state.gatewayId, 2));
        sendGameSession(state, 537, originalPb.encode('systemopen.SystemOpenHashOpenList', { sysId: result.state.systemsOpen || [] }));
        state.systemsSent = true;
        state.worldRequested = true;
        sendInventorySnapshot(state);
        handleWorldRequest(state);
        handleCastleBuildingInit(state);
        log(`[CAMPAIGN #${state.id}] Retorno ao Castelo sincronizado (cena 2).`);
      } catch (err) {
        log(`[CAMPAIGN #${state.id}] Erro na restauracao do castelo: ${err.message}`);
      }
    }, 400);
  }

  const rankMsg = buildCampaignRankList(result.state, state.gatewayId, fin.completedCampaignId);
  sendGameSession(state, 4151, originalPb.encode('campaign.RankListRspMsg', rankMsg));
  log(`[CAMPAIGN #${state.id}] Opcode 4151 despachado com ${rankMsg.rankInfo.length} campanhas.`);
  recorder.recordServerOutcome({
    category: 'campaign',
    handler: 'handleCampaignFinish',
    validations: 'passed',
    persistentChanges: { completedCampaignId: fin.completedCampaignId, nextCampaignId: fin.nextCampaignId },
    responseOpcode: 6,
    finalState: 'SAVED_DB'
  });
  log(`[CAMPAIGN #${state.id}] Saida da campanha ${fin.completedCampaignId}; retorno a Cloud City ${cloud?'agendado':'indisponivel'}.`);
}


async function handleCampaignMovement(state, body) {
  if (!state.gatewayId || !state.heroSent || state.closed) return;
  let req;
  try {
    req = originalPb.decode('worldmap.PosMoveMsg', body);
    const mapId = Number(req.mapId || 0);
    const isTutorialMap = (mapId === 10001 || mapId === 10002) && (state.character.grade < 5);
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      if (isTutorialMap) {
        const moved=tutorialState.movement(saved,req);
        return {state:moved,position:moved.tutorial.position,mapId:moved.tutorial.mapId};
      }
      const moved=campaignMovementState.move(saved,req,{characterId:state.gatewayId});
      if (sylphAtoll.isAtollMap(moved.state.position?.mapId) &&
          Number(moved.state.campaigns?.current?.campaignId)===20000) {
        moved.state.position={...moved.state.position,
          mapId:moved.mapId,x:moved.position.x,y:moved.position.y};
      }
      return moved;
    });
    state.character.state_json = result.state;
    sendGameSession(state,4241,originalPb.encode('army.ArmyPositionMsg',
      {mapId:result.mapId,posX:result.position.x,posY:result.position.y}));

    // Verifica aggro de monstros vivos no mapa da campanha (Opcode 4105 U_C_NPC_CHASE_ARMY)
    if (result.mapId) {
      try {
        const currentSaved = inventoryState.parseState(state.character.state_json);
        const isReplay = (state.character.grade >= 5);
        const runWon = (!isReplay && isTutorialMap)
          ? (currentSaved.tutorial?.wonNodes || [])
          : (currentSaved.campaigns?.current?.runWonNodes || []);
        const mapNodes = campaignState.getNodesForMap(result.mapId);
        for (const n of mapNodes) {
          const isAtollHostile=atollEncounters.hostile(n);
          if (([41,42].includes(Number(n.MasterType))||isAtollHostile)&&!runWon.includes(Number(n.Id))) {
            if(isAtollHostile&&!atollEncounters.canFight(currentSaved,n))continue;
            const movedPos=isAtollHostile?state.atollPatrol?.positions?.get(Number(n.Id)):null;
            const nx=Number(movedPos?.x??n.Property1)||0,ny=Number(movedPos?.y??n.Property2)||0;
            const px=Number(result.position.x)||0,py=Number(result.position.y)||0;
            const dist=Math.hypot(nx-px,ny-py);
            if(dist<=8){
              const time=Date.now();
              if(isAtollHostile){
                state.atollAggroTimes ||= new Map();
                if(time-Number(state.atollAggroTimes.get(Number(n.Id))||0)<7000)continue;
                state.atollAggroTimes.set(Number(n.Id),time);
              }
              sendGameSession(state,4105,originalPb.encode('campaign.NPCChaseMsg',{
                nodeId:Number(n.Id),armyId:state.gatewayId,curPosX:nx,curPosY:ny,
                serverName:state.character?.site||''
              }));
              log(`[CAMPAIGN #${state.id}] ${isAtollHostile?'Silfo':'Mob'} ${n.Id} iniciou aggro (dist=${dist.toFixed(1)}). Opcode 4105 enviado.`);
              break;
            }
          }
        }
      } catch (aggroErr) {
        // Ignora erro de proximidade de mob
      }
    }
  } catch (e) {
    log(`[CAMPAIGN MOVE #${state.id}] Rota ignorada: ${e.message}`);
  }
}

async function handleNodeLockState(state, body) {
  if (!state.gatewayId || !state.heroSent || state.closed) return;
  try {
    const req = originalPb.decode('campaign.NodeLockReqMsg', body);
    log(`[CAMPAIGN LOCK #${state.id}] No ${req.nodeId} alerta/lock: ${req.lock}`);
  } catch (e) {
    log(`[CAMPAIGN LOCK #${state.id}] Decodificacao de lock: ${e.message}`);
  }
}

async function handleCampaignSystemArmy(state, body) {
  if (!state.gatewayId || state.closed) return;
  let mapId = 0;
  try {
    if (body && body.length) {
      const req = originalPb.decode('simple.SimplePropertyMsg', body);
      mapId = Number(req.paraInt1 || 0);
    }
  } catch(e) {
    try {
      const req2 = originalPb.decode('simple.PropertyMsg', body);
      mapId = Number(req2.param1 || 0);
    } catch(_) {}
  }
  if (!mapId) {
    const saved = inventoryState.parseState(state.character?.state_json || {});
    mapId = Number(saved.campaigns?.current?.mapId || 1001);
  }

  const nodes = campaignState.getNodesForMap(mapId) || [];
  const heroTemplated = [];
  const soldierTemplated = [];

  for (const n of nodes) {
    if (n.MonsterId) {
      const mId = Number(n.MonsterId);
      if (mId > 0 && !heroTemplated.includes(mId)) heroTemplated.push(mId);
    }
    if (n.PawnId) {
      const pId = Number(n.PawnId);
      if (pId > 0 && !soldierTemplated.includes(pId)) soldierTemplated.push(pId);
    }
  }

  if (heroTemplated.length === 0) heroTemplated.push(1001);
  if (soldierTemplated.length === 0) soldierTemplated.push(101);

  const payload = originalPb.encode('campaign.SystemArmyMsg', {
    heroTemplated,
    soldierTemplated
  });
  sendGameSession(state, 20, payload);
  sendGameSession(state, 5038, payload);
  log(`[CAMPAIGN ARMY #${state.id}] MapId ${mapId}: ${heroTemplated.length} monstros/herois, ${soldierTemplated.length} soldados (20/5038).`);
}

async function handleQuestAdd(state, body) {
  if (!state.gatewayId || !state.heroSent || state.closed) return;
  let req;
  try {
    req = originalPb.decode('quest.QuestAddedMsg', body);
  } catch (e) {
    req = { questId: [] };
  }
  const questIds = Array.isArray(req?.questId) ? req.questId : [];
  log(`[QUEST #${state.id}] Pedido de missao (5012): [${questIds.join(',')}]`);
  if (questIds.length === 0) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      let changedAny = false;
      for (const qId of questIds) {
        const res = questState.acceptQuest(saved, qId);
        if (res.changed) changedAny = true;
      }
      return { state: saved, changed: changedAny };
    });
    state.character.state_json = result.state;
    const activeQuests = questState.getActiveQuestProtocolList(result.state);
    if (activeQuests.length > 0) {
      sendGameSession(state, 112, originalPb.encode('quest.QuestUpdatedRspMsg', questState.formatQuestUpdatedProtocol(state.character.state_json, activeQuests)));
      recorder.recordServerOutcome({
        category: 'quest',
        handler: 'handleQuestAdd',
        validations: 'passed',
        persistentChanges: { activeQuests: activeQuests.map(q => q.templateId) },
        responseOpcode: 112,
        finalState: 'SAVED_DB'
      });
      log(`[QUEST #${state.id}] Missao(oes) [${activeQuests.map(q=>q.templateId).join(',')}] sincronizada(s) no banco e pacote 112 enviado.`);
    }
  } catch (err) {
    log(`[QUEST #${state.id}] Erro ao aceitar missao(oes): ${err.message}`);
  }
}

async function handleQuestFinish(state, body) {
  if (!state.gatewayId || !state.heroSent || state.closed) return;
  let req;
  try {
    req = originalPb.decode('quest.QuestFinishedReqMsg', body);
  } catch (e) {
    req = { templateId: 45 };
  }
  const templateId = Number(req?.templateId || 45);
  log(`[QUEST #${state.id}] Conclusao de missao ${templateId} requisitada (5014).`);
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      const res = questState.finishQuest(saved, templateId, state.character?.grade || 5, state.character?.job || saved.job || 1);
      const newGrade = res.rewards.newGrade || state.character.grade || 5;
      const resources = { gold: res.rewards.totalGold, experience: res.rewards.totalXp, grade: newGrade };
      return { state: res.state, rewards: res.rewards, resources, newGrade };
    });
    state.character.state_json = result.state;
    state.character.experience = result.rewards.totalXp;
    state.character.gold = result.rewards.totalGold;
    state.character.grade = result.newGrade;
    sendGameSession(state, 52, originalPb.encode('quest.QuestFinishedRspMsg', { templateId }));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    if (result.rewards.addedItems && result.rewards.addedItems.length > 0) {
      sendInventorySnapshot(state);
    }
    if (result.rewards.leveledUp) {
      const updatedHero = heroState.heroInfo(state.character);
      sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));
    }
    const activeQuests = questState.getActiveQuestProtocolList(result.state);
    if (activeQuests.length > 0) {
      sendGameSession(state, 112, originalPb.encode('quest.QuestUpdatedRspMsg', questState.formatQuestUpdatedProtocol(state.character.state_json, activeQuests)));
    }
    recorder.recordServerOutcome({
      category: 'quest',
      handler: 'handleQuestFinish',
      validations: 'passed',
      persistentChanges: { templateId, rewards: result.rewards },
      responseOpcode: 52,
      finalState: 'SAVED_DB'
    });
    log(`[QUEST #${state.id}] Missao ${templateId} concluida com sucesso! Recompensas entregues: +${result.rewards.gold} ouro, +${result.rewards.xp} XP. Nivel: ${result.newGrade}`);
  } catch (err) {
    log(`[QUEST #${state.id}] Falha ao concluir missao ${templateId}: ${err.message}`);
    recorder.recordServerOutcome({
      category: 'quest',
      handler: 'handleQuestFinish',
      validations: 'failed',
      error: err.message,
      finalState: 'REJECTED'
    });
  }
}

async function handleAppellExchangeCmd(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const req = originalPb.decode('player.AppellExchangeMsg', body);
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      const res = secondaryFeatures.handleAppellExchange(saved, req.appellId, req.look);
      return { state: saved, res };
    });
    state.character = await db.characterById(state.gatewayId);
    const appellsMsg = secondaryFeatures.formatAppellsMsg(result.state);
    sendGameSession(state, 4484, originalPb.encode('player.AppellsMsg', appellsMsg));
    sendGameSession(state, 4491, originalPb.encode('player.AppellsMsg', appellsMsg));
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
    log(`[APPELL #${state.id}] Titulo atualizado: id=${req.appellId}, look=${req.look}.`);
  } catch(e) {
    log(`[APPELL #${state.id}] Falha: ${e.message}`);
  }
}

async function handleRuneHoleInfoCmd(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const saved = inventoryState.parseState(state.character?.state_json || {});
    const msg = secondaryFeatures.formatRuneHoleAllInfoMsg(saved);
    sendGameSession(state, 4980, originalPb.encode('army.RuneHoleAllInfoMsg', msg));
    log(`[RUNE HOLE #${state.id}] Info de furos de runa despachada (4980).`);
  } catch(e) {
    log(`[RUNE HOLE #${state.id}] Falha: ${e.message}`);
  }
}

async function handleRuneHoleOpCmd(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const req = originalPb.decode('army.RuneHoleOpMsg', body);
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      const res = secondaryFeatures.operateRuneHole(saved, req.holeId, req.op, req.opPos, req.beginPos);
      return { state: saved, res };
    });
    state.character = await db.characterById(state.gatewayId);
    const msg = secondaryFeatures.formatRuneHoleAllInfoMsg(result.state);
    sendGameSession(state, 4980, originalPb.encode('army.RuneHoleAllInfoMsg', msg));
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
    log(`[RUNE HOLE OP #${state.id}] holeId=${req.holeId}, op=${req.op} concluido.`);
  } catch(e) {
    log(`[RUNE HOLE OP #${state.id}] Falha: ${e.message}`);
  }
}

async function handleEquipRuneStoneCmd(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const req = originalPb.decode('army.RuneMosReqMsg', body);
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      const res = secondaryFeatures.equipRuneStone(saved, req.runeId, req.runeIndex, req.runeStoneId, req.targetRuneHoleId);
      return { state: saved, res };
    });
    state.character = await db.characterById(state.gatewayId);
    sendGameSession(state, 4980, originalPb.encode('army.RuneHoleAllInfoMsg', secondaryFeatures.formatRuneHoleAllInfoMsg(result.state)));
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
    log(`[RUNE EQUIP #${state.id}] Runa ${req.runeId} equipada no furo ${req.targetRuneHoleId}.`);
  } catch(e) {
    log(`[RUNE EQUIP #${state.id}] Falha: ${e.message}`);
  }
}

async function handleRuneUnloadCmd(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const req = originalPb.decode('army.RuneUnloadReqMsg', body);
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      const res = secondaryFeatures.unloadRuneStone(saved, req.runeId, req.index);
      return { state: saved, res };
    });
    state.character = await db.characterById(state.gatewayId);
    sendGameSession(state, 4980, originalPb.encode('army.RuneHoleAllInfoMsg', secondaryFeatures.formatRuneHoleAllInfoMsg(result.state)));
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
    log(`[RUNE UNLOAD #${state.id}] Runa ${req.runeId} desequipada.`);
  } catch(e) {
    log(`[RUNE UNLOAD #${state.id}] Falha: ${e.message}`);
  }
}

async function handleHeroRuneOp(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const req = originalPb.decode('army.HeroRuneOpMsg', body);
    log(`[RUNE OP #${state.id}] Requisição 8605: opType=${req.opType}, runeId=${req.runeId}, learnRunePos=${req.learnRunePos}, count=${req.count}`);

    const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
      saved.army = saved.army || {};
      saved.army.runes = Array.isArray(saved.army.runes) ? saved.army.runes : [];

      let rune = saved.army.runes.find(r => Number(r.runeId) === Number(req.runeId));

      if (req.opType === 1) { // RUNE_STUDY
        if (!rune) {
          rune = {
            runeId: Number(req.runeId || 101),
            runeGp: 0,
            swallowCount: 0,
            runeHole: String(req.learnRunePos || 1),
            tempHole: '',
            newSkillTempId: 0,
            baseProperties: ''
          };
          saved.army.runes.push(rune);
        }
      } else if (req.opType === 2) { // RUNE_UPGRADE
        let itemMoved = [];
        const count = Math.max(0, Number(req.count) || 0);
        let addGp = 500;
        if (count > 0) {
          const bag = inventoryState.inventory(saved);
          const runeStones = bag.items.filter(i => Number(i.templateId) === 3020010 && Number(i.bagType) === 1);
          const totalStones = runeStones.reduce((sum, i) => sum + Number(i.count || 0), 0);
          const actualUse = Math.min(count, totalStones);
          if (actualUse > 0) {
            let left = actualUse;
            for (const it of runeStones) {
              if (left <= 0) break;
              const used = Math.min(left, Number(it.count));
              it.count -= used;
              left -= used;
              itemMoved.push({ bagType: 1, objectId: 0, ownerId: state.gatewayId, pos: it.pos, item: it.count > 0 ? it : null });
              if (it.count <= 0) bag.items.splice(bag.items.indexOf(it), 1);
            }
            addGp = actualUse * 50;
          }
        }

        if (!rune) {
          rune = {
            runeId: Number(req.runeId || 101),
            runeGp: addGp,
            swallowCount: 1,
            runeHole: '1',
            tempHole: '',
            newSkillTempId: 0,
            baseProperties: ''
          };
          saved.army.runes.push(rune);
        } else {
          rune.runeGp = (rune.runeGp || 0) + addGp;
          rune.swallowCount = (rune.swallowCount || 0) + 1;
        }

        // Loop determinístico de evolução de nível da runa baseado em t_s_runetemplate
        let curTpl = secondaryFeatures.runeTemplateById.get(Number(rune.runeId));
        while (curTpl && curTpl.NextRuneId && Number(curTpl.NextRuneId) > 0) {
          const nextTpl = secondaryFeatures.runeTemplateById.get(Number(curTpl.NextRuneId));
          if (nextTpl && Number(rune.runeGp) >= Number(nextTpl.NeedGp || 0)) {
            rune.runeId = Number(nextTpl.TemplateId);
            rune.newSkillTempId = Number(nextTpl.SkillTemplateId || 0);
            curTpl = nextTpl;
          } else {
            break;
          }
        }

        return {
          state: saved,
          runes: saved.army.runes,
          runeKey: saved.army.runeKey || '',
          itemMoved
        };
      } else if (req.opType === 3) { // RUNE_TAKE
        saved.army.runeKey = String(req.runeKey || req.runeId || '');
      }

      return {
        state: saved,
        runes: saved.army.runes,
        runeKey: saved.army.runeKey || ''
      };
    });

    state.character = await db.characterById(state.gatewayId);
    state.character.state_json = JSON.stringify(result.state);

    if (result.itemMoved && result.itemMoved.length > 0) {
      sendGameSession(state, 115, makeBagMoveUpdate(result.itemMoved), state.gatewayId);
    }
    attributeCalculator.recalculate(result.state, state.character.grade);
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));

    const rsp = {
      userId: state.gatewayId,
      runeId: req.runeId || 0,
      runeKey: result.runeKey,
      learnRunePos: req.learnRunePos || 0,
      learnRuneCount: req.learnRuneCount || 0,
      opType: req.opType,
      opResult: true,
      runeInfo: {
        userId: state.gatewayId,
        runeKey: result.runeKey,
        runeinfo: result.runes.map(r => ({
          runeId: Number(r.runeId),
          runeGp: Number(r.runeGp || 0),
          swallowCount: Number(r.swallowCount || 0),
          runeHole: String(r.runeHole || '1'),
          tempHole: String(r.tempHole || ''),
          newSkillTempId: Number(r.newSkillTempId || 0),
          baseProperties: String(r.baseProperties || '')
        }))
      },
      count: req.count || 0
    };

    const wire = originalPb.encode('army.HeroRuneOpMsg', rsp);
    sendGameSession(state, 4495, wire);
    log(`[RUNE OP #${state.id}] Resposta 4495 enviada com sucesso! Runas=${result.runes.length}`);
  } catch (err) {
    log(`[RUNE OP #${state.id}] Falha ao processar 8605: ${err.message}`);
    try {
      const errWire = originalPb.encode('army.HeroRuneOpMsg', {
        userId: state.gatewayId,
        runeId: 0,
        runeKey: '',
        learnRunePos: 0,
        learnRuneCount: 0,
        opType: 0,
        opResult: false,
        runeInfo: { userId: state.gatewayId, runeKey: '', runeinfo: [] },
        count: 0
      });
      sendGameSession(state, 4495, errWire);
    } catch (_) {}
  }
}

async function handleCombatGuardianReqCmd(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const req = originalPb.decode('combatguardian.CombatGuardianOpReq', body);
    const guardianState = require('./combat-guardian-state');
    if (Number(req.op) === 0) {
      const saved = inventoryState.parseState(state.character.state_json);
      const rsp = secondarySystemsState.formatCombatGuardianOpRes(saved);
      sendGameSession(state, 4873, originalPb.encode('combatguardian.CombatGuardianOpRes', rsp));
      return;
    }
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      const res = guardianState.operate(saved, Number(req.op), Number(req.templateId));
      const rsp = secondarySystemsState.formatCombatGuardianOpRes(saved);
      const wire = originalPb.encode('combatguardian.CombatGuardianOpRes', rsp);
      return { state: saved, res, wire };
    });
    state.character = await db.characterById(state.gatewayId);
    sendGameSession(state, 4873, result.wire);
    sendGameSession(state, 115, makeInventorySnapshot(state.gatewayId, result.state), state.gatewayId);
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
    log(`[COMBAT GUARDIAN #${state.id}] Guardiao op=${req.op}, templateId=${req.templateId} persistido.`);
  } catch(e) {
    log(`[COMBAT GUARDIAN #${state.id}] Falha: ${e.message}`);
    if (state.character && !state.closed) {
      const saved = inventoryState.parseState(state.character.state_json);
      sendGameSession(state, 4873, originalPb.encode('combatguardian.CombatGuardianOpRes',
        secondarySystemsState.formatCombatGuardianOpRes(saved)));
    }
  }
}

async function handleDragonSoulReqCmd(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const req = originalPb.decode('dragonsoul.DragonSoulOpReq', body);
    const op = Number(req.op || 0);
    const type = Number(req.type || 101);
    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
      const bag = inventoryState.inventory(saved);
      const stocks = bag.items.filter(item => Number(item.bagType) === 1 && Number(item.templateId) === 2125150);
      const bagCount = stocks.reduce((total, item) => total + Number(item.count || 0), 0);
      const res = secondaryFeatures.feedDragonSoul(saved, op, type, bagCount);
      const bagUpdates = [];
      if (res.consumed > 0) {
        let toDeduct = res.consumed;
        for (const slot of stocks) {
          if (!toDeduct) break;
          const take = Math.min(Number(slot.count || 0), toDeduct);
          slot.count -= take;
          toDeduct -= take;
          bagUpdates.push({ bagType: 1, objectId: 0, ownerId: state.gatewayId, pos: slot.pos, item: slot.count > 0 ? slot : null });
          if (slot.count <= 0) bag.items.splice(bag.items.indexOf(slot), 1);
        }
        attributeCalculator.recalculate(saved, Number(locked.grade) || state.character?.grade || 1);
      }
      return { state: saved, res, bagUpdates };
    });
    state.character = await db.characterById(state.gatewayId);
    const rsp = secondaryFeatures.formatDragonSoulOpRes(result.state);
    sendGameSession(state, 555, originalPb.encode('dragonsoul.DragonSoulOpRes', rsp));
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    if (result.bagUpdates && result.bagUpdates.length > 0) {
      sendGameSession(state, 115, makeBagMoveUpdate(result.bagUpdates), state.gatewayId);
    }
    log(`[DRAGON SOUL #${state.id}] Alma do Dragao op=${op}, type=${type} -> grade=${rsp.grade}, exp=${rsp.exp}, consumed=${result.res.consumed}. Opcode 555 enviado.`);
  } catch(e) {
    log(`[DRAGON SOUL #${state.id}] Falha: ${e.message}`);
  }
}

async function handleRefiningSoulCmd(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      const res = secondaryFeatures.upgradeSoul(saved, 101, 100);
      return { state: saved, res };
    });
    state.character = await db.characterById(state.gatewayId);
    sendGameSession(state, 4372, originalPb.encode('lucky.PlayerRefiningSoulMsg', { count: 1, remainCount: 5, point: 100, soul: [] }));
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
    log(`[SOUL REFINING #${state.id}] Cristal de Alma aprimorado.`);
  } catch(e) {
    log(`[SOUL REFINING #${state.id}] Falha: ${e.message}`);
  }
}

async function handleExtraJobReq(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const req = originalPb.decode('extrajob.ExtraJobReqMsg', body);
    const op = Number(req.op || 1);
    const jobType = Number(req.jobType || 41);
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      saved.extraJob = saved.extraJob || { active: {}, equips: {} };
      saved.extraJob.active = saved.extraJob.active || {};
      if (op === 2) {
        const curLvl = Number(saved.extraJob.active[jobType]?.level || 1);
        saved.extraJob.active[jobType] = { level: curLvl + 1, skillScript: '' };
      }
      return { state: saved };
    });
    state.character.state_json = result.state;
    const activeList = [41, 42, 43, 44].map(j => ({
      jobType: j,
      jobLevel: Number(result.state.extraJob?.active?.[j]?.level || 1),
      skillScript: String(result.state.extraJob?.active?.[j]?.skillScript || '')
    }));
    sendGameSession(state, 449, originalPb.encode('extrajob.ExtraJobMsg', { op, activeList }));
    log(`[EXTRAJOB #${state.id}] Especializacao op=${op}, jobType=${jobType}. Opcode 449 enviado.`);
  } catch (err) {
    log(`[EXTRAJOB #${state.id}] Erro 8608: ${err.message}`);
  }
}

async function handleExtraJobEquipReq(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const req = originalPb.decode('extrajob.ExtraJobEquipReqMsg', body);
    const op = Number(req.op || 1);
    const equipType = Number(req.equipType || 1);
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      saved.extraJob = saved.extraJob || { active: {}, equips: {} };
      saved.extraJob.equips = saved.extraJob.equips || {};
      saved.extraJob.equips[equipType] = saved.extraJob.equips[equipType] || { level: 1, strengthenLevel: 0 };
      if (op === 2) {
        saved.extraJob.equips[equipType].level = Number(saved.extraJob.equips[equipType].level || 1) + 1;
      } else if (op === 3) {
        saved.extraJob.equips[equipType].strengthenLevel = Number(saved.extraJob.equips[equipType].strengthenLevel || 0) + 1;
      }
      return { state: saved };
    });
    state.character.state_json = result.state;
    const equipList = [1, 2, 3, 4, 5, 6].map(e => ({
      equipType: e,
      equipLevel: Number(result.state.extraJob?.equips?.[e]?.level || 1),
      strengthenLevel: Number(result.state.extraJob?.equips?.[e]?.strengthenLevel || 0),
      join1: 0, join2: 0, join3: 0, join4: 0
    }));
    sendGameSession(state, 450, originalPb.encode('extrajob.ExtraJobEquipMsg', { op, equipList }));
    log(`[EXTRAJOB EQUIP #${state.id}] Horcrux op=${op}, equipType=${equipType}. Opcode 450 enviado.`);
  } catch (err) {
    log(`[EXTRAJOB EQUIP #${state.id}] Erro 8609: ${err.message}`);
  }
}

async function handleBountyRefreshCmd(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      const res = secondaryFeatures.refreshBounties(saved);
      return { state: saved, res };
    });
    state.character = await db.characterById(state.gatewayId);
    log(`[BOUNTY REFRESH #${state.id}] Missoes de recompensa atualizadas.`);
  } catch(e) {
    log(`[BOUNTY REFRESH #${state.id}] Falha: ${e.message}`);
  }
}

async function handleBountyFinishCmd(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const req = originalPb.decode('reward.RewardFinishedReqMsg', body);
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      const res = secondaryFeatures.finishBounty(saved, req.rewardId || 1);
      return { state: saved, res };
    });
    state.character = await db.characterById(state.gatewayId);
    sendGameSession(state, 52, originalPb.encode('reward.RewardFinishedRspMsg', { rewardId: req.rewardId || 1 }));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    log(`[BOUNTY FINISH #${state.id}] Missao de recompensa ${req.rewardId} concluida com sucesso.`);
  } catch(e) {
    log(`[BOUNTY FINISH #${state.id}] Falha: ${e.message}`);
  }
}

async function handleLotteryRune(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const saved = inventoryState.parseState(state.character?.state_json || {});
    const powerPoint = Number(saved.runeLottery?.powerPoint || 100);
    const runePoint = Number(saved.runeLottery?.runePoint || 50);
    const leftTime = 0;
    sendGameSession(state, 4742, originalPb.encode('army.LotteryRuneRspMsg', {
      powerPointNum: powerPoint,
      runePointNum: runePoint,
      runeChipNum: 10,
      leftTime: leftTime
    }));
    log(`[LOTTERY RUNE #${state.id}] Info de loteria/expedicao de runas despachada (4742).`);
  } catch (e) {
    log(`[LOTTERY RUNE #${state.id}] Falha: ${e.message}`);
  }
}

async function handleMarketInfoReq(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    let op = 1;
    if (body && body.length > 0) {
      try {
        const decoded = originalPb.decode('market.MarketInfoReqMsg', body);
        if (decoded && decoded.op !== undefined && decoded.op !== null) op = Number(decoded.op);
      } catch (_) {}
    }
    if (op === 1) {
      sendGameSession(state, 4353, originalPb.encode('market.MarketItemListMsg', {
        marketItemInfo: []
      }));
    } else if (op === 2 || op === 3) {
      sendGameSession(state, 4354, originalPb.encode('market.MarketOrderListMsg', {
        op: op,
        orderList: [],
        freeUseMarkeOrderCount: 0,
        payUseMarketOrderCount: 0,
        freeUsePurchaseCount: 0,
        payUsePurchaseCount: 0
      }));
    } else if (op === 4) {
      sendGameSession(state, 4356, originalPb.encode('market.MarketItemSellInfoMsg', {
        marketItemSellList: []
      }));
    } else if (op === 5) {
      sendGameSession(state, 4357, originalPb.encode('market.MarketItemPurchaseInfoMsg', {
        marketItemPurchaseList: []
      }));
    }
    log(`[MARKET #${state.id}] Requisicao de mercado atendida (op=${op}).`);
  } catch (e) {
    log(`[MARKET #${state.id}] Falha: ${e.message}`);
  }
}

async function handleLordsMainBoard(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    sendGameSession(state, 4529, originalPb.encode('lucky.LordsOrderListMsg', {
      param1: 0,
      param2: 0,
      param3: '0',
      currTurn: 0,
      maxTurn: 0,
      score: 0
    }));
    log(`[LORDS BOARD #${state.id}] Painel de Senhores sincronizado (4529).`);
  } catch (e) {
    log(`[LORDS BOARD #${state.id}] Falha: ${e.message}`);
  }
}

function deliverRewardStringToCharacter(saved, character, rewardStr) {
  if (!rewardStr || typeof rewardStr !== 'string') return [];
  const itemsGiven = [];
  const entries = rewardStr.split('|');
  for (const entry of entries) {
    if (!entry.trim()) continue;
    const parts = entry.split(',').map(s => Number(s.trim()));
    const rawId = parts[0];
    const rawQty = parts[1] || 1;
    if (!rawId || !rawQty) continue;
    if (rawId === -100) {
      saved.gold = (Number(saved.gold) || 0) + rawQty;
      if (character) character.gold = saved.gold;
      itemsGiven.push({ type: 'gold', count: rawQty });
    } else if (rawId === -200) {
      saved.daru = (Number(saved.daru) || 0) + rawQty;
      if (character) character.daru = saved.daru;
      itemsGiven.push({ type: 'daru', count: rawQty });
    } else if (rawId === -500) {
      saved.point = (Number(saved.point) || 0) + rawQty;
      if (character) character.point = saved.point;
      itemsGiven.push({ type: 'balens', count: rawQty });
    } else if (rawId === -5500) {
      saved.gift_token = (Number(saved.gift_token) || 0) + rawQty;
      if (character) character.gift_token = saved.gift_token;
      itemsGiven.push({ type: 'bound_balens', count: rawQty });
    } else if (rawId > 0) {
      inventoryState.addItem(saved, rawId, rawQty);
      itemsGiven.push({ type: 'item', id: rawId, count: rawQty });
    }
  }
  return itemsGiven;
}

async function handleGrowthFundLevel(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    let req = { op: 0, giftId: 0 };
    if (body && body.length > 0) {
      try { req = originalPb.decode('growthfund.GrowthFundReq', body); } catch (_) {}
    }
    const op = Number(req.op || 0);
    const giftId = Number(req.giftId || 0);
    const growthFundConfig = canonicalConfigs.getTable('t_s_growthfund') || [];

    let resBuyIds = [];
    let resReceiveIds = [];

    await db.mutateCharacterState(state.gatewayId, (saved) => {
      saved.growthFund = saved.growthFund || { buyIds: [], receiveIds: [] };
      if (!Array.isArray(saved.growthFund.receiveIds)) saved.growthFund.receiveIds = [];
      if (!Array.isArray(saved.growthFund.buyIds)) saved.growthFund.buyIds = [];

      const playerGrade = Number(state.character?.grade || 1);
      const vipObj = getCharacterVip(state.character);
      const playerVip = Number(vipObj.vipLevel || state.character?.vip_level || saved.vip?.level || 0);

      if (op === 2 && giftId > 0) {
        // Coleta de pacote de crescimento ou VIP
        const pack = growthFundConfig.find(p => Number(p.Id) === giftId);
        if (pack && !saved.growthFund.receiveIds.includes(giftId)) {
          const reqGrade = Number(pack.Para1 || 0);
          const reqVip = Number(pack.Para2 || 0);
          const canCollect = (Number(pack.Type) === 1 && playerGrade >= reqGrade) ||
                            (Number(pack.Type) === 3 && playerGrade >= reqGrade && playerVip >= reqVip) ||
                            (Number(pack.Type) === 2 && saved.growthFund.buyIds.includes(giftId));
          if (canCollect) {
            saved.growthFund.receiveIds.push(giftId);
            deliverRewardStringToCharacter(saved, state.character, pack.Reward);
          }
        }
      } else if (op === 1 && giftId > 0) {
        // Compra de pacote especial
        const pack = growthFundConfig.find(p => Number(p.Id) === giftId && Number(p.Type) === 2);
        if (pack && !saved.growthFund.buyIds.includes(giftId)) {
          const cost = Number(pack.Discount || pack.Price || 0);
          const currentBalens = Number(state.character?.point || saved.point || 0);
          if (currentBalens >= cost) {
            saved.point = currentBalens - cost;
            if (state.character) state.character.point = saved.point;
            saved.growthFund.buyIds.push(giftId);
            deliverRewardStringToCharacter(saved, state.character, pack.Reward);
          }
        }
      }

      resBuyIds = [...saved.growthFund.buyIds];
      resReceiveIds = [...saved.growthFund.receiveIds];

      return {
        state: saved,
        resources: {
          gold: state.character?.gold || saved.gold || 0,
          crystals: state.character?.point || saved.point || 0,
          bound_crystals: state.character?.gift_token || saved.gift_token || 0
        }
      };
    });

    sendGameSession(state, 512, originalPb.encode('growthfund.GrowthFundRes', {
      buyIds: resBuyIds,
      receiveIds: resReceiveIds
    }));

    if (op > 0) {
      sendInventorySnapshot(state);
      sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    }

    log(`[GROWTH FUND #${state.id}] Pacote de nivel (512): op ${op}, giftId ${giftId}, buyIds: [${resBuyIds.join(',')}], receiveIds: [${resReceiveIds.join(',')}].`);
  } catch (e) {
    log(`[GROWTH FUND #${state.id}] Falha: ${e.message}`);
  }
}

async function handleGrowthFundInfo(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const saved = inventoryState.parseState(state.character?.state_json || {});
    const grades = [10, 20, 30, 40, 50, 60, 70, 80];
    const claimed = Array.isArray(saved.growthFundGrades) ? saved.growthFundGrades : [];
    const playerGrade = Number(state.character?.grade || 1);
    const fundMsg = grades.map(g => ({
      grade: g,
      status: claimed.includes(g) ? 2 : (playerGrade >= g ? 1 : 0)
    }));
    sendGameSession(state, 4706, originalPb.encode('fund.GrowthFundDataInfoRsp', {
      fundMsg,
      isPay: 2,
      recNum: claimed.length,
      isOpen: true
    }));
    log(`[GROWTH FUND INFO #${state.id}] Info enviada (4706).`);
  } catch (e) {
    log(`[GROWTH FUND INFO #${state.id}] Falha: ${e.message}`);
  }
}

async function handleGrowthFundReceive(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    let req = { grade: 0 };
    if (body && body.length > 0) {
      try { req = originalPb.decode('fund.GrowthFundRecReq', body); } catch (_) {}
    }
    const grade = Number(req.grade || 0);
    const playerGrade = Number(state.character?.grade || 1);
    if (grade > 0 && playerGrade >= grade) {
      await db.mutateCharacterState(state.gatewayId, (saved) => {
        if (!Array.isArray(saved.growthFundGrades)) saved.growthFundGrades = [];
        if (!saved.growthFundGrades.includes(grade)) {
          saved.growthFundGrades.push(grade);
          state.character.bound_crystals = (Number(state.character.bound_crystals) || 0) + grade * 50;
        }
        return {
          state: saved,
          resources: { bound_crystals: state.character.bound_crystals }
        };
      });
    }
    await handleGrowthFundInfo(state, Buffer.alloc(0));
  } catch (e) {
    log(`[GROWTH FUND RECEIVE #${state.id}] Falha: ${e.message}`);
  }
}

async function handleOnlineReward(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    let req = { op: 1 };
    if (body && body.length > 0) {
      try { req = originalPb.decode('active.OnlinerewardReq', body); } catch (_) {}
    }
    const op = Number(req.op || 1);
    const onlineRewardTable = canonicalConfigs.getTable('t_s_onlinerewards') || [];
    const allItem = onlineRewardTable.map(item => ({
      id: Number(item.Id),
      itemId: Number(item.ItemId),
      num: Number(item.ItemNum),
      weight: Number(item.Random)
    }));

    let rewardTime = 5;
    let winId = 1;

    await db.mutateCharacterState(state.gatewayId, (saved) => {
      const todayStr = new Date().toISOString().slice(0, 10);
      saved.onlineReward = saved.onlineReward || { spinsLeft: 5, lastDate: todayStr };
      if (saved.onlineReward.lastDate !== todayStr) {
        saved.onlineReward.spinsLeft = 5;
        saved.onlineReward.lastDate = todayStr;
      }

      if (op === 2) {
        if (saved.onlineReward.spinsLeft > 0) {
          saved.onlineReward.spinsLeft -= 1;
        }
        const totalWeight = allItem.reduce((acc, it) => acc + (it.weight || 0), 0);
        let roll = Math.floor(Math.random() * (totalWeight || 1000));
        for (const it of allItem) {
          if (roll < it.weight) {
            winId = it.id;
            break;
          }
          roll -= it.weight;
        }
      }
      rewardTime = saved.onlineReward.spinsLeft;
      return { state: saved };
    });

    sendGameSession(state, 4697, originalPb.encode('active.OnlineRewardInfoRsp', {
      op,
      rewardTime,
      leftTime: 300,
      allItem,
      id: winId
    }));
    log(`[ONLINE REWARD #${state.id}] Recompensa online (4697): op ${op}, winId ${winId}, tentativas restantes: ${rewardTime}.`);
  } catch (e) {
    log(`[ONLINE REWARD #${state.id}] Falha: ${e.message}`);
  }
}

async function handleOnlineRewardEnsure(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    let req = {};
    if (body && body.length > 0) {
      try { req = originalPb.decode('active.AddItemReq', body); } catch (_) {}
    }
    const rewards = Array.isArray(req.reward) ? req.reward : [];
    if (rewards.length === 0) return;

    await db.mutateCharacterState(state.gatewayId, (saved) => {
      for (const r of rewards) {
        const itemId = Number(r.itemId || r.templateId || 0);
        const count = Number(r.num || r.count || 1);
        if (!itemId) continue;
        if (itemId === -100) {
          saved.gold = (Number(saved.gold) || 0) + count;
          if (state.character) state.character.gold = saved.gold;
        } else if (itemId === -500) {
          saved.point = (Number(saved.point) || 0) + count;
          if (state.character) state.character.point = saved.point;
        } else if (itemId === -5500) {
          saved.gift_token = (Number(saved.gift_token) || 0) + count;
          if (state.character) state.character.gift_token = saved.gift_token;
        } else if (itemId === -200) {
          saved.daru = (Number(saved.daru) || 0) + count;
          if (state.character) state.character.daru = saved.daru;
        } else if (itemId > 0) {
          inventoryState.addItem(saved, itemId, count);
        }
      }
      return { state: saved };
    });

    sendInventorySnapshot(state);
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    log(`[ONLINE REWARD ENSURE #${state.id}] Itens entregues ao jogador (Opcode 8788).`);
  } catch (e) {
    log(`[ONLINE REWARD ENSURE #${state.id}] Falha: ${e.message}`);
  }
}

async function handleGoldImpose(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    let req = { op: 0, payType: 1 };
    if (body && body.length > 0) {
      try { req = originalPb.decode('simple.GoldImposeReqMsg', body); } catch (_) {}
    }
    const payType = Number(req.payType !== undefined ? req.payType : 1);
    const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
      const levyRes = castleState.levyTaxes(saved, payType);
      return { state: saved, levyRes, resources: { gold: levyRes.totalGold } };
    });
    state.character = await db.characterById(state.gatewayId);
    const levyRes = result.levyRes;

    sendGameSession(state, 4242, originalPb.encode('simple.GoldImposeMsg', {
      leftImpose: levyRes.leftImpose,
      maxImpose: levyRes.maxImpose,
      payImpose: levyRes.payImpose
    }));

    const b = levyRes.prefeitura;
    sendGameSession(state, 4130, originalPb.encode('building.BuildingInfoListMsg', {
      result: true,
      building: [{
        userId: state.gatewayId,
        buildingId: Number(b.buildingId),
        castleId: 1,
        createdDate: b.createdDate,
        isExist: true,
        templateId: Number(b.templateId),
        sonType: Number(b.sonType),
        propterty1: Number(b.property1 || 0),
        propterty2: Number(b.property2 || 30),
        levyNum: Number(b.levyNum || 0)
      }]
    }));

    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    log(`[IMPOSTOS #${state.id}] Arrecadacao realizada (tipo=${payType}): +${levyRes.goldEarned} ouro. Restantes: ${levyRes.leftImpose}/${levyRes.maxImpose}. Opcodes 4242, 4130 e 3 enviados.`);
  } catch (err) {
    log(`[IMPOSTOS #${state.id}] Erro na arrecadacao: ${err.message}`);
  }
}

async function handleBuildingUpgrade(state, body) {
  if (!state.gatewayId || state.closed) return;
  let req;
  try {
    req = originalPb.decode('building.BuildingOptionReqMsg', body);
    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
      const playerLevel = Number(locked.grade || state.character?.grade || 5);
      const upgradeRes = castleState.upgradeBuilding(saved, req.buildingId, playerLevel);
      return {
        state: saved,
        upgrade: upgradeRes,
        resources: {
          gold: upgradeRes.remainingGold,
          grade: playerLevel,
          experience: Number(locked.experience || 0)
        }
      };
    });
    state.character = await db.characterById(state.gatewayId);

    const bInfo = result.upgrade.building;
    const bListMsg = {
      result: true,
      building: [{
        userId: state.gatewayId,
        buildingId: Number(bInfo.buildingId),
        castleId: 1,
        createdDate: bInfo.createdDate,
        isExist: true,
        templateId: Number(bInfo.templateId),
        sonType: Number(bInfo.sonType),
        propterty1: Number(bInfo.property1 || 0),
        propterty2: Number(bInfo.property2 || 0),
        levyNum: Number(bInfo.levyNum || 0)
      }]
    };
    sendGameSession(state, 4130, originalPb.encode('building.BuildingInfoListMsg', bListMsg));
    sendGameSession(state, 109, originalPb.encode('castle.CastleYieldMsg', castleState.formatCastleYieldMsg(result.state)));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    sendGameSession(state, 4187, originalPb.encode('building.BuildOrderList', castleState.formatBuildOrderListMsg(result.state, state.gatewayId)));
    try {
      const heroInfoMsg = heroState.heroInfo(state.character, result.state);
      sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroInfoMsg));
    } catch (_) {}

    if (result.upgrade.questsChanged && result.upgrade.updatedQuests?.length > 0) {
      sendGameSession(state, 112, originalPb.encode('quest.QuestUpdatedRspMsg', questState.formatQuestUpdatedProtocol(state.character.state_json, result.upgrade.updatedQuests)));
      log(`[CASTLE #${state.id}] Missão atualizada após upgrade de edifício: [${result.upgrade.updatedQuests.map(q => q.templateId).join(', ')}]`);
    }

    recorder.recordServerOutcome({
      category: 'castle',
      handler: 'handleBuildingUpgrade',
      validations: 'passed',
      persistentChanges: {
        buildingId: bInfo.buildingId,
        sonType: bInfo.sonType,
        newGrade: bInfo.grade,
        newTemplateId: bInfo.templateId,
        cost: result.upgrade.goldCost,
        remainingGold: result.upgrade.remainingGold
      },
      responseOpcode: 4130,
      finalState: 'SAVED_DB'
    });

    log(`[BUILDING UPGRADE #${state.id}] Edifício ${bInfo.buildingId} (sonType ${bInfo.sonType}) melhorado para grau ${bInfo.grade} (template ${bInfo.templateId}). Custo: ${result.upgrade.goldCost} ouro.`);
  } catch (err) {
    log(`[BUILDING UPGRADE #${state.id}] Falha ao melhorar edifício: ${err.message}`);
    recorder.recordServerOutcome({
      category: 'castle',
      handler: 'handleBuildingUpgrade',
      validations: 'failed',
      error: err.message,
      finalState: 'REJECTED'
    });
  }
}

async function handleEnterCastle(state) {
  if (!state.gatewayId || state.closed) return;
  try {
    const charGrade = state.character?.grade || 1;
    const saved = state.character?.state_json ? inventoryState.parseState(state.character.state_json) : {};
    castleState.ensureCastleState(saved, charGrade);
    sendGameSession(state, 4130, originalPb.encode('building.BuildingInfoListMsg', castleState.formatBuildingListMsg(saved, state.gatewayId, charGrade)));
    sendGameSession(state, 109, originalPb.encode('castle.CastleYieldMsg', castleState.formatCastleYieldMsg(saved)));
    sendGameSession(state, 4187, originalPb.encode('building.BuildOrderList', castleState.formatBuildOrderListMsg(saved, state.gatewayId)));
    barracksState.ensureArmyPawns(saved);
    const pawnsProto = barracksState.formatArmyPawnUpdatedMsg(saved, state.gatewayId);
    if (pawnsProto.armyPawn.length > 0) {
      sendGameSession(state, 100, originalPb.encode('army.ArmyPawnUpdatedMsg', pawnsProto));
      sendGameSession(state, 92, originalPb.encode('army.ArmyPawnUpdatedMsg', pawnsProto));
    }
    if(state.cloudRestorePosition)scheduleCloudRestore(state,2300);
    log(`[CASTLE #${state.id}] Entrada no Castelo sincronizada com sucesso.`);
  } catch (err) {
    log(`[CASTLE #${state.id}] Falha ao processar C_ENTER_CASTLE: ${err.message}`);
  }
}

async function handleLoadBuildOrder(state) {
  if (!state.gatewayId || state.closed) return;
  try {
    const saved = state.character?.state_json ? inventoryState.parseState(state.character.state_json) : {};
    sendGameSession(state, 4187, originalPb.encode('building.BuildOrderList', castleState.formatBuildOrderListMsg(saved, state.gatewayId)));
    log(`[BUILD ORDER #${state.id}] Filas de construcao sincronizadas (opcode 4187).`);
  } catch (err) {
    log(`[BUILD ORDER #${state.id}] Falha ao processar C_LOAD_BUILD_ORDER: ${err.message}`);
  }
}

async function handleGradePacket(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    let req = { op: 1, grade: 0 };
    if (body && body.length > 0) {
      try { req = originalPb.decode('active.GradePacketReq', body); } catch (_) {}
    }
    const op = Number(req.op || 1);
    const grade = Number(req.grade || 0);
    const giftpackConfig = canonicalConfigs.getTable('t_s_growthgiftpack') || [];
    const allPacket = giftpackConfig.map(p => ({
      id: Number(p.Id),
      grade: Number(p.Grade),
      packet: String(p.FreeId || ''),
      preferPacket: String(p.PreferentialId || ''),
      price: Number(p.Price || 0),
      discount: Number(p.Discount || 0)
    }));

    let receiveSite = 0;
    let buySite = 0;

    await db.mutateCharacterState(state.gatewayId, (saved) => {
      saved.gradePacket = saved.gradePacket || { receiveSite: 0, buySite: 0 };
      const playerGrade = Number(state.character?.grade || 1);

      if (op === 2 && grade > 0) {
        // Coleta de pacote gratis
        const pack = giftpackConfig.find(p => Number(p.Grade) === grade);
        if (pack && playerGrade >= grade) {
          const bit = 1 << Number(pack.Id);
          if ((saved.gradePacket.receiveSite & bit) === 0) {
            saved.gradePacket.receiveSite |= bit;
            deliverRewardStringToCharacter(saved, state.character, pack.FreeId);
          }
        }
      } else if (op === 3 && grade > 0) {
        // Compra de pacote preferencial
        const pack = giftpackConfig.find(p => Number(p.Grade) === grade);
        if (pack) {
          const cost = Number(pack.Discount || pack.Price || 0);
          const currentBalens = Number(state.character?.point || saved.point || 0);
          const bit = 1 << Number(pack.Id);
          if ((saved.gradePacket.buySite & bit) === 0 && currentBalens >= cost) {
            saved.point = currentBalens - cost;
            if (state.character) state.character.point = saved.point;
            saved.gradePacket.buySite |= bit;
            deliverRewardStringToCharacter(saved, state.character, pack.PreferentialId);
          }
        }
      }

      receiveSite = saved.gradePacket.receiveSite;
      buySite = saved.gradePacket.buySite;
      return { state: saved };
    });

    if (op === 1) {
      sendGameSession(state, 4699, originalPb.encode('active.GradePacketRsp', {
        allPacket,
        receiveSite,
        buySite
      }));
      log(`[GRADE PACKET #${state.id}] Pacotes de nivel sincronizados (opcode 4699).`);
    } else {
      sendGameSession(state, 4700, originalPb.encode('active.GradeReceiveRsp', {
        receiveSite,
        buySite
      }));
      sendInventorySnapshot(state);
      sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
      log(`[GRADE PACKET #${state.id}] Pacote coletado (op ${op}, grade ${grade}). Opcode 4700 enviado.`);
    }
  } catch (err) {
    log(`[GRADE PACKET #${state.id}] Falha ao processar C_GRADE_PACKET: ${err.message}`);
  }
}

async function handleSkillUpgrade(state, body) {
  if (!state.gatewayId || state.closed) return;
  let req;
  try {
    req = originalPb.decode('army.HeroAddPointReqMsg', body);
    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
      const playerLevel = Number(locked.grade || state.character?.grade || 1);
      const playerJob = Number(saved.job || 1);
      const upRes = skillsState.upgradeSkill(saved, playerJob, playerLevel, req.skillTempId);
      return {
        state: saved,
        upgrade: upRes
      };
    });

    const upRes = result.upgrade;
    log(`[SKILL #${state.id}] Habilidade ${upRes.targetTemplate.TemplateName_pt || upRes.targetTemplate.TemplateName_en} (ID: ${upRes.targetTemplate.TemplateId}, SonType: ${upRes.targetTemplate.SonType}, Lv: ${upRes.targetTemplate.Grades}) aprimorada com sucesso. Pontos restantes: ${upRes.remainingSkillPoints}`);

    // Opcode 60: U_C_HERO_SKILL_UPGRADE with army.UpdatedSkillMsg
    sendGameSession(state, 60, originalPb.encode('army.UpdatedSkillMsg', {
      templateId: upRes.targetTemplate.TemplateId,
      index: upRes.index,
      resetResult: false,
      type: req.type || 0
    }));

    // Opcode 113 & 26: U_C_HERO_INFO with army.SimpleHeroInfoMsg (refreshes skillPoint, extraSkillPoint, skillScript, fastKey)
    state.character = await db.characterById(state.gatewayId);
    const updatedHeroSkill = heroState.heroInfo(state.character);
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHeroSkill));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

    recorder.recordServerOutcome({
      category: 'skills',
      handler: 'handleSkillUpgrade',
      validations: 'passed',
      persistentChanges: {
        templateId: upRes.targetTemplate.TemplateId,
        sonType: upRes.targetTemplate.SonType,
        grades: upRes.targetTemplate.Grades,
        remainingSkillPoints: upRes.remainingSkillPoints,
        skillScript: upRes.skillScript
      },
      finalState: 'ACCEPTED'
    });
  } catch (err) {
    log(`[SKILL #${state.id}] Falha ao aprimorar habilidade ${req?.skillTempId}: ${err.message}`);
    recorder.recordServerOutcome({
      category: 'skills',
      handler: 'handleSkillUpgrade',
      validations: 'failed',
      error: err.message,
      finalState: 'REJECTED'
    });
  }
}

async function handleSetFastKey(state, body) {
  if (!state.gatewayId || state.closed) return;
  let req;
  try {
    req = originalPb.decode('army.HeroFastKeyMsg', body);
    const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
      const playerJob = Number(saved.job || 1);
      const fkRes = skillsState.setFastKey(saved, playerJob, req.fastKey);
      return {
        state: saved,
        fastKeyRes: fkRes
      };
    });

    log(`[FASTKEY #${state.id}] Barra de atalhos atualizada: "${req.fastKey}"`);

    // Opcode 64: U_C_HERO_SETFASTKEY with army.HeroFastKeyMsg
    sendGameSession(state, 64, originalPb.encode('army.HeroFastKeyMsg', {
      fastKey: req.fastKey,
      setResult: true
    }));

    // Opcode 113 & 26: U_C_HERO_INFO
    state.character = await db.characterById(state.gatewayId);
    const updatedHeroFastKey = heroState.heroInfo(state.character);
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHeroFastKey));
    sendGameSession(state,113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHeroFastKey));

    recorder.recordServerOutcome({
      category: 'skills',
      handler: 'handleSetFastKey',
      validations: 'passed',
      persistentChanges: {
        fastKey: req.fastKey
      },
      finalState: 'ACCEPTED'
    });
  } catch (err) {
    log(`[FASTKEY #${state.id}] Falha ao definir barra de atalhos: ${err.message}`);
    recorder.recordServerOutcome({
      category: 'skills',
      handler: 'handleSetFastKey',
      validations: 'failed',
      error: err.message,
      finalState: 'REJECTED'
    });
  }
}

async function handleSkillReset(state, body) {
  if (!state.gatewayId || state.closed) return;
  let req;
  try {
    try {
      req = originalPb.decode('player.PayTypeMsg', body);
    } catch (e) {
      req = { payType: 0, type: 0 };
    }
    const payType = req?.payType || 0;
    const skillType = req?.type || 0;

    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
      const playerLevel = Number(locked.grade || state.character?.grade || 1);
      const playerJob = Number(saved.job || 1);
      const currentGold = Number(locked.gold || 0);

      const resetRes = skillsState.resetSkills(saved, playerJob, playerLevel, payType, currentGold);

      const remainingGold = payType === 0 ? Math.max(0, currentGold - resetRes.cost) : currentGold;

      return {
        state: saved,
        reset: resetRes,
        resources: {
          gold: remainingGold,
          grade: playerLevel,
          experience: Number(locked.experience || 0)
        }
      };
    });

    const resetRes = result.reset;
    log(`[SKILL RESET #${state.id}] Habilidades redefinidas. Custo: ${resetRes.cost} ouro. Pontos recuperados: ${resetRes.refundedPoints}`);

    // Opcode 61: U_C_HERO_SKILLPOINT_RESET with army.UpdatedSkillMsg
    sendGameSession(state, 61, originalPb.encode('army.UpdatedSkillMsg', {
      resetResult: true,
      type: skillType
    }));

    // Synchronize resources if gold was deducted
    if (resetRes.cost > 0) {
      sendGameSession(state, 109, originalPb.encode('castle.CastleYieldMsg', {
        gold: result.resources.gold,
        goldCapacity: 500000,
        yieldRate: 1000
      }));
    }

    // Opcode 113 & 26: U_C_HERO_INFO
    state.character = await db.characterById(state.gatewayId);
    const updatedHeroReset = heroState.heroInfo(state.character);
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHeroReset));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

    recorder.recordServerOutcome({
      category: 'skills',
      handler: 'handleSkillReset',
      validations: 'passed',
      persistentChanges: {
        cost: resetRes.cost,
        refundedPoints: resetRes.refundedPoints,
        skillScript: resetRes.skillScript
      },
      finalState: 'ACCEPTED'
    });
  } catch (err) {
    log(`[SKILL RESET #${state.id}] Falha ao redefinir habilidades: ${err.message}`);
    recorder.recordServerOutcome({
      category: 'skills',
      handler: 'handleSkillReset',
      validations: 'failed',
      error: err.message,
      finalState: 'REJECTED'
    });
  }
}

async function handleArmyRecruit(state, body) {
  if (!state.gatewayId || state.closed) return;
  let req;
  try {
    req = originalPb.decode('army.ArmyPawnInfoMsg', body);
    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
      const recruitRes = barracksState.recruitPawn(saved, req.tempateId, req.ownPawns);
      return {
        state: saved,
        recruit: recruitRes,
        resources: {
          gold: recruitRes.remainingGold,
          grade: Number(locked.grade || state.character?.grade || 5),
          experience: Number(locked.experience || 0)
        }
      };
    });
    state.character = await db.characterById(state.gatewayId);

    const pawnMsg = barracksState.formatArmyPawnUpdatedMsg(result.state, state.gatewayId);
    sendGameSession(state, 92, originalPb.encode('army.ArmyPawnUpdatedMsg', pawnMsg));
    sendGameSession(state, 100, originalPb.encode('army.ArmyPawnUpdatedMsg', pawnMsg));
    sendGameSession(state, 109, originalPb.encode('castle.CastleYieldMsg', castleState.formatCastleYieldMsg(result.state)));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

    if (result.recruit.questsChanged && result.recruit.updatedQuests?.length > 0) {
      sendGameSession(state, 112, originalPb.encode('quest.QuestUpdatedRspMsg', questState.formatQuestUpdatedProtocol(state.character.state_json, result.recruit.updatedQuests)));
      log(`[BARRACKS #${state.id}] Missão atualizada após recrutamento: [${result.recruit.updatedQuests.map(q => q.templateId).join(', ')}]`);
    }

    recorder.recordServerOutcome({
      category: 'barracks',
      handler: 'handleArmyRecruit',
      validations: 'passed',
      persistentChanges: {
        templateId: req.tempateId,
        recruited: req.ownPawns,
        totalPawns: result.recruit.totalOwnPawns,
        cost: result.recruit.goldCost,
        remainingGold: result.recruit.remainingGold,
        population: result.recruit.currentPopulation
      },
      responseOpcode: 92,
      finalState: 'SAVED_DB'
    });

    log(`[BARRACKS #${state.id}] Recrutados ${req.ownPawns} soldados (template ${req.tempateId}) com sucesso! Custo: ${result.recruit.goldCost} ouro.`);
  } catch (err) {
    log(`[BARRACKS #${state.id}] Falha ao recrutar tropas: ${err.message}`);
    recorder.recordServerOutcome({
      category: 'barracks',
      handler: 'handleArmyRecruit',
      validations: 'failed',
      error: err.message,
      finalState: 'REJECTED'
    });
  }
}

async function handleChallengeInfo(state) {
  if (!state.gatewayId || state.closed) return;
  const grade = Number(state.character?.grade || 16);
  const saved = inventoryState.parseState(state.character?.state_json);
  const arena = saved.arena || {};
  const today = new Date().toISOString().slice(0, 10);
  const dailyChallenges = arena.day === today ? (Number(arena.dailyChallenges) || 0) : 0;
  const lastWinCount = arena.day === today ? (Number(arena.lastWinCount) || 0) : 0;
  const curScore = Number(arena.curScore) || 100;
  const claimedChests = Array.isArray(arena.claimedChests) ? arena.claimedChests : [];

  // Lista oficial de 4 oponentes NPCs de sistema com nível e FC compatíveis
  const challengeMsg = {
    simplePlayer: [
      {
        userId: 90001,
        nickName: 'Gladiador de Elite',
        grades: Math.max(1, grade - 1),
        job: 1,
        sexs: 1,
        pics: 1,
        fightingCapacity: Math.max(1000, Math.floor(grade * 90)),
        challengeRank: 1500,
        challengeScore: 100,
        isExist: 1
      },
      {
        userId: 90002,
        nickName: 'Atirador Espectral',
        grades: grade,
        job: 2,
        sexs: 1,
        pics: 1,
        fightingCapacity: Math.max(1050, Math.floor(grade * 95)),
        challengeRank: 1450,
        challengeScore: 120,
        isExist: 1
      },
      {
        userId: 90003,
        nickName: 'Mago Rúnico',
        grades: grade,
        job: 3,
        sexs: 2,
        pics: 2,
        fightingCapacity: Math.max(1100, Math.floor(grade * 100)),
        challengeRank: 1400,
        challengeScore: 140,
        isExist: 1
      },
      {
        userId: 90004,
        nickName: 'Paladino Real',
        grades: grade + 1,
        job: 1,
        sexs: 1,
        pics: 1,
        fightingCapacity: Math.max(1200, Math.floor(grade * 110)),
        challengeRank: 1350,
        challengeScore: 160,
        isExist: 1
      }
    ],
    avater: [
      { userId: 90001, armTempId: 101101, clothTempId: 101201 },
      { userId: 90002, armTempId: 102101, clothTempId: 102201 },
      { userId: 90003, armTempId: 103101, clothTempId: 103201 },
      { userId: 90004, armTempId: 101101, clothTempId: 101201 }
    ],
    challengeLog: [],
    lastWinCount: lastWinCount,
    challengeCount: dailyChallenges,
    totalCount: 10,
    curScore: curScore,
    winCountReward: claimedChests.length ? String(claimedChests[claimedChests.length - 1]) : '',
    nextRefreshTime: 0,
    freeRefreshTimes: 5,
    payRefreshTimes: 0,
    totalBuyCount: 0
  };
  sendGameSession(state, 4169, originalPb.encode('simple.ChallengeInfoMsg', challengeMsg));
  sendGameSession(state, 4176, originalPb.encode('player.ChallengeCoolTimeMsg', { coolTime: 0 }));
  log(`[ARENA #${state.id}] Opcode 4169 (ChallengeInfoMsg) enviado: ${dailyChallenges}/10 desafios, ${lastWinCount} vitorias, score ${curScore}.`);
}

async function handleChallenge(state, body) {
  if (!state.gatewayId || state.closed) return;
  let req;
  try {
    req = originalPb.decode('player.ChallengeMsg', body);
  } catch (e) {
    req = { tarUserId: 90001, tarArmyId: 0 };
  }
  log(`[ARENA #${state.id}] Desafio requisitado contra userId=${req?.tarUserId || 90001}`);

  // Recompensas da Arena Solo autênticas: Ouro, XP e Insígnia (208001)
  const arenaXp = 2500;
  const arenaGold = 1500;
  const arenaInsignia = 10;
  const today = new Date().toISOString().slice(0, 10);

  const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
    // Adicionar Insígnia da Arena legítima
    inventoryState.addItem(saved, 208001, arenaInsignia);

    // Atualizar dados de Arena diários
    if (!saved.arena || saved.arena.day !== today) {
      saved.arena = {
        day: today,
        dailyChallenges: 0,
        lastWinCount: 0,
        curScore: saved.arena?.curScore || 100,
        claimedChests: []
      };
    }
    saved.arena.dailyChallenges = (saved.arena.dailyChallenges || 0) + 1;
    saved.arena.lastWinCount = (saved.arena.lastWinCount || 0) + 1;
    saved.arena.curScore = (saved.arena.curScore || 100) + 30;

    // Atualizar progresso e carteira
    if (!saved.wallet) saved.wallet = { gold: 0, balens: 0, boundBalens: 0 };
    saved.wallet.gold = (saved.wallet.gold || 0) + arenaGold;

    if (!saved.progression) saved.progression = { currentXp: 0, totalXp: 0 };
    saved.progression.totalXp = (saved.progression.totalXp || 0) + arenaXp;
    const newGrade = resourceState.calcGradeFromXp(saved.progression.totalXp, locked.grade || 16);
    const atLevel = resourceState.totalAtLevel(newGrade);
    saved.progression.currentXp = Math.max(0, saved.progression.totalXp - atLevel);

    // Atualizar missões do tipo 35 (Arena Solo: "O Desafio", Quests 188 / 949)
    const activeQuests = saved.quests?.active || {};
    const updatedQuests = [];
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
    for (const [qId, q] of Object.entries(activeQuests)) {
      if (Number(qId) === 188 || Number(qId) === 949 || (q.templateId === 188 || q.templateId === 949)) {
        q.condition_1 = (Number(q.condition_1) || 0) + 1;
        if (q.condition_1 >= 1) {
          q.isComplete = true;
          q.completedDate = nowStr;
        }
        updatedQuests.push({ ...q });
      }
    }

    return {
      state: saved,
      resources: { gold: saved.wallet.gold, grade: newGrade, experience: saved.progression.totalXp },
      updatedQuests
    };
  });

  state.character.state_json = result.state;
  state.character.gold = result.resources.gold;
  state.character.experience = result.resources.experience;
  state.character.grade = result.resources.grade;

  // Notificar resultado do desafio e cooldown
  sendGameSession(state, 4176, originalPb.encode('player.ChallengeCoolTimeMsg', { coolTime: 0 }));
  
  // Atualizar desafio info
  await handleChallengeInfo(state);

  // Sincronizar jogador e inventário
  sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
  sendInventorySnapshot(state);

  // Sincronizar missões concluídas (Opcode 112)
  if (result.updatedQuests && result.updatedQuests.length > 0) {
    sendGameSession(state, 112, originalPb.encode('quest.QuestUpdatedRspMsg',
      questState.formatQuestUpdatedProtocol(result.state, result.updatedQuests)));
    log(`[ARENA #${state.id}] Missao da Arena "O Desafio" atualizada e sincronizada via Opcode 112!`);
  }
}

async function handleChallengeReward(state, body) {
  if (!state.gatewayId || state.closed) return;
  const req = originalPb.decode('simple.ChallengeRewardReq', body);
  const rewardId = Number(req.rewardId);
  log(`[ARENA #${state.id}] Requisicao de bau de vitorias: rewardId=${rewardId}`);
  const reqWins = { 2001: 10, 2002: 20, 2003: 35, 2004: 50 }[rewardId];
  if (!reqWins) return;

  const result = await db.mutateCharacterState(state.gatewayId, saved => {
    saved.arena = saved.arena || {};
    saved.arena.claimedChests = Array.isArray(saved.arena.claimedChests) ? saved.arena.claimedChests : [];
    if (saved.arena.claimedChests.includes(rewardId)) return { state: saved, duplicate: true };
    if ((saved.arena.lastWinCount || 0) < reqWins) return { state: saved, notEnough: true };

    saved.arena.claimedChests.push(rewardId);
    if (rewardId === 2001) inventoryState.addItem(saved, 208001, 50);
    else if (rewardId === 2002) inventoryState.addItem(saved, 208001, 100);
    else if (rewardId === 2003) inventoryState.addItem(saved, 208001, 150);
    else if (rewardId === 2004) {
      inventoryState.addItem(saved, 208001, 200);
      inventoryState.addItem(saved, 2032201, 1);
    }
    return { state: saved };
  });

  state.character.state_json = result.state;
  await handleChallengeInfo(state);
  sendInventorySnapshot(state);
}

async function handleTakeChallengeReward(state, body) {
  if (!state.gatewayId || state.closed) return;
  const result = await db.mutateCharacterState(state.gatewayId, saved => {
    saved.arena = saved.arena || {};
    saved.arena.claimedDailyRankReward = true;
    if (!saved.wallet) saved.wallet = { gold: 0, balens: 0, boundBalens: 0 };
    saved.wallet.gold += 100000;
    inventoryState.addItem(saved, 208001, 30);
    return { state: saved };
  });
  state.character.state_json = result.state;
  sendGameSession(state, 4243, originalPb.encode('player.ChallengeRankRewardMsg', { isTake: true }));
  sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
  sendInventorySnapshot(state);
}

async function handleArmyUpgrade(state, body) {
  if (!state.gatewayId || state.closed) return;
  let req;
  try {
    req = originalPb.decode('army.ArmyPawnInfoMsg', body);
    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
      const upgradeRes = barracksState.upgradePawn(saved, req.tempateId);
      return {
        state: saved,
        upgrade: upgradeRes,
        resources: {
          gold: upgradeRes.remainingGold,
          grade: Number(locked.grade || state.character?.grade || 5),
          experience: Number(locked.experience || 0)
        }
      };
    });
    state.character = await db.characterById(state.gatewayId);

    // Envia opcode 116 (U_C_PAWN_INFO) com novo template
    sendGameSession(state, 116, originalPb.encode('army.ArmyPawnInfoMsg', {
      tempateId: result.upgrade.newTemplateId,
      sonType: result.upgrade.sonType,
      blessNum: 0,
      pawnLive: barracksState.makeDefaultPawnLive(),
      specialTempIds: '',
      comprehednTempIds: ''
    }));

    // Envia atualização de tropas 92 e 100 com pawnLive canônico
    const pawnMsg = barracksState.formatArmyPawnUpdatedMsg(result.state, state.gatewayId);
    sendGameSession(state, 92, originalPb.encode('army.ArmyPawnUpdatedMsg', pawnMsg));
    sendGameSession(state, 100, originalPb.encode('army.ArmyPawnUpdatedMsg', pawnMsg));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

    if (result.upgrade.questsChanged && result.upgrade.updatedQuests?.length > 0) {
      sendGameSession(state, 112, originalPb.encode('quest.QuestUpdatedRspMsg', questState.formatQuestUpdatedProtocol(state.character.state_json, result.upgrade.updatedQuests)));
      log(`[BARRACKS #${state.id}] Missão atualizada após evolução de tropa: [${result.upgrade.updatedQuests.map(q => q.templateId).join(', ')}]`);
    }

    recorder.recordServerOutcome({
      category: 'barracks',
      handler: 'handleArmyUpgrade',
      validations: 'passed',
      persistentChanges: {
        oldTemplateId: req.tempateId,
        newTemplateId: result.upgrade.newTemplateId,
        newLevel: result.upgrade.newLevel
      },
      responseOpcode: 116,
      finalState: 'SAVED_DB'
    });
    log(`[BARRACKS #${state.id}] Tropa ${result.upgrade.sonType} evoluída com sucesso para o Nível ${result.upgrade.newLevel} (Template ${result.upgrade.newTemplateId})!`);
  } catch (err) {
    log(`[BARRACKS #${state.id}] Falha ao evoluir tropa: ${err.message}`);
    recorder.recordServerOutcome({
      category: 'barracks',
      handler: 'handleArmyUpgrade',
      validations: 'failed',
      error: err.message,
      finalState: 'REJECTED'
    });
  }
}

async function handleArmyEdit(state, body) {
  if (!state.gatewayId || state.closed) return;
  let req;
  try {
    req = originalPb.decode('army.ArmyPawnInfoMsg', body);
    const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
      const editRes = barracksState.editArmyPawn(saved, req.sites, req.tempateId, req.ownPawns);
      return {
        state: saved,
        edit: editRes
      };
    });
    state.character = await db.characterById(state.gatewayId);

    const editRsp = barracksState.formatArmyEditRspMsg(result.state, state.gatewayId);
    sendGameSession(state, 93, originalPb.encode('army.ArmyEditRspMsg', editRsp));
    sendGameSession(state, 5156, originalPb.encode('army.ArmyEditRspMsg', editRsp));

    const updatedArmy = heroState.armyInfo(state.character);
    sendGameSession(state, 169, originalPb.encode('army.ArmyUpdatedGridMsg', { updatedArmy: [updatedArmy] }));

    if (result.edit?.questsChanged && result.edit?.updatedQuests?.length > 0) {
      sendGameSession(state, 112, originalPb.encode('quest.QuestUpdatedRspMsg', questState.formatQuestUpdatedProtocol(state.character.state_json, result.edit.updatedQuests)));
    }

    recorder.recordServerOutcome({
      category: 'barracks',
      handler: 'handleArmyEdit',
      validations: 'passed',
      persistentChanges: {
        templateId: req.tempateId,
        sites: req.sites,
        ownPawns: req.ownPawns
      },
      responseOpcode: 93,
      finalState: 'SAVED_DB'
    });

    log(`[BARRACKS #${state.id}] Formação de tropas editada: template=${req.tempateId}, sites=${req.sites}, tropas=${req.ownPawns}.`);
  } catch (err) {
    log(`[BARRACKS #${state.id}] Falha ao editar formação de tropas: ${err.message}`);
  }
}

async function handleArmyPosEdit(state, body) {
  if (!state.gatewayId || state.closed) return;
  let req;
  try {
    req = originalPb.decode('army.ArmyFightPosEditMsg', body);
    const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
      if (!saved.hero) saved.hero = {};
      saved.hero.fightPos = Number(req.heroPos || 1);
      if (saved.army && saved.army.pawns) {
        for (const p of Object.values(saved.army.pawns)) {
          p.fightPos = Number(req.pawnPos || 1);
        }
      }
      return { state: saved };
    });
    state.character = await db.characterById(state.gatewayId);

    sendGameSession(state, 8276, originalPb.encode('army.ArmyFightPosEditMsg', req));
    const updatedArmy = heroState.armyInfo(state.character);
    sendGameSession(state, 169, originalPb.encode('army.ArmyUpdatedGridMsg', { updatedArmy: [updatedArmy] }));

    log(`[ARMY POS #${state.id}] Posição de combate ajustada: herói=${req.heroPos}, tropa=${req.pawnPos}.`);
  } catch (err) {
    log(`[ARMY POS #${state.id}] Falha ao ajustar posição de combate: ${err.message}`);
  }
}

async function handleArmyDemob(state, body) {
  if (!state.gatewayId || state.closed) return;
  let req;
  try {
    req = originalPb.decode('army.ArmyPawnInfoMsg', body);
    const templateId = Number(req.tempateId || req.templateId);
    const tpl = barracksState.getPawnTemplate(templateId);
    const sonType = tpl ? Number(tpl.SonType) : 101;
    const count = Number(req.ownPawns || 1);

    const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
      const dismissRes = barracksState.dismissPawn(saved, sonType, count);
      return {
        state: saved,
        dismiss: dismissRes
      };
    });
    state.character = await db.characterById(state.gatewayId);

    const pawnMsg = barracksState.formatArmyPawnUpdatedMsg(result.state, state.gatewayId);
    sendGameSession(state, 92, originalPb.encode('army.ArmyPawnUpdatedMsg', pawnMsg));
    sendGameSession(state, 100, originalPb.encode('army.ArmyPawnUpdatedMsg', pawnMsg));

    const updatedArmy = heroState.armyInfo(state.character);
    sendGameSession(state, 169, originalPb.encode('army.ArmyUpdatedGridMsg', { updatedArmy: [updatedArmy] }));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

    log(`[BARRACKS #${state.id}] Tropa ${templateId} dispensada: ${count} unidades removidas (restante: ${result.dismiss.remainingPawns}). Opcodes 92, 100, 169 enviados.`);
  } catch (err) {
    log(`[BARRACKS #${state.id}] Falha ao dispensar tropa: ${err.message}`);
  }
}

function sendCloudScene(state,char,position){
  const hero=heroState.heroInfo(char);
  const app=heroState.appearance(char);
  const vip=getCharacterVip(char);
  const roomPlayer={roomId:cityState.CLOUD,count:1,currentRoomIndex:1,playerState:0,
    heroId:char.id,playerId:char.id,grades:char.grade,nickName:char.nickname,
    sex:char.sex,templateId:hero.tempateId,headId:hero.headId,
    arm:app.arm||'',cloth:app.cloth||'',wing:app.wing||'',armyId:char.id,
    fightingCapacity:hero.fightingCapacity,curPosX:position.x,curPosY:position.y,
    campaignId:cityState.CLOUD,onlineState:1,job:char.job||1,hp:hero.hp,maxHp:hero.hp,
    isVip:vip.isVip,vipType:vip.vipType};
  sendGameSession(state,4595,originalPb.encode('room.RoomEnterMsg',
    {result:0,player:[roomPlayer],userIds:[char.id]}));
  sendGameSession(state,113,originalPb.encode('army.SimpleHeroInfoMsg',hero));
  sendGameSession(state,169,originalPb.encode('army.ArmyUpdatedGridMsg',
    {updatedArmy:[heroState.armyInfo(char)]}));
}
// Atol: emite a mesma cena SPACE que a Cidade das Nuvens, mas com o MapId REAL.
// O cliente requer o ajuste restrito no bundle para nao sobrescrever campaignId com 10000.
// O Atol tem t_s_map.Types=1 e t_s_campaign.CampaignId=20000.
// Portanto deve abrir CAMPAIGN_MAP_SCENE (opcode 125), nao SPACE_SCENE (4595).
// O modelo e o mesmo fluxo do campaign-state.enterCampaign, sem criar recompensas.
function sendSylphAtollScene(state, char, position) {
  const mapId = Number(position.mapId);
  if (!sylphAtoll.isAtollMap(mapId)) throw Error('Mapa fora do Atol dos Silfos');
  const map = sylphAtoll.getAtollMap(mapId);
  if (Number(map.Types) !== 1 || Number(map.CampaignId) !== 20000) {
    throw Error('Catalogo do Atol diverge: esperado Types=1/CampaignId=20000');
  }
  const nodes = campaignState.getNodesForMap(mapId);
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw Error(`Atol ${mapId} sem nos de campanha; nao enviar cena incompleta`);
  }
  const hero = heroState.heroInfo(char);
  const app = heroState.appearance(char);
  const player = {
    roomId: Number(char.id),count:1,currentRoomIndex:0,playerState:2,
    heroId:Number(char.id),playerId:Number(char.id),grades:Number(char.grade),
    nickName:char.nickname,sex:Number(char.sex),templateId:Number(hero.tempateId),
    arm:app.arm||'',cloth:app.cloth||'',wing:app.wing||'',
    armyId:Number(char.id),curPosX:Number(position.x),curPosY:Number(position.y),
    campaignId:mapId,onlineState:true,armyState:0,teamId:1,
    headId:Number(hero.headId)||0,hp:Number(hero.hp)||0,maxHp:Number(hero.hp)||0,
    serverName:'',consortiaName:'',hide:false,hat:'',fashionArm:'',fashionCloth:''
  };
  const room = {
    roomId:Number(char.id),campaignId:mapId,masterId:Number(char.id),
    name:map.MapName_pt||map.MapName_en||'Atol dos Silfos',count:1,capacity:1,
    roomState:1,roomType:0,isSetPassword:false,roomPlayer:[player],masterServerName:''
  };
  const patrolLayout=atollPatrol.createLayout(nodes,n=>campaignState.formatNodeData(atollEncounters.normalizedMonster(n),[]));
  const nodeData=patrolLayout.nodes;
  sendGameSession(state,125,originalPb.encode('room.RoomCreatedMsg',{
    createdType:1,room,isCross:false,campignId:20000
  }));
  sendGameSession(state,21,originalPb.encode('room.RoomEnterMsg',{
    result:1,player:[player],userIds:[Number(char.id)]
  }));
  sendGameSession(state,127,originalPb.encode('campaign.CampaignNodeListMsg',{
    node:nodeData
  }));
  sendGameSession(state,6,buildLoginStateBody(state.gatewayId,4));
  const savedAtoll=typeof char.state_json==='string'?JSON.parse(char.state_json):(char.state_json||{});
  sendGameSession(state,4643,originalPb.encode('campaign.PetLandRewardMsg',{
    rewardTimes:atollEncounters.rewardTimes(savedAtoll)
  }));
  beginSylphAtollPatrol(state,mapId,patrolLayout);
  log(`[SYLPH ATOLL SCENE #${state.id}] CAMPAIGN_MAP_SCENE; campanha=20000 mapa=${mapId}, nodes=${nodes.length}; contador 4643 enviado.`);
}

function ensureSylphAtollCampaignState(saved, mapId, position) {
  campaignState.ensureCampaignState(saved,Number(saved.hero?.grade)||Number(saved.grade)||50);
  saved.campaigns.current={
    campaignId:20000,mapId:Number(mapId),
    position:{x:Number(position.x),y:Number(position.y)},
    enteredAt:Date.now(),runWonNodes:[]
  };
  return saved;
}

async function exitSylphAtollToCloud(state) {
  const left=await db.mutateCharacterState(state.gatewayId,saved=>{
    const result=sylphAtoll.leave(saved,cityState.CLOUD);
    if(Number(result.state.campaigns?.current?.campaignId)===20000)
      result.state.campaigns.current=null;
    return result;
  });
  state.character=await db.characterById(state.gatewayId);
  stopSylphAtollPatrol(state);
  sendGameSession(state,22,originalPb.encode('campaign.CampaignExitMsg',{
    result:1,playerId:Number(state.gatewayId),armyId:1,
    serverName:'',userIds:[Number(state.gatewayId)]
  }));
  sendGameSession(state,15,originalPb.encode('room.RoomExitRspMsg',{
    playerId:Number(state.gatewayId)
  }),Number(state.gatewayId));
  if (Number(state.character.grade) < 15) {
    sendGameSession(state,6,buildLoginStateBody(state.gatewayId,2));
  } else {
    sendGameSession(state,4598,originalPb.encode('simple.PropertyMsg',{
      param1:cityState.CLOUD
    }));
    sendCloudScene(state,state.character,left.position);
  }
  log(`[SYLPH ATOLL EXIT #${state.id}] Retorno concluido: grade=${state.character.grade}, pos=${left.position.x},${left.position.y}.`);
}

async function handlePlayerSpaceEnter(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    if(state.cloudRestoreTimer){clearTimeout(state.cloudRestoreTimer);state.timers?.delete(state.cloudRestoreTimer);state.cloudRestoreTimer=null;}
    state.cloudRestorePosition=null;
    const savedBefore = inventoryState.parseState(state.character.state_json);
    // [R8-FIX] Se o jogador está no Atol mas clicou em "Cidade das Nuvens" (8688),
    // NÃO forçar retorno ao Atol. Decodificar body para identificar destino.
    if (sylphAtoll.isAtollMap(savedBefore.position?.mapId)) {
      let requestedMap = 0;
      try {
        if (body && body.length) {
          const req = originalPb.decode('simple.PropertyMsg', body);
          requestedMap = Number(req.param1 || 0);
        }
      } catch(e) { /* body opcional */ }

      // Se jogador pediu Cloud City explicitamente (ou sem body = reconexão via Cloud),
      // tirá-lo do Atol e enviar para Cloud City
      if (requestedMap === cityState.CLOUD || requestedMap === 0) {
        log(`[SPACE #${state.id}] Jogador no Atol (${savedBefore.position.mapId}) solicitou Cloud City. Saindo do Atol...`);
        await exitSylphAtollToCloud(state);
        return;
      }
      // Se requestedMap é um mapa do Atol = reconexão dentro do Atol
      const atollMap = sylphAtoll.getAtollMap(savedBefore.position.mapId);
      if (Number(state.character.grade) < Number(atollMap.MinLevel)) throw Error('Nivel insuficiente para retomar Atol dos Silfos');
      const current=savedBefore.campaigns?.current;
      if(Number(current?.campaignId)!==20000 || Number(current?.mapId)!==Number(savedBefore.position.mapId)) {
        await db.mutateCharacterState(state.gatewayId,saved=>({
          state:ensureSylphAtollCampaignState(saved,saved.position.mapId,saved.position)
        }));
        state.character=await db.characterById(state.gatewayId);
      }
      sendSylphAtollScene(state,state.character,savedBefore.position);
      state.heroSent = true;
      state.sceneStateSent = true;
      state.worldRequested = true;
      sendInventorySnapshot(state);
      log(`[SYLPH ATOLL #${state.id}] Cena retomada no mapa ${atollMap.Id}, pos=${savedBefore.position.x},${savedBefore.position.y}.`);
      return;
    }
    const result = await db.mutateCharacterState(state.gatewayId,cityState.enterCloud);
    stopSylphAtollPatrol(state);
    state.character = await db.characterById(state.gatewayId);
    sendCloudScene(state,state.character,result.position);

    state.heroSent = true;
    state.sceneStateSent = true;
    state.worldRequested = true;
    sendInventorySnapshot(state);

    log(`[SPACE #${state.id}] Entrada na Cidade das Nuvens ${result.position.x},${result.position.y} persistida; pacote 4595 emitido.`);
  } catch (err) {
    log(`[SPACE #${state.id}] Falha ao entrar na Cidade das Nuvens: ${err.message}`);
  }
}

async function handlePlayerSpaceLeave(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const savedBefore = inventoryState.parseState(state.character.state_json);
    if (sylphAtoll.isAtollMap(savedBefore.position?.mapId)) {
      await exitSylphAtollToCloud(state);
      return;
    }
    // [R8-FIX] Ao sair da Cidade das Nuvens, retornar para o Castelo (cena 2),
    // NÃO para Wild (mapa 5) que requer nível 20 e quest 52.
    await db.mutateCharacterState(state.gatewayId, (saved) => {
      if (Number(saved.position?.mapId) !== cityState.CLOUD)
        throw Error('Personagem nao esta na Cidade das Nuvens');
      // Restaurar posição para o Castelo (sem mapId, cliente usa cena Castle)
      saved.position = { mapId: 0, x: 0, y: 0 };
      return { state: saved };
    });
    state.character = await db.characterById(state.gatewayId);

    // Enviar cena 2 (Castle) em vez de CampaignExitMsg com targetMapId: 5
    sendGameSession(state, 6, buildLoginStateBody(state.gatewayId, 2));
    sendGameSession(state, 169, originalPb.encode('army.ArmyUpdatedGridMsg', { updatedArmy: [heroState.armyInfo(state.character)] }));

    log(`[SPACE #${state.id}] Saída da Cidade das Nuvens confirmada; retorno para Castelo (cena 2).`);
  } catch (err) {
    log(`[SPACE #${state.id}] Falha ao sair da Cidade das Nuvens: ${err.message}`);
  }
}

async function handlePlayerSpaceMove(state, body) {
  if (!state.gatewayId || state.closed) return;
  try {
    const moveReq = originalPb.decode('campaign.SpacePlayerMoveMsg', body);
    const savedBefore = inventoryState.parseState(state.character.state_json);
    if (sylphAtoll.isAtollMap(savedBefore.position?.mapId)) {
      const map = sylphAtoll.getAtollMap(savedBefore.position.mapId);
      const moved = await db.mutateCharacterState(state.gatewayId,
        saved => sylphAtoll.move(saved,state.gatewayId,moveReq,map));
      state.character.state_json=moved.state;
      log(`[SYLPH ATOLL MOVE #${state.id}] Mapa ${map.Id}, posicao ${moved.position.x},${moved.position.y} persistida.`);
      return;
    }
    const result=await db.mutateCharacterState(state.gatewayId,saved=>cityState.moveCloud(saved,state.gatewayId,moveReq));
    state.character.state_json=result.state;
    // The local actor has already started this path. Sending its path back via
    // 4594 makes the client start it again, which emits another 8690 on every
    // movement tick and creates an endless, seemingly random route.
    log(`[SPACE MOVE #${state.id}] Posicao Cloud ${result.position.x},${result.position.y} persistida sem eco ao proprio jogador.`);
  } catch (err) {
    log(`[SPACE MOVE #${state.id}] Falha ao movimentar na Cidade das Nuvens: ${err.message}`);
  }
}

async function handlePlayerSpaceNodeTrigger(state,body){
  if(!state.gatewayId||state.closed)return;
  try{
    const request=originalPb.decode('simple.PropertyMsg',body);
    const saved=inventoryState.parseState(state.character.state_json);
    if (Number(request.param1) === 5) {
      const arrival=sylphAtoll.resolveArrival(campaignState.nodeById);
      const nodes=campaignState.getNodesForMap(arrival.mapId);
      if (!Array.isArray(nodes) || !nodes.some(n=>Number(n.Id)===Number(arrival.targetNodeId)))
        throw Error(`Atol ${arrival.mapId} sem no ${arrival.targetNodeId} no t_s_campaigndata`);
      const joined=await db.mutateCharacterState(state.gatewayId,(saved,locked) => {
        const res=sylphAtoll.enter(saved,Number(locked.grade),arrival);
        return {state:ensureSylphAtollCampaignState(res.state,arrival.mapId,res.position),
          position:res.position};
      });
      state.character=await db.characterById(state.gatewayId);
      sendSylphAtollScene(state,state.character,joined.position);
      log(`[SYLPH ATOLL #${state.id}] Portal 5: Cloud 10000 -> mapa ${arrival.mapId}, no ${arrival.targetNodeId}, pos=${joined.position.x},${joined.position.y}.`);
      return;
    }
    const npc=cityState.triggerCloudNpc(saved,Number(request.param1));
    sendGameSession(state,4601,originalPb.encode('simple.PropertyMsg',{param1:npc.id}));
    log(`[SPACE NPC #${state.id}] Dialogo Cloud NPC ${npc.id} (${npc.name}) confirmado.`);
  }catch(error){log(`[SPACE NPC #${state.id}] Interacao rejeitada: ${error.message}`)}
}
async function handleWildBossInfo(state, body) {
  await handleMapBossDatas(state, body);
}
function handleShopData(state){
  if(!state.gatewayId||state.closed)return;
  const saved=inventoryState.parseState(state.character.state_json);
  sendGameSession(state,4238,originalPb.encode('shop.ShopMainRspMsg',shopP0.shopMainPayload(saved)));
  const today=new Date().toISOString().slice(0,10);
  const hasDataInfo=shopP0.limited.filter(good=>shopP0.limitedCount(saved,good.id)>0)
    .map(good=>({userId:state.gatewayId,itemId:good.id,
      counts:shopP0.limitedCount(saved,good.id),buyDate:today+' 00:00:00',isDiscount:true}));
  const weeklyDataInfo = saved.shop?.weekly
    ? Object.entries(saved.shop.weekly).map(([id, counts]) => ({
        userId: state.gatewayId,
        itemId: Number(id),
        counts: Number(counts),
        buyDate: today + ' 00:00:00',
        isDiscount: false
      }))
    : [];
  sendGameSession(state,4145,originalPb.encode('shop.ShopMsg',
    {hasDataInfo,weeklyDataInfo,monthDataInfo:[],refreshDate:today+' 00:00:00'}));
}
async function handleShopBuy(state, body, fashion=false) {
  if (!state.gatewayId || state.closed) return;
  let req;
  try {
    req = originalPb.decode(fashion?'shop.FashionShopMsg':'shop.ShopMsg', body);
    const requestedBuy=fashion?req.buyInfos?.[0]:req.buyInfo;
    const goodId = requestedBuy?.goodId || 0;
    const count = requestedBuy?.count || 1;
    const payType = req.payType || 0;
    if(fashion&&!shopP0.fashionIds.has(Number(goodId)))throw Error('Item fora da área de moda P0');

    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
      const buyRes = shopState.buyShopItem(saved, goodId, count, payType);
      return {
        state: saved,
        buy: buyRes,
        resources: {
          gold: Number(saved.wallet?.gold || locked.gold || 0),
          grade: Number(locked.grade || state.character?.grade || 5),
          experience: Number(locked.experience || 0)
        }
      };
    });
    state.character = await db.characterById(state.gatewayId);

    if(fashion)sendGameSession(state,4486,originalPb.encode('shop.FashionShopMsg',
      {buyInfos:[{goodId,count,receiveId:state.gatewayId,result:true}],result:1,payType}));
    else sendGameSession(state, 90, originalPb.encode('shop.ShopMsg', shopState.formatShopBuyRspMsg(goodId, count, true)));
    if (result.buy?.newItem) {
      const moved = [{ bagType: 1, objectId: 0, ownerId: state.gatewayId, pos: result.buy.newItem.pos, item: result.buy.newItem }];
      sendGameSession(state, 115, makeBagMoveUpdate(moved), state.gatewayId);
    } else {
      sendInventorySnapshot(state);
    }
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    if(shopP0.limitedIds.has(Number(goodId)))handleShopData(state);

    recorder.recordServerOutcome({
      category: 'shop',
      handler: 'handleShopBuy',
      validations: 'passed',
      persistentChanges: {
        goodId,
        count,
        currency: result.buy.currency,
        cost: result.buy.totalCost,
        remainingBalance: result.buy.remainingBalance,
        newItemInstanceId: result.buy.newItem.instanceId
      },
      responseOpcode: fashion?4486:90,
      finalState: 'SAVED_DB'
    });

    log(`[SHOP #${state.id}] Compra realizada com sucesso: GoodId ${goodId} (x${count}). Custo: ${result.buy.totalCost} ${result.buy.currency}.`);
  } catch (err) {
    log(`[SHOP #${state.id}] Falha na compra da loja: ${err.message}`);
    recorder.recordServerOutcome({
      category: 'shop',
      handler: 'handleShopBuy',
      validations: 'failed',
      error: err.message,
      finalState: 'REJECTED'
    });
  }
}

async function handleItemCompose(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req;
  try {
    req = originalPb.decode('store.StoreReqMsg', body);
  } catch (err) {
    log(`[COMPOSE #${state.id}] Pedido 89/5153 invalido: ${err.message}`);
    return;
  }

  const composeId = req.composeId || 0;
  const composeNum = Math.max(1, req.composeNum || 1);

  try {
    const result = await db.mutateCharacterState(state.gatewayId, async (raw, locked = {}) => {
      const original = inventoryState.parseState(raw);
      const bag = inventoryState.inventory(original);
      original.wallet = original.wallet || { gold: Number(locked.gold || 0), balens: 0, boundBalens: 0 };
      
      const grade = Number(locked.grade || state.character.grade || 1);

      const composeRes = await itemRepository.executeCompose({
        characterId: state.gatewayId,
        characterGrade: grade,
        characterWallet: original.wallet,
        inventoryBag: bag,
        composeId,
        composeNum
      });

      return {
        state: original,
        compose: composeRes,
        resources: {
          gold: Number(original.wallet.gold),
          grade,
          experience: Number(locked.experience || 0)
        }
      };
    });

    state.character = await db.characterById(state.gatewayId);

    // 1. Sincronizar movimentação na bolsa (opcode 115)
    if (result.compose?.moved?.length > 0) {
      sendGameSession(state, 115, makeBagMoveUpdate(result.compose.moved), state.gatewayId);
    }

    // 2. Enviar resposta do compose (opcode 89 e 5153 para compatibilidade com listeners do cliente)
    const rspMsg = {
      composeResult: true,
      composeTemplateId: result.compose.newItem.templateId,
      pos: result.compose.newItem.pos,
      bagType: 1,
      objectId: 0
    };
    const encodedRsp = originalPb.encode('store.StoreRspMsg', rspMsg);
    sendGameSession(state, 89, encodedRsp);
    sendGameSession(state, 5153, encodedRsp);

    // 3. Atualizar ouro do jogador (opcode 3)
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

    recorder.recordServerOutcome({
      category: 'forge',
      handler: 'handleItemCompose',
      validations: 'passed',
      persistentChanges: {
        composeId,
        composeNum,
        outputTemplateId: result.compose.newItem.templateId,
        outputInstanceId: result.compose.newItem.instanceId,
        costGold: result.compose.totalGoldCost,
        remainingGold: result.compose.remainingGold,
        transactionUuid: result.compose.transactionUuid
      },
      responseOpcode: 89,
      finalState: 'SAVED_DB'
    });

    log(`[COMPOSE #${state.id}] Sintese concluida: Receita ${composeId} (x${composeNum}) -> Item ${result.compose.newItem.templateId}. Custo: ${result.compose.totalGoldCost} ouro. Tx: ${result.compose.transactionUuid}`);
  } catch (err) {
    log(`[COMPOSE #${state.id}] Falha na sintese: ${err.message}`);
    try {
      const failRsp = {
        composeResult: false,
        composeTemplateId: 0,
        pos: 0,
        bagType: 1,
        objectId: 0
      };
      const encodedFail = originalPb.encode('store.StoreRspMsg', failRsp);
      sendGameSession(state, 89, encodedFail);
      sendGameSession(state, 5153, encodedFail);
    } catch (_) {}

    recorder.recordServerOutcome({
      category: 'forge',
      handler: 'handleItemCompose',
      validations: 'failed',
      error: err.message,
      finalState: 'REJECTED'
    });
  }
}

// ==========================================
// SISTEMA DE ASTROLOGIA (ASTRALS) — OFICIAL WARTUNE
// ==========================================
async function handleStarRand(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req = {};
  try {
    if (body && body.length > 0) req = originalPb.decode('star.StarRandReqMsg', body);
  } catch (e) {
    log(`[STAR RAND #${state.id}] Decodificacao: ${e.message}`);
  }

  const site = Number(req.site !== undefined ? req.site : 0);
  try {
    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
      astralState.ensureAstralState(saved);
      const currentGold = Number(locked.gold !== undefined ? locked.gold : (saved.wallet?.gold || 0));
      
      let targetSite = site;
      if (targetSite < 0 || targetSite > 4) {
        for (let s = 4; s >= 0; s--) {
          if (saved.astrals.spheres[s] === 1) { targetSite = s; break; }
        }
      }

      const outcome = astralState.rollSphereCapture(saved, targetSite, currentGold);
      const newGold = Math.max(0, currentGold - outcome.goldCost);
      if (saved.wallet) saved.wallet.gold = newGold;
      saved.gold = newGold;

      const resObj = {
        state: saved,
        outcome,
        newGold
      };
      if (['v095', 'v096', 'v097'].includes(saved.creation?.version)) {
        resObj.resources = {
          gold: newGold,
          grade: Number(locked.grade || state.character.grade || 1),
          experience: Number(locked.experience !== undefined ? locked.experience : 0)
        };
      }
      return resObj;
    });

    state.character.state_json = result.state;
    state.character = await db.characterById(state.gatewayId);

    const starRandPayload = astralState.formatStarRandRspMsg(
      result.outcome.spheres,
      [result.outcome.astral],
      state.gatewayId
    );
    sendGameSession(state, 4180, originalPb.encode('star.StarRandRspMsg', starRandPayload));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

    log(`[STAR RAND #${state.id}] Esfera ${site} -> Astral ${result.outcome.astral.templateId} slot ${result.outcome.dropSite}. Ouro: ${result.newGold}`);
  } catch (err) {
    log(`[STAR RAND #${state.id}] Falha: ${err.message}`);
  }
}

async function handleStarPick(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req = {};
  try {
    req = originalPb.decode('star.StarPickReqMsg', body);
  } catch (e) {
    log(`[STAR PICK #${state.id}] Decodificacao: ${e.message}`);
    return;
  }

  const dropSite = Number(req.dropsite);
  const way = Number(req.way || 1);

  try {
    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
      astralState.ensureAstralState(saved);
      const currentGold = Number(locked.gold !== undefined ? locked.gold : (saved.wallet?.gold || 0));
      
      const outcome = astralState.pickAstral(saved, dropSite, way);
      const newGold = currentGold + (outcome.goldEarned || 0);
      if (saved.wallet) saved.wallet.gold = newGold;
      saved.gold = newGold;

      const resObj = {
        state: saved,
        outcome,
        newGold
      };
      if (outcome.goldEarned > 0 && ['v095', 'v096', 'v097'].includes(saved.creation?.version)) {
        resObj.resources = {
          gold: newGold,
          grade: Number(locked.grade || state.character.grade || 1),
          experience: Number(locked.experience !== undefined ? locked.experience : 0)
        };
      }
      return resObj;
    });

    state.character.state_json = result.state;
    state.character = await db.characterById(state.gatewayId);

    // Notifica exclusao dos drops temporarios (opcode 4179)
    const deletedSites = result.outcome.deletedDropSites || [dropSite];
    sendGameSession(state, 4179, originalPb.encode('star.StarRandRspMsg', {
      site: result.state.astrals?.spheres || [1, 0, 0, 0, 0],
      starRand: deletedSites.map(ds => ({ dropSite: ds }))
    }));

    // Se coletou para a mochila, envia S2C 4178 com todos os astrais transferidos
    if (result.outcome.picked && result.outcome.picked.length > 0) {
      sendGameSession(state, 4178, originalPb.encode('star.StarMoveRspMsg', {
        move: result.outcome.picked.map(p => ({
          changeType: 1, // Rm.PLAYER
          changePos: p.newPos,
          star_Info: astralState.formatStarInfo(p.astral, state.gatewayId)
        }))
      }));
    }

    if (result.outcome.goldEarned > 0) {
      sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    }

    log(`[STAR PICK #${state.id}] Slot ${dropSite} (${result.outcome.type}). Removidos ${deletedSites.length} itens. Ouro: ${result.newGold}`);
  } catch (err) {
    log(`[STAR PICK #${state.id}] Falha: ${err.message}`);
  }
}

async function handleStarMove(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req = {};
  try {
    req = originalPb.decode('star.StarMoveReqMsg', body);
  } catch (e) {
    log(`[STAR MOVE #${state.id}] Decodificacao: ${e.message}`);
    return;
  }

  try {
    const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
      const outcome = astralState.moveAstral(saved, state.character.grade, req);
      return { state: saved, outcome };
    });

    state.character.state_json = result.state;
    state.character = await db.characterById(state.gatewayId);

    const moves = [];
    if (result.outcome.type === 'move') {
      for (const d of result.outcome.deleted) {
        moves.push({ changeType: d.changeType, changePos: d.changePos, star_Info: null });
      }
      for (const m of result.outcome.moved) {
        moves.push({
          changeType: m.changeType,
          changePos: m.changePos,
          star_Info: {
            id: m.astral.id,
            templateId: m.astral.templateId,
            userId: state.gatewayId,
            objectId: 0,
            pos: m.changePos,
            exist: true,
            bagType: m.changeType,
            grade: m.astral.grade,
            gp: m.astral.gp,
            isLock: Boolean(m.astral.isLock)
          }
        });
      }
    } else if (result.outcome.type === 'swap') {
      for (const m of result.outcome.moved) {
        moves.push({
          changeType: m.changeType,
          changePos: m.changePos,
          star_Info: {
            id: m.astral.id,
            templateId: m.astral.templateId,
            userId: state.gatewayId,
            objectId: 0,
            pos: m.changePos,
            exist: true,
            bagType: m.changeType,
            grade: m.astral.grade,
            gp: m.astral.gp,
            isLock: Boolean(m.astral.isLock)
          }
        });
      }
    } else if (result.outcome.type === 'fuse') {
      moves.push({
        changeType: result.outcome.consumer.bagType,
        changePos: result.outcome.consumer.pos,
        star_Info: {
          id: result.outcome.consumer.id,
          templateId: result.outcome.consumer.templateId,
          userId: state.gatewayId,
          objectId: 0,
          pos: result.outcome.consumer.pos,
          exist: true,
          bagType: result.outcome.consumer.bagType,
          grade: result.outcome.consumer.grade,
          gp: result.outcome.consumer.gp,
          isLock: Boolean(result.outcome.consumer.isLock)
        }
      });
      moves.push({
        changeType: req.beginStarType,
        changePos: req.beginPos,
        star_Info: null
      });
    }

    sendGameSession(state, 4178, originalPb.encode('star.StarMoveRspMsg', { move: moves }));

    if (result.outcome.heroStatsChanged) {
      const updatedHero = heroState.heroInfo(state.character);
      sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));
      sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));
      if (state.heroSent && state.worldRequested) {
        sendGameSession(state, 169, originalPb.encode('army.ArmyUpdatedGridMsg', { updatedArmy: [heroState.armyInfo(state.character)] }));
      }
      log(`[STAR MOVE #${state.id}] Atributos de combate atualizados. BR: ${updatedHero.fightingCapacity}`);
    }

    log(`[STAR MOVE #${state.id}] ${result.outcome.type} (${req.beginStarType}:${req.beginPos} -> ${req.endStarType}:${req.endPos})`);
  } catch (err) {
    log(`[STAR MOVE #${state.id}] Falha: ${err.message}`);
  }
}

async function handleStarCompose(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req = {};
  try {
    req = originalPb.decode('star.StarComposeReqMsg', body);
  } catch (e) {
    log(`[STAR COMPOSE #${state.id}] Decodificacao: ${e.message}`);
    return;
  }

  const pos = Number(req.pos !== undefined ? req.pos : -1);
  const bagType = Number(req.bagType !== undefined ? req.bagType : 1);

  try {
    const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
      const outcome = astralState.composeBag(saved, pos, bagType);
      return { state: saved, outcome };
    });

    state.character.state_json = result.state;
    state.character = await db.characterById(state.gatewayId);

    if (bagType === 0) { // Rm.TEMP
      sendGameSession(state, 4479, originalPb.encode('star.StarRandRspMsg', {
        site: result.state.astrals.spheres,
        starRand: [{
          dropSite: result.outcome.targetAstral.pos,
          starInfo: {
            id: result.outcome.targetAstral.id,
            templateId: result.outcome.targetAstral.templateId,
            userId: state.gatewayId,
            objectId: 0,
            pos: result.outcome.targetAstral.pos,
            exist: true,
            bagType: 0,
            grade: result.outcome.targetAstral.grade,
            gp: result.outcome.targetAstral.gp,
            isLock: Boolean(result.outcome.targetAstral.isLock)
          }
        }]
      }));
    } else { // Rm.PLAYER
      const moves = [];
      for (const d of result.outcome.deletedAstrals) {
        moves.push({ changeType: 1, changePos: d.pos, star_Info: null });
      }
      moves.push({
        changeType: 1,
        changePos: result.outcome.targetAstral.pos,
        star_Info: {
          id: result.outcome.targetAstral.id,
          templateId: result.outcome.targetAstral.templateId,
          userId: state.gatewayId,
          objectId: 0,
          pos: result.outcome.targetAstral.pos,
          exist: true,
          bagType: 1,
          grade: result.outcome.targetAstral.grade,
          gp: result.outcome.targetAstral.gp,
          isLock: Boolean(result.outcome.targetAstral.isLock)
        }
      });
      sendGameSession(state, 4178, originalPb.encode('star.StarMoveRspMsg', { move: moves }));
    }

    log(`[STAR COMPOSE #${state.id}] Sintese: Astral ${result.outcome.targetAstral.templateId} subiu para Lv.${result.outcome.newGrade} (EXP: +${result.outcome.expGained})`);
  } catch (err) {
    log(`[STAR COMPOSE #${state.id}] Falha: ${err.message}`);
  }
}

async function handleStarLock(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req = {};
  try {
    req = originalPb.decode('star.StarLockReqMsg', body);
  } catch (e) {
    log(`[STAR LOCK #${state.id}] Decodificacao: ${e.message}`);
    return;
  }

  const starType = Number(req.starType || 1);
  const pos = Number(req.pos || 0);

  try {
    const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
      const item = astralState.toggleAstralLock(saved, starType, pos);
      return { state: saved, item };
    });

    state.character.state_json = result.state;

    sendGameSession(state, 4178, originalPb.encode('star.StarMoveRspMsg', {
      move: [{
        changeType: starType,
        changePos: pos,
        star_Info: {
          id: result.item.id,
          templateId: result.item.templateId,
          userId: state.gatewayId,
          objectId: 0,
          pos: pos,
          exist: true,
          bagType: starType,
          grade: result.item.grade,
          gp: result.item.gp,
          isLock: Boolean(result.item.isLock)
        }
      }]
    }));
    log(`[STAR LOCK #${state.id}] Astral ${result.item.templateId} pos ${pos} lock=${result.item.isLock}`);
  } catch (err) {
    log(`[STAR LOCK #${state.id}] Falha: ${err.message}`);
  }
}

async function handleStarBatchOp(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req = {};
  try {
    req = originalPb.decode('star.OpStarReqMsg', body);
  } catch (e) {
    log(`[STAR BATCH #${state.id}] Decodificacao: ${e.message}`);
    return;
  }

  try {
    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
      const currentGold = Number(locked.gold !== undefined ? locked.gold : (saved.wallet?.gold || 0));
      const outcome = astralState.batchOperation(saved, req.way, req.mergePos, req.beginType, req.endType, req.itemInfo);
      const newGold = Math.max(0, currentGold + (outcome.goldGain || 0) - (outcome.goldCost || 0));
      if (saved.wallet) saved.wallet.gold = newGold;
      saved.gold = newGold;

      const resObj = { state: saved, outcome, newGold };
      if ((outcome.goldGain > 0 || outcome.goldCost > 0) && ['v095', 'v096', 'v097'].includes(saved.creation?.version)) {
        resObj.resources = {
          gold: newGold,
          grade: Number(locked.grade || state.character.grade || 1),
          experience: Number(locked.experience !== undefined ? locked.experience : 0)
        };
      }
      return resObj;
    });

    state.character.state_json = result.state;
    state.character = await db.characterById(state.gatewayId);

    if (result.outcome.type === 'quick_sell') {
      const tempDeleted = result.outcome.deleted.filter(x => x.bagType === 0);
      if (tempDeleted.length > 0) {
        sendGameSession(state, 4179, originalPb.encode('star.StarRandRspMsg', {
          site: result.state.astrals.spheres,
          starRand: tempDeleted.map(x => ({ dropSite: x.pos }))
        }));
      }

      const bagDeleted = result.outcome.deleted.filter(x => x.bagType === 1);
      if (bagDeleted.length > 0) {
        sendGameSession(state, 4178, originalPb.encode('star.StarMoveRspMsg', {
          move: bagDeleted.map(x => ({ changeType: 1, changePos: x.pos, star_Info: null }))
        }));
      }

      if (result.outcome.goldGain > 0) {
        sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
      }
    } else if (result.outcome.targetAstral) {
      const moves = [];
      for (const d of (result.outcome.deletedAstrals || [])) {
        moves.push({ changeType: 1, changePos: d.pos, star_Info: null });
      }
      const target = result.outcome.targetAstral;
      moves.push({
        changeType: target.bagType !== undefined ? target.bagType : 1,
        changePos: target.pos,
        star_Info: {
          id: target.id,
          templateId: target.templateId,
          userId: state.gatewayId,
          objectId: 0,
          pos: target.pos,
          exist: true,
          bagType: target.bagType !== undefined ? target.bagType : 1,
          grade: target.grade,
          gp: target.gp,
          isLock: Boolean(target.isLock)
        }
      });
      sendGameSession(state, 4178, originalPb.encode('star.StarMoveRspMsg', { move: moves }));
      if (result.outcome.goldCost > 0) {
        sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
      }
      if (result.outcome.heroStatsChanged) {
        const updatedHero = heroState.heroInfo(state.character);
        sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));
        sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));
        if (state.heroSent && state.worldRequested) {
          sendGameSession(state, 169, originalPb.encode('army.ArmyUpdatedGridMsg', { updatedArmy: [heroState.armyInfo(state.character)] }));
        }
      }
    }

    log(`[STAR BATCH #${state.id}] Operacao ${req.way} concluida. Ouro: ${result.newGold}`);
  } catch (err) {
    log(`[STAR BATCH #${state.id}] Falha: ${err.message}`);
  }
}

async function handleStarArrange(state) {
  if (!state.gatewayId || !state.character || state.closed) return;
  try {
    const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
      astralState.ensureAstralState(saved);
      saved.astrals.bag.sort((a, b) => a.pos - b.pos);
      saved.astrals.bag.forEach((item, idx) => { item.pos = idx; });
      return { state: saved };
    });

    state.character.state_json = result.state;
    const moveMsg = astralState.formatAllAstralsMoveMsg(result.state, state.gatewayId);
    sendGameSession(state, 4178, originalPb.encode('star.StarMoveRspMsg', moveMsg));
    log(`[STAR ARRANGE #${state.id}] Mochila de astrais compactada.`);
  } catch (err) {
    log(`[STAR ARRANGE #${state.id}] Falha: ${err.message}`);
  }
}

async function handleStarSpecial(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req = {};
  try {
    req = originalPb.decode('star.StarVipEventMsg', body);
  } catch (_) {}

  try {
    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
      astralState.ensureAstralState(saved);
      const currentGold = Number(locked.gold !== undefined ? locked.gold : (saved.wallet?.gold || 0));
      
      const outcome = astralState.autoCapture(saved, currentGold, {
        sellMaxQuality: req.sellMaxQuality,
        composeMaxQuality: req.composeMaxQuality,
        golden: req.golden,
        maxCapture: 16
      });
      const newGold = outcome.remainingGold;
      if (saved.wallet) saved.wallet.gold = newGold;
      saved.gold = newGold;

      const resObj = { state: saved, outcome, newGold };
      if (['v095', 'v096', 'v097'].includes(saved.creation?.version)) {
        resObj.resources = {
          gold: newGold,
          grade: Number(locked.grade || state.character.grade || 1),
          experience: Number(locked.experience !== undefined ? locked.experience : 0)
        };
      }
      return resObj;
    });

    state.character.state_json = result.state;
    state.character = await db.characterById(state.gatewayId);

    // Envia o estado atual da bolsa temporária
    const starRandPayload = astralState.formatStarRandRspMsg(
      result.outcome.spheres,
      result.state.astrals.temp,
      state.gatewayId
    );
    sendGameSession(state, 4180, originalPb.encode('star.StarRandRspMsg', starRandPayload));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

    log(`[STAR AUTO #${state.id}] Auto-captura (sellMax=${req.sellMaxQuality}, composeMax=${req.composeMaxQuality}, golden=${req.golden}): ${result.state.astrals.temp.length} no temp, ${result.outcome.soldCount} vendidos. Ouro: ${result.newGold}`);
  } catch (err) {
    log(`[STAR AUTO #${state.id}] Falha: ${err.message}`);
  }
}

async function handleStargazingOp(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req = {};
  try {
    req = originalPb.decode('stargazing.StargazingOpMsg', body);
  } catch (e) {
    log(`[STARGAZING #${state.id}] Erro de decodificacao 9041: ${e.message}`);
    return;
  }

  const op = Number(req.op) || 0;

  try {
    // PU.OPEN = 0: Abre interface de Astrologia / Constelações
    if (op === 0) {
      const saved = typeof state.character.state_json === 'string'
        ? JSON.parse(state.character.state_json)
        : (state.character.state_json || {});
      const infoMsg = stargazingState.formatStargazingInfo(saved);
      sendGameSession(state, 275, originalPb.encode('stargazing.StargazingResponseMsg', {
        op: 0,
        dropItemIds: [],
        infoMsg
      }));
      log(`[STARGAZING #${state.id}] Info inicial (op 0) sincronizada.`);
      return;
    }

    // PU.NOMAL_REWARD = 1: Desejo Estelar (Wish / Star Wish)
    if (op === 1) {
      const count = (Number(req.count) >= 10) ? 10 : 1;
      const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
        stargazingState.ensureStargazingState(saved);
        const bag = inventoryState.inventory(saved);

        // Verifica item de sorteio (2125149)
        const wishTokenId = 2125149;
        const itemIdx = bag.items.findIndex(i => i.templateId === wishTokenId && i.count >= count);
        if (itemIdx >= 0) {
          bag.items[itemIdx].count -= count;
          if (bag.items[itemIdx].count <= 0) bag.items.splice(itemIdx, 1);
        }

        // Rola drops do Wish
        const outcome = stargazingState.doWish(saved, count);

        // Adiciona itens sorteados na mochila do jogador
        for (const it of outcome.awardedItems) {
          try {
            inventoryState.addItem(saved, it.itemId, it.count);
          } catch (_) {}
        }

        return { state: saved, outcome };
      });

      state.character.state_json = result.state;
      state.character = await db.characterById(state.gatewayId);

      // Responde com S2C 275 (U_C_STARGAZING_INFO) contendo dropItemIds para parar a roleta!
      sendGameSession(state, 275, originalPb.encode('stargazing.StargazingResponseMsg', {
        op: 1,
        dropItemIds: result.outcome.dropItemIds
      }));

      // Sincroniza inventário com os novos itens recebidos
      sendGameSession(state, 115, makeInventorySnapshot(state.gatewayId, state.character?.state_json), state.gatewayId);
      log(`[STARGAZING #${state.id}] Desejo Estelar (${count}x) concluido: drops [${result.outcome.dropItemIds.join(', ')}]`);
      return;
    }

    // PU.UPGRADE_STAR = 2: Potencial Estelar ("Encantar" / Formation)
    if (op === 2) {
      const signIndex = Math.min(12, Math.max(1, Number(req.index) || 1));
      try {
        const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
          stargazingState.ensureStargazingState(saved);
          const z = saved.stargazing.zodiacs[signIndex];
          const cost = stargazingState.getFormationCost(signIndex, 1, z.formationStarGrade, z.formationPoints);
          const currentGold = Number(locked.gold !== undefined ? locked.gold : (saved.wallet?.gold || 0));

          if (currentGold < cost.goldCost) {
            throw new Error(`Ouro insuficiente para Potencial Estelar: requerido ${cost.goldCost}, possui ${currentGold}`);
          }

          const bag = inventoryState.inventory(saved);
          const itemIdx = bag.items.findIndex(i => i.templateId === cost.expendItemId && i.count >= cost.expendItemCount);
          if (itemIdx < 0) {
            throw new Error(`Itens insuficientes para Potencial Estelar: requer ${cost.expendItemCount}x do item ${cost.expendItemId}`);
          }

          const outcome = stargazingState.upgradeFormation(saved, signIndex);
          const newGold = Math.max(0, currentGold - outcome.goldCost);
          if (saved.wallet) saved.wallet.gold = newGold;
          saved.gold = newGold;

          // Consome item legítimo
          bag.items[itemIdx].count -= outcome.expendItemCount;
          if (bag.items[itemIdx].count <= 0) bag.items.splice(itemIdx, 1);

          const resObj = { state: saved, outcome, newGold };
          if (['v095', 'v096', 'v097'].includes(saved.creation?.version)) {
            resObj.resources = {
              gold: newGold,
              grade: Number(locked.grade || state.character.grade || 1),
              experience: Number(locked.experience !== undefined ? locked.experience : 0)
            };
          }
          return resObj;
        });

        state.character.state_json = result.state;
        state.character = await db.characterById(state.gatewayId);

        // Responde com S2C 275
        sendGameSession(state, 275, originalPb.encode('stargazing.StargazingResponseMsg', {
          op: 2,
          dropItemIds: [],
          infoMsg: result.outcome.infoMsg
        }));

        // Sincroniza inventário, ouro e hero info (combat power atualizado)
        sendGameSession(state, 115, makeInventorySnapshot(state.gatewayId, state.character?.state_json), state.gatewayId);
        sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
        const updatedHero = heroState.heroInfo(state.character);
        sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));

        log(`[STARGAZING #${state.id}] Potencial Estelar Signo ${signIndex} (Sucesso=${result.outcome.success}, Star=${result.outcome.zodiac.formationStarGrade}, Points=${result.outcome.zodiac.formationPoints})`);
      } catch (e) {
        log(`[STARGAZING #${state.id}] Rejeitado Potencial Estelar: ${e.message}`);
      }
      return;
    }

    // PU.ACTIVATE_MAP_FRAGMENT = 3: Mapa Estelar (Star Map)
    if (op === 3) {
      const signIndex = Math.min(12, Math.max(1, Number(req.index) || 1));
      try {
        const result = await db.mutateCharacterState(state.gatewayId, (saved, locked = {}) => {
          stargazingState.ensureStargazingState(saved);
          const z = saved.stargazing.zodiacs[signIndex];
          const cost = stargazingState.getMapCost(signIndex, z.mapRank, z.mapStarGrade, z.mapFragments);
          const currentGold = Number(locked.gold !== undefined ? locked.gold : (saved.wallet?.gold || 0));

          if (currentGold < cost.goldCost) {
            throw new Error(`Ouro insuficiente para Mapa Estelar: requerido ${cost.goldCost}, possui ${currentGold}`);
          }

          const bag = inventoryState.inventory(saved);
          const itemIdx = bag.items.findIndex(i => i.templateId === cost.expendItemId && i.count >= cost.expendItemCount);
          if (itemIdx < 0) {
            throw new Error(`Itens insuficientes para Mapa Estelar: requer ${cost.expendItemCount}x do item ${cost.expendItemId}`);
          }

          const outcome = stargazingState.upgradeMap(saved, signIndex);
          const newGold = Math.max(0, currentGold - outcome.goldCost);
          if (saved.wallet) saved.wallet.gold = newGold;
          saved.gold = newGold;

          // Consome item legítimo
          bag.items[itemIdx].count -= outcome.expendItemCount;
          if (bag.items[itemIdx].count <= 0) bag.items.splice(itemIdx, 1);

          const resObj = { state: saved, outcome, newGold };
          if (['v095', 'v096', 'v097'].includes(saved.creation?.version)) {
            resObj.resources = {
              gold: newGold,
              grade: Number(locked.grade || state.character.grade || 1),
              experience: Number(locked.experience !== undefined ? locked.experience : 0)
            };
          }
          return resObj;
        });

        state.character.state_json = result.state;
        state.character = await db.characterById(state.gatewayId);

        // Responde com S2C 275
        sendGameSession(state, 275, originalPb.encode('stargazing.StargazingResponseMsg', {
          op: 3,
          dropItemIds: [],
          infoMsg: result.outcome.infoMsg
        }));

        // Sincroniza inventário, ouro e hero info (combat power atualizado)
        sendGameSession(state, 115, makeInventorySnapshot(state.gatewayId, state.character?.state_json), state.gatewayId);
        sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
        const updatedHero = heroState.heroInfo(state.character);
        sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));

        log(`[STARGAZING #${state.id}] Mapa Estelar Signo ${signIndex} (StarGrade=${result.outcome.zodiac.mapStarGrade}, Fragments=${result.outcome.zodiac.mapFragments})`);
      } catch (e) {
        log(`[STARGAZING #${state.id}] Rejeitado Mapa Estelar: ${e.message}`);
      }
      return;
    }

    log(`[STARGAZING #${state.id}] Operacao op=${op} nao tratada`);
  } catch (err) {
    log(`[STARGAZING #${state.id}] Falha: ${err.message}`);
  }
}

async function handleStarShopBuy(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req = {};
  try {
    req = originalPb.decode('star.StarShopMsg', body);
  } catch (e) {
    log(`[STAR SHOP #${state.id}] Decodificacao: ${e.message}`);
    return;
  }

  const goodId = Number(req.goodId);
  const num = Math.max(1, Number(req.num) || 1);

  try {
    const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
      const outcome = astralState.buyStarShop(saved, goodId, num);
      return { state: saved, outcome };
    });

    state.character.state_json = result.state;
    state.character = await db.characterById(state.gatewayId);

    // 1. Responde U_C_STARSHOP_BUY (4261) com result: 1 (sucesso)
    sendGameSession(state, 4261, originalPb.encode('star.StarShopMsg', {
      goodId: goodId,
      result: 1,
      num: num
    }));

    // 2. Envia U_C_START_MOVE_UPDATE (4178) com os astrais adicionados na mochila
    const moves = result.outcome.added.map(item => ({
      changeType: 1, // Rm.PLAYER
      changePos: item.pos,
      star_Info: astralState.formatStarInfo(item, state.gatewayId)
    }));
    sendGameSession(state, 4178, originalPb.encode('star.StarMoveRspMsg', { move: moves }));

    // 3. Atualiza pontos no PlayerMsg (3)
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

    log(`[STAR SHOP #${state.id}] Troca efetuada com sucesso: Astral ${goodId} x${num}. Pontos restantes: ${result.outcome.remainingPoints}`);
  } catch (err) {
    log(`[STAR SHOP #${state.id}] Falha na troca: ${err.message}`);
    sendGameSession(state, 4261, originalPb.encode('star.StarShopMsg', {
      goodId: goodId,
      result: 0,
      num: num
    }));
  }
}

async function handleSimpleUserInfo(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req = {};
  try {
    req = originalPb.decode('simple.InfoReqMsg', body);
  } catch (e) {
    req = { userId: state.gatewayId };
  }
  const targetId = Number(req.userId || state.gatewayId);
  try {
    const targetChar = (targetId === state.gatewayId) ? state.character : (await db.characterById(targetId) || state.character);
    const hero = heroState.heroInfo(targetChar);
    const vip = getCharacterVip(targetChar);
    const payload = {
      from: Number(req.from || 0),
      info: {
        userId: targetChar.id,
        nickName: targetChar.nickname,
        isExist: true,
        sexs: targetChar.sex,
        pics: targetChar.icon,
        camp: targetChar.camp,
        state: 1,
        grades: targetChar.grade,
        gp: Number(targetChar.experience || 0),
        fightingCapacity: hero.fightingCapacity,
        job: targetChar.job || hero.job || 1,
        isVip: vip.isVip,
        vipType: vip.vipType,
        vipGrade: vip.vipLevel,
        headId: hero.headId || targetChar.icon,
        serverName: targetChar.site || 'S1'
      }
    };
    sendGameSession(state, 4128, originalPb.encode('simple.InfoRspMsg', payload));
    log(`[USER INFO #${state.id}] SimpleUserInfo enviado para ${targetId} (VIP Lv.${vip.vipLevel})`);
  } catch (err) {
    log(`[USER INFO #${state.id}] Falha: ${err.message}`);
  }
}

const mpdRooms = new MpdRooms();

function formatFashionBookMsg(saved) {
  const f = saved.fashion || { unlocked: [] };
  const bag = saved.inventory || { items: [] };
  const unlockedMap = new Map();

  for (const it of (bag.items || [])) {
    const t = itemTemplates.get(Number(it.templateId));
    if (t && [109, 110, 111, 112].includes(t.SonType)) {
      unlockedMap.set(Number(it.templateId), {
        tempId: Number(it.templateId),
        isSwitch: Number(it.bagType) === 4,
        appraisalSkill: 0
      });
    }
  }

  for (const u of (f.unlocked || [])) {
    const tId = Number(u.templateId || u.tempId);
    if (!unlockedMap.has(tId)) {
      unlockedMap.set(tId, {
        tempId: tId,
        isSwitch: Boolean(u.isSwitch),
        appraisalSkill: Number(u.appraisalSkill) || 0
      });
    } else {
      const existing = unlockedMap.get(tId);
      if (u.isSwitch !== undefined) existing.isSwitch = Boolean(u.isSwitch);
      if (u.appraisalSkill) existing.appraisalSkill = Number(u.appraisalSkill);
    }
  }

  const infoList = [...unlockedMap.values()];
  const fashionIds = infoList.map(x => x.tempId);
  return {
    templateId: 0,
    info: infoList,
    fashionIds
  };
}

async function handleFashionInfo(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  const saved = typeof state.character.state_json === 'string'
    ? JSON.parse(state.character.state_json)
    : (state.character.state_json || {});
  
  const bookMsg = formatFashionBookMsg(saved);
  sendGameSession(state, 4542, originalPb.encode('fashion.FashionMsg', bookMsg));
  sendGameSession(state, 301, originalPb.encode('simple.FashionInfoMsg', saved.fashionDisplay || { status: '0,0,0,0' }));
  log(`[FASHION #${state.id}] Sincronizacao de Moda enviada (4542: ${bookMsg.info.length} pecas, 301: aparencia).`);
}

async function handleFashionCompose(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  const request = originalPb.decode('store.StoreReqMsg', body);
  const pos = Number(request.bagPos), count = Number(request.count);
  if (Number(request.bagType) !== 0 || !Number.isSafeInteger(pos) || pos < 0 ||
      !Number.isSafeInteger(count) || count < 1 || count > 999) throw Error('Item/quantidade de Engolir invalido');
  const result = await db.mutateCharacterState(state.gatewayId, saved => {
    const bag = inventoryState.inventory(saved);
    const item = bag.items.find(entry => Number(entry.bagType) === 0 && Number(entry.pos) === pos);
    if (!item || Number(item.count) < count) throw Error('Item de moda nao encontrado na bolsa');
    const tpl = itemTemplates.get(Number(item.templateId));
    const son = Number(tpl?.SonType);
    if (![109, 110, 111, 112].includes(son) && ![208020, 208021].includes(Number(item.templateId))) {
      throw Error('Item nao aceito em Moda > Engolir');
    }
    const gainedGp = Number(item.templateId) === 208020 || Number(item.templateId) === 208021
      ? 200 * count : (son === 109 ? 1600 : 300) * count;
    saved.fashion = saved.fashion || { unlocked: [] };
    saved.fashion.unlocked = Array.isArray(saved.fashion.unlocked) ? saved.fashion.unlocked : [];
    if ([109, 110, 111, 112].includes(son) &&
        !saved.fashion.unlocked.some(entry => Number(entry.templateId || entry.tempId) === Number(item.templateId))) {
      saved.fashion.unlocked.push({ templateId: Number(item.templateId), isSwitch: false, appraisalSkill: 0 });
    }
    saved.fashionDisplay = saved.fashionDisplay || { status: '0,0,0,0' };
    let grade = Math.max(0, Number(saved.fashion.grades || saved.fashionDisplay.grades) || 0);
    let gp = Math.max(0, Number(saved.fashion.gp || saved.fashionDisplay.gp) || 0) + gainedGp;
    while (grade < fashionUpgrades.length && gp >= Number(fashionUpgrades[grade].Data)) {
      gp -= Number(fashionUpgrades[grade].Data);
      grade++;
    }
    saved.fashion.grades = grade;
    saved.fashion.gp = gp;
    saved.fashionDisplay.grades = grade;
    saved.fashionDisplay.gp = gp;
    item.count -= count;
    if (!item.count) bag.items.splice(bag.items.indexOf(item), 1);
    return { state: saved, pos, count, templateId: Number(item.templateId), grade, gp,
      moved: [{ bagType: 0, objectId: 0, ownerId: state.gatewayId, pos, item: item.count ? item : null }] };
  });
  state.character = await db.characterById(state.gatewayId);
  sendGameSession(state, 115, makeBagMoveUpdate(result.moved), state.gatewayId);
  sendGameSession(state, 301, originalPb.encode('simple.FashionInfoMsg', result.state.fashionDisplay));
  sendGameSession(state, 4542, originalPb.encode('fashion.FashionMsg', formatFashionBookMsg(result.state)));
  sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
  if (state.heroSent && state.worldRequested) sendGameSession(state, 169,
    originalPb.encode('army.ArmyUpdatedGridMsg', { updatedArmy: [heroState.armyInfo(state.character)] }));
  sendGameSession(state, 4487, originalPb.encode('store.StoreRspMsg',
    { composeResult: true, pos: result.pos, objectId: 0, bagType: 0, composeTemplateId: result.templateId }));
  log(`[FASHION COMPOSE #${state.id}] Engolir ${result.templateId} x${result.count}; grade ${result.grade}, GP ${result.gp}; 115/301/113/169/4487.`);
}

async function handleFashionSwitch(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req = {};
  try {
    req = originalPb.decode('fashion.FashionMsg', body);
  } catch (e) {
    log(`[FASHION SWITCH #${state.id}] Decodificacao: ${e.message}`);
    return;
  }
  const templateId = Number(req.templateId);
  const tpl = itemTemplates.get(templateId);
  if (!tpl) {
    log(`[FASHION SWITCH #${state.id}] Template ${templateId} nao encontrado`);
    return;
  }

  const result = await db.mutateCharacterState(state.gatewayId, saved => {
    saved.fashion = saved.fashion || { unlocked: [] };
    saved.fashion.unlocked = Array.isArray(saved.fashion.unlocked) ? saved.fashion.unlocked : [];
    const owned = inventoryState.inventory(saved).items.some(item =>
      Number(item.templateId) === templateId && Number(item.bagType) === 1);
    if (!owned && !saved.fashion.unlocked.some(item => Number(item.templateId || item.tempId) === templateId))
      throw Error('Moda nao pertence ao personagem');
    let u = saved.fashion.unlocked.find(x => Number(x.templateId || x.tempId) === templateId);
    if (!u) {
      u = { templateId, isSwitch: true, appraisalSkill: 0 };
      saved.fashion.unlocked.push(u);
    } else {
      u.isSwitch = !u.isSwitch;
    }

    saved.fashionDisplay = saved.fashionDisplay || { status: '0,0,0,0' };
    const son = Number(tpl.SonType);
    if (u.isSwitch) {
      if (son === 109) saved.fashionDisplay.wingAvata = templateId;
      if (son === 110) saved.fashionDisplay.hatAvata = templateId;
      if (son === 111) saved.fashionDisplay.clothAvata = templateId;
      if (son === 112) saved.fashionDisplay.armAvata = templateId;
    } else {
      if (son === 109 && saved.fashionDisplay.wingAvata === templateId) delete saved.fashionDisplay.wingAvata;
      if (son === 110 && saved.fashionDisplay.hatAvata === templateId) delete saved.fashionDisplay.hatAvata;
      if (son === 111 && saved.fashionDisplay.clothAvata === templateId) delete saved.fashionDisplay.clothAvata;
      if (son === 112 && saved.fashionDisplay.armAvata === templateId) delete saved.fashionDisplay.armAvata;
    }

    return { state: saved, u };
  });

  state.character.state_json = result.state;
  state.character = await db.characterById(state.gatewayId);

  sendGameSession(state, 4542, originalPb.encode('fashion.FashionMsg', formatFashionBookMsg(result.state)));
  sendGameSession(state, 301, originalPb.encode('simple.FashionInfoMsg', result.state.fashionDisplay || { status: '0,0,0,0' }));
  const updatedHero = heroState.heroInfo(state.character);
  sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));
  if (state.heroSent && state.worldRequested) {
    sendGameSession(state, 169, originalPb.encode('army.ArmyUpdatedGridMsg', { updatedArmy: [heroState.armyInfo(state.character)] }));
  }
  log(`[FASHION SWITCH #${state.id}] Moda ${templateId} alternada (ativo=${result.u.isSwitch}). Opcodes 4542, 301, 113, 169 enviados.`);
}

async function handleFashionExchange(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  const request = originalPb.decode('simple.FashionInfoMsg', body);
  const slots = { wingAvata: 109, hatAvata: 110, clothAvata: 111, armAvata: 112 };
  const result = await db.mutateCharacterState(state.gatewayId, saved => {
    const display = saved.fashionDisplay || { status: '0,0,0,0' };
    const unlocked = Array.isArray(saved.fashion?.unlocked) ? saved.fashion.unlocked : [];
    const bag = inventoryState.inventory(saved).items;
    if (Number(request.flag) === 1) {
      for (const [field, sonType] of Object.entries(slots)) {
        if (request[field] === undefined) continue;
        const id = Number(request[field]);
        if (!Number.isSafeInteger(id) || id < 0) throw Error(`Moda invalida em ${field}`);
        if (id) {
          const tpl = itemTemplates.get(id);
          if (Number(tpl?.SonType) !== sonType) throw Error(`Tipo de moda invalido em ${field}`);
          const owned = unlocked.some(u => Number(u.templateId || u.tempId) === id) ||
            bag.some(item => Number(item.templateId) === id && Number(item.bagType) === 4);
          if (!owned) throw Error(`Moda ${id} nao desbloqueada`);
          display[field] = id;
        } else delete display[field];
      }
    }
    for (const field of ['isHidenWingAvata', 'isHidenHatAvat', 'isHidenClothAvata', 'isHidenArmAvata']) {
      if (request[field] !== undefined) display[field] = Boolean(request[field]);
    }
    if (request.status !== undefined) {
      if (!/^[01],[01],[01],[01]$/.test(request.status)) throw Error('Status de moda invalido');
      display.status = request.status;
    }
    saved.fashionDisplay = display;
    return { state: saved };
  });
  state.character = await db.characterById(state.gatewayId);
  sendGameSession(state, 301, originalPb.encode('simple.FashionInfoMsg', result.state.fashionDisplay));
  sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
  log(`[FASHION EXCHANGE #${state.id}] Aparencia salva: ${JSON.stringify(Object.fromEntries(Object.keys(slots).map(k => [k, result.state.fashionDisplay[k] || 0])))}; 301/113.`);
}

async function handleFashionAppraisal(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req = {};
  try {
    req = originalPb.decode('fashion.FashionMsg', body);
  } catch (e) {
    log(`[FASHION APPRAISAL #${state.id}] Decodificacao: ${e.message}`);
    return;
  }
  const templateId = Number(req.templateId);
  const tpl = itemTemplates.get(templateId);
  if (![109, 110, 111, 112].includes(Number(tpl?.SonType)))
    throw Error('Template de moda invalido para refino');
  const result = await db.mutateCharacterState(state.gatewayId, (saved, locked) => {
    saved.fashion = saved.fashion || { unlocked: [] };
    saved.fashion.unlocked = Array.isArray(saved.fashion.unlocked) ? saved.fashion.unlocked : [];
    let u = saved.fashion.unlocked.find(x => Number(x.templateId || x.tempId) === templateId);
    const bag = inventoryState.inventory(saved);
    const ownsFashion = (bag.items || []).some(item => Number(item.templateId) === templateId) || Boolean(u);
    if (!ownsFashion) throw Error('Moda nao pertence ao personagem');
    const identified = Number(u?.appraisalSkill) > 0;
    const currentGrade = identified ? Math.max(1, Number(u.refineGrade) || 1) : 0;
    if (currentGrade >= 5) throw Error('Moda ja atingiu o refino maximo');
    const quality = Number(tpl.Property2);
    if (!Number.isSafeInteger(quality) || quality < 1 || quality > 5) throw Error('Qualidade de moda invalida');
    const nextGrade = currentGrade + 1;
    const skill = fashionSkills.find(row => Number(row.MasterType) === Number(tpl.SonType) * 10 &&
      Number(row.SonType) === quality && Number(row.Grades) === nextGrade);
    if (!skill) throw Error('Habilidade de refinamento ausente no catalogo');
    const itemMoved = [];
    let resources;
    if (!identified) {
      const costGold = 200000 * (6 - quality);
      const gold = Number(locked.gold);
      if (gold < costGold) throw Error(`Identificar requer ${costGold} ouro`);
      const newGold = gold - costGold;
      saved.wallet = saved.wallet || {};
      saved.wallet.gold = newGold;
      saved.gold = newGold;
      resources = { gold: newGold, grade: Number(locked.grade), experience: Number(locked.experience) };
    } else {
      const costSouls = 6 - quality;
      const soulIdx = bag.items.findIndex(i => Number(i.templateId) === 208020 && Number(i.bagType) === 1);
      if (soulIdx < 0 || Number(bag.items[soulIdx].count) < costSouls)
        throw Error(`Refinar requer ${costSouls} Nucleos da Moda`);
      bag.items[soulIdx].count -= costSouls;
      itemMoved.push({ bagType: 1, objectId: 0, ownerId: state.gatewayId, pos: bag.items[soulIdx].pos, item: bag.items[soulIdx] });
      if (!bag.items[soulIdx].count) {
        bag.items.splice(soulIdx, 1);
        itemMoved[0].item = null;
      }
    }
    if (!u) {
      u = { templateId, isSwitch: false, appraisalSkill: Number(skill.TemplateId), refineGrade: nextGrade };
      saved.fashion.unlocked.push(u);
    } else {
      u.refineGrade = nextGrade;
      u.appraisalSkill = Number(skill.TemplateId);
    }
    return { state: saved, resources, u, itemMoved };
  });

  state.character.state_json = result.state;
  state.character = await db.characterById(state.gatewayId);

  if (result.itemMoved && result.itemMoved.length > 0) {
    sendGameSession(state, 115, makeBagMoveUpdate(result.itemMoved), state.gatewayId);
  }
  if (result.resources) sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

  sendGameSession(state, 4542, originalPb.encode('fashion.FashionMsg', formatFashionBookMsg(result.state)));
  const updatedHero = heroState.heroInfo(state.character);
  sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));
  sendGameSession(state, 169, originalPb.encode('army.ArmyUpdatedGridMsg', { updatedArmy: [heroState.armyInfo(state.character)] }));
  log(`[FASHION APPRAISAL #${state.id}] Moda ${templateId} refinada (nv=${result.u.refineGrade}, skill=${result.u.appraisalSkill}, FC=${updatedHero.fightingCapacity}). Opcodes 115, 4542, 113, 169 enviados.`);
}

async function handleFashionSpecial(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  const saved = typeof state.character.state_json === 'string'
    ? JSON.parse(state.character.state_json)
    : (state.character.state_json || {});
  sendGameSession(state, 4542, originalPb.encode('fashion.FashionMsg', formatFashionBookMsg(saved)));
}

function sendMountSnapshot(state, saved) {
  const { info, avatars } = mountState.payloads(saved);
  sendGameSession(state, 4426, originalPb.encode('campaign.MountInfoMsg', info));
  sendGameSession(state, 4427, originalPb.encode('campaign.MountAvatarMsg', avatars));
  return { mounts: avatars.avatarInfo.length, levelMax: info.levelMax };
}

async function handleMountCommand(state, code, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  if (code === 8530 || code === 8567) {
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      mountState.ensure(saved);
      return { state: saved };
    });
    state.character.state_json = result.state;
    const shown = sendMountSnapshot(state, result.state);
    log(`[MOUNT #${state.id}] Lista 4427 e atributos 4426 enviados (${shown.mounts} montarias, limite ${shown.levelMax}).`);
    return;
  }
  const request = originalPb.decode('campaign.MountEditMsg', body);
  const result = await db.mutateCharacterState(state.gatewayId, saved => {
    let outcome;
    if (code === 8536) outcome = mountState.activate(saved, request.param1);
    else if (code === 8532) mountState.change(saved, request.param1);
    else if (code === 8529) outcome = mountState.train(saved, request.propertyType, request.param1);
    else if (code === 8533) {
      mountState.ensure(saved);
      const riding = (Number(request.param1) === 1);
      saved.mounts.riding = riding;
      outcome = { changed: true, riding };
    }
    else throw Error('Operacao de montaria desconhecida');
    attributeCalculator.recalculate(saved);
    return { state: saved, outcome };
  });
  state.character = await db.characterById(state.gatewayId);
  if (result.outcome?.moved?.length) {
    sendGameSession(state, 115, makeBagMoveUpdate(result.outcome.moved.map(item => ({ ...item, ownerId: state.gatewayId }))), state.gatewayId);
  }
  const shown = sendMountSnapshot(state, result.state);
  sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
  sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
  sendGameSession(state, 150, originalPb.encode('army.ArmyMsg', heroState.armyInfo(state.character)));
  sendGameSession(state, 169, originalPb.encode('army.ArmyUpdatedGridMsg', { updatedArmy: [heroState.armyInfo(state.character)] }));
  log(`[MOUNT #${state.id}] Opcode ${code} aplicado; 4426/4427/113/3/150/169 enviados, ${shown.mounts} montarias.`);
}

async function handleBuildingUpEnergy(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  try {
    let payType = 2;
    try {
      if (body && body.length > 0) {
        const req = originalPb.decode('player.PayTypeMsg', body);
        payType = Number(req.payType || 2);
      }
    } catch (_) {}

    const cost = 200;
    const result = await db.mutateCharacterState(state.gatewayId, saved => {
      saved.wallet = saved.wallet || { gold: 0, balens: 0, boundBalens: 0 };
      const curBound = Number(saved.wallet.boundBalens || 0);
      const curBalens = Number(saved.wallet.balens || 0);

      if (payType === 1 || curBound >= cost) {
        if (curBound >= cost) {
          saved.wallet.boundBalens -= cost;
        } else if (curBound + curBalens >= cost) {
          const rem = cost - curBound;
          saved.wallet.boundBalens = 0;
          saved.wallet.balens -= rem;
        } else {
          throw new Error(`Balens insuficientes para recarregar o Portão do Místico (requer ${cost})`);
        }
      } else {
        if (curBalens < cost) {
          throw new Error(`Balens insuficientes para recarregar o Portão do Místico (requer ${cost})`);
        }
        saved.wallet.balens -= cost;
      }

      saved.castle = saved.castle || {};
      saved.castle.transEnergy = 200;
      saved.outerCityEnergy = 200;
      if (saved.castle.buildings && saved.castle.buildings['-11']) {
        saved.castle.buildings['-11'].property1 = 200;
      }
      return { state: saved };
    });

    state.character = await db.characterById(state.gatewayId);
    state.character.state_json = JSON.stringify(result.state);

    // Opcode 103: U_C_BUILDING_UPENERGY (building.TransInfoMsg)
    sendGameSession(state, 103, originalPb.encode('building.TransInfoMsg', {
      currentEnergy: 200,
      remainTime: 0
    }));

    // Opcode 3: Sync wallet
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

    // Opcode 4202: U_C_DATARESET
    try {
      sendGameSession(state, 4202, originalPb.encode('player.DataResetMsg', {
        transEnergy: 200,
        weary: 100,
        attackCount: 0,
        blessingCount: 0,
        blessingBuff: 0,
        challengeCount: 10
      }));
    } catch (_) {}

    log(`[PORTAO MISTICO #${state.id}] Energia recarregada para 200 com sucesso (-${cost} Balens). Opcode 103/3/4202 enviados.`);
  } catch (err) {
    log(`[PORTAO MISTICO #${state.id}] Erro 5174: ${err.message}`);
  }
}

function deliverDropIdToBag(saved, gatewayId, dropId, moved, character) {
  const dropList = dropItems.get(Number(dropId)) || [];
  for (const chosen of dropList) {
    if (!chosen || !chosen.ItemId) continue;
    const itemId = Number(chosen.ItemId);
    const countVal = Number(chosen.Data) || 1;
    if (itemId === -100) {
      saved.gold = (Number(saved.gold) || 0) + countVal;
      if (character) character.gold = saved.gold;
    } else if (itemId === -200) {
      saved.daru = (Number(saved.daru) || 0) + countVal;
      if (character) character.daru = saved.daru;
    } else if (itemId === -500) {
      saved.point = (Number(saved.point) || 0) + countVal;
      if (character) character.point = saved.point;
    } else if (itemId === -5500) {
      saved.gift_token = (Number(saved.gift_token) || 0) + countVal;
      if (character) character.gift_token = saved.gift_token;
    } else if (itemId > 0) {
      inventoryState.addItem(saved, itemId, countVal);
    }
  }
}

async function handlePlayerSignCmd(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req = {};
  try {
    req = originalPb.decode('player.PlayerSignReqMsg', body);
  } catch (e) {
    log(`[SIGN #${state.id}] Decodificacao: ${e.message}`);
    return;
  }
  const optType = Number(req.optType) || 1;
  const prizeSite = Number(req.prizeSite) || 0;
  const index = Number(req.index) || 0;

  const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
    const s = saved.signIn || saved.signInfo || {
      signDate: new Date().toISOString().slice(0, 10) + ' 05:00:00',
      signTimes: 0,
      signSite: 0,
      reissueNum: 0,
      rewardState: '0,0,0,0,0,0'
    };
    saved.signIn = s;
    saved.signInfo = s;
    const moved = [];
    const totalDays = 28;

    if (optType === 1) {
      // Retorna estado atual do check-in
    } else if (optType === 2) {
      if (prizeSite > 0) {
        // Coleta de recompensa cumulativa (ex: 3, 7, 10, 15, 20, 25 dias)
        const milestones = [3, 7, 10, 15, 20, 25];
        const mIdx = milestones.indexOf(prizeSite);
        const rewardStates = (s.rewardState || '0,0,0,0,0,0').split(',');
        while (rewardStates.length < 6) rewardStates.push('0');
        if (mIdx >= 0 && rewardStates[mIdx] === '0' && s.signTimes >= prizeSite) {
          rewardStates[mIdx] = '1';
          s.rewardState = rewardStates.join(',');
          const dropId = 63001 + mIdx;
          deliverDropIdToBag(saved, state.gatewayId, dropId, moved, state.character);
        }
      } else {
        // Check-in diario
        const dayToSign = index > 0 ? index : (s.signTimes + 1);
        const bitMask = 1 << (totalDays - dayToSign);
        if ((s.signSite & bitMask) === 0) {
          s.signSite |= bitMask;
          s.signTimes += 1;
          const dropId = 17000 + dayToSign;
          deliverDropIdToBag(saved, state.gatewayId, dropId, moved, state.character);
        }
      }
    } else if (optType === 3) {
      // Re-sign (check-in retroativo)
      const dayToSign = index > 0 ? index : 1;
      const bitMask = 1 << (totalDays - dayToSign);
      if ((s.signSite & bitMask) === 0) {
        s.signSite |= bitMask;
        s.signTimes += 1;
        const dropId = 17000 + dayToSign;
        deliverDropIdToBag(saved, state.gatewayId, dropId, moved, state.character);
      }
    }

    return { state: saved, s, moved };
  });

  state.character.state_json = result.state;
  state.character = await db.characterById(state.gatewayId);

  sendInventorySnapshot(state);
  sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

  const rsp = {
    signDate: result.s.signDate || (new Date().toISOString().slice(0, 10) + ' 05:00:00'),
    signTimes: Number(result.s.signTimes) || 0,
    signSite: Number(result.s.signSite) || 0,
    reissueNum: Number(result.s.reissueNum) || 0,
    rewardState: String(result.s.rewardState || '0,0,0,0,0,0')
  };
  sendGameSession(state, 4177, originalPb.encode('player.PlayerSignRspMsg', rsp));
  log(`[SIGN #${state.id}] Check-in concluído (opt=${optType}, site=${rsp.signSite}, times=${rsp.signTimes}). Opcode 4177 enviado.`);
}

async function handleSoulStoreUse(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  try {
    const req = originalPb.decode('item.ItemUseStoreReqMsg', body);
    const countToUse = Math.max(1, Number(req.count) || 1);

    const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
      secondarySystemsState.ensureSecondarySystemsState(saved);
      const bag = inventoryState.inventory(saved);
      const stocks = bag.items.filter(i => Number(i.templateId) === 208014 && Number(i.bagType) === 1);
      const totalStock = stocks.reduce((sum, i) => sum + Number(i.count || 0), 0);
      if (totalStock < 1) {
        throw new Error('Cristais de Alma insuficientes na bolsa');
      }

      const actualUsed = Math.min(totalStock, countToUse);
      const itemMoved = [];
      let left = actualUsed;
      for (const item of stocks) {
        if (!left) break;
        const used = Math.min(left, Number(item.count));
        item.count -= used;
        left -= used;
        itemMoved.push({ bagType: 1, objectId: 0, ownerId: state.gatewayId, pos: item.pos, item: item.count > 0 ? item : null });
        if (item.count <= 0) {
          bag.items.splice(bag.items.indexOf(item), 1);
        }
      }

      saved.jewelGp = (saved.jewelGp || 0) + actualUsed;
      saved.jewelGrades = Number(saved.jewelGrades) || 0;
      const upCat = canonicalConfigs.getTable('t_s_upgradetemplate') || [];
      const soulLevels = new Map(upCat.filter(u => Number(u.Types) === 15).map(u => [Number(u.Grades), Number(u.Data)]));
      while (saved.jewelGrades < 80) {
        const nextReq = soulLevels.get(saved.jewelGrades + 1);
        if (nextReq && saved.jewelGp >= nextReq) {
          saved.jewelGp -= nextReq;
          saved.jewelGrades++;
        } else {
          break;
        }
      }

      attributeCalculator.recalculate(saved, state.character.grade);
      return { state: saved, itemMoved, jewelGrades: saved.jewelGrades, jewelGp: saved.jewelGp };
    });

    state.character.state_json = result.state;
    state.character = await db.characterById(state.gatewayId);

    sendGameSession(state, 115, makeBagMoveUpdate(result.itemMoved), state.gatewayId);
    const updatedHero = heroState.heroInfo(state.character);
    sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    if (state.heroSent && state.worldRequested) {
      sendGameSession(state, 169, originalPb.encode('army.ArmyUpdatedGridMsg', { updatedArmy: [heroState.armyInfo(state.character)] }));
    }

    log(`[SOUL ENGRAVING #${state.id}] ${result.itemMoved.length} slots atualizados. Nivel gravacao: ${result.jewelGrades} (GP: ${result.jewelGp})`);
  } catch (err) {
    log(`[SOUL ENGRAVING #${state.id}] Falha ao processar 8484: ${err.message}`);
  }
}

function syncHeroAfterSylph(state){
    if(!state || !state.character || state.closed)return;
    sendGameSession(state,113,originalPb.encode('army.SimpleHeroInfoMsg',heroState.heroInfo(state.character)));
    sendGameSession(state,3,makeBasicPlayerInfo(state.character));
    if(state.heroSent && state.worldRequested)sendGameSession(state,169,originalPb.encode('army.ArmyUpdatedGridMsg',{updatedArmy:[heroState.armyInfo(state.character)]}));
  }
  async function handleSylphReq(state, opcode, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  try {
    if (opcode === 8702) {
      const saved = inventoryState.parseState(state.character.state_json);
      secondarySystemsState.ensureSecondarySystemsState(saved);
      const msg = secondarySystemsState.formatPlayerPetMsg(saved, state.gatewayId, 0);
      sendGameSession(state, 4540, originalPb.encode('pet.PlayerPetMsg', msg));
      log(`[SYLPH #${state.id}] Info de Silfos enviada (4540). Total: ${msg.petInfo.length}`);
      return;
    }

    if (opcode === 8621) {
      const req = originalPb.decode('pet.PlayerPetOpMsg', body);
      // SYLPH_TRAIN_LIVE_V1: operations 4 (Mahra growth) and 7 (Sepulcrum enchant).
      // Do not remove the existing opcode 16 (dissolve) or ops 9/10/14.
      if (Number(req.opType) === 4 || Number(req.opType) === 7) {
        const op = Number(req.opType);
        const petId = Number(req.petId);
        let committed = false;
        try {
          const sylphTraining = require('./sylph-training-live');
          const outcome = await db.mutateCharacterState(state.gatewayId, (raw, locked = {}) => {
            const saved = inventoryState.parseState(raw);
            secondarySystemsState.ensureSecondarySystemsState(saved);
            const template = itemTemplates.get(sylphTraining.MATERIAL[op]);
            if (!template) throw Error('Material de treinamento ausente do catalogo: ' + sylphTraining.MATERIAL[op]);
            const grade = Number(locked.grade ?? state.character.grade);
            if (!Number.isSafeInteger(grade) || grade < Number(template.NeedGrades || 1)) {
              throw Error('Nivel do personagem insuficiente para usar este material');
            }
            if (![0, 1].includes(Number(req.payType || 0))) {
              throw Error('Forma de pagamento nao suportada; nenhum recurso sera cobrado');
            }
            const applied = sylphTraining.apply({
              saved, opType: op, petId, value: Number(req.value || 1), itemPos: Number(req.itemPos || 0)
            });
            // Include the real fields that the client Fy.createWithMsg consumes.
            const wireState = secondarySystemsState.formatPlayerPetMsg(saved, state.gatewayId, 0);
            wireState.op = 0;
            const fresh = new Map((saved.sylphs?.list || []).filter(p => p && !p.isDel).map(p => [Number(p.petId), p]));
            wireState.petInfo = (wireState.petInfo || []).map(p => ({
              ...p, ...(fresh.get(Number(p.petId)) || {}),
              petName: String(fresh.get(Number(p.petId))?.petName || p.petName || ''),
              curQualityGp: Number(fresh.get(Number(p.petId))?.curQualityGp ?? p.curQualityGp ?? 0),
              totalQualityGp: Number(fresh.get(Number(p.petId))?.totalQualityGp ?? p.totalQualityGp ?? 0)
            }));
            // Validate ALL response serialization before committing the DB transaction.
            applied.petWire = originalPb.encode('pet.PlayerPetMsg', wireState);
            applied.bagWire = makeBagMoveUpdate(applied.moved.map(item => ({...item, ownerId: state.gatewayId})));
            applied.resultWire = originalPb.encode('pet.PlayerPetOpRes', {opType: op, result: 1, petId});
            return applied;
          });
          committed = true;
          state.character = await db.characterById(state.gatewayId);
          if (!state.character) throw Error('Personagem nao encontrado apos gravar treinamento');
          sendGameSession(state, 4540, outcome.petWire);
          sendGameSession(state, 115, outcome.bagWire, state.gatewayId);
          sendGameSession(state, 4707, outcome.resultWire);
          syncHeroAfterSylph(state);
          log(`[SYLPH TRAIN LIVE #${state.id}] op=${op} pet=${petId} ` +
            `material=${outcome.materialId} consumidos=${outcome.spent} ` +
            `qualidade=${outcome.qualityBefore}->${outcome.qualityAfter} ` +
            `progresso=${outcome.progressBefore}->${outcome.progressAfter} ` +
            `evolucoes=${outcome.upgrades} aptidoes=${JSON.stringify(outcome.enchantPoints)} PERSISTIDO.`);
        } catch (e) {
          log(`[SYLPH TRAIN LIVE #${state.id}] op=${op} pet=${petId} ` +
            `${committed ? 'GRAVADO - falha de sincronizacao, REENTRE NO JOGO' : 'RECUSADO SEM CONSUMO'}: ${e.message}`);
          if (!committed) {
            sendGameSession(state, 4707, originalPb.encode('pet.PlayerPetOpRes', {
              opType: op, result: 0, petId: Number.isSafeInteger(petId) && petId > 0 ? petId : 0
            }));
          }
        }
        return;
      }

      if (Number(req.opType) === 16) {
        // PetSaveWnd submits IDs to dissolve; never interpret petIds as the kept IDs.
        const sylphResolve = require('./sylph-duplicate-resolve');
        const context = sylphResolve.createCatalogContext(inventoryState, itemTemplates);
        const result = await db.mutateCharacterState(state.gatewayId, raw => {
          const saved = inventoryState.parseState(raw);
          secondarySystemsState.ensureSecondarySystemsState(saved);
          return sylphResolve.dissolveChosenDuplicates(saved, req.petIds, context);
        });
        state.character = await db.characterById(state.gatewayId);
        const saved = inventoryState.parseState(state.character.state_json);
        // op=0 processes tombstones (isDel) and new/updated Sylphs on this client.
        const full = secondarySystemsState.formatPlayerPetMsg(saved, state.gatewayId, 0);
        const removed = result.removed.map(p => ({
          petId:Number(p.petId), templateId:Number(p.templateId), petName:String(p.petName || ''),
          curGrade:Number(p.curGrade || 1), quality:Number(p.quality || 1),
          isFight:false, isDel:true
        }));
        full.petInfo.push(...removed);
        sendGameSession(state, 4540, originalPb.encode('pet.PlayerPetMsg', full));
        sendGameSession(state, 115, makeInventorySnapshot(state.gatewayId, saved), state.gatewayId);
        sendGameSession(state, 4707, originalPb.encode('pet.PlayerPetOpRes', {
          opType:16, result:1, petId:0
        }));
        log(`[SYLPH SAVE #${state.id}] Preservado(s): ${result.kept.map(p=>p.petId).join(',')}; desfeito(s): ${result.removed.map(p=>p.petId).join(',')}; Sepulcrum=${result.refund.sepulcrum}, Mahra=${result.refund.mahra}.`);
        return;
      }
      // VERIFIED CLIENT: Lm.setSkillFastKey -> opType 11; petName holds
      // six skill SonType IDs, not the pet display name.
      // Lm.learnSkill -> opType 5; item template Property1 points at skillId.
      // Lm.switchSkillIndex -> opType 20.
      if ([5, 11, 20].includes(Number(req.opType))) {
        const op=Number(req.opType), petId=Number(req.petId);
        const skillCatalogue=wartuneSylphSkills.readSkillCatalogue(path.resolve(__dirname,'../res/release/config'));
        let committed=false;
        try {
          if (!skillCatalogue.length && op!==20) throw Error('t_s_skilltemplate indisponivel: recusado sem consumo');
          const outcome=await db.mutateCharacterState(state.gatewayId, raw => {
            const saved=inventoryState.parseState(raw);
            secondarySystemsState.ensureSecondarySystemsState(saved);
            let updated,bagWire=null;
            if (op===11) {
              updated=wartuneSylphSkills.setFastKey(saved,petId,req.petName,skillCatalogue);
            } else if (op===20) {
              updated=wartuneSylphSkills.setSkillIndex(saved,petId,req.value);
            } else {
              const payType=Number(req.payType??0);
              if(![0,1].includes(payType))throw Error('Modalidade de aprendizado nao suportada');
              const bag=inventoryState.inventory(saved);
              const catalogue=new Map(secondarySystemsState.petTemplateCatalog.map(t=>[Number(t.TemplateId),t]));
              const args={
                saved,petId,skillId:Number(req.skillId),skillCatalogue,
                petCatalogue:catalogue,inventoryState
              };
              const applied=payType===1
                ? wartuneSylphSkills.learnWithScroll(args)
                : wartuneSylphSkills.learnFromBook({
                    ...args,itemPos:req.itemPos,bookTemplateLookup:id=>itemTemplates.get(id)
                  });
              updated=applied.pet;
              const changes=applied.changedPositions.map(pos=>{
                const entry=bag.items.find(x=>Number(x.bagType)===1&&Number(x.pos)===pos);
                const base={bagType:1,objectId:0,pos};
                return entry?{...base,ownerId:state.gatewayId,item:entry}:base;
              });
              bagWire=makeBagMoveUpdate(changes);
            }
            const full=secondarySystemsState.formatPlayerPetMsg(saved,state.gatewayId,0);
            const petWire=originalPb.encode('pet.PlayerPetMsg',full);
            const resultWire=originalPb.encode('pet.PlayerPetOpRes',{opType:op,result:1,petId});
            // Serialize before commit; DB failure does not send success.
            return {state:saved,petWire,resultWire,bagWire,op,petId,fastKey:updated.fastKey||''};
          });
          committed=true;
          state.character=await db.characterById(state.gatewayId);
          if(!state.character)throw Error('Personagem nao encontrado depois de persistir skill');
          sendGameSession(state,4540,outcome.petWire);
          if(outcome.bagWire)sendGameSession(state,115,outcome.bagWire,state.gatewayId);
          sendGameSession(state,4707,outcome.resultWire);
          log(`[SYLPH SKILLS #${state.id}] op=${op} petId=${petId} atualizado e persistido.`);
        } catch(err){
          log(`[SYLPH SKILLS #${state.id}] op=${op} petId=${petId}: ${committed?'GRAVADO (ressincronizar/relogar)':'RECUSADO SEM CONSUMO'}: ${err.message}`);
          if(!committed) sendGameSession(state,4707,originalPb.encode('pet.PlayerPetOpRes',{
            opType:op,result:0,petId:Number.isSafeInteger(petId)&&petId>0?petId:0
          }));
        }
        return;
      }
      if ([13, 21].includes(Number(req.opType))) {
        const opType = Number(req.opType);
        const petId = Number(req.petId);
        let committed = false;
        try {
          const promotion = require('./sylph-promotion-state');
          const outcome = await db.mutateCharacterState(state.gatewayId, (raw, locked) => {
            const saved = inventoryState.parseState(raw);
            const changed = opType === 13
              ? promotion.ascend(saved, petId, Number(locked.grade))
              : promotion.promote(saved, petId, Number(req.payType || 0), Number(locked.grade));
            const petWire = originalPb.encode('pet.PlayerPetMsg', secondarySystemsState.formatPlayerPetMsg(saved, state.gatewayId, 0));
            const bagWire = makeInventorySnapshot(state.gatewayId, saved);
            const resultWire = originalPb.encode('pet.PlayerPetOpRes', { opType, result: 1, petId });
            return { state: saved, changed, petWire, bagWire, resultWire };
          });
          committed = true;
          state.character = await db.characterById(state.gatewayId);
          sendGameSession(state, 4540, outcome.petWire);
          sendGameSession(state, 115, outcome.bagWire, state.gatewayId);
          sendGameSession(state, 4707, outcome.resultWire);
          syncHeroAfterSylph(state);
          log(`[SYLPH TRANSFORM #${state.id}] op=${opType} pet=${petId} ${outcome.changed.previousTemplateId}->${outcome.changed.templateId} persistido.`);
        } catch (err) {
          log(`[SYLPH TRANSFORM #${state.id}] op=${opType} pet=${petId}: ${committed ? 'GRAVADO, RELOGIN NECESSARIO' : 'RECUSADO SEM CONSUMO'}: ${err.message}`);
          if (!committed) sendGameSession(state, 4707, originalPb.encode('pet.PlayerPetOpRes', {opType, result: 0, petId}));
        }
        return;
      }
      // Contrato verificado no bundle LayaAir:
      // 1 = swallowPet/EXP; 4 = Mahra/crescimento; 7 = Sepulcrum/aptidao;
      // 9 = enterWar; 10 = rest; 14 = rename; 16 = dissolve (tratado acima).
      // Nunca use op=4 para ativar o Silfo; nem conceda nivel gratuito em op=1.
      const op = Number(req.opType);
      const petId = Number(req.petId);

      if (op === 2) {
        // Alocação de atributos do Silfo (addPoint)
        const attrs = Array.isArray(req.attributes) ? req.attributes.map(Number) : [];
        const pAdd = Math.max(0, attrs[0] || 0);
        const iAdd = Math.max(0, attrs[1] || 0);
        const sAdd = Math.max(0, attrs[2] || 0);
        const aAdd = Math.max(0, attrs[3] || 0);
        const total = pAdd + iAdd + sAdd + aAdd;
        if (total <= 0) {
          log(`[SYLPH ADDPOINT #${state.id}] pet=${petId} nenhum ponto informado.`);
          sendGameSession(state, 4707, originalPb.encode('pet.PlayerPetOpRes', { opType: 2, result: 0, petId: petId || 0 }));
          return;
        }

        try {
          await db.mutateCharacterState(state.gatewayId, (saved) => {
            secondarySystemsState.ensureSecondarySystemsState(saved);
            const list = saved.sylphs.list || [];
            const targetPet = list.find(s => Number(s.petId) === petId && !s.isDel);
            if (!targetPet) throw Error('Silfo nao encontrado');

            const curGrade = Math.max(1, Number(targetPet.curGrade || 1));
            const totalEarned = (curGrade - 1) * 5;
            const currentAllocated = Number(targetPet.powerAdd || 0) + Number(targetPet.intelAdd || 0) + Number(targetPet.physiAdd || 0) + Number(targetPet.armorAdd || 0);
            const available = targetPet.remainPoints !== undefined ? Number(targetPet.remainPoints) : Math.max(0, totalEarned - currentAllocated);
            if (total > available) throw Error(`Pontos insuficientes: requer ${total}, disponivel ${available}`);

            targetPet.power = Number(targetPet.power || 0) + pAdd;
            targetPet.intel = Number(targetPet.intel || 0) + iAdd;
            targetPet.physi = Number(targetPet.physi || 0) + sAdd;
            targetPet.armor = Number(targetPet.armor || 0) + aAdd;

            targetPet.powerAdd = Number(targetPet.powerAdd || 0) + pAdd;
            targetPet.intelAdd = Number(targetPet.intelAdd || 0) + iAdd;
            targetPet.physiAdd = Number(targetPet.physiAdd || 0) + sAdd;
            targetPet.armorAdd = Number(targetPet.armorAdd || 0) + aAdd;
            targetPet.remainPoints = Math.max(0, available - total);

            return { state: saved };
          });

          state.character = await db.characterById(state.gatewayId);
          const saved = inventoryState.parseState(state.character.state_json);
          const full = secondarySystemsState.formatPlayerPetMsg(saved, state.gatewayId, 0);
          sendGameSession(state, 4540, originalPb.encode('pet.PlayerPetMsg', full));
          sendGameSession(state, 4707, originalPb.encode('pet.PlayerPetOpRes', { opType: 2, result: 1, petId }));
          syncHeroAfterSylph(state);
          log(`[SYLPH ADDPOINT #${state.id}] pet=${petId} +${pAdd} For, +${iAdd} Mag, +${sAdd} Fis, +${aAdd} Arm; restantes=${saved.sylphs?.list?.find(s=>Number(s.petId)===petId)?.remainPoints}.`);
        } catch(err) {
          log(`[SYLPH ADDPOINT #${state.id}] Falha: ${err.message}`);
          sendGameSession(state, 4707, originalPb.encode('pet.PlayerPetOpRes', { opType: 2, result: 0, petId: petId || 0 }));
        }
        return;
      }

      if (op === 3) {
        // Redefinição de atributos do Silfo (washPoint)
        try {
          await db.mutateCharacterState(state.gatewayId, (saved) => {
            secondarySystemsState.ensureSecondarySystemsState(saved);
            const list = saved.sylphs.list || [];
            const targetPet = list.find(s => Number(s.petId) === petId && !s.isDel);
            if (!targetPet) throw Error('Silfo nao encontrado');

            const pAdd = Number(targetPet.powerAdd || 0);
            const iAdd = Number(targetPet.intelAdd || 0);
            const sAdd = Number(targetPet.physiAdd || 0);
            const aAdd = Number(targetPet.armorAdd || 0);
            const totalAllocated = pAdd + iAdd + sAdd + aAdd;
            if (totalAllocated <= 0) throw Error('Silfo nao possui pontos distribuidos');

            saved.wallet = saved.wallet || { gold: 0, balens: 0, boundBalens: 0 };
            const cost = 100;
            if (Number(saved.wallet.boundBalens || 0) >= cost) {
              saved.wallet.boundBalens -= cost;
            } else if (Number(saved.wallet.balens || 0) >= cost) {
              saved.wallet.balens -= cost;
            } else {
              throw Error('Saldo insuficiente para redefinir (requer 100 Balens/Vinculados)');
            }

            targetPet.power = Math.max(0, Number(targetPet.power || 0) - pAdd);
            targetPet.intel = Math.max(0, Number(targetPet.intel || 0) - iAdd);
            targetPet.physi = Math.max(0, Number(targetPet.physi || 0) - sAdd);
            targetPet.armor = Math.max(0, Number(targetPet.armor || 0) - aAdd);

            targetPet.powerAdd = 0;
            targetPet.intelAdd = 0;
            targetPet.physiAdd = 0;
            targetPet.armorAdd = 0;
            const curGrade = Math.max(1, Number(targetPet.curGrade || 1));
            targetPet.remainPoints = (curGrade - 1) * 5;

            return { state: saved };
          });

          state.character = await db.characterById(state.gatewayId);
          const saved = inventoryState.parseState(state.character.state_json);
          const full = secondarySystemsState.formatPlayerPetMsg(saved, state.gatewayId, 0);
          sendGameSession(state, 4540, originalPb.encode('pet.PlayerPetMsg', full));
          sendGameSession(state, 4707, originalPb.encode('pet.PlayerPetOpRes', { opType: 3, result: 1, petId }));
          sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
          syncHeroAfterSylph(state);
          log(`[SYLPH WASHPOINT #${state.id}] pet=${petId} pontos redefinidos.`);
        } catch(err) {
          log(`[SYLPH WASHPOINT #${state.id}] Falha: ${err.message}`);
          sendGameSession(state, 4707, originalPb.encode('pet.PlayerPetOpRes', { opType: 3, result: 0, petId: petId || 0 }));
        }
        return;
      }

      const supported = [9, 10, 14].includes(op);
      if (!supported) {
        // Sem as regras de t_s_upgradetemplate (Types 25/27/29/107/108) e
        // o mapeamento coerente das aptidoes, nao debitar Mahra/Sepulcrum.
        // Resposta negativa explicita em vez de simular sucesso no cliente.
        // Diagnostico da requisicao real do cliente, sem gravar nem cobrar.
        // Atenção: op=4 usa 'value' também para modo avancado; não equivale
        // necessariamente à quantidade de Mahra que será consumida.
        const currentSaved=inventoryState.parseState(state.character.state_json);
        const currentPet=(currentSaved.sylphs?.list||[]).find(p=>Number(p.petId)===petId&&!p.isDel);
        const diagnosticBag=inventoryState.inventory(currentSaved);
        const materialCount=id=>diagnosticBag.items.filter(i=>Number(i.templateId)===id&&Number(i.bagType)===1)
          .reduce((sum,i)=>sum+Number(i.count||0),0);
        log(`[SYLPH PROGRESSAO PENDENTE #${state.id}] op=${op} petId=${petId} value=${Number(req.value||0)} payType=${Number(req.payType??-1)} itemPos=${Number(req.itemPos??-1)} nivel=${Number(currentPet?.curGrade||0)} qualidade=${Number(currentPet?.quality||0)} Mahra=${materialCount(208023)} Sepulcrum=${materialCount(3040001)}; RECUSADA SEM CONSUMO.`);
        log(`[SYLPH #${state.id}] op=${op} RECUSADA SEM CONSUMO: progressao ainda requer catalogo e validacao oficial.`);
        sendGameSession(state, 4707, originalPb.encode('pet.PlayerPetOpRes', {
          opType: op, result: 0, petId: Number.isSafeInteger(petId) ? petId : 0
        }));
        return;
      }
      if (!Number.isSafeInteger(petId) || petId <= 0) {
        log(`[SYLPH #${state.id}] op=${op} recusada: petId invalido.`);
        sendGameSession(state, 4707, originalPb.encode('pet.PlayerPetOpRes', { opType: op, result: 0, petId: 0 }));
        return;
      }
      const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
        secondarySystemsState.ensureSecondarySystemsState(saved);
        const list = saved.sylphs.list || [];
        const targetPet = list.find(s => Number(s.petId) === petId && !s.isDel);
        if (!targetPet) throw Error('Silfo nao encontrado ou ja removido');
        if (op === 9) {
          for (const pet of list) if (!pet.isDel) pet.isFight = Number(pet.petId) === petId;
          saved.sylphs.activePetId = petId;
        } else if (op === 10) {
          targetPet.isFight = false;
          if (Number(saved.sylphs.activePetId) === petId) saved.sylphs.activePetId = 0;
        } else if (op === 14) {
          const name = String(req.petName || '').trim();
          if (!name || name.length > 24 || /[\x00-\x1f\x7f]/.test(name)) throw Error('Nome de Silfo invalido');
          targetPet.petName = name;
        }
        return { state: saved, opType: op, petId };
      });
      state.character = await db.characterById(state.gatewayId);
      if (!state.character) throw Error('Personagem ausente apos persistencia');
      const saved = inventoryState.parseState(state.character.state_json);
      // Snapshot completo para que um op de descanso remova o simbolo de combate.
      sendGameSession(state, 4540, originalPb.encode('pet.PlayerPetMsg', secondarySystemsState.formatPlayerPetMsg(saved, state.gatewayId, 0)));
      sendGameSession(state, 4707, originalPb.encode('pet.PlayerPetOpRes', { opType: result.opType, result: 1, petId: result.petId }));
      const updatedHero = heroState.heroInfo(state.character);
      sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));
      sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
      log(`[SYLPH #${state.id}] op=${result.opType} petId=${result.petId} persistida e sincronizada.`);
    }
  } catch (err) {
    log(`[SYLPH #${state.id}] Falha ao processar op ${opcode}: ${err.message}`);
  }
}

// R3: C_PET_CHALLENGE_FORMATION=8725 carries pet.PlayerPetMsg.
// Save only the Arena team and the optional reserve order, nothing else.
async function handlePetChallengeFormationReq(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let committed=false;
  try {
    const req=originalPb.decode('pet.PlayerPetMsg',body);
    const outcome=await db.mutateCharacterState(state.gatewayId, raw=>{
      const saved=inventoryState.parseState(raw);
      secondarySystemsState.ensureSecondarySystemsState(saved);
      const result=wartuneSylphSkills.saveArenaFormation(saved,req);
      const wire=originalPb.encode('pet.PlayerPetMsg',
        secondarySystemsState.formatPlayerPetMsg(saved,state.gatewayId,0));
      return {state:saved,wire,...result};
    });
    committed=true;
    state.character=await db.characterById(state.gatewayId);
    if(!state.character)throw Error('Personagem ausente após salvar formação');
    sendGameSession(state,4540,outcome.wire);
    log(`[SYLPH ARENA FORMATION #${state.id}] ${outcome.chaPos}; reservas=${outcome.fightIndex||''}; PERSISTIDO.`);
  } catch(err) {
    log(`[SYLPH ARENA FORMATION #${state.id}] ${committed?'GRAVADO, REENTRE NO JOGO':'RECUSADO SEM ALTERAÇÃO'}: ${err.message}`);
  }
}

// R2: A Arena de Silfos envia PetInfoMsg (8726), não PlayerPetOpMsg (8621).
// Persistir somente o conjunto de três habilidades da Arena do Silfo indicado.
async function handlePetChallengeSkillReq(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let petId=0, committed=false;
  try {
    const req=originalPb.decode('pet.PetInfoMsg',body);
    petId=Number(req.petId);
    const skillCatalogue=wartuneSylphSkills.readSkillCatalogue(path.resolve(__dirname,'../res/release/config'));
    if(!skillCatalogue.length)throw Error('t_s_skilltemplate indisponível: nenhuma alteração');
    const outcome=await db.mutateCharacterState(state.gatewayId, raw=>{
      const saved=inventoryState.parseState(raw);
      secondarySystemsState.ensureSecondarySystemsState(saved);
      wartuneSylphSkills.saveChallengeSkills(saved,petId,req.chaSkillIndexs,skillCatalogue);
      // Prepare the canonical response before committing to persistence.
      const petWire=originalPb.encode('pet.PlayerPetMsg',
        secondarySystemsState.formatPlayerPetMsg(saved,state.gatewayId,0));
      return {state:saved,petWire};
    });
    committed=true;
    state.character=await db.characterById(state.gatewayId);
    if(!state.character)throw Error('Personagem não localizado após salvar Arena');
    sendGameSession(state,4540,outcome.petWire);
    log(`[SYLPH ARENA #${state.id}] pet=${petId} habilidades da Arena persistidas.`);
  }catch(err){
    log(`[SYLPH ARENA #${state.id}] pet=${petId}: ${committed?'GRAVADO, REENTRE NO JOGO':'RECUSADO SEM CONSUMO'}: ${err.message}`);
  }
}


async function handleUiPlayChallenge(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  try {
    const req = originalPb.decode('uiplay.UiPlayChallengeMsg', body);
    const playId = Number(req.playId || req.param1 || 0);
    const levelId = Number(req.levelID || req.levelId || req.param2 || 0);
    const op = Number(req.op || 1);
    if (!playId || !levelId) throw Error('playId ou levelId ausente');

    const result = await db.mutateCharacterState(state.gatewayId, (saved, locked) => {
      const grade = Number(locked.grade || state.character.grade || 1);
      uiplayState.ensureUiPlayState(saved);
      const outcome = uiplayState.challengeUiPlay(saved, playId, levelId, op, grade, inventoryState.addItem);
      if (!outcome.success) throw Error(outcome.error);
      const listWire = originalPb.encode('uiplay.UserUiPlayListMsg',
        uiplayState.formatUiPlayListMsg(saved, state.gatewayId));
      const infoWire = originalPb.encode('uiplay.UiPlayInfoMsg',
        uiplayState.formatUiPlayInfoMsg(saved, playId));
      return { state: saved, listWire, infoWire, outcome };
    });
    state.character = await db.characterById(state.gatewayId);
    sendGameSession(state, 4743, result.listWire);
    sendGameSession(state, 4744, result.infoWire);
    // Atualizar recursos (energia, gold, inventário)
    sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
    if (result.outcome.drops && result.outcome.drops.length > 0) {
      sendInventorySnapshot(state);
    }
    log(`[UIPLAY #${state.id}] op=${op} play=${playId} level=${levelId}: ${result.outcome.isFirstClear ? 'PRIMEIRA CONCLUSAO' : 'concluido'}. Drops=${result.outcome.drops?.length || 0}, energia=-${result.outcome.energyCost}`);
  } catch (err) {
    log(`[UIPLAY #${state.id}] Desafio rejeitado: ${err.message}`);
    // Enviar estado atual sem alterações
    const saved = inventoryState.parseState(state.character.state_json);
    uiplayState.ensureUiPlayState(saved);
    sendGameSession(state, 4743, originalPb.encode('uiplay.UserUiPlayListMsg',
      uiplayState.formatUiPlayListMsg(saved, state.gatewayId)));
  }
}

async function handleRemotePetReq(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let committed = false;
  try {
    const req=originalPb.decode('remotepet.RemotePetOpMsg',body);
    // ED.saveRemotePetInfo/ED.sendPetSkills: op=2, pets: [{petId,site,skills}].
    if(Number(req.op)===2){
      const outcome=await db.mutateCharacterState(state.gatewayId, raw => {
        const saved=inventoryState.parseState(raw);
        secondarySystemsState.ensureSecondarySystemsState(saved);
        const result=wartuneSylphSkills.saveRemoteSkills(saved,req);
        // Both packet bodies must serialize before database commit.
        const sylphWire=originalPb.encode('pet.PlayerPetMsg',
          secondarySystemsState.formatPlayerPetMsg(saved,state.gatewayId,0));
        const remoteWire=originalPb.encode('remotepet.RemotePetMsg',
          secondarySystemsState.formatRemotePetMsg(saved,state.gatewayId));
        return {state:saved,sylphWire,remoteWire,count:result.count};
      });
      state.character=await db.characterById(state.gatewayId);
      sendGameSession(state,4540,outcome.sylphWire);
      sendGameSession(state,4964,outcome.remoteWire);
      log(`[REMOTE PET #${state.id}] op=2: habilidades/formacao de ${outcome.count} Silfos persistidas.`);
      return;
    }
    // op=1: consultar info
    if (Number(req.op) === 1) {
      log(`[REMOTE PET #${state.id}] op=1: consulta de info.`);
      const saved=inventoryState.parseState(state.character.state_json);
      secondarySystemsState.ensureSecondarySystemsState(saved);
      uiplayState.ensureRemotePetState(saved);
      sendGameSession(state,4964,originalPb.encode('remotepet.RemotePetMsg',secondarySystemsState.formatRemotePetMsg(saved,state.gatewayId)));
      return;
    }
    // op=6: desafiar fase da Expedição dos Silfos
    if (Number(req.op) === 6) {
      const index = Number(req.index || req.param1 || 1);
      if (state.activeBattle) throw Error('Batalha em andamento');
      const saved = inventoryState.parseState(state.character.state_json);
      const check = uiplayState.validateRemotePetChallenge(saved, index);
      if (!check.success) throw Error(check.error);
      battleEngine.initiateBattle(state, -index, { remotePetPhase: check.phase });
      log(`[REMOTE PET #${state.id}] op=6: combate visual iniciado na fase ${index}; sem recompensa antecipada.`);
      return;
    }
    // op=7: blitz/sweep da Expedição
    if (Number(req.op) === 7) {
      const sweepIdx = Number(req.sweepIndex || req.param1 || 0);
      const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
        secondarySystemsState.ensureSecondarySystemsState(saved);
        const outcome = uiplayState.blitzRemotePet(saved, sweepIdx, inventoryState.addItem);
        if (!outcome.success) throw Error(outcome.error);
        const remoteWire = originalPb.encode('remotepet.RemotePetMsg',
          secondarySystemsState.formatRemotePetMsg(saved, state.gatewayId));
        const rewardWires = outcome.rewards.map(reward => originalPb.encode('remotepet.RemoteItemMsg', {
          type: 2, count: reward.index,
          items: [{ itemId: -100, count: reward.gold }, ...reward.items]
            .filter(item => item.count > 0).map(item => `${item.itemId},${item.count}`).join('|')
        }));
        return { state: saved, remoteWire, rewardWires, outcome };
      });
      committed = true;
      state.character = await db.characterById(state.gatewayId);
      for (const rewardWire of result.rewardWires) sendGameSession(state, 4967, rewardWire);
      sendGameSession(state, 4964, result.remoteWire);
      sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
      if (result.outcome.rewards.some(reward => reward.items.length)) sendInventorySnapshot(state);
      log(`[REMOTE PET #${state.id}] op=7: blitz ${result.outcome.swept} fases. Gold=+${result.outcome.totalGold}`);
      return;
    }
    if (Number(req.op) === 10) {
      const saved = inventoryState.parseState(state.character.state_json);
      sendGameSession(state, 4964, originalPb.encode('remotepet.RemotePetMsg',
        secondarySystemsState.formatRemotePetMsg(saved, state.gatewayId)));
      return;
    }
    log(`[REMOTE PET #${state.id}] op=${Number(req.op)}: operacao nao implementada.`);
  }catch(err){log(`[REMOTE PET #${state.id}] ${committed ? 'Falha apos gravacao' : 'Operacao rejeitada SEM CONSUMO'}: ${err.message}`)}
  const saved=inventoryState.parseState(state.character.state_json);
  secondarySystemsState.ensureSecondarySystemsState(saved);
  sendGameSession(state,4964,originalPb.encode('remotepet.RemotePetMsg',secondarySystemsState.formatRemotePetMsg(saved,state.gatewayId)));
}

async function handleGuardianReq(state, opcode, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  try {
    if (opcode === 9034) {
      const req=originalPb.decode('combatguardian.CombatGuardianOpReq',body);
      // Nao conceder nivel/estrela gratuitamente. A tabela de upgrade e requisito
      // para liberar op 2/3 na proxima integracao verificada.
      log(`[COMBAT GUARDIAN #${state.id}] op=${req.op} recusada sem consumo: catalogo de guardiao ainda ausente.`);
      const saved=inventoryState.parseState(state.character.state_json);
      secondarySystemsState.ensureSecondarySystemsState(saved);
      sendGameSession(state,4873,originalPb.encode('combatguardian.CombatGuardianOpRes',secondarySystemsState.formatCombatGuardianOpRes(saved)));
      return;
    }

    if (opcode === 8742) {
      const req = originalPb.decode('watch.HeroWatchOpMsg', body);
      const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
        secondarySystemsState.ensureSecondarySystemsState(saved);
        const wList = saved.watch.watchInfo || [];
        let w = wList.find(x => x.gridType === req.gridType && x.gridPos === req.gridPos);
        if (!w) {
          w = { gridType: req.gridType || 1, gridPos: req.gridPos || 1, jion1: 0, jion2: 0, jion3: 0, state: 1 };
          wList.push(w);
        }
        if (req.opType === 2) {
          if (req.jionPos === 1) w.jion1 = 1;
          if (req.jionPos === 2) w.jion2 = 1;
          if (req.jionPos === 3) w.jion3 = 1;
        } else if (req.opType === 3) {
          if (req.jionPos === 1) w.jion1 = 0;
          if (req.jionPos === 2) w.jion2 = 0;
          if (req.jionPos === 3) w.jion3 = 0;
        }
        return { state: saved };
      });

      state.character.state_json = result.state;
      state.character = await db.characterById(state.gatewayId);

      const saved = inventoryState.parseState(result.state);
      sendGameSession(state, 4631, originalPb.encode('watch.HeroWatchMsg', secondarySystemsState.formatHeroWatchMsg(saved)));
      log(`[FATE GUARDIAN #${state.id}] Guardiao do destino operacao op=${req.opType} concluida.`);
    }
  } catch (err) {
    log(`[GUARDIAN #${state.id}] Falha: ${err.message}`);
  }
}

function formatFarmDate(d) {
  const date = d ? new Date(d) : new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function ensureFarmState(saved) {
  if (!saved.farm || typeof saved.farm !== 'object') {
    saved.farm = {
      grades: 1,
      landGrades: 1,
      gp: 0,
      totalGp: 0,
      todayFromFriendGp: 0,
      todayStolenCount: 0,
      todayFeedCount: 0,
      lands: []
    };
  }
  if (!Array.isArray(saved.farm.lands) || saved.farm.lands.length < 3) {
    const existing = Array.isArray(saved.farm.lands) ? saved.farm.lands : [];
    const lands = [];
    for (let p = 0; p < 3; p++) {
      const found = existing.find(l => Number(l.pos) === p);
      if (found) {
        lands.push(found);
      } else {
        lands.push({
          pos: p,
          itemTemplateId: 0,
          plantingTime: formatFarmDate(Date.now() - 3600000),
          matureTime: formatFarmDate(Date.now() - 3600000),
          originMatureTime: formatFarmDate(Date.now() - 3600000),
          accelerateCount: 0,
          stolenCount: 0,
          rewardCount: 0,
          cropState: 0
        });
      }
    }
    saved.farm.lands = lands;
  }
  return saved.farm;
}

async function handleFarmOper(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  try {
    const req = originalPb.decode('farm.FarmOperReqMsg', body);
    const opType = Number(req.opType || 0);
    const pos = Math.max(0, Number(req.pos || 0));
    const reqTemplateId = Number(req.templateId || 0);
    log(`[FARM #${state.id}] Operacao recebida: opType=${opType}, pos=${pos}, templateId=${reqTemplateId}`);

    let questUpdates = [];
    let harvested = false;
    let harvestedReward = 0;

    const result = await db.mutateCharacterState(state.gatewayId, (saved) => {
      const farm = ensureFarmState(saved);
      const land = farm.lands.find(l => Number(l.pos) === pos) || farm.lands[0];

      if (opType === 1) {
        // PLANT
        const seedId = reqTemplateId > 0 ? reqTemplateId : 2160111;
        land.itemTemplateId = seedId;
        land.plantingTime = formatFarmDate(Date.now());
        land.matureTime = formatFarmDate(Date.now() + 60000);
        land.originMatureTime = land.matureTime;
        land.accelerateCount = 0;
        land.rewardCount = 3000;
        land.cropState = 2; // HEALTHY
      } else if (opType === 7) {
        // ACCELERATE
        land.matureTime = formatFarmDate(Date.now() - 5000);
        land.accelerateCount = (Number(land.accelerateCount) || 0) + 1;
      } else if (opType === 4) {
        // PICK / HARVEST
        harvested = true;
        const rewardGold = land.rewardCount > 0 ? Number(land.rewardCount) : 3000;
        harvestedReward = rewardGold;
        if (!saved.wallet) saved.wallet = { gold: 0, balens: 0, boundBalens: 0 };
        saved.wallet.gold = (Number(saved.wallet.gold) || 0) + rewardGold;

        farm.gp = (Number(farm.gp) || 0) + 10;
        farm.totalGp = (Number(farm.totalGp) || 0) + 10;

        land.itemTemplateId = 0;
        land.rewardCount = 0;
        land.accelerateCount = 0;
        land.cropState = 0;
        land.matureTime = formatFarmDate(Date.now());

        const qRes = questState.onHarvestCrop(saved, true, 1);
        if (qRes.changed && qRes.updatedQuests) {
          questUpdates.push(...qRes.updatedQuests);
        }
      }

      const resources = {
        gold: saved.wallet?.gold || 0,
        grade: state.character.grade,
        experience: state.character.experience || 0
      };
      return { state: saved, farm, resources, questUpdates };
    });

    state.character.state_json = result.state;
    if (result.resources) {
      state.character.gold = result.resources.gold;
    }

    const farmData = result.farm || ensureFarmState(result.state);
    const farmRsp = {
      userId: Number(state.gatewayId),
      nickName: state.character.nickname,
      grades: Number(farmData.grades) || 1,
      landGrades: Number(farmData.landGrades) || 1,
      gp: Number(farmData.gp) || 0,
      totalGp: Number(farmData.totalGp) || 0,
      todayFromFriendGp: 0,
      todayStolenCount: 0,
      todayFeedCount: 0,
      farmLandInfo: farmData.lands.map(l => ({
        userId: Number(state.gatewayId),
        pos: Number(l.pos),
        itemTemplateId: Number(l.itemTemplateId || 0),
        plantingTime: l.plantingTime || formatFarmDate(Date.now()),
        matureTime: l.matureTime || formatFarmDate(Date.now()),
        originMatureTime: l.originMatureTime || formatFarmDate(Date.now()),
        accelerateCount: Number(l.accelerateCount || 0),
        stolenCount: Number(l.stolenCount || 0),
        rewardCount: Number(l.rewardCount || 0),
        cropState: Number(l.cropState || 0),
        opType: opType,
        result: 0
      })),
      petInfo: []
    };

    sendGameSession(state, 4386, originalPb.encode('farm.FarmInfoRspMsg', farmRsp));
    sendGameSession(state, 4387, originalPb.encode('farm.FarmInfoRspMsg', farmRsp));
    log(`[FARM #${state.id}] Resposta enviada: Opcode 4386/4387 (op=${opType}, terras=${farmRsp.farmLandInfo.length})`);

    if (harvested) {
      sendGameSession(state, 3, makeBasicPlayerInfo(state.character));
      log(`[FARM #${state.id}] Colheita realizada! +${harvestedReward} ouro entregue.`);
    }

    if (questUpdates.length > 0) {
      sendGameSession(state, 112, originalPb.encode('quest.QuestUpdatedRspMsg',
        questState.formatQuestUpdatedProtocol(result.state, questUpdates)));
      log(`[FARM #${state.id}] Missão de colheita atualizada via Opcode 112: [${questUpdates.map(q => q.templateId).join(', ')}]`);
    }
  } catch (err) {
    log(`[FARM #${state.id}] Erro ao processar operacao da fazenda: ${err.message}`);
  }
}

async function handleItemUse(state, body) {
  // WARTUNE_SYLPH_XP_DIRECT_V4: priorizar a XP de Silfo, mesmo que o
  // item-consumable-state.js local ainda seja anterior a Fase 2.
  if (await require('./sylph-xp-scroll').handle({
    state,body,db,inventoryState,originalPb,itemTemplates,progressionRules,
    secondarySystemsState,sendGameSession,makeBagMoveUpdate,log,
    refreshHero:()=>syncHeroAfterSylph(state)
  })) return;
  // WARTUNE_ITEM_EFFECTS_V3
  if(await require('./item-effects-v3').handle({state,body,db,inventoryState,originalPb,itemTemplates,sendGameSession,makeBagMoveUpdate,log,recoverEnergy:require('./character-repository').recoverTimedEnergy}))return;

  if (!state.gatewayId || !state.character || state.closed) return;
  let req;
  try {
    req = originalPb.decode('item.ItemUseMsg', body);
  } catch (err) {
    log(`[USO_ITEM #${state.id}] Pedido 55 invalido: ${err.message}`);
    return;
  }
  const pos = req.pos;
  const count = Math.max(1, req.count || 1);
  const bagType = req.bagType || 1;

  try {
    const result = await db.mutateCharacterState(state.gatewayId, (raw, locked = {}) => {
      const original = inventoryState.parseState(raw);
      const bag = inventoryState.inventory(original);
      const index = bag.items.findIndex(i => i.bagType === bagType && i.pos === pos);
      if (index < 0) throw Error(`item nao encontrado na posicao ${pos} da bolsa ${bagType}`);
      const item = bag.items[index];
      if (item.count < count) throw Error(`quantidade insuficiente para uso (${item.count} < ${count})`);

      const template = itemTemplates.get(item.templateId);
      if (!template) throw Error(`template ${item.templateId} nao encontrado`);

      const moved = [];
      const mountTemplateId = mountState.mountByItem.get(Number(item.templateId));
      if (mountTemplateId) {
        if (count !== 1) throw Error('Ative uma montaria por vez');
        const activation = mountState.activate(original, mountTemplateId);
        if (!activation.changed) throw Error('Montaria ja ativada; item preservado');
        return { state: original,
          moved: activation.moved.map(change => ({ ...change, ownerId: state.gatewayId })),
          changed: true, isMount: true };
      }

      // Caso seja equipamento (MasterType === 1), equipa automaticamente
      if (template.MasterType === 1) {
        const currentCharacter = {
          ...state.character,
          state_json: original,
          grade: Number.isSafeInteger(locked.grade) ? locked.grade : state.character.grade
        };
        const equipped = inventoryState.equipItem(original, item.instanceId, currentCharacter, id => itemTemplates.get(id));
        const finalSlot = equipped.slot !== undefined ? equipped.slot : 0;
        if ([109, 110, 111, 112].includes(Number(template.SonType))) {
          equipped.state.fashionDisplay = equipped.state.fashionDisplay || { status: '0,0,0,0' };
          const son = Number(template.SonType);
          if (son === 109) equipped.state.fashionDisplay.wingAvata = template.TemplateId;
          if (son === 110) equipped.state.fashionDisplay.hatAvata = template.TemplateId;
          if (son === 111) equipped.state.fashionDisplay.clothAvata = template.TemplateId;
          if (son === 112) equipped.state.fashionDisplay.armAvata = template.TemplateId;
          equipped.state.fashion = equipped.state.fashion || { unlocked: [] };
          let u = equipped.state.fashion.unlocked.find(x => Number(x.templateId || x.tempId) === template.TemplateId);
          if (!u) {
            equipped.state.fashion.unlocked.push({ templateId: template.TemplateId, isSwitch: true, appraisalSkill: 0 });
          } else {
            u.isSwitch = true;
          }
        }
        moved.push(
          { bagType: 1, objectId: 0, pos: item.pos },
          { bagType: 4, objectId: state.gatewayId, ownerId: state.gatewayId, pos: finalSlot, item: equipped.state.inventory.items.find(i => i.instanceId === item.instanceId) }
        );
        if (equipped.swappedInstanceId) {
          const swapped = equipped.state.inventory.items.find(i => i.instanceId === equipped.swappedInstanceId);
          if (swapped) moved.push({ bagType: 1, objectId: 0, ownerId: state.gatewayId, pos: swapped.pos, item: swapped });
        }
        return { state: equipped.state, moved, changed: true, isEquip: true };
      }

      // Sem baixa antecipada: modulo exige um efeito real e validado.
      // Itens desconhecidos geram erro, fazendo rollback da transacao de DB.
      const used=consumables.apply({
        state:original,item,template,count,grade:Number(locked.grade||state.character.grade),
        dropGroups:dropItems,templates:itemTemplates
      });
      return {
        ...used,
        moved:used.moved.map(change=>({...change,ownerId:state.gatewayId})),
        changed:true,
        resources:{
          gold:Number(original.wallet?.gold??locked.gold??0),
          grade:Number(locked.grade??state.character.grade),
          experience:Number(locked.experience??0)
        }
      };
    });

    if (result.changed) {
      state.character.state_json = result.state;
      state.character = await db.characterById(state.gatewayId);

      // O repositorio pode substituir instanceId pelo ID real do banco apos INSERT.
      // Resolvemos cada slot atualizado na bolsa persistida antes de codificar opcode 115.
      const canonicalBag=inventoryState.inventory(inventoryState.parseState(state.character.state_json));
      const canonicalMoves=result.moved.map(change=>{
        if(!change.item)return change;
        const actual=canonicalBag.items.find(i=>i.bagType===change.bagType&&i.pos===change.pos&&
          i.templateId===change.item.templateId);
        if(!actual)throw Error(`Item atualizado nao persistido no slot ${change.pos}; abortando sincronizacao`);
        return {...change,item:actual};
      });
      sendGameSession(state, 115, makeBagMoveUpdate(canonicalMoves), state.gatewayId);

      if (result.energy) {
        const outerVal = Number(result.energy.outerEnergy || result.energy.after || 200);
        sendGameSession(state, 103, originalPb.encode('building.TransInfoMsg', {
          currentEnergy: outerVal,
          remainTime: 0
        }));
        try {
          sendGameSession(state, 4202, originalPb.encode('player.DataResetMsg', {
            transEnergy: outerVal,
            weary: result.energy.after || 200,
            attackCount: 0,
            blessingCount: 0,
            blessingBuff: 0,
            challengeCount: 10
          }));
        } catch (_) {}
      }

      if (result.isEquip) {
        const updatedHero = heroState.heroInfo(state.character);
        sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));
        sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', updatedHero));
        const currentSaved = (typeof state.character.state_json === 'string') ? JSON.parse(state.character.state_json) : (state.character.state_json || result.state);
        if (currentSaved && currentSaved.fashionDisplay) {
          sendGameSession(state, 301, originalPb.encode('simple.FashionInfoMsg', currentSaved.fashionDisplay));
          sendGameSession(state, 4542, originalPb.encode('fashion.FashionMsg', formatFashionBookMsg(currentSaved)));
        }
        if (state.heroSent && state.worldRequested) {
          sendGameSession(state, 169, originalPb.encode('army.ArmyUpdatedGridMsg', { updatedArmy: [heroState.armyInfo(state.character)] }));
        }
      }

      if (result.isMount) {
        sendMountSnapshot(state, inventoryState.parseState(state.character.state_json));
        sendGameSession(state, 113, originalPb.encode('army.SimpleHeroInfoMsg', heroState.heroInfo(state.character)));
      }

      if(result.isSylph){
        const saved=inventoryState.parseState(state.character.state_json);
        sendGameSession(state,4540,originalPb.encode('pet.PlayerPetMsg',
          secondarySystemsState.formatPlayerPetMsg(saved,state.gatewayId,0)));
        sendGameSession(state,113,originalPb.encode('army.SimpleHeroInfoMsg',heroState.heroInfo(state.character)));
        if(result.isSylphXp){
          log(`[SYLPH XP #${state.id}] Pergaminho aplicado: petId=${result.sylph.petId}, XP +${result.sylphXp.added}, nivel ${result.sylphXp.beforeLevel}->${result.sylphXp.afterLevel}.`);
        } else {
          log(`[USO_ITEM #${state.id}] Selo ativado: novo Silfo ${result.sylph.templateId}, petId=${result.sylph.petId}.`);
        }
      }
      if(result.energy){
        sendGameSession(state,113,originalPb.encode('army.SimpleHeroInfoMsg',heroState.heroInfo(state.character)));
        log(`[USO_ITEM #${state.id}] Estamina ${result.energy.before}->${result.energy.after}.`);
      }

      sendGameSession(state, 3, makeBasicPlayerInfo(state.character));

      recorder.recordServerOutcome({
        category: 'inventory',
        handler: 'handleItemUse',
        validations: 'passed',
        persistentChanges: { pos, count, bagType, movedCount: result.moved.length },
        responseOpcode: 115,
        finalState: 'SAVED_DB'
      });

      log(`[USO_ITEM #${state.id}] Item consumido com sucesso na pos ${pos} (x${count}). Resposta 115 enviada.`);
    }
  } catch (err) {
    log(`[USO_ITEM #${state.id}] Falha ao usar item: ${err.message}`);
    recorder.recordServerOutcome({
      category: 'inventory',
      handler: 'handleItemUse',
      validations: 'failed',
      error: err.message,
      finalState: 'REJECTED'
    });
  }
}

// MPD: opcode 5025 e SAIR DA SALA, nao finalizar a campanha.
// O cliente original envia room.RoomExitMsg e espera opcode 15
// com room.RoomExitRspMsg { playerId } para fechar a interface da sala.
async function handleCampaignRoomExit(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  try {
    originalPb.decode('room.RoomExitMsg', body || Buffer.alloc(0));
  } catch (err) {
    log(`[SALA #${state.id}] Saida 5025 invalida: ${err.message}`);
    return;
  }
  const playerId = Number(state.gatewayId);
  const saved = inventoryState.parseState(state.character.state_json);
  if (sylphAtoll.isAtollMap(saved.position?.mapId) || Number(saved.campaigns?.current?.campaignId) === 20000) {
    log(`[SALA #${state.id}] Jogador no Atol dos Silfos solicitou saida da sala (15/5025). Retornando a Cidade das Nuvens...`);
    await exitSylphAtollToCloud(state);
    return;
  }
  const roomId = mpdRooms.memberRooms.get(playerId);
  if (roomId) {
    mpdRooms.leave(roomId, playerId);
    state.mpdEnteredRoomId = null;
  }
  // Responder mesmo quando o estado de sala ja tiver expirado: isso permite
  // que um cliente com tela obsoleta feche a sala sem premiar campanha.
  sendGameSession(state, 15, originalPb.encode('room.RoomExitRspMsg', { playerId }), playerId);
  log(`[SALA #${state.id}] Saida de sala confirmada: playerId=${playerId}, sala=${roomId || 'nao_registrada'}, resposta=15, backend=${__filename}, build=${BUILD_ID}`);
}

// Cliente original: apos criar a sala (5023), o lider define a masmorra
// efetivamente escolhida em RoomHallCtrl.sendOwnerSelCampaign -> opcode 5034.
// RoomReqMsg: roomId, dungeonId (categoria), campaignId (ID UNICO).
// A resposta original do cliente e room.EditRoomRspMsg, opcode 32.
// MPDs de Evento: Torre dos Reis (4 dificuldades) e O Pinaculo (2).
// O t_s_campaign original agrupa essas seis campanhas sob DungeonId=3 e AreaId=300.
// Nao confundir DungeonId (familia) com CampaignId (dificuldade exata).
const MPD_EVENT_CAMPAIGN_IDS = new Set([8200, 8201, 8202, 8203, 8204, 8205]);
function isSupportedMpdRoomTemplate(template) {
  if (!template || !Number(template.AreaId)) return false;
  const group = Number(template.DungeonId);
  if ([1, 2, 4].includes(group)) return true; // MPDs existentes; fluxo intacto.
  if (group !== 3 || Number(template.AreaId) !== 300 ||
      !MPD_EVENT_CAMPAIGN_IDS.has(Number(template.CampaignId))) return false;
  // Verifica o mapa real no t_s_map: 8200->8200 ... 8205->8205.
  const map = campaignState.mapById.get(Number(template.CampaignId));
  return Boolean(map && Number(map.CampaignId) === Number(template.CampaignId));
}

async function handleCampaignRoomEdit(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  const req = originalPb.decode('room.RoomReqMsg', body);
  const playerId = Number(state.gatewayId);
  const roomId = Number(req.roomId);
  const campaignId = Number(req.campaignId);
  const dungeonId = Number(req.dungeonId) || 0;
  const linkedRoomId = mpdRooms.memberRooms.get(playerId);
  if (!Number.isSafeInteger(roomId) || !linkedRoomId || roomId !== linkedRoomId) {
    throw Error('Edicao de sala: ID nao pertence ao jogador autenticado');
  }
  const room = mpdRooms.get(roomId);
  if (room.roomType !== 8 || room.masterId !== playerId) throw Error('Somente lider de sala MPD pode trocar a campanha');
  if (room.state !== 'forming') throw Error('Campanha nao pode ser trocada durante instancia ativa');
  const tpl = campaignState.campaignById.get(campaignId);
  if (!isSupportedMpdRoomTemplate(tpl)) {
    throw Error(`MPD ${campaignId} ausente ou invalida no t_s_campaign`);
  }
  if (dungeonId && dungeonId !== Number(tpl.DungeonId)) {
    throw Error(`DungeonId ${dungeonId} nao corresponde a CampaignId ${campaignId} (categoria oficial ${tpl.DungeonId})`);
  }
  const minLevel = Number(tpl.MinLevel) || 1;
  if (Number(state.character.grade) < minLevel) {
    throw Error(`Nivel insuficiente para ${campaignId}: exige pelo menos ${minLevel}`);
  }
  // MaxLevel = nivel recomendado, NUNCA bloqueia jogadores fortes.
  const initialMapId = campaignState.resolveMapForCampaign(campaignId);
  room.campaignId = campaignId;
  room.capacity = Math.max(1, Math.min(4, Number(tpl.Capacity) || 3));
  room.pendingCampaignSelection = false;
  const reply = {
    roomId: room.roomId, startCampaignId: campaignId,
    masterId: room.masterId, count: room.members.size,
    capacity: room.capacity, passWord: '', roomName: room.name
  };
  sendGameSession(state, 32, originalPb.encode('room.EditRoomRspMsg', reply), playerId);
  log(`[MPD 5034 #${state.id}] Selecao CONFIRMADA: areaId=${tpl.AreaId}, campaignId=${campaignId}, dungeonId=${tpl.DungeonId}, mapa=${initialMapId}, nivel=${state.character.grade}, minimo=${minLevel}, maximo_recomendado=${tpl.MaxLevel}, sala=${room.roomId}, capacidade=${room.capacity}`);
}

async function handleCampaignRoomCreate(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req;
  try {
    req = originalPb.decode('room.RoomReqMsg', body);
  } catch (err) {
    log(`[SALA #${state.id}] Pedido de criacao de sala invalido: ${err.message}`);
    return;
  }

  // Este opcode cria uma sala de campanha. Algumas versoes do cliente original
  // omitem roomType na requisicao 5023 (Protobuf devolve 0).
  // 0 nao pode significar "campanha 1001": normalizamos para sala MPD (8)
  // e aguardamos o 5034, que contem o CampaignId real escolhido na interface.
  const receivedRoomType = Number(req.roomType) || 0;
  const roomType = receivedRoomType === 0 ? 8 : receivedRoomType;
  const clientCampaignId = Number(req.campaignId) || 0;
  const clientDungeonId = Number(req.dungeonId) || 0;
  // A interface original envia roomType=8 no 5023 SEM campaignId. Em seguida,
  // ao abrir a sala, chama 5034 com AreaId selecionado -> CampaignId exato.
  const pendingSelection = roomType === 8 && !clientCampaignId;
  // Placeholder SOMENTE interno para inicializar a estrutura antiga MpdRooms;
  // NUNCA e anunciado como escolha feita nem autorizado para iniciar.
  const campaignId = pendingSelection ? 9000 : (clientCampaignId || 1001);
  const campaignTemplate = campaignState.campaignById.get(campaignId);
  if (!campaignTemplate) throw Error(`Campanha ${campaignId} desconhecida no catalogo`);
  if (roomType === 8) {
    if (!isSupportedMpdRoomTemplate(campaignTemplate)) {
      throw Error(`CampaignId ${campaignId} nao corresponde a MPD valida`);
    }
    if (!pendingSelection && clientDungeonId && clientDungeonId !== Number(campaignTemplate.DungeonId)) {
      throw Error(`DungeonId ${clientDungeonId} incompativel com campanha ${campaignId}`);
    }
    if (!pendingSelection) campaignState.resolveMapForCampaign(campaignId);
  }
  log(`[MPD DIAGNOSTICO #${state.id}] backend=${__filename}, build=${BUILD_ID}, roomTypeRecebido=${receivedRoomType}, roomTypeTratado=${roomType}, req.campaignId=${clientCampaignId}, req.dungeonId=${clientDungeonId}, areaId=${campaignTemplate.AreaId || 0}, pendente_5034=${pendingSelection}`);
  const roomData = mpdRooms.create({
    leaderId: state.gatewayId,
    campaignId,
    grade: Number(state.character.grade || 1),
    minLevel: Number(campaignTemplate.MinLevel || 1),
    // O campo Capacity no catalogo MPD e capacidade total do grupo;
    // nao confundir com 1 jogador presente nem com DungeonId (categoria).
    capacity: roomType === 8 ? Number(campaignTemplate.Capacity) || 3 : Number(req.capacity) || 1,
    roomType, // 5023 com roomType=0 precisa ser tratado como sala MPD, nao PVE comum
    name: 'Sala de '+String(state.character.nickname || 'Heroi'),
    password: String(req.password || '')
  });
  const roomId = roomData.roomId;
  // 5023 sem ID: enviar campaignId=0 na resposta 12 para que o LayaAir,
  // ao abrir o RoomHall, invoque sendOwnerSelCampaign() e envie o 5034.
  // A selecao pendente nunca pode iniciar uma instancia por engano.
  const actualRoom = mpdRooms.get(roomId);
  actualRoom.pendingCampaignSelection = pendingSelection;
  // O cliente LayaAir define xn.NORMAL = 0 (PVE) e xn.MATCH = 1 (PVP).
  // A tag interna 8 significa MPD apenas para nosso gerenciador; nao pode sair na rede.
  const responseRoom = {
    ...roomData,
    roomType: roomType === 8 ? 0 : roomData.roomType,
    campaignId: pendingSelection ? 0 : roomData.campaignId
  };
  log(`[MPD ROOM WIRE #${state.id}] sala=${roomId}, tipoInterno=${roomType}, tipoCliente=${responseRoom.roomType}, campanhaResposta=${responseRoom.campaignId}, pendente5034=${pendingSelection}`);
  const encodedRoom = originalPb.encode('room.RoomMsg', responseRoom);
  sendGameSession(state, 12, encodedRoom, state.gatewayId);
  sendGameSession(state, 5023, encodedRoom, state.gatewayId);

  // Envia Opcode 120 (RoomPlayerListMsg) para que PVE_ROOM_SCENE monte os membros da sala e libere o Iniciar
  const roomPlayer = {
    roomId,
    count: 1,
    currentRoomIndex: 0,
    playerState: 1,
    heroId: state.character?.id || state.gatewayId,
    playerId: state.gatewayId,
    grades: state.character?.grade || 1,
    nickName: state.character?.nickname || "Heroi",
    sex: state.character?.sex || 1,
    templateId: state.character?.job || 1,
    arm: 0,
    cloth: 0,
    armyId: state.gatewayId,
    fightingCapacity: state.character?.fightingCapacity || 10000,
    curPosX: 0,
    curPosY: 0,
    campaignId: pendingSelection ? 0 : campaignId,
    onlineState: true,
    geste: 0,
    headId: 0,
    isVip: false,
    vipType: 0,
    mountTempId: 1000,
    mountGrade: 1,
    wing: 0,
    serverName: "S1",
    job: state.character?.job || 1,
    hp: state.character?.hp || 10000,
    maxHp: state.character?.maxHp || 10000,
    frameId: 0,
    tarIds: [state.gatewayId]
  };
  const encodedPlayerList = originalPb.encode('room.RoomPlayerListMsg', {
    roomPlayer: [roomPlayer],
    state: 1
  });
  sendGameSession(state, 120, encodedPlayerList, state.gatewayId);

  log(`[SALA #${state.id}] Sala PVE ${roomId} criada (master: ${state.gatewayId}); ${pendingSelection ? 'aguardando 5034 para definir CampaignId real' : 'campanha confirmada ' + campaignId}. Opcodes 12 e 120 enviados. backend=${__filename} build=${BUILD_ID}`);
  recorder.recordServerOutcome({
    category: 'room',
    handler: 'handleCampaignRoomCreate',
    validations: 'passed',
    persistentChanges: { roomId, campaignId },
    responseOpcode: 12,
    finalState: 'ROOM_CREATED'
  });
}

async function handleCampaignRoomList(state, body) {
  if (!state.gatewayId || !state.character || state.closed) return;
  let req = {};
  try {
    if (body && body.length > 0) req = originalPb.decode('room.RoomReqMsg', body);
  } catch (_) {}

  const filtered = mpdRooms.list(req.roomType).map(({members,checkpoint,wonNodes,state:roomPhase,...room}) => room);
  const encodedList = originalPb.encode('room.RoomListRspMsg', { room: filtered });
  sendGameSession(state, 13, encodedList, state.gatewayId);
  sendGameSession(state, 5026, encodedList, state.gatewayId);

  log(`[SALA #${state.id}] Lista de salas enviada (total: ${filtered.length}). Resposta 13 enviada.`);
}

function decodeGameBytes(state,chunk) {
  state.pending=Buffer.concat([state.pending,chunk]);
  if(state.pending.length>MAX_WS_MESSAGE){log(`[WS #${state.id}] Mensagem de jogo grande demais, encerrando`);state.socket.end();return;}
  while(state.pending.length>=4){
    let len=peekHeader(state.pending,state.key),useDefault=false,plain=false;
    if(len===null){len=peekHeader(state.pending,DEFAULT_KEY);useDefault=len!==null;}
    if(len===null && state.pending.readUInt16BE(0)===0x71ab){
      len=state.pending.readUInt16BE(2);
      if(len<20||len>MAX_PACKET)len=null;else plain=true;
    }
    if(len===null){
      log(`[WS #${state.id}] Cabecalho nao reconhecido (possivel handshake diferente). Sem logar dados sensiveis.`);
      recorder.recordMalformedPacket('C2S', state.pending.subarray(0, Math.min(state.pending.length, 32)), 'Cabecalho nao reconhecido');
      state.pending=Buffer.alloc(0);return;
    }
    if(state.pending.length<len) return;
    const raw=state.pending.subarray(0,len);
    if(useDefault)state.key=Uint8Array.from(DEFAULT_KEY);
    const decoded=plain?Buffer.from(raw):decrypt(raw,state.key);
    state.pending=state.pending.subarray(len);
    const parsed=parsePacket(decoded);
    stats.packets++;stats.lastCode=parsed.code;diagnosticEvent(parsed,state.id,decoded);
    if(parsed.checksumOK){
      recorder.recordPacket('C2S', parsed.code, decoded.subarray(20), {
        clientId: parsed.clientId || state.gatewayId,
        characterId: state.character?.id,
        socketId: state.id
      });
    } else {
      recorder.recordMalformedPacket('C2S', decoded, `Checksum invalido no pacote ${parsed.code}`);
    }
    if(parsed.code!==20008)log(`[WS #${state.id}] Pacote ${parsed.code} ${CODE_NAMES.get(parsed.code)||'DESCONHECIDO'} | `+
      `${parsed.length} bytes | corpo ${parsed.bodyBytes} | checksum ${parsed.checksumOK?'OK':'INVALIDO'} | `+
      `clientId ${parsed.clientId}`);
    if([28678,28672,28674].includes(parsed.code)){
      state.work=state.work.then(()=>handleLoginFlow(state,parsed,decoded)).catch(e=>log(`[DB] Falha ${parsed.code}:`,e.code||e.message));
    }
    else if(parsed.code===28680) { // L_SYNC_TIME: sincronizacao de horario, nao cadastro.
      state.syncCount=(state.syncCount||0)+1;
      // Original weak-network monitor decrements its heartbeat on this code.
      if(parsed.checksumOK&&state.user)sendGame(state,28680,Buffer.alloc(0));
      if(state.syncCount<=2)log(`[WS #${state.id}] Heartbeat de login 28680 confirmado.`);
    }
    else if(parsed.code===28676) {
      state.work=state.work.then(()=>handleRegister(state,parsed,decoded)).catch(e=>log('[DB] Falha no registro:',e.code||e.message));
    }
    else if(parsed.code===20008) {
      state.work=state.work.then(()=>{
        if(!parsed.checksumOK||!state.gatewayId)return;
        sendWorldClock(state);
      }).catch(e=>log('[HORARIO] Falha:',e.message));
    }
    else if(parsed.code===8224) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleLoginDataRequest(state,decoded.subarray(20)))
          .catch(e=>log(`[8224 #${state.id}] Erro:`,e.message));}
    }
    else if([8220, 5005, 54].includes(parsed.code)) {
      if(parsed.code === 8220) {
        if(parsed.checksumOK){state.work=state.work.then(()=>handleBagArrange(state,decoded.subarray(20)))
          .catch(e=>log(`[BOLSA #${state.id}] Falha ao organizar 8220:`,e.message));}
        else stats.badChecksums++;
      } else {
        if(parsed.checksumOK){state.work=state.work.then(()=>handleItemMove(state,decoded.subarray(20)))
          .catch(e=>log(`[BOLSA #${state.id}] Falha no pedido 54:`,e.message));}
        else stats.badChecksums++;
      }
    }
    else if([86, 5150].includes(parsed.code)) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleItemStrengthen(state,decoded.subarray(20)))
          .catch(e=>log(`[FORTALECER #${state.id}] Falha:`,e.message));}
      else stats.badChecksums++;
    }
    else if([87, 5151].includes(parsed.code)) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleItemInlay(state,decoded.subarray(20)))
          .catch(e=>log(`[INCRUSTAR #${state.id}] Falha:`,e.message));}
      else stats.badChecksums++;
    }
    else if([88, 5152].includes(parsed.code)) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleItemInlayJoin(state,decoded.subarray(20)))
          .catch(e=>log(`[PERFURAR/DESMONTAR #${state.id}] Falha:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8464) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleItemRefreshProperty(state,decoded.subarray(20)))
          .catch(e=>log(`[FERREIRO REFINO #${state.id}] Falha 8464:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8336) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleItemRefreshForRandom(state,decoded.subarray(20)))
          .catch(e=>log(`[FERREIRO REFINO #${state.id}] Falha 8336:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8339) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleItemRefreshForReplace(state,decoded.subarray(20)))
          .catch(e=>log(`[FERREIRO REFINO #${state.id}] Falha 8339:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8866) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handlePetEquipRefine(state,decoded.subarray(20)))
          .catch(e=>log(`[SILFO REFINO #${state.id}] Falha 8866:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8340) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleItemResolve(state,decoded.subarray(20)))
          .catch(e=>log(`[FERREIRO DECOMPOSIÇÃO #${state.id}] Falha 8340:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8594) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleFashionCompose(state,decoded.subarray(20)))
          .catch(e=>log(`[MODA SÍNTESE #${state.id}] Falha 8594:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9525) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleMapBossDatas(state,decoded.subarray(20)))
          .catch(e=>log(`[MAP BOSS #${state.id}] Falha 9525:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9071) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleDragonCrystalMineReq(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[CRISTAIS DE DRAGÃO #${state.id}] Falha 9071:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9588) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleOutCityGoldList(state,decoded.subarray(20)))
          .catch(e=>log(`[CIDADE EXTERIOR #${state.id}] Falha 9588:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 5160) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleArmyAttack(state,decoded.subarray(20)))
          .catch(e=>log(`[CIDADE EXTERIOR ATAQUE #${state.id}] Falha 5160:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 5179) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleUnoccupyWildLand(state,decoded.subarray(20)))
          .catch(e=>log(`[CIDADE EXTERIOR DESOCUPAR #${state.id}] Falha 5179:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 5161) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleArmyReturnHome(state,decoded.subarray(20)))
          .catch(e=>log(`[CIDADE EXTERIOR RETORNO #${state.id}] Falha 5161:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9685) {
      if(parsed.checksumOK){state.work=state.work.then(()=>outerCityState.handleOutCityVehicleFixPos(state,decoded.subarray(20),sendGameSession,originalPb,log,db))
          .catch(e=>log(`[CIDADE EXTERIOR FIXPOS #${state.id}] Falha 9685:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9682) {
      if(parsed.checksumOK){state.work=state.work.then(()=>outerCityState.handleOutCityVehicleInfo(state,decoded.subarray(20),sendGameSession,originalPb,log))
          .catch(e=>log(`[CIDADE EXTERIOR VEHICLE #${state.id}] Falha 9682:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 5181) {
      if(parsed.checksumOK){state.work=state.work.then(()=>outerCityState.handleArmyUpdateGrid(state,decoded.subarray(20),sendGameSession,originalPb,log))
          .catch(e=>log(`[CIDADE EXTERIOR UPDATE GRID #${state.id}] Falha 5181:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8201) {
      if(parsed.checksumOK){state.work=state.work.then(()=>outerCityState.handlePhysicListByGrid(state,decoded.subarray(20),sendGameSession,originalPb,log))
          .catch(e=>log(`[CIDADE EXTERIOR PHYSIC LIST #${state.id}] Falha 8201:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8694) {
      if(parsed.checksumOK){state.work=state.work.then(()=>outerCityState.handleMapBossRevive(state,decoded.subarray(20),sendGameSession,originalPb,log,db))
          .catch(e=>log(`[CIDADE EXTERIOR BOSS REVIVE #${state.id}] Falha 8694:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 4741) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleTreasureMineInfo(state,decoded.subarray(20)))
          .catch(e=>log(`[CIDADE EXTERIOR TESOURO #${state.id}] Falha 4741:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9589) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleArmyAttack(state,decoded.subarray(20)))
          .catch(e=>log(`[CIDADE EXTERIOR COMBATE #${state.id}] Falha 9589:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8801 || parsed.code === 8994) {
      if(!parsed.checksumOK)stats.badChecksums++;
    }
    else if(parsed.code === 5192) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleAdvancedTalentReq(state,decoded.subarray(20)))
          .catch(e=>log(`[TALENTO AVANÇADO #${state.id}] Falha 5192:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8258) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleWorldBossCmd(state,decoded.subarray(20)))
          .catch(e=>log(`[CHEFÃO MUNDIAL #${state.id}] Falha 8258:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9062) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleNavigationReq(state,decoded.subarray(20)))
          .catch(e=>log(`[NAVEGAÇÃO #${state.id}] Falha 9062:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8556) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleTransferReq(state,decoded.subarray(20)))
          .catch(e=>log(`[AVANÇO CLASSE #${state.id}] Falha 8556:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9075) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleGameBoxReq(state,decoded.subarray(20)))
          .catch(e=>log(`[GAME BOX #${state.id}] Falha 9075:`,e.message));}
      else stats.badChecksums++;
    }
    else if([5187, 5188, 5189, 5190].includes(parsed.code)) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleTalentGradeUp(state,decoded.subarray(20)))
          .catch(e=>log(`[TALENTO GRADE UP #${state.id}] Falha ${parsed.code}:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9058) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleGuardExpeditionary(state,decoded.subarray(20)))
          .catch(e=>log(`[EXPEDIÇÃO GUARDIÃO #${state.id}] Falha 9058:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8343) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleConsortiaInfoReq(state,decoded.subarray(20)))
          .catch(e=>log(`[GUILDA #${state.id}] Falha 8343:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8470) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleMarriageInfoReq(state,decoded.subarray(20)))
          .catch(e=>log(`[CASAMENTO #${state.id}] Falha 8470:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9068) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleRareWeaponDrawReq(state,decoded.subarray(20)))
          .catch(e=>log(`[ARMA RARA #${state.id}] Falha 9068:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9040) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleRareWeaponMainReq(state,decoded.subarray(20)))
          .catch(e=>log(`[ARMA RARA #${state.id}] Falha 9040:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9591) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleMailCheck(state,decoded.subarray(20)))
          .catch(e=>log(`[CORREIO #${state.id}] Falha 9591:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8204) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleMailList(state,decoded.subarray(20)))
          .catch(e=>log(`[CORREIO #${state.id}] Falha 8204:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8236) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleDegreeActivityRefresh(state,decoded.subarray(20)))
          .catch(e=>log(`[ATIVIDADES #${state.id}] Falha 8236:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9020) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleWishPoolOp(state,decoded.subarray(20),db,sendGameSession,sendInventorySnapshot,log))
          .catch(e=>log(`[POÇO DOS DESEJOS #${state.id}] Falha 9020:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 197) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleWishPoolInfo(state,db,sendGameSession,log))
          .catch(e=>log(`[POÇO DOS DESEJOS INFO #${state.id}] Falha 197:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8519) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleVipRoulette(state,decoded.subarray(20)))
          .catch(e=>log(`[ROLETA VIP #${state.id}] Falha 8519:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9689) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleConsortiaTaskInfo(state,db,sendGameSession,log))
          .catch(e=>log(`[GUILDA TAREFAS #${state.id}] Falha 9689:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9690) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleConsortiaTaskReward(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[GUILDA TAREFAS #${state.id}] Falha 9690:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9691) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleConsortiaTaskRefresh(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[GUILDA TAREFAS #${state.id}] Falha 9691:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9692) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleConsortiaTaskUpgradeStar(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[GUILDA TAREFAS #${state.id}] Falha 9692:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9568) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleTattooReq(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[TATUAGEM #${state.id}] Falha 9568:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8628) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleFateRequest(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[DESTINO #${state.id}] Falha 8628:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8627) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleFateTurn(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[DESTINO #${state.id}] Falha 8627:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8641) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleFateHide(state,decoded.subarray(20),db,log))
          .catch(e=>log(`[DESTINO #${state.id}] Falha 8641:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8271) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleWorldBossState(state,decoded.subarray(20),sendGameSession,log))
          .catch(e=>log(`[CHEFÃO MUNDIAL #${state.id}] Falha 8271:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8259) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleWorldBossReq(state,decoded.subarray(20),sendGameSession,log))
          .catch(e=>log(`[CHEFÃO MUNDIAL #${state.id}] Falha 8259:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9060) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleGuardArenaReq(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[ARENA GUARDIÃO #${state.id}] Falha 9060:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8869) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleMedalItem(state,decoded.subarray(20),db,log))
          .catch(e=>log(`[MEDALHA #${state.id}] Falha 8869:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8877) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleHonorEquipLevelUp(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[EQUIPAMENTO HONRA #${state.id}] Falha 8877:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8785) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleSevenTargetInfo(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[SETE METAS #${state.id}] Falha 8785:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8786) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleSevenTargetTaskReceive(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[SETE METAS #${state.id}] Falha 8786:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8802) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleMountUpStar(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[MONTARIA ESTRELA #${state.id}] Falha 8802:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8629) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleGameStoryReq(state,decoded.subarray(20),sendGameSession,log))
          .catch(e=>log(`[HISTÓRIA #${state.id}] Falha 8629:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8854) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleRuneResolve(state,decoded.subarray(20),db,sendGameSession,sendInventorySnapshot,log))
          .catch(e=>log(`[RUNA #${state.id}] Falha 8854:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8855) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleRuneUp(state,decoded.subarray(20),db,sendGameSession,sendInventorySnapshot,log))
          .catch(e=>log(`[RUNA #${state.id}] Falha 8855:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8605) {
      if(parsed.checksumOK){state.work=state.work.then(()=>handleHeroRuneOp(state,decoded.subarray(20)))
          .catch(e=>log(`[RUNE OP #${state.id}] Falha 8605:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8804) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handlePassTaskInfo(state,db,sendGameSession,log))
          .catch(e=>log(`[PASS TASK #${state.id}] Falha 8804:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8805) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handlePassTaskFresh(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[PASS TASK FRESH #${state.id}] Falha 8805:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8803) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handlePassRewardInfo(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[PASS REWARD #${state.id}] Falha 8803:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9076) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleSeasonPassReq(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[SEASON PASS #${state.id}] Falha 9076:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9098) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleGuildMazeOp(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[GUILD MAZE #${state.id}] Falha 9098:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8541) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleConsortiaAltarOpen(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[ALTAR GUILDA #${state.id}] Falha 8541:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8542) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleConsortiaAltarEnter(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[ALTAR GUILDA #${state.id}] Falha 8542:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8231) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleFarmInfoReq(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[FAZENDA #${state.id}] Falha 8231:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8773) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleDivineTreeReq(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[ARVORE SAGRADA #${state.id}] Falha 8773:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8746) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleTreasureMapReq(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[MAPA TESOURO #${state.id}] Falha 8746:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8744) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleTreasureMapOp(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[MAPA TESOURO OP #${state.id}] Falha 8744:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8753) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleTollgateReq(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[TOLLGATE #${state.id}] Falha 8753:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8636) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleSinglePassAreaUpdate(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[SINGLE PASS #${state.id}] Falha 8636:`,e.message));}
      else stats.badChecksums++;
    }

    else if(parsed.code === 8329) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleSoloChallengeReward(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[ARENA SOLO REWARD #${state.id}] Falha 8329:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8724) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handlePetChallengeInfo(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[PET CHALLENGE #${state.id}] Falha 8724:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9712) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleMarriageReq(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[CASAMENTO REQ #${state.id}] Falha 9712:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 9713) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleMarriageHeart(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[CASAMENTO HEART #${state.id}] Falha 9713:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 4993 || parsed.code === 4992) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleWishRecruitReq(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[WISH RECRUIT #${state.id}] Falha ${parsed.code}:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 776) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleWishRecruitReward(state,decoded.subarray(20),db,sendGameSession,sendInventorySnapshot,log))
          .catch(e=>log(`[WISH RECRUIT REWARD #${state.id}] Falha 776:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8633) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleMineFieldReq(state,decoded.subarray(20),db,sendGameSession,log,handleCampaignEnter))
          .catch(e=>log(`[CAMPO DE MINAS #${state.id}] Falha 8633:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8554) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleConsortiaPveReq(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[GUILDA PVE #${state.id}] Falha 8554:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8847 || parsed.code === 4738 || parsed.code === 4739) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleConsortiaBossReq(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[CHEFÃO DA GUILDA #${state.id}] Falha ${parsed.code}:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8779) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleBattlefieldReq(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[CAMPO DE BATALHA #${state.id}] Falha ${parsed.code}:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8780) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleAchievementReq(state,decoded.subarray(20),db,sendGameSession,log))
          .catch(e=>log(`[CONQUISTAS #${state.id}] Falha 8780:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8790) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleSevenSignInfo(state,db,sendGameSession,log))
          .catch(e=>log(`[SETE DIAS #${state.id}] Falha 8790:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8789) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleSevenSignReceive(state,decoded.subarray(20),db,sendGameSession,sendInventorySnapshot,log))
          .catch(e=>log(`[SETE DIAS #${state.id}] Falha 8789:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8513) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleVipInfo(state,sendGameSession,log))
          .catch(e=>log(`[VIP #${state.id}] Falha 8513:`,e.message));}
      else stats.badChecksums++;
    }
    else if(parsed.code === 8504) {
      if(parsed.checksumOK){state.work=state.work.then(()=>extendedSubsystems.handleVipOpenGift(state,decoded.subarray(20),db,sendGameSession,sendInventorySnapshot,log))
          .catch(e=>log(`[VIP #${state.id}] Falha 8504:`,e.message));}
      else stats.badChecksums++;
    }
    else if([5007,8624].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleSale(state,decoded.subarray(20),parsed.code===8624)).catch(e=>log('[VENDA]',e.message));
    }
    else if(parsed.code===5015){
      if(parsed.checksumOK)state.work=state.work.then(()=>synchronizeResources(state)).catch(e=>log('[RECURSOS]',e.message));
    }
    else if([5004,5181].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleWorldRequest(state)).catch(e=>log(`[MUNDO #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8281){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleCastleBuildingInit(state)).catch(e=>log(`[CASTLE #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8203){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleBuildingUpgrade(state,decoded.subarray(20))).catch(e=>log(`[UPGRADE #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8279){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleLoadBuildOrder(state)).catch(e=>log(`[BUILD ORDER #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8784){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleGradePacket(state,decoded.subarray(20))).catch(e=>log(`[GRADE PACKET #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8219 || parsed.code===20010){
      // 8219: C_TREE_FRIEND, 20010: C_CHECK_ACCELERATOR - pings rotineiros
      if(!parsed.checksumOK)stats.badChecksums++;
    }
    else if(parsed.code===8747){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleEnterCastle(state)).catch(e=>log(`[ENTER CASTLE #${state.id}] ${e.message}`));
    }
    else if([92, 5155].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleArmyRecruit(state,decoded.subarray(20))).catch(e=>log(`[RECRUIT #${state.id}] ${e.message}`));
    }
    else if([95, 5158].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleArmyUpgrade(state,decoded.subarray(20))).catch(e=>log(`[UPGRADE PAWN #${state.id}] ${e.message}`));
    }
    else if([93, 5156].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleArmyEdit(state,decoded.subarray(20))).catch(e=>log(`[ARMY EDIT #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8276){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleArmyPosEdit(state,decoded.subarray(20))).catch(e=>log(`[ARMY POS #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8688){
      if(parsed.checksumOK)state.work=state.work.then(()=>handlePlayerSpaceEnter(state,decoded.subarray(20))).catch(e=>log(`[SPACE ENTER #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8689){
      if(parsed.checksumOK)state.work=state.work.then(()=>handlePlayerSpaceLeave(state,decoded.subarray(20))).catch(e=>log(`[SPACE LEAVE #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8690){
      if(parsed.checksumOK)state.work=state.work.then(()=>handlePlayerSpaceMove(state,decoded.subarray(20))).catch(e=>log(`[SPACE MOVE #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8692){
      if(parsed.checksumOK)state.work=state.work.then(()=>handlePlayerSpaceNodeTrigger(state,decoded.subarray(20))).catch(e=>log(`[SPACE NPC #${state.id}] ${e.message}`));
    }
    else if(parsed.code===9525){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleWildBossInfo(state,decoded.subarray(20))).catch(e=>log(`[WILD BOSS INFO #${state.id}] ${e.message}`));
    }
    else if([90, 5154].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleShopBuy(state,decoded.subarray(20))).catch(e=>log(`[SHOP #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8592){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleShopBuy(state,decoded.subarray(20),true)).catch(e=>log(`[MODA #${state.id}] ${e.message}`));
    }
    else if([8530, 8567, 8529, 8532, 8533, 8536].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleMountCommand(state,parsed.code,decoded.subarray(20))).catch(e=>log(`[MOUNT #${state.id}] ${e.message}`));
    }
    else if(parsed.code===5174){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleBuildingUpEnergy(state,decoded.subarray(20))).catch(e=>log(`[PORTAO MISTICO #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8297){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleTowerInfo(state,decoded.subarray(20))).catch(e=>log(`[TOWER INFO #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8296){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleTowerEnter(state,decoded.subarray(20))).catch(e=>log(`[TOWER ENTER #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8299){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleTowerReset(state,decoded.subarray(20))).catch(e=>log(`[TOWER RESET #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8300){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleTowerLive(state,decoded.subarray(20))).catch(e=>log(`[TOWER LIVE #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8218){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleShopData(state)).catch(e=>log(`[LOJA #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8256){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleChallengeInfo(state)).catch(e=>log(`[ARENA INFO #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8253){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleChallenge(state,decoded.subarray(20))).catch(e=>log(`[ARENA CHALLENGE #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8879){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleChallengeReward(state,decoded.subarray(20))).catch(e=>log(`[ARENA REWARD #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8329){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleTakeChallengeReward(state,decoded.subarray(20))).catch(e=>log(`[ARENA RANK REWARD #${state.id}] ${e.message}`));
    }
    else if([60, 5185].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleSkillUpgrade(state,decoded.subarray(20))).catch(e=>log(`[SKILL UPGRADE #${state.id}] ${e.message}`));
    }
    else if([64, 5167].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleSetFastKey(state,decoded.subarray(20))).catch(e=>log(`[FASTKEY #${state.id}] ${e.message}`));
    }
    else if([61, 5170, 5184].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleSkillReset(state,decoded.subarray(20))).catch(e=>log(`[SKILL RESET #${state.id}] ${e.message}`));
    }
    else if([59, 5008].includes(parsed.code)){
      if(parsed.checksumOK){
        state.work=state.work.then(async ()=>{
          state.character=await db.characterById(state.gatewayId);
          const updatedHero=heroState.heroInfo(state.character);
          sendGameSession(state,113,originalPb.encode('army.SimpleHeroInfoMsg',updatedHero));
          sendGameSession(state,113,originalPb.encode('army.SimpleHeroInfoMsg',updatedHero));
          if(state.heroSent&&state.worldRequested){
            sendGameSession(state,169,originalPb.encode('army.ArmyUpdatedGridMsg',{updatedArmy:[heroState.armyInfo(state.character)]}));
          }
        }).catch(e=>log(`[HERO REQ #${state.id}] ${e.message}`));
      }
    }
    else if([301, 8625].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleFashionInfo(state,decoded.subarray(20))).catch(e=>log(`[FASHION #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8594){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleFashionCompose(state,decoded.subarray(20))).catch(e=>{
        log(`[FASHION COMPOSE #${state.id}] ${e.message}`);
        sendGameSession(state,4487,originalPb.encode('store.StoreRspMsg',{composeResult:false}));
      });
    }
    else if(parsed.code===8595){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleFashionSwitch(state,decoded.subarray(20))).catch(e=>log(`[FASHION SWITCH #${state.id}] ${e.message}`));
    }
    else if(parsed.code===9582){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleFashionExchange(state,decoded.subarray(20))).catch(e=>log(`[FASHION EXCHANGE #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8781){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleFashionAppraisal(state,decoded.subarray(20))).catch(e=>log(`[FASHION APPRAISAL #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8631){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleFashionSpecial(state,decoded.subarray(20))).catch(e=>log(`[FASHION SPECIAL #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8254){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleMovement(state,decoded.subarray(20))).catch(e=>log(`[MOVIMENTO #${state.id}] ${e.message}`));
    }
    else if(parsed.code===5127){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleTutorialTraining(state,decoded.subarray(20))).catch(e=>log(`[TUTORIAL #${state.id}] ${e.message}`));
    }
    else if([1, 5017].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleNoviceProcess(state,decoded.subarray(20))).catch(e=>log(`[NOVICE #${state.id}] ${e.message}`));
    }
    else if([20, 5038].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleCampaignSystemArmy(state,decoded.subarray(20))).catch(e=>log(`[CAMPAIGN ARMY #${state.id}] ${e.message}`));
    }
    else if([21, 5039].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleCampaignEnter(state,decoded.subarray(20))).catch(e=>log(`[CAMPAIGN ENTER #${state.id}] ${e.message}`));
    }
    else if([9, 5125].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleCampaignArrive(state,decoded.subarray(20))).catch(e=>log(`[ARRIVE #${state.id}] ${e.message}`));
    }
    else if([31, 5032].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleCampaignCallback(state,decoded.subarray(20))).catch(e=>log(`[CALLBACK #${state.id}] ${e.message}`));
    }
    else if(parsed.code===5012){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleQuestAdd(state,decoded.subarray(20))).catch(e=>log(`[QUEST ADD #${state.id}] ${e.message}`));
    }
    else if([52, 5014].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleQuestFinish(state,decoded.subarray(20))).catch(e=>log(`[QUEST FINISH #${state.id}] ${e.message}`));
    }
    else if([15, 5025].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleCampaignRoomExit(state,decoded.subarray(20))).catch(e=>log(`[SALA EXIT #${state.id}] ${e.message}`));
    }
    else if([22, 134, 5120, 5180].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleCampaignFinish(state,decoded.subarray(20))).catch(e=>log(`[FINISH #${state.id}] ${e.message}`));
    }
    else if([26,5122].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleCampaignCard(state,decoded.subarray(20))).catch(e=>log(`[CARD #${state.id}] ${e.message}`));
    }
    else if([10, 5123, 5124, 8201].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleCampaignMovement(state,decoded.subarray(20))).catch(e=>log(`[CAMPAIGN MOVE #${state.id}] ${e.message}`));
    }
    else if(parsed.code===10007){
      if(parsed.checksumOK)state.work=state.work.then(()=>battleEngine.handleLoadOver(state,decoded.subarray(20))).catch(e=>log(`[BATTLE LOADOVER #${state.id}] ${e.message}`));
    }
    else if(parsed.code===10008){
      if(parsed.checksumOK)state.work=state.work.then(()=>battleEngine.handleHeroOrder(state,decoded.subarray(20))).catch(e=>log(`[BATTLE HERO ORDER #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8196){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleNodeLockState(state,decoded.subarray(20))).catch(e=>log(`[CAMPAIGN LOCK #${state.id}] ${e.message}`));
    }
    else if([55, 5006].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleItemUse(state,decoded.subarray(20))).catch(e=>log(`[USO_ITEM #${state.id}] ${e.message}`));
    }
    else if([12, 5023].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleCampaignRoomCreate(state,decoded.subarray(20))).catch(e=>log(`[SALA #${state.id}] ${e.message}`));
    }
    else if(parsed.code===5034){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleCampaignRoomEdit(state,decoded.subarray(20))).catch(e=>log(`[MPD 5034 #${state.id}] ${e.message}`));
    }
    else if([13, 5026].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleCampaignRoomList(state,decoded.subarray(20))).catch(e=>log(`[SALA #${state.id}] ${e.message}`));
    }
    else if([89, 5153].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleItemCompose(state,decoded.subarray(20))).catch(e=>log(`[COMPOSE #${state.id}] ${e.message}`));
    }
    else if([94, 5157].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleArmyDemob(state,decoded.subarray(20))).catch(e=>log(`[DEMOB #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8266){
      if(parsed.checksumOK)state.work=state.work.then(()=>handlePlayerSignCmd(state,decoded.subarray(20))).catch(e=>log(`[SIGN #${state.id}] ${e.message}`));
    }
    else if([8528, 4425].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleCampaignSweep(state,decoded.subarray(20))).catch(e=>log(`[CAMPAIGN SWEEP #${state.id}] ${e.message}`));
    }
    else if([15044, 8231].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleFarmOper(state,decoded.subarray(20))).catch(e=>log(`[FARM #${state.id}] ${e.message}`));
    }
    else if([8269].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleStarRand(state,decoded.subarray(20))).catch(e=>log(`[STAR RAND #${state.id}] ${e.message}`));
    }
    else if([8268].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleStarPick(state,decoded.subarray(20))).catch(e=>log(`[STAR PICK #${state.id}] ${e.message}`));
    }
    else if([8267].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleStarMove(state,decoded.subarray(20))).catch(e=>log(`[STAR MOVE #${state.id}] ${e.message}`));
    }
    else if([8331].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleStarCompose(state,decoded.subarray(20))).catch(e=>log(`[STAR COMPOSE #${state.id}] ${e.message}`));
    }
    else if([8330].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleStarLock(state,decoded.subarray(20))).catch(e=>log(`[STAR LOCK #${state.id}] ${e.message}`));
    }
    else if([8794].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleStarBatchOp(state,decoded.subarray(20))).catch(e=>log(`[STAR BATCH #${state.id}] ${e.message}`));
    }
    else if([8858].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleStarArrange(state)).catch(e=>log(`[STAR ARRANGE #${state.id}] ${e.message}`));
    }
    else if([8876].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleStarSpecial(state,decoded.subarray(20))).catch(e=>log(`[STAR SPECIAL #${state.id}] ${e.message}`));
    }
    else if([8341].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleStarShopBuy(state,decoded.subarray(20))).catch(e=>log(`[STAR SHOP #${state.id}] ${e.message}`));
    }
    else if([9041].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleStargazingOp(state,decoded.subarray(20))).catch(e=>log(`[STARGAZING #${state.id}] ${e.message}`));
    }
    else if([8200].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleSimpleUserInfo(state,decoded.subarray(20))).catch(e=>log(`[USER INFO #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8484){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleSoulStoreUse(state,decoded.subarray(20))).catch(e=>log(`[SOUL STORE #${state.id}] ${e.message}`));
    }
    else if([8702, 8621].includes(parsed.code)){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleSylphReq(state,parsed.code,decoded.subarray(20))).catch(e=>log(`[SYLPH #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8725){
      if(parsed.checksumOK)state.work=state.work.then(()=>handlePetChallengeFormationReq(state,decoded.subarray(20))).catch(e=>log(`[SYLPH ARENA FORMATION #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8726){
      if(parsed.checksumOK)state.work=state.work.then(()=>handlePetChallengeSkillReq(state,decoded.subarray(20))).catch(e=>log(`[SYLPH ARENA #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8757){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleUiPlayChallenge(state,decoded.subarray(20))).catch(e=>log(`[UIPLAY #${state.id}] ${e.message}`));
    }
    else if(parsed.code===9544){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleRemotePetReq(state,decoded.subarray(20))).catch(e=>log(`[REMOTE PET #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8742){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleGuardianReq(state,parsed.code,decoded.subarray(20))).catch(e=>log(`[HERO WATCH #${state.id}] ${e.message}`));
    }
    else if(parsed.code===9034){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleCombatGuardianReqCmd(state,decoded.subarray(20))).catch(e=>log(`[COMBAT GUARDIAN #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8608){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleExtraJobReq(state,decoded.subarray(20))).catch(e=>log(`[EXTRAJOB #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8609){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleExtraJobEquipReq(state,decoded.subarray(20))).catch(e=>log(`[EXTRAJOB EQUIP #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8597){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleAppellExchangeCmd(state,decoded.subarray(20))).catch(e=>log(`[APPELL #${state.id}] ${e.message}`));
    }
    else if(parsed.code===9584){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleRuneHoleInfoCmd(state,decoded.subarray(20))).catch(e=>log(`[RUNE HOLE INFO #${state.id}] ${e.message}`));
    }
    else if(parsed.code===9585){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleRuneHoleOpCmd(state,decoded.subarray(20))).catch(e=>log(`[RUNE HOLE OP #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8853){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleEquipRuneStoneCmd(state,decoded.subarray(20))).catch(e=>log(`[RUNE EQUIP #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8856){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleRuneUnloadCmd(state,decoded.subarray(20))).catch(e=>log(`[RUNE UNLOAD #${state.id}] ${e.message}`));
    }
    else if(parsed.code===9033){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleDragonSoulReqCmd(state,decoded.subarray(20))).catch(e=>log(`[DRAGON SOUL #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8466){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleRefiningSoulCmd(state,decoded.subarray(20))).catch(e=>log(`[SOUL REFINING #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8288){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleBountyRefreshCmd(state,decoded.subarray(20))).catch(e=>log(`[BOUNTY REFRESH #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8290){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleBountyFinishCmd(state,decoded.subarray(20))).catch(e=>log(`[BOUNTY FINISH #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8857){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleLotteryRune(state,decoded.subarray(20))).catch(e=>log(`[LOTTERY RUNE #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8450){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleMarketInfoReq(state,decoded.subarray(20))).catch(e=>log(`[MARKET #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8711){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleLordsMainBoard(state,decoded.subarray(20))).catch(e=>log(`[LORDS BOARD #${state.id}] ${e.message}`));
    }
    else if(parsed.code===9972){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleGrowthFundLevel(state,decoded.subarray(20))).catch(e=>log(`[GROWTH FUND #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8791){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleGrowthFundInfo(state,decoded.subarray(20))).catch(e=>log(`[GROWTH FUND INFO #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8792){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleGrowthFundReceive(state,decoded.subarray(20))).catch(e=>log(`[GROWTH FUND RECEIVE #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8782){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleOnlineReward(state,decoded.subarray(20))).catch(e=>log(`[ONLINE REWARD #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8788){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleOnlineRewardEnsure(state,decoded.subarray(20))).catch(e=>log(`[ONLINE REWARD ENSURE #${state.id}] ${e.message}`));
    }
    else if(parsed.code===8327){
      if(parsed.checksumOK)state.work=state.work.then(()=>handleGoldImpose(state,decoded.subarray(20))).catch(e=>log(`[IMPOSTOS #${state.id}] ${e.message}`));
    }
    else if([8801, 8994].includes(parsed.code)){
      if(!parsed.checksumOK)stats.badChecksums++;
    }
    else if(parsed.code===20001) {
      state.work=state.work.then(()=>handleGatewayLogin(state,parsed,decoded))
        .catch(e=>log(`[GATEWAY #${state.id}] Falha:`,e.code||e.message));
    }
    else {
      log(`[WS #${state.id}] Mensagem ${parsed.code} sem handler validado; registrando somente metadados.`);
      if([9370,9645].includes(parsed.code)) log(`[MAPA] ${parsed.code} apareceu apos PLAYER_INFO em testes anteriores. Sem resposta inventada.`);
    }
  }
}

function sendControl(socket,opcode,payload=Buffer.alloc(0)) {
  if(socket.destroyed)return;
  if(payload.length>125)payload=payload.subarray(0,125);
  socket.write(Buffer.concat([Buffer.from([0x80|opcode,payload.length]),payload]));
}
function closeWs(state,code=1000){
  if(state.closed)return;state.closed=true;
  const p=Buffer.alloc(2);p.writeUInt16BE(code);
  sendControl(state.socket,8,p);state.socket.end();
}
function handleWsData(state, chunk){
  state.frames=Buffer.concat([state.frames,chunk]);
  if(state.frames.length>MAX_WS_MESSAGE+64){closeWs(state,1009);return;}
  while(state.frames.length>=2){
    const b0=state.frames[0], b1=state.frames[1];
    const final=!!(b0&0x80), opcode=b0&15, masked=!!(b1&0x80);
    let length=b1&127, pos=2;
    if(!masked){
      recorder.recordMalformedPacket('C2S', state.frames.subarray(0, 16), 'WebSocket frame nao mascarado');
      closeWs(state,1002);
      return;
    }
    if(length===126){if(state.frames.length<4)return;length=state.frames.readUInt16BE(2);pos=4;}
    if(length===127){if(state.frames.length<10)return;
      const big=state.frames.readBigUInt64BE(2);
      if(big>BigInt(MAX_WS_MESSAGE)){closeWs(state,1009);return;}
      length=Number(big);pos=10;
    }
    if(length>MAX_WS_MESSAGE){closeWs(state,1009);return;}
    if(state.frames.length<pos+4+length)return;
    const mask=state.frames.subarray(pos,pos+4), payload=Buffer.from(state.frames.subarray(pos+4,pos+4+length));
    for(let i=0;i<length;i++)payload[i]^=mask[i%4];
    state.frames=state.frames.subarray(pos+4+length);
    if(opcode===8){closeWs(state);return;}
    if(opcode===9){sendControl(state.socket,10,payload);continue;}
    if(opcode===10)continue;
    if(opcode===2||opcode===0){
      if(opcode===2 && state.fragmentOpcode!==null){closeWs(state,1002);return;}
      if(opcode===0 && state.fragmentOpcode===null){closeWs(state,1002);return;}
      if(opcode===2)state.fragmentOpcode=2;
      state.parts.push(payload);state.partSize+=payload.length;
      if(state.partSize>MAX_WS_MESSAGE){closeWs(state,1009);return;}
      if(final){const message=Buffer.concat(state.parts);state.parts=[];state.partSize=0;state.fragmentOpcode=null;
        stats.binaryFrames++;decodeGameBytes(state,message);}
    } else {closeWs(state,1003);return;}
  }
}
const wsHttp=http.createServer((req,res)=>reply(res,426,'WebSocket requerido'));
const sessions=new Set();
let nextID=0;
wsHttp.on('upgrade',(req,socket,head)=>{
  const origin=req.headers.origin;
  const url=new URL(req.url||'/',`http://${HOST}:${WS_PORT}`);
  const isLocalOrigin = !origin || ORIGINS.has(origin) || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin);
  const valid=req.method==='GET'&&url.pathname==='/ws'&&req.headers.upgrade?.toLowerCase()==='websocket'&&
    req.headers['sec-websocket-version']==='13' && /^[A-Za-z0-9+/]{22}==$/.test(req.headers['sec-websocket-key']||'') &&
    isLocalOrigin;
  if(!valid){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const state={id:++nextID,socket,closed:false,user:null,site:null,frames:Buffer.alloc(0),pending:Buffer.alloc(0),
    fragmentOpcode:null,parts:[],partSize:0,key:Uint8Array.from(DEFAULT_KEY),txKey:Uint8Array.from(DEFAULT_KEY),work:Promise.resolve()};
  sessions.add(state);
  stats.wsConnected++;stats.wsTotal++;
  log(`[WS #${state.id}] CONECTOU ${APP_VERSION} build=${BUILD_ID} pid=${process.pid} porta=${WS_PORT} | conexões abertas: ${stats.wsConnected}`);
  socket.on('data',b=>handleWsData(state,b));
  socket.on('close',()=>{if(state.gatewayId)mpdRooms.disconnect(state.gatewayId);state.closed=true;battleEngine.cancelBattle(state);clearSessionTimers(state);sessions.delete(state);if(state.sceneTimer)clearTimeout(state.sceneTimer);stats.wsConnected--;log(`[WS #${state.id}] Desconectou`);});
  socket.on('error',e=>log(`[WS #${state.id}] ${e.message}`));
  if(head.length)handleWsData(state,head);
});
let compat8899 = null;
async function stop(){
 for(const state of sessions){state.closed=true;battleEngine.cancelBattle(state);clearSessionTimers(state);if(state.sceneTimer)clearTimeout(state.sceneTimer);state.socket.destroy();}
 const srvs = [api,wsHttp,gameHttp];
 if (compat8899) srvs.push(compat8899);
 await Promise.all(srvs.map(server=>new Promise(resolve=>{if(!server.listening)return resolve();server.close(resolve);server.closeIdleConnections?.();})));
 await db.close?.();
}
function listen(server,port,label){return new Promise((resolve,reject)=>{
 const onError=e=>{server.removeListener('listening',onListen);reject(e);};
 const onListen=()=>{server.removeListener('error',onError);log(`[${label} OK] 127.0.0.1:${port}`);resolve();};
 server.once('error',onError);server.once('listening',onListen);server.listen(port,HOST);
});}
async function start(){
  if(!webroot)throw Error('Cliente original nao localizado; confira webroot.path.txt.');
  await db.init();
  await attributeCalculator.initFromDb(db.ready());
  log('[ATTRIBUTES OK] Motor de calculo em 6 camadas inicializado a partir do MariaDB.');
  log('[DB OK] Conexao local confirmada; nenhum segredo sera exibido.');
  log(`[VERSAO] Wartune Ultra ${APP_VERSION} | pasta=${__dirname} | PID=${process.pid} | modo=${APP_ENVIRONMENT} | build=${BUILD_ID}`);
  try{
    await listen(api,API_PORT,'HTTP/API');
    await listen(wsHttp,WS_PORT,'WebSocket');
    await listen(gameHttp,GAME_PORT,'Cliente');
    try {
      compat8899 = http.createServer((req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Max-Age': '86400'
          });
          return res.end();
        }
        if ((req.method === 'POST' || req.method === 'GET') && (req.url === '/order/clientsiteinfoservlet' || req.url === '/clientsiteinfoservlet' || req.url.includes('clientsiteinfoservlet'))) {
          const payload = zlib.deflateSync(Buffer.from(JSON.stringify(listData()), 'utf8'));
          stats.lists++;
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Expose-Headers': 'Content-Length',
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(payload.length),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
          });
          res.end(payload);
          log(`[Compat8899] Lista enviada (${payload.length} bytes, zlib) | pedidos: ${stats.lists}`);
          return;
        }
        proxyStaticAsset(req, res);
      });
      compat8899.on('error', err => {
        log(`[Compat8899 AVISO] Falha ao escutar na porta 8899 (${err.code}): ${err.message}`);
      });
      await listen(compat8899, 8899, 'Compatibilidade 8899').catch(e => {
        log(`[Compat8899 INFO] Porta 8899 ignorada: ${e.message}`);
      });
    } catch(err) {
      log(`[Compat8899 INFO] Servidor de compatibilidade 8899 nao iniciado: ${err.message}`);
    }
  }catch(e){await stop();throw e;}
  log(`[DIAGNOSTICO] http://${HOST}:${API_PORT}/diagnostico`);
  log(`[ETAPAS] http://${HOST}:${API_PORT}/etapas-inicializacao`);
  log(`[CENA] http://${HOST}:${API_PORT}/estado-cena`);
  log(`[MAPA] ${WORLD_MAP.name} Id=${WORLD_MAP.id} MapFileId=${WORLD_MAP.fileId}: http://${HOST}:${API_PORT}/diagnostico-mapa`);
  log(`[ERROS CLIENTE] http://${HOST}:${API_PORT}/erros-cliente (somente RAM)`);
  log(`[PRONTO] Banco=conectado HTTP=ativo WebSocket=ativo | URL=http://${HOST}:${GAME_PORT}/index.html | bootstrap=${INIT_EXPERIMENTAL?'experimental-parcial':'desligado'}`);
}
for(const server of [api,wsHttp,gameHttp]){
  server.on('error',e=>{
    log(`[ERRO SERVIDOR] ${e.code||'E_UNKNOWN'}; instancia local entrando em encerramento seguro.`);
    process.exitCode=1;void stop().catch(closeError=>log(`[ERRO ENCERRAMENTO] ${closeError.code||'E_UNKNOWN'}`));
  });
}
if(require.main===module){
 process.on('uncaughtException', err => {
   log(`[UNCAUGHT EXCEPTION] ${err.message}\n${err.stack}`);
 });
 process.on('unhandledRejection', reason => {
   log(`[UNHANDLED REJECTION] ${reason && reason.stack ? reason.stack : reason}`);
 });
 for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>stop().catch(()=>{process.exitCode=1;}));
 start().catch(async e=>{console.error('[INICIO ERRO]',e.code||e.message);process.exitCode=1;await stop();});
}
module.exports={start,stop,api,wsHttp,gameHttp,buildId:BUILD_ID,version:APP_VERSION,worldMap:WORLD_MAP,locateWebroot,sendWorldClock,inspectPbShape,decodeGameBytes, decrypt,encrypt,peekHeader,parsePacket,makePacket,readGatewayRequest, makeBasicPlayerInfo,makeSignInfo,handleLoginDataRequest,trySceneState,handleWorldRequest,sendInventorySnapshot,initialMessages, DEFAULT_KEY, buildLoginStateBody, classifyLoginDataRequest,
  encodeItemInfo,makeBagMoveUpdate,makeInventorySnapshot,readItemMoveRequest,handleItemMove,handleItemStrengthen};
