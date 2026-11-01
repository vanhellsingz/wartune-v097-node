'use strict';
// Estado de salas MPD no processo Node. Independente do protocolo binario cliente:
// somente o servidor autenticado deve invocar as operacoes deste modulo.
const MAX_MEMBERS = 4;
class MpdRooms {
  constructor() {this.rooms = new Map(); this.memberRooms = new Map(); this.nextId = 500000;}
  validId(id) {const n=Number(id);if(!Number.isSafeInteger(n)||n<1)throw Error('ID de personagem invalido');return n;}
  get(roomId) {const room=this.rooms.get(Number(roomId));if(!room)throw Error('Sala MPD nao encontrada');return room;}
  view(room) {return {
    roomId:room.roomId,campaignId:room.campaignId,masterId:room.masterId,name:room.name,
    count:room.members.size,capacity:room.capacity,roomState:room.state==='forming'?1:2,
    roomType:room.roomType,isSetPassword:Boolean(room.password),masterServerName:'S1',
    members:[...room.members.values()].map(m=>({...m})),checkpoint:room.checkpoint,
    wonNodes:[...room.wonNodes],state:room.state
  };}
  create({leaderId,campaignId,grade,minLevel=1,capacity=4,name='',roomType=1,password=''}) {
    const id=this.validId(leaderId), cId=Number(campaignId), min=Number(minLevel);
    if(!Number.isSafeInteger(cId)||cId<1)throw Error('Campanha invalida');
    if(!Number.isFinite(Number(grade))||Number(grade)<min)throw Error('Nivel insuficiente para esta masmorra');
    if(this.memberRooms.has(id))throw Error('Jogador ja participa de uma sala');
    const cap=Math.max(1,Math.min(MAX_MEMBERS,Number(capacity)||MAX_MEMBERS));
    const room={roomId:this.nextId++,campaignId:cId,masterId:id,name:String(name).slice(0,60),capacity:cap,
      roomType:Number(roomType)||1,password:String(password||'').slice(0,48),state:'forming',
      members:new Map([[id,{playerId:id,grade:Number(grade),ready:true,online:true}]]),
      invitations:new Map(),checkpoint:null,wonNodes:new Set(),createdAt:Date.now()};
    this.rooms.set(room.roomId,room);this.memberRooms.set(id,room.roomId);return this.view(room);
  }
  list(roomType=0){return [...this.rooms.values()].filter(room=>room.state!=='finished'&&
    (!Number(roomType)||room.roomType===Number(roomType))).map(r=>this.view(r));}
  invite(roomId,byId,targetId){const r=this.get(roomId),by=this.validId(byId),target=this.validId(targetId);
    if(!r.members.has(by))throw Error('Somente participantes podem convidar');
    if(r.state==='finished'||r.members.size>=r.capacity)throw Error('Sala encerrada ou cheia');
    if(r.members.has(target))return this.view(r);
    r.invitations.set(target,Date.now()+10*60*1000);return this.view(r);}
  join(roomId,{playerId,grade,minLevel=1,password=''}={}) {
    const r=this.get(roomId),id=this.validId(playerId);
    if(r.state==='finished')throw Error('Masmorra encerrada');
    if(r.members.has(id)){r.members.get(id).online=true;return this.view(r);}
    if(r.members.size>=r.capacity)throw Error('Sala cheia');
    if(this.memberRooms.has(id))throw Error('Jogador esta em outra sala');
    if(Number(grade)<Number(minLevel))throw Error('Nivel insuficiente');
    const hasInvitation=(r.invitations.get(id)||0)>Date.now();
    if(r.state==='running'&&!hasInvitation)throw Error('Entrada em andamento exige convite');
    if(r.password&&!hasInvitation&&String(password)!==r.password)throw Error('Senha incorreta');
    r.members.set(id,{playerId:id,grade:Number(grade),ready:false,online:true});
    r.invitations.delete(id);this.memberRooms.set(id,r.roomId);return this.view(r);
  }
  ready(roomId,playerId,value=true){const r=this.get(roomId),id=this.validId(playerId);
    const member=r.members.get(id);if(!member)throw Error('Nao participa da sala');
    member.ready=Boolean(value);return this.view(r);}
  start(roomId,leaderId){const r=this.get(roomId);
    if(r.masterId!==this.validId(leaderId))throw Error('Apenas lider pode iniciar');
    if(r.state!=='forming')throw Error('Sala ja iniciada');
    if([...r.members.values()].some(m=>!m.ready||!m.online))throw Error('Participantes ainda nao preparados');
    r.state='running';return this.view(r); // 1 membro tambem pode jogar
  }
  checkpoint(roomId,nodeId,position){const r=this.get(roomId);if(r.state!=='running')throw Error('Campanha nao iniciada');
    const id=Number(nodeId);if(!Number.isSafeInteger(id)||id<1)throw Error('No invalido');
    const x=Number(position?.x),y=Number(position?.y);
    if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('Posicao invalida');
    // Chamado SOMENTE apos vitoria verificada pelo servidor.
    r.wonNodes.add(id);r.checkpoint={nodeId:id,x,y};return this.view(r);}
  defeat(roomId){const r=this.get(roomId);if(r.state!=='running')throw Error('Masmorra nao iniciada');
    return {checkpoint:r.checkpoint,wonNodes:[...r.wonNodes],members:[...r.members.keys()]};}
  disconnect(playerId){const rid=this.memberRooms.get(Number(playerId));if(!rid)return null;
    const r=this.get(rid);
    // A sala ainda não iniciou: sair limpa o vínculo e permite entrar de novo
    // no Salão dos Heróis após relogin. Uma MPD em execução preserva o checkpoint.
    if(r.state==='forming')return this.leave(rid,playerId);
    const m=r.members.get(Number(playerId));if(m)m.online=false;return this.view(r);}
  leave(roomId,playerId){const r=this.get(roomId),id=this.validId(playerId);
    if(!r.members.delete(id))return this.view(r);
    this.memberRooms.delete(id);r.invitations.delete(id);
    if(!r.members.size){this.rooms.delete(r.roomId);return null;}
    if(r.masterId===id)r.masterId=r.members.keys().next().value;
    return this.view(r);}
  finish(roomId,leaderId){const r=this.get(roomId);
    if(r.masterId!==this.validId(leaderId))throw Error('Apenas lider pode encerrar');
    r.state='finished';for(const id of r.members.keys())this.memberRooms.delete(id);
    this.rooms.delete(r.roomId);return true;}
}
module.exports={MpdRooms,MAX_MEMBERS};
