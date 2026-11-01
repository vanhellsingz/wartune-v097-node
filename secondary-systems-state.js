'use strict';

const fs = require('node:fs');
const path = require('node:path');
const integrity = require('./wartune-integrity-r7');
const {sylphDerived}=require('./wartune-combat-math');
const wartuneSylphSkills=require('./wartune-sylph-skills');
const sylphEquipment=require('./sylph-equipment-state');
const combatGuardianState=require('./combat-guardian-state');

// Carregar catálogos canônicos
let soulUpgradeCatalog = [];
try {
  const p = path.resolve(__dirname, '../res/release/config/t_s_soulupgrade-8169d2ef73.json');
  if (fs.existsSync(p)) soulUpgradeCatalog = JSON.parse(fs.readFileSync(p, 'utf8')).t_s_soulupgrade || [];
} catch (_) {}

let petTemplateCatalog = [];
try {
  const p = path.resolve(__dirname, '../res/release/config/t_s_pettemplate-ad9c988f64.json');
  if (fs.existsSync(p)) petTemplateCatalog = JSON.parse(fs.readFileSync(p, 'utf8')).t_s_pettemplate || [];
} catch (_) {}

// Skill index is needed to initialize valid hotbars from learned skills,
// never from an arbitrary arithmetic guess based on template IDs.
const sylphSkillCatalogue=wartuneSylphSkills.readSkillCatalogue(path.resolve(__dirname,'../res/release/config'));

let remotePetCatalog = [];
try {
  const p = path.resolve(__dirname, '../res/release/config/t_s_remotepet-bd1d467304.json');
  if (fs.existsSync(p)) remotePetCatalog = JSON.parse(fs.readFileSync(p, 'utf8')).t_s_remotepet || [];
} catch (_) {}

let combatGuardianCatalog = [];
try {
  const p = path.resolve(__dirname, '../res/release/config/t_s_combatguardiantemplate-cf39b7b49a.json');
  if (fs.existsSync(p)) combatGuardianCatalog = JSON.parse(fs.readFileSync(p, 'utf8')).t_s_combatguardiantemplate || [];
} catch (_) {}

let combatGuardianUpgradeCatalog = [];
try {
  const p = path.resolve(__dirname, '../res/release/config/t_s_combatguardianupgrade-1d60b16f6c.json');
  if (fs.existsSync(p)) combatGuardianUpgradeCatalog = JSON.parse(fs.readFileSync(p, 'utf8')).t_s_combatguardianupgrade || [];
} catch (_) {}

/**
 * Fórmula oficial do cliente para efeito percentual de Cristais de Alma (Soul Engraving)
 * jo.getJewelEffecyByGrade(t):
 * - t <= 50: 2 * t
 * - t <= 70: 3 * (t - 50) + 100
 * - t <= 80: 4 * (t - 70) + 160
 */
function getJewelEffectPercent(grade) {
  const t = Number(grade || 0);
  if (t <= 0) return 0;
  if (t <= 50) return 2 * t;
  if (t <= 70) return 3 * (t - 50) + 100;
  if (t <= 80) return 4 * (t - 70) + 160;
  return 200;
}

/**
 * Garante inicialização íntegra de todos os 4 subsistemas secundários no estado
 */
