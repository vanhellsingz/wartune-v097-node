/** v0.8.4: Importa JSONs oficiais em tabelas INDEPENDENTES, sem DROP/DELETE/TRUNCATE. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=__dirname,manifest=require('./ultra_catalog_manifest.json');
const dry=process.argv.includes('--dry-run');
function validate() {
 let total=0;
 const found=[];
 for(const m of manifest.files){
  if(!/^t_s_[a-z0-9_]{1,65}$/.test(m.table)||!/^[a-z0-9_.-]+\.json$/.test(m.file)) throw Error('Nome invalido: '+m.table);
  const fname=path.join(base,'catalogo_ultra',m.file);
  const bytes=fs.readFileSync(fname);
  const sha=crypto.createHash('sha256').update(bytes).digest('hex');
  if(sha!==m.sha256)throw Error('SHA256 divergente: '+m.table);
  const data=JSON.parse(bytes.toString('utf8'));
  const list=data[m.table];
  if(!Array.isArray(list)||list.length!==m.rows)throw Error('Formato/contagem divergente: '+m.table);
  const originalIds=new Set(); let duplicates=0;
  for(const [i,row] of list.entries()){
   if(!row||typeof row!=='object'||Array.isArray(row)) throw Error('Linha invalida: '+m.table+' '+i);
   const id=String(row.TemplateId??row.Id??row.UiLevelId??row.UiPlayId??row.ConfigName??i);
   if(originalIds.has(id)) duplicates++;
   originalIds.add(id);
  }
  found.push({table:m.table,file:m.file,sha256:sha,rows:list.length,duplicates});
  total+=list.length;
  console.log(`[ULTRA ${dry?'DRY':'OK'}] ${m.table}: ${list.length} registros (${duplicates} IDs de origem repetidos)`);
 }
 return {found,total};
}
async function run(){
 const {found,total}=validate();
 if(dry){console.log(`[VALIDACAO OK] ${found.length} tabelas, ${total} linhas, SHA256 verificados. Nenhum banco alterado.`);return;}
 const configPath=path.join(base,'config.local.json');
 if(!fs.existsSync(configPath))throw Error('Falta config.local.json: copie da versao anterior sem expor a senha.');
 const cfg=JSON.parse(fs.readFileSync(configPath,'utf8'));
 if(cfg.database!=='wartune_ultra'||!['127.0.0.1','localhost'].includes(cfg.host))throw Error('Somente banco wartune_ultra local e permitido.');
 const mysql=require('mysql2/promise');
 const cx=await mysql.createConnection({...cfg,connectTimeout:6000});
 try{
  const [tab]=await cx.execute('SHOW TABLES LIKE ?', ['ultra_catalog_meta']);
  if(!tab.length)throw Error('FALTAM TABELAS: importe 03_catalogo_ultra.sql pelo phpMyAdmin antes do importador.');
  for(const m of found){
   const rows=JSON.parse(fs.readFileSync(path.join(base,'catalogo_ultra',m.file),'utf8'))[m.table];
   await cx.beginTransaction();
   try {
    for(let k=0;k<rows.length;k+=60){
     const sub=rows.slice(k,k+60);
     const bind=[];
     for(let j=0;j<sub.length;j++){
      const row=sub[j], seq=k+j;
      const id=String(row.TemplateId??row.Id??row.UiLevelId??row.UiPlayId??row.ConfigName??seq).slice(0,110);
      bind.push(m.table,String(seq).padStart(8,'0'),id,JSON.stringify(row));
     }
     const placeholders4=sub.map(()=>'(?,?,?,?)').join(',');
     await cx.query(`INSERT INTO ultra_catalog_rows (table_name,row_key,source_id,data_json) VALUES ${placeholders4} ON DUPLICATE KEY UPDATE source_id=VALUES(source_id),data_json=VALUES(data_json)`,bind);
    }
    await cx.execute(`INSERT INTO ultra_catalog_meta(table_name,original_file,sha256,record_count) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE original_file=VALUES(original_file),sha256=VALUES(sha256),record_count=VALUES(record_count)`,[m.table,m.file,m.sha256,m.rows]);
    await cx.commit();
    console.log(`[IMPORTADO] ${m.table} - ${m.rows} linhas`);
   } catch(e){await cx.rollback();throw e;}
  }
  const [count]=await cx.query('SELECT COUNT(*) AS qtd FROM ultra_catalog_rows');
  console.log(`[CATALOGO ULTRA OK] ${found.length} tabelas do cliente. Total MySQL ${count[0].qtd} linhas. Sem modificar personagens.`);
 } finally {await cx.end();}
}
run().catch(err=>{console.error('[CATALOGO ULTRA ERRO]',err.code||err.message);process.exitCode=1;});
