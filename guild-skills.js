'use strict';
const fs = require('node:fs');
const path = require('node:path');
const catalogDir = path.resolve(__dirname, '../res/release/config');
const catalogFile = fs.readdirSync(catalogDir).find(name => name.startsWith('t_s_consortialevel-') && name.endsWith('.json'));
const catalog = JSON.parse(fs.readFileSync(path.join(catalogDir, catalogFile), 'utf8')).t_s_consortialevel;
const BASIC_TYPES = [6, 8, 9, 10, 11, 12];
const HIGH_TYPES = Array.from({length:24},(_,i)=>i+21);
const isSkillType = type => BASIC_TYPES.includes(type) || HIGH_TYPES.includes(type);
const FIELD_BY_TYPE = {6:'consortiaAttack',8:'consortiaAgility',9:'consortiaAbility',10:'consortiaCaptain',11:'consortiaGold',12:'consortiaPhysique'};
const GUILD_FIELD_BY_TYPE = {6:'attackLevel',8:'agilityLevel',9:'abilityLevel',10:'captainLevel',11:'goldLevel',12:'physiqueLevel'};
function row(type, level) { return catalog.find(x => Number(x.Types) === Number(type) && Number(x.Levels) === Number(level)); }
function levels(saved) { const raw = saved?.guildSkills; return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}; }
function playerFields(saved) {
  const owned = levels(saved), out = {};
  for (const type of BASIC_TYPES) out[FIELD_BY_TYPE[type]] = Number(owned[type] || 0);
  out.hiSkillList = Object.keys(owned).map(type => ({type:Number(type),level:Number(owned[type])})).filter(x => x.type >= 21 && x.type <= 44 && x.level > 0);
  return out;
}
function bonuses(saved) {
  const owned = levels(saved), result = {power:0,agility:0,intellect:0,physique:0,captain:0,goldPercent:0};
  const prop = {6:'power',8:'agility',9:'intellect',10:'captain',11:'goldPercent',12:'physique'};
  for (const type of BASIC_TYPES) {
    const config = row(type, Number(owned[type] || 0));
    if (!config) continue;
    const match = String(config.Description_en || config.Description_pt || '').match(/\+\s*(\d+)/);
    if (match) result[prop[type]] += Number(match[1]);
  }
  return result;
}
function sylphBonuses(saved, template) {
  const element = Number(template?.PetType)-100;
  const result = {power:0,armor:0,intel:0,physi:0};
  if (element < 1 || element > 6) return result;
  for (let offset=0;offset<4;offset++) {
    const type=21+(element-1)*4+offset;
    const config=row(type,Number(levels(saved)[type]||0));
    if (!config) continue;
    const value=Number(String(config.Description_en||'').match(/\+\s*(\d+)/)?.[1]||0);
    result[['power','armor','intel','physi'][offset]]+=value;
  }
  return result;
}
async function research(pool, characterId, type) {
  type = Number(type);
  if (!isSkillType(type)) return {ok:false,message:'Pesquisa indisponivel'};
  const cx = await pool.getConnection();
  let committed = false;
  try {
    await cx.beginTransaction();
    const [membership] = await cx.query('SELECT consortia_id,duty_id FROM consortia_members WHERE character_id=?', [characterId]);
    if (!membership.length || ![1,2].includes(Number(membership[0].duty_id))) return {ok:false,message:'Cargo sem permissao'};
    const guildId = Number(membership[0].consortia_id);
    const [guilds] = await cx.query('SELECT id,school_level,offer,materials FROM consortia WHERE id=? FOR UPDATE', [guildId]);
    const [recent]=await cx.query('SELECT last_at FROM consortia_skill_actions WHERE character_id=? AND action_type=1 AND skill_type=? FOR UPDATE',[characterId,type]);
    if(recent.length && Date.now()-new Date(recent[0].last_at).getTime()<800)
      return {ok:false,message:'Aguarde antes de pesquisar novamente'};
    const [researchRows] = await cx.query('SELECT level FROM consortia_research WHERE consortia_id=? AND skill_type=? FOR UPDATE', [guildId,type]);
    const nextLevel = Number(researchRows[0]?.level || 0) + 1;
    const template = row(type,nextLevel);
    if (!template) return {ok:false,message:'Nivel maximo atingido'};
    const requiredSchool = Number(row(4,1)?.Levels || 1) + Math.max(0,Number(template.PreTemplateId)-401);
    if (Number(guilds[0].school_level) < requiredSchool) return {ok:false,message:'Academia da guilda insuficiente'};
    const cost = Number(template.NeedOffer);
    const currency=HIGH_TYPES.includes(type)?'materials':'offer';
    if (!Number.isSafeInteger(cost) || cost < 0 || Number(guilds[0][currency]) < cost) return {ok:false,message:currency==='materials'?'Materiais da guilda insuficientes':'Contribuicao da guilda insuficiente'};
    await cx.query(`UPDATE consortia SET ${currency}=${currency}-?,updated_at=NOW() WHERE id=?`,[cost,guildId]);
    await cx.query('INSERT INTO consortia_research(consortia_id,skill_type,level) VALUES (?,?,?) ON DUPLICATE KEY UPDATE level=VALUES(level)',[guildId,type,nextLevel]);
    await cx.query('INSERT INTO consortia_skill_actions(character_id,action_type,skill_type,last_at) VALUES (?,1,?,NOW(3)) ON DUPLICATE KEY UPDATE last_at=NOW(3)',[characterId,type]);
    await cx.commit();
    committed = true;
    return {ok:true,guildId,type,level:nextLevel,cost};
  } finally { if (!committed) await cx.rollback(); cx.release(); }
}
async function learn(pool, characterId, type) {
  type = Number(type);
  if (!isSkillType(type)) return {ok:false,message:'Habilidade indisponivel'};
  const cx = await pool.getConnection();
  let committed = false;
  try {
    await cx.beginTransaction();
    const [members] = await cx.query('SELECT consortia_id,offer,build FROM consortia_members WHERE character_id=? FOR UPDATE',[characterId]);
    if (!members.length) return {ok:false,message:'Personagem sem guilda'};
    const [recent]=await cx.query('SELECT last_at FROM consortia_skill_actions WHERE character_id=? AND action_type=2 AND skill_type=? FOR UPDATE',[characterId,type]);
    if(recent.length && Date.now()-new Date(recent[0].last_at).getTime()<800)
      return {ok:false,message:'Aguarde antes de aprender novamente'};
    const guildId = Number(members[0].consortia_id);
    const [characters] = await cx.query('SELECT state_json FROM characters WHERE id=? FOR UPDATE',[characterId]);
    const saved = typeof characters[0].state_json === 'string' ? JSON.parse(characters[0].state_json) : structuredClone(characters[0].state_json || {});
    if (Number(saved.consortia?.id) !== guildId) return {ok:false,message:'Guilda inconsistente'};
    const nextLevel = Number(levels(saved)[type] || 0) + 1;
    const template = row(type,nextLevel);
    if (!template) return {ok:false,message:'Nivel maximo atingido'};
    const [researchRows] = await cx.query('SELECT level FROM consortia_research WHERE consortia_id=? AND skill_type=?',[guildId,type]);
    if (Number(researchRows[0]?.level || 0) < nextLevel) return {ok:false,message:'Pesquisa da guilda insuficiente'};
    const high=HIGH_TYPES.includes(type),currency=high?'build':'offer';
    const cost = Number(high?template.Property1:template.NeedOffer);
    if (!Number.isSafeInteger(cost) || cost < 0 || Number(members[0][currency]) < cost) return {ok:false,message:high?'Cristais pessoais insuficientes':'Contribuicao pessoal insuficiente'};
    saved.guildSkills = {...levels(saved),[type]:nextLevel};
    if(high) saved.consortia.build=Number(members[0].build)-cost;
    else saved.consortia.offer=Number(members[0].offer)-cost;
    await cx.query(`UPDATE consortia_members SET ${currency}=${currency}-? WHERE character_id=?`,[cost,characterId]);
    await cx.query('UPDATE characters SET state_json=? WHERE id=?',[JSON.stringify(saved),characterId]);
    await cx.query('INSERT INTO consortia_skill_actions(character_id,action_type,skill_type,last_at) VALUES (?,2,?,NOW(3)) ON DUPLICATE KEY UPDATE last_at=NOW(3)',[characterId,type]);
    await cx.commit();
    committed = true;
    return {ok:true,guildId,type,level:nextLevel,cost};
  } finally { if (!committed) await cx.rollback(); cx.release(); }
}
async function researchLevels(pool, guildId) {
  const [rows] = await pool.query('SELECT skill_type,level FROM consortia_research WHERE consortia_id=?',[guildId]);
  const out = {};
  for (const type of BASIC_TYPES) out[GUILD_FIELD_BY_TYPE[type]] = Number(rows.find(x => Number(x.skill_type) === type)?.level || 0);
  out.hiSkillList=rows.filter(x=>HIGH_TYPES.includes(Number(x.skill_type)) && Number(x.level)>0).map(x=>({type:Number(x.skill_type),level:Number(x.level)}));
  return out;
}
module.exports = {BASIC_TYPES,HIGH_TYPES,row,levels,playerFields,bonuses,sylphBonuses,research,learn,researchLevels};
