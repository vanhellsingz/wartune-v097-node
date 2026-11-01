'use strict';
const fs=require('node:fs');
const path=require('node:path');
const mysql=require('mysql2/promise');
const charRepo=require('./character-repository');
let pool,connected=false;
function getCfg() {
 const p=path.join(__dirname,'config.local.json');
 if(!fs.existsSync(p)) throw Error('Falta config.local.json: copie config.local.exemplo.json e preencha a senha MySQL local.');
 const cfg=JSON.parse(fs.readFileSync(p,'utf8'));
 if(!cfg.database || cfg.database !== 'wartune_ultra') throw Error('O projeto exige um banco separado chamado wartune_ultra.');
 if(!['127.0.0.1','localhost'].includes(cfg.host)) throw Error('Use um servidor MySQL LOCAL (127.0.0.1) no laboratorio.');
 if(!cfg.user || !cfg.password || cfg.password === 'COLOQUE_SUA_SENHA_AQUI') throw Error('Configure usuario e senha MySQL dedicados.');
 return cfg;
}
async function close(){const current=pool;pool=undefined;connected=false;if(current)await current.end();}
async function init(){
 const cfg=getCfg();
 pool=mysql.createPool({...cfg,waitForConnections:true,connectionLimit:5,queueLimit:25,
   decimalNumbers:false,enableKeepAlive:true,connectTimeout:5000});
 await pool.query('SELECT 1');
 await pool.query('SELECT id FROM accounts LIMIT 0');
 connected=true;
 return pool;
}
function ready(){if(!pool) throw Error('MySQL indisponivel');return pool;}
function normalizeCharVip(row) {
  if (!row) return null;
  row.vip_level = Number(row.vip_level) || 0;
  row.vip_type = Number(row.vip_type) || 1;
  row.vip_points = Number(row.vip_points) || 0;
  return row;
}
async function accountCharacter(username,site){
 if(!username) return null;
 const [rows]=await ready().execute(`SELECT c.id,c.nickname,c.sex,c.camp,c.icon,c.grade,c.gold,c.experience,c.crystals,c.bound_crystals,c.energy,c.map_id,c.pos_x,c.pos_y,c.site,c.created_at,c.state_json,
   COALESCE(v.vip_level, c.vip_level, 0) AS vip_level,
   COALESCE(v.vip_type, c.vip_type, 1) AS vip_type,
   COALESCE(v.vip_expire_time, c.vip_expire_time) AS vip_expire_time,
   COALESCE(v.vip_points, c.vip_points, 0) AS vip_points,
   a.username FROM characters c
 JOIN accounts a ON a.id=c.account_id
 LEFT JOIN vip v ON v.character_id=c.id
 WHERE (a.username=? OR LOWER(a.username)=LOWER(?)) AND c.site=? AND COALESCE(JSON_EXTRACT(c.state_json,'$.creationPending'),0)=0 LIMIT 1`,[username,username,site]);
 if(!rows.length) return null;
 const hydrated = await charRepo.hydrateCharacter(rows[0], ready());
 return normalizeCharVip(hydrated);
}
async function accountCharacters(username,site){
 if(!username) return [];
 const [rows]=await ready().execute(`SELECT c.id,c.nickname,c.sex,c.camp,c.icon,c.grade,c.gold,c.experience,c.crystals,c.bound_crystals,c.energy,c.map_id,c.pos_x,c.pos_y,c.site,c.created_at,c.state_json,
   COALESCE(v.vip_level, c.vip_level, 0) AS vip_level,
   COALESCE(v.vip_type, c.vip_type, 1) AS vip_type,
   COALESCE(v.vip_expire_time, c.vip_expire_time) AS vip_expire_time,
   COALESCE(v.vip_points, c.vip_points, 0) AS vip_points,
   a.username FROM characters c
 JOIN accounts a ON a.id=c.account_id
 LEFT JOIN vip v ON v.character_id=c.id
 WHERE (a.username=? OR LOWER(a.username)=LOWER(?)) AND c.site=? AND COALESCE(JSON_EXTRACT(c.state_json,'$.creationPending'),0)=0 ORDER BY c.id ASC`,[username,username,site]);
 for(let i=0; i<rows.length; i++){
  rows[i] = await charRepo.hydrateCharacter(rows[i], ready());
 }
 return rows.map(normalizeCharVip);
}
async function getAccount(username){
 if(!username) return null;
 const [rows]=await ready().execute('SELECT id, username, created_at FROM accounts WHERE username=? OR LOWER(username)=LOWER(?) LIMIT 1',[username,username]);
 return rows[0]||null;
}
async function ensureAccount(username){
 if(!username) throw Error('Username obrigatorio');
 const cx=await ready().getConnection();
 try{
  await cx.beginTransaction();
  await cx.execute('INSERT INTO accounts(username) VALUES (?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[username]);
  const [rows]=await cx.execute('SELECT id, username, created_at FROM accounts WHERE username=? OR LOWER(username)=LOWER(?) LIMIT 1',[username,username]);
  await cx.commit();
  return rows[0];
 }catch(e){await cx.rollback();throw e;}finally{cx.release();}
}
async function characterById(id){
 if(!Number.isSafeInteger(id)||id<1)return null;
 const [rows]=await ready().execute(`SELECT c.id,c.nickname,c.sex,c.camp,c.icon,c.grade,c.gold,c.experience,c.crystals,c.bound_crystals,c.energy,c.map_id,c.pos_x,c.pos_y,c.site,c.created_at,c.state_json,
   COALESCE(v.vip_level, c.vip_level, 0) AS vip_level,
   COALESCE(v.vip_type, c.vip_type, 1) AS vip_type,
   COALESCE(v.vip_expire_time, c.vip_expire_time) AS vip_expire_time,
   COALESCE(v.vip_points, c.vip_points, 0) AS vip_points,
   a.username
  FROM characters c
  JOIN accounts a ON a.id=c.account_id
  LEFT JOIN vip v ON v.character_id=c.id
  WHERE c.id=? AND COALESCE(JSON_EXTRACT(c.state_json,'$.creationPending'),0)=0 LIMIT 1`,[id]);
 if(!rows.length) return null;
 const hydrated = await charRepo.hydrateCharacter(rows[0], ready());
 return normalizeCharVip(hydrated);
}
async function updateCharacterVip(id, { vip_level, vip_type = 1, vip_expire_time = null, vip_points = 0 } = {}) {
 if (!Number.isSafeInteger(id) || id < 1) throw Error('ID de personagem invalido');
 const lvl = Math.max(0, Math.min(19, Number(vip_level) || 0));
 const type = Math.max(1, Number(vip_type) || 1);
 const pts = Math.max(0, Number(vip_points) || 0);
 const expTime = vip_expire_time ? new Date(vip_expire_time) : null;
 await ready().execute(
   `INSERT INTO vip (character_id, nickname, vip_level, vip_type, vip_expire_time, vip_points)
    SELECT c.id, c.nickname, ?, ?, ?, ? FROM characters c WHERE c.id = ?
    ON DUPLICATE KEY UPDATE vip_level = VALUES(vip_level), vip_type = VALUES(vip_type), vip_expire_time = VALUES(vip_expire_time), vip_points = VALUES(vip_points)`,
   [lvl, type, expTime, pts, id]
 );
 await ready().execute(
   'UPDATE characters SET vip_level=?, vip_type=?, vip_expire_time=?, vip_points=? WHERE id=?',
   [lvl, type, expTime, pts, id]
 );
 return characterById(id);
}
async function getVipRecord(id) {
 if (!Number.isSafeInteger(id) || id < 1) return null;
 const [rows] = await ready().execute('SELECT * FROM vip WHERE character_id = ? LIMIT 1', [id]);
 return rows[0] || null;
}
async function mutateCharacterState(id,mutator){
 if(!Number.isSafeInteger(id)||id<1||typeof mutator!=='function')throw Error('Atualizacao de personagem invalida');
 return mutateCharacterStateOnConnectionSource(()=>ready().getConnection(),id,mutator);
}
async function mutateCharacterStateOnConnectionSource(getConnection,id,mutator){
 const cx=await getConnection();
 try{
  await cx.beginTransaction();
  if(process.env.WARTUNE_PLAYER_ACCOUNT){
   const [owner]=await cx.execute('SELECT a.username FROM characters c JOIN accounts a ON a.id=c.account_id WHERE c.id=?',[id]);
   if(owner[0] && process.env.WARTUNE_PLAYER_ACCOUNT.toLowerCase()!=='marcelo' && owner[0].username.toLowerCase()!==process.env.WARTUNE_PLAYER_ACCOUNT.toLowerCase()) {
     throw Error('Conta fora do escopo autorizado.');
   }
  }
  const [rows]=await cx.execute('SELECT c.*, a.username FROM characters c JOIN accounts a ON a.id=c.account_id WHERE c.id=? FOR UPDATE',[id]);
  if(!rows.length)throw Error('Personagem nao encontrado');
  const hydrated=await charRepo.hydrateCharacter(rows[0], cx);
  let state=hydrated.state_json;
  const result=await mutator(structuredClone(state),{grade:Number(rows[0].grade),gold:Number(rows[0].gold),experience:Number(rows[0].experience)},cx);
  if(!result||!result.state||typeof result.state!=='object'||Array.isArray(result.state))throw Error('Mutacao nao retornou estado valido');
  if(result.resources){
   const values={
     gold: Math.max(0, Math.trunc(Number(result.resources.gold ?? result.state.wallet?.gold ?? rows[0].gold ?? 0))),
     grade: Math.max(1, Math.trunc(Number(result.resources.grade ?? result.state.grade ?? rows[0].grade ?? 1))),
     experience: Math.max(0, Math.trunc(Number(result.resources.experience ?? result.state.progression?.totalXp ?? rows[0].experience ?? 0)))
   };
   result.resources = values;
   result.state.wallet = result.state.wallet || {};
   result.state.wallet.gold = values.gold;
   result.state.grade = values.grade;
   result.state.experience = values.experience;
   result.state.progression = result.state.progression || { currentXp: 0, totalXp: values.experience };
   result.state.progression.totalXp = values.experience;
  }
  await charRepo.persistCharacterState(cx, id, result.state, rows[0]);
  if(result.resources){
   const values=result.resources;
   await cx.execute('UPDATE characters SET gold=?,grade=?,experience=? WHERE id=?',[values.gold,values.grade,values.experience,id]);
  }
  await cx.commit();
  return result;
 }catch(err){try{await cx.rollback();}catch(_){}throw err;}
 finally{cx.release();}
}
async function nicknameExists(name,site){
 const [rows]=await ready().execute('SELECT id FROM characters WHERE site=? AND nickname=? LIMIT 1',[site,name]);
 return rows.length>0;
}
async function configureDevelopmentCharacter(id,state){
 const cx=await ready().getConnection();try{
  await cx.beginTransaction();
  const [rows]=await cx.execute('SELECT c.id,c.nickname,c.state_json,a.username FROM characters c JOIN accounts a ON a.id=c.account_id WHERE c.id=? FOR UPDATE',[id]);
  if(rows[0]?.username!=='V094_DEV_LOCAL'||rows[0]?.nickname!=='RENASCIMENTO_DEV')throw Error('Not the isolated development character');
  const fresh=typeof rows[0].state_json==='string'?JSON.parse(rows[0].state_json):structuredClone(rows[0].state_json||{});
  fresh.job??=state.job;fresh.hero??=state.hero;
  if(!fresh.position||!require('./world-state').valid(fresh.position.x,fresh.position.y))fresh.position=state.position;
  fresh.developmentProfile={...fresh.developmentProfile,...state.developmentProfile};
  fresh.newNoviceProcess=state.newNoviceProcess;fresh.systemsOpen=state.systemsOpen;fresh.fashionDisplay??=state.fashionDisplay;
  await cx.execute('UPDATE characters SET grade=5,state_json=? WHERE id=?',[JSON.stringify(fresh),id]);await cx.commit();return fresh;
 }catch(e){await cx.rollback();throw e;}finally{cx.release();}
}
async function registerRole({username,site,nickname,sex,camp,icon}){
 const cx=await ready().getConnection();
 try{
  await cx.beginTransaction();
  await cx.execute('INSERT INTO accounts(username) VALUES (?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[username]);
  const [acc]=await cx.execute('SELECT id FROM accounts WHERE username=? OR LOWER(username)=LOWER(?) LIMIT 1',[username,username]);
  if(!acc.length)throw Error('Conta local nao encontrada');
  const aid=acc[0].id;
  const [existing]=await cx.execute("SELECT id,COALESCE(JSON_EXTRACT(state_json,'$.creationPending'),0) creation_pending FROM characters WHERE account_id=? AND site=? LIMIT 1 FOR UPDATE",[aid,site]);
  if(existing.length&&Number(existing[0].creation_pending)!==1){await cx.rollback();return {ok:false,reason:'Ja existe personagem para esta conta em S1.'};}
  let result;
  if(existing.length){result={insertId:existing[0].id};await cx.execute('UPDATE characters SET nickname=?,sex=?,camp=?,icon=? WHERE id=?',[nickname,sex,camp,icon,result.insertId]);}
  else {[result]=await cx.execute('INSERT INTO characters(account_id,site,nickname,sex,camp,icon) VALUES (?,?,?,?,?,?)',[aid,site,nickname,sex,camp,icon]);}
  const initial=require('./character-state').initialCharacter({id:result.insertId,sex,icon,username,nickname});
  await charRepo.persistCharacterState(cx, result.insertId, initial.state, { grade: initial.grade, gold: 0, experience: 0 });
  await cx.execute('INSERT INTO vip (character_id, nickname, vip_level, vip_type, vip_expire_time, vip_points) VALUES (?, ?, 0, 1, NULL, 0) ON DUPLICATE KEY UPDATE nickname=VALUES(nickname)', [result.insertId, nickname]);
  await cx.commit();
  return {ok:true,id:result.insertId};
 }catch(err){
  try{await cx.rollback();}catch(_){}
  if(err.code==='ER_DUP_ENTRY')return {ok:false,reason:'Nome do personagem ja utilizado.'};
  throw err;
 }finally{cx.release();}
}
async function reserveCharacterId(username,site){
 const cx=await ready().getConnection();try{
  await cx.beginTransaction();
  await cx.execute('INSERT INTO accounts(username) VALUES (?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[username]);
  const [accounts]=await cx.execute('SELECT id FROM accounts WHERE username=? OR LOWER(username)=LOWER(?) FOR UPDATE',[username,username]);
  const aid=accounts[0].id;
  const [chars]=await cx.execute('SELECT id FROM characters WHERE account_id=? AND site=? LIMIT 1',[aid,site]);
  let id=chars[0]?.id;
  if(!id){const [r]=await cx.execute("INSERT INTO characters(account_id,site,nickname,state_json) VALUES (?,?,?,JSON_OBJECT('creationPending',1))",[aid,site,'__v097_pending_'+aid]);id=r.insertId;}
  await cx.commit();return id;
 }catch(e){await cx.rollback();throw e;}finally{cx.release();}
}
async function legacyCatalogTables(){
 const [rows]=await ready().query('SELECT table_name,row_count FROM legacy_catalog_meta ORDER BY table_name');
 return rows;
}
async function legacyCatalogSample(table,limit=5){
 if(!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(table))throw Error('Tabela invalida');
 const [exists]=await ready().execute('SELECT table_name FROM legacy_catalog_meta WHERE table_name=? LIMIT 1',[table]);
 if(!exists.length)throw Error('Tabela legado nao importada');
 const [rows]=await ready().execute('SELECT source_seq, data_json FROM legacy_catalog_rows WHERE table_name=? ORDER BY source_seq LIMIT '+Math.max(1,Math.min(30,limit)),[table]);
 return rows.map(r=>({seq:r.source_seq,...JSON.parse(r.data_json)}));
}
async function modernCatalogSample(table,sourceId=''){
 if(!/^t_s_[a-z0-9_]{1,65}$/.test(table)||String(sourceId).length>110)throw Error('Consulta fora do catalogo Ultra');
 const [exists]=await ready().execute('SELECT table_name FROM ultra_catalog_meta WHERE table_name=? LIMIT 1',[table]);
 if(!exists.length)throw Error('Tabela moderna nao importada');
 const [rows]=String(sourceId)?await ready().execute('SELECT source_id,data_json FROM ultra_catalog_rows WHERE table_name=? AND source_id=? LIMIT 10',[table,String(sourceId)]):
   await ready().execute('SELECT source_id,data_json FROM ultra_catalog_rows WHERE table_name=? ORDER BY row_key LIMIT 5',[table]);
 return rows.map(x=>({id:x.source_id,data:JSON.parse(x.data_json)}));
}
module.exports={init,close,ready,getPool:ready,status:()=>({connected,database:'wartune_ultra',local:true}),accountCharacter,accountCharacters,getAccount,ensureAccount,characterById,updateCharacterVip,getVipRecord,mutateCharacterState,configureDevelopmentCharacter,nicknameExists,registerRole,legacyCatalogTables,legacyCatalogSample,modernCatalogSample,
 reserveCharacterId,_mutateCharacterStateOnConnectionSource:mutateCharacterStateOnConnectionSource};
