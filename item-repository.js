'use strict';
const crypto = require('crypto');
const db = require('./db');

class ItemRepository {
  constructor() {
    this.templateCache = new Map();
    this.recipeCache = new Map();
  }

  async getTemplate(templateId) {
    const tId = Number(templateId);
    if (!Number.isSafeInteger(tId) || tId <= 0) return null;
    if (this.templateCache.has(tId)) return this.templateCache.get(tId);

    const pool = db.ready();
    const [rows] = await pool.execute(`
      SELECT template_id, name, description, category, master_type, son_type,
             need_grades, job, sexs, max_count, sell_gold, icon, icon_asset,
             asset_status, property1, suite_id, raw_json
      FROM item_templates WHERE template_id = ? LIMIT 1
    `, [tId]);

    if (!rows || rows.length === 0) return null;
    const row = rows[0];

    // Carregar stats normalizados
    const [stats] = await pool.execute(`
      SELECT stat_key, stat_value FROM item_template_stats WHERE template_id = ?
    `, [tId]);

    let templateObj = {};
    if (row.raw_json) {
      try {
        templateObj = JSON.parse(row.raw_json);
      } catch (e) {
        templateObj = {};
      }
    }

    templateObj.TemplateId = row.template_id;
    templateObj.TemplateName = row.name;
    templateObj.MasterType = row.master_type;
    templateObj.SonType = row.son_type;
    templateObj.NeedGrades = row.need_grades;
    templateObj.MaxCount = row.max_count;
    templateObj.SellGold = Number(row.sell_gold);
    templateObj.Icon = row.icon;
    templateObj.Property1 = Number(row.property1);
    templateObj.SuiteId = row.suite_id;

    if (row.job) {
      templateObj.Job = row.job.split(',').map(Number);
    } else {
      templateObj.Job = [0];
    }
    templateObj.Sexs = row.sexs;

    for (const s of stats) {
      templateObj[s.stat_key] = s.stat_value;
    }

    this.templateCache.set(tId, templateObj);
    return templateObj;
  }

  async getRecipe(recipeId) {
    const rId = Number(recipeId);
    if (!Number.isSafeInteger(rId) || rId <= 0) return null;
    if (this.recipeCache.has(rId)) return this.recipeCache.get(rId);

    const pool = db.ready();
    const [rows] = await pool.execute(`
      SELECT recipe_id, types, tab_type, need_min_level, need_building_temp,
             need_gold, output_template_id, output_count, raw_json
      FROM item_recipes WHERE recipe_id = ? LIMIT 1
    `, [rId]);

    if (!rows || rows.length === 0) return null;
    const recipe = rows[0];

    const [materials] = await pool.execute(`
      SELECT slot_index, material_template_id, material_count
      FROM item_recipe_materials WHERE recipe_id = ? ORDER BY slot_index ASC
    `, [rId]);

    recipe.materials = materials.map(m => ({
      slotIndex: m.slot_index,
      templateId: m.material_template_id,
      count: m.material_count
    }));

    this.recipeCache.set(rId, recipe);
    return recipe;
  }

