"use strict";
/* Deterministic city simulation. Rendering and network services are optional consumers. */
let _roadNet = null, _roadDirty = true, _buildingCache = null;
const inB = (x,y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < MAP_W && y >= 0 && y < MAP_H;
const tileAt = (x,y) => S && inB(x,y) ? S.tiles[y][x] : null;
const isResidence = b => b && (b.type === "house" || b.type === "villa");
const isComplete = b => !b.construction || !!b.construction.fromLevel;

function emitToast(message, kind){ if (typeof toast === "function") toast(message, kind); }
function emitLog(message, kind){ if (typeof log === "function") log(message, kind); }
function refreshUI(){ if (typeof renderAll === "function") renderAll(); }
function invalidateWorld(){
  _buildingCache = null;
  _roadDirty = true;
  if (typeof window !== "undefined" && typeof window.invalidateRenderer === "function") window.invalidateRenderer();
}
function markRoadDirty(){ _roadDirty = true; _buildingCache = null; }
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
function generateTerrain(seed, civilization = "china", width = MAP_W, height = MAP_H){
  const rng = seededRandom(hashSeed(seed));
  const arid = civilization === "egypt" || civilization === "persia";
  const tiles = Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>{
    const river = width * 0.29 + Math.sin(y * 0.12) * 3 + Math.sin(y * 0.31) * 1.3;
    const distance = Math.abs(x - river);
    const lake = ((x-width*0.72)/7)**2 + ((y-height*0.72)/5)**2;
    let t = "grass";
    if (distance < 1.7 || lake < 1) t = "water";
    else if (distance < 2.7 || (lake < 1.3) || (arid && rng() < 0.38)) t = "sand";
    else {
      const woodland = Math.sin(x*0.31) + Math.cos(y*0.27) + Math.sin((x+y)*0.16);
      if (woodland > 0.8 && rng() < 0.7) t = "tree";
      else if (rng() < 0.025) t = rng() < 0.48 ? "stone" : rng() < 0.7 ? "clay" : "copper";
    }
    return {t,b:null,variant:Math.floor(rng()*4)};
  }));
  // Clusters make 2×2 extractors legible at a glance and guarantee all raw materials.
  const patches = [[8,10,"stone"],[30,9,"clay"],[35,38,"copper"],[10,43,"tree"],[55,47,"stone"],[38,52,"clay"],[54,36,"copper"]];
  for (const [px,py,kind] of patches) for (let dy=0;dy<4;dy++) for (let dx=0;dx<4;dx++) {
    if (tiles[py+dy] && tiles[py+dy][px+dx] && tiles[py+dy][px+dx].t !== "water") tiles[py+dy][px+dx].t = kind;
  }
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
    cityName:String(options.cityName || civ.cityNames[0]).trim().slice(0,24) || civ.cityNames[0], mode,
    tick:0,pop:12,workersAssigned:6,goods,caps:{food:500,mat:600},gold:mode === "sandbox" ? 50000 : 350,
    prestige:48,chapter:0,taskDone:CHAPTERS.map(c=>c.tasks.map(()=>false)),
    chapterCompleted:CHAPTERS.map(()=>false),tiles:generateTerrain(seed,civilization),log:[],
    stats:{taxed:0,maxPop:12,totalBuilt:0,disasters:0},won:false,
    signpost:{x:63,y:0},start:{x:49,y:14},lastDelta:Object.fromEntries([...Object.keys(GOODS),"gold","pop"].map(k=>[k,0])),
  };
  invalidateWorld();
  // A broad, buildable meadow prevents terrain from trapping the tutorial settlement.
  for (let y=6;y<=29;y++) for (let x=38;x<=60;x++) S.tiles[y][x].t = "grass";
  for (let x=0;x<MAP_W;x++) setRoad(x,0,true);
  for (let y=1;y<MAP_H;y++) setRoad(MAP_W-1,y,true);
  for (let y=1;y<=28;y++) setRoad(50,y);
  for (let x=42;x<=57;x++) setRoad(x,14);
  const patch = (x,y,t) => { for(let dy=0;dy<3;dy++) for(let dx=0;dx<2;dx++) tileAt(x+dx,y+dy).t=t; };
  patch(48,22,"tree"); patch(51,22,"stone"); patch(51,26,"clay"); patch(54,25,"copper");
  // A small lake supports the fishing/harbor stages without a long trip to the river.
  for (let y=18;y<=22;y++) for (let x=57;x<=60;x++) tileAt(x,y).t = "water";
  const a = put(47,13,"house"), b = put(49,13,"house");
  a.pop = b.pop = 6;
  put(45,15,"farmland"); put(48,22,"lumber");
  put(44,13,"treeDeco"); put(53,13,"treeDeco");
  updateCaps(); allocateWorkers(buildings());
  emitLog("欢迎来到" + S.cityName + "。驿道连接远方，先在住宅旁修建一口水井。","good");
  emitLog("保持道路连通；绿色预览可建造。商铺隔着同一条道路成对放置，居民才会收到商品。");
  if (mode === "sandbox") emitLog("自由建造：全部建筑已解锁，拥有充足物资；人口、生产和道路规则依然有效。","good");
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
  const net=roadNetwork(), fp=footprint(x,y,size); if (!fp) return false;
  return fp.some(([cx,cy,t])=>(t.b?.type==="road" && net[cy][cx]) || DIRS.some(([dx,dy])=>inB(cx+dx,cy+dy) && net[cy+dy][cx+dx]));
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
  for (const o of buildings()) {
    const d=BUILD[o.b.type];
    if (!providedNeeds(o.b.type).includes(need) || !operational(o)) continue;
    if (distanceToBuilding(x,y,o) <= (d.radius||0)) return o;
  }
  return null;
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
  let pollution=0;
  for (const o of buildings()) if (POLLUTERS.includes(o.b.type) && operational(o) && distanceToBuilding(x,y,o)<=2) pollution++;
  return pollution;
}
function beautyAt(x,y){
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
  return beauty;
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
}
function updateCaps(){
  const active=type=>buildings().filter(o=>o.b.type===type && operational(o)).length;
  const mult=civilizationBonus("storage");
  const base=S.mode==="sandbox"?10000:0;
  S.caps={food:Math.round((500+active("granary")*400+base)*mult),mat:Math.round((600+active("warehouse")*500+base)*mult)};
}
function resourceCapacity(kind){ return GOODS[kind]?.cat==="food" ? S.caps.food : S.caps.mat; }
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
function advanceConstruction(bl){
  for (const o of bl) {
    const b=o.b,d=BUILD[b.type];
    if (b.damage) b.damage=Math.max(0,b.damage-(coveredBy(o.x,o.y,"repair")?3:1));
    if (!b.construction) continue;
    b.staffed=false;
    if (d.cat!=="decor" && !connectedToMain(o.x,o.y,d.size)) { b.idle=true; continue; }
    b.idle=false; b.construction.remaining--;
    if (b.construction.remaining>0) continue;
    if (b.construction.toLevel) {
      b.lvl=b.construction.toLevel; b.missTicks=0;
      emitToast(d.name+"升至 "+b.lvl+" 级","good");
    } else if (d.cat!=="decor") emitToast(d.name+"已建成","good");
    delete b.construction;
    if (b.type==="wonder") winGame();
    if (typeof window!=="undefined" && typeof window.invalidateRenderer==="function") window.invalidateRenderer();
  }
}
function simulate(){
  if (!S) return;
  const before={...S.goods,gold:S.gold,pop:S.pop};
  S.tick++;
  const bl=buildings();
  advanceConstruction(bl);
  S.pop=bl.reduce((sum,o)=>sum+(isResidence(o.b)?o.b.pop||0:0),0);
  allocateWorkers(bl); updateCaps();
  // Debit each factory's inputs immediately: two factories can never spend the same clay.
  for (const o of bl) {
    const d=BUILD[o.b.type];
    if (!d.prod) continue;
    if (!operational(o)) { o.b.idle=true; continue; }
    if (d.input && Object.entries(d.input).some(([kind,n])=>(S.goods[kind]||0)<n)) { o.b.idle=true; continue; }
    const mult=productionMultiplier(o);
    const room=Math.min(1,...Object.entries(d.prod).map(([kind,n])=>Math.max(0,resourceCapacity(kind)-(S.goods[kind]||0))/(n*mult)));
    if (room<=0) { o.b.idle=true; continue; }
    o.b.idle=false;
    if (d.input) for (const [kind,n] of Object.entries(d.input)) S.goods[kind]-=n*room;
    for (const [kind,n] of Object.entries(d.prod)) S.goods[kind]=Math.min(resourceCapacity(kind),(S.goods[kind]||0)+n*mult*room);
  }
  const consumption=Object.fromEntries(Object.keys(GOODS).map(k=>[k,0]));
  const residences=bl.filter(o=>isResidence(o.b));
  for (const o of residences) {
    const h=o.b;
    if (!isComplete(h)) continue;
    const met=evaluateNeeds(o); h.met=met;
    let cur=residenceLevel(h);
    if (!h.construction) {
      if (met.canUpgrade && (h.pop||0)>=cur.pop*0.9) {
        h.upTimer=(h.upTimer||0)+1;
        if (h.upTimer>=UPGRADE_DELAY) {
          const total=Math.max(4,Math.round((6+h.lvl*2)*civilizationBonus("construction")));
          h.construction={remaining:total,total,fromLevel:h.lvl,toLevel:h.lvl+1}; h.upTimer=0; h.missTicks=0;
        }
      } else h.upTimer=0;
      if (!met.currentOk && h.lvl>1) {
        h.missTicks=(h.missTicks||0)+1;
        if (h.missTicks>=45) {
          h.lvl--; h.missTicks=0; cur=residenceLevel(h); h.pop=Math.min(h.pop,cur.pop);
          emitLog(BUILD[h.type].name+"的需求持续缺失，降至 "+h.lvl+" 级。","bad");
        }
      } else h.missTicks=Math.max(0,(h.missTicks||0)-2);
      if (met.map.road && S.goods.grain>10 && !h.construction) {
        const rate=Math.max(0.3,cur.pop*0.045*prestigeTier(S.prestige).immig*civilizationBonus("immigration"));
        h.pop=Math.min(cur.pop,(h.pop||0)+rate);
      } else if (!met.map.road || S.goods.grain<=0) h.pop=Math.max(0,(h.pop||0)-Math.max(0.1,cur.pop*0.01));
      if (!h.construction && met.currentOk && h.pop>=cur.pop*0.5) {
        h.taxTimer=(h.taxTimer||0)+1;
        if (h.taxTimer>=TAX_INTERVAL) {
          const bonus=civilizationBonus("tax")*(S.civilization==="greece" && hasActiveLandmark()?1.1:1);
          const tax=cur.tax*bonus; S.gold+=tax; S.stats.taxed+=tax; h.taxTimer=0;
        }
      }
    }
    // Occupants of an upgrading home remain in town and still eat.
    consumption.grain+=(h.pop||0)*0.035;
    for (const kind of ["veg","fruit","fish","meat","pottery","wine","cloth"]) {
      if (cur.needs.includes(kind) && met.map[kind]) consumption[kind]+=(h.pop||0)*(GOODS[kind].cat==="food"?0.006:0.002);
    }
  }
  for (const kind in consumption) S.goods[kind]=Math.max(0,(S.goods[kind]||0)-consumption[kind]);
  for (const o of bl) if (o.b.type==="harbor" && operational(o)) S.gold+=1.5*civilizationBonus("trade");
  S.pop=residences.reduce((sum,o)=>sum+(o.b.pop||0),0);
  // A population decrease can release workers immediately, avoiding a negative labour pool.
  if (S.workersAssigned>Math.floor(S.pop)) allocateWorkers(bl);
  updatePrestige();
  if (S.tick%60===0) hazards(bl);
  checkTasks();
  S.stats.maxPop=Math.max(S.stats.maxPop,S.pop);
  S.lastDelta=Object.fromEntries([...Object.keys(GOODS),"gold","pop"].map(k=>[k,(k==="gold"?S.gold:k==="pop"?S.pop:S.goods[k])-(before[k]||0)]));
}
function evaluateNeeds(o){
  const h=o.b,levels=residenceLevels(h),lvlData=residenceLevel(h),map={};
  map.road=connectedToMain(o.x,o.y,BUILD[h.type].size);
  for (const need of ["water","temple","school","fun","safety","health","security","repair","bath","university","observatory"]) map[need]=!!coveredBy(o.x,o.y,need);
  const shops=buildings().filter(q=>(BUILD[q.b.type].shop || BUILD[q.b.type].shopAll) && operational(q));
  for (const kind of ["grain","veg","fruit","fish","meat"]) {
    map[kind]=(S.goods[kind]||0)>0 && shops.some(q=>{
      const d=BUILD[q.b.type]; return (d.shop===kind || d.shopAll) && distanceToBuilding(o.x,o.y,q)<=d.radius && (d.shopAll || shopPairOk(q));
    });
  }
  map.woodMat=(S.goods.wood||0)>=5; map.stoneMat=(S.goods.stone||0)>=5; map.clayMat=(S.goods.clay||0)>=5;
  for (const kind of ["pottery","wine","cloth"]) map[kind]=(S.goods[kind]||0)>=1;
  const missing=lvlData.needs.filter(n=>!map[n]);
  const next=levels[h.lvl||1], nextMissing=next?next.needs.filter(n=>!map[n]):[];
  const beauty=netBeauty(o.x,o.y), clean=h.type!=="villa" || pollutionAt(o.x,o.y)===0;
  const canUpgrade=!!next && !h.construction && nextMissing.length===0 && beauty>=0 && clean;
  return {map,missing,currentOk:missing.length===0,next,nextMissing,canUpgrade,ok:canUpgrade,beauty,clean};
}
function updatePrestige(){
  const bl=buildings(),res=bl.filter(o=>isResidence(o.b)&&isComplete(o.b));
  const fraction=predicate=>res.length?res.filter(predicate).length/res.length:0;
  let target=55;
  target+=Math.min(12,S.gold/500);
  target+=fraction(o=>!!coveredBy(o.x,o.y,"safety"))*8;
  target+=fraction(o=>!!coveredBy(o.x,o.y,"health"))*6;
  target+=fraction(o=>!!coveredBy(o.x,o.y,"security"))*4;
  target+=fraction(o=>!!coveredBy(o.x,o.y,"school"))*6;
  target+=fraction(o=>!!coveredBy(o.x,o.y,"fun"))*5;
  target+=fraction(o=>netBeauty(o.x,o.y)>0)*8;
  target-=fraction(o=>o.b.met && !o.b.met.currentOk)*20;
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
  victim.b.damage=18; victim.b.staffed=false; S.stats.disasters=(S.stats.disasters||0)+1;
  emitLog(BUILD[victim.b.type].name+"发生小火灾，停工修复中。值更房能预防火灾，修缮所可加速恢复。","bad");
  emitToast("生产建筑受损，正在修复","bad");
}
function destroyBuilding(x,y){
  const b=tileAt(x,y)?.b; if (!b) return false;
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
    const total=Math.max(1,Math.round(d.buildTime*civilizationBonus("construction")));
    b.construction={remaining:total,total};
  }
  S.stats.totalBuilt++; refreshUI(); return true;
}
function demolish(x,y){
  const b=tileAt(x,y)?.b; if (!b) return false;
  if (b.type==="road" && b.main) { emitToast("驿道不可拆除","bad"); return false; }
  const d=BUILD[b.type];
  for (const [kind,n] of Object.entries(d.cost||{})) {
    // Never truncate existing overflow from a chapter reward.
    const room=Math.max(0,resourceCapacity(kind)-(S.goods[kind]||0));
    S.goods[kind]=(S.goods[kind]||0)+Math.min(room,Math.floor(n*0.5));
  }
  destroyBuilding(x,y); emitLog("拆除了"+d.name+"，回收一半建材。"); refreshUI(); return true;
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
  if (typeof modal!=="function") return;
  if (typeof setSpeed==="function") setSpeed(0);
  modal({em:"🏛️",title:getCivilization().wonderName+"落成",body:"<p>经过 <b>"+S.tick+"</b> 个时刻，你的城邦完成了文明奇观。</p><p>最高人口 <b>"+Math.floor(S.stats.maxPop)+"</b> · 累计税收 <b>"+Math.floor(S.stats.taxed)+"</b> · 新建建筑 <b>"+S.stats.totalBuilt+"</b> 座。</p><p>继续扩建你的城市，或让一个新文明写下下一段历史。</p>",buttons:[{text:"继续经营",primary:true,fn:()=>{if(typeof setSpeed==="function")setSpeed(1);}}]});
}

