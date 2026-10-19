"use strict";
/* ═══════════════════════════════════════════════════════════════════════
   模拟帝国 MVP — 单机复刻
   ───────────────────────────────────────────────────────────────────────
   依据《模拟帝国》(Sim Empire, TKG Inc.) 的真实机制实现：

   1. 等距网格；地图右上角有路牌（主路），移民由此进入
   2. 道路连通：建筑首次派人需连主路；派满后可“断路”仍继续运作
      （工业/农业不可永久断路）—— 原作核心布局技巧
   3. 商铺必须“同种两座、隔路相对”才能覆盖住宅区
   4. 住宅按等级累加需求：水→粮店+木材→菜店+粘土→水果+石料→…
   5. 声望（prestige）决定移民速度
   6. 工业产生污染，住宅需要美化；分区是必须的
   7. 全局劳动力池；建筑占工，缺工则停摆
   8. 章节任务推进，终局建造奇观

   数值为自行设计（原作具体数值多在图片表格中，未取得）。
   ═══════════════════════════════════════════════════════════════════════ */

/* ── 常量 ─────────────────────────────────────────────── */
const MAP_W = 20, MAP_H = 20;
const TILE_W = 84, TILE_H = 42;
const SAVE_KEY = "sim-empire-mvp-3";
const TICK_MS = 1000;
const TAX_INTERVAL = 30;
const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];

/* ── 地形 ─────────────────────────────────────────────── */
const TERRAIN = {
  grass: { name:"草地" },
  sand:  { name:"沙地" },
  tree:  { name:"林地" },
  stone: { name:"石矿" },
  clay:  { name:"粘土" },
};

/* ── 商品 ─────────────────────────────────────────────── */
const GOODS = {
  grain:    { name:"粮食",   icon:"🌾", cat:"food"  },
  veg:      { name:"蔬菜",   icon:"🥬", cat:"food"  },
  fruit:    { name:"水果",   icon:"🍎", cat:"food"  },
  fish:     { name:"鱼",     icon:"🐟", cat:"food"  },
  meat:     { name:"生肉",   icon:"🥩", cat:"food"  },
  wood:     { name:"木材",   icon:"🪵", cat:"mat"   },
  stone:    { name:"石料",   icon:"🪨", cat:"mat"   },
  clay:     { name:"粘土",   icon:"🧱", cat:"mat"   },
  copper:   { name:"铜矿",   icon:"⛏️", cat:"mat"   },
  brick:    { name:"砖块",   icon:"🧱", cat:"craft" },
  pottery:  { name:"陶器",   icon:"🏺", cat:"craft" },
  cloth:    { name:"布匹",   icon:"🧵", cat:"craft" },
  bread:    { name:"面包",   icon:"🍞", cat:"craft" },
  wine:     { name:"酒",     icon:"🍷", cat:"craft" },
};
const GOODS_ICON = Object.fromEntries(Object.entries(GOODS).map(([k,v])=>[k,v.icon]));

/* ── 建筑 ─────────────────────────────────────────────── */
const BUILD = {
  road: {
    name:"道路", em:"🛤️", size:1, cost:{stone:2}, cat:"road", chapter:1,
    desc:"连接建筑与主路。首次派人必须连通；派人后可拆除而不影响运作。",
  },
  house: {
    name:"住宅", em:"🏠", size:1, cost:{wood:10,stone:5}, cat:"house", chapter:1,
    desc:"普通住宅。满足需求后逐级升级，容纳更多居民。",
  },
  villa: {
    name:"高档住宅", em:"🏡", size:2, cost:{wood:60,stone:50,pottery:20}, cat:"house", chapter:4,
    desc:"占地 2×2，最高 6 级。需要大学、浴场、观象台，且范围内不能有污染。",
  },
  well: {
    name:"水井", em:"⛲", size:1, cost:{wood:15,stone:15}, workers:2, radius:4,
    provides:"water", cat:"municipal", chapter:1,
    desc:"为半径内的住宅供水，同时提供少量美化。",
  },
  watch: {
    name:"值更房", em:"🏮", size:1, cost:{wood:25,stone:20}, workers:2, radius:4,
    provides:"safety", cat:"municipal", chapter:2,
    desc:"防火与防盗覆盖。未覆盖的建筑可能失火或失窃。",
  },
  police: {
    name:"捕快房", em:"🛡️", size:1, cost:{wood:20,stone:20}, workers:2, radius:4,
    provides:"security", cat:"municipal", chapter:2,
    desc:"治安覆盖。未覆盖的住宅人口会流失。",
  },
  clinic: {
    name:"医馆", em:"⚕️", size:1, cost:{wood:30,stone:25}, workers:2, radius:4,
    provides:"health", cat:"municipal", chapter:3,
    desc:"卫生覆盖。疾病会降低住宅等级。",
  },
  repair: {
    name:"修缮所", em:"🔧", size:1, cost:{wood:25,stone:25}, workers:2, radius:4,
    provides:"repair", cat:"municipal", chapter:3,
    desc:"防止建筑塌毁。",
  },
  temple: {
    name:"神庙", em:"⛩️", size:1, cost:{wood:30,stone:40}, workers:2, radius:4,
    provides:"temple", cat:"culture", chapter:3,
    desc:"信仰覆盖。住宅 7 级后需要。",
  },
  school: {
    name:"学堂", em:"📚", size:1, cost:{wood:40,stone:30}, workers:2, radius:4,
    provides:"school", cat:"culture", chapter:4,
    desc:"教育覆盖。住宅 8 级后需要。",
  },
  theater: {
    name:"戏台", em:"🎭", size:1, cost:{wood:45,stone:35}, workers:2, radius:4,
    provides:"fun", cat:"culture", chapter:5,
    desc:"娱乐覆盖。住宅 10 级需要。",
  },
  grainShop: {
    name:"粮店", em:"🍚", size:1, cost:{wood:20,stone:10}, workers:2, radius:5,
    shop:"grain", cat:"commerce", chapter:2,
    desc:"供应粮食。必须与另一座粮店隔着道路相对摆放才能覆盖住宅区。",
  },
  vegShop: {
    name:"菜店", em:"🥬", size:1, cost:{wood:20,stone:10}, workers:2, radius:5,
    shop:"veg", cat:"commerce", chapter:3,
    desc:"供应蔬菜。需成对相对摆放。",
  },
  fruitShop: {
    name:"水果摊", em:"🍎", size:1, cost:{wood:25,stone:15}, workers:2, radius:5,
    shop:"fruit", cat:"commerce", chapter:4,
    desc:"供应水果。需成对相对摆放。",
  },
  fishShop: {
    name:"鱼店", em:"🐟", size:1, cost:{wood:25,stone:15}, workers:2, radius:5,
    shop:"fish", cat:"commerce", chapter:5,
    desc:"供应鱼。需成对相对摆放。",
  },
  meatShop: {
    name:"肉铺", em:"🥩", size:1, cost:{wood:30,stone:20}, workers:2, radius:5,
    shop:"meat", cat:"commerce", chapter:5,
    desc:"供应生肉。需成对相对摆放。",
  },
  farmland: {
    name:"粮田", em:"🌾", size:2, cost:{wood:25}, workers:3, prod:{grain:8}, cat:"agri", chapter:1,
    desc:"2×2，每回合产 8 粮食。需连路才能收成。",
  },
  vegFarm: {
    name:"菜田", em:"🥬", size:2, cost:{wood:25}, workers:3, prod:{veg:6}, cat:"agri", chapter:3,
    desc:"2×2，每回合产 6 蔬菜。",
  },
  orchard: {
    name:"果园", em:"🍎", size:2, cost:{wood:30}, workers:3, prod:{fruit:5}, cat:"agri", chapter:4,
    desc:"2×2，每回合产 5 水果。",
  },
  fishing: {
    name:"渔屋", em:"🎣", size:1, cost:{wood:20}, workers:2, prod:{fish:4}, cat:"agri", chapter:5,
    desc:"每回合产 4 鱼。临水产量 +50%。",
  },
  pasture: {
    name:"牧场", em:"🐄", size:2, cost:{wood:35}, workers:3, prod:{meat:4}, cat:"agri", chapter:5,
    desc:"2×2，每回合产 4 生肉。",
  },
  lumber: {
    name:"伐木场", em:"🪓", size:2, cost:{wood:20,stone:10}, workers:3, prod:{wood:6}, cat:"industry", chapter:1,
    desc:"2×2，每回合产 6 木材。必须建在林地上。",
  },
  quarry: {
    name:"采石场", em:"⛏️", size:2, cost:{wood:25,stone:15}, workers:3, prod:{stone:5}, cat:"industry", chapter:2,
    desc:"2×2，每回合产 5 石料。必须建在石矿上。",
  },
  clayPit: {
    name:"粘土矿", em:"🧱", size:2, cost:{wood:25,stone:15}, workers:3, prod:{clay:5}, cat:"industry", chapter:3,
    desc:"2×2，每回合产 5 粘土。必须建在粘土上。",
  },
  kiln: {
    name:"砖窑", em:"🏭", size:2, cost:{wood:30,stone:25}, workers:3, prod:{brick:3}, input:{clay:3}, cat:"industry", chapter:3,
    desc:"2×2，消耗 3 粘土产出 3 砖块。",
  },
  pottery: {
    name:"陶器坊", em:"🏺", size:2, cost:{wood:35,stone:25}, workers:3, prod:{pottery:3}, input:{clay:3}, cat:"industry", chapter:4,
    desc:"2×2，消耗 3 粘土产出 3 陶器。",
  },
  mill: {
    name:"磨坊", em:"🌀", size:2, cost:{wood:40,stone:30}, workers:3, prod:{bread:3}, input:{grain:4}, cat:"industry", chapter:4,
    desc:"2×2，消耗 4 粮食产出 3 面包。",
  },
  weaver: {
    name:"织坊", em:"🧵", size:2, cost:{wood:35,stone:25}, workers:3, prod:{cloth:2}, input:{veg:4}, cat:"industry", chapter:5,
    desc:"2×2，消耗 4 蔬菜产出 2 布匹。",
  },
  winery: {
    name:"酒坊", em:"🍷", size:2, cost:{wood:40,stone:30}, workers:3, prod:{wine:2}, input:{fruit:4}, cat:"industry", chapter:5,
    desc:"2×2，消耗 4 水果产出 2 酒。",
  },
  granary: {
    name:"粮仓", em:"🏺", size:2, cost:{wood:40,stone:20}, workers:1, cat:"storage", chapter:2,
    desc:"2×2，粮食类储量上限 +200。",
  },
  warehouse: {
    name:"货栈", em:"📦", size:2, cost:{wood:45,stone:25}, workers:1, cat:"storage", chapter:2,
    desc:"2×2，材料类储量上限 +200。",
  },
  treeDeco: {
    name:"树", em:"🌳", size:1, cost:{wood:5}, cat:"decor", chapter:2,
    desc:"美化 1 格半径，抵消污染。",
  },
  garden: {
    name:"花园", em:"🌺", size:2, cost:{wood:20,stone:15}, cat:"decor", chapter:3,
    desc:"2×2，美化 3 格半径，可抵消大片污染。",
  },
  monument: {
    name:"石碑", em:"🗿", size:1, cost:{stone:30}, cat:"decor", chapter:4,
    desc:"美化 2 格半径。",
  },
  barracks: {
    name:"兵营", em:"⚔️", size:2, cost:{wood:60,stone:50}, workers:4, cat:"military", chapter:4,
    desc:"训练士兵。占用人口。",
  },
  wonder: {
    name:"奇观", em:"🏛️", size:3, cost:{wood:400,stone:400,brick:100}, workers:10, cat:"wonder", chapter:6,
    desc:"3×3，文明的巅峰。建成即胜利。",
  },
};

