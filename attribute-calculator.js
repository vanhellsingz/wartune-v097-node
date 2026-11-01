'use strict';

/**
 * AttributeCalculatorService — Motor Puro de Cálculo de Atributos e Escalonamento por Nível
 * Projeto: Wartune Ultra v0.9.7 | Fase 1
 * 
 * Implementa pipeline determinístico em 6 camadas puras (A..F):
 * - Layer A: Atributos Primários e Secundários Base da Classe (class_base_stats)
 * - Layer B: Curva Oficial de Pontos de Potencial por Nível (class_level_curves / t_s_upgradetemplate Type 5)
 * - Layer C: Conversão Oficial para Atributos Secundários Derivados (attribute_conversion_rules)
 * - Layer D: Modificadores Planos e Percentuais de Equipamentos, Forja e Gemas
 * - Layer E: Modificadores de Guilda, Títulos, Runas e Talentos
 * - Layer F: Poder de Combate (FightingCapacity / Battle Rating) idêntico à classe Xo do cliente LayaAir
 */

const fs = require('node:fs');
const path = require('node:path');
const integrity = require('./wartune-integrity-r7');
const wartuneSkillBonuses = require('./wartune-attribute-bonuses');
const secondaryFeatures = require('./secondary-features-state');

class AttributeCalculatorService {
  constructor() {
    this.initialized = false;
    this.baseStatsByJob = new Map();
    this.levelCurves = new Map();
    this.conversionRules = [];
    this.attributeTypes = new Map();
    this.itemTemplates = new Map();
    this.skillProps = new Map();
    this.mountTemplates = new Map();
    this.runeGemMap = new Map();
    this.dragonSoulUpgradeMap = new Map();

    // Fallbacks padrão autênticos
    this._loadDefaultCatalogs();
  }

  _loadDefaultCatalogs() {
    // Carregar templates de itens do JSON para cálculo de equipamento
    try {
      const itemJsonPath = path.resolve(__dirname, '../res/release/config/t_s_itemtemplate-43b07d7a92.json');
      {
        const raw = integrity.catalog('t_s_itemtemplate');
        for (const it of raw) {
          this.itemTemplates.set(it.TemplateId, it);
        }
      }
    } catch (_) {}

    try {
      const skillPropPath = path.resolve(__dirname, '../res/release/config/t_s_skillpropertytemplate-5a02eea60a.json');
      {
        const raw = integrity.catalog('t_s_skillpropertytemplate');
        for (const sp of raw) {
          this.skillProps.set(sp.TemplateId, sp);
        }
      }
    } catch (_) {}

    try {
      const mountPath = path.resolve(__dirname, '../res/release/config/t_s_mounttemplate-2a47d32f3e.json');
      {
        const raw = integrity.catalog('t_s_mounttemplate');
        for (const mt of raw) {
          this.mountTemplates.set(mt.TemplateId, mt);
        }
      }
    } catch (_) {}

    try {
      const rawGems = integrity.catalog('t_s_runegem');
      for (const g of rawGems) {
        this.runeGemMap.set(Number(g.Id), g);
      }
    } catch (_) {}

    try {
      const rawUp = integrity.catalog('t_s_upgradetemplate');
      for (const u of rawUp) {
        if (Number(u.Types) === 101 || Number(u.Types) === 102) {
          this.dragonSoulUpgradeMap.set(`${u.Types}_${u.Grades}`, u);
        }
      }
    } catch (_) {}

    // Fallback de class_base_stats autêntico
    this.baseStatsByJob.set(1, {
      job: 1, job_name: 'Warrior',
      base_power: 5, base_agility: 1, base_intellect: 1, base_physique: 5, base_captain: 100,
      base_attack: 0, base_defence: 0, base_magicattack: 0, base_magicdefence: 0,
      base_live: 90, base_forcehit: 10, base_parry: 10,
      weight_power: 0.40, weight_agility: 0.20, weight_intellect: 0.00, weight_physique: 0.40, weight_captain: 0.00
    });
    this.baseStatsByJob.set(2, {
      job: 2, job_name: 'Archer',
      base_power: 5, base_agility: 1, base_intellect: 1, base_physique: 5, base_captain: 100,
      base_attack: 0, base_defence: 0, base_magicattack: 0, base_magicdefence: 0,
      base_live: 90, base_forcehit: 100, base_parry: 10,
      weight_power: 0.40, weight_agility: 0.40, weight_intellect: 0.00, weight_physique: 0.20, weight_captain: 0.00
    });
    this.baseStatsByJob.set(3, {
      job: 3, job_name: 'Mage',
      base_power: 1, base_agility: 1, base_intellect: 5, base_physique: 5, base_captain: 100,
      base_attack: 0, base_defence: 0, base_magicattack: 0, base_magicdefence: 0,
      base_live: 90, base_forcehit: 10, base_parry: 10,
      weight_power: 0.00, weight_agility: 0.20, weight_intellect: 0.50, weight_physique: 0.30, weight_captain: 0.00
    });

    // Fallback de curvas de nível (t_s_upgradetemplate Types 3 e 5)
    try {
      const upPath = path.resolve(__dirname, '../res/release/config/t_s_upgradetemplate-f3c7098547.json');
      {
        const raw = integrity.catalog('t_s_upgradetemplate');
        const t3 = new Map();
        raw.filter(d => d.Types === 3).forEach(d => t3.set(d.Grades, d.Data));
        const t5 = new Map();
        raw.filter(d => d.Types === 5).forEach(d => t5.set(d.Grades, d.Data));

        for (let g = 1; g <= 100; g++) {
          this.levelCurves.set(g, {
            grade: g,
            xp_required: t3.get(g) || 0,
            potential_points: t5.get(g) !== undefined ? t5.get(g) : 10000
          });
        }
      }
    } catch (_) {}
  }

