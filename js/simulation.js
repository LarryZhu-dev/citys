"use strict";
/* Deterministic city simulation. Rendering and network services are optional consumers. */
let _roadNet = null, _roadDirty = true, _buildingCache = null;
let _connectivityCache = new Map(), _serviceCache = null, _quietSimulation = false;
let _buildingIdCache = null, _roadRevision = 0, _logisticsRouteChecks = new Map();
// Construction crews are a view of paid, existing projects, never economic jobs.
// Finished-site records only live while this exact city is displayed.
let _constructionVisualState = null, _constructionObserved = new Map(), _constructionExits = new Map();
const CONSTRUCTION_CREW_CYCLE_SECONDS = 36, CONSTRUCTION_CREW_EXIT_SECONDS = 12;
const inB = (x,y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < MAP_W && y >= 0 && y < MAP_H;
const tileAt = (x,y) => S && inB(x,y) ? S.tiles[y][x] : null;
const isResidence = b => b && (b.type === "house" || b.type === "villa");
const isComplete = b => !b.construction || !!b.construction.fromLevel;

function emitToast(message, kind){ if (!_quietSimulation && typeof toast === "function") toast(message, kind); }
function emitLog(message, kind){ if (typeof log === "function") log(message, kind); }
function refreshUI(){ if (typeof renderAll === "function") renderAll(); }
function invalidateWorld(){
  _buildingCache = null;
  _buildingIdCache = null; _roadRevision++;
  _roadDirty = true;
  _connectivityCache.clear(); _serviceCache=null;
  if (typeof window !== "undefined" && typeof window.invalidateRenderer === "function") window.invalidateRenderer();
}
function markRoadDirty(){ _roadDirty = true; _buildingCache = null; _buildingIdCache=null; _roadRevision++; _connectivityCache.clear(); _serviceCache=null; }
function hashSeed(value){
  const str = String(value ?? "empire");
  let h = 2166136261;
  for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h,16777619); }
  return h >>> 0;
}
function seededRandom(seed){
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15,t | 1); t ^= t + Math.imul(t ^ t >>> 7,t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function cityRandom(){
  S.rngState = ((S.rngState || hashSeed(S.seed)) + 0x6D2B79F5) >>> 0;
  let t = S.rngState; t = Math.imul(t ^ t >>> 15,t | 1); t ^= t + Math.imul(t ^ t >>> 7,t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
/* Smooth seeded fields are shared by world generation and the terrain renderer.
   No rendering metadata is required in a saved tile: an old city can derive it. */
function terrainHash(x,y,seed){
  let h=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^(seed>>>0);
  h=Math.imul(h^(h>>>13),1274126177);
  return ((h^(h>>>16))>>>0)/4294967296;
}
function terrainNoise(x,y,seed){
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const sx=fx*fx*fx*(fx*(fx*6-15)+10),sy=fy*fy*fy*(fy*(fy*6-15)+10);
  const a=terrainHash(ix,iy,seed),b=terrainHash(ix+1,iy,seed),c=terrainHash(ix,iy+1,seed),d=terrainHash(ix+1,iy+1,seed);
  return ((a+(b-a)*sx)*(1-sy)+(c+(d-c)*sx)*sy)*2-1;
}
function terrainFractal(x,y,seed,octaves=3){
  let value=0,weight=0,amplitude=1;
  for(let i=0;i<octaves;i++){
    value+=terrainNoise(x,y,(seed+Math.imul(i+1,1013904223))>>>0)*amplitude;
    weight+=amplitude;amplitude*=0.5;x=x*2.03+17.13;y=y*2.03-9.71;
  }
  return value/weight;
}
const terrainVisualCache=new Map();
function terrainVisualAt(x,y,seed){
  const worldSeed=String(seed??(S&&S.seed)??"empire"),key=worldSeed+":"+x+","+y;
  const cached=terrainVisualCache.get(key);if(cached)return cached;
  const h=hashSeed(worldSeed),warpX=terrainFractal(x*.035,y*.035,h+19,2)*3.2,warpY=terrainFractal(x*.035,y*.035,h+37,2)*3.2;
  const wx=x+warpX,wy=y+warpY;
  const soil=terrainFractal(wx*.075,wy*.075,h+71,4);
  const groundBlend=Math.max(0,Math.min(1,(soil+0.12)/0.72));
  const result={
    groundBlend,moisture:Math.max(0,Math.min(1,.5+terrainFractal(wx*.055,wy*.055,h+89,3)*.6)),
    detail:terrainHash(x,y,h+107),offsetX:terrainHash(x,y,h+131)-.5,offsetY:terrainHash(x,y,h+173)-.5,
    scale:.75+terrainHash(x,y,h+211)*.5,
    // Generation fields also let grass/dirt and wilderness share the same coherent shapes.
    soil,warpX,warpY,woodland:terrainFractal(wx*.115,wy*.115,h+251,3),
  };
  if(terrainVisualCache.size>=24000)terrainVisualCache.clear();
  terrainVisualCache.set(key,result);return result;
}
function generateTerrain(seed, civilization = "china", width = MAP_W, height = MAP_H){
  const h=hashSeed(seed),rng=seededRandom(h),arid=civilization==="egypt"||civilization==="persia";
  const riverBase=width*(.24+rng()*.085),riverShift=rng()*300;
  const lakes=Array.from({length:2},(_,i)=>({
    x:width*(i===0?.51+rng()*.16:.70+rng()*.16),y:height*(i===0?.65+rng()*.19:.43+rng()*.17),
    rx:4.4+rng()*4.4,ry:3.1+rng()*3.6,rotation:rng()*Math.PI,phase:rng()*90,
  }));
  const deposits=[];
  for(const [kind,n,low,high] of [["stone",6,2.7,5.0],["clay",5,2.3,4.2],["copper",5,1.5,3.1]]){
    for(let i=0;i<n;i++)deposits.push({kind,x:3+rng()*(width-6),y:4+rng()*(height-8),rx:low+rng()*(high-low),ry:low*.65+rng()*(high*.9-low*.65),rotation:rng()*Math.PI,phase:rng()*80});
  }
  // Different resources branch from nearby starting landmarks, never from filled rectangles.
  // These centres only guarantee an accessible early economy; their outlines and areas vary by seed.
  const startDeposits=[
    {kind:"tree",x:47.1+(rng()-.5),y:23.7+(rng()-.5),rx:3.3+rng()*1.8,ry:3.8+rng()*1.8,anchor:[48,22]},
    {kind:"stone",x:52.5+(rng()-.5),y:21.9+(rng()-.5),rx:2.0+rng()*1.0,ry:1.3+rng()*1.0,anchor:[51,22]},
    {kind:"clay",x:51.6+(rng()-.5),y:27.7+(rng()-.5),rx:3.1+rng()*1.0,ry:1.5+rng()*1.3,anchor:[51,26]},
    {kind:"copper",x:54.5+(rng()-.5),y:25.0+(rng()-.5),rx:1.4+rng()*.7,ry:1.7+rng()*1.1,anchor:[54,25]},
  ].map(p=>({...p,rotation:rng()*Math.PI,phase:rng()*80}));
  const inlet={x:59.2+(rng()-.5)*.5,y:20.7+(rng()-.5)*1.0,rx:2.5+rng()*.5,ry:3.3+rng()*.7,rotation:(rng()-.5)*.3,phase:rng()*80};
  const shape=(x,y,p,field)=>{
    const dx=x-p.x,dy=y-p.y,c=Math.cos(p.rotation),sn=Math.sin(p.rotation);
    const u=(dx*c+dy*sn)/p.rx,v=(-dx*sn+dy*c)/p.ry;
    const edge=.22*terrainNoise(x*.57+p.phase,y*.57-p.phase,h+313)+.13*field;
    return u*u+v*v<1+edge;
  };
  const tiles=Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>{
    const f=terrainVisualAt(x,y,seed),wx=x+f.warpX,wy=y+f.warpY;
    const meadow=((x-49)/11.9)**2+((y-15)/12.6)**2<1+.12*f.woodland;
    const riverX=riverBase+terrainFractal(0,wy*.043+riverShift,h+317,3)*6.0+terrainNoise(0,wy*.105+riverShift,h+331)*1.6;
    const riverWidth=1.25+(terrainNoise(0,y*.10+riverShift,h+353)+1)*.45;
    let water=Math.abs(wx-riverX)<riverWidth;
    if(!meadow)water=water||lakes.some(l=>shape(wx,wy,l,f.woodland));
    // An irregular inlet near the settlement makes fishing accessible without moving the river.
    if(width>=62&&height>=30&&x>55&&y>15&&y<27)water=water||shape(x,y,inlet,f.woodland);
    if(meadow&&x<55)water=false;
    let t=water?"water":f.soil>(arid?.21:.32)?"sand":"grass";
    if(!water&&!meadow){
      const forestThreshold=civilization==="aztec"?.17:.24;
      if(f.woodland>forestThreshold || (f.woodland>forestThreshold-.09&&f.detail>.96))t="tree";
      for(const p of deposits){
        if(Math.abs(x-p.x)>p.rx*1.8||Math.abs(y-p.y)>p.ry*1.8)continue;
        if(shape(wx,wy,p,f.woodland))t=p.kind;
      }
    }
    // Keep the residential centre open while resource belts grow along its southern edge.
    if(!water&&y>=20)for(const p of startDeposits){
      if(Math.abs(x-p.x)>p.rx*1.9||Math.abs(y-p.y)>p.ry*1.9)continue;
      if(shape(x,y,p,f.woodland))t=p.kind;
    }
    return {t,b:null,variant:Math.floor(f.detail*4)};
  }));
  // Thin, broken banks soften water/land transitions instead of forming a uniform sand ring.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const tile=tiles[y][x],f=terrainVisualAt(x,y,seed);
    if(tile.t!=="grass"||f.detail<.38)continue;
    if(DIRS.some(([dx,dy])=>tiles[y+dy]?.[x+dx]?.t==="water"))tile.t="sand";
  }
  // A single anchor per resource is enough for a 2×2 mine and does not prescribe its footprint.
  for(const p of startDeposits){
    const [x,y]=p.anchor;if(tiles[y]?.[x])tiles[y][x].t=p.kind;
  }
  // The starter lumber footprint is always dry, even on custom maps derived from a later generator.
  if(width>=50&&height>=24)for(let y=22;y<24;y++)for(let x=48;x<50;x++)if(tiles[y][x].t==="water")tiles[y][x].t="grass";
  return tiles;
}
function newGame(options = {}){
  MAP_W = MAP_H = 64;
  uid = 0; pendingSave = 0; selTool = null; hover = null;
  const civilization = Object.hasOwn(CIVILIZATIONS,options.civilization) ? options.civilization : "china";
  const civ = getCivilization(civilization);
  const seed = String(options.seed ?? Math.floor(Math.random()*1e9)).slice(0,64);
  const mode = options.mode === "sandbox" ? "sandbox" : "campaign";
  const goods = Object.fromEntries(Object.keys(GOODS).map(k=>[k,0]));
  Object.assign(goods,{grain:160,wood:300,stone:260});
  if (mode === "sandbox") for (const k in goods) goods[k] = 3000;
  S = {
    version:SAVE_VERSION, seed, rngState:hashSeed(seed), civilization,
    clock:createCityClock(options.nowMs),
    cityName:String(options.cityName || civ.cityNames[0]).trim().slice(0,24) || civ.cityNames[0], mode,
    tick:0,pop:12,workersAssigned:6,goods,caps:{food:500,mat:600},gold:mode === "sandbox" ? 50000 : 350,
    prestige:48,chapter:0,taskDone:CHAPTERS.map(c=>c.tasks.map(()=>false)),
    chapterCompleted:CHAPTERS.map(()=>false),tiles:generateTerrain(seed,civilization),log:[],
    stats:{taxed:0,maxPop:12,totalBuilt:0,disasters:0},won:false,
    signpost:{x:63,y:0},start:{x:49,y:14},lastDelta:Object.fromEntries([...Object.keys(GOODS),"gold","pop"].map(k=>[k,0])),
  };
  invalidateWorld();
  for (let x=0;x<MAP_W;x++) setRoad(x,0,true);
  for (let y=1;y<MAP_H;y++) setRoad(MAP_W-1,y,true);
  for (let y=1;y<=28;y++) setRoad(50,y);
  for (let x=42;x<=57;x++) setRoad(x,14);
  const a = put(47,13,"house"), b = put(49,13,"house");
  a.pop = b.pop = 6;
  put(45,15,"farmland"); put(48,22,"lumber");
  put(44,13,"treeDeco"); put(53,13,"treeDeco");
  S.logistics={version:1,nextId:1,depot:{x:46,y:13,door:[46,14],name:'城镇货栈'},jobs:[]};_logisticsRouteChecks.clear();
  updateCaps(); allocateWorkers(buildings());
  for(const o of buildings()) if(BUILD[o.b.type].prod) startProduction(o);
  emitLog("欢迎来到" + S.cityName + "。驿道连接远方，先在住宅旁修建一口水井。","good");
  emitLog("保持道路连通；绿色预览可建造。商铺隔着同一条道路成对放置，居民才会收到商品。");
  if (mode === "sandbox") emitLog("自由营造：全部建筑已解锁，可使用 4 倍或 60 倍时间；人口、生产和道路规则依然有效。","good");
  else emitLog("经营时间与现实同步。离线自动经营最多 8 小时，已排队施工最多推进 72 小时；此为本作便利规则。");
  refreshUI();
  if (typeof centerOnCity === "function") centerOnCity();
  if (typeof save === "function") save();
  return S;
}

