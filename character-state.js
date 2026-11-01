'use strict';
const hero=require('./hero-state'),inv=require('./inventory-state'),world=require('./world-state');
// t_s_systemopen do cliente Ultra declara inventário (101, 10101, 10102) com ShowGrades=5.
// Personagens novos legítimos iniciam no nível 1 com systemsOpen vazio, desbloqueando legitimamente no nível 5 (tutorial 150).
const INITIAL_SYSTEMS_OPEN=[];
const roster=[1,4,3,6,2,5].map((templateId,index)=>({templateId,username:'V095_DEV_'+templateId,nickname:'ULTRA95'+templateId,job:hero.heroes.get(templateId).Job,sex:hero.heroes.get(templateId).Sexs,selectionIndex:index}));
function initialCharacter({id,sex,icon,username,nickname}, {development=process.env.WARTUNE_DEV_ROSTER==='1'}={}){
 const t=hero.heroes.get(icon);
 if(!Number.isSafeInteger(id)||id<1||!t||icon<1||icon>6||t.HeroType!==1||t.Sexs!==sex)throw Error('Classe/aparencia invalida no catalogo Ultra');
 const fixture=development&&(roster.find(p=>p.username===username&&p.nickname===nickname&&p.templateId===icon)||
  (username==='V095_DEV_1_RETEST'&&nickname==='ULTRA951R'&&icon===1));
 let state={job:t.Job,hero:{id,armyId:id,templateId:icon,headId:icon},position:{mapId:10001,x:24,y:66},fashionDisplay:{status:'0,0,0,0'},
  progression:{currentXp:0,totalXp:0},energy:{value:200,lastTickHour:Math.floor(Date.now()/3600000)},wallet:{gold:0,balens:0,boundBalens:0},resourceLedger:{},
  systemsOpen:fixture?[101,10101,10102]:INITIAL_SYSTEMS_OPEN.slice(),schemaVersion:'095_002',creation:{version:'v097',reference:'Ultra canonical templates 1..6'}};
 const grade=fixture?5:1;
 if(fixture){
  state.progression.totalXp=require('./resource-state').totalAtLevel(grade);
  state.developmentProfile={version:'v095',purpose:'six-model-isolated-client-validation',syntheticLevel:5};
  state.newNoviceProcess='150';
 }
 const weapon=hero.byItem.get(1010001+t.Job*1000);
 state=inv.grantInitialWeapon(state,weapon,sex).state;
 state=inv.equipItem(state,1,{grade,sex,job:t.Job},id=>hero.byItem.get(id),0).state;
 return {state,grade};
}
module.exports={roster,initialCharacter,INITIAL_SYSTEMS_OPEN};