/* 建造面板分类 */
const BUILD_CATS = [
  { key:"house",    name:"住宅", icon:"🏠" },
  { key:"road",     name:"道路", icon:"🛤️" },
  { key:"municipal",name:"市政", icon:"🏛️" },
  { key:"commerce", name:"商铺", icon:"🏪" },
  { key:"agri",     name:"农业", icon:"🌾" },
  { key:"industry", name:"工业", icon:"🏭" },
  { key:"storage",  name:"仓储", icon:"📦" },
  { key:"culture",  name:"文化", icon:"🎭" },
  { key:"decor",    name:"美化", icon:"🌳" },
  { key:"military", name:"军事", icon:"⚔️" },
  { key:"wonder",   name:"奇观", icon:"🏛️" },
];

/* ── 住宅等级需求（逐级累加，来自原作机制） ───────────── */
const HOUSE_LEVELS = [
  { lvl:1,  pop:6,   tax:6,   needs:["road"] },
  { lvl:2,  pop:10,  tax:12,  needs:["road","water"] },
  { lvl:3,  pop:16,  tax:22,  needs:["road","water","grain","woodMat"] },
  { lvl:4,  pop:24,  tax:38,  needs:["road","water","grain","woodMat","veg","clayMat"] },
  { lvl:5,  pop:32,  tax:60,  needs:["road","water","grain","woodMat","veg","clayMat","fruit","stoneMat"] },
  { lvl:6,  pop:42,  tax:92,  needs:["road","water","grain","woodMat","veg","clayMat","fruit","stoneMat","fish"] },
  { lvl:7,  pop:52,  tax:140, needs:["road","water","grain","woodMat","veg","clayMat","fruit","stoneMat","fish","meat","temple"] },
  { lvl:8,  pop:64,  tax:200, needs:["road","water","grain","woodMat","veg","clayMat","fruit","stoneMat","fish","meat","temple","pottery","school"] },
  { lvl:9,  pop:78,  tax:280, needs:["road","water","grain","woodMat","veg","clayMat","fruit","stoneMat","fish","meat","temple","pottery","school","wine"] },
  { lvl:10, pop:96,  tax:400, needs:["road","water","grain","woodMat","veg","clayMat","fruit","stoneMat","fish","meat","temple","pottery","school","wine","cloth","fun"] },
];

const NEED_INFO = {
  road:     { name:"道路连通",   icon:"🛤️" },
  water:    { name:"饮用水",     icon:"💧" },
  grain:    { name:"粮食供应",   icon:"🌾" },
  veg:      { name:"蔬菜供应",   icon:"🥬" },
  fruit:    { name:"水果供应",   icon:"🍎" },
  fish:     { name:"鱼类供应",   icon:"🐟" },
  meat:     { name:"肉类供应",   icon:"🥩" },
  woodMat:  { name:"木材建材",   icon:"🪵" },
  stoneMat: { name:"石料建材",   icon:"🪨" },
  clayMat:  { name:"粘土建材",   icon:"🧱" },
  pottery:  { name:"陶器供应",   icon:"🏺" },
  wine:     { name:"酒水供应",   icon:"🍷" },
  cloth:    { name:"布匹供应",   icon:"🧵" },
  temple:   { name:"神庙覆盖",   icon:"⛩️" },
  school:   { name:"学堂覆盖",   icon:"📚" },
  fun:      { name:"娱乐覆盖",   icon:"🎭" },
  safety:   { name:"安全覆盖",   icon:"🏮" },
  health:   { name:"医疗覆盖",   icon:"⚕️" },
};

/* ── 声望 ─────────────────────────────────────────────── */
const PRESTIGE = [
  { min:-999, name:"愤怒",  icon:"😠", color:"#d05a4a", immig:0.15 },
  { min:0,    name:"失望",  icon:"😞", color:"#c07a4a", immig:0.4  },
  { min:20,   name:"一般",  icon:"😐", color:"#a89060", immig:1.0  },
  { min:45,   name:"喜欢",  icon:"🙂", color:"#b8c46a", immig:1.5  },
  { min:65,   name:"喜爱",  icon:"😊", color:"#8fc56a", immig:2.0  },
  { min:85,   name:"崇敬",  icon:"🤩", color:"#dcb24c", immig:2.6  },
];
function prestigeTier(v){
  let t = PRESTIGE[0];
  for (const p of PRESTIGE) if (v >= p.min) t = p;
  return t;
}

/* ── 章节 ─────────────────────────────────────────────── */
const CHAPTERS = [
  {
    title:"第一章 · 立足", unlock:["house","road","well","farmland","lumber"],
    tasks:[
      { text:"建造 1 口水井（让住宅升级）",  check:s=>count("well")>=1 },
      { text:"至少有 1 座住宅达到 2 级",     check:s=>maxHouseLevel()>=2 },
      { text:"再建 2 座住宅，总数到 4 座",    check:s=>count("house")>=4 },
      { text:"人口达到 30",                check:s=>s.pop>=30 },    ],
    reward:{ wood:100, stone:80 },
  },
  {
    title:"第二章 · 集市", unlock:["grainShop","watch","police","quarry","granary","warehouse","treeDeco"],
    tasks:[
      { text:"建成一对粮店（隔路相对）",  check:s=>shopPairCount("grain")>=1 },
      { text:"建造 1 座值更房",          check:s=>count("watch")>=1 },
      { text:"建造 1 座采石场",          check:s=>count("quarry")>=1 },
      { text:"至少有 1 座住宅达到 3 级",  check:s=>maxHouseLevel()>=3 },
      { text:"人口达到 70",             check:s=>s.pop>=70 },
    ],
    reward:{ wood:200, stone:150 },
  },
  {
    title:"第三章 · 百工", unlock:["clayPit","kiln","vegShop","clinic","repair","temple","vegFarm","garden"],
    tasks:[
      { text:"建造 1 座粘土矿",          check:s=>count("clayPit")>=1 },
      { text:"建造 1 座砖窑",            check:s=>count("kiln")>=1 },
      { text:"建成一对菜店",             check:s=>shopPairCount("veg")>=1 },
      { text:"至少有 2 座住宅达到 5 级",  check:s=>houseLevelCount(5)>=2 },
      { text:"人口达到 160",            check:s=>s.pop>=160 },
    ],
    reward:{ wood:350, stone:300 },
  },
  {
    title:"第四章 · 城邦", unlock:["villa","pottery","mill","orchard","fruitShop","school","monument","barracks"],
    tasks:[
      { text:"建造 1 座陶器坊",          check:s=>count("pottery")>=1 },
      { text:"建成一对水果摊",           check:s=>shopPairCount("fruit")>=1 },
      { text:"至少 1 座住宅达到 8 级",    check:s=>maxHouseLevel()>=8 },
      { text:"人口达到 320",            check:s=>s.pop>=320 },
      { text:"累计税收 3000 金币",       check:s=>s.stats.taxed>=3000 },
    ],
    reward:{ wood:500, stone:450 },
  },
  {
    title:"第五章 · 富庶", unlock:["fishShop","meatShop","fishing","pasture","weaver","winery","theater"],
    tasks:[
      { text:"建成一对鱼店",             check:s=>shopPairCount("fish")>=1 },
      { text:"建成一对肉铺",             check:s=>shopPairCount("meat")>=1 },
      { text:"至少 2 座住宅达到 10 级",   check:s=>houseLevelCount(10)>=2 },
      { text:"声望达到「喜爱」",          check:s=>s.prestige>=65 },
    ],
    reward:{ wood:700, stone:600 },
  },
  {
    title:"第六章 · 奇观", unlock:["wonder"],
    tasks:[
      { text:"建造奇观（3×3）",          check:s=>count("wonder")>=1 },
    ],
    reward:{},
  },
];

/* ── 状态 ─────────────────────────────────────────────── */
let S = null;
let speed = 1;
let selTool = null;
let hover = null;
let timer = null;
let uid = 0;
let buildCat = "house";   // 默认分类
let pendingSave = 0;

const UPGRADE_DELAY = 12;

/* ── DOM ──────────────────────────────────────────────── */
const $ = s => document.querySelector(s);
const cv = $("#cv");
const ctx = cv.getContext("2d");
const mm = $("#minimap");
const mmc = mm ? mm.getContext("2d") : null;

/* ═══════════════════════════════════════════════════════
   初始化
   ═══════════════════════════════════════════════════════ */
function newGame(){
  uid = 0;
  const tiles = [];
  for (let y=0;y<MAP_H;y++){
    const row = [];
    for (let x=0;x<MAP_W;x++){
      let t = "grass";
      const r = Math.random();
      if (r < 0.09) t = "tree";
      else if (r < 0.13) t = "stone";
      else if (r < 0.155) t = "clay";
      row.push({ t, b:null });
    }
    tiles.push(row);
  }

  S = {
    tick:0, pop:0, workersAssigned:0,
    goods:{ grain:120, wood:260, stone:200, clay:0, brick:0, pottery:0,
            veg:0, fruit:0, fish:0, meat:0, cloth:0, bread:0, wine:0, copper:0 },
    caps:{ food:300, mat:400 },
    gold:0, prestige:30, chapter:0,
    taskDone: CHAPTERS.map(c=>c.tasks.map(()=>false)),
    tiles, log:[],
    stats:{ taxed:0, maxPop:0, totalBuilt:0 },
    won:false,
  };

  /* 主路：地图上边与右边（右上角路牌） */
  for (let y=0;y<MAP_H;y++){
    const t = tiles[y][MAP_W-1];
    t.t = "sand"; t.b = { type:"road", main:true, id:++uid };
  }
  for (let x=0;x<MAP_W;x++){
    const t = tiles[0][x];
    t.t = "sand"; t.b = { type:"road", main:true, id:++uid };
  }
  S.signpost = { x: MAP_W-1, y: 0 };

  /* 起始区：右上角清出草地 */
  for (let y=1;y<=9;y++) for (let x=11;x<=18;x++){
    const t = tileAt(x,y);
    if (t && !t.b) t.t = "grass";
  }
  /* 起始伐木场需要一片林地（放在地图下缘，远离住宅区，避免开局就污染） */
  for (let y=12;y<=13;y++) for (let x=12;x<=13;x++) tileAt(x,y).t = "tree";

  /* 主干道 */
  for (let x=13;x<=18;x++) setRoad(x,5);
  for (let y=2;y<=8;y++) setRoad(16,y);

  put(14,4,"house");
  put(18,4,"house");
  /* 粮田 2×2 贴在 y=5 道路南侧 */
  put(13,6,"farmland");
  /* 伐木场 2×2 建在 (12,12)-(13,13) 的林地上 */
  put(12,12,"lumber");
  /* 补路：粮田、伐木场都要接到主路 */
  setRoad(15,6); setRoad(15,7); setRoad(16,6);
  setRoad(14,12); setRoad(14,13); setRoad(15,12); setRoad(15,13);
  for (let y=8;y<=12;y++) setRoad(15,y);

  log("你在荒原上建立了定居点。","good");
  log("右上角的路牌是主路，移民由此进入。");
  log("提示：住宅要连路、供水；商铺必须成对相对摆放。");
  renderAll();
  save();
}

const inB = (x,y)=> x>=0 && x<MAP_W && y>=0 && y<MAP_H;
const tileAt = (x,y)=> inB(x,y) ? S.tiles[y][x] : null;

function put(x,y,type){
  const d = BUILD[type];
  const fp = footprint(x,y,d.size);
  if (!fp) return null;
  for (const [, ,t] of fp) if (t.b) return null;
  const b = { type, id:++uid, origin:[x,y] };
  if (isResidence(b)){ b.lvl=1; b.pop=0; b.taxTimer=0; }
  for (const [, ,t] of fp) t.b = b;
  return b;
}
function setRoad(x,y){
  const t = tileAt(x,y);
  if (!t || t.b) return;
  t.b = { type:"road", id:++uid };
}