function footprint(x,y,size){
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(size)) return null;
  const out = [];
  for (let dy=0;dy<size;dy++) for (let dx=0;dx<size;dx++) {
    const t = tileAt(x+dx,y+dy); if (!t) return null; out.push([x+dx,y+dy,t]);
  }
  return out;
}
function put(x,y,type){
  const d = BUILD[type]; if (!d) return null;
  const fp = footprint(x,y,d.size);
  if (!fp || fp.some(([, ,t])=>t.b)) return null;
  const b = {type,id:++uid,origin:[x,y],staffed:false};
  if (isResidence(b)) Object.assign(b,{lvl:1,pop:0,taxTimer:0});
  for (const [, ,t] of fp) t.b = b;
  invalidateWorld(); return b;
}
function setRoad(x,y,main = false){
  const t = tileAt(x,y); if (!t || t.b) return null;
  const b = {type:"road",id:++uid,origin:[x,y]};
  if (main) b.main = true;
  t.b = b; invalidateWorld(); return b;
}
function buildings(){
  if (!S) return [];
  if (_buildingCache) return _buildingCache;
  const out = [], seen = new Set();
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++) {
    const b = S.tiles[y][x].b;
    if (!b || seen.has(b.id)) continue;
    seen.add(b.id); const [ox,oy] = b.origin || [x,y];
    out.push({x:ox,y:oy,b,tile:tileAt(ox,oy)});
  }
  return _buildingCache = out;
}
const count = (type,includeConstruction = false) => buildings().filter(o=>o.b.type===type && (includeConstruction || isComplete(o.b))).length;
const maxHouseLevel = () => Math.max(0,...buildings().filter(o=>o.b.type==="house" && isComplete(o.b)).map(o=>o.b.lvl||1));
const houseLevelCount = lvl => buildings().filter(o=>o.b.type==="house" && isComplete(o.b) && (o.b.lvl||1)>=lvl).length;
function roadNetwork(){
  if (!_roadDirty && _roadNet) return _roadNet;
  const seen = Array.from({length:MAP_H},()=>new Array(MAP_W).fill(false)), queue = [];
  for (const {x,y,b} of buildings()) if (b.type==="road" && b.main) { seen[y][x]=true; queue.push([x,y]); }
  for (let i=0;i<queue.length;i++) {
    const [x,y] = queue[i];
    for (const [dx,dy] of DIRS) {
      const nx=x+dx,ny=y+dy;
      if (!inB(nx,ny) || seen[ny][nx]) continue;
      const b = tileAt(nx,ny).b;
      if (b && b.type==="road") { seen[ny][nx]=true; queue.push([nx,ny]); }
    }
  }
  _roadDirty=false; return _roadNet=seen;
}
function touchesRoad(x,y,size){
  const fp=footprint(x,y,size); if (!fp) return false;
  return fp.some(([cx,cy])=>DIRS.some(([dx,dy])=>tileAt(cx+dx,cy+dy)?.b?.type === "road"));
}
function connectedToMain(x,y,size=1){
  const key=x+','+y+','+size;
  if(_connectivityCache.has(key))return _connectivityCache.get(key);
  const net=roadNetwork(),fp=footprint(x,y,size);
  const linked=!!fp&&fp.some(([cx,cy,t])=>(t.b?.type==="road"&&net[cy][cx])||DIRS.some(([dx,dy])=>inB(cx+dx,cy+dy)&&net[cy+dy][cx+dx]));
  _connectivityCache.set(key,linked);return linked;
}
function nearWater(x,y,size=1,distance=1){
  for (let yy=y-distance;yy<y+size+distance;yy++) for (let xx=x-distance;xx<x+size+distance;xx++) if (tileAt(xx,yy)?.t==="water") return true;
  return false;
}
function operational(o){
  const d=BUILD[o.b.type];
  return !o.b.construction && !o.b.damage && (!d.workers || o.b.staffed) && (d.cat==="decor" || connectedToMain(o.x,o.y,d.size));
}
function distanceToBuilding(x,y,o){
  const s=BUILD[o.b.type].size;
  return Math.max(Math.max(o.x-x,0,x-(o.x+s-1)),Math.max(o.y-y,0,y-(o.y+s-1)));
}
function providedNeeds(type){
  const extras={pagoda:["school","temple"],sphinx:["temple","safety"],agora:["school","fun"],windTower:["water","bath"],sunTemple:["temple","fun"]};
  return extras[type] || (BUILD[type].provides ? [BUILD[type].provides] : []);
}
function coveredBy(x,y,need){
  const key=x+','+y+','+need;
  if(_serviceCache?.coverage.has(key))return _serviceCache.coverage.get(key);
  const candidates=_serviceCache?(_serviceCache.providers[need]||[]):buildings();
  const match=candidates.find(o=>providedNeeds(o.b.type).includes(need)&&operational(o)&&distanceToBuilding(x,y,o)<=(BUILD[o.b.type].radius||0))||null;
  _serviceCache?.coverage.set(key,match);return match;
}
function refreshServiceCache(bl){
  const signature=bl.filter(o=>!isResidence(o.b)&&o.b.type!=="road").map(o=>o.b.id+':'+Number(!!o.b.staffed)+Number(!!o.b.construction)+Number(!!o.b.damage)).join(',');
  if(_serviceCache?.signature===signature)return;
  const providers={};
  for(const o of bl)if(operational(o))for(const need of providedNeeds(o.b.type))(providers[need]??=[]).push(o);
  _serviceCache={signature,providers,coverage:new Map(),beauty:new Map(),pollution:new Map(),shopCoverage:new Map(),environments:new Map(),shops:bl.filter(o=>(BUILD[o.b.type].shop||BUILD[o.b.type].shopAll)&&operational(o))};
}
function shopsPaired(a,b){
  if (!a || !b || a.b.id===b.b.id || !BUILD[a.b.type].shop || BUILD[a.b.type].shop!==BUILD[b.b.type].shop) return false;
  if (a.x!==b.x && a.y!==b.y) return false;
  const dx=Math.sign(b.x-a.x),dy=Math.sign(b.y-a.y),distance=Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  if (distance<2 || distance>4) return false;
  const net=roadNetwork();
  // The complete gap must be a connected road, so disconnected shops cannot serve goods.
  for (let i=1;i<distance;i++) {
    const x=a.x+dx*i,y=a.y+dy*i;
    if (tileAt(x,y)?.b?.type!=="road" || !net[y][x]) return false;
  }
  return true;
}
function shopPairOk(o){
  if (!BUILD[o.b.type].shop) return true;
  if (!operational(o)) return false;
  return buildings().some(q=>q.b.type===o.b.type && operational(q) && shopsPaired(o,q));
}
function shopPairCount(kind){
  const shops=buildings().filter(o=>BUILD[o.b.type].shop===kind && !o.b.construction),used=new Set(); let n=0;
  for (let i=0;i<shops.length;i++) {
    if (used.has(shops[i].b.id)) continue;
    for (let j=i+1;j<shops.length;j++) if (!used.has(shops[j].b.id) && shopsPaired(shops[i],shops[j])) {
      n++; used.add(shops[i].b.id); used.add(shops[j].b.id); break;
    }
  }
  return n;
}
const POLLUTERS=["lumber","quarry","clayPit","copperMine","kiln","pottery","mill","weaver","winery","barracks"];
function pollutionAt(x,y){
  const key=x+","+y;if(_serviceCache?.pollution.has(key))return _serviceCache.pollution.get(key);
  let pollution=0;
  for (const o of buildings()) if (POLLUTERS.includes(o.b.type) && operational(o) && distanceToBuilding(x,y,o)<=2) pollution++;
  _serviceCache?.pollution.set(key,pollution);return pollution;
}
function beautyAt(x,y){
  const key=x+","+y;if(_serviceCache?.beauty.has(key))return _serviceCache.beauty.get(key);
  let beauty=0;
  for (const o of buildings()) {
    if (o.b.construction) continue;
    const type=o.b.type,d=BUILD[type];
    if (type==="well" && operational(o) && distanceToBuilding(x,y,o)<=2) beauty++;
    if (d.cat==="decor") {
      const r=type==="garden"?3:type==="monument"?2:1;
      if (distanceToBuilding(x,y,o)<=r) beauty+=(type==="garden"?3:1)*civilizationBonus("beauty");
    }
    if (d.civilization && operational(o) && distanceToBuilding(x,y,o)<=4) beauty+=2;
  }
  _serviceCache?.beauty.set(key,beauty);return beauty;
}
const netBeauty=(x,y)=>beautyAt(x,y)-pollutionAt(x,y);