  async recordLedger({ transactionUuid, characterId, operationType, recipeId = null, outputTemplateId = null, outputCount = 0, costGold = 0, details = {} }) {
    const pool = db.ready();
    const uuid = transactionUuid || crypto.randomUUID();
    await pool.execute(`
      INSERT INTO item_operations_ledger (
        transaction_uuid, character_id, operation_type, recipe_id, output_template_id, output_count, cost_gold, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      uuid,
      characterId,
      operationType,
      recipeId,
      outputTemplateId,
      outputCount,
      costGold,
      JSON.stringify(details)
    ]);
    return uuid;
  }

  async updateCoverage(templateId, status, result, errorNotes = null) {
    const pool = db.ready();
    await pool.execute(`
      INSERT INTO qa_item_coverage (template_id, category, status, test_case, result, error_notes)
      VALUES (?, (SELECT COALESCE(category, 'unknown') FROM item_templates WHERE template_id = ?), ?, 'FORGE_SYNTHESIS', ?, ?)
      ON DUPLICATE KEY UPDATE status = VALUES(status), test_case = VALUES(test_case), result = VALUES(result), error_notes = VALUES(error_notes), updated_at = CURRENT_TIMESTAMP
    `, [templateId, templateId, status, result, errorNotes]);
  }

  async executeCompose({ characterId, characterGrade, characterWallet, inventoryBag, composeId, composeNum = 1 }) {
    const num = Math.max(1, Number(composeNum) || 1);
    const recipe = await this.getRecipe(composeId);
    if (!recipe) throw Error(`Receita ${composeId} nao encontrada no banco de dados`);

    // Validação de nível mínimo
    if (characterGrade < recipe.need_min_level) {
      throw Error(`Nivel insuficiente para sintese: requerido ${recipe.need_min_level}, atual ${characterGrade}`);
    }

    // Validação de Ouro
    const totalGoldCost = Number(recipe.need_gold) * num;
    const currentGold = Number(characterWallet?.gold || 0);
    if (currentGold < totalGoldCost) {
      throw Error(`Ouro insuficiente para sintese: necessario ${totalGoldCost}, disponivel ${currentGold}`);
    }

    // Validação de Materiais na Bolsa
    const requiredMaterials = recipe.materials.map(m => ({
      templateId: m.templateId,
      totalCount: m.count * num
    }));

    for (const req of requiredMaterials) {
      const available = inventoryBag.items
        .filter(i => i.bagType === 1 && i.templateId === req.templateId)
        .reduce((sum, i) => sum + i.count, 0);

      if (available < req.totalCount) {
        throw Error(`Material insuficiente (Template ${req.templateId}): requerido ${req.totalCount}, disponivel ${available}`);
      }
    }

    // Execução Atômica: Deduzir materiais
    const moved = [];
    for (const req of requiredMaterials) {
      let needed = req.totalCount;
      for (let idx = inventoryBag.items.length - 1; idx >= 0 && needed > 0; idx--) {
        const item = inventoryBag.items[idx];
        if (item.bagType === 1 && item.templateId === req.templateId) {
          if (item.count <= needed) {
            needed -= item.count;
            inventoryBag.items.splice(idx, 1);
            moved.push({ bagType: 1, objectId: 0, pos: item.pos });
          } else {
            item.count -= needed;
            needed = 0;
            moved.push({ bagType: 1, objectId: 0, ownerId: characterId, pos: item.pos, item });
          }
        }
      }
    }

    // Deduzir Ouro
    characterWallet.gold = currentGold - totalGoldCost;

    // Gerar item sintetizado na bolsa
    const outputCount = (recipe.output_count || 1) * num;
    const outputTemplate = await this.getTemplate(recipe.output_template_id);
    if (!outputTemplate) throw Error(`Template de saida ${recipe.output_template_id} nao encontrado no banco`);

    const usedPos = new Set(inventoryBag.items.filter(i => i.bagType === 1).map(i => i.pos));
    let freePos = 0;
    while (usedPos.has(freePos)) freePos++;

    const newItem = {
      instanceId: inventoryBag.nextInstanceId++,
      templateId: recipe.output_template_id,
      pos: freePos,
      count: outputCount,
      bagType: 1,
      bind: true,
      used: false
    };
    inventoryBag.items.push(newItem);
    moved.push({ bagType: 1, objectId: 0, ownerId: characterId, pos: freePos, item: newItem });

    // Gravar Ledger
    const transactionUuid = crypto.randomUUID();
    await this.recordLedger({
      transactionUuid,
      characterId,
      operationType: 'FORGE_COMPOSE',
      recipeId: recipe.recipe_id,
      outputTemplateId: recipe.output_template_id,
      outputCount,
      costGold: totalGoldCost,
      details: {
        recipeId: recipe.recipe_id,
        composeNum: num,
        materialsConsumed: requiredMaterials,
        outputItem: newItem
      }
    });

    // Atualizar Cobertura QA
    await this.updateCoverage(recipe.output_template_id, 'TESTADO_SUCESSO', 'SUCESSO_FORJA');
    for (const req of requiredMaterials) {
      await this.updateCoverage(req.templateId, 'TESTADO_SUCESSO', 'CONSUMIDO_FORJA');
    }

    return {
      success: true,
      recipe,
      outputTemplate,
      newItem,
      moved,
      totalGoldCost,
      remainingGold: characterWallet.gold,
      transactionUuid
    };
  }
}

module.exports = new ItemRepository();
