"use strict";
/* 万城纪 · shared simulation data. Original rules and balance. */

/* ── 常量 ─────────────────────────────────────────────── */
let MAP_W = 64, MAP_H = 64;
const TILE_W = 84, TILE_H = 42;
const SAVE_KEY = "empire-new-era-v1";
const LEGACY_SAVE_KEY = "sim-empire-mvp-3";
const SAVE_VERSION = 5;
const TICK_MS = 1000;
const ECONOMY_STEP_SECONDS = 60;
const TAX_INTERVAL = 30 * 60;
const OFFLINE_ECONOMY_SECONDS = 8 * 3600;
const OFFLINE_CONSTRUCTION_SECONDS = 72 * 3600;
const NEED_GRACE_SECONDS = 45 * 60;
const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];

/* ── 地形 ─────────────────────────────────────────────── */
const TERRAIN = {
  grass: { name:"草地" },
  water: { name:"河流" },
  copper:{ name:"铜矿" },
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
    desc:"连接建筑与驿道。道路连续相连，居民、物资和服务才能通行；可跨河建桥。",
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
    desc:"信仰覆盖。高阶住宅需要。",
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
    name:"城防营", em:"⚔️", size:2, cost:{wood:60,stone:50}, workers:4, radius:8, provides:"security", cat:"military", chapter:4,
    desc:"驻守城市的防卫营地。提供 8 格治安覆盖，支持高级住宅与城市声望。",
  },
  university: {
    name:"大学", em:"🎓", size:2, cost:{wood:80,stone:90,brick:30}, workers:4, radius:7,
    provides:"university", cat:"culture", chapter:5,
    desc:"高级教育覆盖。让高档住宅迈向 5 级，提升城市文化声望。",
  },
  bath: {
    name:"公共浴场", em:"♨️", size:2, cost:{wood:45,stone:70,brick:20}, workers:3, radius:6,
    provides:"bath", cat:"municipal", chapter:4,
    desc:"卫生与沐浴服务。高档住宅升级需要浴场覆盖。",
  },
  observatory: {
    name:"观象台", em:"🔭", size:2, cost:{wood:70,stone:100,copper:20}, workers:3, radius:8,
    provides:"observatory", cat:"culture", chapter:5,
    desc:"观测星辰，提供最高阶高档住宅所需的天文服务。",
  },
  harbor: {
    name:"港口", em:"⚓", size:2, cost:{wood:90,stone:60}, workers:4, cat:"commerce", chapter:4,
    desc:"必须临水建造。开放海贸，使商队买价降低 15%、卖价提高 15%，每回合获得贸易收入。",
  },
  market: {
    name:"中央集市", em:"🧺", size:2, cost:{wood:65,stone:45,brick:15}, workers:5, radius:7,
    shopAll:true, cat:"commerce", chapter:4,
    desc:"整合粮食、蔬菜、水果、鱼肉配送；无需配对，供货仍需仓库中有对应商品。",
  },
  copperMine: {
    name:"铜矿场", em:"⚒️", size:2, cost:{wood:45,stone:40}, workers:4, prod:{copper:3}, cat:"industry", chapter:4,
    desc:"必须覆盖铜矿脉，为观象台和高阶文明建设开采铜矿。",
  },
  pagoda: {
    name:"九重宝塔", em:"🏯", size:2, cost:{wood:90,stone:80,brick:20}, workers:3, radius:8,
    provides:"school", civilization:"china", cat:"culture", chapter:4,
    desc:"华夏专属。兼具教育与信仰覆盖；运营时全城工艺产量额外 +10%。",
  },
  sphinx: {
    name:"守望狮身像", em:"𓂀", size:2, cost:{stone:150,clay:30}, workers:3, radius:8,
    provides:"temple", civilization:"egypt", cat:"culture", chapter:4,
    desc:"埃及专属。兼具信仰与安全覆盖；运营时全城采矿产量额外 +10%。",
  },
  agora: {
    name:"哲人广场", em:"🏛️", size:2, cost:{wood:50,stone:110}, workers:3, radius:8,
    provides:"school", civilization:"greece", cat:"culture", chapter:4,
    desc:"希腊专属。兼具教育与娱乐覆盖；运营时税收额外 +10%。",
  },
  windTower: {
    name:"风塔庭院", em:"🕌", size:2, cost:{wood:60,stone:70,brick:35}, workers:3, radius:8,
    provides:"water", civilization:"persia", cat:"culture", chapter:4,
    desc:"波斯专属。兼具饮水与沐浴覆盖；运营时商队买价额外降低 10%。",
  },
  sunTemple: {
    name:"太阳祭台", em:"☀️", size:2, cost:{wood:65,stone:120}, workers:3, radius:8,
    provides:"temple", civilization:"aztec", cat:"culture", chapter:4,
    desc:"阿兹特克专属。兼具信仰与娱乐覆盖；运营时全城农产额外 +10%。",
  },
  wonder: {
    name:"奇观", em:"🏛️", size:3, cost:{wood:400,stone:400,brick:100}, workers:10, cat:"wonder", chapter:6,
    desc:"3×3，文明的巅峰。建设完成后达成文明胜利，可继续经营。",
  },
};

/* All durations are seconds. These are this game's balance, not an original-game table.
   Official 2021 history gives a two-minute anchor for granaries and warehouses. */
