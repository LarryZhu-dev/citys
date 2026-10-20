/* Godot owns drawing and input. This adapter keeps the existing save format and
 * online transaction implementation on the same, authoritative local state. */
'use strict';
const view = {ox:0,oy:0,zoom:1};
window.selectedTile = null;
window.relocatingBuilding = null;
let bridgeVersion = 0, terrainVersion = 0, bridgeBooting = true, cityHasSave = false;
let nightMode = 'auto', lastAutosave = 0;
let bridgeEvents = [];
let uiSettings = {autosave:true,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,quality:'auto',overlay:'none'};
try { Object.assign(uiSettings,JSON.parse(localStorage.getItem('wan-city-settings') || '{}')); } catch {}
const isVisiting = () => !!window.OnlineUI?.visiting;
function toast(message,kind='') { bridgeEvents.push({type:'toast',message:String(message),kind}); }
function log(msg,cls='') { if(S){S.log.push({msg,cls,tick:S.tick});S.log=S.log.slice(-100);} }
function renderAll() { bridgeVersion++; }
function renderBuildList(){renderAll();}
function renderTasks(){renderAll();}
function centerOnCity(){bridgeEvents.push({type:'center'});terrainVersion++;}
function fitView(){centerOnCity();}
function setSpeed(value){
  if(S && typeof advanceClock==='function') advanceClock(Date.now(),{speed,suspended:speed===0||isVisiting()||!!window.OnlineUI?.opened});
  speed = Number(value) || 0;
  renderAll();
}
function stateSnapshot(){return serializeState();}
function save(key=SAVE_KEY){
  if(!S||bridgeBooting||isVisiting())return false;
  try{
    const data=serializeState();data.savedAt=new Date().toISOString();data.cloudSync=window.OnlineUI?.saveMetadata?.()||null;
    localStorage.setItem(key,JSON.stringify(data));cityHasSave=true;return true;
  }catch(e){toast('本地保存失败，请导出城市档案：'+e.message,'bad');return false;}
}
function load(key=SAVE_KEY){
  if(isVisiting())return false;
  try{
    const raw=localStorage.getItem(key);if(!raw){toast('这个档案槽还没有城市');return false;}
    const data=JSON.parse(raw);if(!hydrateState(data))throw new Error('存档格式无效');
    window.OnlineUI?.restoreMetadata?.(data.cloudSync||null);cityHasSave=true;terrainVersion++;bridgeVersion++;selectedTile=null;selTool=null;relocatingBuilding=null;return true;
  }catch(e){toast('无法读取城市，原档案仍然保留：'+e.message,'bad');return false;}
}
function modal(opts){toast(opts.title || '城市消息','good');}
function selectedInfo(){
  const pos=selectedTile;if(!pos)return {};
  const b=tileAt(pos.x,pos.y)?.b;
  const depot=S.logistics?.depot;
  if(!b&&depot&&pos.x===depot.x&&pos.y===depot.y)return {x:pos.x,y:pos.y,type:'depot',size:1,immutable:true,name:depot.name||'城镇货栈',desc:'城镇的基础仓储。货物在旁边驿路装卸；新建粮仓、仓库后，运输会优先使用适合的库房。',capacityFood:500,capacityMaterial:600};
  if(!b)return {x:pos.x,y:pos.y,name:TERRAIN[tileAt(pos.x,pos.y)?.t]?.name||'地块'};
  const [x,y]=b.origin,d=BUILD[b.type],r={...b,x,y,name:d.name,size:d.size,desc:d.desc,cost:d.cost,input:d.input||{},prod:d.prod||{},workers:d.workers||0,workersNeeded:d.workers||0,connected:connectedToMain(x,y,d.size),reason:b.idleReason||'',production:typeof productionProgress==='function'?productionProgress(b):b.production};
  if(isResidence(b)){
    const levels=residenceLevels(b),cur=levels[b.lvl-1],next=levels[b.lvl],met=evaluateNeeds({x,y,b});
    r.capacity=cur.pop;r.nextLevel=next?b.lvl+1:0;r.needs=(next?.needs||cur.needs||[]).map(id=>({id,name:NEED_INFO[id]?.name||id,met:!!met.map[id]}));
    r.upgrade=upgradeStatus(x,y);r.canUpgrade=r.upgrade.eligible;r.beauty=met.beauty;r.clean=met.clean;r.upgradeReady=r.upgrade.eligible;r.upgradeWait=r.upgrade.stableRemaining;r.reason=b.construction?'升级工程进行中':r.upgrade.reason;
    r.levelName=cur.name||('第'+b.lvl+'级住宅');
  }
  r.logistics=buildingLogistics(x,y);
  return r;
}
function snapshot(full=false){
  if(!S)return '{}';
  const unlocked=currentUnlocked(), chapter=CHAPTERS[S.chapter]||CHAPTERS.at(-1);
  const data={version:bridgeVersion,terrainVersion,hasSave:cityHasSave,cityName:S.cityName,civilization:S.civilization,mode:S.mode,seed:S.seed,seedHash:hashSeed(S.seed),mapW:MAP_W,mapH:MAP_H,start:S.start,
    gold:S.gold,pop:S.pop,goods:S.goods,goodsMeta:GOODS,caps:S.caps,prestige:S.prestige,workersAssigned:S.workersAssigned,workersNeeded:S.workersNeeded||0,chapter:S.chapter,chapterName:chapter.title,
    tasks:chapter.tasks.map((t,i)=>({text:t.text,done:!!S.taskDone[S.chapter]?.[i]})),clock:S.clock||{},offlineSummary:S.offlineSummary||null,lastDelta:S.lastDelta,lastDeltaSeconds:S.lastDeltaSeconds||60,
    logistics:logisticsSnapshot(),
    constructionSites:constructionSitesSnapshot({suspended:speed===0||isVisiting()||!!window.OnlineUI?.opened}),
    buildings:buildings().map(({x,y,b})=>({...b,x,y,size:BUILD[b.type].size,...(isResidence(b)?{beauty:netBeauty(x,y)}:{}),construction:b.construction||null,production:typeof productionProgress==='function'?productionProgress(b):b.production||null})),
    selection:selectedInfo(),catalog:Object.entries(BUILD).filter(([,d])=>!d.civilization||d.civilization===S.civilization).map(([type,d])=>({type,name:d.name,cat:d.cat,size:d.size,cost:d.cost||{},desc:d.desc,workers:d.workers||0,unlocked:unlocked.has(type),buildTime:d.buildTime||0})),
    tool:selTool||'',moving:relocatingBuilding?{...relocatingBuilding,id:tileAt(relocatingBuilding.x,relocatingBuilding.y)?.b?.id}:null,nightMode,speed,visiting:isVisiting(),onlineOpen:!!window.OnlineUI?.opened,settings:uiSettings,log:(S.log||[]).slice(-40),
    slots:[1,2,3].map(slot=>{try{const s=JSON.parse(localStorage.getItem('wan-city-slot-'+slot)||'null');return {slot,occupied:!!s,cityName:s?.cityName||'',savedAt:s?.savedAt||''};}catch{return {slot,occupied:false};}}),
    tradePrices:Object.fromEntries(Object.keys(GOODS).map(k=>[k,{buy:tradePrice(k,'buy'),sell:tradePrice(k,'sell')}]))};
  if(uiSettings.overlay!=='none')data.overlays=buildings().flatMap(o=>{
    const {x,y,b}=o,d=BUILD[b.type];
    if(uiSettings.overlay==='road'&&b.type==='road')return [{x,y,size:1,radius:0,kind:'road',strength:1,active:!!roadNetwork()[y][x]}];
    if(uiSettings.overlay==='water'&&providedNeeds(b.type).includes('water'))return [{x,y,size:d.size,radius:d.radius||0,kind:'water',strength:1,active:operational(o)}];
    if(uiSettings.overlay==='pollution'&&POLLUTERS.includes(b.type))return [{x,y,size:d.size,radius:2,kind:'pollution',strength:1,active:operational(o)}];
    return [];
  });
  if(full)data.tiles=S.tiles.map(row=>row.map(t=>({t:t.t,variant:t.variant||0})));
  const css=getComputedStyle(document.documentElement);data.safeArea=Object.fromEntries(['top','right','bottom','left'].map(k=>[k,parseFloat(css.getPropertyValue('--safe-'+k))||0]));
  return JSON.stringify(data);
}
function exportSave(){
  if(!S)return;const data=JSON.stringify({...serializeState(),savedAt:new Date().toISOString()},null,2);
  const url=URL.createObjectURL(new Blob([data],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=(S.cityName||'城市')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importSaveFile(file){
  if(!file||isVisiting())return;
  try{if(file.size>12*1024*1024)throw new Error('文件超过12 MB');const data=JSON.parse(await file.text());const previous=serializeState();if(!save('wan-city-backup'))return;if(!hydrateState(data)){hydrateState(previous,{applyOffline:false});throw new Error('存档格式无效');}window.OnlineUI?.restoreMetadata?.(data.cloudSync||null);terrainVersion++;selectedTile=null;selTool=null;relocatingBuilding=null;save();centerOnCity();toast('城市档案已导入，切换前的城市已备份','good');renderAll();}catch(e){toast('导入失败：'+e.message,'bad');}
}
function dispatch(name,raw='{}'){
  const p=typeof raw==='string'?JSON.parse(raw):raw||{};
  const readonly=['tile','center','zoom','night','online','export','setting','cancel'];
  if(isVisiting()&&!readonly.includes(name)){toast('当前正在只读参观，请先返回自己的城市');return false;}
  if(name==='new_city'){
    if(cityHasSave&&!save('wan-city-backup'))return false;window.OnlineUI?.restoreMetadata?.(null);
    newGame({civilization:'china',cityName:String(p.cityName||'长安'),seed:p.seed||String(Date.now()),mode:p.mode==='sandbox'?'sandbox':'campaign'});cityHasSave=true;selectedTile=null;selTool=null;relocatingBuilding=null;terrainVersion++;speed=1;save();toast('新城已奠基。先在住宅附近修建水井。','good');
  }else if(name==='select_tool'){
    if(!currentUnlocked().has(p.type)){toast('完成当前篇章后解锁此建筑');return false;}selTool=p.type;selectedTile=null;relocatingBuilding=null;
  }else if(name==='tile'){
    const x=Math.floor(p.x),y=Math.floor(p.y);if(!inB(x,y))return false;
    if(!isVisiting()&&relocatingBuilding){if(moveBuilding(relocatingBuilding.x,relocatingBuilding.y,x,y)){relocatingBuilding=null;selTool=null;terrainVersion++;save();}}
    else if(!isVisiting()&&selTool){if(doBuild(selTool,x,y)){terrainVersion++;save();}}
    else{const b=tileAt(x,y)?.b;const o=b?.origin||[x,y];selectedTile={x:o[0],y:o[1]};}
  }else if(name==='road_stroke'){
    if(selTool!=='road'||!Array.isArray(p.points))return false;
    const seen=new Set();let built=0;
    for(const point of p.points.slice(0,256)){
      const x=Math.floor(point.x),y=Math.floor(point.y),key=x+','+y;
      if(!inB(x,y)||seen.has(key))continue;seen.add(key);
      if(tileAt(x,y)?.b)continue;
      if(doBuild('road',x,y))built++;
    }
    if(built){terrainVersion++;save();}
  }else if(name==='cancel'){selTool=null;selectedTile=null;relocatingBuilding=null;}
  else if(name==='demolish'){if(demolish(p.x,p.y)){selectedTile=null;terrainVersion++;save();}}
  else if(name==='move'){const b=tileAt(p.x,p.y)?.b;if(b&&b.type!=='road'){relocatingBuilding={x:p.x,y:p.y};selTool=b.type;selectedTile=null;toast('选择新位置迁移，费用为原建造材料的15%');}}
  else if(name==='upgrade'){const result=requestUpgrade(p.x,p.y);if(!result.ok){toast(result.why||'尚未满足升级条件');renderAll();return false;}terrainVersion++;save();toast('升级工程已开工，居民继续留在原宅。','good');}
  else if(name==='save'){if(save(p.slot?'wan-city-slot-'+p.slot:SAVE_KEY))toast('城市已保存','good');}
  else if(name==='load'){if(!save('wan-city-backup'))return false;if(load(p.slot?'wan-city-slot-'+p.slot:SAVE_KEY)){save();centerOnCity();}}
  else if(name==='backup'){const rawBackup=localStorage.getItem('wan-city-backup');if(rawBackup){const current=serializeState();if(load('wan-city-backup')){localStorage.setItem('wan-city-backup',JSON.stringify(current));save();centerOnCity();}}else toast('尚无切换城市备份');}
  else if(name==='export')exportSave();
  else if(name==='import')document.querySelector('#importFile').click();
  else if(name==='online'){if(isVisiting())window.OnlineUI.exitVisit();else window.OnlineUI?.open(p.tab);}
  else if(name==='night'){nightMode=['auto','day','night'].includes(p.mode)?p.mode:'auto';}
  else if(name==='pause')setSpeed(speed===0?1:0);
  else if(name==='speed')setSpeed(Number(p.value)===0?0:S.mode==='sandbox'&&[1,4,60].includes(Number(p.value))?Number(p.value):1);
  else if(name==='trade'){const r=tradeGoods(p.resource,p.quantity,p.direction);toast(r.ok?'商队交易完成':r.why,r.ok?'good':'bad');if(r.ok)save();}
  else if(name==='setting'){if(['reducedMotion','autosave'].includes(p.key))uiSettings[p.key]=!!p.value;else if(p.key==='quality'&&['auto','high','low'].includes(p.value))uiSettings.quality=p.value;else if(p.key==='overlay'&&['none','road','water','pollution'].includes(p.value))uiSettings.overlay=p.value;localStorage.setItem('wan-city-settings',JSON.stringify(uiSettings));}
  renderAll();return true;
}
window.CityBridge={snapshot,dispatch,pollEvents(){const e=bridgeEvents;bridgeEvents=[];return JSON.stringify(e);},
  ready(){window.godotReady=true;document.querySelector('#boot').hidden=true;document.querySelector('#game').focus();},
  report(raw){try{window.godotMetrics=JSON.parse(raw);}catch{}},
  boot(){if(!load(SAVE_KEY)&&!load(LEGACY_SAVE_KEY)){bridgeBooting=true;newGame({civilization:'china',cityName:'长安',seed:'wanchengji-huaxia'});cityHasSave=false;speed=0;}bridgeBooting=false;bridgeEvents=[];renderAll();}
};
window.invalidateRenderer=()=>{terrainVersion++;bridgeVersion++;};
document.querySelector('#importFile').addEventListener('change',e=>{importSaveFile(e.target.files[0]);e.target.value='';});
setInterval(()=>{
  if(!S||bridgeBooting)return;
  try{advanceClock(Date.now(),{speed,suspended:speed===0||isVisiting()||!!window.OnlineUI?.opened});renderAll();if(cityHasSave&&uiSettings.autosave&&Date.now()-lastAutosave>15000){save();lastAutosave=Date.now();}}
  catch(e){setSpeed(0);toast('城市已暂停：'+e.message,'bad');console.error(e);}
},1000);
addEventListener('pagehide',()=>{if(cityHasSave)save();});
