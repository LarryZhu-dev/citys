'use strict';
// Real Godot HUD/bridge integration. Fixtures deliberately accelerate simulation
// time; they do not claim a natural-budget campaign or hardware performance run.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const {createServer}=require('../server/index.cjs');
const timeout=90000,sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function snapshot(page){return page.evaluate(()=>JSON.parse(CityBridge.snapshot(false)));}
async function click(page,name){
 await page.waitForFunction(name=>window.godotMetrics?.hud?.controls?.some(c=>c.name===name&&!c.disabled&&!c.clipped&&c.rect[1]>=0&&c.rect[1]+c.rect[3]<=innerHeight),name,{timeout});
 // Godot container layout settles after the first diagnostics snapshot. Wait for
 // a second snapshot before using the geometry, as a player sees the laid-out UI.
 await sleep(1000);
 const c=await page.evaluate(name=>godotMetrics.hud.controls.find(c=>c.name===name&&!c.disabled&&!c.clipped),name);
 console.log('Click',name,c.rect);
 await page.mouse.click(c.rect[0]+c.rect[2]/2,c.rect[1]+c.rect[3]/2);await sleep(700);
}
(async()=>{
 const directory='work/revision-validation';fs.mkdirSync(directory,{recursive:true});
 const data=fs.mkdtempSync(directory+'/online-'),server=createServer({env:{DATA_FILE:data+'/data.json'}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 const errors=[],report={fixture:'accelerated simulation, actual Godot Web HUD',checks:[]};
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(/SCRIPT ERROR:|Parse Error:|USER ERROR:/.test(m.text()))errors.push(m.text());});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.godotReady===true,null,{timeout});
  await click(page,'NewCityButton');
  const ready=await page.evaluate(()=>{
   setSpeed(0);put(48,13,'well');invalidateWorld();
   for(let i=0;i<30;i++)step(60);
   invalidateRenderer();CityBridge.dispatch('tile',{x:47,y:13});
   return {status:upgradeStatus(47,13),house:{...tileAt(47,13).b},goods:{...S.goods}};
  });
  assert.equal(ready.house.lvl,1,'Conditions never automatically start an upgrade');
  assert.equal(!!ready.house.construction,false);assert.equal(ready.status.eligible,true,JSON.stringify(ready.status));
  await click(page,'UpgradeButton');
  try{await page.waitForFunction(()=>!!tileAt(47,13).b.construction,null,{timeout:15000});}
  catch(error){await page.screenshot({path:directory+'/upgrade-failure.png'});fs.writeFileSync(directory+'/upgrade-failure.json',JSON.stringify(await page.evaluate(()=>({snapshot:JSON.parse(CityBridge.snapshot(false)),metrics:godotMetrics})),null,2));throw error;}
  let s=await snapshot(page),house=s.buildings.find(b=>b.x===47&&b.y===13);
  assert.equal(house.construction.fromLevel,1);assert.equal(house.construction.toLevel,2);
  assert.equal(house.construction.total,ready.status.duration);
  assert(house.construction.total>=240,'Manual click queues minutes of real construction');
  for(const [kind,quantity]of Object.entries(ready.status.cost))assert.equal(ready.goods[kind]-s.goods[kind],quantity,'Actual HUD click charges its quoted materials exactly once');
  const balance={...s.goods};
  assert.equal(await page.evaluate(()=>CityBridge.dispatch('upgrade',{x:47,y:13})),false,'Repeat click is rejected');
  assert.deepEqual((await snapshot(page)).goods,balance,'Repeat click cannot charge materials twice');
  await page.screenshot({path:directory+'/manual-upgrade.png'});report.checks.push('conditions wait for actual HUD upgrade click; repeated command is idempotent');
  await page.evaluate(()=>setSpeed(1));
  await page.waitForFunction(()=>godotMetrics.world.construction?.active>0,null,{timeout:15000});
  const crewBefore=await page.evaluate(()=>godotMetrics.world.construction);
  assert.equal(crewBefore.atlasReady,true,'Construction uses the newly generated worker atlas');
  assert(crewBefore.atlasFrames>=20,'Worker actions have real direction and action images');
  assert(crewBefore.actors.some(a=>a.leaf),'Workers target actual architectural pieces');
  await sleep(6500);
  const crewAfter=await page.evaluate(()=>godotMetrics.world.construction);
  assert(crewAfter.actors.some(a=>a.distanceWalked>(crewBefore.actors.find(b=>b.id===a.id)?.distanceWalked||0)+.01),'Construction crew really moves along its material/install route');
  assert(crewAfter.workers<=crewAfter.sites*4,'A site has a bounded construction crew');
  await page.screenshot({path:directory+'/construction-workers.png'});
  await page.evaluate(()=>setSpeed(0));await sleep(1500);
  const frozenCrew=await page.evaluate(()=>godotMetrics.world.construction);
  await sleep(1200);
  const pausedCrew=await page.evaluate(()=>godotMetrics.world.construction);
  assert.equal(pausedCrew.active,0);
  for(const actor of frozenCrew.actors)assert.deepEqual(pausedCrew.actors.find(a=>a.id===actor.id)?.position,actor.position,'Paused workers cannot slide or teleport');
  report.construction={before:crewBefore,after:crewAfter,paused:pausedCrew};
  report.checks.push('new construction crew carries materials to real leaf targets, moves, and freezes on pause');
  await page.evaluate(()=>{save();});await page.reload();await page.waitForFunction(()=>window.godotReady===true,null,{timeout});
  await page.evaluate(()=>setSpeed(0));s=await snapshot(page);house=s.buildings.find(b=>b.x===47&&b.y===13);
  assert.equal(house.construction?.toLevel,2,'Reload retains queued upgrade');
  report.checks.push('queued upgrade survives reload');
  await page.evaluate(()=>{CityBridge.dispatch('tile',{x:46,y:13});});await sleep(1200);
  s=await snapshot(page);assert.equal(s.selection.type,'depot');assert.equal(s.selection.immutable,true);
  assert.equal(await page.evaluate(()=>canBuildAt('house',46,13).ok),false,'Base warehouse reserves its visible ground');
  report.checks.push('visible base warehouse cannot be built over');
  await page.evaluate(()=>{CityBridge.dispatch('tile',{x:47,y:14});});await sleep(1200);
  const road=await page.evaluate(()=>godotMetrics.world);
  assert.equal(road.selected_road?.tier,0,'Starting settlement keeps dirt roads');
  assert.equal(road.selected_road?.name,'土路');
  report.roadDiagnostics=road;report.checks.push('road selection crosses Godot/JS bridge without runtime errors');
  await page.evaluate(()=>{
   CityBridge.dispatch('cancel',{});
   // A completed granary fixture gives the genuine harvest both storage room
   // and a visible multi-tile journey, instead of the adjacent base depot.
   put(55,15,'granary');invalidateWorld();allocateWorkers(buildings());updateCaps();step(600);
   // Stop immediately after a genuine harvest starts its outbound shipment.
   for(let i=0;i<45*60&&!S.logistics.jobs.some(j=>j.kind==='delivery'&&j.cargo.grain);i++)step(1);
   step(LOGISTICS_LOAD_SECONDS+1);
   invalidateRenderer();renderAll();
  });
  s=await snapshot(page);assert(s.logistics.jobs.some(j=>j.kind==='delivery'&&j.isLoaded&&j.cargo.grain),'A real harvested batch loads onto its grain cart: '+JSON.stringify(s.logistics.jobs));
  assert(s.logistics.jobs.every(j=>Array.isArray(j.position)&&j.route.length>0),'Render snapshots include continuous route positions');
  report.activeJobs=s.logistics.jobs.map(({id,kind,phase,sourceName,targetName,cargo})=>({id,kind,phase,sourceName,targetName,cargo}));
  await page.evaluate(()=>setSpeed(1));await sleep(3500);
  report.world=await page.evaluate(()=>godotMetrics.world);
  assert(report.world.logistics?.actors>0,'Authoritative logistics jobs create Godot actors');
  assert.equal(report.world.logistics?.random_walkers,0,'No unrelated back-and-forth walkers remain');
  assert(report.world.logistics?.samples.some(a=>a.vehicle==='horse'&&a.loaded),'Genuine rice production renders a loaded horse cart');
  await page.screenshot({path:directory+'/logistics-day.png'});
  await page.evaluate(()=>{CityBridge.dispatch('night',{mode:'night'});});await sleep(1500);
  await page.screenshot({path:directory+'/logistics-night.png'});
  await page.evaluate(()=>{setSpeed(0);save();});
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem(SAVE_KEY)));
  assert(saved.logistics.jobs.length>0,'Active jobs are persisted');
  await page.reload();await page.waitForFunction(()=>window.godotReady===true,null,{timeout});
  await page.evaluate(()=>setSpeed(0));s=await snapshot(page);
  for(const j of saved.logistics.jobs)assert(s.logistics.jobs.some(k=>k.id===j.id),'Short reload preserves task identity');
  report.checks.push('genuine production shipments render and retain identity through reload');
  assert.deepEqual(errors,[],'No browser/Godot runtime errors');report.errors=errors;
  fs.writeFileSync(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks,jobs:report.activeJobs,errors},null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));await server.app.store.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
