'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function game() {
  const storage = new Map();
  const noop = () => {};
  const nodes = new Map();
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [1000000])); }
    static now() { return 1000000; }
  }
  const context = vm.createContext({
    console, Date: ClockDate, Math, JSON, Map, Set,
    document: {
      documentElement: {},
      querySelector(selector) {
        if (!nodes.has(selector)) nodes.set(selector, { getContext: () => ({}), addEventListener: noop, focus: noop, click: noop });
        return nodes.get(selector);
      },
    },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    matchMedia: () => ({ matches: false }), getComputedStyle: () => ({ getPropertyValue: () => '0' }),
    setInterval: noop, setTimeout: noop, addEventListener: noop,
  });
  context.window = context;
  for (const file of ['data', 'civilizations', 'simulation', 'godot-bridge']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file + '.js'), 'utf8'), context, { filename: file + '.js' });
  }
  const run = code => vm.runInContext(code, context);
  run("newGame({seed:'bridge-reset',cityName:'原城',mode:'sandbox'});bridgeBooting=false;cityHasSave=true;");
  return { run, set: (key, value) => { context[key] = value; }, json: code => JSON.parse(run('JSON.stringify(' + code + ')')) };
}

function assertOrdinaryMapClick(g, cityName) {
  assert.equal(g.run('S.cityName'), cityName, 'The requested destination city was loaded');
  const before = g.json('({goods:S.goods,buildings:buildings().map(({x,y,b})=>({x,y,id:b.id,type:b.type}))})');
  assert.equal(g.run('tileAt(47,13).b.type'), 'house');
  assert.equal(g.run('tileAt(48,13).b'), null, 'The destination tile starts empty');
  assert.equal(g.run("CityBridge.dispatch('tile',{x:48,y:13})"), true);
  assert.equal(g.run('tileAt(47,13).b?.type'), 'house', 'A normal map tap must not move the old origin building');
  assert.equal(g.run('tileAt(48,13).b'), null, 'A normal map tap must not place or move a building');
  assert.deepEqual(g.json('S.goods'), before.goods, 'A normal map tap must not charge any construction or relocation materials');
  assert.deepEqual(g.json('buildings().map(({x,y,b})=>({x,y,id:b.id,type:b.type}))'), before.buildings, 'Every building retains its identity and location');
}

for (const pending of ['move', 'build']) {
  test(`loading a manual slot clears an unfinished ${pending} before the next map tap`, () => {
    const g = game();
    g.run("S.cityName='档案城';save('wan-city-slot-1');S.cityName='原城';");
    g.run(pending === 'move' ? "CityBridge.dispatch('move',{x:47,y:13})" : "CityBridge.dispatch('select_tool',{type:'well'})");
    assert.equal(g.run("CityBridge.dispatch('load',{slot:1})"), true);
    assertOrdinaryMapClick(g, '档案城');
  });

  test(`founding a new city clears an unfinished ${pending} before the next map tap`, () => {
    const g = game();
    g.run(pending === 'move' ? "CityBridge.dispatch('move',{x:47,y:13})" : "CityBridge.dispatch('select_tool',{type:'well'})");
    assert.equal(g.run("CityBridge.dispatch('new_city',{cityName:'新城',seed:'bridge-reset-new',mode:'sandbox'})"), true);
    assertOrdinaryMapClick(g, '新城');
  });

  test(`importing a city file clears an unfinished ${pending} before the next map tap`, async () => {
    const g = game();
    const incoming = g.json('serializeState()');
    incoming.cityName = '导入城';
    const contents = JSON.stringify(incoming);
    g.set('incomingFile', { size: Buffer.byteLength(contents), text: async () => contents });
    g.run(pending === 'move' ? "CityBridge.dispatch('move',{x:47,y:13})" : "CityBridge.dispatch('select_tool',{type:'well'})");
    await g.run('importSaveFile(incomingFile)');
    assertOrdinaryMapClick(g, '导入城');
  });
}

test('Godot receives authoritative construction sites and freezes them for pause, visits and online transactions', () => {
  const g = game();
  g.run("doBuild('well',48,13);speed=1;step(9);");
  const construction = () => g.json('JSON.parse(snapshot()).constructionSites');
  const active = construction();
  assert.equal(active.length, 1);
  assert.equal(active[0].active, true);
  assert.equal(active[0].workers[0].phase, 'carrying');
  assert.equal(active[0].elapsed, 9);
  for (const pause of [
    'speed=0;',
    "speed=1;window.OnlineUI={visiting:true,opened:false};",
    "speed=1;window.OnlineUI={visiting:false,opened:true};",
  ]) {
    g.run(pause);
    const frozen = construction();
    assert.equal(frozen[0].active, false);
    assert.equal(frozen[0].paused, true);
    assert.ok(frozen[0].workers.every(worker => !worker.active));
    assert.deepEqual(frozen[0].workers.map(worker => worker.position), active[0].workers.map(worker => worker.position));
  }
  g.run('window.OnlineUI={visiting:false,opened:false};');
  assert.deepEqual(construction(), active);
});
