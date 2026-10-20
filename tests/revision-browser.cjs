'use strict';
// Real Godot HUD/bridge integration. Fixtures deliberately accelerate simulation
// time; they do not claim a natural-budget campaign or hardware performance run.
// Uses the released component-built actor atlas. Frame changes verify playback;
// aesthetic review is separate from these functional assertions.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const {createServer}=require('../server/index.cjs');
const {clickGodotControl,chromiumGraphicsOptions,chromiumRunMetadata}=require('./browser-controls.cjs');
const timeout=90000,sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function snapshot(page){return page.evaluate(()=>JSON.parse(CityBridge.snapshot(false)));}
async function click(page,name){
 const c=await clickGodotControl(page,{name},{timeout});
 console.log('Click',name,c.rect);
}
(async()=>{
 const directory='work/revision-validation';fs.mkdirSync(directory,{recursive:true});
 const data=fs.mkdtempSync(directory+'/online-'),server=createServer({env:{DATA_FILE:data+'/data.json'}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',...chromiumGraphicsOptions()});
 const errors=[],report={fixture:'accelerated simulation, actual Godot Web HUD and V4 actor atlas',visualAcceptance:false,...await chromiumRunMetadata(browser),checks:[]};
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
  // Close the actual detail panel: construction time must remain on the map
  // without requiring the player to select the building.
  await click(page,'ClosePanelButton');
  await page.waitForFunction(()=>{
   const labels=godotMetrics.world.construction_labels;
   return godotMetrics.hud.active_panel===''&&labels?.last_drawn>0&&labels.labels.some(l=>l.count===1&&l.state==='paused'&&l.text.includes('升级'));
  },null,{timeout:15000});
  const mapBefore=await page.evaluate(()=>{
   const labels=godotMetrics.world.construction_labels;
   return {diagnostics:labels,label:labels.labels.find(l=>l.count===1&&l.text.includes('升级')),remaining:tileAt(47,13).b.construction.remaining};
  });
  assert.equal(mapBefore.diagnostics.passive,true,'Map countdown must not intercept construction input');
  assert(Math.abs(mapBefore.label.remaining-mapBefore.remaining)<1.1,'Map countdown uses the authoritative remaining construction time');
  assert.match(mapBefore.label.text,/升级 \d+(?:分|秒|时)/,'Map label shows a readable remaining duration');
  await page.evaluate(()=>{
   CityBridge.dispatch('setting',{key:'reducedMotion',value:true});
   CityBridge.dispatch('speed',{value:1});
  });
  await page.waitForFunction(()=>{
   const world=godotMetrics.world;
   return world.reduced_motion===true&&world.paused===false&&world.construction?.active>0&&world.construction_labels?.labels.some(l=>l.count===1&&l.state==='active'&&l.text.includes('升级'));
  },null,{timeout:15000});
  const crewBefore=await page.evaluate(()=>godotMetrics.world.construction);
  assert.equal(crewBefore.atlasReady,true,'The released worker atlas is available for playback integration');
  assert.equal(crewBefore.atlasFrames,192,'The exported game contains the new complete worker atlas');
  assert.equal(crewBefore.legacyArtFixture,false,'Playback uses explicit action sequences rather than legacy frames');
  assert(crewBefore.actors.some(a=>a.leaf),'Workers target actual architectural pieces');
  await sleep(6500);
  await page.waitForFunction(before=>godotMetrics.world.construction.actors.some(actor=>{
   const previous=before.actors.find(other=>other.id===actor.id);
   return previous&&actor.distanceWalked>previous.distanceWalked+.01&&actor.frameChanges>previous.frameChanges;
  }),crewBefore,{timeout:20000});
  const crewAfter=await page.evaluate(()=>godotMetrics.world.construction);
  assert(crewAfter.actors.some(a=>a.distanceWalked>(crewBefore.actors.find(b=>b.id===a.id)?.distanceWalked||0)+.01),'Reduced decorative motion keeps construction workers moving along their real routes');
  assert(crewAfter.actors.some(a=>a.frameChanges>(crewBefore.actors.find(b=>b.id===a.id)?.frameChanges||0)),'Reduced decorative motion keeps actual worker image-frame selection advancing');
  assert(crewAfter.workers<=crewAfter.sites*4,'A site has a bounded construction crew');
  const mapAfter=await page.evaluate(()=>{
   const labels=godotMetrics.world.construction_labels;
   return {diagnostics:labels,label:labels.labels.find(l=>l.count===1&&l.state==='active'&&l.text.includes('升级')),remaining:tileAt(47,13).b.construction.remaining};
  });
  assert(mapAfter.label,'Running construction keeps a visible map countdown');
  assert(mapAfter.label.remaining<mapBefore.label.remaining-2,'Map countdown decreases with real authoritative construction progress');
  assert(Math.abs(mapAfter.label.remaining-mapAfter.remaining)<1.1,'Visible remaining time stays within its one-second display cadence');
  assert.notEqual(mapAfter.label.text,mapBefore.label.text,'Displayed countdown updates while the city runs');
  await page.screenshot({path:directory+'/construction-workers.png'});
  await page.evaluate(()=>CityBridge.dispatch('pause',{}));
  await page.waitForFunction(()=>{
   const world=godotMetrics.world;
   return speed===0&&world.paused===true&&world.construction?.active===0&&world.construction_labels?.labels.some(l=>l.count===1&&l.state==='paused'&&l.text.includes('升级'));
  },null,{timeout:15000});
  await sleep(1500);
  const frozenCrew=await page.evaluate(()=>godotMetrics.world.construction);
  const frozenLabel=await page.evaluate(()=>godotMetrics.world.construction_labels.labels.find(l=>l.count===1&&l.text.includes('升级')));
  const frozenRemaining=await page.evaluate(()=>tileAt(47,13).b.construction.remaining);
  await sleep(1200);
  const pausedCrew=await page.evaluate(()=>godotMetrics.world.construction);
  assert.equal(pausedCrew.active,0);
  for(const actor of frozenCrew.actors){
   const paused=pausedCrew.actors.find(a=>a.id===actor.id);
   assert.deepEqual(paused?.position,actor.position,'Actual pause freezes worker feet');
   assert.equal(paused?.frame,actor.frame,'Actual pause freezes the selected worker pose');
   assert.equal(paused?.frameChanges,actor.frameChanges,'Actual pause stops worker frame advancement');
  }
  const pausedLabel=await page.evaluate(()=>godotMetrics.world.construction_labels.labels.find(l=>l.count===1&&l.text.includes('升级')));
  assert(pausedLabel,'Paused construction retains its map label');
  assert.equal(pausedLabel.state,'paused');
  assert.equal(pausedLabel.text,frozenLabel.text,'Paused countdown text remains stable');
  assert.equal(pausedLabel.remaining,frozenLabel.remaining,'Paused countdown value remains stable');
  assert.equal(await page.evaluate(()=>tileAt(47,13).b.construction.remaining),frozenRemaining,'Actual simulation pause also freezes authoritative remaining time');
  report.construction={before:crewBefore,after:crewAfter,paused:pausedCrew,artFixture:crewBefore.legacyArtFixture===true,visualAcceptance:false};
  report.constructionLabels={before:mapBefore,after:mapAfter,paused:pausedLabel};
  report.checks.push('map construction countdown is visible without selection, follows authoritative time, and freezes on pause');
  report.checks.push('reduced decorative motion preserves worker travel and frame advancement; actual pause freezes both');
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
