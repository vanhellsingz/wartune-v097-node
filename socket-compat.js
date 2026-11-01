/* Shim de comparacao LOCAL: apenas navegador, sem alterar o bundle original. */
(function(){
  'use strict';
  if(!window.WebSocket || !window.WebSocket.prototype)return;
  var proto=window.WebSocket.prototype;
  if(typeof proto.destroy!=='function'){
    try{
      Object.defineProperty(proto,'destroy',{
        configurable:true, enumerable:false,
        value:function(){
          if(this.readyState===0 || this.readyState===1){
            try{this.close(1000,'');}catch(_){ /* descarte em ambiente de teste */ }
          }
        }
      });
      console.info('[LOCAL] Metodo WebSocket.destroy() instalado para teste');
    }catch(_){console.warn('[LOCAL] Nao foi possivel instalar WebSocket.destroy()');}
  }
  // Sinaliza apenas que o shim foi executado no cliente e o prototipo nativo mudou.
  // Sem enviar dados do jogador ou conteudo dos pacotes.
  if(typeof window.fetch==='function'){
    try{
      var p=window.fetch('/__wartune_shim_probe',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({nativePrototypeHasDestroy:typeof proto.destroy==='function'})
      });
      if(p&&typeof p.catch==='function')p.catch(function(){});
    }catch(_){/* diagnostico opcional */}
  }
})();
