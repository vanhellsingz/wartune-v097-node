/* Observador passivo: sem leitura de textos, URLs, storage, cookies ou pacotes. */
(function(){
 'use strict';
 var count=0,last='';
 function treeStats(root){
   var s={nodes:0,hidden:0,alphaZero:0,textured:0};if(!root)return s;var q=[root];
   while(q.length && s.nodes<1200){
     var o=q.pop();s.nodes++;if(o.visible===false)s.hidden++;if(o.alpha===0)s.alphaZero++;if(o.texture)s.textured++;
     try{for(var i=0,n=Math.min(o.numChildren||0,300);i<n;i++)q.push(o.getChildAt(i));}catch(_){}
   }
   return s;
 }
 function className(o){
   try {var n=(o&&o.constructor&&o.constructor.name)||'';return /^[\w$.-]{1,65}$/.test(n)?n:'obj';}catch(_){return 'obj';}
 }
 function names(root){
   var result=[];
   try {var n=Math.min(root.numChildren||0,8);for(var i=0;i<n;i++){result.push(className(root.getChildAt(i)));}}
   catch(_){return [];}return result;
 }
 function send(event){
   try {
     var ls=window.Laya&&window.Laya.stage;
     var gr=window.fgui&&window.fgui.GRoot&&window.fgui.GRoot.inst;
     var canvases=document.querySelectorAll('canvas'),visible=0;
     for(var i=0;i<canvases.length&&i<100;i++){
       var c=canvases[i],rect=c.getBoundingClientRect(),css=window.getComputedStyle(c);
       if(rect.width>0&&rect.height>0&&css.display!=='none'&&css.visibility!=='hidden')visible++;
     }
     var obj={event:event,layaReady:!!ls,stageChildren:ls?ls.numChildren:0,
       stageNames:ls?names(ls):[],guiReady:!!gr,guiChildren:gr?gr.numChildren:0,
       guiNames:gr?names(gr):[],canvasCount:canvases.length,visibleCanvases:visible,tree:treeStats(ls)};
     var state=JSON.stringify(obj);
     if(state===last && event!=='loaded' && count%5!==0)return;
     last=state;
     var p=window.fetch('/__wartune_scene_probe',{method:'POST',headers:{'Content-Type':'application/json'},body:state});
     if(p && typeof p.catch==='function')p.catch(function(){});
   }catch(_){/* sondagem nao interfere com o jogo */}
 }
 send('loaded');
 var id=setInterval(function(){count++;send('sample');if(count>=300)clearInterval(id);},2000);
})();
