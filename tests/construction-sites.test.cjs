'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function game() {
  const context = vm.createContext({
    console, Date, Math, JSON, Map, Set,
    document: { querySelector: () => ({ getContext: () => ({}) }) },
    window: {}, toast() {}, log() {}, save() {}, renderAll() {},
  });
  for (const name of ['data', 'civilizations', 'simulation']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + name + '.js'), 'utf8'), context);
  }
  const run = code => vm.runInContext(code, context);
  run("newGame({civilization:'china',seed:'construction-crew',mode:'sandbox',nowMs:1000000});doBuild('well',48,13);var project=tileAt(48,13).b;");
  return {
    run,
    json: code => JSON.parse(run('JSON.stringify(' + code + ')')),
    site: () => JSON.parse(run('JSON.stringify(constructionSitesSnapshot().find(s=>s.buildingId===project.id))')),
    set: (key, value) => { context[key] = value; },
  };
}
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('crew follows the actual paid project, carries to a work point, installs, then returns empty', () => {
  const g = game();
  const initial = g.site();
  assert.equal(initial.workerCount, 2);
  assert.equal(initial.active, true);
  assert.deepEqual(initial.roadAccess, [48, 14]);
  assert.deepEqual(initial.workers[0].position, initial.materialPoint);
  assert.equal(initial.workers[1].active, false, 'Second worker has not arrived before its deterministic start delay');
  g.run('step(9)');
  const carrying = g.site();
  assert.equal(carrying.elapsed, 9);
  assert.equal(carrying.workers[0].phase, 'carrying');
  assert.equal(carrying.workers[0].phaseProgress, .5);
  assert.equal(carrying.workers[0].isLoaded, true);
  assert.ok(distance(carrying.workers[0].position, initial.materialPoint) > 0);
  g.run('step(5)');
  const installing = g.site();
  assert.equal(installing.workers[0].phase, 'installing');
  assert.deepEqual(installing.workers[0].position, installing.installationPoints[0]);
  g.run('step(12)');
  const returning = g.site();
  assert.equal(returning.workers[0].phase, 'returning');
  assert.equal(returning.workers[0].isLoaded, false);
  assert.deepEqual(returning.workers[0].position, installing.workers[0].position);
  g.run('step(10)');
  const next = g.site();
  assert.equal(next.workers[0].cycleIndex, 1);
  assert.equal(next.workers[0].targetIndex, initial.workerCount);
  assert.deepEqual(next.workers[0].position, initial.materialPoint);
  assert.equal(next.id, initial.id, 'A carry cycle cannot become a new economic project');
});

test('snapshots are observational and suspension freezes both progress and the crew', () => {
  const g = game();
  g.run('step(11)');
  const before = g.json('serializeState()');
  const site = g.site();
  for (let i = 0; i < 10; i++) assert.deepEqual(g.site(), site);
  assert.deepEqual(g.json('serializeState()'), before, 'Rendering must not charge, create tasks or advance clocks');
  g.run('advanceClock(1009000,{suspended:true})');
  const paused = g.json('constructionSitesSnapshot({suspended:true})[0]');
  assert.equal(paused.active, false);
  assert.equal(paused.paused, true);
  assert.ok(paused.workers.every(worker => !worker.active));
  assert.equal(paused.elapsed, site.elapsed);
  assert.deepEqual(paused.workers.map(worker => worker.position), site.workers.map(worker => worker.position));
  assert.equal(g.run('project.construction.remaining'), before.tiles[13][48].b.construction.remaining);
});

test('cutting the approach stops work at its current position until a real road returns', () => {
  const g = game();
  g.run('step(19)');
  const working = g.site();
  g.run('destroyBuilding(48,14);step(600)');
  const blocked = g.site();
  assert.equal(blocked.active, false);
  assert.equal(blocked.roadAccess, null);
  assert.equal(blocked.blockedReason, '道路未连接主路');
  assert.equal(blocked.elapsed, working.elapsed);
  assert.deepEqual(blocked.workers.map(worker => worker.position), working.workers.map(worker => worker.position));
  assert.equal(blocked.id, working.id);
  g.run('setRoad(48,14)');
  assert.deepEqual(g.site().workers.map(worker => worker.position), working.workers.map(worker => worker.position));
  g.run('step(2)');
  assert.equal(g.site().elapsed, working.elapsed + 2);
  g.run('destroyBuilding(50,1);step(600)');
  assert.equal(g.site().active, false, 'A road tile beside the site is insufficient when disconnected from the main road');
  assert.equal(g.site().elapsed, working.elapsed + 2);
});

