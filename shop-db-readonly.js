'use strict';
/**
 * Adaptador de LEITURA do catálogo gerenciável para o servidor Node.js.
 * Requer pool mysql2/promise JÁ configurado no projeto.
 * NÃO substitui automaticamente shop-state.js nem faz compras.
 * A integração precisa ser feita no roteador de pacotes/protocolo do jogo.
 */

async function listMenus(pool) {
  const [rows] = await pool.execute(
    'SELECT id, parent_id, slug, title, position, icon_key FROM shop_sections WHERE enabled=1 ORDER BY COALESCE(parent_id,id), parent_id IS NOT NULL, position, id'
  );
  const parents = rows.filter(x => x.parent_id === null).map(x => ({
    id: Number(x.id), slug: x.slug, title: x.title, iconKey: x.icon_key, tabs: [],
  }));
  const byId = new Map(parents.map(x => [x.id, x]));
  for (const tab of rows.filter(x => x.parent_id !== null)) {
    const parent = byId.get(Number(tab.parent_id));
    if (parent) parent.tabs.push({ id: Number(tab.id), slug: tab.slug, title: tab.title });
  }
  return parents;
}

async function listProductsForTab(pool, tabId) {
  if (!Number.isSafeInteger(Number(tabId)) || Number(tabId) <= 0) throw new Error('Aba inválida');
  const [rows] = await pool.execute(`
    SELECT s.Id AS goodId, s.ItemId AS itemId, s.Area AS originalArea,
           s.Gold AS goldPrice, s.Point AS balensPrice,
           s.GiftToken AS boundBalensPrice, s.Price AS alternativePrice,
           s.NeedMinGrade AS minLevel, s.NeedMinVip AS minVip,
           COALESCE(c.display_name, '') AS adminName,
           COALESCE(c.daily_override, s.Vipp0) AS defaultDailyCap,
           COALESCE(c.weekly_override, s.WeeklyLimit) AS weeklyCap,
           COALESCE(c.monthly_override, s.MonthLimit) AS monthlyCap,
           COALESCE(c.enabled, 1) AS enabled
    FROM shop_section_products p
    INNER JOIN shop_sections t ON t.id = p.section_id AND t.enabled = 1
    INNER JOIN shop_sections m ON m.id = t.parent_id AND m.enabled = 1
    INNER JOIN t_s_shop s ON s.Id = p.good_id
    LEFT JOIN shop_product_controls c ON c.good_id = s.Id
    WHERE p.section_id = ? AND COALESCE(c.enabled,1)=1
    ORDER BY p.position,s.Id`, [Number(tabId)]);
  return rows;
}

/** Obtém limites EFETIVOS de compra para VIP real do personagem. */
async function getPurchaseRules(pool, goodId, vipLevel) {
  const vip = Number(vipLevel);
  if (!Number.isInteger(vip) || vip < 0 || vip > 19) throw new Error('VIP inválido (0 a 19)');
  const id = Number(goodId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Produto inválido');
  // Coluna dinâmica whitelist rigorosa: apenas Vipp0...Vipp19.
  const vipColumn = '`Vipp' + vip + '`';
  const [rows] = await pool.execute(`
     SELECT s.Id AS goodId, s.ItemId AS itemId,
            s.Gold AS goldPrice, s.Point AS balensPrice,
            s.GiftToken AS boundBalensPrice, s.Price AS alternativePrice,
            s.ConsortiaOffer, s.Honor, s.MazeCoin, s.MineScore,
            s.Score, s.LordsScore, s.NeedConsortiaLevels,
            s.NeedMinGrade AS minLevel, s.NeedMinVip AS minVip,
            COALESCE(c.enabled, 1) AS enabled,
            COALESCE(c.daily_override, s.${vipColumn}) AS dailyCap,
            COALESCE(c.weekly_override, s.WeeklyLimit) AS weeklyCap,
            COALESCE(c.monthly_override, s.MonthLimit) AS monthlyCap
     FROM t_s_shop s LEFT JOIN shop_product_controls c ON c.good_id = s.Id WHERE s.Id = ?`, [id]);
  return rows[0] || null;
}

module.exports = { listMenus, listProductsForTab, getPurchaseRules };
