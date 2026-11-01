/**
 * canonical-config-repository.js
 * 
 * Repositório Canônico e Unificado dos 271 Arquivos de Configuração do Wartune Ultra v0.9.7.
 * Carrega todos os 271 JSONs de res/release/config no boot do servidor,
 * indexa por chaves primárias e fornece APIs autoritativas para todos os 25 subsistemas de jogo.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

class CanonicalConfigRepository {
  constructor() {
    this.configDir = path.resolve(__dirname, '../res/release/config');
    this.rawConfigs = new Map();
    this.tableIndex = new Map();
    this.indexedMaps = new Map();
    this.fileMetadata = [];
    this.isLoaded = false;
    this.loadStats = {
      totalFiles: 0,
      totalEntries: 0,
      loadDurationMs: 0,
      subsystems: {}
    };
  }

  loadAll() {
    if (this.isLoaded) return this;
    const t0 = Date.now();

    if (!fs.existsSync(this.configDir)) {
      console.error('[CONFIG-REPO] Diretório de configurações não encontrado:', this.configDir);
      return this;
    }

    const files = fs.readdirSync(this.configDir).filter(f => f.endsWith('.json'));
    this.loadStats.totalFiles = files.length;

    for (const fileName of files) {
      const filePath = path.join(this.configDir, fileName);
      try {
        const rawContent = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(rawContent);

        // O nome base da tabela é o prefixo antes do primeiro hífen
        const tableName = fileName.split('-')[0];

        // Determinar array de dados
        let dataRows = [];
        if (Array.isArray(parsed)) {
          dataRows = parsed;
        } else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed[tableName])) {
            dataRows = parsed[tableName];
          } else {
            // Pode ser um dicionário ou objeto com chaves
            const keys = Object.keys(parsed);
            if (keys.length === 1 && Array.isArray(parsed[keys[0]])) {
              dataRows = parsed[keys[0]];
            } else {
              dataRows = parsed;
            }
          }
        }

        const count = Array.isArray(dataRows) ? dataRows.length : Object.keys(dataRows).length;
        this.loadStats.totalEntries += count;

        this.rawConfigs.set(tableName, dataRows);
        this.tableIndex.set(fileName, tableName);

        // Criar índice por chave primária
        if (Array.isArray(dataRows) && dataRows.length > 0) {
          const sample = dataRows[0];
          // Detectar chave primária comum
          const pkCandidates = [
            'TemplateId', 'TemplateID', 'Id', 'ID', 'ItemId', 'SkillID', 'SkillId',
            'CampaignId', 'DropId', 'QuestId', 'TaskId', 'Grade', 'Grades', 'Level',
            'MapId', 'BossId', 'StarId', 'TitleId', 'ConsortiaLevel', 'SystemID'
          ];
          const pk = pkCandidates.find(k => k in sample);
          if (pk) {
            const indexMap = new Map();
            for (const row of dataRows) {
              const val = row[pk];
              if (val !== undefined && val !== null) {
                indexMap.set(Number(val) || String(val), row);
              }
            }
            this.indexedMaps.set(tableName, { pk, map: indexMap });
          }
        }

        // Subclassificar por subsistema
        const sub = this._detectSubsystem(tableName);
        this.loadStats.subsystems[sub] = (this.loadStats.subsystems[sub] || 0) + 1;

        this.fileMetadata.push({
          fileName,
          tableName,
          entries: count,
          subsystem: sub,
          hasIndex: this.indexedMaps.has(tableName)
        });

      } catch (err) {
        console.error(`[CONFIG-REPO] Erro ao carregar ${fileName}:`, err.message);
      }
    }

    this.loadStats.loadDurationMs = Date.now() - t0;
    this.isLoaded = true;
    console.log(`[CONFIG-REPO] 100% Carregado: ${this.rawConfigs.size}/${this.loadStats.totalFiles} arquivos | ${this.loadStats.totalEntries} registros em ${this.loadStats.loadDurationMs}ms`);
    return this;
  }

  _detectSubsystem(name) {
    if (name.includes('equip') || name.includes('compose') || name.includes('divinecast') || name.includes('strengthen')) return 'Ferreiro e Equipamentos';
    if (name.includes('pet') || name.includes('sylph')) return 'Silfos e Mascotes';
    if (name.includes('mount')) return 'Montarias';
    if (name.includes('guard') || name.includes('combatguardian')) return 'Guardião de Combate';
    if (name.includes('skill') || name.includes('action') || name.includes('effect')) return 'Habilidades e Ações';
    if (name.includes('campaign') || name.includes('map') || name.includes('pawn') || name.includes('monster') || name.includes('crisis')) return 'Campanhas, Mapas e Monstros';
    if (name.includes('drop')) return 'Drops e Recompensas';
    if (name.includes('item') || name.includes('shop') || name.includes('goods')) return 'Itens e Lojas';
    if (name.includes('quest') || name.includes('reward') || name.includes('target') || name.includes('task')) return 'Missões e Metas';
    if (name.includes('consortia') || name.includes('guild')) return 'Guilda e Consortia';
    if (name.includes('star') || name.includes('astral')) return 'Astrologia e Estrelas';
    if (name.includes('rune')) return 'Runas e Furos';
    if (name.includes('soul')) return 'Cristais de Alma e Tatuagem';
    if (name.includes('marry') || name.includes('marriage')) return 'Casamento';
    if (name.includes('rareweapon')) return 'Armas Raras';
    if (name.includes('home') || name.includes('furniture')) return 'Lar e Árvore';
    if (name.includes('transfer') || name.includes('transform') || name.includes('extrajob')) return 'Ascenção e Classes';
    if (name.includes('battlefield') || name.includes('pvp') || name.includes('arena')) return 'Arena e Campo de Batalha';
    if (name.includes('vip') || name.includes('recharge') || name.includes('growthfund') || name.includes('pass')) return 'VIP, Passes e Fundo';
    if (name.includes('activity') || name.includes('carnival') || name.includes('seven') || name.includes('online')) return 'Eventos e Atividades';
    if (name.includes('gacha') || name.includes('wishing') || name.includes('turntable') || name.includes('lottery')) return 'Sorteios e Gacha';
    if (name.includes('language') || name.includes('chat') || name.includes('translate')) return 'Localização e Chat';
    return 'Geral e Sistema';
  }

  // Métodos Universais
  getTable(tableName) {
    if (!this.isLoaded) this.loadAll();
    return this.rawConfigs.get(tableName) || [];
  }

  getById(tableName, id) {
    if (!this.isLoaded) this.loadAll();
    const entry = this.indexedMaps.get(tableName);
    if (!entry) {
      const rows = this.getTable(tableName);
      if (Array.isArray(rows)) {
        return rows.find(r => r.Id == id || r.TemplateId == id || r.ID == id || r.TemplateID == id);
      }
      return null;
    }
    const numId = Number(id);
    return entry.map.get(numId) || entry.map.get(String(id)) || null;
  }

  filter(tableName, predicate) {
    const rows = this.getTable(tableName);
    return Array.isArray(rows) ? rows.filter(predicate) : [];
  }

  // ==========================================
  // APIS DE SUBSISTEMAS AUTORITATIVOS
  // ==========================================

  // 1. Ferreiro e Forja Sagrada
  getEquipStrengthen(templateId, level) {
    return this.filter('t_s_equipstrengthen', r => Number(r.TemplateId) === Number(templateId) && Number(r.Level) === Number(level))[0] || null;
  }
  getEquipGodforge(templateId, level) {
    return this.filter('t_s_equipgodforge', r => Number(r.TemplateId) === Number(templateId) && Number(r.Level) === Number(level))[0] || null;
  }
  getEquipRefresh(templateId, level) {
    return this.filter('t_s_equip_refresh', r => Number(r.TemplateId) === Number(templateId) && Number(r.Level) === Number(level));
  }
  getDivineCast(id, level) {
    return this.filter('t_s_divinecastlevel', r => Number(r.Id) === Number(id) && Number(r.Level) === Number(level))[0] || null;
  }
  getComposeRecipe(targetItemId) {
    return this.filter('t_s_compose', r => Number(r.ItemId) === Number(targetItemId))[0] || null;
  }

  // 2. Silfos e Mascotes
  getSylphTemplate(templateId) {
    return this.getById('t_s_pettemplate', templateId);
  }
  getSylphPromotion(quality) {
    return this.filter('t_s_petpromotion', r => Number(r.Quality) === Number(quality))[0] || null;
  }
  getPetEquipStrengthen(templateId, level) {
    return this.filter('t_s_petequipstrengthen', r => Number(r.TemplateId) === Number(templateId) && Number(r.Level) === Number(level))[0] || null;
  }

  // 3. Montarias
  getMountTemplate(templateId) {
    return this.getById('t_s_mounttemplate', templateId);
  }
  getMountUpgrade(grade) {
    return this.filter('t_s_mountupgrade', r => Number(r.Grades) === Number(grade))[0] || null;
  }
  getMountKingUpgrade(id) {
    return this.getById('t_s_mountkingupgrade', id);
  }

  // 4. Guardião de Combate
  getCombatGuardianTemplate(guardianId) {
    return this.getById('t_s_combatguardiantemplate', guardianId);
  }
  getCombatGuardianUpgrade(guardianId, grade) {
    return this.filter('t_s_combatguardianupgrade', r => Number(r.GuardianID) === Number(guardianId) && Number(r.BreakCondition) === Number(grade))[0] || null;
  }
  getCombatGuardianStar(guardianId, star) {
    return this.filter('t_s_combatguardianstar', r => Number(r.GuardianID) === Number(guardianId) && Number(r.Star) === Number(star))[0] || null;
  }

  // 5. Itens e Consumíveis
  getItemTemplate(templateId) {
    return this.getById('t_s_itemtemplate', templateId);
  }
  getItemPriceLimit(templateId) {
    return this.getById('t_s_itempricelimit', templateId);
  }

  // 6. Habilidades e Buffs
  getSkillTemplate(skillId) {
    return this.getById('t_s_skilltemplate', skillId);
  }
  getSkillBuffer(bufferId) {
    return this.getById('t_s_skillbuffertemplate', bufferId);
  }
  getSkillProperty(propertyId) {
    return this.getById('t_s_skillpropertytemplate', propertyId);
  }

  // 7. Campanhas, Mapas e Monstros
  getCampaignTemplate(campaignId) {
    return this.getById('t_s_campaign', campaignId);
  }
  getCampaignDataNodes(campaignId) {
    return this.filter('t_s_campaigndata', r => Number(r.CampaignId) === Number(campaignId));
  }
  getMapTemplate(mapId) {
    return this.getById('t_s_map', mapId);
  }
  getPawnTemplate(pawnId) {
    return this.getById('t_s_pawntemplate', pawnId);
  }

  // 8. Drops
  getDropItem(dropId) {
    return this.filter('t_s_dropitem', r => Number(r.DropId) === Number(dropId));
  }
  getDropCondition(conditionId) {
    return this.getById('t_s_dropcondition', conditionId);
  }

  // 9. Missões e Recompensas
  getQuestTemplate(questId) {
    return this.getById('t_s_questtemplate', questId);
  }
  getRewardTemplate(rewardId) {
    return this.getById('t_s_rewardtemplate', rewardId);
  }
  getDailyTarget(targetId) {
    return this.getById('t_s_dailytarget', targetId);
  }

  // 10. Títulos (Appell)
  getAppell(titleId) {
    return this.getById('t_s_appell', titleId);
  }

  // 11. Runas e Furos
  getRuneTemplate(runeId) {
    return this.getById('t_s_runetemplate', runeId);
  }
  getRuneHole(holeId) {
    return this.getById('t_s_runehole', holeId);
  }

  // 12. Cristais de Alma
  getSoulTemplate(soulId) {
    return this.getById('t_s_soultemplate', soulId);
  }
  getSoulUpgrade(grade) {
    return this.getById('t_s_soulupgrade', grade);
  }

  // 13. Guilda (Consortia)
  getConsortiaLevel(level) {
    return this.filter('t_s_consortialevel', r => Number(r.Level) === Number(level))[0] || null;
  }
  getConsortiaTask(taskId) {
    return this.getById('t_s_consortiatask', taskId);
  }
  getConsortiaBoss(bossId) {
    return this.getById('t_s_consortiaboss', bossId);
  }

  // 14. Astrologia
  getStarTemplate(starId) {
    return this.getById('t_s_startemplate', starId);
  }
  getStarMap(mapId) {
    return this.getById('t_s_starmap', mapId);
  }

  // 15. Armas Raras
  getRareWeaponTemplate(weaponId) {
    return this.getById('t_s_rareweapontemplate', weaponId);
  }
  getRareWeaponUpgrade(upgradeId) {
    return this.getById('t_s_rareweaponupgrade', upgradeId);
  }

  // 16. Casamento
  getMarriageTime(id) {
    return this.getById('t_s_marriagetimetemplate', id);
  }
  getMarriageSkill(skillId) {
    return this.getById('t_s_marryskill', skillId);
  }

  // 17. Lar e Árvore
  getHomeTreeItem(itemId) {
    return this.getById('t_s_hometreeitem', itemId);
  }
  getFurniture(furnitureId) {
    return this.getById('t_s_furniture', furnitureId);
  }

  // 18. Ascenção e Classes
  getTransferTemplate(id) {
    return this.getById('t_s_transfer', id);
  }
  getExtraJob(jobId) {
    return this.getById('t_s_extrajob', jobId);
  }
  getExtraJobEquip(equipId) {
    return this.getById('t_s_extrajobequip', equipId);
  }

  // 19. VIP e Passes
  getVipPackage(vipLv) {
    return this.getById('t_s_vippackage', vipLv);
  }
  getPassCheck(passId) {
    return this.getById('t_s_passcheck', passId);
  }
  getGrowthFund(id) {
    return this.getById('t_s_growthfund', id);
  }

  // 20. Eventos e Atividades
  getActivity(actId) {
    return this.getById('t_s_activity', actId);
  }
  getSevenDayLogin(day) {
    return this.filter('t_s_sevendaylogin', r => Number(r.Day) === Number(day))[0] || null;
  }
  getSevenSignin(day) {
    return this.filter('t_s_sevensignin', r => Number(r.Day) === Number(day))[0] || null;
  }

  // 21. Sorteios e Gacha
  getGachaSet(setId) {
    return this.filter('t_s_gachaset', r => Number(r.SetId) === Number(setId));
  }
  getWishingPool(poolId) {
    return this.getById('t_s_wishingpool', poolId);
  }
  getTurntableReward(rewardId) {
    return this.getById('t_s_turntablereward', rewardId);
  }

  // Diagnóstico
  getStats() {
    if (!this.isLoaded) this.loadAll();
    return this.loadStats;
  }
}

const instance = new CanonicalConfigRepository();
module.exports = instance;
