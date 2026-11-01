"use strict";
// FASE 2: regras puras do catalogo original; nenhuma operacao usa valores de XP inventados.
const fs=require('node:fs');
const path=require('node:path');
let cached=null;
function readUpgrade(){
 if(cached)return cached;
 const dir=path.resolve(__dirname,'../res/release/config');
 const names=fs.readdirSync(dir).filter(n=>/^t_s_upgradetemplate(?:-.*)?\.json$/i.test(n));
 if(names.length!==1)throw Error('Progressao bloqueada: esperado 1 t_s_upgradetemplate, encontrados '+names.length);
 const rows=JSON.parse(fs.readFileSync(path.join(dir,names[0]),'utf8')).t_s_upgradetemplate;
 if(!Array.isArray(rows))throw Error('Catalogo de upgrade invalido');
 const index=new Map();
 for(const row of rows){
  const type=Number(row.Types),level=Number(row.Grades),value=Number(row.Data);
  if(!Number.isSafeInteger(type)||!Number.isSafeInteger(level)||!Number.isSafeInteger(value)||value<0)throw Error('Upgrade com campos invalidos');
  if(type===3||type===25){
   const key=type+':'+level;
   if(index.has(key))throw Error('Nivel duplicado em curva '+key);
   index.set(key,value);
  }
 }
 for(let l=1;l<=80;l++)if(!index.has('25:'+l))throw Error('Curva de Silfo sem nivel '+l);
 for(let l=1;l<=160;l++)if(!index.has('3:'+l))throw Error('Curva do jogador sem nivel '+l);
 return cached={rows,index};
}
function exactLevelCost(type,level){
 if(!Number.isSafeInteger(level)||level<1)throw Error('Nivel invalido');
 const amount=readUpgrade().index.get(type+':'+level);
 if(amount===undefined)throw Error('Curva desconhecida: '+type+'/'+level);
 return amount;
}
// Cada nivel de Silfo concede 5 pontos segundo o contrato do proprio
// handleSylphReq(opType=2). A quantidade nao depende da especie do pet.
const LEVEL_POINTS = 5;
function sylphSpentPoints(pet) {
 const keys=['powerAdd','intelAdd','physiAdd','armorAdd'];
 let spent=0;
 for (const key of keys) {
  const value=Number(pet[key]??0);
  if(!Number.isSafeInteger(value)||value<0)throw Error('Pontos de Silfo invalidos: '+key);
  spent+=value;
 }
 if(!Number.isSafeInteger(spent))throw Error('Pontos de Silfo excederam limite');
 return spent;
}
function availableSylphPoints(pet) {
 if(!pet||pet.isDel)throw Error('Silfo ausente');
 const grade=Number(pet.curGrade??1);
 if(!Number.isSafeInteger(grade)||grade<1||grade>80)throw Error('Nivel de Silfo invalido');
 const stored=Number(pet.remainPoints??0);
 if(!Number.isSafeInteger(stored)||stored<0)throw Error('Saldo de pontos invalido');
 const earned=(grade-1)*LEVEL_POINTS;
 const spent=sylphSpentPoints(pet);
 // Em saves legados, a experiencia subia de nivel mas remainPoints ficava 0.
 // Reconstituir apenas os pontos adquiridos por nivel, descontando distribuicoes.
 // Saldo positivo maior que o calculado e preservado para nao apagar um save.
 return Math.max(stored, Math.max(0,earned-spent));
}
function advanceSylphExperience(pet,amount,{playerLevel,maxPetLevel=80}={}){
 if(!pet||typeof pet!=='object'||pet.isDel)throw Error('Silfo ausente');
 if(!Number.isSafeInteger(amount)||amount<=0)throw Error('XP de Silfo invalida');
 const level=Number(pet.curGrade||1);
 const current=Number(pet.curGp||0),total=Number(pet.totalGp||0);
 if(![level,current,total].every(Number.isSafeInteger)||level<1||level>80||current<0||total<0)throw Error('Progressao do Silfo corrompida');
 if(!Number.isSafeInteger(playerLevel)||playerLevel<1)throw Error('Nivel de jogador nao validado');
 const limit=Math.min(80,playerLevel,Number(maxPetLevel));
 if(level>=limit)throw Error('Silfo no limite atual de nivel; pergaminho preservado');
 // Curva Types 25 define o custo para chegar ao proximo nivel (Grades=level+1).
 let newLevel=level,cur=current+amount;
 if(!Number.isSafeInteger(cur))throw Error('XP excedeu o limite seguro');
 while(newLevel<limit){
  const need=exactLevelCost(25,newLevel+1);
  if(need<=0)throw Error('Custo de XP invalido no nivel '+(newLevel+1));
  if(cur<need)break;
  cur-=need;newLevel++;
 }
 // Se o personagem subir ate o teto, guardamos o saldo acumulado de XP.
 const newTotal=total+amount;
 if(!Number.isSafeInteger(newTotal))throw Error('Total de XP excedeu o limite seguro');
 // Validar todos os dados antes de alterar o objeto, garantindo rollback limpo.
 const spent=sylphSpentPoints(pet);
 const oldPoints=availableSylphPoints(pet);
 const levelEarned=Math.max(0,(newLevel-1)*LEVEL_POINTS-spent);
 const newPoints=Math.max(oldPoints,levelEarned);
 pet.curGrade=newLevel;pet.curGp=cur;pet.totalGp=newTotal;
 pet.remainPoints=newPoints;
 return {beforeLevel:level,afterLevel:newLevel,added:amount,curGp:cur,totalGp:newTotal,
   beforePoints:oldPoints,afterPoints:newPoints,limit};
}
function checkedPlayerGrade(totalXp,currentGrade){
 if(!Number.isSafeInteger(totalXp)||totalXp<0||!Number.isSafeInteger(currentGrade)||currentGrade<1||currentGrade>160)throw Error('Progressao de personagem invalida');
 const max=160;let grade=1,sum=0;
 for(let n=2;n<=max;n++){
  sum+=exactLevelCost(3,n);
  if(!Number.isSafeInteger(sum))throw Error('XP de nivel extrapolou limite seguro');
  if(totalXp<sum)break;grade=n;
 }
 // Nunca rebaixa jogadores legados; o resultado abaixo serve para verificacao da curva.
 return {catalogGrade:grade,storedGrade:currentGrade,discrepancy:grade!==currentGrade,totalXp};
}
function progressionAudit(){
 const types=[1,3,25,27,29,107,108,200];const groups=new Map();
 for(const r of readUpgrade().rows)if(types.includes(Number(r.Types))){const t=Number(r.Types);groups.set(t,(groups.get(t)||0)+1);}
 return Object.fromEntries(groups);
}
module.exports={exactLevelCost,advanceSylphExperience,availableSylphPoints,checkedPlayerGrade,progressionAudit};
