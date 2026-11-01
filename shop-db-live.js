'use strict';

// Ponte entre o painel PHP e a loja existente. Usa o pool mysql2 já aberto
// pelo processo do jogo. Não inicia outro servidor, não escreve no catálogo.
const shopP0 = require('./shop-p0-catalog');
const { getPurchaseRules } = require('./shop-db-readonly');

function numeric(value, fallback = 0) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : fallback;
}

function asOffer(row) {
  if (!row) return null;
  return {
    Id: numeric(row.goodId),
    ItemId: numeric(row.itemId),
    Gold: numeric(row.goldPrice),
    Point: numeric(row.balensPrice),
    GiftToken: numeric(row.boundBalensPrice),
    Price: numeric(row.alternativePrice),
    ConsortiaOffer:numeric(row.ConsortiaOffer), Honor:numeric(row.Honor),
    MazeCoin:numeric(row.MazeCoin), MineScore:numeric(row.MineScore),
    Score:numeric(row.Score), LordsScore:numeric(row.LordsScore),
    NeedConsortiaLevels:numeric(row.NeedConsortiaLevels),
    enabled: numeric(row.enabled, 1),
    minLevel: numeric(row.minLevel),
    minVip: numeric(row.minVip),
    dailyCap: numeric(row.dailyCap, -1),
    weeklyCap: numeric(row.weeklyCap, -1),
    monthlyCap: numeric(row.monthlyCap, -1)
  };
}

async function purchaseRules(connection, goodId, vipLevel) {
  // Isto é lido NA TRANSAÇÃO da compra: uma alteração no painel não deve
  // passar despercebida enquanto uma compra é confirmada.
  return asOffer(await getPurchaseRules(connection, goodId, vipLevel));
}

const publishedSQL = `
 SELECT s.Id AS goodId,s.ItemId AS itemId,s.Gold AS goldPrice,s.Point AS balensPrice,
        s.GiftToken AS boundBalensPrice,s.Price AS alternativePrice,
        COALESCE(c.enabled,1) AS enabled,
        COALESCE(c.daily_override,s.Vipp0) AS dailyCap,
        COALESCE(c.weekly_override,s.WeeklyLimit) AS weeklyCap,
        COALESCE(c.monthly_override,s.MonthLimit) AS monthlyCap
 FROM t_s_shop s
 JOIN (
   SELECT p.good_id,MIN(p.position) AS position
   FROM shop_section_products p
   JOIN shop_sections t ON t.id=p.section_id AND t.enabled=1
   JOIN shop_sections m ON m.id=t.parent_id AND m.enabled=1
   GROUP BY p.good_id
 ) published ON published.good_id=s.Id
 LEFT JOIN shop_product_controls c ON c.good_id=s.Id
 WHERE COALESCE(c.enabled,1)=1
 ORDER BY published.position,s.Id LIMIT 65`;

async function readPublished(pool) {
  const [rows] = await pool.execute(publishedSQL);
  return rows.map(asOffer);
}

async function readFixedOverrides(pool) {
  const ids = shopP0.limited.map(g => Number(g.id));
  if (!ids.length) return new Map();
  const inClause = ids.map(() => '?').join(',');
  const [rows] = await pool.execute(`
    SELECT s.Id AS goodId,s.ItemId AS itemId,s.Gold AS goldPrice,
           s.Point AS balensPrice,s.GiftToken AS boundBalensPrice,
           s.Price AS alternativePrice,COALESCE(c.enabled,1) AS enabled,
           COALESCE(c.daily_override,s.Vipp0) AS dailyCap,
           COALESCE(c.weekly_override,s.WeeklyLimit) AS weeklyCap,
           COALESCE(c.monthly_override,s.MonthLimit) AS monthlyCap
    FROM t_s_shop s LEFT JOIN shop_product_controls c ON c.good_id=s.Id
    WHERE s.Id IN (${inClause})`, ids);
  return new Map(rows.map(row => [numeric(row.goodId), asOffer(row)]));
}

function utcDay(now) { return now.toISOString().slice(0,10); }
function countToday(saved, id, date) {
  const day=utcDay(date);
  const count = saved?.shopAdminPurchases?.daily?.[day]?.[id];
  if (count !== undefined) return numeric(count);
  return shopP0.limitedCount(saved,id,date);
}
function displayPrice(good) {
  // discountInfo do cliente original exibe valores como Balens. Não anunciar
  // preços Gold/boundBalens como se fossem Balens; compras ainda são validadas.
  if (good.Gold > 0) return null;
  if (good.Point > 0) return good.Point;
  if (good.Price > 0) return good.Price;
  if (good.GiftToken > 0) return null;
  return null;
}
function promotion(good, index, saved, date) {
  const price=displayPrice(good);
  if (price === null) return null;
  const stamp=date.toISOString().slice(0,19).replace('T',' ');
  return {
    id:good.Id,site:1,shopId:0,templateId:good.ItemId,counts:1,
    sortId:index+1,discount:100,beginDate:'2026-01-01 00:00:00',
    endDate:'2030-12-31 23:59:59',oneDayCount:good.dailyCap,
    maxCount:good.monthlyCap,currentCount:countToday(saved,good.Id,date),
    maxCurrentDate:stamp,isGift:false,price,type:1,limitCount:good.dailyCap,
    vip:0,customType:0
  };
}

async function livePayload(pool, saved, now = new Date()) {
  // Exibe ofertas P0 compatíveis + produtos publicados nas abas do painel.
  // Menu/abas LayaAir em si continuam dependendo de modificação no cliente.
  const [published, overrides] = await Promise.all([
    readPublished(pool), readFixedOverrides(pool)
  ]);
  const goods=[];const seen=new Set();
  for (const legacy of shopP0.limited) {
    const over=overrides.get(legacy.id);
    if (over && over.enabled !== 1) continue;
    const good=over || {
      Id:legacy.id,ItemId:legacy.itemId,Gold:0,Point:legacy.price,
      Price:0,GiftToken:0,dailyCap:1,weeklyCap:-1,monthlyCap:-1
    };
    goods.push(good);seen.add(good.Id);
  }
  for(const good of published)if(!seen.has(good.Id)){
    goods.push(good);seen.add(good.Id);
  }
  const discountInfo=goods.map((good,index)=>promotion(good,index,saved,now)).filter(Boolean);
  return {urlInfo:[],goodInfo:[],discountInfo};
}

module.exports = { purchaseRules, livePayload, readPublished, displayPrice,
  countToday, _asOffer:asOffer };
