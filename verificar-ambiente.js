'use strict';
const ports={client:8088,api:8905,ws:8906};
Object.assign(process.env,{WARTUNE_API_PORT:String(ports.api),WARTUNE_WS_PORT:String(ports.ws),WARTUNE_CLIENT_PORT:String(ports.client),
 WARTUNE_DEV_ROSTER:'0',WARTUNE_DEV_UI:'0',WARTUNE_DEV_RESOURCES:'0',WARTUNE_DEV_TEST_ITEMS:'0',WARTUNE_BOOT_OBSERVER:'0',WARTUNE_SCENE_OBSERVER:'0'});
const server=require('./servidor_v08');
(async()=>{
 const url=`http://127.0.0.1:${ports.api}/diagnostico/ambiente`;
 const response=await fetch(url,{signal:AbortSignal.timeout(2500)});
 if(!response.ok)throw Error(`API respondeu HTTP ${response.status}`);
 const env=await response.json();
 const health=await (await fetch(`http://127.0.0.1:${ports.api}/health`,{signal:AbortSignal.timeout(2500)})).json();
 const expected=env.version===server.version&&env.apiPort===ports.api&&env.websocketPort===ports.ws&&env.clientPort===ports.client&&env.database?.connected&&health.webrootFound;
 if(!expected)throw Error('Versao, portas, banco ou cliente nao correspondem a v0.9.7.');
 const net=require('node:net');
 await new Promise((resolve,reject)=>{const s=net.connect(ports.ws,'127.0.0.1',()=>s.end(resolve));s.once('error',reject);});
 if(Object.values(env.developmentModes||{}).some(Boolean))throw Error('Uma flag de desenvolvimento esta ativa.');
 console.log(`Ambiente v0.9.7 confirmado: build ${env.buildId}, PID ${env.pid}; cliente ${ports.client}, API ${ports.api}, WS ${ports.ws}; MySQL ativo; modos de desenvolvimento desligados; bootstrap experimental=${Boolean(env.experimentalBootstrap)}.`);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
