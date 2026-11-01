'use strict';

const fs = require('fs');
const path = require('path');
const inventoryState = require('./inventory-state');
const shopP0 = require('./shop-p0-catalog');
const shopDbLive = require('./shop-db-live');

const configRoot = path.resolve(__dirname, '../res/release/config');

function loadCatalog(prefix) {
  try {
    const file = fs.readdirSync(configRoot).find(f => f.startsWith(prefix + '-'));
    if (!file) return [];
    const content = JSON.parse(fs.readFileSync(path.join(configRoot, file), 'utf8'));
    return content[prefix] || [];
  } catch (err) {
    return [];
  }
}

const shopGoods = new Map(loadCatalog('t_s_shop').map(item => [Number(item.Id), item]));
const itemTemplates = new Map(loadCatalog('t_s_itemtemplate').map(t => [Number(t.TemplateId), t]));
for(const good of [...shopP0.limited,...shopP0.fashion])
  shopGoods.set(good.id,{Id:good.id,ItemId:good.itemId,Point:good.price,
    Price:0,GiftToken:0,Gold:0});

function getShopGood(goodId) {
  return shopGoods.get(Number(goodId)) || null;
}

function getItemTemplate(templateId) {
  return itemTemplates.get(Number(templateId)) || null;
}

function firstFreeBagPos(items) {
  const used = new Set(items.filter(item => item.bagType === 1).map(item => item.pos));
  let pos = 0;
  while (used.has(pos)) pos++;
  return pos;
}

/**
 * Realiza a compra de um item da loja (Opcode C2S 5154 / 90 - U_C_SHOP_BUY)
 */
function utcKeys(date) {
  const day = date.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const monday = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay()+6)%7);
  return { day, week:monday.toISOString().slice(0,10), month };
}

function recordManagedPurchase(saved, good, count, date=new Date()) {
  const counters=saved.shopAdminPurchases ||= {daily:{},weekly:{},monthly:{}};
  const keys=utcKeys(date);
  for (const [bucket,key,limit] of [
    ['daily',keys.day,good.dailyCap],
    ['weekly',keys.week,good.weeklyCap],
    ['monthly',keys.month,good.monthlyCap]
  ]) {
    const cap = (limit !== undefined && limit !== null && Number.isSafeInteger(Number(limit))) ? Number(limit) : -1;
    const period=counters[bucket] ||= {};
    const previous=Number(period[key]?.[good.Id || good.goodId] || 0);
    if(!Number.isSafeInteger(previous) || previous < 0) throw Error('Contador de compras inválido');
    if(cap!==-1 && previous+count>cap)throw Error(`Limite ${bucket} da oferta #${good.Id || good.goodId} atingido`);
  }
  for(const [bucket,key] of [['daily',keys.day],['weekly',keys.week],['monthly',keys.month]]){
    const period=counters[bucket];
    const entry=period[key] ||= {};
    const gKey = good.Id || good.goodId;
    entry[gKey]=Number(entry[gKey] || 0)+count;
    // Evita crescimento ilimitado do JSON com compras antigas.
    const expired=Object.keys(period).sort().slice(0,Math.max(0,Object.keys(period).length-55));
    for(const old of expired) delete period[old];
  }
}