/* Compact, explicit snapshot. Rehydration never trusts duplicated JSON object references. */
function serializeState(){
  if (!S) return null;
  const memo=new Map();
  const tiles=S.tiles.map(row=>row.map(t=>{
    let b=null;
    if (t.b) {
      if (!memo.has(t.b.id)) { const {met,...rest}=t.b; memo.set(t.b.id,{...rest}); }
      b=memo.get(t.b.id);
    }
    return {t:t.t,b,variant:t.variant||0};
  }));
  return {...S,version:SAVE_VERSION,uid,tiles,log:(S.log||[]).slice(-80)};
}
function hydrateState(data){
  if (!data || !Array.isArray(data.tiles) || data.tiles.length<8 || data.tiles.length>96) return false;
  const oldH=data.tiles.length,oldW=data.tiles[0]?.length;
  if (!Number.isInteger(oldW) || oldW<8 || oldW>96 || data.tiles.some(row=>!Array.isArray(row)||row.length!==oldW)) return false;
  const numeric=(v,fallback=0,max=1e9)=>Number.isFinite(Number(v))?Math.min(max,Math.max(0,Number(v))):fallback;
  const width=Math.max(64,oldW),height=Math.max(64,oldH);
  const civilization=Object.hasOwn(CIVILIZATIONS,data.civilization)?data.civilization:"china";
  const seed=String(data.seed??"legacy-city").slice(0,64);
  const tiles=generateTerrain(seed,civilization,width,height),byId=new Map(),candidates=[];
  let nextUid=0;
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
      b.pop=numeric(raw.pop,0,residenceLevel(b).pop); b.taxTimer=numeric(raw.taxTimer,0,TAX_INTERVAL);
      b.upTimer=numeric(raw.upTimer,0,UPGRADE_DELAY); b.missTicks=numeric(raw.missTicks,0,45);
    }
    if (raw.damage) b.damage=numeric(raw.damage,0,60);
    if (raw.construction && b.type!=="road") {
      const total=Math.max(1,Math.floor(numeric(raw.construction.total,BUILD[b.type].buildTime,600)));
      const remaining=Math.max(1,Math.floor(numeric(raw.construction.remaining,total,total)));
      b.construction={total,remaining};
      if (isResidence(b) && raw.construction.toLevel===b.lvl+1 && raw.construction.toLevel<=residenceLevels(b).length) Object.assign(b.construction,{fromLevel:b.lvl,toLevel:b.lvl+1});
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
  S.pop=buildings().reduce((sum,o)=>sum+(isResidence(o.b)?o.b.pop||0:0),0);
  allocateWorkers(buildings()); updateCaps(); pendingSave=S.tick;
  return true;
}
const normalizeState=hydrateState;