function ensureSecondarySystemsState(saved) {
  if (!saved || typeof saved !== 'object') return;

  // 1. Cristais de Alma (Soul Engraving)
  if (typeof saved.jewelGrades !== 'number') saved.jewelGrades = 0;
  if (typeof saved.jewelGp !== 'number') saved.jewelGp = 0;

  // 2. Einherjar (Silfos / Sylph)
  if (!saved.sylphs || typeof saved.sylphs !== 'object') {
    saved.sylphs = {activePetId:0,list:[]};
  }

  // Normalize legacy Sylph records so the wire values and persisted values
  // agree. The previous formatter advertised template.ChangeSkills while the
  // save handler saw no learned skills in the database.
  const petTemplates=new Map(petTemplateCatalog.map(t=>[Number(t.TemplateId),t]));
  if(Array.isArray(saved.sylphs.list))for(const pet of saved.sylphs.list){
    if(!pet||pet.isDel)continue;
    const template=petTemplates.get(Number(pet.templateId));
    if(!template)continue;
    if(pet.followSkills===undefined || pet.followSkills===null)
      pet.followSkills=(template.FollowSkills||[]).join(',');
    if(pet.changeSkills===undefined || pet.changeSkills===null)
      pet.changeSkills=(template.ChangeSkills||[]).join(',');
  }

  // 3. Pets (Mascotes Remotos / Remote Pet)
  if (!saved.remotePet || typeof saved.remotePet !== 'object') {
    saved.remotePet = {nowIndex:0,MaxIndex:0,pets:'',petsList:[],activeId:0,fight:0};
  }

  // 4. Guardiões (Combat Guardians & Fate Guardian Watch)
  if (!saved.combatGuardians || typeof saved.combatGuardians !== 'object') {
    saved.combatGuardians = {guardians:[]};
  }
  combatGuardianState.ensure(saved);

  if (!saved.watch || typeof saved.watch !== 'object') {
    saved.watch = {
      watchInfo: [
        { gridType: 1, gridPos: 1, jion1: 0, jion2: 0, jion3: 0, state: 1 }
      ]
    };
  }
}

/**
 * Calcula atributos adicionais gerados pelos 4 sistemas para o AttributeCalculatorService
 */
function calculateSecondaryAttributes(saved, gemTotals = { Power: 0, Agility: 0, Intellect: 0, Physique: 0, Attack: 0, Defence: 0, MagicAttack: 0, MagicDefence: 0, Live: 0 }) {
  saved = saved || {};
  const bonus=Object.fromEntries(integrity.FIELDS.filter(Boolean).map(k=>[k,0]));

  // 1. Soul Engraving (Cristais de Alma): Multiplica gemas equipadas
  const jewelPct = getJewelEffectPercent(saved.jewelGrades);
  if(jewelPct>0)for(const k of Object.keys(gemTotals)){
    if(Object.hasOwn(bonus,k))bonus[k]+=Math.floor(Number(gemTotals[k]||0)*jewelPct/100);
  }

  // 2. Einherjar (Silfos): Adiciona bônus do Silfo ativo
  let activeSylph = (saved.sylphs?.list || []).find(s => s.isFight && !s.isDel);
  if (activeSylph) {
    const tpl=petTemplateCatalog.find(t=>Number(t.TemplateId)===Number(activeSylph.templateId));
    activeSylph=integrity.normalizePet(activeSylph,tpl,new Map(petTemplateCatalog.map(t=>[Number(t.TemplateId),t])));
    const gear=sylphEquipment.equipmentStats(saved.inventory?.items || [],activeSylph.petId);
    const equipped={...activeSylph,
      power:activeSylph.power+gear.power,armor:activeSylph.armor+gear.armor,
      intel:activeSylph.intel+gear.intel,physi:activeSylph.physi+gear.physi,
      bagAttack:gear.bagAttack,bagDefence:gear.bagDefence,
      bagMagicattack:gear.bagMagicattack,bagMagicdefence:gear.bagMagicdefence,
      bagLiving:gear.bagLiving};
    // The hero and the Sylph packet must use the same effective combat stats.
    const mode=String(process.env.WARTUNE_SYLPH_HERO_BONUS || 'derived').toLowerCase();
    if(mode==='derived'){
      const tpl=petTemplateCatalog.find(t=>Number(t.TemplateId)===Number(activeSylph.templateId));
      if(!tpl)throw Error('Template do Silfo ativo ausente, sem estimativa de contribuicao: '+activeSylph.templateId);
      const d=sylphDerived(equipped,tpl);
      bonus.Attack += d.physicalAttack;
      bonus.MagicAttack += d.magicAttack;
      bonus.Defence += d.physicalDefense;
      bonus.MagicDefence += d.magicDefense;
      bonus.Live += d.hp;
    }else if(mode==='legacy'){
      bonus.Power += Number(activeSylph.power || 0);
      bonus.Intellect += Number(activeSylph.intel || 0);
      bonus.Physique += Number(activeSylph.physi || 0);
      bonus.Defence += Number(activeSylph.armor || 0);
      bonus.MagicDefence += Number(activeSylph.armor || 0);
      bonus.Live += Number(activeSylph.maxHp || 0);
    }else throw Error('WARTUNE_SYLPH_HERO_BONUS invalido; use legacy ou derived');
  }

  // Remote-pet power is an expedition rating, not a hero primary attribute.
  // No arbitrary 0.5/0.25/2 coefficients.
  const guardian=integrity.guardianAttributes(saved);
  for(const [id,value] of Object.entries(guardian)){
    const key=integrity.FIELDS[Number(id)];if(key)bonus[key]+=value;
  }

  return bonus;
}

