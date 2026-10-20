'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {sanitizeState}=require('../server/validate.cjs');
const {createServer}=require('../server/index.cjs');

function game(){
  const context=vm.createContext({console,Date,Math,JSON,Map,Set,document:{querySelector:()=>({getContext:()=>({})})},window:{},toast(){},log(){},save(){},renderAll(){},renderBuildList(){},renderTasks(){}});
  for(const name of ['data','civilizations','simulation'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/'+name+'.js'),'utf8'),context);
  return {run:code=>vm.runInContext(code,context),set:(key,value)=>context[key]=value,json:code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context))};
}
function town(g){
  g.run(`newGame({civilization:'china',seed:'logistics-regression',mode:'campaign',nowMs:1000000});
    S.tiles=Array.from({length:64},()=>Array.from({length:64},()=>({t:'grass',b:null})));invalidateWorld();
    for(let x=0;x<=12;x++)setRoad(x,10,x===0);
    S.logistics={version:1,nextId:1,graceSeconds:0,depot:{x:0,y:9,door:[0,10],name:'城镇货栈'},jobs:[]};
    var home=put(1,9,'house');home.pop=6;S.pop=6;
    S.goods=Object.fromEntries(Object.keys(GOODS).map(k=>[k,0]));Object.assign(S.goods,{grain:1000,wood:100,stone:100});
    allocateWorkers(buildings());updateCaps();`);
}
function factory(g){town(g);g.run("var factory=put(4,11,'kiln');S.goods.clay=30;allocateWorkers(buildings());step(660)");}
function total(g,kind){return g.run(`(S.goods.${kind}||0)+goodsInTransit('${kind}')+buildings().reduce((n,o)=>n+(o.b.stock?.${kind}||0),0)`);}

test('a completed batch waits at its actual source, becomes tradable only after delivery and returns with the same id',()=>{
  const g=game();factory(g);
  assert.equal(g.run('S.goods.brick'),0);assert.equal(g.run('S.goods.clay'),0);
  assert.equal(g.run('tradeGoods("brick",1,"sell").ok'),false);
  const job=g.json('S.logistics.jobs[0]');
  assert.equal(job.phase,'loading');assert.equal(job.sourceId,g.run('factory.id'));assert.equal(job.targetId,0);
  assert.equal(job.targetName,'城镇货栈');assert.equal(job.isLoaded,false);assert.equal(job.cargo.brick,34.5);
  g.run('step(15)');assert.equal(g.run('S.logistics.jobs[0].isLoaded'),true);
  assert.equal(g.run('S.goods.brick'),0);
  g.run('step(22)');
  assert.equal(g.run('S.goods.brick'),34.5);
  assert.equal(g.run('S.logistics.jobs[0].id'),job.id);
  assert.equal(g.run('S.logistics.jobs[0].leg'),'return');assert.equal(g.run('S.logistics.jobs[0].isLoaded'),false);
  assert.deepEqual(g.json('S.logistics.jobs[0].cargo'),{});
  g.run('step(13)');assert.equal(g.run('S.logistics.jobs.length'),0);
  assert.equal(g.run('tradeGoods("brick",1,"sell").ok'),true);
});

test('a severed edge freezes a loaded carrier at its exact fractional position and repairing it resumes without duplicate cargo',()=>{
  const g=game();factory(g);g.run('step(16.5)');
  const before=g.json('logisticsPosition(S.logistics.jobs[0])');assert.equal(before[0],3.5);
  g.run('destroyBuilding(3,10);step(60)');
  assert.deepEqual(g.json('logisticsPosition(S.logistics.jobs[0])'),before);
  assert.equal(g.run('S.logistics.jobs[0].phase'),'waiting');assert.equal(g.run('S.goods.brick'),0);
  assert.equal(total(g,'brick'),34.5);
  g.run('setRoad(3,10);step(1.5)');assert.deepEqual(g.json('logisticsPosition(S.logistics.jobs[0])'),[3,10]);
  g.run('step(90)');assert.equal(g.run('S.goods.brick'),34.5);assert.equal(g.run('S.logistics.jobs.length'),0);
});