function buyShopItem(savedState, goodId, count = 1, payType = 0, managedGood = null, character = {}) {
  if (!savedState || typeof savedState !== 'object') savedState = {};
  const gId = Number(goodId);
  const buyCount = Number(count);

  if (buyCount <= 0 || buyCount > 9999 || !Number.isSafeInteger(buyCount)) {
    throw new Error(`Quantidade de compra inválida: ${count}`);
  }

  const good = managedGood || shopGoods.get(gId);
  if (!good) {
    throw new Error(`Item da loja com ID ${gId} não encontrado no catálogo`);
  }

  if (managedGood) {
    if (good.enabled !== 1) throw Error('Oferta desabilitada no painel');
    if (Number(character.grade || 0) < good.minLevel) throw Error('Nível insuficiente para esta oferta');
    if (Number(character.vip || 0) < good.minVip) throw Error('VIP insuficiente para esta oferta');
  }

  savedState.shop = savedState.shop || {};
  // Older characters have weekly=[]; numeric catalog IDs make that a sparse
  // array of >200,000 nulls when serialized and exceed MariaDB's packet limit.
  if (!savedState.shop.weekly || Array.isArray(savedState.shop.weekly)) {
    savedState.shop.weekly = Object.fromEntries(Object.entries(savedState.shop.weekly || {}));
  }
  const activeWeek=utcKeys(new Date()).week;
  if(savedState.shop.weeklyPeriod && savedState.shop.weeklyPeriod!==activeWeek)
    savedState.shop.weekly={};
  savedState.shop.weeklyPeriod=activeWeek;
  const weeklyBought = Number(savedState.shop.weekly[gId] || 0);
  if (good.WeeklyLimit && Number(good.WeeklyLimit) > 0 && (weeklyBought + buyCount) > Number(good.WeeklyLimit)) {
    throw new Error(`Limite semanal atingido para este item (${good.WeeklyLimit})`);
  }
  const itemId = Number(good.ItemId || good.itemId);
  const itemTemplate = itemTemplates.get(itemId);
  if (!itemTemplate) {
    throw new Error(`Template de item ${itemId} referenciado pela loja não encontrado`);
  }

  // 1. Determina moeda e custo total
  let currency = 'gold';
  let unitPrice = 0;

  const goldVal = Number(good.Gold || good.goldPrice || 0);
  const consortiaVal = Number(good.ConsortiaOffer || good.consortiaPrice || 0);
  const honorVal = Number(good.Honor || good.honorPrice || 0);
  const mazeVal = Number(good.MazeCoin || 0);
  const mineVal = Number(good.MineScore || 0);
  const scoreVal = Number(good.Score || 0);
  const lordsScoreVal = Number(good.LordsScore || 0);
  const pointVal = Number(good.Point || good.balensPrice || 0);
  const giftTokenVal = Number(good.GiftToken || good.boundBalensPrice || 0);
  const priceVal = Number(good.Price || good.alternativePrice || 0);

  if (goldVal > 0) {
    currency = 'gold';
    unitPrice = goldVal;
  } else if (consortiaVal > 0) {
    currency = 'consortiaOffer';
    unitPrice = consortiaVal;
  } else if (honorVal > 0) {
    currency = 'honor';
    unitPrice = honorVal;
  } else if (mazeVal > 0) {
    currency = 'mazeCoin';
    unitPrice = mazeVal;
  } else if (mineVal > 0) {
    currency = 'mineScore';
    unitPrice = mineVal;
  } else if (scoreVal > 0) {
    currency = 'score';
    unitPrice = scoreVal;
  } else if (lordsScoreVal > 0) {
    currency = 'lordsScore';
    unitPrice = lordsScoreVal;
  } else if (Number(payType) === 0 && (pointVal > 0 || priceVal > 0)) {
    currency = 'balens';
    unitPrice = pointVal || priceVal;
  } else if (giftTokenVal > 0) {
    currency = 'boundBalens';
    unitPrice = giftTokenVal;
  } else if (pointVal > 0 || priceVal > 0) {
    currency = 'balens';
    unitPrice = pointVal || priceVal;
  } else {
    throw new Error(`Moeda não identificada para a oferta ${gId}`);
  }

  const totalCost = unitPrice * buyCount;
  if (!Number.isSafeInteger(totalCost) || totalCost < 0) throw Error('Preço ou quantidade fora do limite seguro');

  // 2. Valida saldo da carteira
  savedState.wallet ||= { gold: 0, balens: 0, boundBalens: 0 };
  let currentBalance = Number(savedState.wallet[currency] ?? savedState[currency] ?? 0);

  if (totalCost > 0 && currentBalance < totalCost) {
    if (currency === 'boundBalens' && Number(savedState.wallet.balens || 0) >= totalCost) {
      currency = 'balens';
      currentBalance = Number(savedState.wallet.balens || 0);
    } else if (currency === 'balens' && Number(savedState.wallet.boundBalens || 0) >= totalCost) {
      currency = 'boundBalens';
      currentBalance = Number(savedState.wallet.boundBalens || 0);
    } else {
      const currencyNames = {
        gold: 'Ouro',
        balens: 'Diamantes/Balens',
        boundBalens: 'Balens Vinculados',
        honor: 'Honra',
        mazeCoin: 'Moedas do Labirinto',
        mineScore: 'Ametistas / Pontos de Mina',
        consortiaOffer: 'Contribuição da Guilda',
        score: 'Pontos',
        lordsScore: 'Pontos de Lorde'
      };
      throw new Error(`Saldo insuficiente de ${currencyNames[currency] || currency}: requer ${totalCost} (possui ${currentBalance})`);
    }
  }

  // 3. Valida capacidade da bolsa e adiciona ou empilha o item
  const bag = inventoryState.inventory(savedState);
  const isStackable = Number(itemTemplate.MasterType) !== 1;
  const maxStack = (Number(itemTemplate.MaxCount) > 1) ? Number(itemTemplate.MaxCount) : 999999;
  let existingItem = null;
  if (isStackable) {
    existingItem = bag.items.find(item => Number(item.bagType) === 1 && Number(item.templateId) === itemId && (Number(item.count || 0) + buyCount) <= maxStack);
  }

  let targetPos = -1;
  if (!existingItem) {
    const freePos = firstFreeBagPos(bag.items);
    if (freePos >= 192) {
      throw new Error('A bolsa está cheia: não há slots livres disponíveis');
    }
    targetPos = freePos;
  }

  if (!managedGood && shopP0.fashionIds.has(gId) && (currency !== 'balens' || unitPrice !== 1)) {
    throw new Error('Preço de moda divergente do catálogo P0');
  }
  if (managedGood) {
    recordManagedPurchase(savedState, good, buyCount);
  } else {
    shopP0.markLimitedPurchase(savedState, gId, buyCount);
  }

  if (good.WeeklyLimit && Number(good.WeeklyLimit) > 0) {
    savedState.shop.weekly[gId] = weeklyBought + buyCount;
  }

  // Aplica dedução do saldo
  savedState.wallet[currency] = currentBalance - totalCost;

  let newItem;
  if (existingItem) {
    existingItem.count = Number(existingItem.count || 0) + buyCount;
    newItem = existingItem;
  } else {
    newItem = {
      instanceId: bag.nextInstanceId++,
      templateId: itemId,
      pos: targetPos,
      count: buyCount,
      bagType: 1, // 1 = BagType.Player
      bind: true,
      used: false
    };
    bag.items.push(newItem);
  }

  return {
    savedState,
    good,
    itemTemplate,
    count: buyCount,
    currency,
    unitPrice,
    totalCost,
    remainingBalance: savedState.wallet[currency],
    newItem: structuredClone(newItem)
  };
}