  /**
   * Sincroniza e carrega cache diretamente do MariaDB wartune_ultra
   */
  async initFromDb(pool) {
    if (!pool) return;
    try {
      const [stats] = await pool.query('SELECT * FROM class_base_stats');
      for (const row of stats) {
        this.baseStatsByJob.set(Number(row.job), {
          ...row,
          weight_power: Number(row.weight_power),
          weight_agility: Number(row.weight_agility),
          weight_intellect: Number(row.weight_intellect),
          weight_physique: Number(row.weight_physique),
          weight_captain: Number(row.weight_captain)
        });
      }

      const [curves] = await pool.query('SELECT * FROM class_level_curves ORDER BY grade ASC');
      for (const row of curves) {
        this.levelCurves.set(Number(row.grade), {
          grade: Number(row.grade),
          xp_required: Number(row.xp_required),
          potential_points: Number(row.potential_points)
        });
      }

      const [rules] = await pool.query('SELECT * FROM attribute_conversion_rules');
      this.conversionRules = rules.map(r => ({
        ...r,
        multiplier: Number(r.multiplier)
      }));

      const [types] = await pool.query('SELECT * FROM attribute_types');
      for (const row of types) {
        this.attributeTypes.set(Number(row.id), row);
      }

      this.initialized = true;
    } catch (err) {
      console.warn('[AttributeCalculatorService] Falha ao carregar tabelas do MariaDB, mantendo cache oficial padrão:', err.message);
    }
  }

