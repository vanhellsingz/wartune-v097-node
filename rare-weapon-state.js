'use strict';

const config = require('./wartune-integrity-r7');
const inventory = require('./inventory-state');
const templates = new Map(config.catalog('t_s_rareweapontemplate').map(row => [Number(row.TemplateId), row]));
const upgrades = new Map(config.catalog('t_s_rareweaponupgrade').map(row => [`${row.Type}:${row.Level}`, row]));
const pools = new Map(config.catalog('t_s_gachacontrol').filter(row => [4, 5, 10].includes(Number(row.TemplateId))).map(row => [Number(row.TemplateId), row]));
const drops = config.catalog('t_s_gachaset');
const settings = new Map(config.catalog('t_s_config').map(row=>[row.ConfigName,row.ConfigValue]));
const baseByType = new Map([...templates.values()].filter(row => Number(row.Star) === 0).map(row => [Number(row.Type), row]));
const propertyNames = {6:'Attack', 7:'Defence', 8:'MagicAttack', 9:'MagicDefence', 10:'Live', 23:'DefensePenetration'};
const resonanceRate=Number(config.catalog('t_s_rareweaponresonance').find(row=>Number(row.Level)===0&&Number(row.Number)===1)?.AttrPercent||0);
const holeStar=Number(config.catalog('t_s_rareweaponhole').find(row=>Number(row.TemplateId)===1)?.Property1||0);