/* ═══════════════════════════════════════════════════════
   查询
   ═══════════════════════════════════════════════════════ */
function footprint(x,y,size){
  const out = [];
  for (let dy=0;dy<size;dy++) for (let dx=0;dx<size;dx++){
    const t = tileAt(x+dx,y+dy);
    if (!t) return null;
    out.push([x+dx,y+dy,t]);
  }
  return out;
}

function buildings(){
  const out = [];
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const b = S.tiles[y][x].b;
    if (b && b.id && (!b.origin || (b.origin[0]===x && b.origin[1]===y))){
      out.push({ x, y, b, tile:S.tiles[y][x] });
    }
  }
  return out;
}
const count = type => buildings().filter(o=>o.b.type===type).length;
const isResidence = b => b.type==="house" || b.type==="villa";
const maxHouseLevel = () => Math.max(0, ...buildings().filter(o=>isResidence(o.b)).map(o=>o.b.lvl||1));
const houseLevelCount = lvl => buildings().filter(o=>isResidence(o.b) && (o.b.lvl||1)>=lvl).length;

/* ── 道路连通 ─────────────────────────────────────────── */
let _roadNet = null, _roadDirty = true;
function roadNetwork(){
  if (!_roadDirty && _roadNet) return _roadNet;
  const seen = Array.from({length:MAP_H},()=>new Array(MAP_W).fill(false));
  const q = [];
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const b = S.tiles[y][x].b;
    if (b && b.type==="road" && b.main){ seen[y][x]=true; q.push([x,y]); }
  }
  while (q.length){
    const [x,y] = q.shift();
    for (const [dx,dy] of DIRS){
      const nx=x+dx, ny=y+dy;
      if (!inB(nx,ny) || seen[ny][nx]) continue;
      const b = S.tiles[ny][nx].b;
      if (b && b.type==="road"){ seen[ny][nx]=true; q.push([nx,ny]); }
    }
  }
  _roadNet = seen;
  return seen;
}
function markRoadDirty(){ _roadDirty = true; }

function touchesRoad(x,y,size){
  const fp = footprint(x,y,size);
  if (!fp) return false;
  for (const [cx,cy] of fp){
    for (const [dx,dy] of DIRS){
      const t = tileAt(cx+dx,cy+dy);
      if (t && t.b && t.b.type==="road") return true;
    }
  }
  return false;
}
function connectedToMain(x,y,size){
  /* 断路（原作核心技巧）：建筑在派人时已连通主路，之后即使把路拆掉，
     只要它仍然派着工人，就继续运作。
     —— 但工业/农业不可断路：原料/产出需要道路才能进出。 */
  const b = tileAt(x,y) && tileAt(x,y).b;
  if (b && b.staffed && b.type !== "road"){
    const d = BUILD[b.type];
    if (d && d.cat !== "industry" && d.cat !== "agri") return true;
  }

  if (!touchesRoad(x,y,size)) return false;
  const net = roadNetwork();
  const fp = footprint(x,y,size);
  for (const [cx,cy] of fp){
    for (const [dx,dy] of DIRS){
      const nx=cx+dx, ny=cy+dy;
      if (inB(nx,ny) && net[ny][nx]) return true;
    }
  }
  return false;
}

/* ── 覆盖 ─────────────────────────────────────────────── */
function coveredBy(x,y,need){
  for (const o of buildings()){
    const d = BUILD[o.b.type];
    if (!d) continue;
    if (d.provides !== need && !(d.shop && d.shop===need)) continue;
    if (d.workers !== undefined && !o.b.staffed) continue;
    const r = d.radius || 0;
    if (Math.max(Math.abs(o.x-x), Math.abs(o.y-y)) <= r) return o;
  }
  return null;
}

/* 商铺必须成对：同种两座在同一行/列，中间夹着一条街道走廊。
   判定不要求“此刻仍有一条路”——玩家可以在派人后拆掉道路（断路），
   配对关系按布局位置保留。 */
function shopsPaired(a, b){
  if (a.x === b.x){
    const y0 = Math.min(a.y,b.y), y1 = Math.max(a.y,b.y);
    if (y1 - y0 < 2 || y1 - y0 > 6) return false;
    for (let y=y0+1;y<y1;y++){
      const t = tileAt(a.x,y);
      if (!t) return false;
      if (t.b && t.b.type !== "road") return false;   // 中间不能是别的建筑
    }
    return true;
  }
  if (a.y === b.y){
    const x0 = Math.min(a.x,b.x), x1 = Math.max(a.x,b.x);
    if (x1 - x0 < 2 || x1 - x0 > 6) return false;
    for (let x=x0+1;x<x1;x++){
      const t = tileAt(x,a.y);
      if (!t) return false;
      if (t.b && t.b.type !== "road") return false;
    }
    return true;
  }
  return false;
}
function shopPairOk(o){
  const d = BUILD[o.b.type];
  if (!d.shop) return true;
  const same = buildings().filter(q=>q.b.type===o.b.type && q.b.staffed);
  for (const q of same){
    if (q.x===o.x && q.y===o.y) continue;
    if (shopsPaired(o,q)) return true;
  }
  return false;
}
function shopPairCount(kind){
  /* 按“布局位置”统计配对，不要求此刻已派人——配对是空间关系，
     派人是随人口增长异步发生的，任务判定不应受其时序影响。 */
  const shops = buildings().filter(o=>BUILD[o.b.type].shop===kind);
  let n = 0;
  const used = new Set();
  for (let i=0;i<shops.length;i++){
    if (used.has(shops[i].b.id)) continue;
    for (let j=i+1;j<shops.length;j++){
      if (used.has(shops[j].b.id)) continue;
      if (shopsPaired(shops[i],shops[j])){
        n++; used.add(shops[i].b.id); used.add(shops[j].b.id); break;
      }
    }
  }
  return n;
}

/* ── 污染 / 美化 ──────────────────────────────────────── */
const POLLUTERS = ["lumber","quarry","clayPit","kiln","pottery","mill","weaver","winery","barracks"];
function pollutionAt(x,y){
  let p = 0;
  for (const o of buildings()){
    if (!POLLUTERS.includes(o.b.type)) continue;
    const r = BUILD[o.b.type].size + 1;
    if (Math.max(Math.abs(o.x-x), Math.abs(o.y-y)) <= r) p++;
  }
  return p;
}
function beautyAt(x,y){
  let b = 0;
  for (const o of buildings()){
    if (o.b.type === "well"){
      if (Math.max(Math.abs(o.x-x),Math.abs(o.y-y)) <= 2) b += 1;
      continue;
    }
    if (BUILD[o.b.type].cat !== "decor") continue;
    const r = o.b.type==="garden" ? 3 : (o.b.type==="monument" ? 2 : 1);
    if (Math.max(Math.abs(o.x-x),Math.abs(o.y-y)) <= r) b += (o.b.type==="garden"?3:1);
  }
  return b;
}
const netBeauty = (x,y) => beautyAt(x,y) - pollutionAt(x,y);

/* ═══════════════════════════════════════════════════════
   模拟
   ═══════════════════════════════════════════════════════ */
function simulate(){
  if (!S || S.won) return;
  S.tick++;

  const bl = buildings();

  /* 1. 劳动力 */
  const prio = { industry:0, agri:0, storage:1, municipal:2, culture:3, commerce:4, military:5, wonder:6 };
  const workList = bl.filter(o=>{
    const d = BUILD[o.b.type];
    return d.workers && o.b.type !== "road";
  }).sort((a,b)=>(prio[BUILD[a.b.type].cat]??5)-(prio[BUILD[b.b.type].cat]??5));

  let avail = Math.floor(S.pop);
  S.workersAssigned = 0;
  for (const o of workList){
    const need = BUILD[o.b.type].workers || 0;
    if (o.b.staffed){
      avail -= need; S.workersAssigned += need;
      continue;
    }
    if (avail >= need && connectedToMain(o.x,o.y,BUILD[o.b.type].size)){
      avail -= need; o.b.staffed = true; S.workersAssigned += need;
    } else {
      o.b.staffed = false;
    }
  }
  if (avail < 0){
    for (const o of [...workList].reverse()){
      if (avail >= 0) break;
      if (!o.b.staffed) continue;
      const need = BUILD[o.b.type].workers || 0;
      o.b.staffed = false;
      avail += need;
      S.workersAssigned -= need;
    }
  }

  /* 2. 生产 */
  const prod = {}, consume = {};
  for (const o of bl){
    const d = BUILD[o.b.type];
    if (!d.prod || !o.b.staffed) continue;
    if (!connectedToMain(o.x,o.y,d.size)) continue;
    if (d.input){
      let ok = true;
      for (const k in d.input) if ((S.goods[k]||0) < d.input[k]) ok = false;
      if (!ok){ o.b.idle = true; continue; }
      o.b.idle = false;
      for (const k in d.input) consume[k] = (consume[k]||0) + d.input[k];
    }
    let mult = 1;
    if (o.b.type==="lumber" && o.tile.t==="tree") mult += 0.25;
    if (o.b.type==="quarry" && o.tile.t==="stone") mult += 0.25;
    for (const k in d.prod) prod[k] = (prod[k]||0) + d.prod[k]*mult;
  }

  /* 3. 结算 */
  for (const k in consume) S.goods[k] = Math.max(0, (S.goods[k]||0) - consume[k]);
  for (const k in prod){
    const cap = GOODS[k].cat === "food" ? S.caps.food : S.caps.mat;
    S.goods[k] = Math.min(cap, (S.goods[k]||0) + prod[k]);
  }
  S.caps.food = 300 + count("granary")*200;
  S.caps.mat  = 400 + count("warehouse")*200;

  /* 4. 住宅 */
  const res = bl.filter(o=>isResidence(o.b));
  let demand = 0;

  for (const o of res){
    const h = o.b;
    const met = evaluateNeeds(o);
    h.met = met;

    if (met.canUpgrade){
      const full = (h.pop||0) >= HOUSE_LEVELS[h.lvl-1].pop*0.9;
      if (full){
        h.upTimer = (h.upTimer||0)+1;
        if (h.upTimer >= UPGRADE_DELAY){
          h.lvl++; h.upTimer = 0; h.missTicks = 0;
          toast("住宅升级至 " + h.lvl + " 级","good");
        }
      } else h.upTimer = 0;
      h.missTicks = Math.max(0,(h.missTicks||0)-1);
    } else if (!met.currentOk && h.lvl > 1){
      h.upTimer = 0;
      h.missTicks = (h.missTicks||0)+1;
      if (h.missTicks >= 20){
        h.lvl--; h.missTicks = 0;
        log("住宅需求缺失，降至 " + h.lvl + " 级。","bad");
      }
    } else {
      h.upTimer = 0;
      h.missTicks = Math.max(0,(h.missTicks||0)-1);
    }

    const cur = HOUSE_LEVELS[h.lvl-1];
    demand += cur.pop*0.06;

    if (S.goods.grain > 20){
      const rate = Math.max(0.2, cur.pop*0.03*prestigeTier(S.prestige).immig);
      h.pop = Math.min(cur.pop, (h.pop||0)+rate);
    } else if (S.goods.grain <= 0){
      h.pop = Math.max(0, (h.pop||0) - cur.pop*0.015);
    }

    if (met.currentOk && h.pop >= cur.pop*0.6){
      h.taxTimer = (h.taxTimer||0)+1;
      if (h.taxTimer >= TAX_INTERVAL){
        S.gold += cur.tax; S.stats.taxed += cur.tax; h.taxTimer = 0;
      }
    } else h.taxTimer = Math.max(0,(h.taxTimer||0)-1);
  }

  S.pop = res.reduce((a,o)=>a+(o.b.pop||0),0);
  S.goods.grain = Math.max(0, S.goods.grain - demand);

  updatePrestige();
  if (S.tick % 20 === 0) hazards(bl);
  checkTasks();
  if (S.pop > S.stats.maxPop) S.stats.maxPop = S.pop;
}