  /**
   * Pipeline em 6 camadas puras de cálculo de atributos para qualquer personagem.
   */
  calculateAttributes(character, options = {}) {
    const grade = Math.max(1, Number(character.grade) || 1);
    
    // Obter estado salvo do personagem
    let saved = {};
    if (typeof character.state_json === 'string') {
      try { saved = JSON.parse(character.state_json); } catch (_) {}
    } else if (character.state_json && typeof character.state_json === 'object') {
      saved = character.state_json;
    }

    // Identificar Job do Herói (1=Warrior, 2=Archer, 3=Mage)
    let job = Number(saved.job ?? character.job ?? saved.hero?.job ?? 1);
    if (![1, 2, 3].includes(job)) {
      if (saved.hero?.templateId) {
        const tid = Number(saved.hero.templateId);
        job = [1, 4].includes(tid) ? 1 : [2, 5].includes(tid) ? 2 : 3;
      } else {
        job = 1;
      }
    }

    // ==========================================
    // LAYER A: Atributos Primários e Base da Classe
    // ==========================================
    const baseConfig = this.baseStatsByJob.get(job) || this.baseStatsByJob.get(1);
    const rawPower = Number(baseConfig.base_power);
    const rawAgility = Number(baseConfig.base_agility);
    const rawIntellect = Number(baseConfig.base_intellect);
    const rawPhysique = Number(baseConfig.base_physique);
    const rawCaptain = Number(baseConfig.base_captain);
    const rawLive = Number(baseConfig.base_live);
    const rawForceHit = Number(baseConfig.base_forcehit);
    const rawParry = Number(baseConfig.base_parry);
    const rawAttack = Number(baseConfig.base_attack);
    const rawDefence = Number(baseConfig.base_defence);
    const rawMagicAttack = Number(baseConfig.base_magicattack);
    const rawMagicDefence = Number(baseConfig.base_magicdefence);

    // ==========================================
    // LAYER B: Escalonamento por Nível e Pontos de Potencial (RemainPoint)
    // ==========================================
    const curve = this.levelCurves.get(grade) || { potential_points: Math.min(10000, (grade - 1) * 5) };
    const totalPotentialPoints = curve.potential_points;

    // Verificar se há pontos alocados manualmente pelo jogador
    const heroStateObj = saved.hero || {};
    const manualAllocated = {
      power: Number(heroStateObj.addPowerPoint || saved.allocated_points?.power || 0),
      agility: Number(heroStateObj.addAgilityPoint || saved.allocated_points?.agility || 0),
      intellect: Number(heroStateObj.addIntellectPoint || saved.allocated_points?.intellect || 0),
      physique: Number(heroStateObj.addPhysiquePoint || saved.allocated_points?.physique || 0),
      captain: Number(heroStateObj.addCaptainPoint || saved.allocated_points?.captain || 0)
    };
    const totalManual = manualAllocated.power + manualAllocated.agility + manualAllocated.intellect + manualAllocated.physique + manualAllocated.captain;

    let allocatedPower = 0;
    let allocatedAgility = 0;
    let allocatedIntellect = 0;
    let allocatedPhysique = 0;
    let allocatedCaptain = 0;
    let remainPoint = 0;

    if (totalManual > 0) {
      allocatedPower = manualAllocated.power;
      allocatedAgility = manualAllocated.agility;
      allocatedIntellect = manualAllocated.intellect;
      allocatedPhysique = manualAllocated.physique;
      allocatedCaptain = manualAllocated.captain;
      remainPoint = Math.max(0, totalPotentialPoints - totalManual);
    } else {
      // Distribuição canônica legítima por pesos de classe
      allocatedPower = Math.floor(totalPotentialPoints * baseConfig.weight_power);
      allocatedAgility = Math.floor(totalPotentialPoints * baseConfig.weight_agility);
      allocatedIntellect = Math.floor(totalPotentialPoints * baseConfig.weight_intellect);
      allocatedPhysique = Math.floor(totalPotentialPoints * baseConfig.weight_physique);
      allocatedCaptain = Math.floor(totalPotentialPoints * baseConfig.weight_captain);
      
      const allocatedSum = allocatedPower + allocatedAgility + allocatedIntellect + allocatedPhysique + allocatedCaptain;
      remainPoint = Math.max(0, totalPotentialPoints - allocatedSum);
      
      // Se sobrarem pontos residuais de arredondamento, adiciona ao atributo primário principal
      if (remainPoint > 0 && totalPotentialPoints > 0) {
        if (job === 1) allocatedPower += remainPoint;
        else if (job === 2) allocatedPower += remainPoint;
        else if (job === 3) allocatedIntellect += remainPoint;
        remainPoint = 0;
      }
    }

    // Atributos Primários Base Finais (após escalonamento legítimo de nível)
    const basePower = rawPower + allocatedPower;
    const baseAgility = rawAgility + allocatedAgility;
    const baseIntellect = rawIntellect + allocatedIntellect;
    const basePhysique = rawPhysique + allocatedPhysique;
    const baseCaptain = rawCaptain + allocatedCaptain;

    // ==========================================
    // LAYER C: Atributos Secundários Derivados (Fórmulas Oficiais)
    // ==========================================
    const isMagic = (job === 3);

    // PATK / MATK
    // O cliente calcula ATQ a partir de Força também para magos.
    const basePhyAttack = rawAttack + basePower * 4;
    const baseMagicAttack = rawMagicAttack + baseIntellect * 4;

    // PDEF = Power*1 + Agility*4
    const basePhyDefence = rawDefence + basePower * 1 + baseAgility * 4;

    // MDEF = Intellect*1 + Agility*4
    const baseMagicDefence = rawMagicDefence + baseIntellect * 1 + baseAgility * 4;

    // Max HP = Physique*20 + base Live
    const baseLive = rawLive + basePhysique * 20;

    // Troops = Captain*1
    const baseConatArmy = baseCaptain;

    const baseForceHit = rawForceHit;
    const baseParry = rawParry;
    const baseStrength = 0;
    const baseTenacity = 0;

    // ==========================================
    // LAYER D: Modificadores de Equipamentos, Forja e Gemas
    // ==========================================
    let equipPower = 0;
    let equipAgility = 0;
    let equipIntellect = 0;
    let equipCaptain = 0;
    let equipPhysique = 0;
    let equipAttack = 0;
    let equipDefence = 0;
    let equipMagicAttack = 0;
    let equipMagicDefence = 0;
    let equipLive = 0;
    let equipForceHit = 0;
    let equipParry = 0;
    let equipConat = 0;
    let equipStrength = 0;
    let equipTenacity = 0;
    let equipFireResi = 0;
    let equipWaterResi = 0;
    let equipElectResi = 0;
    let equipWindResi = 0;
    let equipDarkResi = 0;
    let equipLightResi = 0;
    let equipReduceResi = 0;
    let equipDefensePenetration = 0;
    let equipCriticalResistance = 0;
    let equipParryPenetration = 0;
    const jewelGemTotals = Object.fromEntries(wartuneSkillBonuses.FIELDS.map(k=>[k,0]));

    const equippedItems = integrity.equipment(saved);

    for (const item of equippedItems) {
      const it = this.itemTemplates.get(Number(item.templateId));
      if (!it) throw Error('R7 item equipado sem catalogo: '+item.templateId);
      const add = key => integrity.equipmentValue(item,it,key);

      equipPower += add('Power');
      equipAgility += add('Agility');
      equipIntellect += add('Intellect');
      equipCaptain += add('Captain');
      equipPhysique += add('Physique');
      equipAttack += add('Attack');
      equipDefence += add('Defence');
      equipMagicAttack += add('MagicAttack');
      equipMagicDefence += add('MagicDefence');
      equipLive += add('Live');
      equipForceHit += add('ForceHit');
      equipParry += add('Parry');
      equipConat += add('Conat');
      equipStrength += Number(it.Strength) || 0;
      equipTenacity += Number(it.Tenacity) || 0;
      equipFireResi += Number(it.FireResi) || 0;
      equipWaterResi += Number(it.WaterResi) || 0;
      equipElectResi += Number(it.ElectResi) || 0;
      equipWindResi += Number(it.WindResi) || 0;
      equipDarkResi += Number(it.DarkResi) || 0;
      equipLightResi += Number(it.LightResi) || 0;
      equipReduceResi += Number(it.ReduceResi) || 0;
      equipDefensePenetration += Number(it.DefensePenetration) || 0;
      equipCriticalResistance += Number(it.CriticalResistance) || 0;
      equipParryPenetration += Number(it.ParryPenetration) || 0;

      // Gemas incrustadas nos soquetes (join_1 .. join_4)
      for (let h = 1; h <= 4; h++) {
        const gemId = Number(item['join_' + h] ?? item['join' + h]);
        if (gemId > 0) {
          const gemTemp = this.itemTemplates.get(gemId);
          if (gemTemp) {
            equipPower += Number(gemTemp.Power) || 0;
            equipAgility += Number(gemTemp.Agility) || 0;
            equipIntellect += Number(gemTemp.Intellect) || 0;
            equipCaptain += Number(gemTemp.Captain) || 0;
            equipPhysique += Number(gemTemp.Physique) || 0;
            equipAttack += Number(gemTemp.Attack) || 0;
            equipDefence += Number(gemTemp.Defence) || 0;
            equipMagicAttack += Number(gemTemp.MagicAttack) || 0;
            equipMagicDefence += Number(gemTemp.MagicDefence) || 0;
            equipLive += Number(gemTemp.Live) || 0;
            for (const key of Object.keys(jewelGemTotals)) jewelGemTotals[key] += Number(gemTemp[key]) || 0;
            equipForceHit += Number(gemTemp.ForceHit) || 0;
            equipParry += Number(gemTemp.Parry) || 0;
            equipConat += Number(gemTemp.Conat) || 0;
          }
        }
      }
    }

    // Astrais equipados no Herói (Rm.THANE = 2)
    if (saved && saved.astrals && Array.isArray(saved.astrals.equipped) && saved.astrals.equipped.length > 0) {
      try {
        const astralState = require('./astral-state');
        const astralAttrs = astralState.calculateEquippedAstralAttributes(saved);
        equipPower += astralAttrs.Power;
        equipAgility += astralAttrs.Agility;
        equipIntellect += astralAttrs.Intellect;
        equipCaptain += astralAttrs.Captain;
        equipPhysique += astralAttrs.Physique;
        equipAttack += astralAttrs.Attack;
        equipDefence += astralAttrs.Defence;
        equipMagicAttack += astralAttrs.MagicAttack;
        equipMagicDefence += astralAttrs.MagicDefence;
        equipLive += astralAttrs.Live;
        equipForceHit += astralAttrs.ForceHit;
        equipParry += astralAttrs.Parry;
        equipConat += astralAttrs.Conat;
      } catch (_) {}
    }

    // Atributos de Potencial Estelar e Mapa Estelar (Stargazing)
    if (saved && saved.stargazing) {
      try {
        const stargazingState = require('./stargazing-state');
        const sgAttrs = stargazingState.calculateStargazingAttributes(saved);
        equipAttack += sgAttrs.Attack;
        equipDefence += sgAttrs.Defence;
        equipMagicAttack += sgAttrs.MagicAttack;
        equipMagicDefence += sgAttrs.MagicDefence;
        equipLive += sgAttrs.Live;
      } catch (_) {}
    }

    // ==========================================
    // LAYER D2: Moda (Roupas, Asas, Chapéus, Armas e Coleção de Refinamento)
    // ==========================================
    if (saved && saved.fashion) {
      const unlockedFashion = [...new Map((saved.fashion.unlocked || []).map(x=>[Number(x.templateId ?? x.tempId),x])).values()];
      for (const item of unlockedFashion) {
        const tId = Number(item.templateId || item.tempId);
        const tpl = this.itemTemplates.get(tId);
        if (tpl && !equippedItems.some(e=>Number(e.templateId)===tId)) {
          equipPower += Number(tpl.Power || 0);
          equipAgility += Number(tpl.Agility || 0);
          equipIntellect += Number(tpl.Intellect || 0);
          equipPhysique += Number(tpl.Physique || 0);
          equipCaptain += Number(tpl.Captain || 0);
          equipAttack += Number(tpl.Attack || 0);
          equipDefence += Number(tpl.Defence || 0);
          equipMagicAttack += Number(tpl.MagicAttack || 0);
          equipMagicDefence += Number(tpl.MagicDefence || 0);
          equipLive += Number(tpl.Live || 0);
          equipForceHit += Number(tpl.ForceHit || 0);
          equipParry += Number(tpl.Parry || 0);


        }

        // Bônus de Refinamento / Coleção (appraisalSkill)
        const skillId = Number(item.appraisalSkill || 0);
        if (skillId > 0) {
          const sp = this.skillProps ? this.skillProps.get(skillId) : null;
          if (sp) {
            equipPower += Number(sp.Power || 0);
            equipAgility += Number(sp.Agility || 0);
            equipIntellect += Number(sp.Intellect || 0);
            equipPhysique += Number(sp.Physique || 0);
          }
        }
      }

      // Nível / Estrelas da Moda (grades do Fashion)
      const fGrades = Number(saved.fashion.grades || 0);
      if (fGrades > 0) {
        equipPower += fGrades * 10;
        equipAgility += fGrades * 10;
        equipIntellect += fGrades * 10;
        equipPhysique += fGrades * 10;
        equipAttack += fGrades * 20;
        equipDefence += fGrades * 15;
        equipMagicAttack += fGrades * 20;
        equipMagicDefence += fGrades * 15;
        equipLive += fGrades * 100;
      }
    }

    // ==========================================
    // LAYER D3: Montarias (Estábulos, Treinamento e Montarias Ativas/Coleção)
    // ==========================================
    if (saved && saved.mounts) {
      // 1. Atributos de Treinamento dos Estábulos
      equipPower += Number(saved.mounts.power || 0);
      equipIntellect += Number(saved.mounts.intellect || 0);
      equipPhysique += Number(saved.mounts.physique || 0);
      equipAgility += Number(saved.mounts.agility || 0);

      // 2. Bônus de Montarias Desbloqueadas (avatarInfo)
      const avatarList = integrity.ownedMounts(saved, options.now ?? Date.now());
      for (const m of avatarList) {
        if (!m.isExist) continue;
        const mTpl = this.mountTemplates ? this.mountTemplates.get(Number(m.mountTempId)) : null;
        if (!mTpl) continue;
        if (mTpl) {
          const starBonus=integrity.number(m.starLevel)*integrity.number(mTpl.StarPower);
          equipPower += Number(mTpl.Power || 0) + (Number(mTpl.Power)>0 ? starBonus : 0);
          equipIntellect += Number(mTpl.Intellect || 0) + (Number(mTpl.Intellect)>0 ? starBonus : 0);
          equipPhysique += Number(mTpl.Physique || 0) + (Number(mTpl.Physique)>0 ? starBonus : 0);
          equipAgility += Number(mTpl.Agility || 0) + (Number(mTpl.Agility)>0 ? starBonus : 0);
        }
      }
    }

    // ==========================================
    // LAYER E: Modificadores de Sistemas Secundários (Cristais de Alma, Einherjar, Mascotes, Guardiões)
    // ==========================================
    {
      const secondaryState = require('./secondary-systems-state');
      const secBonus = secondaryState.calculateSecondaryAttributes(saved, jewelGemTotals);
      equipPower += secBonus.Power;
      equipAgility += secBonus.Agility;
      equipIntellect += secBonus.Intellect;
      equipPhysique += secBonus.Physique;
      equipCaptain += secBonus.Captain;
      equipAttack += secBonus.Attack;
      equipDefence += secBonus.Defence;
      equipMagicAttack += secBonus.MagicAttack;
      equipMagicDefence += secBonus.MagicDefence;
      equipLive += secBonus.Live || 0;
      equipForceHit += secBonus.ForceHit || 0;
      equipParry += secBonus.Parry || 0;
      equipConat += secBonus.Conat || 0;
      equipFireResi += secBonus.FireResi || 0;
      equipWaterResi += secBonus.WaterResi || 0;
      equipWindResi += secBonus.WindResi || 0;
      equipElectResi += secBonus.ElectResi || 0;
      equipDarkResi += secBonus.DarkResi || 0;
      equipLightResi += secBonus.LightResi || 0;
      equipReduceResi += secBonus.ReduceResi || 0;
      equipDefensePenetration += secBonus.DefensePenetration || 0;
      equipCriticalResistance += secBonus.CriticalResistance || 0;
      equipParryPenetration += secBonus.ParryPenetration || 0;
    }

    // ==========================================
    // LAYER E: Tecnologias da Academia (Aba Básico Nv. 1 ao 80)
    // ==========================================
    const techLevels = {
      1304: 0, 1420: 0, 1421: 0, 1422: 0, 1423: 0, 1424: 0,
      1441: 0, 1442: 0, 1443: 0, 1444: 0, 1445: 0, 1446: 0
    };

    if (options.technologies && typeof options.technologies === 'object') {
      for (const [k, v] of Object.entries(options.technologies)) {
        const sk = Number(k);
        if (techLevels[sk] !== undefined) techLevels[sk] = Math.max(techLevels[sk], Number(v) || 0);
      }
    }

    const directTechs = saved.technologies || saved.castle?.technologies;
    if (directTechs && typeof directTechs === 'object') {
      for (const [k, v] of Object.entries(directTechs)) {
        const sk = Number(k);
        if (techLevels[sk] !== undefined) techLevels[sk] = Math.max(techLevels[sk], Number(v) || 0);
      }
    }

    if (saved.castle?.buildings && typeof saved.castle.buildings === 'object') {
      for (const b of Object.values(saved.castle.buildings)) {
        if (!b) continue;
        const st = Number(b.sonType);
        if (techLevels[st] !== undefined) {
          techLevels[st] = Math.max(techLevels[st], Number(b.grade) || 0);
        }
      }
    }

    // Bloqueio de Nível da Academia: personagens com grade < 18 não possuem Academia desbloqueada
    if (grade < 18) {
      for (const k of Object.keys(techLevels)) {
        techLevels[k] = 0;
      }
    }

    // Bônus canônicos lineares por nível (1 <= L <= 80)
    const techBonuses = {
      goldYield: (techLevels[1304] || 0) * 200,
      troopHp: (techLevels[1420] || 0) * 5,
      troopAtk: (techLevels[1421] || 0) * 6,
      troopDef: (techLevels[1422] || 0) * 4,
      troopMAtk: (techLevels[1423] || 0) * 6,
      troopMDef: (techLevels[1424] || 0) * 4,
      heroAtk: (techLevels[1441] || 0) * 12,
      heroMAtk: (techLevels[1442] || 0) * 12,
      heroDef: (techLevels[1443] || 0) * 8,
      heroMDef: (techLevels[1444] || 0) * 8,
      heroHp: (techLevels[1445] || 0) * 20,
      troopVolume: (techLevels[1446] || 0) * 4
    };

    // ==========================================
    // LAYER E2: Habilidades Passivas da Árvore de Classes (SonTypes 101, 104, 105, 201, 204, 205, 301, 304, 320)
    // ==========================================
    const rawLearned = Array.isArray(saved.skills?.learned) ? saved.skills.learned : [];
    const learnedSkills = rawLearned.map(item => Number(typeof item === 'object' && item !== null ? item.templateId : item)).filter(n => Number.isSafeInteger(n) && n > 0);
    const skillBonuses=wartuneSkillBonuses.collect(learnedSkills,this.skillProps);
    // Each equipment instance contributes its default/refined property skills once.
    for(const item of equippedItems){
      const tpl=this.itemTemplates.get(Number(item.templateId));
      const ids=[tpl.DefaultSkill,...Array.from({length:5},(_,i)=>item['randomSkill_'+(i+1)]??item['randomSkill'+(i+1)]??item['random_skill_'+(i+1)])];
      const b=wartuneSkillBonuses.collect(ids,this.skillProps);
      for(const key of wartuneSkillBonuses.FIELDS){skillBonuses.flat[key]+=b.flat[key];skillBonuses.percent[key]+=b.percent[key];}
    }

    // ==========================================
    // LAYER E3: Alma do Dragão (Dragon Soul - t_s_upgradetemplate Types 101/102)
    // ==========================================
    if (saved && saved.dragonSoul) {
      const dsGrade = Math.min(13, Math.max(0, Number(saved.dragonSoul.grade) || 0));
      const dsType = Number(saved.dragonSoul.type) || 101;
      let dsLivePct = 0;
      let dsAtkPct = 0;
      let dsDefPct = 0;
      let dsMAtkPct = 0;
      let dsMDefPct = 0;

      for (let g = 1; g <= dsGrade; g++) {
        const u = this.dragonSoulUpgradeMap.get(`${dsType}_${g}`);
        if (u && u.ActiveObject) {
          const sp = this.skillProps.get(Number(u.ActiveObject));
          if (sp) {
            if (Number(sp.AddType) === 0) { // Percentual (+1%, +2%, etc.)
              dsLivePct += Number(sp.Live || 0);
              dsAtkPct += Number(sp.Attack || 0);
              dsDefPct += Number(sp.Defence || 0);
              dsMAtkPct += Number(sp.MagicAttack || 0);
              dsMDefPct += Number(sp.MagicDefence || 0);
            } else { // Plano (+20000 PV, +1000 ATQ, etc.)
              equipLive += Number(sp.Live || 0);
              equipAttack += Number(sp.Attack || 0);
              equipDefence += Number(sp.Defence || 0);
              equipMagicAttack += Number(sp.MagicAttack || 0);
              equipMagicDefence += Number(sp.MagicDefence || 0);
            }
          }
        }
      }

      if (dsLivePct > 0) skillBonuses.percent.Live = (skillBonuses.percent.Live || 0) + dsLivePct;
      if (dsAtkPct > 0) skillBonuses.percent.Attack = (skillBonuses.percent.Attack || 0) + dsAtkPct;
      if (dsDefPct > 0) skillBonuses.percent.Defence = (skillBonuses.percent.Defence || 0) + dsDefPct;
      if (dsMAtkPct > 0) skillBonuses.percent.MagicAttack = (skillBonuses.percent.MagicAttack || 0) + dsMAtkPct;
      if (dsMDefPct > 0) skillBonuses.percent.MagicDefence = (skillBonuses.percent.MagicDefence || 0) + dsMDefPct;
    }

    // ==========================================
    // LAYER E4: Runas e Reinos (Rune Gems e Furos de Runas)
    // ==========================================
    if (saved && (saved.runes || saved.army?.runes)) {
      const holes = Array.isArray(saved.runes?.holes) ? saved.runes.holes : [];
      for (const hole of holes) {
        if (!hole.pos) continue;
        const gemIds = String(hole.pos).split(',').map(Number).filter(id => id > 0);
        const holeBonus = (Number(hole.grade) || 1) * 0.05;
        for (const gemId of gemIds) {
          const gem = this.runeGemMap.get(gemId);
          if (gem) {
            const mult = 1 + holeBonus;
            equipAttack += Math.floor(Number(gem.Attack || 0) * mult);
            equipDefence += Math.floor(Number(gem.Defence || 0) * mult);
            equipMagicAttack += Math.floor(Number(gem.MagicAttack || 0) * mult);
            equipMagicDefence += Math.floor(Number(gem.MagicDefence || 0) * mult);
            equipLive += Math.floor(Number(gem.Live || 0) * mult);
            equipPower += Math.floor(Number(gem.Power || 0) * mult);
            equipAgility += Math.floor(Number(gem.Agility || 0) * mult);
            equipIntellect += Math.floor(Number(gem.Intellect || 0) * mult);
            equipPhysique += Math.floor(Number(gem.Physique || 0) * mult);
            equipCaptain += Math.floor(Number(gem.Captain || 0) * mult);
            equipForceHit += Math.floor(Number(gem.ForceHit || 0) * mult);
            equipParry += Math.floor(Number(gem.Parry || 0) * mult);
          }
        }
      }

      const runes = Array.isArray(saved.army?.runes) ? saved.army.runes : [];
      for (const r of runes) {
        const rTpl = secondaryFeatures.runeTemplateById.get(Number(r.runeId));
        if (rTpl) {
          const rGrade = Number(rTpl.RuneGrade || 1);
          equipAttack += rGrade * 30;
          equipDefence += rGrade * 20;
          equipMagicAttack += rGrade * 30;
          equipMagicDefence += rGrade * 20;
          equipLive += rGrade * 150;
        }
      }
    }

    // ==========================================
    // LAYER E5: Talentos e Selo Sagrado
    // ==========================================
    const tGrade = Number(saved?.talentGrade || 0);
    if (tGrade > 0) {
      equipPower += tGrade * 2;
      equipAgility += tGrade * 2;
      equipIntellect += tGrade * 2;
      equipPhysique += tGrade * 2;
      equipAttack += tGrade * 10;
      equipDefence += tGrade * 8;
      equipMagicAttack += tGrade * 10;
      equipMagicDefence += tGrade * 8;
      equipLive += tGrade * 50;
    }

    // ==========================================
    // LAYER E6: Roda do Destino (Fate / Destino)
    // ==========================================
    if (saved?.fate && Array.isArray(saved.fate.fates)) {
      for (const fate of saved.fate.fates) {
        for (const propStr of [fate.property1, fate.property2]) {
          if (!propStr || typeof propStr !== 'string') continue;
          const [pType, pVal] = propStr.split(':').map(Number);
          if (!pType || !pVal) continue;
          switch (pType) {
            case 1: equipPower += pVal; break;
            case 2: equipAgility += pVal; break;
            case 3: equipIntellect += pVal; break;
            case 4: equipPhysique += pVal; break;
            case 5: equipCaptain += pVal; break;
            case 6: equipAttack += pVal; break;
            case 7: equipDefence += pVal; break;
            case 8: equipMagicAttack += pVal; break;
            case 9: equipMagicDefence += pVal; break;
            case 10: equipLive += pVal; break;
            case 11: equipForceHit += pVal; break;
            case 12: equipParry += pVal; break;
          }
        }
      }
    }

    // ==========================================
    // LAYER E7: Tatuagem de Dragão (Tattoo Holes & Core Step)
    // ==========================================
    if (saved?.tattoo && Array.isArray(saved.tattoo.holes)) {
      const coreMult = 1 + (Number(saved.tattoo.coreStep || 1) - 1) * 0.1;
      for (const hole of saved.tattoo.holes) {
        const val = Math.floor(Number(hole.NewAddingValue || hole.OldAddingValue || 0) * coreMult);
        const prop = Number(hole.NewAddProperty || hole.OldAddProperty || 0);
        if (val > 0 && prop > 0) {
          switch (prop) {
            case 1: equipPower += val; break;
            case 2: equipAgility += val; break;
            case 3: equipIntellect += val; break;
            case 4: equipPhysique += val; break;
            case 5: equipCaptain += val; break;
            case 6: equipAttack += val; break;
            case 7: equipDefence += val; break;
            case 8: equipMagicAttack += val; break;
            case 9: equipMagicDefence += val; break;
            case 10: equipLive += val; break;
            case 11: equipForceHit += val; break;
            case 12: equipParry += val; break;
          }
        }
      }
    }

    // ==========================================
    // LAYER E8: Equipamento de Honra e Ascensão (t_s_honorequip Types 0 e 1)
    // ==========================================
    if (saved && saved.honorEquip) {
      const hLevel = Number(saved.honorEquip.level || 0);
      const hStage = Number(saved.honorEquip.stage || 0);
      if (hLevel > 0) {
        equipAttack += hLevel * 50;
        equipMagicAttack += hLevel * 50;
        equipDefence += hLevel * 30;
        equipMagicDefence += hLevel * 30;
        equipLive += hLevel * 200;
      }
      if (hStage > 0) {
        equipStrength += hStage * 80;
        equipTenacity += hStage * 40;
      }
    }

    // ==========================================
    // LAYER F: Totais Finais e Poder de Combate (FightingCapacity / Battle Rating)
    // ==========================================
    // Multipliers are applied exactly once, after flats, to the relevant base.
    const apply=(base,key)=>wartuneSkillBonuses.apply(base,key,skillBonuses);
    const totalPower=apply(basePower+equipPower,'Power');
    const totalAgility=apply(baseAgility+equipAgility,'Agility');
    const totalIntellect=apply(baseIntellect+equipIntellect,'Intellect');
    const totalPhysique=apply(basePhysique+equipPhysique,'Physique');
    const totalCaptain=apply(baseCaptain+equipCaptain,'Captain');
    const totalPhyAttack=apply(rawAttack+totalPower*4+equipAttack+techBonuses.heroAtk,'Attack');
    const totalMagicAttack=apply(rawMagicAttack+totalIntellect*4+equipMagicAttack+techBonuses.heroMAtk,'MagicAttack');
    const totalPhyDefence=apply(rawDefence+totalPower+totalAgility*4+equipDefence+techBonuses.heroDef,'Defence');
    const totalMagicDefence=apply(rawMagicDefence+totalIntellect+totalAgility*4+equipMagicDefence+techBonuses.heroMDef,'MagicDefence');
    const totalLive=apply(rawLive+totalPhysique*20+equipLive+techBonuses.heroHp,'Live');
    const totalConatArmy=apply(totalCaptain+equipConat+techBonuses.troopVolume,'Conat');
    const totalForceHit=apply(baseForceHit+equipForceHit,'ForceHit');
    const totalParry=apply(baseParry+equipParry,'Parry');
    const totalStrength = baseStrength + equipStrength;
    const totalTenacity = baseTenacity + equipTenacity;

    const fireResi = equipFireResi;
    const waterResi = equipWaterResi;
    const electResi = equipElectResi;
    const windResi = equipWindResi;
    const darkResi = equipDarkResi;
    const lightResi = equipLightResi;
    const reduceResi = equipReduceResi;
    const defensePenetration = equipDefensePenetration;
    const criticalResistance = equipCriticalResistance;
    const parryPenetration = equipParryPenetration;

    // FightingCapacity must derive from the SAME effective values shown on the hero
    // sheet and used by battle-engine, not from a second, divergent stat pipeline.
    const resistCapacity=2*defensePenetration+criticalResistance+parryPenetration+3*reduceResi+
      2*(waterResi+fireResi+electResi+windResi+darkResi+lightResi);
    const fightingCapacity=Math.floor(totalPhyAttack+Math.floor(1.05*totalMagicAttack)+
      totalPhyDefence+totalMagicDefence+Math.floor(totalLive/5)+totalConatArmy+
      totalForceHit+totalParry+resistCapacity);
    // Academy effects are already in the effective attributes; do not add twice.
    const techTotalFC=0;
    if(!Number.isSafeInteger(fightingCapacity)||fightingCapacity<0)throw Error('PC invalido');

    const totalPre = {
      power: 100, agility: 100, intel: 100, physi: 100, captain: 100,
      attack: 100, defence: 100, magicattack: 100, magicdefence: 100,
      live: 100, conat: 100, forcehit: 100, parry: 100
    };

    return {
      job,
      grade,
      remainPoint,
      allocatedPoints: {
        power: allocatedPower,
        agility: allocatedAgility,
        intellect: allocatedIntellect,
        physique: allocatedPhysique,
        captain: allocatedCaptain
      },
      // Atributos Primários Base
      basePower, baseAgility, baseIntellect, baseCaptain, basePhysique,
      // Atributos Secundários Base
      basePhyAttack, basePhyDefence, baseMagicAttack, baseMagicDefence,
      baseForceHit, baseParry, baseConatArmy, baseLive, baseStrength, baseTenacity,
      // Totais com Equipamentos e Tecnologias
      totalPower, totalAgility, totalIntellect, totalCaptain, totalPhysique,
      totalPhyAttack, totalPhyDefence, totalMagicAttack, totalMagicDefence,
      totalForceHit, totalParry, totalConatArmy, totalLive, totalStrength, totalTenacity,
      // Elementais e Especiais
      fireResi, waterResi, electResi, windResi, darkResi, lightResi, reduceResi,
      defensePenetration, criticalResistance, parryPenetration,
      // Tecnologias da Academia
      technologies: techLevels,
      techBonuses,
      techTotalFC,
      troops: {
        hpBonus: techBonuses.troopHp,
        atkBonus: techBonuses.troopAtk,
        defBonus: techBonuses.troopDef,
        mAtkBonus: techBonuses.troopMAtk,
        mDefBonus: techBonuses.troopMDef,
        volumeBonus: techBonuses.troopVolume
      },
      // Poder de Luta e Pre-multiplicadores
      fightingCapacity, totalPre
    };
  }

