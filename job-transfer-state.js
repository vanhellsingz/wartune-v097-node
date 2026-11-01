'use strict';
const fs=require('node:fs');
const path=require('node:path');
const resource=require('./resource-state');
const configRoot=path.resolve(__dirname,'../res/release/config');
function catalog(name){
 const file=fs.readdirSync(configRoot).find(x=>x.startsWith(name+'-')&&x.endsWith('.json'));
 if(!file)throw Error(`Catálogo ${name} ausente`);
 return JSON.parse(fs.readFileSync(path.join(configRoot,file),'utf8'))[name];
}
const transfers=new Map(catalog('t_s_transfer').map(row=>[Number(row.Type),row]));
const attributes=new Map(catalog('t_s_transferattribute').map(row=>[Number(row.Level),row]));
const questConditions=catalog('t_s_questcondiction');
function requirement(row){
 const [kind,id]=String(row.Conditions||'').split(',').map(Number);
 if(kind!==1||!Number.isSafeInteger(id)||id<1)throw Error('Condição de evolução desconhecida');
 return id;
}
function apply(saved,grade,op,type){
 const current=Number(saved.numJobChange||0);
 if(op===2){
  throw Error('Entrada da campanha deve usar entryCampaign, sem mutação de evolução');
 }
 if(op!==1)throw Error('Operação de evolução inválida');
 const row=transfers.get(type);
 if(!row||type!==current+1)throw Error('Etapa de evolução inválida ou já concluída');
 if(grade<Number(row.AddGrade))throw Error(`Evolução exige nível ${row.AddGrade}`);
 const questId=requirement(row);
 if(!Array.isArray(saved.quests?.completed)||!saved.quests.completed.map(Number).includes(questId))
  throw Error(`Evolução exige missão ${questId} concluída`);
 saved.numJobChange=type;
 const totalXp=Number(saved.progression?.totalXp||0);
 const newGrade=resource.calcGradeFromXp(totalXp,grade,saved);
 saved.progression ||= {totalXp,currentXp:0};
 saved.progression.currentXp=Math.max(0,totalXp-resource.totalAtLevel(newGrade));
 return {state:saved,type,grade:newGrade};
}
function entryCampaign(saved,grade,type){
 const row=transfers.get(type);
 if(!row||Number(saved.numJobChange||0)>=type||grade<Number(row.AddGrade))
  throw Error('Campanha de evolução indisponível para este personagem');
 const questId=requirement(row);
 const mainCondition=questConditions.find(x=>Number(x.TemplateId)===questId&&Number(x.CondictionType)===104);
 if(!mainCondition)throw Error('Cadeia de missões da evolução ausente');
 const childIds=String(mainCondition.Para1).split(',').map(Number);
 const target=questConditions.find(x=>childIds.includes(Number(x.TemplateId))&&Number(x.CondictionType)===106);
 const campaignId=Number(target?.Para1);
 if(!Number.isSafeInteger(campaignId)||campaignId<1)throw Error('Campanha final da evolução ausente');
 return campaignId;
}
function bonuses(grade,job,transferred){
 if(!transferred||grade<=80)return {};
 const row=attributes.get(grade);
 if(!row)throw Error(`Atributos da evolução nível ${grade} ausentes`);
 const field={1:'WarriorAttr',2:'ArcherAttr',3:'MageAttr'}[job];
 if(!field)throw Error('Classe de evolução inválida');
 const result={};
 for(const part of String(row[field]||'').split('|')){
  if(!part)continue;
  const [key,value]=part.split(',').map(Number);
  if(!Number.isSafeInteger(key)||!Number.isSafeInteger(value)||value<0)throw Error('Atributo de evolução inválido');
  result[key]=value;
 }
 return result;
}
module.exports={apply,entryCampaign,bonuses,transfers,attributes};
