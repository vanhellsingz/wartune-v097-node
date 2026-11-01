/* Laboratorio local, observador passivo de progressao do carregamento. */
(function(){
  'use strict';
  var reHandler=/(__[A-Za-z]{3,40}(?:Handler)?)/;
  var reStep=/cur\s*:\s*(\d{1,2})/;
  var lastHandler='';
  var lastStep=-1;
  var sends=0;
  function signal(type,step,handler){
    if(sends>=45)return;
    sends++;
    try{
      var payload=JSON.stringify({type:type,step:step,handler:handler});
      var p=window.fetch('/__wartune_boot_probe',{method:'POST',headers:{'Content-Type':'application/json'},body:payload});
      if(p&&typeof p.catch==='function')p.catch(function(){});
    }catch(_){}
  }
  ['log','info','debug'].forEach(function(k){
    var original=console[k];
    if(typeof original!=='function')return;
    try{console[k]=function(){
      try{
        // So examina strings, sem serializar objetos ou enviar logs crus.
        for(var i=0;i<arguments.length;i++){
          if(typeof arguments[i]!=='string')continue;
          var str=arguments[i];
          if(str.length>600)continue;
          var h=reHandler.exec(str);
          if(h && str.indexOf('cost time')>=0)lastHandler=h[1];
          var m=reStep.exec(str);
          if(m){var step=Number(m[1]);if(step>=1 && step<=20){
            if(step!==lastStep){lastStep=step;signal('step',step,lastHandler||'__UnknownHandler');}
          }}
        }
      }catch(_){}
      return original.apply(this,arguments);
    };}catch(_){}
  });
  signal('loaded',0,'');
})();