/**
 * Formata pacote S2C 4540 (pet.PlayerPetMsg) para o cliente
 */
function formatPlayerPetMsg(saved, playerId, op = 0) {
  ensureSecondarySystemsState(saved);
  const catalogue = new Map(petTemplateCatalog.map(t => [Number(t.TemplateId), t]));
  const list = (saved.sylphs?.list || []).filter(s => s && !s.isDel).map(s => {
    const template = catalogue.get(Number(s.templateId));
    s=integrity.normalizePet(s,template,catalogue);
    const apt = (field, key) => {
      if (s[key] !== undefined && s[key] !== null) return Number(s[key]);
      const values = template && template[field];
      return Array.isArray(values) && Number.isFinite(Number(values[0])) ? Number(values[0]) : 0;
    };
    const str = v => Array.isArray(v) ? v.join(',') : String(v ?? '');
    const learnedSkills=str(s.changeSkills ?? template?.ChangeSkills);
    const normalizedPet={...s,changeSkills:learnedSkills};
    const originalBar=str(s.fastKey);
    // Never replace an existing arrangement, including an explicitly empty bar.
    // Old records with no fastKey receive a reproducible starter configuration.
    const bar=s.fastKey===undefined || s.fastKey===null
      ? wartuneSylphSkills.initialBar(normalizedPet,template,sylphSkillCatalogue)
      : originalBar;
    const gear=sylphEquipment.equipmentStats(saved.inventory?.items || [],s.petId);
    const equipped={...s,
      power:Number(s.power||0)+gear.power, armor:Number(s.armor||0)+gear.armor,
      intel:Number(s.intel||0)+gear.intel, physi:Number(s.physi||0)+gear.physi,
      bagAttack:gear.bagAttack,bagDefence:gear.bagDefence,
      bagMagicattack:gear.bagMagicattack,bagMagicdefence:gear.bagMagicdefence,
      bagLiving:gear.bagLiving};
    let calculatedCapacity=Number(s.fightingCapacity||0);
    try {if(template)calculatedCapacity=sylphDerived(equipped,template).fightingCapacity;}catch(_){/* Preserve saved score if the catalogue is incomplete. */}
    // Todos os campos sao consumidos por Fy.createWithMsg no cliente.
    // A rotina antiga descartava as aptidoes, pontos e o progresso da qualidade.
    return {
      ...equipped,
      petId: Number(s.petId),
      templateId: Number(s.templateId),
      petName: String(s.petName || template?.TemplateName_pt || template?.TemplateName_en || 'Silfo'),
      curGrade: Number(s.curGrade ?? 1),
      quality: Number(s.quality ?? 1),
      initQuality: Number(s.initQuality ?? template?.Quality ?? 1),
      curGp: Number(s.curGp ?? 0),
      totalGp: Number(s.totalGp ?? 0),
      curQualityGp: Number(s.curQualityGp ?? 0),
      totalQualityGp: Number(s.totalQualityGp ?? 0),
      remainPoints: Number(s.remainPoints ?? 0),
      powerApti: apt('PowerApt','powerApti'),
      intelApti: apt('IntelApt','intelApti'),
      physiApti: apt('PhysiApt','physiApti'),
      armorApti: apt('ArmorApt','armorApti'),
      power: Number(s.power ?? template?.Power ?? 0)+gear.power,
      intel: Number(s.intel ?? template?.Intel ?? 0)+gear.intel,
      physi: Number(s.physi ?? template?.Physi ?? 0)+gear.physi,
      armor: Number(s.armor ?? template?.Armor ?? 0)+gear.armor,
      isFight: Boolean(s.isFight), isDel: false,
      followSkills: str(s.followSkills ?? template?.FollowSkills),
      changeSkills: learnedSkills,
      fightingCapacity: calculatedCapacity,
      chaSkillIndexs: str(s.chaSkillIndexs),
      remotePetSkillIndexs: str(s.remotePetSkillIndexs),
      fastKey: bar,
      skillIndex: Number(s.skillIndex ?? 0),
      isActiveSecond: Boolean(s.isActiveSecond)
    };
  });
  return {
    userId: Number(playerId), petInfo: list, nickName: '', order: 0,
    chaPos: String(saved.sylphs.chaPos ?? ''), score: 0, petCount: list.length,
    op: 0, fightIndex: String(saved.sylphs.fightIndex ?? '')
  };
}

