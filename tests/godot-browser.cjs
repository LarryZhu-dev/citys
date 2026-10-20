'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {createServer}=require('../server/index.cjs');
const {waitForStableGodotControl,clickGodotControl,chromiumGraphicsOptions,chromiumRunMetadata}=require('./browser-controls.cjs');
const timeout=90000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function metrics(page){return page.evaluate(()=>window.godotMetrics);}
async function state(page){return page.evaluate(()=>JSON.parse(CityBridge.snapshot(false)));}
async function control(page,name,text){
 return waitForStableGodotControl(page,{name,text},{timeout});
}
async function click(page,name,text){return clickGodotControl(page,{name,text},{timeout});}
async function tilePoint(page,x,y){
 const m=await metrics(page),w=m.world,css=m.hud.css_size;
 return [css[0]/2+((x-y)*64-w.camera_position[0])*w.css_zoom,css[1]/2+((x+y)*32-w.camera_position[1])*w.css_zoom];
}
async function pinch(page){
 const cdp=await page.context().newCDPSession(page),v=page.viewportSize(),cx=v.width/2,cy=v.height*.52;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx-45,y:cy,id:1},{x:cx+45,y:cy,id:2}]});
 for(let i=1;i<=12;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx-45-i*2,y:cy,id:1},{x:cx+45+i*2,y:cy,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await sleep(1000);
}
(async()=>{
 fs.mkdirSync('work/godot-validation',{recursive:true});
 const dir=fs.mkdtempSync('work/godot-validation/online-'),server=createServer({env:{DATA_FILE:dir+'/data.json'}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',...chromiumGraphicsOptions()});
 const report={engine:'Godot 4.6.3 Compatibility Web',...await chromiumRunMetadata(browser),profiles:[],errors:[]};
 try{
  for(const profile of [{name:'desktop',width:1440,height:900,dpr:1,mobile:false},{name:'portrait',width:390,height:844,dpr:2,mobile:true},{name:'landscape',width:844,height:390,dpr:2,mobile:true}]){
   const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},deviceScaleFactor:profile.dpr,hasTouch:profile.mobile,isMobile:profile.mobile});
   const page=await context.newPage();
   page.on('pageerror',e=>report.errors.push({profile:profile.name,message:e.message}));
   page.on('console',m=>{if(/SCRIPT ERROR:|Parse Error:|USER ERROR:/.test(m.text()))report.errors.push({profile:profile.name,message:m.text()});});
   await page.goto(base);await page.waitForFunction(()=>window.godotReady===true,null,{timeout});await control(page,'NewCityButton');
   let setup=await metrics(page);assert.equal(setup.hud.active_panel,'newcity');assert.equal(setup.hud.controls.filter(c=>c.disabled&&c.text.includes('未开放')).length,4);
   if(profile.name==='desktop'){
    await page.screenshot({path:'work/godot-validation/new-city.png'});
    await click(page,'CityNameInput');await page.keyboard.press('Control+A');const ime=await context.newCDPSession(page);await ime.send('Input.imeSetComposition',{text:'长安验收',selectionStart:4,selectionEnd:4});await ime.send('Input.insertText',{text:'长安验收'});await ime.detach();await sleep(700);
    await clickGodotControl(page,{text:'自由营造',exactText:true},{timeout});
   }
   await click(page,'NewCityButton');await page.waitForFunction(()=>JSON.parse(CityBridge.snapshot(false)).hasSave,null,{timeout});
   await control(page,'BuildButton');let s=await state(page);assert.equal(s.civilization,'china');if(profile.name==='desktop')assert.equal(s.cityName,'长安验收','Chinese IME name persists');
   const normal=await metrics(page),h=normal.hud;const occupied=(h.top_rect?.[2]||0)*(h.top_rect?.[3]||0)+(h.dock_rect?.[2]||0)*(h.dock_rect?.[3]||0);
   assert(1-occupied/(profile.width*profile.height)>.80,'Permanent HUD must leave at least 80% of the map');
   for(const c of h.controls)assert(c.rect[3]>=43.9,`${profile.name} ${c.name} touch height ${c.rect[3]}`);
   assert(h.controls.every(c=>c.rect[0]>=-.1&&c.rect[0]+c.rect[2]<=profile.width+.1),'HUD must fit horizontal bounds');
   await page.screenshot({path:`work/godot-validation/${profile.name}-day.png`});
   await click(page,'BuildButton');await control(page,'Build_well');await page.screenshot({path:`work/godot-validation/${profile.name}-catalog.png`});
   await click(page,'Build_well');await page.waitForFunction(()=>JSON.parse(CityBridge.snapshot(false)).tool==='well',null,{timeout});
   s=await state(page);const count=s.buildings.length,before={...s.goods};const pos=await tilePoint(page,48.5,13.5);
   assert(pos[0]>0&&pos[0]<profile.width&&pos[1]>60&&pos[1]<profile.height-70,'Target well tile visible');
   if(profile.mobile)await page.touchscreen.tap(pos[0],pos[1]);else await page.mouse.click(pos[0],pos[1]);
   await page.waitForFunction(n=>JSON.parse(CityBridge.snapshot(false)).buildings.length===n+1,count,{timeout});s=await state(page);
   const well=s.buildings.find(b=>b.type==='well'&&b.x===48&&b.y===13);assert(well?.construction?.remaining>=120,'Well construction uses real minutes');
   for(const [kind,quantity]of Object.entries(s.catalog.find(x=>x.type==='well').cost))assert.equal(before[kind]-s.goods[kind],quantity,'One tap charges exactly one building');
   const beforeCamera=(await metrics(page)).world.camera_position;
   if(profile.mobile){const z=(await metrics(page)).world.css_zoom;await pinch(page);assert((await metrics(page)).world.css_zoom>z*1.1,'Two fingers zoom the camera');}
   else{await page.mouse.move(profile.width*.5,profile.height*.45);await page.mouse.down();await page.mouse.move(profile.width*.5+90,profile.height*.45-45,{steps:12});await page.mouse.up();await sleep(700);assert.notDeepEqual((await metrics(page)).world.camera_position,beforeCamera,'Drag pans camera');const z=(await metrics(page)).world.css_zoom;await page.mouse.wheel(0,-200);await sleep(700);assert.notEqual((await metrics(page)).world.css_zoom,z,'Wheel zooms camera');}
   assert.equal((await state(page)).buildings.length,count+1,'Gestures with an active placement tool must not place another building');
   await page.evaluate(()=>CityBridge.dispatch('cancel','{}'));await sleep(700);
   await click(page,'ViewButton');await click(page,'NightButton');await sleep(1000);assert.equal((await state(page)).nightMode,'night');
   await page.screenshot({path:`work/godot-validation/${profile.name}-night.png`});
   await page.evaluate(()=>CityBridge.dispatch('save','{}'));await page.reload();await page.waitForFunction(()=>window.godotReady===true&&!!window.godotMetrics,null,{timeout});s=await state(page);assert(s.buildings.some(b=>b.type==='well'&&b.x===48&&b.y===13),'Reload preserves placed building');assert.equal(s.hasSave,true);
   report.profiles.push({profile,engine:(await metrics(page)).engine,hudClearFraction:1-occupied/(profile.width*profile.height),buildings:s.buildings.length,constructionRemaining:s.buildings.find(b=>b.type==='well').construction?.remaining});
   console.log('PASS',profile.name);await context.close();
  }
  assert.deepEqual(report.errors,[],'No Godot or browser runtime errors');
  fs.writeFileSync('work/godot-validation/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));await server.app.store.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