/* ── 需求 ─────────────────────────────────────────────── */
function evaluateNeeds(o){
  const h = o.b;
  const lvlData = HOUSE_LEVELS[h.lvl-1];
  const map = {};

  map.road = connectedToMain(o.x,o.y,BUILD[h.type].size);
  map.water = !!coveredBy(o.x,o.y,"water");

  const shopOk = (kind)=>{
    for (const q of buildings()){
      if (BUILD[q.b.type].shop !== kind) continue;
      if (!q.b.staffed) continue;
      if (!shopPairOk(q)) continue;
      if (Math.max(Math.abs(q.x-o.x),Math.abs(q.y-o.y)) <= BUILD[q.b.type].radius) return true;
    }
    return false;
  };
  map.grain = shopOk("grain");
  map.veg   = shopOk("veg");
  map.fruit = shopOk("fruit");
  map.fish  = shopOk("fish");
  map.meat  = shopOk("meat");

  map.woodMat  = (S.goods.wood||0)  >= 5;
  map.stoneMat = (S.goods.stone||0) >= 5;
  map.clayMat  = (S.goods.clay||0)  >= 5;
  map.pottery  = (S.goods.pottery||0) >= 3;
  map.wine     = (S.goods.wine||0) >= 3;
  map.cloth    = (S.goods.cloth||0) >= 3;

  map.temple = !!coveredBy(o.x,o.y,"temple");
  map.school = !!coveredBy(o.x,o.y,"school");
  map.fun    = !!coveredBy(o.x,o.y,"fun");
  map.safety = !!coveredBy(o.x,o.y,"safety");
  map.health = !!coveredBy(o.x,o.y,"health");

  const missing = lvlData.needs.filter(n=>!map[n]);
  const currentOk = missing.length === 0;
  const next = HOUSE_LEVELS[h.lvl];
  const nextMissing = next ? next.needs.filter(n=>!map[n]) : [];
  let canUpgrade = !!next && nextMissing.length === 0;
  if (canUpgrade && netBeauty(o.x,o.y) < 0) canUpgrade = false;

  return { map, missing, currentOk, next, nextMissing, canUpgrade, ok:canUpgrade };
}

/* ── 声望 ─────────────────────────────────────────────── */
function updatePrestige(){
  let target = 50;
  const bl = buildings();
  const res = bl.filter(o=>isResidence(o.b));
  const idle = Math.max(0, Math.floor(S.pop) - S.workersAssigned);
  const unstaffed = bl.filter(o=>BUILD[o.b.type].workers && !o.b.staffed).length;

  target += Math.min(20, S.gold/500);
  target -= Math.min(20, unstaffed*2);
  if (idle > S.pop*0.45) target -= 10;
  if (S.goods.grain < 30) target -= 15;
  if (S.gold < 20) target -= 10;

  let lacking = 0;
  for (const o of res) if (o.b.met && o.b.met.missing.length) lacking++;
  target -= Math.min(20, lacking*3);

  const unsafe = res.filter(o=>!coveredBy(o.x,o.y,"safety")).length;
  target -= Math.min(15, unsafe*2);

  target = Math.max(-50, Math.min(100, target));
  S.prestige += (target - S.prestige)*0.02;
}

/* ── 灾害 ─────────────────────────────────────────────── */
/* 失火：只有玩家已经建成值更房之后才可能发生；
   且每次最多烧一座，概率 1.2%（约每 80 回合一次）。
   被安全覆盖的建筑不会失火。 */
function hazards(bl){
  if (count("watch") === 0) return;
  if (Math.random() > 0.012) return;
  const risk = bl.filter(o=>{
    const d = BUILD[o.b.type];
    return d.workers && !coveredBy(o.x,o.y,"safety");
  });
  if (!risk.length) return;
  const victim = risk[Math.floor(Math.random()*risk.length)];
  const d = BUILD[victim.b.type];
  destroyBuilding(victim.x, victim.y);
  log(d.name + " 失火焚毁！","bad");
  toast(d.name + " 失火！","bad");
}

function destroyBuilding(x,y){
  const t = tileAt(x,y);
  if (!t || !t.b) return;
  const b = t.b;
  if (!b.origin){ t.b = null; markRoadDirty(); return; }
  const fp = footprint(b.origin[0], b.origin[1], BUILD[b.type].size);
  if (fp) for (const [, ,tt] of fp) if (tt.b && tt.b.id===b.id) tt.b = null;
  markRoadDirty();
}

/* ── 章节 ─────────────────────────────────────────────── */
function checkTasks(){
  const ch = CHAPTERS[S.chapter];
  if (!ch) return;
  const done = S.taskDone[S.chapter];
  let all = true;
  for (let i=0;i<ch.tasks.length;i++){
    if (!done[i]){
      let ok = false;
      try { ok = !!ch.tasks[i].check(S); } catch(e){ ok = false; }
      if (ok){
        done[i] = true;
        toast("✔ " + ch.tasks[i].text,"good");
        log("✔ " + ch.tasks[i].text,"good");
      }
    }
    if (!done[i]) all = false;
  }
  if (all && !ch._done){
    ch._done = true;
    const r = ch.reward || {};
    for (const k in r) S.goods[k] = (S.goods[k]||0) + r[k];
    if (S.chapter < CHAPTERS.length-1){
      S.chapter++;
      S.taskDone[S.chapter] = CHAPTERS[S.chapter].tasks.map(()=>false);
      const nx = CHAPTERS[S.chapter];
      log("第 " + (S.chapter+1) + " 章：" + nx.title,"good");
      toast("进入 " + nx.title,"good");
      renderBuildList();
    }
    renderTasks();
  }
}
function currentUnlocked(){
  const set = new Set();
  for (let i=0;i<=S.chapter;i++) for (const t of CHAPTERS[i].unlock) set.add(t);
  return set;
}

/* ═══════════════════════════════════════════════════════
   建造
   ═══════════════════════════════════════════════════════ */
function canBuildAt(type,x,y){
  const d = BUILD[type];
  const fp = footprint(x,y,d.size);
  if (!fp) return { ok:false, why:"超出地图" };
  for (const [, ,t] of fp) if (t.b) return { ok:false, why:"位置已被占用" };
  if (type==="lumber" && tileAt(x,y).t !== "tree") return { ok:false, why:"伐木场必须建在林地上" };
  if (type==="quarry" && !hasResource(fp,"stone")) return { ok:false, why:"采石场必须建在石矿上" };
  if (type==="clayPit" && !hasResource(fp,"clay")) return { ok:false, why:"粘土矿必须建在粘土上" };
  return { ok:true };
}
/* 2×2 的矿场只要占地内有矿脉即可（原作资源点也是零散分布的） */
function hasResource(fp,kind){
  return fp.some(([, ,t]) => t.t === kind);
}

function afford(type){
  const c = BUILD[type].cost || {};
  return Object.keys(c).every(k=> (S.goods[k]||0) >= c[k]);
}

function doBuild(type,x,y){
  if (!currentUnlocked().has(type)) return false;
  const chk = canBuildAt(type,x,y);
  if (!chk.ok){ toast(chk.why,"bad"); return false; }
  if (!afford(type)){ toast("资源不足","bad"); return false; }

  const c = BUILD[type].cost || {};
  for (const k in c) S.goods[k] -= c[k];

  if (type === "road"){
    tileAt(x,y).b = { type:"road", id:++uid };
    markRoadDirty();
  } else {
    const fp = footprint(x,y, BUILD[type].size);
    const b = { type, id:++uid, origin:[x,y] };
    if (isResidence(b)){ b.lvl=1; b.pop=0; b.taxTimer=0; }
    for (const [, ,t] of fp) t.b = b;
    if (type === "wonder") winGame();
  }
  S.stats.totalBuilt++;
  renderAll();
  return true;
}

function demolish(x,y){
  const t = tileAt(x,y);
  if (!t || !t.b) return;
  const b = t.b;
  if (b.type === "road" && b.main){ toast("主路不可拆除","bad"); return; }
  const d = BUILD[b.type];
  const c = d.cost || {};
  for (const k in c){
    const cap = GOODS[k] ? (GOODS[k].cat==="food"?S.caps.food:S.caps.mat) : 1e9;
    S.goods[k] = Math.min(cap, (S.goods[k]||0) + Math.floor(c[k]/2));
  }
  destroyBuilding(x,y);
  markRoadDirty();
  log("拆除了 " + d.name + "。");
  renderAll();
}

/* ═══════════════════════════════════════════════════════
   胜利
   ═══════════════════════════════════════════════════════ */
function winGame(){
  S.won = true;
  setSpeed(0);
  modal({
    em:"🏛️", title:"奇观落成",
    body:"<p>第 <b>" + S.tick + "</b> 回合，奇观在你的帝国中心拔地而起。</p>" +
      "<p>最高人口 <b>" + Math.floor(S.stats.maxPop) + "</b> · 累计税收 <b>" +
      Math.floor(S.stats.taxed) + "</b> 金币 · 建造 <b>" + S.stats.totalBuilt + "</b> 次。</p>",
    buttons:[{ text:"再来一局", primary:true, fn:()=>{ localStorage.removeItem(SAVE_KEY); newGame(); setSpeed(1); } }],
  });
}

/* ═══════════════════════════════════════════════════════
   渲染
   ═══════════════════════════════════════════════════════ */
let view = { ox:0, oy:0, zoom:1 };
const FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

function tileToScreen(x,y){
  return { sx:(x-y)*TILE_W/2, sy:(x+y)*TILE_H/2 };
}
function resizeCanvas(){
  const r = cv.parentElement.getBoundingClientRect();
  if (r.width < 2 || r.height < 2){ requestAnimationFrame(resizeCanvas); return; }
  const dpr = Math.min(2, window.devicePixelRatio||1);
  cv.width = Math.round(r.width*dpr);
  cv.height = Math.round(r.height*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  fitView();
}
function fitView(){
  const r = cv.getBoundingClientRect();
  const pts = [tileToScreen(0,0), tileToScreen(MAP_W-1,0), tileToScreen(MAP_W-1,MAP_H-1), tileToScreen(0,MAP_H-1)];
  const minX = Math.min(...pts.map(p=>p.sx)), maxX = Math.max(...pts.map(p=>p.sx));
  const minY = Math.min(...pts.map(p=>p.sy)) - 60, maxY = Math.max(...pts.map(p=>p.sy));
  const w = maxX-minX, h = maxY-minY;
  // 完整显示整张地图（滚轮可放大，拖拽平移）
  const z = Math.min((r.width-16)/w, (r.height-16)/h);
  view.zoom = z;
  view.ox = r.width/2 - (minX + w/2)*z;
  view.oy = r.height/2 - (minY + h/2)*z;
}
function clampView(r){
  const pts = [tileToScreen(0,0), tileToScreen(MAP_W-1,0), tileToScreen(MAP_W-1,MAP_H-1), tileToScreen(0,MAP_H-1)];
  const minX = Math.min(...pts.map(p=>p.sx))*view.zoom;
  const maxX = Math.max(...pts.map(p=>p.sx))*view.zoom;
  const minY = Math.min(...pts.map(p=>p.sy))*view.zoom;
  const maxY = Math.max(...pts.map(p=>p.sy))*view.zoom;
  const margin = 80;
  if (maxX + view.ox < margin) view.ox = margin - maxX;
  if (minX + view.ox > r.width - margin) view.ox = r.width - margin - minX;
  if (maxY + view.oy < margin) view.oy = margin - maxY;
  if (minY + view.oy > r.height - margin) view.oy = r.height - margin - minY;
}

function screenToTile(px,py){
  const {ox,oy,zoom} = view;
  const sx = (px-ox)/zoom, sy = (py-oy)/zoom;
  // tileToScreen 返回的是格心：sx=(x-y)*W/2, sy=(x+y)*H/2
  // 反解得连续坐标，再取整（+0.5 因为菱形中心对应整格）
  const fx = (sx/(TILE_W/2) + sy/(TILE_H/2))/2;
  const fy = (sy/(TILE_H/2) - sx/(TILE_W/2))/2;
  return { x: Math.floor(fx + 0.5), y: Math.floor(fy + 0.5) };
}

const TERRAIN_FILL = {
  grass:["#6f8a4e","#5f7a44"],
  sand: ["#c9b07a","#b9a06a"],
  tree: ["#557446","#49643c"],
  stone:["#8b8172","#7a7163"],
  clay: ["#a08464","#8e7456"],
};

function drawDiamond(cx,cy,w,h){
  ctx.beginPath();
  ctx.moveTo(cx, cy-h/2);
  ctx.lineTo(cx+w/2, cy);
  ctx.lineTo(cx, cy+h/2);
  ctx.lineTo(cx-w/2, cy);
  ctx.closePath();
}

function render(){
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio||1);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,r.width,r.height);
  if (!S) return;

  ctx.save();
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.zoom, view.zoom);

  for (let s=0;s<MAP_W+MAP_H-1;s++){
    for (let x=0;x<MAP_W;x++){
      const y = s-x;
      if (y<0 || y>=MAP_H) continue;
      drawTile(x,y);
    }
  }

  drawCoverage();
  drawHover();
  ctx.restore();
  drawMinimap();
}

