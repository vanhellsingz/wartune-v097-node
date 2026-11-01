(function(){
 'use strict';
 var events=[],hooks=null,last='',ticks=0,clicksInstalled=false;
 function note(name,detail){events.push({at:Date.now(),name:name,detail:detail});if(events.length>35)events.shift();}
 function wrap(proto,key){var original=proto&&proto[key];if(typeof original!=='function')return;
  proto[key]=function(){note(key,'enter');try{var ret=original.apply(this,arguments);note(key,'exit');return ret;}
  catch(e){note(key,String(e&&e.message||e).slice(0,180));throw e;}};
 }
 function guiTree(root){var out=[],q=root?[root]:[];while(q.length&&out.length<180){var o=q.shift();
  try{if(o.visible!==false){var p=o.localToGlobal?o.localToGlobal(0,0):{x:o.x,y:o.y};
   out.push({name:String(o.name||'').slice(0,55),cls:o.constructor.name,visible:o.visible,touchable:o.touchable,
    x:Math.round(p.x),y:Math.round(p.y),w:Math.round(o.width),h:Math.round(o.height),
    text:/bag|role|btn|main|menu|tool/i.test(o.name||'')?String(o.text||o.title||'').slice(0,70):undefined});
   for(var i=0;i<Math.min(o.numChildren||0,80);i++)q.push(o.getChildAt(i));}}
  catch(e){}
 }return out;}
 function snapshot(){if(!hooks)return;try{
  if(!clicksInstalled&&window.Laya&&Laya.stage){clicksInstalled=true;Laya.stage.on(Laya.Event.CLICK,null,function(e){
   note('mouse-click',{x:Math.round(Laya.stage.mouseX),y:Math.round(Laya.stage.mouseY),target:e.target&&e.target.constructor.name});});}
  var h=hooks.hero();if(!h||!h.userId)return;
  var p=hooks.player(),gold=hooks.gold();
  var a=hooks.army(),w=hooks.world(),v=w&&w.getWorldArmyById(a.id),view=v&&v.armyView;
  var record={characterId:h.userId,hero:{id:h.id,templateId:h.templateId,headId:h.headId,job:h.templateInfo&&h.templateInfo.Job,
   body:h.bodyAvata,arm:h.armsAvata,grade:h.grades,sex:h.templateInfo&&h.templateInfo.Sexs,gp:Number(h.gp)},resources:{gold:gold,balens:p.point,boundBalens:p.giftToken,energy:p.weary,totalXp:Number(p.totalGP)},army:{id:a.id,x:a.curPosX,y:a.curPosY,state:a.state},
   world:{map:w&&w.mapId,hasArmy:!!v,hasView:!!view,view:view?{x:view.x,y:view.y,visible:view.visible,children:view.numChildren,parent:!!view.parent}:null},
   scene:hooks.scene(),events:events.slice(),gui:guiTree(hooks.guiRoot())};
  var json=JSON.stringify(record);if(json===last&&ticks%5)return;last=json;
  fetch('/__wartune_game_probe',{method:'POST',headers:{'Content-Type':'application/json'},body:json}).catch(function(){});
 }catch(e){note('snapshot',String(e.message).slice(0,160));}}
 window.__wartuneTrace={install:function(o){hooks=o;for(var spec of o.methods)wrap(spec[0],spec[1]);note('installed','passive');}};
 setInterval(function(){ticks++;if(ticks<900)snapshot();},1500);
})();
