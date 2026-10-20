const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function game(){
 const context=vm.createContext({console,Date,Math,JSON,Map,Set,document:{querySelector:()=>({getContext:()=>({})})},window:{},toast(){},log(){},save(){},renderAll(){},renderBuildList(){},renderTasks(){}});
 for(const name of ['data','civilizations','simulation'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/'+name+'.js'),'utf8'),context);
 return {context,run:code=>vm.runInContext(code,context),set:(name,value)=>context[name]=value};
}
function fresh(g,mode='campaign'){g.run(`newGame({civilization:'china',seed:'clock',mode:'${mode}',nowMs:1000000})`);}
function factoryCity(g){
 fresh(g,'sandbox');g.run(`S.tiles=Array.from({length:64},()=>Array.from({length:64},()=>({t:'grass',b:null})));invalidateWorld();
 for(let x=0;x<20;x++)setRoad(x,10,x===0);var home=put(1,9,'house');home.pop=6;S.pop=6;
 var factory=put(4,11,'kiln');S.goods.clay=30;S.goods.brick=0;allocateWorkers(buildings());updateCaps();`);
}
function snapshot(g){return JSON.parse(g.run('JSON.stringify(serializeState())'));}
function economy(g){return JSON.parse(g.run('JSON.stringify({tick:S.tick,goods:S.goods,pop:S.pop,gold:S.gold,stats:S.stats,prestige:S.prestige,buildings:buildings().filter(o=>o.b.type!=="road").map(o=>o.b)})'));}

test('campaign advances real seconds and ignores fast-forward or visual pause',()=>{
 const g=game();fresh(g);g.run("doBuild('well',48,13)");
 const duration=g.run('tileAt(48,13).b.construction.total');
 assert.ok(duration>=120);
 g.run('advanceClock(1001000,{speed:60})');
 assert.equal(g.run('tileAt(48,13).b.construction.remaining'),duration-1);
 assert.equal(g.run('S.tick'),0);
 assert.equal(g.run('S.goods.grain'),160);
 g.run('advanceClock(1002000,{speed:0})');
 assert.equal(g.run('tileAt(48,13).b.construction.remaining'),duration-2);
});

test('construction completes at its real deadline and a disconnected queue freezes',()=>{
 const g=game();fresh(g);g.run("doBuild('well',48,13);step(constructionDuration('well')-.5)");
 assert.ok(g.run('tileAt(48,13).b.construction.remaining')>0);
 g.run('step(.5)');assert.equal(g.run('!!tileAt(48,13).b.construction'),false);
 g.run("doBuild('house',20,20);var remaining=tileAt(20,20).b.construction.remaining;step(86400,{constructionOnly:true})");
 assert.equal(g.run('tileAt(20,20).b.construction.remaining'),g.run('remaining'));
 assert.equal(g.run('tileAt(20,20).b.idle'),true);
});

test('agriculture requires a thirty-minute batch, with consumption using the same minute scale',()=>{
 const g=game();fresh(g);
 const yieldAmount=g.run("BUILD.farmland.prod.grain*30*productionMultiplier(buildings().find(o=>o.b.type==='farmland'))");
 g.run('step(1799)');assert.equal(g.run('tileAt(45,15).b.productionTicks||0'),0);
 assert.ok(g.run('productionProgress(tileAt(45,15).b).progress')>.99);
 g.run('step(1)');assert.equal(g.run('tileAt(45,15).b.productionTicks'),1);
 assert.ok(Math.abs(g.run('S.goods.grain')-(160+yieldAmount-12*.035*30))<1e-8);
});

test('reserved industrial inputs survive pauses without duplicate output or input charges',()=>{
 const g=game();factoryCity(g);g.run('step(60)');
 assert.equal(g.run('S.goods.clay'),0);
 assert.equal(g.run('S.goods.brick'),0);
 g.run('step(120);var progress=factory.production.elapsed;destroyBuilding(3,10);step(1800)');
 assert.equal(g.run('factory.production.elapsed'),g.run('progress'));
 assert.equal(g.run('S.goods.brick'),0);
 g.run('setRoad(3,10);step(8*60)');
 assert.ok(Math.abs(g.run('S.goods.brick')-34.5)<1e-8);
 assert.equal(g.run('S.goods.clay'),0);
 assert.equal(g.run('factory.productionTicks'),1);
});

test('losing workers or filling storage freezes a retained production batch',()=>{
 const g=game();factoryCity(g);g.run('step(60);home.pop=1;step(60)');
 assert.equal(g.run('factory.production.elapsed'),0);
 assert.equal(g.run('factory.idle'),true);
 g.run('home.pop=6;S.goods.brick=S.caps.mat;step(600)');
 assert.equal(g.run('factory.production.elapsed'),0);
 g.run('S.goods.brick=0;step(600)');
 assert.equal(g.run('factory.productionTicks'),1);
 assert.ok(Math.abs(g.run('S.goods.brick')-34.5)<1e-8);
});

test('frequent online frames and one offline catch-up produce identical economic results',()=>{
 const a=game(),b=game();fresh(a);a.run("doBuild('well',48,13)");b.set('saved',snapshot(a));
 b.run('hydrateState(saved,{nowMs:1000000,applyOffline:false})');
 a.run('for(let ms=1010000;ms<=8200000;ms+=10000)advanceClock(ms)');
 b.run('advanceClock(8200000,{offline:true})');
 assert.deepEqual(economy(a),economy(b));
});

test('offline income and needs cap at eight hours while already queued construction continues',()=>{
 const a=game(),b=game();fresh(a);a.run("S.chapter=5;S.goods.wood=500;S.goods.stone=500;S.goods.brick=150;doBuild('wonder',51,15)");
 b.set('saved',snapshot(a));b.run('hydrateState(saved,{nowMs:1000000,applyOffline:false})');
 a.run('advanceClock(1000000+24*3600000,{offline:true})');b.run('advanceClock(1000000+8*3600000,{offline:true})');
 assert.equal(a.run('S.tick'),480);
 for(const field of ['goods','pop','gold','prestige'])assert.equal(a.run(`JSON.stringify(S.${field})`),b.run(`JSON.stringify(S.${field})`));
 assert.equal(a.run('tileAt(51,15).b.construction.remaining'),a.run("constructionDuration('wonder')-24*3600"));
 assert.equal(a.run('S.offlineSummary.capped'),true);
 a.run('advanceClock(1000000+24*3600000,{offline:true})');assert.equal(a.run('S.tick'),480);
});

test('long absences advance at most 72 hours of construction and can complete a wonder',()=>{
 const g=game();fresh(g);g.run("S.chapter=5;S.goods.wood=500;S.goods.stone=500;S.goods.brick=150;doBuild('wonder',51,15);advanceClock(1000000+30*86400000,{offline:true})");
 assert.equal(g.run('S.won'),true);
 assert.equal(g.run('S.tick'),480);
 assert.equal(g.run('S.offlineSummary.constructionSeconds'),72*3600);
 assert.equal(g.run('S.clock.elapsedSeconds'),72*3600);
});

test('suspended online transactions consume wall time without replaying it on resume',()=>{
 const g=game();fresh(g);g.run("doBuild('well',48,13);var stateBefore=JSON.stringify({goods:S.goods,construction:tileAt(48,13).b.construction});advanceClock(1000000+2*3600000,{suspended:true})");
 assert.equal(g.run('JSON.stringify({goods:S.goods,construction:tileAt(48,13).b.construction})'),g.run('stateBefore'));
 g.run('advanceClock(1000000+2*3600000+60000)');
 assert.equal(g.run('S.tick'),1);
 assert.equal(g.run('S.clock.elapsedSeconds'),60);
});

test('backward wall-clock changes and repeated catch-up cannot replay rewards',()=>{
 const g=game();fresh(g);g.run('advanceClock(2000000);var first=JSON.stringify({goods:S.goods,gold:S.gold,tick:S.tick});advanceClock(1000000);advanceClock(2000000)');
 assert.equal(g.run('JSON.stringify({goods:S.goods,gold:S.gold,tick:S.tick})'),g.run('first'));
 assert.equal(g.run('S.clock.lastWallMs'),2000000);
});

test('sandbox acceleration is explicit, its pause consumes time, and offline time is not accelerated',()=>{
 const g=game();fresh(g,'sandbox');g.run('advanceClock(1001000,{speed:60})');assert.equal(g.run('S.tick'),1);
 g.run('advanceClock(1011000,{speed:0})');assert.equal(g.run('S.tick'),1);
 g.run('advanceClock(1071000,{speed:60,offline:true})');assert.equal(g.run('S.tick'),2);
});

test('legacy snapshots preserve city and progress without awarding historical offline income',()=>{
 const g=game();fresh(g);g.run("doBuild('well',48,13);var old=JSON.parse(JSON.stringify(serializeState()));delete old.clock;old.version=4;old.tick=100;old.tiles[13][48].b.construction={total:9,remaining:4.5};old.tiles[13][47].b.taxTimer=3;");
 const goods=g.run('JSON.stringify(S.goods)');g.run('hydrateState(old,{nowMs:9999999999})');
 assert.equal(g.run('JSON.stringify(S.goods)'),goods);
 assert.equal(g.run('S.clock.lastWallMs'),9999999999);
 assert.equal(g.run('tileAt(48,13).b.construction.remaining'),g.run("constructionDuration('well')/2"));
 assert.equal(g.run('tileAt(47,13).b.taxTimer'),180);
 assert.equal(g.run('S.pop'),12);
 assert.equal(g.run('S.tick'),100);
});

test('read-only hydration leaves time untouched and deep snapshots retain batch and queue identities',()=>{
 const g=game();factoryCity(g);g.run("step(180);doBuild('well',6,9);var saved=serializeState();var progress=saved.tiles[11][4].b.production.elapsed;var remaining=saved.tiles[9][6].b.construction.remaining;step(60)");
 assert.equal(g.run('saved.tiles[11][4].b.production.elapsed'),g.run('progress'));
 assert.equal(g.run('saved.tiles[9][6].b.construction.remaining'),g.run('remaining'));
 g.run('hydrateState(saved,{nowMs:9999999999,applyOffline:false})');
 assert.equal(g.run('S.clock.lastWallMs'),1000000);
 assert.equal(g.run('factory=tileAt(4,11).b;factory.production.elapsed'),g.run('progress'));
 assert.equal(g.run('tileAt(4,11).b===tileAt(5,12).b'),true);
 assert.equal(g.run('S.goods.clay'),0);
});


test('service environment caches follow completion, labour, damage, relocation and road changes',()=>{
 const g=game();factoryCity(g);g.run("doBuild('well',6,9);var houseObject=buildings().find(o=>o.b.type==='house')");
 assert.equal(g.run('evaluateNeeds(houseObject).map.water'),false);
 g.run("step(constructionDuration('well')+60)");assert.equal(g.run('evaluateNeeds(houseObject).map.water'),false); // outside four-tile radius
 g.run("moveBuilding(6,9,3,9)");assert.equal(g.run('evaluateNeeds(houseObject).map.water'),true);
 g.run('home.pop=1;S.pop=1;allocateWorkers(buildings())');assert.equal(g.run('evaluateNeeds(houseObject).map.water'),false);
 g.run('home.pop=6;S.pop=6;allocateWorkers(buildings())');assert.equal(g.run('evaluateNeeds(houseObject).map.water'),true);
 g.run('tileAt(3,9).b.damage=60;allocateWorkers(buildings())');assert.equal(g.run('evaluateNeeds(houseObject).map.water'),false);
 g.run('step(60)');assert.equal(g.run('evaluateNeeds(houseObject).map.water'),true);
 g.run('destroyBuilding(2,10)');assert.equal(g.run('evaluateNeeds(houseObject).map.water'),false);
});

test('the public simulate entry point reads the wall clock instead of inventing elapsed ticks',()=>{
 const g=game();fresh(g);g.run('Date={now:()=>1001000};simulate()');
 assert.equal(g.run('S.clock.elapsedSeconds'),1);
 assert.equal(g.run('S.tick'),0);
});
