'use strict';

// Curadoria local da loja. Os IDs apontam somente para templates originais.
const limited = [
  {id:910001,itemId:2060021,price:65},   // Pacote Ultra de Iniciante
  {id:910002,itemId:208007,price:199},   // Pacote de Iniciante
  {id:910003,itemId:2013002,price:65},  // Pergaminho de EXP Avanç.
  {id:910004,itemId:2060014,price:999}, // Pacote de Gemas Nv. 1-5
  {id:910005,itemId:2060029,price:399}, // Pacote de Runas Nv. 3-5
  {id:910006,itemId:2060030,price:199}, // Pacote de Materiais Nv. 40
  {id:910007,itemId:2060006,price:2999},// Super Pacote de Gemas Nv. 3
  {id:910008,itemId:2060023,price:5199},// Caixa do Destino
  {id:910009,itemId:208008,price:20},   // Chicote de Treinamento
  {id:910010,itemId:208020,price:50},   // Núcleo da Moda
  {id:910011,itemId:208021,price:30},   // Amuleto da Sorte
  {id:910012,itemId:208014,price:5}     // Cristal de Alma
];
const fashionThemes = [
  {name:'Feminino',area:64,sex:1},
  {name:'Masculino',area:63,sex:0},
  {name:'Asas',area:65,sonType:109}
];
const fashionTypes=new Set([109,110,111,112]);
const itemTemplates=require('../res/release/config/t_s_itemtemplate-43b07d7a92.json').t_s_itemtemplate;
// O catálogo original marca estas peças como Job=[0] e Sexs=2: todas as
// classes e ambos os sexos podem usar a mesma peça. O ID da oferta é estável.
const fashion=itemTemplates.filter(item=>item.TemplateId>0 &&
  item.MasterType===1 && fashionTypes.has(item.SonType) &&
  item.Icon && item.Avata && item.TemplateName_pt &&
  item.Job?.includes(0) && item.Sexs===2).sort((a,b)=>a.TemplateId-b.TemplateId)
  .map(item=>({id:1000000+item.TemplateId,itemId:item.TemplateId,price:1,
    area:60,sonType:item.SonType,classes:'all',sexes:'both'}));
// Preserva os 18 IDs usados pela primeira versão da loja para compras antigas.
const legacyFashion=[];
let legacyId=920001;
for(const theme of [{area:60,suffixes:[6101,6410]},
  {area:61,suffixes:[5601,8081]},{area:62,suffixes:[8057,8065]}])
  for(const suffix of theme.suffixes)for(const family of [110,111,112])
    legacyFashion.push({id:legacyId++,itemId:family*10000+suffix,price:1,area:theme.area});
const byId=new Map([...limited,...legacyFashion,...fashion].map(good=>[good.id,good]));
const limitedIds=new Set(limited.map(good=>good.id));
const fashionIds=new Set([...legacyFashion,...fashion].map(good=>good.id));

function limitedCount(saved,id,date=new Date()){
  const day=date.toISOString().slice(0,10);
  const managed=saved.shopAdminPurchases?.daily?.[day]?.[id];
  return Number(managed ?? saved.shopLimitedPurchases?.[day]?.[id] ?? 0);
}
function markLimitedPurchase(saved,id,count,date=new Date()){
  const day=date.toISOString().slice(0,10);
  if(!limitedIds.has(Number(id)))return;
  const unlimitedIds = new Set([910009, 910010, 910011, 910012]);
  if (!unlimitedIds.has(Number(id))) {
    if(limitedCount(saved,id,date)+count>999)throw Error('Limite diário deste item atingido');
  }
  saved.shopLimitedPurchases??={};
  saved.shopLimitedPurchases[day]??={};
  saved.shopLimitedPurchases[day][id]=limitedCount(saved,id,date)+count;
}
function shopMainPayload(saved,date=new Date()){
  const stamp=date.toISOString().slice(0,19).replace('T',' ');
  const discountInfo=limited.map((good,index)=>({
    id:good.id,site:1,shopId:0,templateId:good.itemId,counts:1,
    sortId:index+1,discount:100,beginDate:'2026-01-01 00:00:00',
    endDate:'2030-12-31 23:59:59',oneDayCount:1,maxCount:-1,
    currentCount:limitedCount(saved,good.id,date),maxCurrentDate:stamp,
    isGift:false,price:good.price,type:1,limitCount:1,vip:0,customType:0
  }));
  return {urlInfo:[],goodInfo:[],discountInfo};
}
module.exports={limited,fashion,fashionThemes,byId,limitedIds,fashionIds,
  limitedCount,markLimitedPurchase,shopMainPayload};