function allocateWorkers(bl){
  const priorities={municipal:0,agri:1,industry:2,commerce:3,storage:4,culture:5,military:6,wonder:7};
  const work=bl.filter(o=>BUILD[o.b.type].workers).sort((a,b)=>(priorities[BUILD[a.b.type].cat]??8)-(priorities[BUILD[b.b.type].cat]??8) || a.b.id-b.b.id);
  let available=Math.floor(S.pop); S.workersAssigned=0; S.workersNeeded=0;
  for (const o of work) {
    const need=BUILD[o.b.type].workers;
    o.b.staffed=false;
    if (o.b.construction || o.b.damage) continue;
    S.workersNeeded+=need;
    if (available>=need && connectedToMain(o.x,o.y,BUILD[o.b.type].size)) {
      o.b.staffed=true; available-=need; S.workersAssigned+=need;
    }
  }
  refreshServiceCache(bl);
}
function updateCaps(){
  const active=type=>buildings().filter(o=>o.b.type===type && operational(o)).length;
  const mult=civilizationBonus("storage");
  const base=S.mode==="sandbox"?10000:0;
  S.caps={food:Math.round((500+active("granary")*400+base)*mult),mat:Math.round((600+active("warehouse")*500+base)*mult)};
}
function resourceCapacity(kind){ return GOODS[kind]?.cat==="food" ? S.caps.food : S.caps.mat; }
function buildingById(id){
  if(!_buildingIdCache)_buildingIdCache=new Map(buildings().map(o=>[o.b.id,o]));
  return _buildingIdCache.get(id)||null;
}
function findTownDepot(){
  const start=S.start||{x:1,y:1},choices=[];
  for(const o of buildings())if(o.b.type==='road')for(const[dx,dy]of DIRS){
    const x=o.x+dx,y=o.y+dy,t=tileAt(x,y);
    if(t&&!t.b&&t.t!=='water')choices.push({x,y,door:[o.x,o.y],distance:Math.abs(x-start.x)+Math.abs(y-start.y)});
  }
  choices.sort((a,b)=>a.distance-b.distance||a.y-b.y||a.x-b.x);
  const p=choices[0]||{x:start.x,y:start.y,door:[start.x,start.y]};
  return {x:p.x,y:p.y,door:p.door,name:'城镇货栈'};
}
function ensureLogistics(){
  if(!S.logistics)S.logistics={version:1,nextId:1,depot:findTownDepot(),jobs:[]};
  return S.logistics;
}
function roadAccess(id){
  if(id===0){const p=ensureLogistics().depot.door;return tileAt(...p)?.b?.type==='road'?[p.slice()]:[];}
  const o=buildingById(id);if(!o)return [];
  const result=[],seen=new Set();
  for(const[x,y]of footprint(o.x,o.y,BUILD[o.b.type].size))for(const[dx,dy]of DIRS){
    const nx=x+dx,ny=y+dy,key=ny*MAP_W+nx;
    if(tileAt(nx,ny)?.b?.type==='road'&&!seen.has(key)){seen.add(key);result.push([nx,ny]);}
  }
  return result;
}
function logisticsPath(starts,goals){
  if(!starts.length||!goals.length)return null;
  const targets=new Set(goals.map(([x,y])=>y*MAP_W+x)),parents=new Map(),queue=[];
  for(const p of starts)if(tileAt(...p)?.b?.type==='road'){const k=p[1]*MAP_W+p[0];if(!parents.has(k)){parents.set(k,-1);queue.push(k);}}
  for(let i=0;i<queue.length;i++){
    const key=queue[i],x=key%MAP_W,y=Math.floor(key/MAP_W);
    if(targets.has(key)){
      const route=[];for(let k=key;k!==-1;k=parents.get(k))route.push([k%MAP_W,Math.floor(k/MAP_W)]);
      return route.length<=LOGISTICS_MAX_ROUTE?route.reverse():null;
    }
    for(const[dx,dy]of DIRS){const nx=x+dx,ny=y+dy,k=ny*MAP_W+nx;if(inB(nx,ny)&&!parents.has(k)&&tileAt(nx,ny)?.b?.type==='road'){parents.set(k,key);queue.push(k);}}
  }
  return null;
}
function endpointPosition(id){const o=buildingById(id);return id===0?ensureLogistics().depot.door.slice():o?[o.x,o.y]:null;}
function endpointName(id){return id===0?'城镇货栈':BUILD[buildingById(id)?.b.type]?.name||'已拆除建筑';}
function stockProvider(kind,originId){
  const type=GOODS[kind]?.cat==='food'?'granary':'warehouse',starts=roadAccess(originId),candidates=[];
  for(const o of buildings())if(o.b.type===type&&operational(o)){
    const route=logisticsPath(starts,roadAccess(o.b.id));if(route)candidates.push({id:o.b.id,route});
  }
  candidates.sort((a,b)=>a.route.length-b.route.length||a.id-b.id);
  if(candidates.length)return candidates[0];
  return {id:0,route:logisticsPath(starts,roadAccess(0))};
}
function goodsInTransit(kind){return (S.logistics?.jobs||[]).reduce((n,j)=>n+(j.cargo[kind]||0),0);}
function logisticsPosition(j){
  const a=j.route[j.segment]||j.source,b=j.route[j.segment+1]||a,f=Math.min(1,(j.segmentProgress||0)/j.edgeSeconds);
  return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];
}
function logisticsEta(j){
  if(j.phase==='waiting')return null;
  let seconds=Math.max(0,j.route.length-1-j.segment)*j.edgeSeconds-j.segmentProgress;
  if(j.leg==='pickup')seconds+=(j.phase==='loading'?j.phaseRemaining:LOGISTICS_LOAD_SECONDS)+Math.max(0,j.route.length-1)*j.edgeSeconds;
  else if(j.phase==='loading')seconds+=j.phaseRemaining;
  return Math.max(0,seconds)+(j.leg==='return'?0:j.phase==='unloading'?j.phaseRemaining:LOGISTICS_UNLOAD_SECONDS);
}
function newLogisticsJob(kind,sourceId,targetId,cargo,route){
  const l=ensureLogistics();if(l.jobs.length>=LOGISTICS_MAX_JOBS)return null;
  const delivery=kind==='delivery',startId=delivery?sourceId:targetId;
  const fallback=roadAccess(startId)[0]||endpointPosition(startId);if(!fallback)return null;
  const j={id:l.nextId++,kind,sourceId,targetId,source:endpointPosition(sourceId),target:endpointPosition(targetId),
    sourceName:endpointName(sourceId),targetName:endpointName(targetId),route:route||[fallback],segment:0,segmentProgress:0,
    edgeSeconds:LOGISTICS_EDGE_SECONDS,phase:delivery?'loading':'travel',leg:delivery?'deliver':'pickup',isLoaded:false,
    vehicle:kind==='water'?'none':cargo.grain?'horse':'handcart',cargo:{...cargo},elapsed:0,duration:0,phaseRemaining:delivery?LOGISTICS_LOAD_SECONDS:0,waitReason:''};
  j.duration=logisticsEta(j)||0;l.jobs.push(j);return j;
}
function pauseLogistics(j,reason,resumePhase){
  if(j.phase!=='waiting')j.resumePhase=resumePhase||j.phase;
  j.phase='waiting';j.waitReason=reason;
}
function rerouteLogistics(j){
  const goal=j.leg==='pickup'||j.leg==='return'?j.sourceId:j.targetId,goals=roadAccess(goal),current=j.route[j.segment];
  if(!current)return false;
  const key=_roadRevision+':'+goal+':'+JSON.stringify(goals);
  const cached=_logisticsRouteChecks.get(j.id);if(cached?.key===key)return cached.ok;
  const route=logisticsPath([current],goals);_logisticsRouteChecks.set(j.id,{key,ok:!!route});
  if(!route)return false;
  j.route=route;j.segment=0;j.segmentProgress=0;return true;
}
function logisticsEndpointActive(id){const o=buildingById(id);return id===0?roadAccess(0).length>0:!!o&&(isResidence(o.b)?isComplete(o.b)&&connectedToMain(o.x,o.y,BUILD[o.b.type].size):operational(o));}
function advanceLogistics(seconds){
  const l=ensureLogistics(),completed=new Set();
  for(const j of l.jobs){
    const source=buildingById(j.sourceId),candidate=buildingById(j.targetId);
    const target=candidate&&((j.kind!=='restock'||BUILD[candidate.b.type].shop||BUILD[candidate.b.type].shopAll)&&(j.kind!=='water'||isResidence(candidate.b)))?candidate:null;
    if(j.leg==='return'&&!source){completed.add(j.id);continue;}
    if(j.targetId!==0&&!target){
      if(j.kind==='water'){completed.add(j.id);continue;}
      if(!j.isLoaded&&j.kind==='restock'){
        for(const[k,n]of Object.entries(j.cargo))S.goods[k]=(S.goods[k]||0)+n;
        completed.add(j.id);continue;
      }
      j.targetId=0;j.target=l.depot.door.slice();j.targetName=l.depot.name;j.kind='delivery';j.phase='travel';j.phaseRemaining=0;_logisticsRouteChecks.delete(j.id);
    }
    if(j.sourceId!==0&&!source&&!j.isLoaded){
      if(j.kind==='water'){completed.add(j.id);continue;}
      // Goods already completed or reserved still belong to this shipment.
      // The carrier at the old source can evacuate them without recreating stock.
      j.isLoaded=true;j.leg='deliver';j.phase='travel';j.phaseRemaining=0;
    }
    if(j.sourceId&&source)j.source=[source.x,source.y];
    if(j.targetId&&target)j.target=[target.x,target.y];
    let remaining=seconds,guard=0;
    while(remaining>1e-8&&guard++<LOGISTICS_MAX_ROUTE+8&&!completed.has(j.id)){
      if(j.phase==='waiting'){j.phase=j.resumePhase||'travel';delete j.resumePhase;j.waitReason='';}
      if(j.phase==='loading'){
        if(j.sourceId&&source&&!operational(source)){pauseLogistics(j,'货源停工，等待道路和工人');break;}
        const location=j.route[j.segment];
        if(!roadAccess(j.sourceId).some(p=>p[0]===location[0]&&p[1]===location[1])){j.leg='pickup';j.phase='travel';_logisticsRouteChecks.delete(j.id);continue;}
        const spent=Math.min(remaining,j.phaseRemaining);remaining-=spent;j.phaseRemaining-=spent;j.elapsed+=spent;
        if(j.phaseRemaining>1e-8)break;
        j.isLoaded=true;j.leg='deliver';j.phase='travel';_logisticsRouteChecks.delete(j.id);
        if(!rerouteLogistics(j))pauseLogistics(j,'道路中断，货物原地等待','travel');
      }else if(j.phase==='travel'){
        if(j.segmentProgress===0&&!rerouteLogistics(j)){pauseLogistics(j,'道路中断，货物原地等待');break;}
        const a=j.route[j.segment],b=j.route[j.segment+1];
        if(!b){
          if(j.leg==='return'){completed.add(j.id);continue;}
          if(j.leg==='pickup'){j.phase='loading';j.phaseRemaining=LOGISTICS_LOAD_SECONDS;}
          else{j.phase='unloading';j.phaseRemaining=LOGISTICS_UNLOAD_SECONDS;}
          continue;
        }
        if(tileAt(...a)?.b?.type!=='road'||tileAt(...b)?.b?.type!=='road'){pauseLogistics(j,'前方道路拆除，停在原路段');break;}
        const spent=Math.min(remaining,j.edgeSeconds-j.segmentProgress);remaining-=spent;j.segmentProgress+=spent;j.elapsed+=spent;
        if(j.segmentProgress+1e-8>=j.edgeSeconds){j.segment++;j.segmentProgress=0;}
      }else if(j.phase==='unloading'){
        const location=j.route[j.segment];
        if(!roadAccess(j.targetId).some(p=>p[0]===location[0]&&p[1]===location[1])){j.phase='travel';_logisticsRouteChecks.delete(j.id);continue;}
        if(!logisticsEndpointActive(j.targetId)){pauseLogistics(j,'目的地停工，等待卸货');break;}
        if(j.kind==='delivery'&&Object.entries(j.cargo).some(([k,n])=>resourceCapacity(k)-(S.goods[k]||0)+1e-9<n)){pauseLogistics(j,'仓储已满，保留货物等待卸货');break;}
        const spent=Math.min(remaining,j.phaseRemaining);remaining-=spent;j.phaseRemaining-=spent;j.elapsed+=spent;
        if(j.phaseRemaining>1e-8)break;
        const dest=buildingById(j.targetId)?.b;
        if(j.kind==='water'){if(dest)dest.water=(dest.water||0)+(j.cargo.water||0);}
        else if(j.kind==='restock'){if(dest){dest.stock??={};for(const[k,n]of Object.entries(j.cargo))dest.stock[k]=(dest.stock[k]||0)+n;}}
        else for(const[k,n]of Object.entries(j.cargo))S.goods[k]=(S.goods[k]||0)+n;
        if(j.kind==='delivery'&&source){j.cargo={};j.isLoaded=false;j.leg='return';j.phase='travel';_logisticsRouteChecks.delete(j.id);if(!rerouteLogistics(j))pauseLogistics(j,'返程道路中断，车辆原地等待','travel');}
        else completed.add(j.id);
      }else break;
    }
    const eta=logisticsEta(j);if(eta!==null)j.duration=j.elapsed+eta;
  }
  if(completed.size){l.jobs=l.jobs.filter(j=>!completed.has(j.id));for(const id of completed)_logisticsRouteChecks.delete(id);}
}
function servingShop(o,kind,requireStock=true){
  const candidates=_serviceCache?.shops||buildings().filter(q=>(BUILD[q.b.type].shop||BUILD[q.b.type].shopAll)&&operational(q));
  return candidates.find(q=>{const d=BUILD[q.b.type];return(d.shop===kind||d.shopAll)&&distanceToBuilding(o.x,o.y,q)<=d.radius&&(d.shopAll||shopPairOk(q))&&(!requireStock||(q.b.stock?.[kind]||0)>1e-9);})||null;
}
function scheduleLogistics(bl){
  const l=ensureLogistics(),homes=bl.filter(o=>isResidence(o.b)&&isComplete(o.b)&&o.b.pop>0);
  const occupied=new Set(l.jobs.map(j=>j.kind+':'+j.targetId));
  homes.sort((a,b)=>(a.b.water||0)/a.b.pop-(b.b.water||0)/b.b.pop||a.b.id-b.b.id);
  for(const o of homes){
    if(l.jobs.length>=LOGISTICS_MAX_JOBS)break;
    if(occupied.has('water:'+o.b.id)||(o.b.water||0)>=o.b.pop*.05)continue;
    const well=coveredBy(o.x,o.y,'water');if(!well)continue;
    const route=logisticsPath(roadAccess(o.b.id),roadAccess(well.b.id));if(!route)continue;
    const amount=Math.max(.2,o.b.pop*.2)-(o.b.water||0);
    if(amount>0)newLogisticsJob('water',well.b.id,o.b.id,{water:amount},route);
  }
  for(const o of bl){
    const d=BUILD[o.b.type];if(!(d.shop||d.shopAll)||!operational(o)||!shopPairOk(o)||occupied.has('restock:'+o.b.id))continue;
    if(l.jobs.length>=LOGISTICS_MAX_JOBS)break;
    const kinds=d.shop?[d.shop]:['grain','veg','fruit','fish','meat'],cargo={};
    for(const kind of kinds){
      const demand=homes.reduce((n,h)=>{
        const needs=new Set([...residenceLevel(h.b).needs,...(residenceLevels(h.b)[h.b.lvl]?.needs||[])]);
        return distanceToBuilding(h.x,h.y,o)<=d.radius&&needs.has(kind)?n+h.b.pop*(kind==='grain'?.035:.006):n;
      },0);
      if(demand<=0||(o.b.stock?.[kind]||0)>=Math.max(1,demand*4))continue;
      const amount=Math.min(Math.max(2,demand*15)-(o.b.stock?.[kind]||0),S.goods[kind]||0);
      if(amount>1e-8)cargo[kind]=amount;
    }
    const kind=Object.keys(cargo)[0];if(!kind)continue;
    const provider=stockProvider(kind,o.b.id);if(!provider.route)continue;
    const job=newLogisticsJob('restock',provider.id,o.b.id,cargo,provider.route);
    if(job)for(const[k,n]of Object.entries(cargo))S.goods[k]=Math.max(0,S.goods[k]-n);
  }
}
function consumeGoods(o,kind,amount){
  if(amount<=0)return;
  const shop=servingShop(o,kind);let remaining=amount;
  if(shop){const take=Math.min(remaining,shop.b.stock[kind]);shop.b.stock[kind]-=take;remaining-=take;}
  // Basic rations keep a new settlement alive before shops are unlocked.
  if(kind==='grain'||!['veg','fruit','fish','meat'].includes(kind)||(S.logistics?.graceSeconds||0)>0)S.goods[kind]=Math.max(0,(S.goods[kind]||0)-remaining);
}
function hydrateLogistics(raw){
  const num=(v,f=0,max=1e9)=>Number.isFinite(Number(v))?Math.min(max,Math.max(0,Number(v))):f;
  const point=p=>Array.isArray(p)&&p.length===2&&inB(p[0],p[1]);
  const savedDepot=raw?.depot,validDepot=savedDepot&&inB(savedDepot.x,savedDepot.y)&&point(savedDepot.door)&&Math.abs(savedDepot.x-savedDepot.door[0])+Math.abs(savedDepot.y-savedDepot.door[1])===1&&!tileAt(savedDepot.x,savedDepot.y)?.b;
  S.logistics={version:1,nextId:Math.max(1,Math.floor(num(raw?.nextId,1))),graceSeconds:raw?.version===1?num(raw.graceSeconds,0,900):300,
    depot:validDepot?{x:savedDepot.x,y:savedDepot.y,door:savedDepot.door.slice(),name:'城镇货栈'}:findTownDepot(),jobs:[]};
  const seen=new Set();
  for(const input of (Array.isArray(raw?.jobs)?raw.jobs:[]).slice(0,LOGISTICS_MAX_JOBS)){
    if(!input||typeof input!=='object'||Array.isArray(input))continue;
    if(!Number.isInteger(input.id)||input.id<1||seen.has(input.id)||!['delivery','water','restock'].includes(input.kind)||!['loading','travel','unloading','waiting'].includes(input.phase)||!['pickup','deliver','return'].includes(input.leg))continue;
    if(!point(input.source)||!point(input.target)||!Array.isArray(input.route)||!input.route.length||input.route.length>LOGISTICS_MAX_ROUTE||input.route.some((p,i)=>!point(p)||(i&&Math.abs(p[0]-input.route[i-1][0])+Math.abs(p[1]-input.route[i-1][1])!==1)))continue;
    const cargo=Object.fromEntries([...Object.keys(GOODS),'water'].filter(k=>num(input.cargo?.[k])>0).map(k=>[k,num(input.cargo[k])]));
    const edgeSeconds=LOGISTICS_EDGE_SECONDS,segment=Math.min(input.route.length-1,Math.floor(num(input.segment))),segmentProgress=segment<input.route.length-1?num(input.segmentProgress,0,edgeSeconds):0;
    const j={id:input.id,kind:input.kind,sourceId:Math.floor(num(input.sourceId)),targetId:Math.floor(num(input.targetId)),source:input.source.slice(),target:input.target.slice(),
      sourceName:endpointName(Math.floor(num(input.sourceId))),targetName:endpointName(Math.floor(num(input.targetId))),route:input.route.map(p=>p.slice()),segment,segmentProgress,
      edgeSeconds,phase:input.phase,leg:input.leg,isLoaded:!!input.isLoaded,vehicle:['horse','handcart','none'].includes(input.vehicle)?input.vehicle:input.kind==='water'?'none':cargo.grain?'horse':'handcart',cargo,elapsed:num(input.elapsed,0,1e12),duration:num(input.duration,0,1e12),phaseRemaining:num(input.phaseRemaining,0,LOGISTICS_LOAD_SECONDS),waitReason:String(input.waitReason||'').slice(0,100)};
    if(input.phase==='waiting')j.resumePhase=['loading','travel','unloading'].includes(input.resumePhase)?input.resumePhase:'travel';
    seen.add(j.id);S.logistics.nextId=Math.max(S.logistics.nextId,j.id+1);S.logistics.jobs.push(j);
  }
}
function logisticsSnapshot(){
  const l=ensureLogistics();return {version:1,nextId:l.nextId,graceSeconds:l.graceSeconds||0,depot:{...l.depot,door:l.depot.door.slice()},jobs:l.jobs.map(j=>({...j,source:j.source.slice(),target:j.target.slice(),route:j.route.map(p=>p.slice()),cargo:{...j.cargo},position:logisticsPosition(j),moving:j.phase==='travel',eta:logisticsEta(j)}))};
}
function buildingLogistics(x,y){
  const b=tileAt(x,y)?.b;if(!b)return {state:'无建筑',incoming:[],outgoing:[],stock:{},water:0};
  const jobs=ensureLogistics().jobs,result={state:'无待运货物',waitReason:'',incoming:[],outgoing:[],stock:{...(b.stock||{})},water:b.water||0};
  for(const j of jobs){
    if(j.sourceId!==b.id&&j.targetId!==b.id)continue;
    result.state=j.phase==='waiting'?'运输等待':j.phase==='loading'?'装货中':j.phase==='unloading'?'卸货中':'运输中';
    if(j.waitReason)result.waitReason=j.waitReason;
    for(const[resource,quantity]of Object.entries(j.cargo)){
      if(j.targetId===b.id)result.incoming.push({resource,quantity,fromName:j.sourceName,fromId:j.sourceId,eta:logisticsEta(j)});
      if(j.sourceId===b.id)result.outgoing.push({resource,quantity,toName:j.targetName,toId:j.targetId,eta:logisticsEta(j)});
    }
  }
  return result;
}
function hasActiveLandmark(){ return buildings().some(o=>o.b.type===getCivilization().landmark && operational(o)); }
function productionMultiplier(o){
  const d=BUILD[o.b.type],mods=getCivilization().modifiers; let mult=1;
  if (d.cat==="agri") mult*=mods.agri||1;
  if (d.prod?.wood) mult*=mods.wood||1;
  if (["quarry","clayPit","copperMine"].includes(o.b.type)) mult*=mods.mining||1;
  if (d.input) mult*=mods.craft||1;
  if (d.cat==="agri" && o.b.type!=="fishing" && nearWater(o.x,o.y,d.size,3)) mult*=1.1+(mods.riverFarm||0);
  if (o.b.type==="fishing") mult*=1.25;
  if (hasActiveLandmark()) {
    if ((S.civilization==="china" && d.input) || (S.civilization==="egypt" && ["quarry","clayPit","copperMine"].includes(o.b.type)) || (S.civilization==="aztec" && d.cat==="agri")) mult*=1.1;
  }
  return mult;
}
function constructionVisualContext(){
  if(_constructionVisualState===S)return;
  _constructionVisualState=S;_constructionObserved.clear();_constructionExits.clear();
}
function constructionSiteId(b){
  const c=b.construction;
  return `construction:${b.id}:${c.fromLevel||0}:${c.toLevel||1}:${c.total}`;
}
function constructionStage(progress){return progress<.28?'foundation':progress<.75?'structure':progress<1?'finishing':'complete';}
function constructionRoutePosition(route,progress){
  const lengths=route.slice(1).map((p,i)=>Math.hypot(p[0]-route[i][0],p[1]-route[i][1]));
  let distance=lengths.reduce((a,b)=>a+b,0)*Math.max(0,Math.min(1,progress));
  for(let i=0;i<lengths.length;i++){
    if(distance<=lengths[i]||i===lengths.length-1){
      const f=lengths[i]?Math.min(1,distance/lengths[i]):1,a=route[i],b=route[i+1];
      return {position:[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f],routePosition:i+f};
    }
    distance-=lengths[i];
  }
  return {position:route[0].slice(),routePosition:0};
}
function constructionWorker(site,index){
  const delay=index*3,local=Math.max(0,site.elapsed-delay),cycleIndex=Math.floor(local/CONSTRUCTION_CREW_CYCLE_SECONDS);
  const cycleTime=local%CONSTRUCTION_CREW_CYCLE_SECONDS,targetIndex=cycleIndex*site.workerCount+index;
  const target=site.installationPoints[targetIndex%site.installationPoints.length],material=site.materialPoint,entry=site.entry;
  const outbound=[material.slice(),entry.slice(),target.slice()],inbound=outbound.slice().reverse();
  let phase,phaseProgress,route;
  if(cycleTime<4){phase='loading';phaseProgress=cycleTime/4;route=[material.slice()];}
  else if(cycleTime<14){phase='carrying';phaseProgress=(cycleTime-4)/10;route=outbound;}
  else if(cycleTime<26){phase='installing';phaseProgress=(cycleTime-14)/12;route=[target.slice()];}
  else{phase='returning';phaseProgress=(cycleTime-26)/10;route=inbound;}
  const cycleStart=delay+cycleIndex*CONSTRUCTION_CREW_CYCLE_SECONDS,materialStage=constructionStage(cycleStart/site.total);
  return {id:site.id+':worker:'+index,index,phase,phaseProgress,cycleIndex,targetIndex,
    carriedMaterial:materialStage==='foundation'?'brick':materialStage==='structure'?'timber':'tile',
    isLoaded:phase==='carrying'||phase==='installing',elevation:0,active:site.active&&site.elapsed>=delay,
    elapsed:local,cycleSeconds:CONSTRUCTION_CREW_CYCLE_SECONDS,route,...constructionRoutePosition(route,phaseProgress)};
}
function constructionSite(o,options={}){
  const {b,x,y}=o,c=b.construction,d=BUILD[b.type],size=d.size,id=constructionSiteId(b);
  const total=Math.max(.001,c.total),elapsed=Math.max(0,Math.min(total,total-c.remaining)),progress=elapsed/total;
  const net=roadNetwork(),access=roadAccess(b.id).sort((a,b)=>Number(!!net[b[1]][b[0]])-Number(!!net[a[1]][a[0]])||a[1]-b[1]||a[0]-b[0]);
  const road=access[0]||null,previous=_constructionObserved.get(id);
  const linked=d.cat==='decor'||connectedToMain(x,y,size),paused=!!options.suspended;
  // A removed approach freezes the existing crew at its last layout until a real
  // approach returns. An unseen isolated project has no arriving workers.
  const materialPoint=road?.slice()||previous?.materialPoint.slice()||[x+(size-1)/2,y+size-1];
  const inside=road?[Math.max(x,Math.min(x+size-1,road[0])),Math.max(y,Math.min(y+size-1,road[1]))]:null;
  const entry=road?[(road[0]+inside[0])/2,(road[1]+inside[1])/2]:previous?.entry.slice()||materialPoint.slice();
  const margin=size===1?.18:.15,span=Math.max(.2,size-1-margin*2);
  const installationPoints=[[x+margin,y+margin],[x+margin+span,y+margin],[x+margin,y+margin+span],[x+margin+span,y+margin+span]];
  const workerCount=road||previous?.workerCount>0||d.cat==='decor'?Math.min(4,d.cat==='decor'?1:size+1):0;
  const active=!paused&&linked&&workerCount>0,blockedReason=paused?'已暂停':!linked?'道路未连接主路':!workerCount?'等待施工道路':'';
  const site={id,buildingId:b.id,type:b.type,origin:[x,y],size,total,elapsed,progress,stage:constructionStage(progress),
    fromLevel:c.fromLevel||0,toLevel:c.toLevel||1,roadAccess:road?.slice()||null,entry,materialPoint,installationPoints,
    layoutKey:[x,y,...entry,...materialPoint].join(','),supplyMode:road?'roadside':d.cat==='decor'?'on_site':'waiting',
    workerCount,active,paused,blockedReason,finished:false,exitElapsed:0,exitDuration:CONSTRUCTION_CREW_EXIT_SECONDS,
    cycleSeconds:CONSTRUCTION_CREW_CYCLE_SECONDS};
  site.workers=Array.from({length:workerCount},(_,i)=>constructionWorker(site,i));
  return site;
}
function retainConstructionExit(o,completedAt){
  constructionVisualContext();
  const id=constructionSiteId(o.b);
  // Catch-up and never-viewed projects must not spawn a retrospective workforce.
  if(_quietSimulation||!_constructionObserved.has(id))return;
  const site=constructionSite(o);
  _constructionExits.set(id,{site,completedAt});
  if(_constructionExits.size>128)_constructionExits.delete(_constructionExits.keys().next().value);
}
function constructionSitesSnapshot(options={}){
  if(!S)return [];
  constructionVisualContext();
  const now=S.clock?.elapsedSeconds||0,sites=[],live=new Set();
  for(const o of buildings()){
    if(!o.b.construction)continue;
    const site=constructionSite(o,options);live.add(site.id);_constructionObserved.set(site.id,site);sites.push(site);
  }
  for(const[id,record]of _constructionExits){
    const exitElapsed=Math.max(0,now-record.completedAt),base=record.site;
    // Demolishing the completed building or changing cities cannot revive a crew.
    if(exitElapsed>=CONSTRUCTION_CREW_EXIT_SECONDS||!buildingById(base.buildingId)){_constructionExits.delete(id);continue;}
    const paused=!!options.suspended,active=!paused,phaseProgress=exitElapsed/CONSTRUCTION_CREW_EXIT_SECONDS;
    const site={...base,finished:true,stage:'complete',progress:1,active,paused,blockedReason:paused?'已暂停':'',exitElapsed};
    site.workers=base.workers.map(w=>{
      const route=[w.position.slice(),base.entry.slice(),base.materialPoint.slice()];
      return {...w,phase:'leaving',phaseProgress,isLoaded:false,active,route,...constructionRoutePosition(route,phaseProgress)};
    });
    sites.push(site);
  }
  for(const id of _constructionObserved.keys())if(!live.has(id))_constructionObserved.delete(id);
  return sites;
}
function advanceConstruction(bl,seconds){
  let changed=false;
  for (const o of bl) {
    const b=o.b,d=BUILD[b.type];
    if(b.damage){b.damage=Math.max(0,b.damage-seconds*(coveredBy(o.x,o.y,"repair")?3:1));if(!b.damage){changed=true;_serviceCache=null;}}
    if (!b.construction) continue;
    b.staffed=false;
    if (d.cat!=="decor" && !connectedToMain(o.x,o.y,d.size)) { b.idle=true; continue; }
    const remainingBefore=b.construction.remaining;
    b.idle=false; b.construction.remaining=Math.max(0,remainingBefore-seconds);
    if (b.construction.remaining>0) continue;
    retainConstructionExit(o,(S.clock?.elapsedSeconds||0)+remainingBefore);
    if (b.construction.toLevel) {
      b.lvl=b.construction.toLevel; b.missTicks=0;
      emitToast(d.name+"升至 "+b.lvl+" 级","good");
    } else if (d.cat!=="decor") emitToast(d.name+"已建成","good");
    delete b.construction; _serviceCache=null;changed=true;
    if (b.type==="wonder") winGame();
    if (typeof window!=="undefined" && typeof window.invalidateRenderer==="function") window.invalidateRenderer();
  }
  if(changed){allocateWorkers(bl);updateCaps();}
}
function constructionDuration(type,fromLevel=0,civilization=S?.civilization){
  const base=fromLevel?(type==='villa'?VILLA_UPGRADE_SECONDS:HOUSE_UPGRADE_SECONDS)[fromLevel]:BUILD[type]?.buildTime;
  if(!base)return 0;
  // Two minutes remains a useful warehouse onboarding anchor across civilizations.
  return Math.max(120,Math.round(base*(getCivilization(civilization).modifiers.construction||1)));
}
function startProduction(o){
  const b=o.b,d=BUILD[b.type];
  if(!d.prod||b.production)return false;
  if(!operational(o)){b.idle=true;b.idleReason='需要道路和工人，且建筑应完工';return false;}
  const duration=d.cycleSeconds,multiplier=productionMultiplier(o),scale=duration/60;
  if(Object.entries(d.prod).some(([kind,n])=>resourceCapacity(kind)-(S.goods[kind]||0)-goodsInTransit(kind)+1e-9<n*scale*multiplier)){b.idle=true;b.idleReason='仓储不足一批产量（包含在途货物）';return false;}
  if(d.input&&Object.entries(d.input).some(([kind,n])=>(S.goods[kind]||0)+1e-9<n*scale)){b.idle=true;b.idleReason='原料不足一批用量';return false;}
  if(d.input)for(const[kind,n]of Object.entries(d.input))S.goods[kind]=Math.max(0,S.goods[kind]-n*scale);
  b.production={elapsed:0,duration,multiplier};b.idle=false;delete b.idleReason;return true;
}
function advanceProduction(bl){
  for(const o of bl){
    const b=o.b,d=BUILD[b.type];if(!d.prod)continue;
    if(!b.production){startProduction(o);continue;}
    if(!operational(o)){b.idle=true;b.idleReason='道路、工人或建筑状态中断';continue;}
    const p=b.production,scale=p.duration/60;
    // Preserve a ready batch while storage is full; neither inputs nor finished goods vanish.
    if(Object.entries(d.prod).some(([kind,n])=>resourceCapacity(kind)-(S.goods[kind]||0)-goodsInTransit(kind)+1e-9<n*scale*p.multiplier)){b.idle=true;b.idleReason='仓储不足，批次保留';continue;}
    b.idle=false;delete b.idleReason;
    p.elapsed=Math.min(p.duration,p.elapsed+ECONOMY_STEP_SECONDS);
    if(p.elapsed+1e-9<p.duration)continue;
    const cargo=Object.fromEntries(Object.entries(d.prod).map(([kind,n])=>[kind,n*scale*p.multiplier]));
    const provider=stockProvider(Object.keys(cargo)[0],b.id);
    if(!newLogisticsJob('delivery',b.id,provider.id,cargo,provider.route)){b.idle=true;b.idleReason='运输队列已满，保留整批产物';continue;}
    b.productionTicks=(b.productionTicks||0)+1;delete b.production;
    startProduction(o);
  }
}
function economyMinute(){
  S.tick++;
  const bl=buildings();
  S.pop=bl.reduce((sum,o)=>sum+(isResidence(o.b)?o.b.pop||0:0),0);
  allocateWorkers(bl);updateCaps();advanceProduction(bl);scheduleLogistics(bl);
  const residences=bl.filter(o=>isResidence(o.b));
  for (const o of residences) {
    const h=o.b;
    if (!isComplete(h)) continue;
    const met=evaluateNeeds(o); h.met=met;
    let cur=residenceLevel(h);
    if (!h.construction) {
      if (met.canUpgrade && (h.pop||0)>=cur.pop*0.9) {
        h.upTimer=Math.min(UPGRADE_DELAY,(h.upTimer||0)+ECONOMY_STEP_SECONDS);
      } else h.upTimer=0;
      if (!met.currentOk && h.lvl>1) {
        h.missTicks=(h.missTicks||0)+ECONOMY_STEP_SECONDS;
        if (h.missTicks>=NEED_GRACE_SECONDS) {
          h.lvl--; h.missTicks=0; cur=residenceLevel(h); h.pop=Math.min(h.pop,cur.pop);
          emitLog(BUILD[h.type].name+"的需求持续缺失，降至 "+h.lvl+" 级。","bad");
        }
      } else h.missTicks=Math.max(0,(h.missTicks||0)-2*ECONOMY_STEP_SECONDS);
      if (met.map.road && S.goods.grain>10 && !h.construction) {
        const rate=Math.max(0.3,cur.pop*0.045*prestigeTier(S.prestige).immig*civilizationBonus("immigration"));
        h.pop=Math.min(cur.pop,(h.pop||0)+rate);
      } else if (!met.map.road || S.goods.grain<=0) h.pop=Math.max(0,(h.pop||0)-Math.max(0.1,cur.pop*0.01));
    }
    if (met.currentOk && h.pop>=cur.pop*0.5) {
      h.taxTimer=(h.taxTimer||0)+ECONOMY_STEP_SECONDS;
      if(h.taxTimer>=TAX_INTERVAL){
        const bonus=civilizationBonus("tax")*(S.civilization==="greece"&&hasActiveLandmark()?1.1:1);
        const tax=cur.tax*bonus;S.gold+=tax;S.stats.taxed+=tax;h.taxTimer-=TAX_INTERVAL;
      }
    }
    // Occupants of an upgrading home remain in town and still eat.
    consumeGoods(o,'grain',(h.pop||0)*0.035);
    h.water=Math.max(0,(h.water||0)-(h.pop||0)*.01);
    for (const kind of ["veg","fruit","fish","meat","pottery","wine","cloth"]) {
      if (cur.needs.includes(kind) && met.map[kind]) consumeGoods(o,kind,(h.pop||0)*(GOODS[kind].cat==="food"?0.006:0.002));
    }
  }
  if(S.logistics?.graceSeconds)S.logistics.graceSeconds=Math.max(0,S.logistics.graceSeconds-ECONOMY_STEP_SECONDS);
  for (const o of bl) if (o.b.type==="harbor" && operational(o)) S.gold+=1.5*civilizationBonus("trade");
  S.pop=residences.reduce((sum,o)=>sum+(o.b.pop||0),0);
  // A population decrease can release workers immediately, avoiding a negative labour pool.
  if (S.workersAssigned>Math.floor(S.pop)) allocateWorkers(bl);
  updatePrestige();
  if (S.tick%60===0) hazards(bl);
  checkTasks();
  S.stats.maxPop=Math.max(S.stats.maxPop,S.pop);
}
function residenceEnvironment(o){
  const key=o.x+','+o.y+','+o.b.type;
  if(_serviceCache?.environments.has(key))return _serviceCache.environments.get(key);
  const map={road:connectedToMain(o.x,o.y,BUILD[o.b.type].size)},shopCoverage={};
  for(const need of ["water","temple","school","fun","safety","health","security","repair","bath","university","observatory"])map[need]=!!coveredBy(o.x,o.y,need);
  const shops=_serviceCache?.shops||buildings().filter(q=>(BUILD[q.b.type].shop||BUILD[q.b.type].shopAll)&&operational(q));
  for(const kind of ["grain","veg","fruit","fish","meat"])shopCoverage[kind]=shops.some(q=>{const d=BUILD[q.b.type];return(d.shop===kind||d.shopAll)&&distanceToBuilding(o.x,o.y,q)<=d.radius&&(d.shopAll||shopPairOk(q));});
  const environment={map,shopCoverage,beauty:netBeauty(o.x,o.y),clean:o.b.type!=="villa"||pollutionAt(o.x,o.y)===0};
  _serviceCache?.environments.set(key,environment);return environment;
}
function evaluateNeeds(o){
  const h=o.b,levels=residenceLevels(h),lvlData=residenceLevel(h),environment=residenceEnvironment(o),map={...environment.map};
  const grace=(S.logistics?.graceSeconds||0)>0;
  map.water=!!environment.map.water&&((h.water||0)>1e-9||grace);
  for(const kind of ["grain","veg","fruit","fish","meat"])map[kind]=environment.shopCoverage[kind]&&(!!servingShop(o,kind)||(grace&&(S.goods[kind]||0)>0));
  map.woodMat=(S.goods.wood||0)>=5; map.stoneMat=(S.goods.stone||0)>=5; map.clayMat=(S.goods.clay||0)>=5;
  for (const kind of ["pottery","wine","cloth"]) map[kind]=(S.goods[kind]||0)>=1;
  const missing=lvlData.needs.filter(n=>!map[n]);
  const next=levels[h.lvl||1], nextMissing=next?next.needs.filter(n=>!map[n]):[];
  const {beauty,clean}=environment;
  const canUpgrade=!!next && !h.construction && nextMissing.length===0 && beauty>=0 && clean;
  return {map,missing,currentOk:missing.length===0,next,nextMissing,canUpgrade,ok:canUpgrade,beauty,clean};
}
function upgradeStatus(x,y){
  const b=tileAt(x,y)?.b;
  const empty={eligible:false,reason:'请选择住宅',cost:{},duration:0,nextLevel:0,stableRemaining:0,needs:[]};
  if(!isResidence(b))return empty;
  const o=buildingById(b.id),met=evaluateNeeds(o),next=residenceLevels(b)[b.lvl],cur=residenceLevel(b);
  const cost={...((b.type==='villa'?VILLA_UPGRADE_COSTS:HOUSE_UPGRADE_COSTS)[b.lvl]||{})};
  const result={...empty,cost,duration:next?constructionDuration(b.type,b.lvl):0,nextLevel:next?b.lvl+1:0,
    stableRemaining:Math.max(0,UPGRADE_DELAY-(b.upTimer||0)),needs:(next?.needs||[]).map(id=>({id,name:NEED_INFO[id]?.name||id,met:!!met.map[id]}))};
  result.reason=!next?'已达最高等级':b.construction?'工程进行中':!met.canUpgrade?'请先满足下一等级需求及环境条件':(b.pop||0)<cur.pop*.9?'入住人数需达到容量的90%':result.stableRemaining>0?'需求与入住人数仍需保持稳定':Object.entries(cost).some(([k,n])=>(S.goods[k]||0)<n)?'升级材料不足':'';
  result.eligible=!result.reason;return result;
}
function requestUpgrade(x,y){
  const status=upgradeStatus(x,y);if(!status.eligible)return {ok:false,why:status.reason,...status};
  const b=tileAt(x,y).b;
  for(const[k,n]of Object.entries(status.cost))S.goods[k]-=n;
  b.construction={remaining:status.duration,total:status.duration,fromLevel:b.lvl,toLevel:b.lvl+1};b.upTimer=0;b.missTicks=0;
  _serviceCache=null;refreshUI();return {ok:true,why:'升级工程已开始',...status};
}
function updatePrestige(){
  const bl=buildings(),res=bl.filter(o=>isResidence(o.b)&&isComplete(o.b));
  let coveredScore=0,unmet=0;
  for(const o of res){
    const environment=residenceEnvironment(o),map=environment.map;
    coveredScore+=(map.safety?8:0)+(map.health?6:0)+(map.security?4:0)+(map.school?6:0)+(map.fun?5:0)+(environment.beauty>0?8:0);
    if(o.b.met&&!o.b.met.currentOk)unmet++;
  }
  let target=55+Math.min(12,S.gold/500)+(res.length?(coveredScore-unmet*20)/res.length:0);
  target-=Math.min(12,bl.filter(o=>BUILD[o.b.type].workers && !o.b.staffed && !o.b.construction).length);
  if (S.goods.grain<20) target-=20;
  target=Math.max(0,Math.min(100,target));
  S.prestige+=(target-S.prestige)*0.025;
}
function hazards(bl){
  if (S.mode==="sandbox" || S.tick<300 || S.chapter<2 || cityRandom()>0.08) return;
  const risk=bl.filter(o=>BUILD[o.b.type].prod && operational(o) && !coveredBy(o.x,o.y,"safety"));
  if (!risk.length) return;
  const victim=risk[Math.floor(cityRandom()*risk.length)];
  victim.b.damage=18*60; _serviceCache=null; victim.b.staffed=false; S.stats.disasters=(S.stats.disasters||0)+1;
  emitLog(BUILD[victim.b.type].name+"发生小火灾，停工修复中。值更房能预防火灾，修缮所可加速恢复。","bad");
  emitToast("生产建筑受损，正在修复","bad");
}
function destroyBuilding(x,y){
  const b=tileAt(x,y)?.b; if (!b) return false;
  const cargo={...(b.stock||{})},d=BUILD[b.type];
  if(b.production&&d.input)for(const[k,n]of Object.entries(d.input))cargo[k]=(cargo[k]||0)+n*b.production.duration/60;
  if(Object.values(cargo).some(n=>n>0)){
    if(!newLogisticsJob('delivery',b.id,0,cargo,logisticsPath(roadAccess(b.id),roadAccess(0)))){emitToast('运输队列已满，请待货物送达后再拆除','bad');return false;}
  }
  const [ox,oy]=b.origin||[x,y],fp=footprint(ox,oy,BUILD[b.type].size);
  if (fp) for (const [, ,t] of fp) if (t.b?.id===b.id) t.b=null;
  invalidateWorld();
  S.pop=buildings().reduce((sum,o)=>sum+(isResidence(o.b)?o.b.pop||0:0),0);
  allocateWorkers(buildings()); updateCaps(); return true;
}
function checkTasks(){
  if (S.mode==="sandbox") return;
  const ch=CHAPTERS[S.chapter]; if (!ch || S.chapterCompleted[S.chapter]) return;
  const done=S.taskDone[S.chapter];
  for (let i=0;i<ch.tasks.length;i++) if (!done[i] && ch.tasks[i].check(S)) {
    done[i]=true; emitToast("✓ "+ch.tasks[i].text,"good"); emitLog("✓ "+ch.tasks[i].text,"good");
  }
  if (!done.every(Boolean)) return;
  S.chapterCompleted[S.chapter]=true;
  // Rewards may temporarily exceed storage. Production waits until room is available.
  for (const [kind,n] of Object.entries(ch.reward||{})) S.goods[kind]=(S.goods[kind]||0)+n;
  if (S.chapter<CHAPTERS.length-1) {
    S.chapter++; emitLog("开启"+CHAPTERS[S.chapter].title,"good"); emitToast(CHAPTERS[S.chapter].title,"good");
    if (typeof renderBuildList==="function") renderBuildList();
  }
  if (typeof renderTasks==="function") renderTasks();
}
function currentUnlocked(){
  if (!S) return new Set();
  return new Set(Object.keys(BUILD).filter(type=>{
    const d=BUILD[type]; return (!d.civilization || d.civilization===S.civilization) && (S.mode==="sandbox" || d.chapter<=S.chapter+1);
  }));
}
function hasResource(fp,kind){ return fp.some(([, ,t])=>t.t===kind); }
function canBuildAt(type,x,y,options = {}){
  const depot=S?.logistics?.depot,size=BUILD[type]?.size;
  if(depot&&size&&x<=depot.x&&y<=depot.y&&x+size>depot.x&&y+size>depot.y)return {ok:false,why:'城镇货栈是基础仓储，请保留此地标'};
  const d=BUILD[type]; if (!d) return {ok:false,why:"未知建筑"};
  if (d.civilization && d.civilization!==S.civilization) return {ok:false,why:"此建筑属于另一文明"};
  const fp=footprint(x,y,d.size);
  if (!fp) return {ok:false,why:"超出地图"};
  if (fp.some(([, ,t])=>t.b && t.b.id!==options.ignoreId)) return {ok:false,why:"位置已被占用"};
  if (type!=="road" && fp.some(([, ,t])=>t.t==="water")) return {ok:false,why:"建筑需要陆地；水上可以铺设道路建桥"};
  const resource={lumber:"tree",quarry:"stone",clayPit:"clay",copperMine:"copper"}[type];
  if (resource && !hasResource(fp,resource)) return {ok:false,why:BUILD[type].name+"需要覆盖"+TERRAIN[resource].name};
  if (["fishing","harbor"].includes(type) && !nearWater(x,y,d.size)) return {ok:false,why:"需要紧邻水面建造"};
  return {ok:true};
}
function afford(type){
  const d=BUILD[type]; return !!d && Object.entries(d.cost||{}).every(([k,n])=>(S.goods[k]||0)>=n);
}
function doBuild(type,x,y){
  if (!S || !currentUnlocked().has(type)) { emitToast("尚未解锁此建筑","bad"); return false; }
  const check=canBuildAt(type,x,y);
  if (!check.ok) { emitToast(check.why,"bad"); return false; }
  if (!afford(type)) { emitToast("资源不足；可使用商队贸易补充物资","bad"); return false; }
  const d=BUILD[type], b=type==="road"?setRoad(x,y):put(x,y,type);
  if (!b) return false;
  for (const [kind,n] of Object.entries(d.cost||{})) S.goods[kind]-=n;
  if (d.buildTime>0) {
    const total=constructionDuration(type);
    b.construction={remaining:total,total};
  }
  S.stats.totalBuilt++; refreshUI(); return true;
}
function demolish(x,y){
  const b=tileAt(x,y)?.b; if (!b) return false;
  if (b.type==="road" && b.main) { emitToast("驿道不可拆除","bad"); return false; }
  const d=BUILD[b.type];
  if(!destroyBuilding(x,y))return false;
  for (const [kind,n] of Object.entries(d.cost||{})) {
    // Never truncate existing overflow from a chapter reward.
    const room=Math.max(0,resourceCapacity(kind)-(S.goods[kind]||0));
    S.goods[kind]=(S.goods[kind]||0)+Math.min(room,Math.floor(n*0.5));
  }
  emitLog("拆除了"+d.name+"，回收一半建材；存货与预付原料由运输队送回货栈。"); refreshUI(); return true;
}
/* Moving an existing building is a deliberate, affordable correction to a city plan. */
function canMoveBuilding(fromX,fromY,toX,toY){
  const b=tileAt(fromX,fromY)?.b;
  if (!b) return {ok:false,why:"没有可迁移的建筑"};
  if (b.type==="road") return {ok:false,why:"道路请使用铺路与拆除工具调整"};
  const d=BUILD[b.type],[ox,oy]=b.origin||[fromX,fromY];
  if (ox===toX && oy===toY) return {ok:false,why:"请选择新的建筑位置"};
  const placement=canBuildAt(b.type,toX,toY,{ignoreId:b.id});
  if (!placement.ok) return placement;
  if (d.cat!=="decor" && !connectedToMain(toX,toY,d.size)) return {ok:false,why:"迁移目标需要连接主路"};
  const cost=Object.fromEntries(Object.entries(d.cost||{}).map(([kind,n])=>[kind,Math.max(1,Math.ceil(n*0.15))]));
  if (!Object.entries(cost).every(([kind,n])=>(S.goods[kind]||0)>=n)) return {ok:false,why:"迁移建材不足（需要原建造费用的 15%）",cost};
  return {ok:true,cost};
}
function moveBuilding(fromX,fromY,toX,toY){
  const check=canMoveBuilding(fromX,fromY,toX,toY);
  if (!check.ok) { emitToast(check.why,"bad"); return false; }
  const b=tileAt(fromX,fromY).b,d=BUILD[b.type],[ox,oy]=b.origin;
  // Clear first so moving a 2×2 structure by one tile can safely overlap its old footprint.
  for (const [, ,t] of footprint(ox,oy,d.size)) if (t.b?.id===b.id) t.b=null;
  b.origin=[toX,toY];
  for (const [, ,t] of footprint(toX,toY,d.size)) t.b=b;
  for (const [kind,n] of Object.entries(check.cost)) S.goods[kind]-=n;
  invalidateWorld(); allocateWorkers(buildings()); updateCaps();
  emitLog("迁移了"+d.name+"，保留原有等级、居民与建设进度。");
  emitToast(d.name+"迁移完成","good"); refreshUI(); return true;
}
function tradePrice(kind,direction="buy"){
  if (!TRADE_PRICES[kind]) return 0;
  const harbor=buildings().some(o=>o.b.type==="harbor" && operational(o));
  const persian=S.civilization==="persia";
  const wind=persian && hasActiveLandmark();
  return direction==="sell" ? TRADE_PRICES[kind]*0.55*(persian?1.2:1)*(harbor?1.15:1) : TRADE_PRICES[kind]*(persian?0.8:1)*(harbor?0.85:1)*(wind?0.9:1);
}
function tradeGoods(kind,quantity,direction="buy"){
  quantity=Math.floor(Number(quantity));
  if (!GOODS[kind] || !Number.isFinite(quantity) || quantity<=0 || quantity>10000 || !["buy","sell"].includes(direction)) return {ok:false,why:"交易参数无效"};
  const price=tradePrice(kind,direction),total=price*quantity;
  if (direction==="buy") {
    if (S.gold+1e-9<total) return {ok:false,why:"金币不足"};
    if (S.goods[kind]+quantity>resourceCapacity(kind)) return {ok:false,why:"仓储空间不足，请建造仓库"};
    S.gold=Math.max(0,S.gold-total); S.goods[kind]+=quantity;
  } else {
    if (S.goods[kind]<quantity) return {ok:false,why:"可出售的商品不足"};
    S.goods[kind]-=quantity; S.gold+=total;
  }
  emitLog((direction==="buy"?"购入":"售出")+quantity+" 单位"+GOODS[kind].name+"，"+Math.round(total)+" 金币。");
  refreshUI(); return {ok:true,total,quantity,price};
}
function winGame(){
  if (S.won) return;
  S.won=true;
  emitLog(getCivilization().wonderName+"落成！你已达成文明胜利，城市仍可继续发展。","good");
  if (_quietSimulation || typeof modal!=="function") return;
  if (typeof setSpeed==="function") setSpeed(0);
  modal({em:"🏛️",title:getCivilization().wonderName+"落成",body:"<p>经过 <b>"+S.tick+"</b> 分钟经营时间，你的城邦完成了文明奇观。</p><p>最高人口 <b>"+Math.floor(S.stats.maxPop)+"</b> · 累计税收 <b>"+Math.floor(S.stats.taxed)+"</b> · 新建建筑 <b>"+S.stats.totalBuilt+"</b> 座。</p><p>继续扩建你的城市，或让一个新文明写下下一段历史。</p>",buttons:[{text:"继续经营",primary:true,fn:()=>{if(typeof setSpeed==="function")setSpeed(1);}}]});
}