test('rerouting at a road junction uses the existing position and a real alternate road',()=>{
  const g=game();factory(g);g.run('step(15);destroyBuilding(3,10);setRoad(4,9);setRoad(3,9);setRoad(2,9);step(1)');
  const p=g.json('logisticsPosition(S.logistics.jobs[0])');assert.equal(p[0],4);assert.ok(Math.abs(p[1]-(10-1/3))<1e-9);
  assert.equal(g.run('S.logistics.jobs[0].phase'),'travel');
  assert.equal(g.run('S.logistics.jobs[0].route.some(p=>p[0]===3&&p[1]===10)'),false);
  g.run('step(120)');assert.equal(g.run('S.goods.brick'),34.5);
});

test('water journeys are empty outbound, loaded homebound, driven by household use and absent without a working source',()=>{
  const g=game();town(g);g.run('step(60)');assert.equal(g.run('S.logistics.jobs.length'),0);
  g.run("put(2,11,'well');step(60)");
  assert.equal(g.run('S.logistics.jobs.length'),1);assert.equal(g.run('S.logistics.jobs[0].kind'),'water');
  assert.equal(g.run('S.logistics.jobs[0].leg'),'pickup');assert.equal(g.run('S.logistics.jobs[0].isLoaded'),false);
  assert.equal(g.run('home.water||0'),0);assert.equal(g.run('evaluateNeeds(buildingById(home.id)).map.water'),false);
  g.run('step(18)');assert.equal(g.run('S.logistics.jobs[0].leg'),'deliver');assert.equal(g.run('S.logistics.jobs[0].isLoaded'),true);
  assert.equal(g.run('logisticsEta(S.logistics.jobs[0])'),13);
  g.run('step(13)');assert.equal(g.run('S.logistics.jobs.length'),0);assert.ok(Math.abs(g.run('home.water')-1.2)<1e-9);
  assert.equal(g.run('evaluateNeeds(buildingById(home.id)).map.water'),true);
  g.run('step(5*60)');assert.equal(g.run('S.logistics.jobs.filter(j=>j.kind==="water").length'),0);
  assert.ok(g.run('home.water')<1.2);
});

test('shop orders reserve available stock once, supply actual nearby demand and consumption conserves inventory',()=>{
  const g=game();town(g);g.run("var a=put(5,9,'grainShop'),b=put(5,11,'grainShop');home.lvl=2;home.pop=10;S.pop=10;step(60)");
  assert.equal(g.run('S.logistics.jobs.filter(j=>j.kind==="restock").length'),2);
  assert.ok(Math.abs(total(g,'grain')-(1000-.35))<1e-8);
  assert.equal(g.run('a.stock?.grain||0'),0);
  g.run('scheduleLogistics(buildings())');assert.equal(g.run('S.logistics.jobs.filter(j=>j.kind==="restock").length'),2);
  g.run('step(60)');assert.ok(g.run('a.stock.grain')>0);assert.ok(g.run('b.stock.grain')>0);
  assert.ok(Math.abs(total(g,'grain')-(1000-.7))<1e-8);
  assert.equal(g.run('evaluateNeeds(buildingById(home.id)).map.grain'),true);
  g.run('home.pop=0;S.pop=0;S.logistics.jobs=[];a.stock={};b.stock={};scheduleLogistics(buildings())');
  assert.equal(g.run('S.logistics.jobs.length'),0);
});

test('full warehouses hold cargo; destroying a destination returns loaded goods along roads instead of crediting remotely',()=>{
  const g=game();factory(g);g.run('S.goods.brick=S.caps.mat;step(60)');
  assert.equal(g.run('S.logistics.jobs[0].phase'),'waiting');assert.equal(g.run('S.logistics.jobs[0].isLoaded'),true);
  assert.equal(g.run('goodsInTransit("brick")'),34.5);
  g.run('S.goods.brick-=34.5;step(10)');assert.equal(g.run('S.goods.brick'),600);assert.equal(g.run('goodsInTransit("brick")'),0);
  const h=game();town(h);h.run("var a=put(5,9,'grainShop'),b=put(5,11,'grainShop');home.lvl=2;home.pop=10;S.pop=10;step(60);step(31)");
  const before=total(h,'grain');h.run('var central=S.goods.grain;var doomed=a.id;destroyBuilding(5,9);step(1)');
  assert.equal(h.run('S.goods.grain'),h.run('central'),'loaded cargo must travel back before becoming available');
  assert.ok(Math.abs(total(h,'grain')-before)<1e-8);
  h.run('step(90)');assert.ok(Math.abs(total(h,'grain')-(before-.7))<1e-8);
});

