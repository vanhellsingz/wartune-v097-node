'use strict';
const fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'logs');
const state=JSON.parse(fs.readFileSync(path.join(dir,'runtime-operacao.json'),'utf8'));
if(!Number.isSafeInteger(state.pid)||!state.nonce||state.version!=='0.9.7-candidato')throw Error('Instancia invalida');
fs.writeFileSync(path.join(dir,'stop-operacao.json'),JSON.stringify({pid:state.pid,nonce:state.nonce}));
console.log('Encerramento solicitado somente a candidata registrada.');