test('an isolated project creates no arriving crew; connecting it creates deterministic site routes', () => {
  const g = game();
  g.run("doBuild('house',30,10);var isolated=tileAt(30,10).b;");
  const unserved = g.json('constructionSitesSnapshot().find(s=>s.buildingId===isolated.id)');
  assert.equal(unserved.workerCount, 0);
  assert.equal(unserved.active, false);
  assert.equal(unserved.supplyMode, 'waiting');
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(g.json('constructionSitesSnapshot().find(s=>s.buildingId===isolated.id)'), unserved, 'Observing an isolated site cannot summon a crew');
  }
  g.run('for(let x=30;x<=50;x++)if(!tileAt(x,9).b)setRoad(x,9);');
  const connected = g.json('constructionSitesSnapshot().find(s=>s.buildingId===isolated.id)');
  assert.equal(connected.active, true);
  assert.ok(connected.workers.length > 0);
  assert.deepEqual(connected.workers[0].position, connected.roadAccess);
});

test('completion has one continuous exit, then disappears without replaying or creating a save job', () => {
  const g = game();
  g.run('step(project.construction.total-.01,{constructionOnly:true})');
  const last = g.site();
  g.run('step(.01,{constructionOnly:true})');
  const finished = g.site();
  assert.equal(finished.id, last.id);
  assert.equal(finished.finished, true);
  assert.equal(finished.progress, 1);
  assert.equal(finished.exitElapsed, 0);
  assert.ok(finished.workers.every(worker => worker.phase === 'leaving' && !worker.isLoaded));
  for (let i = 0; i < last.workers.length; i++) {
    assert.ok(distance(last.workers[i].position, finished.workers[i].position) < .02, 'Completion starts at the current work position');
  }
  const saved = g.json('serializeState()');
  assert.equal(saved.constructionSites, undefined);
  assert.equal(saved.tiles[13][48].b.construction, undefined);
  g.run('step(6,{constructionOnly:true})');
  const exiting = g.site();
  assert.equal(exiting.exitElapsed, 6);
  assert.ok(exiting.workers.every(worker => worker.phaseProgress === .5));
  g.run('advanceClock(1006000,{suspended:true})');
  assert.equal(g.site().exitElapsed, 6, 'Suspension does not consume the exit interval');
  g.run('step(6,{constructionOnly:true})');
  assert.deepEqual(g.json('constructionSitesSnapshot()'), []);
  g.run('step(60)');
  assert.deepEqual(g.json('constructionSitesSnapshot()'), []);
  assert.equal(g.run('!!project.construction'), false);
});

test('save reload preserves active worker phase and city changes discard old exit records', () => {
  const g = game();
  g.run('step(49)');
  const current = g.site(), saved = g.json('serializeState()');
  g.set('saved', saved);
  assert.equal(g.run('hydrateState(saved,{applyOffline:false})'), true);
  g.run('project=tileAt(48,13).b;');
  assert.deepEqual(g.site(), current);
  g.run('step(project.construction.remaining,{constructionOnly:true})');
  assert.equal(g.site().finished, true);
  const completed = g.json('serializeState()');
  g.set('completed', completed);
  g.run('hydrateState(completed,{applyOffline:false});');
  assert.deepEqual(g.json('constructionSitesSnapshot()'), [], 'Loading a completed city never replays work');
  g.run("newGame({seed:'construction-crew',mode:'sandbox',nowMs:1000000});");
  assert.deepEqual(g.json('constructionSitesSnapshot()'), []);
});

test('upgrades retain engineering progress and have a distinct stable project identity', () => {
  const g = game();
  g.run("var home=tileAt(47,13).b;home.construction={total:600,remaining:400,fromLevel:1,toLevel:2};");
  const site = g.json('constructionSitesSnapshot().find(s=>s.buildingId===home.id)');
  assert.equal(site.fromLevel, 1);
  assert.equal(site.toLevel, 2);
  assert.equal(site.elapsed, 200);
  const saved = g.json('serializeState()');
  g.set('saved', saved);
  g.run('hydrateState(saved,{applyOffline:false});home=tileAt(47,13).b;');
  assert.deepEqual(g.json('constructionSitesSnapshot().find(s=>s.buildingId===home.id)'), site);
  g.run('home.construction={total:900,remaining:900,fromLevel:2,toLevel:3};home.lvl=2;');
  assert.notEqual(g.json('constructionSitesSnapshot().find(s=>s.buildingId===home.id)').id, site.id);
});

test('offline and never-observed completions cannot manufacture retrospective exit workers', () => {
  const g = game();
  g.run('step(project.construction.remaining,{constructionOnly:true})');
  assert.deepEqual(g.json('constructionSitesSnapshot()'), []);
  const h = game();
  h.site();
  h.run('advanceClock(1000000+3600000,{offline:true})');
  assert.deepEqual(h.json('constructionSitesSnapshot()'), []);
});