function drawTile(x,y){
  const t = S.tiles[y][x];
  const p = tileToScreen(x,y);
  const w = TILE_W, h = TILE_H;
  const b = t.b;
  const isRoad = b && b.type==="road";

  let fill;
  if (isRoad) fill = b.main ? ["#a8905e","#96804f"] : ["#9a8b6a","#8a7b5c"];
  else fill = TERRAIN_FILL[t.t] || TERRAIN_FILL.grass;

  drawDiamond(p.sx,p.sy,w-1,h-1);
  ctx.fillStyle = fill[0]; ctx.fill();
  ctx.fillStyle = fill[1];
  ctx.beginPath();
  ctx.moveTo(p.sx, p.sy+h/2-0.5);
  ctx.lineTo(p.sx+w/2-0.5, p.sy);
  ctx.lineTo(p.sx+w/2-0.5, p.sy+h/2-0.5);
  ctx.closePath(); ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.10)";
  ctx.lineWidth = 0.6;
  drawDiamond(p.sx,p.sy,w,h);
  ctx.stroke();

  if (!isRoad && !b){
    if (t.t==="tree") drawTree(p.sx,p.sy,x,y);
    else if (t.t==="stone") drawRock(p.sx,p.sy,x,y);
    else if (t.t==="clay") drawClay(p.sx,p.sy,x,y);
  }

  if (isRoad){
    if (b.main){
      ctx.fillStyle = "rgba(220,178,76,0.28)";
      drawDiamond(p.sx,p.sy,w*0.55,h*0.55); ctx.fill();
    }
    ctx.strokeStyle = "rgba(255,240,200,0.5)";
    ctx.lineWidth = 1.5;
    const links=[];
    for (const [dx,dy] of DIRS){
      const n = tileAt(x+dx,y+dy);
      if (n && n.b && n.b.type==="road") links.push([dx,dy]);
    }
    if (!links.length) links.push([1,0]);
    for (const [dx,dy] of links){
      const ex = p.sx + (dx-dy)*w*0.25;
      const ey = p.sy + (dx+dy)*h*0.25;
      ctx.beginPath(); ctx.moveTo(p.sx,p.sy); ctx.lineTo(ex,ey); ctx.stroke();
    }
  }

  if (b && !isRoad){
    const isOrigin = !b.origin || (b.origin[0]===x && b.origin[1]===y);
    if (isOrigin) drawBuilding(x,y,b);
  }
}

function hash2(x,y){ const n=Math.sin(x*127.1+y*311.7)*43758.5453; return n-Math.floor(n); }

