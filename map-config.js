/** Configuracao de mapa original do cliente Ultra. Somente leitura. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {diagnose}=require('./asset-diagnostic');
const catalogPath=path.join(__dirname,'catalogo_ultra','t_s_map-4d7dc88f8b.json');
const maps=JSON.parse(fs.readFileSync(catalogPath,'utf8')).t_s_map;
const mapById=new Map(maps.map(r=>[Number(r.Id),r]));
const LOADER_MAP_FILE_IDS=new Set([1,2,3,4,5,100]); // AZ._mapImgCountDic no bundle original
function resolveMapId(value=process.env.WARTUNE_WORLD_MAP_ID||'5') {
  if(!/^\d+$/.test(String(value)))throw Error('WARTUNE_WORLD_MAP_ID precisa ser inteiro positivo');
  const id=Number(value); const row=mapById.get(id);
  if(!row)throw Error('Mapa '+id+' inexistente em t_s_map');
  if(!LOADER_MAP_FILE_IDS.has(Number(row.MapFileId)))throw Error('MapFileId '+row.MapFileId+' sem contagem de imagens no carregador AZ; escolha mapa de teste compativel');
  return Object.freeze({id,fileId:Number(row.MapFileId),name:row.MapName_pt||row.MapName_en||'',width:Number(row.Width),height:Number(row.Height)});
}
const selection=resolveMapId();
function probeAssets(webroot){
  if(!webroot)return {webrootFound:false,files:[],note:'Configure webroot.path.txt para checar recursos locais'};
  const rel=[`res/animation/maps/${selection.fileId}/${selection.fileId}.dat`,`res/animation/maps/${selection.fileId}/${selection.fileId}.bin`, `res/animation/mapmaterial/land/${selection.fileId}/small.jpg`];
  return {webrootFound:true,files:rel.map(relpath=>diagnose(webroot,relpath)),note:'Ausencia no caminho literal nao prova ausencia no cliente: manifest/hash pode reescrever URLs; veja Rede para caminhos reais.'};
}
module.exports={maps,mapById,resolveMapId,selection,probeAssets,LOADER_MAP_FILE_IDS};
