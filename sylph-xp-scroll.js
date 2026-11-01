'use strict';
// Integração isolada: ItemUseMsg -> XP de Silfo com persistência autoritativa.
// Os pergaminhos são itens do t_s_itemtemplate. NÃO fornece Mahra/Sepulcrum
// sem regras oficiais verificadas; qualquer erro impede consumo.
const EXP_SCROLLS = new Map([[2032001, 500000], [2032002, 100000]]);

function int(value, name, min=0, max=Number.MAX_SAFE_INTEGER) {
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(`${name} invalido: ${String(value)}`);
  return n;
}

function choosePet(saved) {
  const sylphs=saved.sylphs;
  if(!sylphs||!Array.isArray(sylphs.list)) throw Error('Colecao de Silfos ausente');
  const pets=sylphs.list.filter(p=>p&&!p.isDel);
  const activeId=Number(sylphs.activePetId||0);
  const active=pets.find(p=>Number(p.petId)===activeId);
  const fighting=pets.filter(p=>p.isFight);
  if(fighting.length>1)throw Error('Multiplos Silfos em combate; recuse uso');
  if(active&&fighting.length===1&&Number(fighting[0].petId)!==activeId)
    throw Error('Silfo ativo divergente do Silfo em combate');
  const chosen=active||fighting[0];
  if(!chosen)throw Error('Escolha um Silfo ativo antes de usar o pergaminho');
  return chosen;
}

function applyScroll({saved,item,template,count,grade,progressionRules}) {
  const templateId=int(template?.TemplateId,'TemplateId',1);
  const unit=EXP_SCROLLS.get(templateId);
  if(!unit)throw Error('Nao e Pergaminho de EXP de Silfo');
  if(int(template.MasterType,'MasterType')!==2 || int(template.SonType,'SonType')!==208 ||
     int(template.Property1,'Property1')!==15 || int(template.Property2,'Property2')!==unit)
    throw Error('Propriedades do pergaminho divergentes do catalogo; item preservado');
  const neededLevel=int(template.NeedGrades??1,'NeedGrades',1);
  const playerLevel=int(grade,'nivel do jogador',1,160);
  if(playerLevel<neededLevel)throw Error('Nivel insuficiente para usar o pergaminho');
  const bag=saved.inventory;
  if(!bag||!Array.isArray(bag.items)||!bag.items.includes(item)) throw Error('Item ausente da mochila');
  if(int(item.bagType,'bagType')!==1||int(item.templateId,'templateId',1)!==templateId)
    throw Error('Item ou bolsa divergentes');
  const used=int(count,'quantidade',1,100);
  const oldCount=int(item.count,'saldo',1);
  if(used>oldCount)throw Error('Quantidade solicitada maior que o saldo');
  const xp=used*unit;
  if(!Number.isSafeInteger(xp))throw Error('EXP excedeu limite seguro');
  const pet=choosePet(saved);
  // A regra falha quando o Silfo já atingiu o limite: sem baixa de item.
  const result=progressionRules.advanceSylphExperience(pet,xp,{playerLevel});
  item.count=oldCount-used;
  const pos=item.pos;
  if(item.count===0)bag.items.splice(bag.items.indexOf(item),1);
  return {state:saved,pos,templateId,petId:Number(pet.petId),progress:result};
}

async function handle(ctx) {
  const {state,body,db,inventoryState,originalPb,itemTemplates,progressionRules,
         secondarySystemsState,sendGameSession,makeBagMoveUpdate,log}=ctx;
  if(!state?.gatewayId||!state.character||state.closed)return false;
  let req;
  try{req=originalPb.decode('item.ItemUseMsg',body);}catch(_){return false;}
  const pos=Number(req?.pos),bagType=Number(req?.bagType??1);
  if(!Number.isSafeInteger(pos)||bagType!==1)return false;
  const snapshot=inventoryState.parseState(state.character.state_json);
  const stack=inventoryState.inventory(snapshot).items.find(i=>Number(i.pos)===pos&&Number(i.bagType)===1);
  if(!stack||!EXP_SCROLLS.has(Number(stack.templateId)))return false;
  let committed=false;
  try{
    const expectedTemplateId=int(stack.templateId,'templateId',1);
    const qty=int(req.count??1,'quantidade',1,100);
    const result=await db.mutateCharacterState(state.gatewayId,(raw,locked={})=>{
      const saved=inventoryState.parseState(raw);
      const bag=inventoryState.inventory(saved);
      const item=bag.items.find(i=>Number(i.pos)===pos&&Number(i.bagType)===1);
      if(!item||Number(item.templateId)!==expectedTemplateId)throw Error('Mochila mudou: tente novamente');
      const out=applyScroll({saved,item,template:itemTemplates.get(expectedTemplateId),count:qty,
        grade:locked.grade??state.character.grade,progressionRules});
      // Falhar antes do commit caso o protocolo ou o formatter estejam incompatíveis.
      out.petWire=originalPb.encode('pet.PlayerPetMsg',
        secondarySystemsState.formatPlayerPetMsg(saved,state.gatewayId,0));
      return out;
    });
    committed=true;
    state.character=await db.characterById(state.gatewayId);
    if(!state.character)throw Error('Personagem nao encontrado apos gravacao');
    const canonical=inventoryState.parseState(state.character.state_json);
    const actual=inventoryState.inventory(canonical).items.find(i=>
      Number(i.pos)===result.pos&&Number(i.bagType)===1);
    const savedPet=canonical.sylphs?.list?.find(p=>Number(p.petId)===result.petId&&!p.isDel);
    if(!savedPet||Number(savedPet.totalGp)!==result.progress.totalGp||
       Number(savedPet.curGrade)!==result.progress.afterLevel)
      throw Error('Persistencia de EXP do Silfo divergente: NAO repetir o uso; investigar DB');
    if(actual&&Number(actual.templateId)!==result.templateId)
      throw Error('Posicao da mochila divergente apos gravacao: NAO repetir uso');
    sendGameSession(state,4540,result.petWire);
    sendGameSession(state,115,makeBagMoveUpdate([{
      bagType:1,objectId:0,ownerId:state.gatewayId,pos:result.pos,
      ...(actual?{item:actual}:{})
    }]),state.gatewayId);
    if(ctx.refreshHero)ctx.refreshHero();
    log(`[SYLPH XP INTEGRADO #${state.id}] item=${result.templateId} petId=${result.petId} XP=+${result.progress.added} nivel=${result.progress.beforeLevel}->${result.progress.afterLevel} (salvo).`);
  }catch(err){
    log(`[SYLPH XP INTEGRADO #${state.id}] ${committed?'SALVO MAS NAO SINCRONIZADO; NAO REPETIR O USO':'RECUSADO E PRESERVADO'}: ${err.message}`);
  }
  return true;
}

module.exports={EXP_SCROLLS,choosePet,applyScroll,handle};