function drawTree(sx,sy,x,y){
  const r = hash2(x,y);
  const ox = (r-0.5)*8;
  const H = 26+r*6;
  ctx.fillStyle="rgba(0,0,0,0.22)";
  ctx.beginPath(); ctx.ellipse(sx+ox*0.5, sy+3, 9, 4, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle="#5a4126";
  ctx.fillRect(sx+ox*0.5-1.6, sy-7, 3.2, 9);
  const layers=[
    {yBase:sy-4,  h:H*0.52, w:15},
    {yBase:sy-11, h:H*0.50, w:12},
    {yBase:sy-18, h:H*0.46, w:9},
  ];
  for (let i=0;i<layers.length;i++){
    const L=layers[i], bx=sx+ox*0.5;
    ctx.fillStyle=["#33552a","#3d6432","#487439"][i];
    ctx.beginPath();
    ctx.moveTo(bx, L.yBase-L.h); ctx.lineTo(bx+L.w, L.yBase); ctx.lineTo(bx-L.w, L.yBase);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle=["#4a7a3c","#578a46","#659a52"][i];
    ctx.beginPath();
    ctx.moveTo(bx, L.yBase-L.h); ctx.lineTo(bx+L.w, L.yBase); ctx.lineTo(bx+L.w*0.15, L.yBase);
    ctx.closePath(); ctx.fill();
  }
}
function drawRock(sx,sy,x,y){
  const r = hash2(x+7,y+3);
  const off = (r-0.5)*12;
  ctx.fillStyle="rgba(0,0,0,0.22)";
  ctx.beginPath(); ctx.ellipse(sx+off*0.3, sy+3, 8, 3.4, 0, 0, Math.PI*2); ctx.fill();
  const rocks=[[0,0,7,9],[6,2,5,6],[-5,2,4.5,5.5]];
  for (const [dx,dy,w,hgt] of rocks){
    const bx=sx+off*0.3+dx, by=sy+dy;
    ctx.fillStyle="#9a9184";
    ctx.beginPath();
    ctx.moveTo(bx-w/2,by); ctx.lineTo(bx-w/2+1.5,by-hgt*0.75);
    ctx.lineTo(bx+w*0.15,by-hgt); ctx.lineTo(bx+w/2,by-hgt*0.4);
    ctx.lineTo(bx+w/2-1,by);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle="rgba(255,255,255,0.13)";
    ctx.beginPath();
    ctx.moveTo(bx-w/2+1.5,by-hgt*0.75); ctx.lineTo(bx+w*0.15,by-hgt); ctx.lineTo(bx+w*0.1,by-hgt*0.35);
    ctx.closePath(); ctx.fill();
  }
}
function drawClay(sx,sy,x,y){
  const r = hash2(x+3,y+9);
  ctx.fillStyle="rgba(0,0,0,0.18)";
  ctx.beginPath(); ctx.ellipse(sx, sy+3, 12, 5, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle="#a08464";
  ctx.beginPath(); ctx.ellipse(sx+(r-0.5)*4, sy+1, 11, 4.5, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle="#b89a78";
  ctx.beginPath(); ctx.ellipse(sx-2+(r-0.5)*4, sy-1, 7, 3, 0, 0, Math.PI*2); ctx.fill();
}

/* ── 建筑 ─────────────────────────────────────────────── */
function drawBuilding(x,y,b){
  const d = BUILD[b.type];
  if (!d) return;
  const p = tileToScreen(x,y);
  const size = d.size||1;
  let cx = p.sx, cy = p.sy;
  if (size>1){ cx += (size-1)*TILE_W/2; cy += (size-1)*TILE_H/2; }
  const sc = size===1?1:size===2?1.35:1.7;

  drawStructure(cx,cy,b,sc,size);

  if (isResidence(b)){
    const met = b.met || evaluateNeeds({x,y,b,tile:S.tiles[y][x]});
    const col = met.canUpgrade ? "#8fc56a" : (met.currentOk ? "#dcb24c" : "#e06a55");
    ctx.beginPath(); ctx.arc(cx+16*sc, cy-12*sc, 8, 0, Math.PI*2);
    ctx.fillStyle="rgba(20,15,7,0.92)"; ctx.fill();
    ctx.strokeStyle=col; ctx.lineWidth=1.6; ctx.stroke();
    ctx.fillStyle=col; ctx.font="bold 10px sans-serif";
    ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(b.lvl, cx+16*sc, cy-11.5*sc);
  }

  let warn = false;
  if (d.workers && !b.staffed) warn = true;
  if (d.shop && !shopPairOk({x,y,b})) warn = true;
  if (warn){
    ctx.font="13px "+FONT;
    ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("⚠️", cx-16*sc, cy-13*sc);
  }

  if (d.workers && b.staffed && !connectedToMain(x,y,size) && d.cat!=="industry" && d.cat!=="agri"){
    ctx.font="10px "+FONT;
    ctx.fillText("⛓️", cx+16*sc, cy+8*sc);
  }
}

function drawStructure(cx,cy,b,sc,size){
  const t = b.type;
  ctx.fillStyle="rgba(0,0,0,0.26)";
  ctx.beginPath();
  ctx.ellipse(cx, cy+7*sc, 17*sc*Math.sqrt(size)*0.9, 8*sc*Math.sqrt(size)*0.9, 0, 0, Math.PI*2);
  ctx.fill();

  const box = (w,hh,body,roof,roofH)=>{
    const hw=w/2*sc, dh=hh/2*sc, bh=body.h*sc;
    const top=cy-bh;
    ctx.fillStyle=body.left;
    ctx.beginPath();
    ctx.moveTo(cx-hw,top); ctx.lineTo(cx,top+dh); ctx.lineTo(cx,top+dh+bh); ctx.lineTo(cx-hw,top+bh);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle=body.right;
    ctx.beginPath();
    ctx.moveTo(cx+hw,top); ctx.lineTo(cx,top+dh); ctx.lineTo(cx,top+dh+bh); ctx.lineTo(cx+hw,top+bh);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle=roof;
    ctx.beginPath();
    ctx.moveTo(cx,top-dh-roofH*sc); ctx.lineTo(cx+hw,top-roofH*sc);
    ctx.lineTo(cx,top+dh-roofH*sc); ctx.lineTo(cx-hw,top-roofH*sc);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle="rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.moveTo(cx,top-dh-roofH*sc); ctx.lineTo(cx-hw,top-roofH*sc); ctx.lineTo(cx,top+dh-roofH*sc);
    ctx.closePath(); ctx.fill();
  };

  switch(t){
    case "house": {
      const lvl=b.lvl||1;
      const hgt=8+lvl*1.5;
      box(20,10,{left:"#c9a97a",right:"#a8875c",h:hgt}, lvl>=5?"#8f5a3a":"#a86a45", 5+lvl*0.35);
      ctx.fillStyle="#5a3f24";
      ctx.fillRect(cx-2.5*sc, cy+hgt*sc-6*sc, 5*sc, 6*sc);
      if (lvl>=3){
        ctx.fillStyle="#e8d9a8";
        for(let i=0;i<Math.min(4,lvl-2);i++){
          const yy=cy+hgt*sc-10*sc-i*5*sc;
          ctx.fillRect(cx-7*sc,yy,3*sc,2.5*sc);
          ctx.fillRect(cx+4*sc,yy,3*sc,2.5*sc);
        }
      }
      break;
    }
    case "villa": {
      box(30,16,{left:"#e0d2b0",right:"#bcaa88",h:14}, "#9a6a48", 6);
      ctx.fillStyle="#7a5a3a";
      ctx.fillRect(cx-5*sc, cy+2*sc, 10*sc, 8*sc);
      break;
    }
    case "well": {
      box(16,9,{left:"#a8a08a",right:"#8b8370",h:4},"#6f8f9c",2);
      ctx.fillStyle="#5b93a8";
      ctx.beginPath(); ctx.ellipse(cx,cy+1*sc,8*sc,4*sc,0,0,Math.PI*2); ctx.fill();
      break;
    }
    case "watch": {
      box(17,9,{left:"#c25b45",right:"#a04632",h:13},"#8a3527",3);
      ctx.fillStyle="#f2c060";
      ctx.beginPath(); ctx.arc(cx, cy-9*sc, 2.6*sc, 0, Math.PI*2); ctx.fill();
      break;
    }
    case "police": box(18,10,{left:"#5c6f8a",right:"#45566e",h:12},"#39465a",3); break;
    case "clinic": {
      box(18,10,{left:"#d8d2c0",right:"#b3ad9b",h:11},"#8e8878",3);
      ctx.fillStyle="#c0392b";
      ctx.fillRect(cx-1.5*sc,cy+2*sc,3*sc,8*sc);
      ctx.fillRect(cx-5*sc,cy+4.5*sc,10*sc,3*sc);
      break;
    }
    case "repair": box(18,10,{left:"#8a7a62",right:"#6e614d",h:10},"#5a4f3e",3); break;
    case "temple": {
      ctx.fillStyle="#cbb98c";
      ctx.fillRect(cx-12*sc,cy+2*sc,24*sc,4*sc);
      for(let i=-2;i<=2;i++){
        ctx.fillStyle = i<0?"#b5a075":"#9c8860";
        ctx.fillRect(cx+i*5*sc-1.2*sc, cy-9*sc, 2.4*sc, 13*sc);
      }
      ctx.fillStyle="#8a7550";
      ctx.beginPath();
      ctx.moveTo(cx-14*sc,cy-9*sc); ctx.lineTo(cx+14*sc,cy-9*sc); ctx.lineTo(cx,cy-20*sc);
      ctx.closePath(); ctx.fill();
      break;
    }
    case "school": {
      box(20,11,{left:"#d6c8a4",right:"#b4a684",h:12},"#7a6444",4);
      ctx.fillStyle="#6a5232";
      ctx.fillRect(cx-8*sc,cy+2*sc,16*sc,2*sc);
      break;
    }
    case "theater": {
      box(20,11,{left:"#a8607a",right:"#8a4a62",h:9},"#6a3448",4);
      ctx.fillStyle="#e0c060";
      ctx.beginPath(); ctx.arc(cx,cy-2*sc,3*sc,0,Math.PI*2); ctx.fill();
      break;
    }
    case "grainShop": case "vegShop": case "fruitShop": case "fishShop": case "meatShop": {
      box(17,9,{left:"#b8915c",right:"#97744a",h:7},"#c9a86a",2);
      const col = t==="grainShop"?"#d8b45c":t==="vegShop"?"#7fb04a":
                  t==="fruitShop"?"#c85050":t==="fishShop"?"#5a90b0":"#b06060";
      ctx.fillStyle=col;
      ctx.beginPath();
      ctx.moveTo(cx-10*sc,cy-6*sc); ctx.lineTo(cx+10*sc,cy-6*sc);
      ctx.lineTo(cx+7*sc,cy-11*sc); ctx.lineTo(cx-7*sc,cy-11*sc);
      ctx.closePath(); ctx.fill();
      break;
    }
    case "farmland": case "vegFarm": case "orchard": case "pasture": {
      const col = t==="farmland"?"#9aa84a":t==="vegFarm"?"#7fa84a":
                  t==="orchard"?"#6f9a42":"#8a9a5a";
      const w = size===2?26:13;
      ctx.fillStyle=col;
      ctx.beginPath();
      ctx.moveTo(cx,cy-w*0.55); ctx.lineTo(cx+w,cy);
      ctx.lineTo(cx,cy+w*0.55); ctx.lineTo(cx-w,cy);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle="rgba(240,230,150,0.5)"; ctx.lineWidth=1;
      for(let i=-2;i<=2;i++){
        ctx.beginPath();
        ctx.moveTo(cx+i*w*0.32-w*0.6, cy+i*w*0.18);
        ctx.lineTo(cx+i*w*0.32+w*0.6, cy+i*w*0.18);
        ctx.stroke();
      }
      break;
    }
    case "fishing": {
      box(16,9,{left:"#8a7a5a",right:"#6e6248",h:8},"#5a4f3c",3);
      ctx.strokeStyle="#d8c8a0"; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.moveTo(cx+7*sc,cy-6*sc); ctx.lineTo(cx+13*sc,cy+2*sc); ctx.stroke();
      break;
    }
    case "lumber": {
      box(26,14,{left:"#9a7a52",right:"#7a5f3e",h:10},"#6b5236",4);
      ctx.fillStyle="#6e5a42";
      ctx.fillRect(cx+9*sc,cy-18*sc,4*sc,11*sc);
      ctx.fillStyle="#c8a05c";
      ctx.fillRect(cx-18*sc,cy+5*sc,6*sc,3*sc);
      ctx.fillRect(cx-16*sc,cy+2*sc,6*sc,3*sc);
      break;
    }
    case "quarry": {
      ctx.fillStyle="#7a7163";
      ctx.beginPath();
      ctx.moveTo(cx,cy-10*sc); ctx.lineTo(cx+20*sc,cy);
      ctx.lineTo(cx,cy+10*sc); ctx.lineTo(cx-20*sc,cy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle="#9a9082";
      ctx.fillRect(cx-10*sc,cy-8*sc,7*sc,6*sc);
      ctx.fillRect(cx+3*sc,cy-2*sc,8*sc,6*sc);
      break;
    }
    case "clayPit": {
      ctx.fillStyle="#a08464";
      ctx.beginPath();
      ctx.moveTo(cx,cy-10*sc); ctx.lineTo(cx+20*sc,cy);
      ctx.lineTo(cx,cy+10*sc); ctx.lineTo(cx-20*sc,cy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle="#b89a78";
      ctx.beginPath(); ctx.ellipse(cx,cy,10*sc,5*sc,0,0,Math.PI*2); ctx.fill();
      break;
    }
    case "kiln": case "pottery": case "mill": case "weaver": case "winery": {
      box(26,14,{left:"#9a7a62",right:"#7a5f4a",h:11},"#5e4636",4);
      ctx.fillStyle="#6e5a42";
      ctx.fillRect(cx+9*sc,cy-20*sc,5*sc,13*sc);
      ctx.fillStyle="#e8dcc0";
      ctx.beginPath(); ctx.arc(cx-9*sc,cy+1*sc,4*sc,0,Math.PI*2); ctx.fill();
      break;
    }
    case "granary": {
      box(26,14,{left:"#c8b07a",right:"#a68f5e",h:13},"#8a7448",4);
      ctx.fillStyle="#e0c88a";
      ctx.fillRect(cx-9*sc,cy-3*sc,18*sc,2*sc);
      break;
    }
    case "warehouse": {
      box(28,15,{left:"#9a7a52",right:"#7a5f3e",h:12},"#6b5236",4);
      ctx.fillStyle="#4a3722";
      ctx.fillRect(cx-7*sc,cy+3*sc,14*sc,7*sc);
      break;
    }
    case "treeDeco": {
      ctx.fillStyle="#5a4126";
      ctx.fillRect(cx-1.4,cy-4,2.8,7);
      ctx.fillStyle="#4a7a3c";
      ctx.beginPath(); ctx.arc(cx,cy-11*sc,8*sc,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="#5f9449";
      ctx.beginPath(); ctx.arc(cx-3*sc,cy-14*sc,5*sc,0,Math.PI*2); ctx.fill();
      break;
    }
    case "garden": {
      ctx.fillStyle="#8a9a5a";
      ctx.beginPath();
      ctx.moveTo(cx,cy-13*sc); ctx.lineTo(cx+24*sc,cy);
      ctx.lineTo(cx,cy+13*sc); ctx.lineTo(cx-24*sc,cy);
      ctx.closePath(); ctx.fill();
      const flowers=[[-8,-2,"#d05a7a"],[6,-4,"#e0b040"],[0,4,"#c86a9a"],[10,3,"#e0b040"]];
      for(const [dx,dy,c] of flowers){
        ctx.fillStyle=c;
        ctx.beginPath(); ctx.arc(cx+dx*sc,cy+dy*sc,3*sc,0,Math.PI*2); ctx.fill();
      }
      break;
    }
    case "monument": {
      ctx.fillStyle="#b5a882";
      ctx.fillRect(cx-4*sc,cy-16*sc,8*sc,20*sc);
      ctx.fillStyle="#cbbfa0";
      ctx.fillRect(cx-6*sc,cy+2*sc,12*sc,4*sc);
      break;
    }
    case "barracks": {
      box(28,15,{left:"#7a6a5a",right:"#5e5044",h:12},"#4a3e34",4);
      ctx.fillStyle="#8a3020";
      ctx.fillRect(cx-2*sc,cy-14*sc,3*sc,9*sc);
      break;
    }
    case "wonder": {
      ctx.fillStyle="#cbb98c";
      ctx.beginPath();
      ctx.moveTo(cx,cy-44*sc); ctx.lineTo(cx+34*sc,cy+14*sc); ctx.lineTo(cx-34*sc,cy+14*sc);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle="#a8956a";
      ctx.beginPath();
      ctx.moveTo(cx,cy-44*sc); ctx.lineTo(cx+34*sc,cy+14*sc); ctx.lineTo(cx,cy+14*sc);
      ctx.closePath(); ctx.fill();
      break;
    }
    default:
      box(18,10,{left:"#b0a080",right:"#8e8062",h:9},"#7a6a4e",3);
  }
}

/* ── 覆盖可视化 ───────────────────────────────────────── */
function drawCoverage(){
  let target = null;
  if (selTool && BUILD[selTool].radius && hover){
    target = { radius:BUILD[selTool].radius, x:hover.x, y:hover.y };
  } else if (hover){
    const t = tileAt(hover.x,hover.y);
    if (t && t.b && BUILD[t.b.type].radius && t.b.origin &&
        t.b.origin[0]===hover.x && t.b.origin[1]===hover.y){
      target = { radius:BUILD[t.b.type].radius, x:hover.x, y:hover.y };
    }
  }
  if (!target || target.x==null) return;
  const {x,y,radius}=target;
  for (let dy=-radius;dy<=radius;dy++) for (let dx=-radius;dx<=radius;dx++){
    if (Math.max(Math.abs(dx),Math.abs(dy))>radius) continue;
    if (!tileAt(x+dx,y+dy)) continue;
    const p = tileToScreen(x+dx,y+dy);
    drawDiamond(p.sx,p.sy,TILE_W-1,TILE_H-1);
    ctx.fillStyle = "rgba(111,176,201,0.13)";
    ctx.fill();
  }
  for (let dy=-radius;dy<=radius;dy++) for (let dx=-radius;dx<=radius;dx++){
    if (Math.max(Math.abs(dx),Math.abs(dy))!==radius) continue;
    if (!tileAt(x+dx,y+dy)) continue;
    const p = tileToScreen(x+dx,y+dy);
    drawDiamond(p.sx,p.sy,TILE_W,TILE_H);
    ctx.strokeStyle="rgba(111,176,201,0.45)";
    ctx.lineWidth=1;
    ctx.stroke();
  }
}

function drawHover(){
  if (!hover) return;
  const {x,y} = hover;
  if (!inB(x,y)) return;
  const size = selTool ? BUILD[selTool].size : 1;
  let ok = true;
  if (selTool) ok = canBuildAt(selTool,x,y).ok && afford(selTool);
  const fp = footprint(x,y,size) || [[x,y]];
  for (const [cx,cy] of fp){
    const p = tileToScreen(cx,cy);
    drawDiamond(p.sx,p.sy,TILE_W,TILE_H);
    ctx.fillStyle = selTool ? (ok?"rgba(143,197,106,0.28)":"rgba(224,106,85,0.28)") : "rgba(255,240,200,0.12)";
    ctx.fill();
    ctx.strokeStyle = selTool ? (ok?"rgba(143,197,106,0.9)":"rgba(224,106,85,0.9)") : "rgba(255,240,200,0.5)";
    ctx.lineWidth=1.6;
    ctx.stroke();
  }
}

/* ── 小地图 ───────────────────────────────────────────── */
function drawMinimap(){
  if (!mmc) return;
  const size = 116;
  const dpr = Math.min(2, window.devicePixelRatio||1);
  if (mm.width !== Math.round(size*dpr)){
    mm.width = Math.round(size*dpr); mm.height = Math.round(size*dpr);
    mm.style.width=size+"px"; mm.style.height=size+"px";
  }
  mmc.setTransform(dpr,0,0,dpr,0,0);
  mmc.clearRect(0,0,size,size);
  const cell = size/MAP_W;
  for (let y=0;y<MAP_H;y++) for (let x=0;x<MAP_W;x++){
    const t = S.tiles[y][x];
    let c = "#5f7a44";
    if (t.b){
      const ty=t.b.type;
      if (ty==="road") c = t.b.main?"#c8a050":"#8a7b5c";
      else if (isResidence(t.b)) c = "#d8c090";
      else if (BUILD[ty].cat==="industry") c = "#8a6a4a";
      else if (BUILD[ty].cat==="agri") c = "#9aa84a";
      else if (BUILD[ty].cat==="commerce") c = "#c89050";
      else if (BUILD[ty].cat==="decor") c = "#4a8a3a";
      else c = "#a0a0a0";
    } else {
      if (t.t==="tree") c="#3a5c30";
      else if (t.t==="stone") c="#8a8272";
      else if (t.t==="clay") c="#a08464";
    }
    mmc.fillStyle = c;
    mmc.fillRect(x*cell, y*cell, cell+0.4, cell+0.4);
  }
}

/* ═══════════════════════════════════════════════════════
   UI
   ═══════════════════════════════════════════════════════ */
function renderAll(){
  renderResources(); renderPrestige(); renderTasks();
  renderBuildList(); renderInfo(); renderLog();
}

function renderResources(){
  const bl = buildings();
  const income = {};
  for (const o of bl){
    const d = BUILD[o.b.type];
    if (!d.prod || !o.b.staffed || !connectedToMain(o.x,o.y,d.size)) continue;
    if (d.input){
      let ok = true;
      for (const k in d.input) if ((S.goods[k]||0) < d.input[k]) ok = false;
      if (!ok) continue;
    }
    for (const k in d.prod) income[k] = (income[k]||0) + d.prod[k];
  }

  const show = [
    { k:"grain",  icon:"🌾" },
    { k:"wood",   icon:"🪵" },
    { k:"stone",  icon:"🪨" },
    { k:"clay",   icon:"🧱" },
    { k:"pottery",icon:"🏺" },
    { k:"gold",   icon:"🪙", special:true },
  ];
  const html = show.map(it=>{
    const v = it.special ? S.gold : (S.goods[it.k]||0);
    const d = it.special ? 0 : (income[it.k]||0);
    const cap = it.special ? null : (GOODS[it.k].cat==="food"?S.caps.food:S.caps.mat);
    const dd = d ? '<span class="d ' + (d>0?"up":"dn") + '">' + (d>0?"+":"") + d.toFixed(1) + '</span>' : "";
    const warn = (it.k==="grain" && v < 40) ? " warn" : "";
    const label = it.special ? "金币" : GOODS[it.k].name;
    return '<div class="res' + warn + '" title="' + label + (cap ? " " + Math.floor(v) + "/" + cap : "") + '">' +
      '<span class="i">' + it.icon + '</span><span class="v">' + Math.floor(v) + '</span>' + dd + '</div>';
  }).join("");

  const popHtml = '<div class="res" title="人口"><span class="i">👥</span><span class="v">' +
    Math.floor(S.pop) + '</span></div>';

  $("#resources").innerHTML = html + popHtml;

  const total = Math.floor(S.pop), used = S.workersAssigned;
  $("#labour").classList.toggle("short", used > total);
  $("#labourText").textContent = used + " / " + total;
  $("#labourBar").style.width = (total>0?Math.min(100,used/total*100):0) + "%";
}

function renderPrestige(){
  const tier = prestigeTier(S.prestige);
  $("#prestigeVal").textContent = tier.icon + " " + tier.name;
  $("#prestigeChip").style.color = tier.color;
  $("#prestigeChip").title = "声望 " + Math.round(S.prestige) + "：移民速度 ×" + tier.immig;
}

function renderTasks(){
  const ch = CHAPTERS[S.chapter];
  if (!ch) return;
  $("#chapterName").textContent = ch.title;
  const done = S.taskDone[S.chapter];
  const firstOpen = done.findIndex(d=>!d);
  $("#taskCount").textContent = done.filter(Boolean).length + " / " + done.length;
  $("#taskBody").innerHTML = ch.tasks.map((t,i)=>{
    const cls = done[i] ? "done" : (i===firstOpen ? "cur" : "");
    return '<div class="task ' + cls + '"><span class="box">' + (done[i]?"✓":"") +
      '</span><span>' + t.text + '</span></div>';
  }).join("");
}

function renderBuildTabs(){
  $("#buildTabs").innerHTML = BUILD_CATS.map(c=>
    '<button class="btab ' + (buildCat===c.key?"on":"") + '" data-c="' + c.key +
    '" title="' + c.name + '"><span class="ti">' + c.icon + '</span>' + c.name + '</button>'
  ).join("");
  $("#buildTabs").querySelectorAll("[data-c]").forEach(b=>{
    b.onclick = ()=>{ buildCat = b.dataset.c; renderBuildTabs(); renderBuildList(); };
  });
}

function renderBuildList(){
  renderBuildTabs();
  const unlocked = currentUnlocked();
  const list = Object.keys(BUILD).filter(k=>BUILD[k].cat===buildCat);
  if (!list.length){
    $("#buildList").innerHTML = '<div class="empty">这一类暂时没有建筑</div>';
    return;
  }
  $("#buildList").innerHTML = list.map(k=>{
    const d = BUILD[k];
    const lock = !unlocked.has(k);
    const able = afford(k);
    const sel = selTool===k ? " sel" : "";
    const costTxt = Object.keys(d.cost||{}).map(r=>
      (GOODS_ICON[r]||"🪙") + d.cost[r]).join(" ");
    return '<button class="bcard ' + (lock?"locked":"") + ' ' + (able?"":"deny") + sel +
      '" data-t="' + k + '" ' + (lock?"disabled":"") +
      ' title="' + d.name + '：' + d.desc + '">' +
      '<span class="em">' + d.em + '</span>' +
      '<span class="nm">' + d.name + '</span>' +
      '<span class="cs">' + costTxt + (d.workers ? " 👷" + d.workers : "") + '</span>' +
      (d.size>1 ? '<span class="sz">' + d.size + '×' + d.size + '</span>' : "") +
      '</button>';
  }).join("");
  $("#buildList").querySelectorAll("[data-t]").forEach(b=>{
    b.onclick = ()=>{
      const t = b.dataset.t;
      selTool = selTool===t ? null : t;
      renderBuildList(); renderInfo(); updateHint();
    };
  });
  $("#buildModeHint").textContent = selTool ? "铺设：" + BUILD[selTool].name : "";
}

function renderInfo(){
  const box = $("#infoBody");
  if (hover && inB(hover.x,hover.y) && !selTool){
    const t = S.tiles[hover.y][hover.x];
    if (t.b){
      box.innerHTML = buildingInfoHTML(hover.x,hover.y,t.b);
      bindInfoActions(hover.x,hover.y);
      $("#infoHead").textContent = "建筑";
      return;
    }
  }
  if (selTool){
    const d = BUILD[selTool];
    const costTxt = Object.keys(d.cost||{}).map(r=>
      (GOODS_ICON[r]||"🪙") + " " + Math.floor(S.goods[r]||0) + "/" + d.cost[r]
    ).join(" · ");
    const rows = [];
    if (d.workers) rows.push("<b>工人</b><span>" + d.workers + "</span>");
    if (d.radius) rows.push("<b>覆盖</b><span>半径 " + d.radius + " 格</span>");
    if (d.size>1) rows.push("<b>占地</b><span>" + d.size + "×" + d.size + "</span>");
    if (d.input) rows.push("<b>消耗</b><span>" +
      Object.entries(d.input).map(([k,v])=>(GOODS_ICON[k]||"")+v).join(" ") + "</span>");
    if (d.prod) rows.push("<b>产出</b><span>" +
      Object.entries(d.prod).map(([k,v])=>(GOODS_ICON[k]||"")+v).join(" ") + "</span>");
    box.innerHTML = "<h3>" + d.em + " " + d.name + "</h3>" +
      '<div style="color:#a08c62">' + d.desc + '</div>' +
      '<div class="kv">' + rows.join("") + '</div>' +
      '<div class="act"><button id="cancelSel">取消（右键 / Esc）</button></div>';
    $("#infoHead").textContent = "建造";
    $("#cancelSel").onclick = ()=>{
      selTool=null; renderBuildList(); renderInfo(); updateHint();
    };
    return;
  }
  $("#infoHead").textContent = "顾问";
  box.innerHTML = advisorText();
}

function buildingInfoHTML(x,y,b){
  const d = BUILD[b.type];
  let html = "<h3>" + d.em + " " + d.name;
  if (isResidence(b)) html += ' <span style="color:#8fc56a;font-size:12px">Lv.' + b.lvl + "</span>";
  if (b.type==="road" && b.main) html += ' <span style="color:#dcb24c;font-size:11px">主路</span>';
  html += "</h3>";

  if (isResidence(b)){
    const met = evaluateNeeds({x,y,b,tile:S.tiles[y][x]});
    const cur = HOUSE_LEVELS[b.lvl-1];
    const next = HOUSE_LEVELS[b.lvl];
    const linked = connectedToMain(x,y,BUILD[b.type].size);
    const nb = netBeauty(x,y);
    html += '<div class="kv">' +
      "<b>居民</b><span>" + Math.floor(b.pop||0) + " / " + cur.pop + "</span>" +
      '<b>连路</b><span class="' + (linked?"ok":"no") + '">' + (linked?"已连接":"未连接") + "</span>" +
      '<b>宜居</b><span class="' + (nb>=0?"ok":"no") + '">美化 ' + beautyAt(x,y) + " − 污染 " + pollutionAt(x,y) + "</span>" +
      "<b>税金</b><span>" + (met.map.grain ? "每 " + TAX_INTERVAL + " 回合 " + cur.tax + " 🪙" : "需粮店覆盖") + "</span>" +
      "</div>";

    const needs = next ? next.needs : cur.needs;
    html += '<div style="color:#8e7a55;margin-bottom:2px">' +
      (next ? "升级到 " + (b.lvl+1) + " 级需要：" : "已达最高等级") + "</div>";
    for (const n of needs){
      const ok = met.map[n];
      const info = NEED_INFO[n] || { name:n, icon:"•" };
      html += '<div class="needline"><span>' + (ok?"✅":"❌") + "</span>" +
        '<span class="' + (ok?"ok":"no") + '">' + info.icon + " " + info.name + "</span></div>";
    }
    html += '<div class="act"><button class="danger" id="demBtn">拆除</button></div>';
  } else {
    const rows = [];
    if (d.workers) rows.push("<b>工人</b><span class=\"" + (b.staffed?"ok":"no") + "\">" +
      d.workers + "（" + (b.staffed?"已派工":"缺工/未连路") + "）</span>");
    if (d.cat!=="road"){
      const linked = connectedToMain(x,y,d.size);
      rows.push("<b>道路</b><span class=\"" + (linked?"ok":(b.staffed?"warn":"no")) + "\">" +
        (linked ? "已连接" : (b.staffed ? "已断路（仍运作）" : "未连接")) + "</span>");
    }
    if (d.prod) rows.push("<b>产出</b><span>" +
      Object.entries(d.prod).map(([k,v])=>(GOODS_ICON[k]||"")+"+"+v).join(" ") + "</span>");
    if (d.input) rows.push("<b>消耗</b><span>" +
      Object.entries(d.input).map(([k,v])=>(GOODS_ICON[k]||"")+"−"+v).join(" ") + "</span>");
    if (d.radius) rows.push("<b>覆盖</b><span>半径 " + d.radius + " 格</span>");
    if (d.shop) rows.push("<b>成对</b><span class=\"" + (shopPairOk({x,y,b})?"ok":"no") + "\">" +
      (shopPairOk({x,y,b}) ? "已与对面同种商铺配对" : "需要另一座同种商铺隔路相对") + "</span>");
    if (POLLUTERS.includes(b.type)) rows.push('<b>污染</b><span class="no">范围内住宅无法升级</span>');
    if (b.type==="wonder") rows.push('<b>状态</b><span class="ok">已建成</span>');
    html += '<div style="color:#a08c62;margin-bottom:4px">' + d.desc + "</div>" +
      '<div class="kv">' + rows.join("") + "</div>" +
      '<div class="act"><button class="danger" id="demBtn">拆除</button></div>';
  }
  return html;
}

function bindInfoActions(x,y){
  const el = $("#demBtn");
  if (el) el.onclick = ()=>demolish(x,y);
}

function renderLog(){
  const el = $("#log");
  el.innerHTML = S.log.slice(-50).map(l=>
    '<div class="' + (l.cls||"") + '">' + l.msg + "</div>").join("");
  el.scrollTop = el.scrollHeight;
}

function updateHint(){
  const el = $("#hint");
  if (selTool){
    el.style.display = "block";
    el.textContent = "左键放置 " + BUILD[selTool].name + " · 右键取消 · 滚轮缩放 · 拖拽平移";
  } else el.style.display = "none";
}

function advisorText(){
  const bl = buildings();
  const res = bl.filter(o=>isResidence(o.b));
  if (!res.length) return "先建一座<b>住宅</b>，用<b>道路</b>连到右上角的主路，移民才会进入。";
  const unlinked = res.filter(o=>!connectedToMain(o.x,o.y,BUILD[o.b.type].size));
  if (unlinked.length) return "有 <span class=\"no\">" + unlinked.length + "</span> 座住宅未连到主路。";
  const noWater = res.filter(o=>!coveredBy(o.x,o.y,"water"));
  if (noWater.length) return "有 <span class=\"no\">" + noWater.length + "</span> 座住宅没有饮用水。建<b>水井</b>覆盖它们。";
  if (S.goods.grain < 40) return '<span class="no">粮食不足。</span>扩建<b>粮田</b>并确保连路、有工人。';
  const noShop = res.filter(o=>!coveredBy(o.x,o.y,"grain"));
  if (noShop.length && currentUnlocked().has("grainShop"))
    return "有 " + noShop.length + " 座住宅没有粮店覆盖。<b>商铺必须成对隔路相对</b>才生效。";
  if (S.workersAssigned > Math.floor(S.pop))
    return '<span class="no">劳动力不足</span>，部分设施停摆。';
  const polluted = res.filter(o=>netBeauty(o.x,o.y)<0);
  if (polluted.length) return "有 <span class=\"no\">" + polluted.length + "</span> 座住宅受污染影响，用<b>美化</b>建筑抵消。";
  return "城市运转正常。人口 <b>" + Math.floor(S.pop) + "</b>，声望 <b>" +
    prestigeTier(S.prestige).name + "</b>。完成任务推进章节。";
}

/* ── 提示 ─────────────────────────────────────────────── */
function toast(msg,cls){
  const el = document.createElement("div");
  el.className = "toast " + (cls||"");
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; el.style.transition="opacity .4s"; },1600);
  setTimeout(()=>el.remove(),2100);
}
function log(msg,cls){
  S.log.push({msg,cls:cls||""});
  if (S.log.length>150) S.log.shift();
  if ($("#log")) renderLog();
}
function modal(opts){
  const em = opts.em, title = opts.title, body = opts.body, buttons = opts.buttons;
  $("#modalCard").innerHTML = (em ? '<div class="big">' + em + "</div>" : "") +
    "<h2>" + title + "</h2>" + body +
    '<div class="btns">' + buttons.map((b,i)=>
      '<button data-i="' + i + '" class="' + (b.primary?"primary":"") + '">' + b.text + "</button>"
    ).join("") + "</div>";
  $("#modal").classList.add("show");
  $("#modalCard").querySelectorAll("[data-i]").forEach(btn=>{
    btn.onclick = ()=>{
      $("#modal").classList.remove("show");
      const b = buttons[+btn.dataset.i];
      if (b.fn) b.fn();
    };
  });
}

/* ═══════════════════════════════════════════════════════
   计时 / 输入
   ═══════════════════════════════════════════════════════ */
function setSpeed(sp){
  speed = sp;
  document.querySelectorAll(".speedbox button").forEach(b=>
    b.classList.toggle("on", +b.dataset.speed===sp));
  restartTimer();
}
function restartTimer(){
  if (timer) clearInterval(timer);
  timer = null;
  if (speed===0) return;
  timer = setInterval(()=>{
    simulate();
    renderResources(); renderPrestige(); renderTasks(); renderInfo();
    saveThrottled();
  }, TICK_MS/speed);
}

document.querySelectorAll(".speedbox button").forEach(b=>{
  b.onclick = ()=>setSpeed(+b.dataset.speed);
});
$("#resetBtn").onclick = ()=>{
  modal({ em:"⚠️", title:"重新开始", body:"<p>当前进度将被清除。</p>",
    buttons:[
      { text:"取消" },
      { text:"确定重开", primary:true, fn:()=>{
        localStorage.removeItem(SAVE_KEY); newGame(); setSpeed(1);
      }},
    ]});
};

let drag = null;
cv.addEventListener("mousemove", e=>{
  const r = cv.getBoundingClientRect();
  const px = e.clientX-r.left, py = e.clientY-r.top;
  if (drag){
    view.ox += px-drag.px; view.oy += py-drag.py;
    drag.px = px; drag.py = py; drag.moved = true;
    return;
  }
  const t = screenToTile(px,py);
  const hx = inB(t.x,t.y) ? t.x : null;
  const hy = inB(t.x,t.y) ? t.y : null;
  if (!hover || hover.x!==hx || hover.y!==hy){
    hover = hx===null ? null : { x:hx, y:hy };
    renderInfo();
  }
});
cv.addEventListener("mouseleave", ()=>{ hover=null; renderInfo(); });
cv.addEventListener("mousedown", e=>{
  if (e.button===2) return;
  const r = cv.getBoundingClientRect();
  drag = { px:e.clientX-r.left, py:e.clientY-r.top, moved:false };
});
cv.addEventListener("mouseup", e=>{
  if (e.button===2) return;
  if (!drag) return;
  const wasDrag = drag.moved;
  drag = null;
  if (wasDrag) return;
  const r = cv.getBoundingClientRect();
  const t = screenToTile(e.clientX-r.left, e.clientY-r.top);
  if (!inB(t.x,t.y)) return;
  if (selTool) doBuild(selTool,t.x,t.y);
  else {
    const tile = S.tiles[t.y][t.x];
    if (tile.b){ hover = { x:t.x, y:t.y }; renderInfo(); }
  }
});
cv.addEventListener("contextmenu", e=>{
  e.preventDefault();
  if (selTool){ selTool=null; renderBuildList(); renderInfo(); updateHint(); }
});
cv.addEventListener("wheel", e=>{
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  const px = e.clientX-r.left, py = e.clientY-r.top;
  const bx = (px-view.ox)/view.zoom, by = (py-view.oy)/view.zoom;
  view.zoom = Math.max(0.4, Math.min(2.6, view.zoom*(e.deltaY<0?1.1:0.9)));
  view.ox = px-bx*view.zoom;
  view.oy = py-by*view.zoom;
}, { passive:false });

window.addEventListener("keydown", e=>{
  if (e.key==="Escape"){ selTool=null; renderBuildList(); renderInfo(); updateHint(); }
  if (e.key===" "){ e.preventDefault(); setSpeed(speed===0?1:0); }
});

/* ═══════════════════════════════════════════════════════
   存档
   ═══════════════════════════════════════════════════════ */
function saveThrottled(){
  if (S.tick - pendingSave < 5) return;
  pendingSave = S.tick;
  save();
}
function save(){
  try{
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      tick:S.tick, pop:S.pop, goods:S.goods, caps:S.caps, gold:S.gold,
      prestige:S.prestige, chapter:S.chapter, taskDone:S.taskDone,
      log:S.log.slice(-40), stats:S.stats, won:S.won, uid,
      tiles:S.tiles.map(row=>row.map(t=>({ t:t.t, b:t.b }))),
      signpost:S.signpost,
    }));
  }catch(e){}
}
function load(){
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.tiles) || d.tiles.length !== MAP_H) return false;
    S = Object.assign({}, d, { workersAssigned:0 });
    uid = d.uid || 5000;
    return true;
  }catch(e){ return false; }
}