/**
 * Formata pacote S2C 4873 (combatguardian.CombatGuardianOpRes)
 */
function formatCombatGuardianOpRes(saved) {
  ensureSecondarySystemsState(saved);
  return {
    guardians: (saved.combatGuardians.guardians || []).map(g => ({
      templateId: g.templateId,
      level: g.level,
      star: g.star || 0,
      exp: g.exp || 0
    })),
    attributes: integrity.guardianAttributes(saved)
  };
}

/**
 * Formata pacote S2C 4631 (watch.HeroWatchMsg)
 */
function formatHeroWatchMsg(saved) {
  ensureSecondarySystemsState(saved);
  return {
    watchInfo: (saved.watch.watchInfo || []).map(w => ({
      gridType: w.gridType || 1,
      gridPos: w.gridPos || 1,
      jion1: w.jion1 || 0,
      jion2: w.jion2 || 0,
      jion3: w.jion3 || 0,
      state: w.state || 1
    }))
  };
}

/**
 * Formata pacote S2C 4964 (remotepet.RemotePetMsg)
 */
function formatRemotePetMsg(saved, userId = 0) {
  ensureSecondarySystemsState(saved);
  const rp = saved.remotePet || {};
  return {
    userId: Number(userId || 0),
    nowIndex: Number(rp.nowIndex || 0),
    MaxIndex: Number(rp.MaxIndex ?? 0),
    order: Number(rp.order || 0),
    skills: String(rp.skills || ''),
    items: String(rp.items || ''),
    sweepTime: String(rp.sweepTime || ''),
    specialIndex: String(rp.specialIndex || ''),
    pos: String(rp.pos || '-1,-1,-1,-1,-1,-1,-1,-1'),
    pets: String(rp.pets || ''),
    sweepIndex: Number(rp.sweepIndex || 0),
    isFirst: Boolean(rp.isFirst || false),
    fight: Number(rp.fight || 0),
    lastOrder: Number(rp.lastOrder || 0),
    isGet: Boolean(rp.isGet || false),
    resetTime: String(rp.resetTime || ''),
    skillStatus: String(rp.skillStatus || '')
  };
}

module.exports = {
  getJewelEffectPercent,
  ensureSecondarySystemsState,
  calculateSecondaryAttributes,
  formatPlayerPetMsg,
  petTemplateCatalog,
  formatCombatGuardianOpRes,
  formatHeroWatchMsg,
  formatRemotePetMsg
};

// WARTUNE_ITEM_EFFECTS_V3
require('./item-effects-v3').installFormatter(module.exports);
