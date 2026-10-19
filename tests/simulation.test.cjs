const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function game() {
  const fakeCanvas = { getContext: () => ({}) };
  const context = vm.createContext({ console, Math, JSON, Date, Map, Set,
    document: { querySelector: () => fakeCanvas }, window: {},
    toast() {}, log() {}, renderAll() {}, renderBuildList() {}, renderTasks() {}, save() {},
  });
  for (const name of ['data','civilizations','simulation']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',name+'.js'),'utf8'),context,{filename:name+'.js'});
  return { run: code => vm.runInContext(code,context), context };
}
function clean(g, civilization='greece') {
  g.run(`newGame({civilization:${JSON.stringify(civilization)},seed:'test',mode:'sandbox'});
    S.tiles = Array.from({length:MAP_H},()=>Array.from({length:MAP_W},()=>({t:'grass',b:null})));
    invalidateWorld();
    for(let x=0;x<35;x++) setRoad(x,10,x===0);
    var home=put(1,9,'house'); home.lvl=10; home.pop=96; S.pop=96;
    S.goods=Object.fromEntries(Object.keys(GOODS).map(k=>[k,100]));`);
}

test('seeded 64×64 world has water, all raw resources, and a viable connected start',()=>{
  const g=game();
  for(const civ of ['china','egypt','greece','persia','aztec']) {
    g.run(`newGame({civilization:'${civ}',seed:'same-world'});`);
    assert.equal(g.run('MAP_W*MAP_H'),4096);
    assert.equal(g.run('S.pop'),12);
    assert.equal(g.run("buildings().filter(o=>['house','farmland','lumber'].includes(o.b.type)).every(o=>connectedToMain(o.x,o.y,BUILD[o.b.type].size))"),true);
    for(const terrain of ['water','tree','stone','clay','copper']) assert.equal(g.run(`S.tiles.flat().some(t=>t.t==='${terrain}')`),true);
    const before=g.run('JSON.stringify(S.tiles.map(r=>r.map(t=>t.t)))');
    g.run(`newGame({civilization:'${civ}',seed:'same-world'});`);
    assert.equal(g.run('JSON.stringify(S.tiles.map(r=>r.map(t=>t.t)))'),before);
    g.run('for(let i=0;i<180;i++)simulate()');
    assert.equal(g.run('Object.values(S.goods).every(n=>Number.isFinite(n)&&n>=0)'),true);
    assert.ok(g.run('S.pop')>=12);
  }
});

test('construction requires a road and cannot produce goods or provide coverage before completion',()=>{
  const g=game(); clean(g);
  assert.equal(g.run("doBuild('well',5,9)"),true);
  assert.equal(g.run("!!coveredBy(5,9,'water')"),false);
  g.run('simulate()');
  assert.equal(g.run("tileAt(5,9).b.staffed"),false);
  g.run('for(let i=0;i<12;i++)simulate()');
  assert.equal(g.run("!!coveredBy(5,9,'water')"),true);
  g.run("doBuild('farmland',20,20)");
  const remaining=g.run('tileAt(20,20).b.construction.remaining');
  g.run('for(let i=0;i<30;i++)simulate()');
  assert.equal(g.run('tileAt(20,20).b.construction.remaining'),remaining);
  assert.equal(g.run('tileAt(20,20).b.idle'),true);
  g.run('for(let y=11;y<=20;y++)setRoad(19,y);for(let i=0;i<15;i++)simulate()');
  assert.equal(g.run('!!tileAt(20,20).b.construction'),false);
  assert.equal(g.run('tileAt(20,20).b.staffed'),true);
});

test('simultaneous factories reserve shared inputs rather than duplicating raw material',()=>{
  const g=game(); clean(g);
  g.run("put(4,11,'kiln');put(7,11,'pottery');S.goods.clay=3;S.goods.brick=0;S.goods.pottery=0;simulate();");
  assert.equal(g.run('S.goods.clay'),0);
  assert.equal(g.run('S.goods.brick+S.goods.pottery'),3);
  assert.equal(g.run("buildings().filter(o=>['kiln','pottery'].includes(o.b.type)&&o.b.idle).length"),1);
});

test('net resource change includes factory inputs, citizen consumption, production and treasury',()=>{
  const g=game(); clean(g);
  g.run("put(4,11,'kiln');put(7,11,'farmland');const before={...S.goods,gold:S.gold,pop:S.pop};simulate();");
  assert.equal(g.run("Object.keys(S.lastDelta).length"),g.run('Object.keys(GOODS).length+2'));
  assert.equal(g.run("Object.keys(S.lastDelta).every(k=>Math.abs(S.lastDelta[k]-((k==='gold'?S.gold:k==='pop'?S.pop:S.goods[k])-before[k]))<1e-9)"),true);
  assert.equal(g.run('S.lastDelta.clay'),-3);
  assert.ok(g.run('S.lastDelta.grain')>0);
});

test('shop pairing requires connected road, stock and current workers',()=>{
  const g=game(); clean(g);
  g.run("put(5,9,'grainShop');put(5,11,'grainShop');allocateWorkers(buildings());");
  assert.equal(g.run("shopPairCount('grain')"),1);
  assert.equal(g.run('evaluateNeeds(buildings().find(o=>o.b.type==="house")).map.grain'),true);
  g.run('S.goods.grain=0');
  assert.equal(g.run('evaluateNeeds(buildings().find(o=>o.b.type==="house")).map.grain'),false);
  g.run('S.goods.grain=100;destroyBuilding(5,10)');
  assert.equal(g.run("shopPairCount('grain')"),0);
  assert.equal(g.run("shopPairOk(buildings().find(o=>o.b.type==='grainShop'))"),false);
});

test('disconnecting a staffed service immediately removes coverage; labour never exceeds population',()=>{
  const g=game(); clean(g);
  g.run("put(5,9,'well');allocateWorkers(buildings());");
  assert.equal(g.run("!!coveredBy(2,9,'water')"),true);
  g.run('destroyBuilding(4,10)');
  assert.equal(g.run("!!coveredBy(2,9,'water')"),false);
  g.run("tileAt(1,9).b.pop=1;simulate()");
  assert.ok(g.run('S.workersAssigned')<=g.run('Math.floor(S.pop)'));
});

test('housing upgrades have a visible construction period and preserve residents',()=>{
  const g=game();
  g.run("newGame({seed:'upgrades'});put(48,13,'well');");
  g.run('for(let i=0;i<10;i++)simulate()');
  assert.equal(g.run('tileAt(47,13).b.lvl'),1);
  assert.equal(g.run('tileAt(47,13).b.construction.toLevel'),2);
  assert.equal(g.run('tileAt(47,13).b.pop'),6);
  g.run('for(let i=0;i<8;i++)simulate()');
  assert.equal(g.run('tileAt(47,13).b.lvl'),2);
  assert.equal(g.run('!!tileAt(47,13).b.construction'),false);
});

test('villas use six independent levels and all advanced needs exist in the building catalogue',()=>{
  const g=game(); clean(g);
  assert.equal(g.run("residenceLevels({type:'villa'}).length"),6);
  assert.equal(g.run("residenceLevel({type:'villa',lvl:6}).pop"),180);
  assert.equal(g.run("VILLA_LEVELS[5].needs.includes('university')&&VILLA_LEVELS[5].needs.includes('bath')&&VILLA_LEVELS[5].needs.includes('observatory')"),true);
  assert.equal(g.run("['university','bath','observatory'].every(need=>Object.values(BUILD).some(d=>d.provides===need))"),true);
});

test('saved multitile buildings rehydrate to one identity and demolish cleanly after reload',()=>{
  const g=game(); clean(g);
  g.run("put(4,11,'kiln');doBuild('market',7,11);const snapshot=JSON.parse(JSON.stringify(serializeState()));");
  assert.equal(g.run('hydrateState(snapshot)'),true);
  assert.equal(g.run('tileAt(4,11).b===tileAt(5,12).b'),true);
  assert.equal(g.run('tileAt(7,11).b===tileAt(8,12).b'),true);
  assert.equal(g.run("count('kiln')"),1);
  assert.equal(g.run('!!tileAt(7,11).b.construction'),true);
  g.run('destroyBuilding(5,12)');
  assert.equal(g.run('footprint(4,11,2).every(([, ,t])=>!t.b)'),true);
  assert.equal(g.run("count('kiln')"),0);
});

test('legacy saves expand to 64×64, preserve origins and reset all chapter flags on a new game',()=>{
  const g=game();
  g.run("newGame({seed:'old'});const legacy={tiles:S.tiles.slice(0,20).map(r=>r.slice(0,20)),chapter:2,goods:{grain:10},taskDone:[[],[],[]]};");
  assert.equal(g.run('hydrateState(legacy)'),true);
  assert.equal(g.run('MAP_W'),64);
  assert.equal(g.run('S.chapterCompleted[0]'),true);
  g.run("newGame({seed:'fresh'})");
  assert.equal(g.run('S.chapterCompleted.some(Boolean)'),false);
  assert.equal(g.run('S.taskDone.flat().some(Boolean)'),false);
});

test('civilizations alter their stated economies and restrict exclusive landmarks',()=>{
  const g=game(); clean(g,'persia');
  assert.ok(Math.abs(g.run("tradePrice('wood','buy')")-2.4)<1e-9);
  assert.equal(g.run('S.caps.mat'),13250);
  assert.equal(g.run("currentUnlocked().has('windTower')"),true);
  assert.equal(g.run("currentUnlocked().has('pagoda')"),false);
  clean(g,'aztec');
  g.run("put(4,11,'farmland')");
  assert.equal(g.run("productionMultiplier(buildings().find(o=>o.b.type==='farmland'))"),1.25);
  clean(g,'china');
  assert.equal(g.run('civilizationBonus("construction")'),0.85);
});

test('trades conserve resources, reject invalid amounts and respect storage limits',()=>{
  const g=game(); clean(g);
  g.run('S.gold=100;S.goods.wood=0');
  assert.equal(g.run("tradeGoods('wood',10,'buy').ok"),true);
  assert.equal(g.run('S.gold'),70);
  assert.equal(g.run('S.goods.wood'),10);
  assert.equal(g.run("tradeGoods('wood',-5,'sell').ok"),false);
  assert.equal(g.run("tradeGoods('wood',100,'sell').ok"),false);
  assert.equal(g.run("tradeGoods('wood',5,'sell').ok"),true);
  assert.equal(g.run('S.goods.wood'),5);
  g.run('S.goods.wood=S.caps.mat');
  assert.equal(g.run("tradeGoods('wood',1,'buy').ok"),false);
});

test('shoreline restrictions and bridges match placement rules',()=>{
  const g=game(); clean(g);
  g.run("tileAt(5,11).t='water'");
  assert.equal(g.run("canBuildAt('house',5,11).ok"),false);
  assert.equal(g.run("canBuildAt('road',5,11).ok"),true);
  assert.equal(g.run("canBuildAt('harbor',6,11).ok"),true);
  assert.equal(g.run("canBuildAt('harbor',20,20).ok"),false);
  assert.equal(g.run("canBuildAt('fishing',4,11).ok"),true);
});

test('victory requires completed wonder and simulation continues after victory',()=>{
  const g=game(); clean(g);
  g.run('S.goods.wood=S.goods.stone=1000;S.goods.brick=200');
  assert.equal(g.run("doBuild('wonder',10,11)"),true);
  assert.equal(g.run('S.won'),false);
  assert.equal(g.run("count('wonder')"),0);
  g.run('for(let i=0;i<90;i++)simulate()');
  assert.equal(g.run('S.won'),true);
  assert.equal(g.run("count('wonder')"),1);
  const tick=g.run('S.tick');g.run('simulate()');assert.equal(g.run('S.tick'),tick+1);
});


test('a new city reaches all six chapters using only its legal starting budget and natural economy',()=>{
  const g=game();
  g.run(`
newGame({civilization:'china',seed:'campaign-integration'});
// No extra stock, gold, population, or buildings are injected into this playthrough.
function route(x,y,size){
 const footprintCells=new Set(footprint(x,y,size).map(([xx,yy])=>xx+','+yy));
 const q=[],seen=new Set(),parents=new Map();
 for(const [xx,yy]of footprint(x,y,size))for(const [dx,dy]of DIRS){const nx=xx+dx,ny=yy+dy;if(!inB(nx,ny)||footprintCells.has(nx+','+ny))continue;if(tileAt(nx,ny).b&&tileAt(nx,ny).b.type!=='road')continue;const key=nx+','+ny;if(!seen.has(key)){seen.add(key);q.push([nx,ny]);}}
 let end=null;
 for(let i=0;i<q.length;i++){const [xx,yy]=q[i],key=xx+','+yy;if(roadNetwork()[yy][xx]){end=key;break;}for(const[dx,dy]of DIRS){const nx=xx+dx,ny=yy+dy,nk=nx+','+ny;if(!inB(nx,ny)||seen.has(nk)||footprintCells.has(nk))continue;const b=tileAt(nx,ny).b;if(b&&b.type!=='road')continue;seen.add(nk);parents.set(nk,key);q.push([nx,ny]);}}
 if(!end)throw Error('no route');while(end){const [xx,yy]=end.split(',').map(Number);if(!tileAt(xx,yy).b)doBuild('road',xx,yy);end=parents.get(end);}
}
function build(type,x,y){route(x,y,BUILD[type].size);if(!doBuild(type,x,y))throw Error('build failed '+type+' '+x+','+y+' '+canBuildAt(type,x,y).why);}
function findBuild(type,tx,ty){const choices=[];for(let y=2;y<60;y++)for(let x=2;x<60;x++)if(canBuildAt(type,x,y).ok)choices.push([x,y,Math.abs(x-tx)+Math.abs(y-ty)]);choices.sort((a,b)=>a[2]-b[2]);if(!choices.length)throw Error('no spot '+type);build(type,choices[0][0],choices[0][1]);}
function waitNext(ch,max=1200){for(let i=0;i<max&&S.chapter===ch;i++)simulate();if(S.chapter===ch)throw Error('stuck chapter '+ch+' '+JSON.stringify(buildings().filter(o=>isResidence(o.b)).map(o=>({p:o.b.pop,l:o.b.lvl,need:evaluateNeeds(o).nextMissing,curr:evaluateNeeds(o).missing,clean:netBeauty(o.x,o.y)}))));}
build('well',48,13);for(const[x,y]of[[48,15],[49,15],[51,13],[51,15],[52,13],[52,15]])build('house',x,y);
waitNext(0);
build('grainShop',49,12);build('grainShop',51,12);findBuild('watch',52,12);findBuild('quarry',51,22);findBuild('granary',43,18);findBuild('warehouse',42,22);
waitNext(1);
findBuild('clayPit',51,26);findBuild('kiln',54,28);build('vegShop',49,16);build('vegShop',51,16);findBuild('vegFarm',44,20);findBuild('farmland',42,24);findBuild('clinic',52,16);findBuild('temple',52,17);findBuild('garden',54,13);
waitNext(2);
findBuild('pottery',55,30);findBuild('orchard',42,27);build('fruitShop',49,18);build('fruitShop',51,18);findBuild('school',53,12);findBuild('market',54,16);
waitNext(3);
findBuild('fishing',56,20);findBuild('fishing',56,19);findBuild('pasture',43,30);findBuild('weaver',47,30);findBuild('winery',50,32);findBuild('vegFarm',40,22);findBuild('orchard',40,28);findBuild('theater',53,17);
findBuild('farmland',40,32);findBuild('farmland',43,34);
// Existing road pairs can be chosen in the outer city; central market serves the homes.
function pair(type){for(let y=7;y<35;y++)for(let x=39;x<60;x++){if(tileAt(x,y)?.b?.type==='road'&&canBuildAt(type,x-1,y).ok&&canBuildAt(type,x+1,y).ok){build(type,x-1,y);build(type,x+1,y);return;}}throw Error('no pair '+type);}
pair('fishShop');pair('meatShop');
waitNext(4,2400);
findBuild('wonder',57,10);for(let i=0;i<100;i++)simulate();
`);
  assert.equal(g.run('S.won'),true);
  assert.equal(g.run('S.chapterCompleted.every(Boolean)'),true);
  assert.equal(g.run('Object.values(S.goods).every(v=>Number.isFinite(v)&&v>=0)'),true);
  assert.ok(g.run('S.stats.maxPop')>=240);
});


test('relocation preserves identity, residents, level and shared footprint with a small fee',()=>{
  const g=game(); clean(g);
  g.run("var villa=put(4,11,'villa');villa.lvl=3;villa.pop=64;var oldId=villa.id;var oldWood=S.goods.wood;");
  assert.equal(g.run('canMoveBuilding(5,12,5,11).ok'),true);
  assert.equal(g.run('moveBuilding(5,12,5,11)'),true);
  assert.equal(g.run('tileAt(5,11).b.id'),g.run('oldId'));
  assert.equal(g.run('tileAt(5,11).b===tileAt(6,12).b'),true);
  assert.equal(g.run('tileAt(4,11).b'),null);
  assert.equal(g.run('tileAt(5,11).b.pop'),64);
  assert.equal(g.run('tileAt(5,11).b.lvl'),3);
  assert.equal(g.run('oldWood-S.goods.wood'),9);
});

test('relocation validates occupancy, resource terrain, costs and roads without altering failed moves',()=>{
  const g=game(); clean(g);
  g.run("var building=put(4,11,'farmland');building.construction={total:12,remaining:7};var beforeMove=JSON.stringify(serializeState());");
  assert.equal(g.run('moveBuilding(4,11,1,9)'),false);
  assert.equal(g.run('moveBuilding(4,11,20,20)'),false);
  assert.equal(g.run('JSON.stringify(serializeState())===beforeMove'),true);
  assert.equal(g.run('moveBuilding(4,11,6,11)'),true);
  assert.equal(g.run('tileAt(6,11).b.construction.remaining'),7);
  g.run("tileAt(10,11).t='stone';put(10,11,'quarry')");
  assert.equal(g.run('canMoveBuilding(10,11,15,11).ok'),false);
  assert.equal(g.run('canMoveBuilding(0,10,0,11).ok'),false);
  g.run('S.goods.wood=0');
  assert.equal(g.run('canMoveBuilding(6,11,8,11).ok'),false);
});