/* ═══════════════════════════════════════════════════════
   启动
   ═══════════════════════════════════════════════════════ */
function loop(){ render(); requestAnimationFrame(loop); }

function boot(){
  resizeCanvas();
  window.addEventListener("resize", ()=>{ resizeCanvas(); });

  if (!load()){
    newGame();
    setSpeed(0);
    modal({
      em:"🏛️", title:"模拟帝国",
      body:
        "<p>你是一位古代文明的统治者，要让荒原长成帝国。</p>" +
        '<p style="color:#dcb24c">操作</p>' +
        "<ul><li>右侧建造面板选建筑，再点地图空地放置；右键 / Esc 取消。</li>" +
        "<li>滚轮缩放，拖拽平移，空格暂停。</li>" +
        "<li>点击已有建筑查看需求清单。</li></ul>" +
        '<p style="color:#dcb24c">规则（与原作一致）</p>' +
        "<ul><li>地图<b>右上角的路牌</b>是主路，移民由此进入。</li>" +
        "<li>建筑<b>首次派人</b>必须连路；派满后可拆路（断路）仍继续运作，但工业/农业不可。</li>" +
        "<li><b>商铺必须同种两座、隔着道路相对</b>才能覆盖住宅。</li>" +
        "<li>住宅按等级累加需求：水 → 粮店+木材 → 菜店+粘土 → 水果+石料 …</li>" +
        "<li>居民是劳动力；声望决定移民速度。</li>" +
        "<li>工业有<b>污染</b>，住宅需要<b>美化</b>——请分区规划。</li></ul>",
      buttons:[{ text:"开始", primary:true, fn:()=>setSpeed(1) }],
    });
  } else {
    setSpeed(1);
    log("读取了上次的存档。");
  }
  renderAll();
  updateHint();
  restartTimer();
  loop();
}

boot();
