'use strict';
(() => {
  const message=document.querySelector('#bootMessage'),progress=document.querySelector('#bootProgress'),retry=document.querySelector('#bootRetry');
  retry.onclick=()=>location.reload();
  const fail=e=>{message.textContent='画卷加载失败：'+(e?.message||e)+'。请使用支持 WebGL 2 的新版浏览器。';retry.hidden=false;console.error(e);};
  try{
    CityBridge.boot();
    const engine=new Engine({executable:'/engine-web/game',canvas:document.querySelector('#game'),canvasResizePolicy:2,focusCanvas:true,experimentalVK:true,args:[],gdextensionLibs:[],ensureCrossOriginIsolationHeaders:false});
    window.godotEngine=engine;
    const missing=Engine.getMissingFeatures({threads:false});if(missing.length)throw new Error('浏览器缺少 '+missing.join('、'));
    engine.startGame({onProgress:(loaded,total)=>{if(total>0){progress.value=Math.round(loaded/total*100);message.textContent='正在载入画卷 · '+progress.value+'%';}else message.textContent='正在准备城市…';}}).catch(fail);
  }catch(e){fail(e);}
})();