/* A single monotonic wall-clock watermark avoids frame-rate and repeated-load rewards.
   Campaign pause is a visual pause; explicit suspended transactions consume time without rewards. */
function createCityClock(nowMs=Date.now()){
  const now=Number(nowMs);return {version:1,lastWallMs:Number.isFinite(now)?now:Date.now(),elapsedSeconds:0,accumulatorSeconds:0};
}
function step(seconds,options={}){
  if(!S)return null;
  seconds=Number(seconds);if(!Number.isFinite(seconds)||seconds<=0)return null;
  seconds=Math.min(seconds,OFFLINE_CONSTRUCTION_SECONDS);
  S.clock??=createCityClock();
  const before={...S.goods,gold:S.gold,pop:S.pop},startTick=S.tick;
  const previousQuiet=_quietSimulation;_quietSimulation=previousQuiet||!!options.silent;
  try{
    if(options.constructionOnly){
      advanceConstruction(buildings(),seconds);S.clock.elapsedSeconds+=seconds;
      allocateWorkers(buildings());updateCaps();checkTasks();
    }else{
      let remaining=seconds;
      while(remaining>1e-8){
        const part=Math.min(remaining,ECONOMY_STEP_SECONDS-S.clock.accumulatorSeconds);
        advanceLogistics(part);advanceConstruction(buildings(),part);S.clock.elapsedSeconds+=part;S.clock.accumulatorSeconds+=part;remaining-=part;
        if(S.clock.accumulatorSeconds+1e-8>=ECONOMY_STEP_SECONDS){S.clock.accumulatorSeconds=0;economyMinute();}
      }
    }
  }finally{_quietSimulation=previousQuiet;}
  if(S.tick!==startTick){
    S.lastDelta=Object.fromEntries([...Object.keys(GOODS),"gold","pop"].map(k=>[k,(k==='gold'?S.gold:k==='pop'?S.pop:S.goods[k])-(before[k]||0)]));
    S.lastDeltaSeconds=(S.tick-startTick)*ECONOMY_STEP_SECONDS;
  }
  return {seconds,economySeconds:(S.tick-startTick)*ECONOMY_STEP_SECONDS,ticks:S.tick-startTick};
}
const stepSimulation=step;
function advanceClock(nowMs=Date.now(),options={}){
  if(!S)return null;
  S.clock??=createCityClock(nowMs);
  const now=Number(nowMs),last=S.clock.lastWallMs;
  if(!Number.isFinite(now)||now<=last)return {seconds:0,economySeconds:0,constructionSeconds:0};
  const elapsed=(now-last)/1000;S.clock.lastWallMs=now;
  if(options.suspended)return {seconds:elapsed,economySeconds:0,constructionSeconds:0,suspended:true};
  const requested=Number(options.speed??(typeof speed==='number'?speed:1));
  const multiplier=S.mode==='sandbox'&&!options.offline?Math.max(0,Math.min(60,Number.isFinite(requested)?requested:1)):1;
  const economic=Math.min(elapsed*multiplier,OFFLINE_ECONOMY_SECONDS);
  const construction=Math.min(elapsed*multiplier,OFFLINE_CONSTRUCTION_SECONDS);
  // Avoid per-second loops: at most 480 minute steps for an eight-hour absence.
  if(economic>0)step(economic,{silent:!!options.offline});
  if(construction>economic)step(construction-economic,{constructionOnly:true,silent:!!options.offline});
  const summary={seconds:elapsed,economySeconds:economic,constructionSeconds:construction,capped:elapsed>OFFLINE_ECONOMY_SECONDS};
  if(options.offline)S.offlineSummary=summary;
  return summary;
}
function simulate(){return advanceClock(Date.now());}
function productionProgress(b){
  if(!b.production)return {elapsed:0,duration:BUILD[b.type]?.cycleSeconds||0,progress:0};
  const p=b.production,d=BUILD[b.type],o={x:b.origin?.[0],y:b.origin?.[1],b};
  const active=!b.idle&&Number.isInteger(o.x)&&operational(o)&&Object.entries(d.prod).every(([kind,n])=>resourceCapacity(kind)-(S.goods[kind]||0)-goodsInTransit(kind)+1e-9>=n*(p.duration/60)*p.multiplier);
  const extra=active?(S.clock?.accumulatorSeconds||0):0,elapsed=Math.min(p.duration,p.elapsed+extra);
  return {elapsed,duration:p.duration,progress:elapsed/p.duration};
}