// The member's contribution lives in consortia_members, not in the character wallet.
// Run this inside the same transaction that persists the character and purchased item.
async function buyShopItemInTransaction(cx, characterId, savedState, goodId, count = 1, payType = 0) {
  const [characters]=await cx.execute('SELECT grade,vip_level FROM characters WHERE id=?',[characterId]);
  if(!characters.length)throw Error('Personagem da compra nao encontrado');
  const character={grade:Number(characters[0].grade),vip:Number(characters[0].vip_level||0)};
  const managedGood=await shopDbLive.purchaseRules(cx,goodId,Math.max(0,Math.min(19,character.vip)));
  const good = managedGood || getShopGood(goodId);
  if (!good) throw Error(`Item da loja com ID ${goodId} não encontrado no catálogo`);
  if(managedGood?.enabled!==1)throw Error('Oferta desabilitada no painel');
  const memberPrice=Number(good.ConsortiaOffer || 0);
  const requiredShopLevel=Number(good.NeedConsortiaLevels || 0);
  if (memberPrice <= 0 && requiredShopLevel <= 0) {
    return buyShopItem(savedState, goodId, count, payType, managedGood, character);
  }
  const [members] = await cx.execute(
    'SELECT consortia_id, offer FROM consortia_members WHERE character_id=? FOR UPDATE',
    [characterId]
  );
  const member = members[0];
  if (!member || (savedState.consortia?.id && Number(savedState.consortia.id) !== Number(member.consortia_id))) {
    throw Error('Personagem não pertence à guilda desta loja');
  }
  const [guilds]=await cx.execute('SELECT shop_level FROM consortia WHERE id=?',[member.consortia_id]);
  if(!guilds.length)throw Error('Guilda nao encontrada');
  if(Number(guilds[0].shop_level)<requiredShopLevel)
    throw Error(`Loja da guilda requer nivel ${good.NeedConsortiaLevels}`);
  if(memberPrice<=0)return buyShopItem(savedState, goodId, count, payType, managedGood, character);
  const offer = Number(member.offer);
  if (!Number.isSafeInteger(offer) || offer < 0) throw Error('Contribuição da guilda inválida');
  savedState.wallet ||= {};
  savedState.wallet.consortiaOffer = offer;
  const result = buyShopItem(savedState, goodId, count, payType, managedGood, character);
  const remaining = Number(result.remainingBalance);
  savedState.consortia ||= {};
  savedState.consortia.id = Number(member.consortia_id);
  savedState.consortia.offer = remaining;
  await cx.execute('UPDATE consortia_members SET offer=? WHERE character_id=? AND consortia_id=?',
    [remaining, characterId, member.consortia_id]);
  return result;
}

/**
 * Formata pacote de confirmação de compra para o protocolo 90 (ShopMsg)
 */
function formatShopBuyRspMsg(goodId, count, result = true) {
  return {
    buyInfo: {
      goodId: Number(goodId),
      count: Number(count),
      result: Boolean(result),
      isDiscount: shopP0.limitedIds.has(Number(goodId)),
      receiveId: 0,
      type: 0
    },
    hasDataInfo: [],
    refreshDate: '',
    payType: 0,
    weeklyDataInfo: [],
    discountTempId: 0,
    monthDataInfo: []
  };
}

module.exports = {
  shopGoods,
  getGood: getShopGood,
  getItemTemplate,
  buyShopItem,
  buyShopItemInTransaction,
  formatShopBuyRspMsg
};