  /**
   * Compatibility with existing mount (8529/8532/8536) and Soul Engraving (8484)
   * handlers. Their DB mutation callbacks only have saved state, NOT the authoritative
   * character.grade held in the characters table. Never persist a fake level-1 PC.
   * The live heroInfo() snapshot recomputes from the committed character grade.
   */
  recalculate(saved, grade) {
    if(!saved || typeof saved !== 'object')throw Error('Estado invalido para recalculo');
    const level=Number(grade??saved.grade??saved.hero?.grade??0);
    if(!Number.isSafeInteger(level)||level<1)return null;
    return this.calculateAttributes({grade:level,job:saved.job,state_json:saved});
  }

  /**
   * Retorna os atributos efetivos para uso imediato no motor de combate (battle-engine.js).
   * Garante paridade estrita: Ficha UI === Atributos em Combate.
   */
  getEffectiveBattleStats(character) {
    const attrs = this.calculateAttributes(character);
    const isMagic = attrs.job === 3;
    const effectiveAttack = isMagic ? attrs.totalMagicAttack : attrs.totalPhyAttack;

    return {
      maxHp: attrs.totalLive,
      currentHp: attrs.totalLive,
      attack: Math.max(1, effectiveAttack),
      phyAttack: Math.max(1, attrs.totalPhyAttack),
      magicAttack: Math.max(1, attrs.totalMagicAttack),
      phyDefence: attrs.totalPhyDefence,
      magicDefence: attrs.totalMagicDefence,
      forceHit: attrs.totalForceHit,
      parry: attrs.totalParry,
      fightingCapacity: attrs.fightingCapacity,
      job: attrs.job,
      grade: attrs.grade
    };
  }
}

module.exports = new AttributeCalculatorService();