test('canceling an empty pickup releases only its own reservation and demolition salvages prepaid inputs without duplication',()=>{
  const g=game();town(g);g.run("var a=put(5,9,'grainShop'),b=put(5,11,'grainShop');home.lvl=2;home.pop=10;S.pop=10;step(60)");
  const before=total(g,'grain');g.run('destroyBuilding(5,9);step(1)');assert.ok(Math.abs(total(g,'grain')-before)<1e-8);
  g.run('step(1)');assert.ok(Math.abs(total(g,'grain')-before)<1e-8);
  const h=game();town(h);h.run("put(4,11,'kiln');S.goods.clay=30;step(60);destroyBuilding(4,11)");
  assert.equal(h.run('S.goods.clay'),0);assert.equal(total(h,'clay'),30);
  h.run('step(60)');assert.equal(h.run('S.goods.clay'),30);h.run('step(60)');assert.equal(h.run('S.goods.clay'),30);
});

test('mid-route and empty return trips survive server sanitization and hydration at the identical position',()=>{
  const g=game();factory(g);g.run('step(16.5)');
  const saved=g.json('serializeState()'),position=g.json('logisticsPosition(S.logistics.jobs[0])');
  const clean=sanitizeState(saved);const h=game();h.set('saved',clean);h.run('hydrateState(saved,{applyOffline:false})');
  assert.deepEqual(h.json('logisticsPosition(S.logistics.jobs[0])'),position);
  assert.equal(h.run('S.goods.brick'),0);assert.equal(h.run('S.goods.clay'),0);
  g.run('var detached=serializeState();step(1)');assert.equal(g.run('detached.logistics.jobs[0].segmentProgress'),1.5);
  h.run('step(20.5)');assert.equal(h.run('S.goods.brick'),34.5);assert.equal(h.run('S.logistics.jobs[0].leg'),'return');
  const returning=sanitizeState(h.json('serializeState()'));h.set('saved',returning);h.run('hydrateState(saved,{applyOffline:false});step(20)');
  assert.equal(h.run('S.goods.brick'),34.5);assert.equal(h.run('S.logistics.jobs.length'),0);
});

test('legacy v5 logistics migration grants a short service grace without minting stock or replacing ongoing upgrades',()=>{
  const g=game();town(g);g.run("home.lvl=3;home.pop=16;S.pop=16;put(2,11,'well');put(5,9,'grainShop');put(5,11,'grainShop');allocateWorkers(buildings());var old=serializeState();delete old.logistics;old.tiles[9][1].b.construction={total:600,remaining:300,fromLevel:3,toLevel:4};");
  const goods=g.json('S.goods');g.run('hydrateState(old,{applyOffline:false})');
  assert.deepEqual(g.json('S.goods'),goods);assert.equal(g.run('S.logistics.graceSeconds'),300);
  assert.equal(g.run('tileAt(1,9).b.construction.remaining'),300);
  assert.equal(g.run('evaluateNeeds(buildingById(tileAt(1,9).b.id)).currentOk'),true);
  g.run('step(180)');assert.equal(g.run('tileAt(1,9).b.lvl'),3);assert.ok(g.run('tileAt(1,9).b.water')>0);
});

test('malformed optional jobs are ignored safely and a hydration exception leaves the original city atomically intact',()=>{
  const g=game();town(g);g.run('var imported=serializeState();imported.logistics.jobs=[null,17,[],"bad"];');
  assert.equal(g.run('hydrateState(imported,{applyOffline:false})'),true);
  assert.equal(g.run('S.pop'),6);assert.equal(g.run('S.logistics.jobs.length'),0);
  g.run('var original=S;var before=JSON.stringify(serializeState());var broken=serializeState();broken.cityName="不得替换原城";Object.defineProperty(broken.logistics,"jobs",{get(){throw new Error("corrupt jobs getter")}})');
  assert.equal(g.run('hydrateState(broken,{applyOffline:false})'),false);
  assert.equal(g.run('S===original'),true);assert.equal(g.run('JSON.stringify(serializeState())'),g.run('before'));
  assert.equal(g.run('S.pop'),6);
});