function pairs(text) {
  return String(text || '').split('|').map(part => part.split(',').map(Number)).filter(([id,count]) => Number.isSafeInteger(id) && id>0 && Number.isSafeInteger(count) && count>0);
}
function ensure(saved) {
  if (!saved.rareWeapons || typeof saved.rareWeapons !== 'object') saved.rareWeapons = {};
  const state = saved.rareWeapons;
  if (!Array.isArray(state.info)) state.info = [];
  if (!state.forge || typeof state.forge !== 'object') state.forge = {};
  return state;
}
function itemCount(saved,id) {
  return inventory.inventory(saved).items.filter(item => Number(item.templateId)===id && item.bagType!==4)
    .reduce((sum,item) => sum + Number(item.count || 1),0);
}
function consume(saved,costs) {
  for (const [id,count] of costs) if (itemCount(saved,id)<count) throw Error(`Material insuficiente: ${id}`);
  const items=inventory.inventory(saved).items;
  for (const [id,count] of costs) {
    let remaining=count;
    for (let i=items.length-1;i>=0 && remaining>0;i--) {
      if (Number(items[i].templateId)!==id || items[i].bagType===4) continue;
      const amount=Math.min(remaining,Number(items[i].count||1));
      remaining-=amount;
      items[i].count=Number(items[i].count||1)-amount;
      if (items[i].count<=0) items.splice(i,1);
    }
  }
  // character-repository only removes the final inventory_items row when this flag is set.
  if (items.length===0) inventory.inventory(saved).explicitlyCleared=true;
}
function gold(saved,amount) {
  const value=Math.max(0,Number(amount)||0);
  saved.wallet ||= {};
  if (Number(saved.wallet.gold||0)<value) throw Error('Ouro insuficiente');
  saved.wallet.gold-=value;
}
function weaponInfo(saved) { return ensure(saved).info.map(row => ({tempId:row.tempId,level:row.level,index:row.index,type:row.type,holePos:row.holePos})); }
function drawInfo(saved) {
  const state=ensure(saved);
  return {info:[...pools.keys()].map(id => {
    const row=state.forge[id]||{};
    return {tempId:id,finishTime:Number(row.finishTime||0),finish:Boolean(row.finish),get:!row.finishTime,guaranteedVal:Number(row.pity||0)};
  }),drawPoint:Number(state.drawPoint||0),specialDrawPoint:Number(state.specialDrawPoint||0)};
}
function main(saved,request) {
  const op=Number(request.op),type=Number(request.type),pos=Number(request.pos);
  const state=ensure(saved);
  if (op===8 || op===0) return false;
  const row=state.info.find(item => item.type===type);
  const base=baseByType.get(type);
  if (!base) throw Error('Tipo de arma desconhecido');
  if (op===1) {
    if (!row) {
      consume(saved,pairs(base.CostItem));
      state.info.push({tempId:Number(base.TemplateId),level:0,index:-1,type,holePos:-1});
    } else {
      const current=templates.get(row.tempId),next=templates.get(Number(current?.NextTemplateId));
      if (!next || Number(next.Type)!==type) throw Error('Estrela máxima');
      if (row.level<Number(current.Levelmax)) throw Error('Nível da estrela ainda não atingido');
      consume(saved,pairs(next.CostItem));
      gold(saved,next.Gold);
      row.tempId=Number(next.TemplateId);
    }
  } else if (op===2) {
    if (!row) throw Error('Arma não ativada');
    const current=templates.get(row.tempId);
    if (row.level>=Number(current.Levelmax)) throw Error('Nível máximo desta estrela');
    const next=upgrades.get(`${type}:${row.level+1}`);
    if (!next) throw Error('Evolução ausente do catálogo');
    consume(saved,[[Number(next.UpItem),Number(next.UpItemNum)]]);
    gold(saved,next.UpGold);
    row.level++;
  } else if (op===3) {
    if (!row) throw Error('Arma não ativada');
    if (!Number.isSafeInteger(pos) || pos < -1) throw Error('Destino inválido');
    if (pos===0) for (const other of state.info) if (other.index===0) other.index=-1;
    row.index=pos;
  } else if (op===4) {
    if (!row) throw Error('Arma não ativada');
    if (pos!==-1) {
      const parentType=Math.floor(pos/10),slot=pos%10;
      const parent=state.info.find(item=>item.type===parentType && item.index===0);
      if (slot!==1 || parentType===type || Number(row.index)>=0 || !parent ||
          Number(templates.get(Number(parent.tempId))?.Star||0)<holeStar)
        throw Error('Encaixe inválido');
      for (const other of state.info) if (other.holePos===pos) other.holePos=-1;
    }
    row.holePos=pos;
  } else throw Error(`Operação de arma desconhecida: ${op}`);
  return true;
}
function weighted(entries,random) {
  const sum=entries.reduce((n,row)=>n+Math.max(0,Number(row.weight)||0),0);
  if (sum<=0) throw Error('Pool sem peso válido');
  let pick=random()*sum;
  for (const row of entries) { pick-=Math.max(0,Number(row.weight)||0); if (pick<0) return row.id; }
  return entries.at(-1).id;
}
function forge(saved,request,{now=Date.now(),random=Math.random}={}) {
  const op=Number(request.op),id=Number(request.tempId),state=ensure(saved);
  if (op===0) return {changed:false};
  if (op===4) {
    const special=Number(request.payType)===1;
    const key=special?'specialDrawPoint':'drawPoint';
    const index=special?1:0;
    const threshold=Number(String(settings.get('ForgingChestExp')||'').split(',')[index]);
    const reward=pairs(String(settings.get('ForgingChestItem')||'').split('|')[index]);
    if(!Number.isSafeInteger(threshold)||threshold<1||reward.length!==1)
      throw Error('Baú da forja sem catálogo válido');
    if(Number(state[key]||0)<threshold)throw Error('Pontos de forja insuficientes');
    state[key]-=threshold;
    inventory.addItem(saved,reward[0][0],reward[0][1]);
    return {changed:true,rewards:[{itemId:reward[0][0],amount:reward[0][1]}],poolId:special?10:4};
  }
  const pool=pools.get(id);
  if (!pool || !Number(pool.Open)) throw Error('Forja indisponível');
  const active=state.forge[id]||{};
  if (op===1) {
    if (active.finishTime && !active.get) throw Error('Forja já em andamento');
    const times=Number(request.times||1);
    if (![1,10].includes(times)) throw Error('Quantidade inválida');
    consume(saved,pairs(pool.Cost).map(([item,count])=>[item,count*times]));
    const durations={4:30,5:120,10:120};
    state.forge[id]={finishTime:now+durations[id]*60_000,finish:false,get:false,pity:Number(active.pity||0),times};
    return {changed:true};
  }
  if (!active.finishTime || active.get) throw Error('Nenhuma forja pendente');
  if (op===2) {
    const minutes=Math.ceil(Math.max(0,active.finishTime-now)/60_000);
    const cost=minutes;
    saved.wallet ||= {};
    if (Number(saved.wallet.balens||0)<cost) throw Error('Diamantes insuficientes');
    saved.wallet.balens-=cost;
    active.finishTime=now;
    active.finish=true;
    return {changed:true};
  }
  if (op!==3) throw Error(`Operação de forja desconhecida: ${op}`);
  if (active.finishTime>now && !active.finish) throw Error('Forja ainda em andamento');
  const rewards=[];
  for (let turn=0;turn<Number(active.times||1);turn++) {
    const level=weighted(pairs(pool.PoolRandom).map(([poolId,weight])=>({id:poolId,weight})),random);
    const candidates=drops.filter(row=>Number(row.PoolId)===level).map(row=>({id:row,weight:Number(row.Random)}));
    const choice=weighted(candidates,random);
    const itemId=Number(choice.ItemId),amount=Number(choice.Data||1);
    inventory.addItem(saved,itemId,amount);
    rewards.push({itemId,amount});
    active.pity=level%10===3?0:Number(active.pity||0)+1;
  }
  active.finishTime=0;active.finish=false;active.get=true;
  const pointKey=id===10?'specialDrawPoint':'drawPoint';
  state[pointKey]=Number(state[pointKey]||0)+rewards.length;
  return {changed:true,rewards,poolId:id};
}
function bonuses(saved) {
  const result={Attack:0,Defence:0,MagicAttack:0,MagicDefence:0,Live:0,DefensePenetration:0};
  for (const row of saved?.rareWeapons?.info||[]) {
    if (Number(row.index)!==0) continue;
    const template=templates.get(Number(row.tempId));
    const upgrade=upgrades.get(`${row.type}:${row.level}`);
    for (const [id,value] of [...pairs(template?.Starpro),...pairs(upgrade?.ProId)]) {
      const key=propertyNames[id];if (key) result[key]+=value;
    }
    const deputy=(saved.rareWeapons.info||[]).find(item=>Number(item.holePos)===10*Number(row.type)+1);
    if(deputy && resonanceRate>0){
      const subTemplate=templates.get(Number(deputy.tempId));
      const subUpgrade=upgrades.get(`${deputy.type}:${deputy.level}`);
      for(const [id,value] of [...pairs(subTemplate?.Starpro),...pairs(subUpgrade?.ProId)]){
        const key=propertyNames[id];if(key)result[key]+=Math.floor(value*resonanceRate/100);
      }
    }
  }
  return result;
}
module.exports={main,forge,weaponInfo,drawInfo,bonuses,itemCount,pairs};
