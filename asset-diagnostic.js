'use strict';
const fs=require('node:fs'),path=require('node:path');
const manifest=require('./manifest-extracted.json');
function diagnose(root,input){
 let logical;try{logical=decodeURIComponent(new URL(input,'http://localhost').pathname).replace(/^\//,'');}catch{return {classification:'caminho-invalido'};}
 if(logical.split('/').some(x=>x==='..'||x.startsWith('.'))||logical.includes('\\'))return {classification:'caminho-invalido'};
 const safe=f=>{const a=path.resolve(root,f);return a.startsWith(path.resolve(root)+path.sep)&&fs.existsSync(a);};
 const target=manifest[logical];
 const alternatives=[];if(logical.startsWith('res/maps/')||logical.startsWith('res/mapmaterial/'))alternatives.push(logical.replace('res/','res/animation/'));
 const candidates=alternatives.map(key=>({logical:key,target:manifest[key]||key,exists:safe(manifest[key]||key)}));
 return {logical,target,existsExact:safe(logical),existsManifest:!!target&&safe(target),classification:safe(logical)?'existente':target&&safe(target)?'resolvido-manifesto':candidates.some(x=>x.exists)?'caminho-incorreto':target?'destino-manifesto-ausente':'sem-correspondencia',candidates,note:'Obrigatoriedade depende do handler/observacao; sem-correspondencia nao prova recurso opcional.'};
}
module.exports={diagnose};
if(require.main===module){const root=path.resolve(__dirname,'..');const inputs=process.argv.slice(2);console.log(JSON.stringify((inputs.length?inputs:['res/animation/maps/5/5.dat','res/animation/maps/5/5.bin','res/animation/mapmaterial/land/5/small.jpg']).map(x=>diagnose(root,x)),null,2));}
