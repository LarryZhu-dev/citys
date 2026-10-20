'use strict';
const { fail } = require('./errors.cjs');
const RESOURCES = new Set(['grain','veg','fruit','fish','meat','wood','stone','clay','copper','brick','pottery','cloth','bread','wine']);
const BUILDING_SIZES = Object.freeze({ road:1,house:1,villa:2,well:1,watch:1,police:1,clinic:1,repair:1,temple:1,school:1,theater:1,
  grainShop:1,vegShop:1,fruitShop:1,fishShop:1,meatShop:1,farmland:2,vegFarm:2,orchard:2,fishing:1,pasture:2,lumber:2,
  quarry:2,clayPit:2,kiln:2,pottery:2,mill:2,weaver:2,winery:2,granary:2,warehouse:2,treeDeco:1,garden:2,monument:1,
  barracks:2,university:2,bath:2,observatory:2,harbor:2,market:2,copperMine:2,pagoda:2,sphinx:2,agora:2,windTower:2,sunTemple:2,wonder:3 });
const TERRAIN = new Set(['grass','sand','tree','stone','clay','water','copper']);
const CIVILIZATIONS = new Set(['china','egypt','greece','persia','aztec']);
const MAX_INVENTORY = 1000000000;
function invalid(message) { fail(400, 'INVALID_STATE', message); }
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${name} 必须是对象。`);
  return value;
}
function number(value, name, min = 0, max = MAX_INVENTORY, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) invalid(`${name} 数值超出允许范围。`);
  return value;
}
function text(value, name, max = 40, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max || /[<>\u0000-\u001f\u007f]/u.test(value)) invalid(`${name} 文本格式无效。`);
  return value.trim();
}
function position(value, width, height, name) {
  if (!Array.isArray(value) || value.length !== 2) invalid(`${name} 坐标无效。`);
  return [number(value[0], name, 0, width-1, true), number(value[1], name, 0, height-1, true)];
}
function recordNumbers(source, keys, name, min = 0) {
  const out = {};
  for (const key of keys) out[key] = number(source?.[key] ?? 0, `${name}.${key}`, min);
  return out;
}
function sanitizeState(raw) {
  object(raw, 'state');
  if (!Array.isArray(raw.tiles) || raw.tiles.length < 8 || raw.tiles.length > 96) invalid('城市地图尺寸无效。');
  const height = raw.tiles.length, width = raw.tiles[0]?.length;
  if (!Number.isInteger(width) || width < 8 || width > 96) invalid('城市地图尺寸无效。');
  const buildings = new Map();
  const occurrences = new Map();
  const tiles = raw.tiles.map((row, y) => {
    if (!Array.isArray(row) || row.length !== width) invalid('地图行宽必须一致。');
    return row.map((tile, x) => {
      object(tile, 'tile');
      if (!TERRAIN.has(tile.t)) invalid('不支持的地形。');
      let b = null;
      if (tile.b) {
        const input = object(tile.b, 'building');
        if (!Object.hasOwn(BUILDING_SIZES, input.type)) invalid('不支持的建筑类型。');
        const id = number(input.id, '建筑编号', 1, MAX_INVENTORY, true);
        const origin = input.origin ? position(input.origin, width, height, '建筑') : [x,y];
        const size = BUILDING_SIZES[input.type];
        if (origin[0]+size > width || origin[1]+size > height || x < origin[0] || x >= origin[0]+size || y < origin[1] || y >= origin[1]+size) invalid('建筑占地越界或重叠。');
        b = { type:input.type, id, origin };
        for (const key of ['pop','taxTimer','upTimer','missTicks','damage']) if (input[key] !== undefined) b[key] = number(input[key], `建筑.${key}`);
        if (input.productionTicks !== undefined) b.productionTicks = number(input.productionTicks, '生产阶段', 0, MAX_INVENTORY, true);
        if (input.lvl !== undefined) b.lvl = number(input.lvl, '建筑等级', 1, input.type === 'villa' ? 6 : 10, true);
        for (const key of ['staffed','idle','main']) if (input[key] !== undefined) {
          if (typeof input[key] !== 'boolean') invalid(`建筑.${key} 必须是布尔值。`);
          b[key] = input[key];
        }
        if (b.main && b.type !== 'road') invalid('主路标记只能用于道路。');
        if (input.construction) {
          const c = object(input.construction, '建设状态');
          b.construction = {total:number(c.total, '建设总时长', 0.01, 1000000),remaining:number(c.remaining, '建设剩余时长', 0, 1000000)};
          if (b.construction.remaining > b.construction.total) invalid('建设剩余时间超过总时长。');
          for (const key of ['fromLevel','toLevel']) if (c[key] !== undefined) b.construction[key] = number(c[key], '建设等级', 0, 10, true);
        }
        const prior = buildings.get(id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(b)) invalid('同一建筑的占地数据不一致。');
        buildings.set(id, b);
        occurrences.set(id, (occurrences.get(id) || 0)+1);
      }
      return { t:tile.t, b, variant:number(tile.variant ?? 0,'地块变体',0,3,true) };
    });
  });
  for (const [id,b] of buildings) if (occurrences.get(id) !== BUILDING_SIZES[b.type] ** 2) invalid('建筑占地不完整。');
  const civilization = raw.civilization || 'china';
  if (!CIVILIZATIONS.has(civilization)) invalid('文明不存在。');
  const mode = raw.mode || 'campaign';
  if (!['campaign','sandbox'].includes(mode)) invalid('游戏模式不存在。');
  const state = { v:4, version:4, civilization, mode, cityName:text(raw.cityName, '城市名称', 40, '新城'),
    tick:number(raw.tick ?? 0, 'tick', 0, 1e12, true),
    goods:recordNumbers(object(raw.goods, 'goods'), RESOURCES, 'goods'),
    gold:number(raw.gold, 'gold'), caps:recordNumbers(raw.caps, ['food','mat'], 'caps'),
    prestige:number(raw.prestige ?? 30, 'prestige', -100, 100),
    chapter:number(raw.chapter ?? 0, 'chapter', 0, 6, true),
    won:raw.won === true, uid:number(raw.uid ?? Math.max(0, ...buildings.keys()), 'uid', 0, MAX_INVENTORY, true),
    tiles, stats:recordNumbers(raw.stats, ['taxed','maxPop','totalBuilt','disasters'], 'stats'),
    pop:number(raw.pop ?? 0, 'pop'), workersAssigned:number(raw.workersAssigned ?? 0, 'workersAssigned'),
    taskDone:[], chapterCompleted:[], log:[], lastDelta:{} };
  if (raw.seed !== undefined) state.seed = typeof raw.seed === 'string' ? text(raw.seed,'seed',80) : number(raw.seed, 'seed', 0, 4294967295, true);
  if (raw.rngState !== undefined) state.rngState = number(raw.rngState, 'rngState', 0, 4294967295, true);
  for (const key of ['signpost','start']) if (raw[key]) {
    const pos = Array.isArray(raw[key]) ? raw[key] : [raw[key].x, raw[key].y];
    const [x,y] = position(pos, width, height, key);
    state[key] = { x,y };
  }
  if (raw.taskDone !== undefined) {
    if (!Array.isArray(raw.taskDone) || raw.taskDone.length > 12) invalid('章节任务数据无效。');
    state.taskDone = raw.taskDone.map(row => {
      if (!Array.isArray(row) || row.length > 30 || row.some(v => typeof v !== 'boolean')) invalid('章节任务数据无效。');
      return row;
    });
  }
  if (raw.chapterCompleted !== undefined) {
    if (!Array.isArray(raw.chapterCompleted) || raw.chapterCompleted.length > 12 || raw.chapterCompleted.some(v => typeof v !== 'boolean')) invalid('章节完成数据无效。');
    state.chapterCompleted = raw.chapterCompleted;
  }
  if (Array.isArray(raw.log)) state.log = raw.log.slice(-40).map(entry => ({msg:text(entry?.msg,'日志',400),cls:['good','bad','warn'].includes(entry?.cls) ? entry.cls : ''}));
  for (const key of [...RESOURCES,'gold']) if (raw.lastDelta?.[key] !== undefined) state.lastDelta[key] = number(raw.lastDelta[key], '产销变化', -MAX_INVENTORY);
  return state;
}
function sanitizeCity(raw, state, previous) {
  object(raw, 'city');
  if (typeof raw.public !== 'boolean') invalid('城市公开状态必须是布尔值。');
  return { id:previous?.id, name:text(raw.name, '城市名称', 40, state.cityName) || '新城', public:raw.public };
}
function publicState(state) { return { ...state, log:[] }; }
function citySummary(save, user) {
  const seen = new Set();
  let buildings = 0, housing = 0, wonders = 0;
  for (const row of save.state.tiles) for (const {b} of row) {
    if (!b || seen.has(b.id)) continue;
    seen.add(b.id);
    if (b.type !== 'road') buildings++;
    if (b.type === 'house' || b.type === 'villa') housing += b.lvl || 1;
    if (b.type === 'wonder' && !b.construction) wonders++;
  }
  const population = Math.floor(save.state.pop);
  return { id:save.city.id, name:save.city.name, owner:user.username, ownerId:user.id,
    civilization:save.state.civilization, mode:save.state.mode, population, buildings,
    score:population * 10 + housing * 20 + buildings * 5 + wonders * 10000,
    updatedAt:save.updatedAt };
}
module.exports = { RESOURCES, MAX_INVENTORY, sanitizeState, sanitizeCity, publicState, citySummary, number, text, object };
