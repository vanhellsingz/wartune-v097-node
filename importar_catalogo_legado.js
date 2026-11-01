/* Importa referencia do latestdb.db para duas tabelas MySQL SEPARADAS.
 * Nao altera nem atualiza tabelas de jogadores. Idempotente por tabela.
 */
'use strict';
const fs=require('node:fs'); const path=require('node:path'); const crypto=require('node:crypto');
const zlib=require('node:zlib'); const readline=require('node:readline');
const mysql=require('mysql2/promise');
const manifest=require('./catalogo_manifesto.json');
const gzipPath=path.join(__dirname,'catalogo_legado.ndjson.gz');
const cfgPath=path.join(__dirname,'config.local.json');
async function main(){
  if(!fs.existsSync(cfgPath))throw Error('Copie o config.local.json da v0.6 antes de importar.');
  const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf8'));
  if(cfg.database!=='wartune_ultra'||!['127.0.0.1','localhost'].includes(cfg.host))throw Error('Banco local wartune_ultra exigido');
  const hash=crypto.createHash('sha256').update(fs.readFileSync(gzipPath)).digest('hex');
  if(hash!==manifest.archive_sha256)throw Error('Arquivo de catalogo nao confere com SHA256');
  const cx=await mysql.createConnection({...cfg,multipleStatements:false});
  try{
    // As tabelas devem ter sido criadas via phpMyAdmin usando 02_catalogo_legado.sql.
    // O usuario de jogo tem apenas SELECT/INSERT/UPDATE/DELETE; nao exige privilegio CREATE.
    try {
      await cx.query('SELECT table_name FROM legacy_catalog_meta LIMIT 0');
      await cx.query('SELECT table_name FROM legacy_catalog_rows LIMIT 0');
    } catch(e) {
      throw Error('Importe primeiro 02_catalogo_legado.sql no phpMyAdmin (banco wartune_ultra). Detalhe: '+e.message);
    }
    // Troca tabela por tabela em transacao. Rollback se erro, sem apagar jogos salvos.
    const input=readline.createInterface({input:fs.createReadStream(gzipPath).pipe(zlib.createGunzip()),crlfDelay:Infinity});
    let current=null, rows=[],processed=0,tables=0;
    async function flush(){
      if(current===null)return;
      const expected=manifest.counts[current];
      if(rows.length!==expected)throw Error(`Contagem divergente ${current}: ${rows.length} / ${expected}`);
      await cx.beginTransaction();
      try{
        await cx.execute('INSERT INTO legacy_catalog_meta(table_name,row_count) VALUES (?,?) ON DUPLICATE KEY UPDATE row_count=VALUES(row_count)',[current,expected]);
        await cx.execute('DELETE FROM legacy_catalog_rows WHERE table_name=?',[current]);
        for(let start=0;start<rows.length;start+=150){
          const part=rows.slice(start,start+150);
          const sql='INSERT INTO legacy_catalog_rows(table_name,source_seq,data_json) VALUES '+part.map(()=>'(?,?,?)').join(',');
          const args=part.flatMap(r=>[current,r.seq,JSON.stringify(r.record)]);
          await cx.query(sql,args);
        }
        await cx.commit(); processed+=rows.length;tables++;
        console.log(`[CATALOGO] ${current}: ${rows.length} registros`);
      }catch(e){await cx.rollback();throw e;}
      rows=[];
    }
    for await(const line of input){
      const item=JSON.parse(line);
      if(typeof item.table!=='string'||!Object.hasOwn(manifest.counts,item.table)||
        !Number.isSafeInteger(item.seq)||item.seq<1)throw Error('Linha fora do manifesto');
      if(current!==item.table){await flush();current=item.table;}
      if(item.seq!==rows.length+1)throw Error(`Sequencia incorreta em ${item.table}`);
      rows.push({seq:item.seq,record:item.record});
    }
    await flush();
    if(processed!==manifest.records || tables!==manifest.tables)throw Error('Importacao incompleta');
    const [check]=await cx.query('SELECT COUNT(*) AS n FROM legacy_catalog_rows');
    console.log(`[CATALOGO OK] Importados ${processed} registros de ${tables} tabelas. Total no banco: ${check[0].n}`);
    console.log('Acesse http://127.0.0.1:8899/catalog/tables quando o backend estiver ligado.');
  }finally{await cx.end();}
}
if(require.main===module)main().catch(e=>{console.error('[ERRO IMPORTACAO]',e.message);process.exitCode=1;});
