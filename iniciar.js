'use strict';
const fs=require('node:fs');
const path=require('node:path');
const net=require('node:net');
const {execFileSync,spawn}=require('node:child_process');

const ROOT=__dirname;
const PORTS={client:8088,api:8905,ws:8906};
const LOG=path.join(ROOT,'logs','inicializador-v097.log');
let activeServer,shutdownRequested=false;
fs.mkdirSync(path.dirname(LOG),{recursive:true});
function record(message){const line=`${new Date().toISOString()} ${message}`;fs.appendFileSync(LOG,line+'\n');console.log(message);}
function safeCode(error){return error&&/^[A-Z0-9_]{2,48}$/.test(error.code||'')?error.code:'E_UNKNOWN';}
function taskName(pid){
 if(process.platform!=='win32')return '';
 try{return execFileSync('tasklist.exe',['/FI',`PID eq ${pid}`,'/FO','CSV','/NH'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}
 catch(_){return '';}
}
function portOwners(port){
 if(process.platform!=='win32')return [];
 try{
  const output=execFileSync('netstat.exe',['-ano','-p','tcp'],{encoding:'utf8',stdio:['ignore','pipe','ignore']});
  const ids=new Set();
  for(const line of output.split(/\r?\n/)){
   if(!line.includes('LISTENING'))continue;
   const m=line.match(/\s+(?:\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
   if(m&&Number(m[1])===port)ids.add(Number(m[2]));
  }
  return [...ids].map(pid=>({pid,process:taskName(pid)}));
 }catch(_){return [];}
}
function probePort(port){
 return new Promise((resolve,reject)=>{
  const probe=net.createServer();
  probe.once('error',error=>reject(Object.assign(new Error(`A porta ${port} nao esta livre.`),{code:error.code||'EPORT'})));
  probe.listen(port,'127.0.0.1',()=>probe.close(error=>error?reject(error):resolve()));
 });
}
function inspectConfig(){
 const file=path.join(ROOT,'config.local.json');
 if(!fs.existsSync(file))throw Object.assign(new Error('config.local.json nao encontrado.'),{code:'ECONFIG'});
 const config=JSON.parse(fs.readFileSync(file,'utf8'));
 if(config.host!=='127.0.0.1'&&config.host!=='localhost')throw Object.assign(new Error('A candidata exige MariaDB local.'),{code:'ECONFIG'});
 if(config.database!=='wartune_ultra'||!config.user||!config.password||config.password==='COLOQUE_SUA_SENHA_AQUI')
  throw Object.assign(new Error('Preencha a conexao local em config.local.json sem compartilhar a senha.'),{code:'ECONFIG'});
 record(`[CONFIG] ${file} | host=${config.host} porta=${Number(config.port)||3306} banco=${config.database} | senha omitida`);
}
async function waitHttp(url){
 const deadline=Date.now()+8000;let last;
 while(Date.now()<deadline){
  try{const r=await fetch(url,{signal:AbortSignal.timeout(900)});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}
  catch(e){last=e;await new Promise(resolve=>setTimeout(resolve,200));}
 }
 throw Object.assign(new Error('A verificacao HTTP nao respondeu apos a inicializacao.'),{code:safeCode(last)});
}
function openBrowser(url){
 if(process.platform!=='win32')return;
 const proc=spawn(process.env.ComSpec||'cmd.exe',['/d','/c','start','',url],{detached:true,stdio:'ignore',windowsHide:true});
 proc.once('error',error=>record(`[NAVEGADOR] Falha ao abrir automaticamente (${safeCode(error)}); URL: ${url}`));
 proc.unref();
}

async function main(){
 if(process.versions.node.split('.')[0]<18)throw Object.assign(new Error('Instale Node.js 18 ou superior.'),{code:'ENODE_VERSION'});
 try{require.resolve('mysql2/promise');}catch(_){throw Object.assign(new Error('Dependencia mysql2 ausente. Execute INSTALAR_DEPENDENCIAS.bat.'),{code:'EDEPENDENCY'});}
 inspectConfig();
 for(const [name,port] of Object.entries(PORTS)){
  try{await probePort(port);record(`[PORTA OK] ${name} 127.0.0.1:${port} livre`);}
  catch(error){const owners=portOwners(port);record(`[PORTA OCUPADA] ${port} (${safeCode(error)}); processo(s) existente(s)=${JSON.stringify(owners)}. Nenhum processo foi encerrado.`);throw error;}
 }

 // A candidata nunca herda concessoes ou atalhos de desenvolvimento do processo pai.
 Object.assign(process.env,{
  WARTUNE_PLAYER_ACCOUNT:'marcelo',NODE_ENV:'local-v097-candidate',WARTUNE_API_PORT:String(PORTS.api),WARTUNE_WS_PORT:String(PORTS.ws),WARTUNE_CLIENT_PORT:String(PORTS.client),
  WARTUNE_LOGIN_SCENE_STATE:'2',WARTUNE_WORLD_MAP_ID:'5',WARTUNE_SOCKET_SHIM:'1',
  WARTUNE_BOOT_OBSERVER:'0',WARTUNE_SCENE_OBSERVER:'0',WARTUNE_DEV_ROSTER:'0',WARTUNE_DEV_UI:'0',
  WARTUNE_DEV_RESOURCES:'0',WARTUNE_DEV_TEST_ITEMS:'0',WARTUNE_INIT_EXPERIMENTAL:'1',WARTUNE_INIT_LIMIT:'12'
 });
 const server=require('./servidor_v08');activeServer=server;
 if(!server.locateWebroot())throw Object.assign(new Error('Cliente original ausente. Confira webroot.path.txt.'),{code:'EWEBROOT'});
 const url=`http://127.0.0.1:${PORTS.client}/index.html`;
 const shutdown=async(signal)=>{
  if(shutdown.started)return;shutdown.started=true;
  shutdownRequested=true;
  record(`[ENCERRANDO] ${signal}: fechando somente HTTP, WebSocket e conexoes desta instancia; MariaDB permanece ativo.`);
  try{await server.stop();record('[ENCERRADO] Backend local parado com seguranca.');}
  catch(error){process.exitCode=1;record(`[ERRO ENCERRAMENTO] ${safeCode(error)}; consulte ${LOG}`);}
 };
 for(const sig of ['SIGINT','SIGTERM','SIGBREAK'])process.once(sig,()=>{void shutdown(sig);});
 const runtime={pid:process.pid,nonce:require('node:crypto').randomUUID(),version:server.version,ports:PORTS};
 const runtimeFile=path.join(ROOT,'logs','runtime-operacao.json'),stopFile=path.join(ROOT,'logs','stop-operacao.json');
 fs.writeFileSync(runtimeFile,JSON.stringify(runtime,null,2));
 const stopWatcher=setInterval(()=>{try{const request=JSON.parse(fs.readFileSync(stopFile,'utf8'));if(request.pid===runtime.pid&&request.nonce===runtime.nonce){fs.unlinkSync(stopFile);clearInterval(stopWatcher);void shutdown('solicitacao controlada');}}catch(error){if(error.code!=='ENOENT')record('[PARADA] Solicitacao invalida ignorada.');}},500);
 stopWatcher.unref();


 record(`[INICIO] Wartune Ultra ${server.version} | pasta=${ROOT} | Node=${process.version} | PID=${process.pid} | portas cliente=${PORTS.client}, API=${PORTS.api}, WS=${PORTS.ws} | modo=normal com bootstrap experimental identificado`);
 await server.start();
 if(shutdownRequested)return;
 const env=await waitHttp(`http://127.0.0.1:${PORTS.api}/diagnostico/ambiente`);
 if(env.version!==server.version||env.apiPort!==PORTS.api||env.websocketPort!==PORTS.ws||env.clientPort!==PORTS.client||!env.database.connected||!server.wsHttp.listening)
  throw Object.assign(new Error('As verificacoes de prontidao nao correspondem a esta candidata.'),{code:'EHEALTH'});
 if(Object.values(env.developmentModes||{}).some(Boolean))throw Object.assign(new Error('Uma flag de desenvolvimento inesperada esta ativa.'),{code:'EDEVFLAG'});
 record(`[PRONTO] MySQL=conectado | HTTP=ativo | WebSocket=ativo | URL=${url} | perfil=normal | bootstrap=${env.experimentalBootstrap?'experimental-parcial':'desligado'}`);
 if(process.env.WARTUNE_NO_BROWSER!=='1')openBrowser(url);
 else record(`[NAVEGADOR] Abertura automatica desativada; URL para abrir manualmente: ${url}`);
}

main().catch(async error=>{
 const code=safeCode(error);
 const safeDetail=['ECONFIG','EDEPENDENCY','ENODE_VERSION','EWEBROOT','EHEALTH','EDEVFLAG'].includes(code)?error.message:
  ['EADDRINUSE','EPORT'].includes(code)?'porta local em uso; consulte o PID listado acima':'falha de conexao ou inicializacao; consulte o codigo e o log local';
 record(`[FALHA] ${code}: ${safeDetail}`);
 if(error&&error.code==='EACCES')record('[ACAO] Confira a permissao local de acesso ao MariaDB com o administrador; nenhum privilegio foi alterado.');
 if(error&&error.code==='ECONNREFUSED')record('[ACAO] Confira se o MariaDB local esta ativo antes de iniciar. O inicializador nao inicia nem reinicia o banco.');
 if(activeServer)await activeServer.stop().catch(()=>{});
 process.exitCode=1;
});