const CONSTRUCTION_TIME = {road:0,house:360,municipal:600,commerce:900,agri:900,industry:1800,storage:120,culture:3600,decor:180,military:7200,wonder:129600};
for (const d of Object.values(BUILD)) d.buildTime = CONSTRUCTION_TIME[d.cat] ?? 600;
Object.assign(BUILD.road,{buildTime:0});
for (const [type,seconds] of Object.entries({well:240,villa:7200,lumber:900,quarry:1200,clayPit:1200,copperMine:3600,kiln:2400,pottery:3600,mill:2400,weaver:5400,winery:5400,clinic:1800,repair:1800,school:3600,theater:7200,university:14400,bath:7200,observatory:43200,harbor:10800,market:3600,pagoda:21600})) BUILD[type].buildTime=seconds;
const PRODUCTION_CYCLES = {farmland:1800,vegFarm:1200,orchard:1800,fishing:600,pasture:1800,lumber:300,quarry:300,clayPit:300,copperMine:600,kiln:600,pottery:900,mill:600,weaver:1200,winery:1800};
for (const [type,seconds] of Object.entries(PRODUCTION_CYCLES)) {
  const d=BUILD[type];d.cycleSeconds=seconds;
  const batch=Object.entries(d.prod).map(([kind,n])=>Math.round(n*seconds/60)+' '+GOODS[kind].name).join('、');
  d.desc='每 '+(seconds/60)+' 分钟一批，基础产出 '+batch+'；需工人、道路、原料与仓储空间。'+({lumber:'必须覆盖林地。',quarry:'必须覆盖石矿。',clayPit:'必须覆盖粘土。',copperMine:'必须覆盖铜矿。',fishing:'必须紧邻水面。'}[type]||'');
}
const HOUSE_UPGRADE_SECONDS=[0,300,600,1200,2400,3600,7200,14400,28800,43200];
const VILLA_UPGRADE_SECONDS=[0,1800,3600,7200,14400,28800];
BUILD.granary.desc='食品储量上限 +400；需工人与连通道路。';
BUILD.warehouse.desc='材料与工艺品储量上限 +500；需工人与连通道路。';
BUILD.harbor.desc='临水港口。商队买价降低 15%、卖价提高 15%，每分钟获得 1.5 基础贸易收入。';
BUILD.well.desc = "提供饮水覆盖与少量美化。必须有工人且连通主路。";
BUILD.watch.desc = "提供消防覆盖，防止周边生产建筑发生火灾。";
BUILD.police.desc = "提供治安覆盖，提升城市声望和高档住宅的居住条件。";
BUILD.clinic.desc = "为周边住宅提供健康服务，提升城市声望。";
BUILD.repair.desc = "提供修缮覆盖，受损建筑恢复更快。";
const TRADE_PRICES = { grain:2,veg:3,fruit:4,fish:4,meat:5,wood:3,stone:4,clay:3,copper:7,brick:6,pottery:7,cloth:9,bread:5,wine:10 };

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

const VILLA_LEVELS = [
  { lvl:1, pop:30, tax:50, needs:["road","water","grain"] },
  { lvl:2, pop:48, tax:90, needs:["road","water","grain","veg","health","security"] },
  { lvl:3, pop:72, tax:145, needs:["road","water","grain","veg","health","security","fruit","school","bath"] },
  { lvl:4, pop:100,tax:220, needs:["road","water","grain","veg","health","security","fruit","school","bath","pottery","temple"] },
  { lvl:5, pop:138,tax:330, needs:["road","water","grain","veg","health","security","fruit","school","bath","pottery","temple","university","wine"] },
  { lvl:6, pop:180,tax:490, needs:["road","water","grain","veg","health","security","fruit","school","bath","pottery","temple","university","wine","observatory","fun","cloth"] },
];
function residenceLevels(b){ return b.type === "villa" ? VILLA_LEVELS : HOUSE_LEVELS; }
function residenceLevel(b, lvl = b.lvl || 1){ const a = residenceLevels(b); return a[Math.max(0, Math.min(a.length - 1, lvl - 1))]; }

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
  security: { name:"治安覆盖",   icon:"🛡️" },
  repair:   { name:"修缮覆盖",   icon:"🔧" },
  bath:     { name:"沐浴服务",   icon:"♨️" },
  university:{name:"高等教育",   icon:"🎓" },
  observatory:{name:"天文服务",  icon:"🔭" },
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
      { text:"至少有 2 座住宅达到 4 级",  check:s=>houseLevelCount(4)>=2 },
      { text:"人口达到 140",            check:s=>s.pop>=140 },
    ],
    reward:{ wood:350, stone:300 },
  },
  {
    title:"第四章 · 城邦", unlock:["villa","pottery","mill","orchard","fruitShop","school","monument","barracks","bath","market","harbor","copperMine","pagoda","sphinx","agora","windTower","sunTemple"],
    tasks:[
      { text:"建造 1 座陶器坊",          check:s=>count("pottery")>=1 },
      { text:"建成一对水果摊",           check:s=>shopPairCount("fruit")>=1 },
      { text:"至少 2 座住宅达到 5 级",    check:s=>houseLevelCount(5)>=2 },
      { text:"人口达到 240",            check:s=>s.pop>=240 },
      { text:"累计税收 1500 金币",       check:s=>s.stats.taxed>=1500 },
    ],
    reward:{ wood:500, stone:450 },
  },
  {
    title:"第五章 · 富庶", unlock:["fishShop","meatShop","fishing","pasture","weaver","winery","theater","university","observatory"],
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

const UPGRADE_DELAY = 10 * 60;

/* ── DOM ──────────────────────────────────────────────── */
const $ = s => document.querySelector(s);
const cv = $("#cv");
const ctx = cv.getContext("2d");
const mm = $("#minimap");
const mmc = mm ? mm.getContext("2d") : null;

/* ═══════════════════════════════════════════════════════
   初始化
   ═══════════════════════════════════════════════════════ */