test('retired building identities cannot be reused after save/load, even when only a cargo endpoint remembers them',()=>{
  for(const omitUid of [false,true]){
    const g=game();town(g);g.run("var a=put(5,9,'grainShop'),b=put(5,11,'grainShop');home.lvl=2;home.pop=10;S.pop=10;step(60);var retired=b.id;destroyBuilding(5,11);var saved=serializeState();");
    if(omitUid)g.run('delete saved.uid');
    const before=total(g,'grain');g.run("hydrateState(saved,{applyOffline:false});var replacement=put(5,11,'house');");
    assert.ok(g.run('replacement.id')>g.run('retired'));
    g.run('step(1)');assert.equal(g.run('replacement.stock'),undefined);
    assert.ok(Math.abs(total(g,'grain')-before)<1e-8);
    g.run('var again=serializeState();hydrateState(again,{applyOffline:false})');
    assert.ok(Math.abs(total(g,'grain')-before)<1e-8);
  }
});

test('offline catch-up agrees with frequent frames for real cargo, stocks and water and keeps serialized traffic bounded',()=>{
  const a=game();town(a);a.run("home.lvl=2;home.pop=10;S.pop=10;put(2,11,'well');put(5,9,'grainShop');put(5,11,'grainShop');put(8,11,'farmland');allocateWorkers(buildings())");
  const b=game();b.set('saved',a.json('serializeState()'));b.run('hydrateState(saved,{applyOffline:false})');
  a.run('for(let i=0;i<720;i++)step(10)');b.run('step(7200)');
  assert.deepEqual(a.json('serializeState().logistics'),b.json('serializeState().logistics'));
  assert.deepEqual(a.json('S.goods'),b.json('S.goods'));
  assert.deepEqual(a.json('buildings().filter(o=>o.b.type!=="road").map(o=>o.b)'),b.json('buildings().filter(o=>o.b.type!=="road").map(o=>o.b)'));
  assert.ok(Buffer.byteLength(JSON.stringify(a.json('serializeState()')))<3*1024*1024);
  const invalid=a.json('serializeState()');invalid.logistics.jobs=Array.from({length:129},()=>({}));assert.throws(()=>sanitizeState(invalid),/任务数量/);
  const c=game();factory(c);const bad=c.json('serializeState()');bad.logistics.jobs[0].route=[[4,10],[0,10]];assert.throws(()=>sanitizeState(bad),/逐格相邻/);
  const maximum=c.json('serializeState()'),snake=[];
  for(let y=0;y<8;y++)for(let dx=0;dx<64;dx++)snake.push([y%2?63-dx:dx,y]);
  maximum.logistics.jobs=Array.from({length:128},(_,i)=>({...maximum.logistics.jobs[0],id:i+1,route:snake}));maximum.logistics.nextId=129;
  assert.equal(sanitizeState(maximum).logistics.jobs.length,128);
  assert.ok(Buffer.byteLength(JSON.stringify(maximum))<3*1024*1024,'maximum legal traffic must fit the real 3 MiB body limit');
});

test('real HTTP saves preserve queued cargo and cannot list undelivered goods for sale',async t=>{
  const g=game();factory(g);g.run('step(16.5)');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'citys-logistics-')),server=createServer({env:{DATA_FILE:path.join(directory,'db.json')}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await server.app.store.close();fs.rmSync(directory,{recursive:true,force:true});});
  const registered=await fetch(base+'/api/account/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'logistics_'+crypto.randomBytes(4).toString('hex'),password:'local logistics regression password'})});
  assert.equal(registered.status,201);const cookie=registered.headers.get('set-cookie').split(';')[0];
  const saved=g.json('serializeState()');const posted=await fetch(base+'/api/save',{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({state:saved,revision:0,city:{name:saved.cityName,public:false}})});
  assert.equal(posted.status,200);const response=await posted.json();
  const sale=await fetch(base+'/api/trades',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({resource:'brick',quantity:1,unitPrice:1,revision:response.save.revision,requestId:crypto.randomUUID()})});
  assert.equal(sale.status,409);assert.equal((await sale.json()).error.code,'INSUFFICIENT_GOODS');
  const loaded=(await(await fetch(base+'/api/save',{headers:{Cookie:cookie}})).json()).save.state;
  assert.equal(loaded.logistics.jobs[0].id,saved.logistics.jobs[0].id);assert.equal(loaded.logistics.jobs[0].segmentProgress,1.5);
  assert.deepEqual(loaded.logistics.jobs[0].cargo,{brick:34.5});
  const h=game();h.set('saved',loaded);h.run('hydrateState(saved,{applyOffline:false});step(90)');
  assert.equal(h.run('S.goods.brick'),34.5);assert.equal(h.run('S.logistics.jobs.length'),0);
});