/* Compact, explicit snapshot. Rehydration never trusts duplicated JSON object references. */
function serializeState(){
  if (!S) return null;
  const memo=new Map();
  const tiles=S.tiles.map(row=>row.map(t=>{
    let b=null;
    if (t.b) {
      if (!memo.has(t.b.id)) { const {met,...rest}=t.b; memo.set(t.b.id,{...rest,...(rest.stock?{stock:{...rest.stock}}:{}),...(rest.construction?{construction:{...rest.construction}}:{}),...(rest.production?{production:{...rest.production}}:{})}); }
      b=memo.get(t.b.id);
    }
    return {t:t.t,b,variant:t.variant||0};
  }));
  return {...S,logistics:logisticsSnapshot(),clock:{...S.clock},goods:{...S.goods},caps:{...S.caps},stats:{...S.stats},lastDelta:{...S.lastDelta},
    taskDone:S.taskDone.map(row=>row.slice()),chapterCompleted:S.chapterCompleted.slice(),start:{...S.start},signpost:{...S.signpost},
    ...(S.offlineSummary?{offlineSummary:{...S.offlineSummary}}:{}),version:SAVE_VERSION,uid,tiles,log:(S.log||[]).slice(-80)};
}
function hydrateState(data,options={}){
  const previous={state:S,width:MAP_W,height:MAP_H,uid,pendingSave};
  try{
  if (!data || !Array.isArray(data.tiles) || data.tiles.length<8 || data.tiles.length>96) return false;
  const now=Number.isFinite(Number(options.nowMs))?Number(options.nowMs):Date.now();
  const modernClock=data.clock?.version===1&&Number.isFinite(data.clock.lastWallMs);
  const timerScale=modernClock?1:60;
  const oldH=data.tiles.length,oldW=data.tiles[0]?.length;
  if (!Number.isInteger(oldW) || oldW<8 || oldW>96 || data.tiles.some(row=>!Array.isArray(row)||row.length!==oldW)) return false;
  const numeric=(v,fallback=0,max=1e9)=>Number.isFinite(Number(v))?Math.min(max,Math.max(0,Number(v))):fallback;
  const width=Math.max(64,oldW),height=Math.max(64,oldH);
  const civilization=Object.hasOwn(CIVILIZATIONS,data.civilization)?data.civilization:"china";
  const seed=String(data.seed??"legacy-city").slice(0,64);
  const tiles=generateTerrain(seed,civilization,width,height),byId=new Map(),candidates=[];
  // Retired identities remain retired even when their footprint has been removed.
  let nextUid=Math.floor(numeric(data.uid,0,1e9));
  for (let y=0;y<oldH;y++) for (let x=0;x<oldW;x++) {
    const source=data.tiles[y][x]||{};
    tiles[y][x]={t:TERRAIN[source.t]?source.t:"grass",b:null,variant:Math.floor(numeric(source.variant,0,3))};
    const raw=source.b;
    if (!raw || !Object.hasOwn(BUILD,raw.type)) continue;
    const validOrigin=Array.isArray(raw.origin)&&raw.origin.length===2&&raw.origin.every(Number.isInteger);
    // Multitile duplicates are skipped by origin first, then by persistent id.
    if (validOrigin && (raw.origin[0]!==x || raw.origin[1]!==y)) continue;
    const id=Number.isInteger(raw.id)&&raw.id>0?raw.id:++nextUid;
    if (byId.has(id)) continue;
    nextUid=Math.max(nextUid,id);
    const b={type:raw.type,id,origin:[x,y],staffed:false};
    if (raw.main && b.type==="road") b.main=true;
    if (isResidence(b)) {
      b.lvl=Math.floor(numeric(raw.lvl,1,residenceLevels(b).length))||1;
      b.pop=numeric(raw.pop,0,residenceLevel(b).pop); b.taxTimer=numeric(Number(raw.taxTimer)*timerScale,0,TAX_INTERVAL);
      b.upTimer=numeric(Number(raw.upTimer)*timerScale,0,UPGRADE_DELAY); b.missTicks=numeric(Number(raw.missTicks)*timerScale,0,NEED_GRACE_SECONDS);
      b.water=numeric(raw.water,0,100000);
    }
    if(BUILD[b.type].shop||BUILD[b.type].shopAll)b.stock=Object.fromEntries(Object.keys(GOODS).filter(k=>Number(raw.stock?.[k])>0).map(k=>[k,numeric(raw.stock[k])]));
    if (raw.damage) b.damage=numeric(Number(raw.damage)*timerScale,0,3600);
    if (raw.productionTicks) b.productionTicks=Math.floor(numeric(raw.productionTicks,0,1e9));
    if(modernClock&&raw.production&&BUILD[b.type].prod){
      const duration=BUILD[b.type].cycleSeconds;
      b.production={duration,elapsed:numeric(raw.production.elapsed,0,duration),multiplier:Math.max(.1,numeric(raw.production.multiplier,1,4))};
    }
    if (raw.construction && b.type!=="road") {
      const upgrading=isResidence(b)&&raw.construction.toLevel===b.lvl+1&&raw.construction.toLevel<=residenceLevels(b).length;
      const rawTotal=Math.max(1,numeric(raw.construction.total,BUILD[b.type].buildTime,OFFLINE_CONSTRUCTION_SECONDS));
      const total=modernClock?rawTotal:constructionDuration(b.type,upgrading?b.lvl:0,civilization);
      const fraction=numeric(raw.construction.remaining,rawTotal,rawTotal)/rawTotal;
      b.construction={total,remaining:Math.max(.001,total*fraction)};
      if(upgrading)Object.assign(b.construction,{fromLevel:b.lvl,toLevel:b.lvl+1});
    }
    byId.set(id,b); candidates.push(b);
  }
  for (const b of candidates) {
    const [x,y]=b.origin,size=BUILD[b.type].size;
    if (x<0 || y<0 || x+size>width || y+size>height) continue;
    let occupied=false;
    for (let dy=0;dy<size;dy++) for (let dx=0;dx<size;dx++) if (tiles[y+dy][x+dx].b) occupied=true;
    if (occupied) continue;
    for (let dy=0;dy<size;dy++) for (let dx=0;dx<size;dx++) tiles[y+dy][x+dx].b=b;
  }
  const goods=Object.fromEntries(Object.keys(GOODS).map(k=>[k,numeric(data.goods?.[k])]));
  const chapter=Math.floor(numeric(data.chapter,0,CHAPTERS.length-1));
  const point=(p,fallback)=>p&&Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.y>=0&&p.x<width&&p.y<height?{x:p.x,y:p.y}:fallback;
  const state={
    clock:modernClock?{version:1,lastWallMs:numeric(data.clock.lastWallMs,now,9e15),elapsedSeconds:numeric(data.clock.elapsedSeconds,0,1e12),accumulatorSeconds:numeric(data.clock.accumulatorSeconds,0,59.999999)}:{...createCityClock(now),elapsedSeconds:numeric(data.tick)*60},
    version:SAVE_VERSION,civilization,seed,rngState:numeric(data.rngState,hashSeed(seed),4294967295),
    cityName:String(data.cityName||getCivilization(civilization).cityNames[0]).slice(0,24),mode:data.mode==="sandbox"?"sandbox":"campaign",
    tick:Math.floor(numeric(data.tick)),goods,gold:numeric(data.gold),prestige:numeric(data.prestige,45,100),chapter,
    taskDone:CHAPTERS.map((c,i)=>c.tasks.map((_,j)=>!!data.taskDone?.[i]?.[j])),
    chapterCompleted:CHAPTERS.map((_,i)=>i<chapter || !!data.chapterCompleted?.[i]),
    stats:{taxed:numeric(data.stats?.taxed),maxPop:numeric(data.stats?.maxPop),totalBuilt:numeric(data.stats?.totalBuilt),disasters:numeric(data.stats?.disasters)},
    log:Array.isArray(data.log)?data.log.slice(-80):[],won:!!data.won,tiles,
    signpost:point(data.signpost,{x:oldW-1,y:0}),start:point(data.start,{x:oldW<64?Math.max(2,oldW-5):49,y:oldH<64?5:14}),
    workersAssigned:0,pop:0,caps:{food:500,mat:600},lastDelta:Object.fromEntries([...Object.keys(GOODS),"gold","pop"].map(k=>[k,0])),
  };
  MAP_W=width; MAP_H=height; S=state; uid=nextUid;
  invalidateWorld();
  _logisticsRouteChecks.clear();hydrateLogistics(data.logistics);
  for(const job of S.logistics.jobs)uid=Math.max(uid,job.sourceId,job.targetId);
  S.pop=buildings().reduce((sum,o)=>sum+(isResidence(o.b)?o.b.pop||0:0),0);
  allocateWorkers(buildings()); updateCaps(); pendingSave=S.tick;
  if(modernClock&&options.applyOffline!==false)advanceClock(now,{offline:true});
  return true;
  }catch{
    S=previous.state;MAP_W=previous.width;MAP_H=previous.height;uid=previous.uid;pendingSave=previous.pendingSave;
    _roadDirty=true;_roadNet=null;_buildingCache=null;_buildingIdCache=null;_serviceCache=null;_roadRevision++;
    _connectivityCache.clear();_logisticsRouteChecks.clear();
    return false;
  }
}
const normalizeState=hydrateState;
