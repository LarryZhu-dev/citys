'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
let playwright;try{playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright');}catch{playwright=require('/opt/codex/cua_node/lib/node_modules/playwright');}
const {chromium}=playwright;
const {chromiumGraphicsOptions,chromiumRunMetadata}=require('./browser-controls.cjs');
let base=process.env.TEST_BASE_URL,localServer,localDirectory;
const bridgeOnly=process.env.TEST_BRIDGE_ONLY==='1';
const stamp=Date.now().toString(36),errors=[];
const password='local-test-password-123';
async function idle(page){await page.locator('#onlineModal .online-content[aria-busy="false"]').waitFor();}
async function noOnlineError(page){assert.equal(await page.locator('.online-notice.error').count(),0,await page.locator('.online-notice.error').allTextContents());}
async function dispatch(page,name,payload={}){return page.evaluate(({name,payload})=>CityBridge.dispatch(name,JSON.stringify(payload)),{name,payload});}
async function openOnline(page,tab='cloud'){await page.evaluate(tab=>OnlineUI.open(tab),tab);await idle(page);}
async function boot(page){
  console.log('Browser online: '+(bridgeOnly?'bridge':'Godot')+' boot '+page.url());
  await page.goto(base);
  await page.waitForFunction(()=>window.CityBridge&&typeof S!=='undefined'&&!!S);
  if(!bridgeOnly)await page.waitForFunction(()=>window.godotReady===true,{},{timeout:120000});
  else await page.evaluate(()=>{document.querySelector('#boot').hidden=true;});
}
async function park(page){if(!bridgeOnly)await page.goto('about:blank');}
async function resumeEngine(page){if(!bridgeOnly){await boot(page);if(await page.evaluate(()=>speed!==0))await dispatch(page,'pause');}}
async function city(page,name){
  await boot(page);
  await dispatch(page,'new_city',{cityName:name,seed:name,mode:'campaign'});
  await dispatch(page,'pause');
  assert.equal(await page.evaluate(()=>S.civilization),'china');
  assert.equal(await page.evaluate(()=>S.tiles.length),64);
  assert.equal(await page.evaluate(()=>speed),0);
  return page.evaluate(()=>({wood:S.goods.wood,gold:S.gold}));
}
async function register(page,name){
  await openOnline(page);
  await page.locator('[data-action="auth"]').click();
  await page.locator('#onlineAuth [name="username"]').fill(name);
  await page.locator('#onlineAuth [name="password"]').fill(password);
  await page.locator('#onlineAuth button[type="submit"]').click();
  await page.locator('#cityPublic').waitFor();
  await page.locator('#cityPublic').check();
  await page.locator('[data-action="upload"]').click();await idle(page);await noOnlineError(page);
  assert.equal((await(await page.request.get(base+'/api/save')).json()).save.city.public,true);
}
async function placeOffer(page,quantity,price=2){
  await page.locator('[name="resource"]').selectOption('wood');
  await page.locator('[name="quantity"]').fill(String(quantity));
  await page.locator('[name="unitPrice"]').fill(String(price));
  await page.locator('#onlineTrade button[type="submit"]').click();await idle(page);
}
(async()=>{
  fs.mkdirSync('work',{recursive:true});
  if(!base){localDirectory=fs.mkdtempSync('work/browser-');localServer=require('../server/index.cjs').createServer({env:{DATA_FILE:localDirectory+'/online.json'}});await new Promise(r=>localServer.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+localServer.address().port;}
  const graphics=chromiumGraphicsOptions();
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),...graphics,args:[...graphics.args,'--enable-webgl']});
  const runtimeReport={mode:bridgeOnly?'bridge-only':'Godot Web',...await chromiumRunMetadata(browser)};
  fs.writeFileSync('work/browser-runtime.json',JSON.stringify(runtimeReport,null,2));
  const pages=[];
  const watchdog=setTimeout(()=>{console.error('Browser integration exceeded five minutes; closing the engine contexts.');process.exitCode=1;browser.close().catch(()=>{});},300000);
  async function page(options={}){
    const p=await browser.newPage({viewport:{width:1440,height:1000},...options});
    // Keep account conservation assertions independent of CI loading speed.
    // Timers and Godot frames still run; only Date is fixed until the explicit
    // one-hour suspended-transaction jump below.
    await p.clock.setFixedTime(Date.now());
    p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));p.on('console',message=>{if(/SCRIPT ERROR:|Parse Error:|Compile Error:|Failed to load script/.test(message.text()))errors.push(message.text());});p.on('crash',()=>errors.push('Chromium page crashed'));if(bridgeOnly)await p.route('**/js/godot-loader.js',route=>route.fulfill({contentType:'application/javascript',body:'CityBridge.boot();document.querySelector("#boot").hidden=true;'}));pages.push(p);return p;
  }
  try{
    const seller=await page(),buyer=await page();
    const sellerStart=await city(seller,'商路'+stamp);await register(seller,'s_'+stamp);
    await seller.locator('[data-tab="market"]').click();await idle(seller);await placeOffer(seller,10);await noOnlineError(seller);
    const trade=(await(await seller.request.get(base+'/api/trades')).json()).mine.find(t=>t.status==='open');assert.ok(trade);
    assert.equal(await seller.evaluate(()=>S.goods.wood),sellerStart.wood-10);
    await seller.locator('[data-action="close"]').click();
    await dispatch(seller,'select_tool',{type:'well'});await dispatch(seller,'tile',{x:49,y:15});await dispatch(seller,'cancel');
    assert.equal(await seller.evaluate(()=>S.tiles[15][49].b?.type),'well');
    const sellerLocal=await seller.evaluate(()=>({gold:S.gold,well:S.tiles[15][49].b.id,wood:S.goods.wood}));
    await park(seller); // Independent devices retain storage without sharing this CI machine's software GPU.

    const buyerStart=await city(buyer,'海港'+stamp);await register(buyer,'b_'+stamp);
    await buyer.locator('[data-tab="market"]').click();await idle(buyer);
    await buyer.locator('[data-action="buyTrade"][data-id="'+trade.id+'"]').click();await idle(buyer);await noOnlineError(buyer);
    assert.equal(await buyer.evaluate(()=>S.gold),buyerStart.gold-20);
    assert.equal(await buyer.evaluate(()=>S.goods.wood),buyerStart.wood+10);
    await park(buyer);await resumeEngine(seller);
    await openOnline(seller);await noOnlineError(seller);
    assert.equal(await seller.evaluate(()=>S.gold),sellerLocal.gold+20);
    assert.equal(await seller.evaluate(()=>S.goods.wood),sellerLocal.wood);
    assert.equal(await seller.evaluate(()=>S.tiles[15][49].b.id),sellerLocal.well);
    await seller.locator('[data-action="upload"]').click();await idle(seller);await noOnlineError(seller);
    const savedSeller=(await(await seller.request.get(base+'/api/save')).json()).save;
    assert.equal(savedSeller.state.tiles[15][49].b.id,sellerLocal.well);
    assert.equal(savedSeller.state.version,5);assert.equal(savedSeller.state.clock.version,1);

    await park(seller);await resumeEngine(buyer);if(!bridgeOnly)await openOnline(buyer,'market');
    console.log('Browser online: registration, escrow and remote-sale reconciliation passed.');
    const buyerHome=await buyer.evaluate(()=>serializeState());
    await buyer.locator('[data-tab="cities"]').click();await idle(buyer);
    await buyer.locator('[data-action="visit"][data-id="'+savedSeller.city.id+'"]').click();await buyer.locator('#cityVisitBar').waitFor();
    assert.equal(await buyer.evaluate(()=>OnlineUI.visiting),true);
    assert.equal(await buyer.evaluate(()=>S.cityName),savedSeller.state.cityName);
    const rawHome=await buyer.evaluate(()=>localStorage.getItem(SAVE_KEY));assert.equal(JSON.parse(rawHome).cityName,buyerHome.cityName);
    const visitorBefore=await buyer.evaluate(()=>JSON.stringify({goods:S.goods,gold:S.gold,remaining:S.tiles[15][49].b.construction?.remaining??null,tick:S.tick}));
    for(const [name,payload]of [['select_tool',{type:'house'}],['demolish',{x:49,y:15}],['trade',{resource:'wood',quantity:5,direction:'sell'}],['pause',{}],['speed',{value:60}],['new_city',{cityName:'不能创建'}]])assert.equal(await dispatch(buyer,name,payload),false,'read-only dispatch '+name);
    await buyer.keyboard.press('Space');await buyer.keyboard.press('4');
    assert.equal(await buyer.evaluate(()=>speed),0);assert.equal(await buyer.evaluate(()=>save()),false);assert.equal(await buyer.evaluate(()=>load()),false);
    assert.equal(await buyer.evaluate(()=>selTool),null);
    // Wait across two real bridge intervals: public construction and goods must not advance.
    await buyer.waitForTimeout(2100);
    assert.equal(await buyer.evaluate(()=>JSON.stringify({goods:S.goods,gold:S.gold,remaining:S.tiles[15][49].b.construction?.remaining??null,tick:S.tick})),visitorBefore);
    assert.equal(await buyer.evaluate(()=>localStorage.getItem(SAVE_KEY)),rawHome);
    await buyer.locator('#cityVisitBar button').click();
    assert.equal(await buyer.evaluate(()=>OnlineUI.visiting),false);
    assert.equal(await buyer.evaluate(()=>S.cityName),buyerHome.cityName);
    assert.equal(await buyer.evaluate(()=>S.goods.wood),buyerHome.goods.wood);
    await buyer.reload();await buyer.waitForFunction(()=>!!window.CityBridge&&!!S);if(!bridgeOnly)await buyer.waitForFunction(()=>window.godotReady===true,{},{timeout:120000});else await buyer.evaluate(()=>{document.querySelector('#boot').hidden=true;});
    if(await buyer.evaluate(()=>speed!==0))await dispatch(buyer,'pause');
    assert.equal(await buyer.evaluate(()=>S.cityName),buyerHome.cityName);
    assert.ok(await buyer.evaluate(()=>JSON.parse(localStorage.getItem(SAVE_KEY)).cloudSync?.baseline));

    // A separate-device HTTP save remains v4 in storage. The real cloud dialog
    // downloads it, backs up this device, migrates engineering progress once and
    // retains the multiplayer baseline for the next upload.
    const currentBuyer=(await(await buyer.request.get(base+'/api/save')).json()).save;
    const legacy=structuredClone(currentBuyer.state);legacy.version=legacy.v=4;delete legacy.clock;
    legacy.cityName='旧档长安'+stamp;legacy.uid=20001;
    for(const row of legacy.tiles)for(const tile of row)if(tile.b)delete tile.b.production;
    legacy.tiles[13][48].b={id:20001,type:'well',origin:[48,13],construction:{total:9,remaining:4.5}};
    const oldSaveResponse=await buyer.request.put(base+'/api/save',{data:{revision:currentBuyer.revision,state:legacy,city:{name:legacy.cityName,public:true}}});
    assert.equal(oldSaveResponse.status(),200);const oldSave=(await oldSaveResponse.json()).save;
    assert.equal(oldSave.state.version,4);assert.equal(oldSave.state.clock,undefined);assert.equal(oldSave.state.tiles[13][48].b.construction.remaining,4.5);
    await openOnline(buyer);await buyer.locator('[data-action="download"]').click();await idle(buyer);await noOnlineError(buyer);
    assert.equal(await buyer.evaluate(()=>S.cityName),legacy.cityName);
    assert.ok(Math.abs(await buyer.evaluate(()=>S.tiles[13][48].b.construction.remaining/constructionDuration('well'))-.5)<1e-7);
    assert.equal(await buyer.evaluate(()=>JSON.parse(localStorage.getItem('empires-before-cloud-download')).cityName),buyerHome.cityName);
    const restoredMeta=await buyer.evaluate(()=>JSON.parse(localStorage.getItem(SAVE_KEY)).cloudSync);
    assert.equal(restoredMeta.revision,oldSave.revision);assert.equal(restoredMeta.clientRevision,oldSave.clientRevision);
    assert.deepEqual(restoredMeta.baseline.goods,oldSave.state.goods);
    await buyer.locator('[data-action="upload"]').click();await idle(buyer);await noOnlineError(buyer);
    const migratedCloud=(await(await buyer.request.get(base+'/api/save')).json()).save;
    assert.equal(migratedCloud.state.version,5);assert.ok(migratedCloud.state.clock.lastWallMs>1e12);
    assert.ok(Math.abs(migratedCloud.state.tiles[13][48].b.construction.remaining/migratedCloud.state.tiles[13][48].b.construction.total-.5)<1e-7);

    await park(buyer);await resumeEngine(seller);if(!bridgeOnly)await openOnline(seller,'market');
    console.log('Browser online: read-only visits, reload metadata and legacy cloud migration passed.');
    await seller.locator('[data-tab="market"]').click();await idle(seller);
    const openBefore=(await(await seller.request.get(base+'/api/trades')).json()).mine.filter(t=>t.status==='open').length;
    const woodBeforeRetry=await seller.evaluate(()=>S.goods.wood);
    let dropped=false;
    await seller.route('**/api/trades',async route=>{if(route.request().method()==='POST'&&!dropped){dropped=true;await route.fetch();await route.abort('failed');}else await route.continue();});
    await placeOffer(seller,5);assert.ok(dropped);await seller.unroute('**/api/trades');
    const pendingTick=await seller.evaluate(()=>S.tick);
    // A response can remain unconfirmed for an hour while the online dialog
    // suspends this city. Applying its saved response must not award that hour.
    const retryTime=(await seller.evaluate(()=>Date.now()))+3600000;
    await seller.clock.setFixedTime(retryTime);
    assert.equal(await seller.evaluate(()=>Date.now()),retryTime);
    await seller.locator('[data-action="retryTrade"]').click();await idle(seller);await noOnlineError(seller);
    assert.equal(await seller.evaluate(()=>S.tick),pendingTick,'paused transaction time must not be replayed as offline income');
    assert.equal((await(await seller.request.get(base+'/api/trades')).json()).mine.filter(t=>t.status==='open').length,openBefore+1);
    assert.equal(await seller.evaluate(()=>S.goods.wood),woodBeforeRetry-5);
    assert.equal(await seller.evaluate(()=>localStorage.getItem('empires-pending-trade')),null);
    await seller.route('**/api/trades',async route=>{if(route.request().method()==='GET')await route.abort('failed');else await route.continue();});
    await placeOffer(seller,3);await noOnlineError(seller);
    assert.match(await seller.locator('.online-notice[role="status"]').innerText(),/本次交易已完成/);
    assert.equal(await seller.evaluate(()=>S.goods.wood),woodBeforeRetry-8);await seller.unroute('**/api/trades');
    await seller.locator('[data-action="close"]').click();
    if(!bridgeOnly){await dispatch(seller,'night',{mode:'day'});await seller.screenshot({path:'work/browser-city-day.png'});await dispatch(seller,'night',{mode:'night'});await seller.screenshot({path:'work/browser-city-night.png'});}

    console.log('Browser online: lost-response retry and failed-list-refresh conservation passed.');
    await seller.close();await buyer.close(); // The mobile scenario does not need two desktop WebGL contexts alive.
    const mobile=await page({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await city(mobile,'临川'+stamp);
    await openOnline(mobile);assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await mobile.evaluate(()=>speed),0);
    await mobile.screenshot({path:'work/browser-mobile-online.png'});await mobile.locator('[data-action="close"]').click();
    assert.deepEqual(errors,[]);
    console.log((bridgeOnly?'BRIDGE-ONLY PRECHECK':'GODOT ENGINE PASS')+': two accounts; public opt-in; escrow transfer; preservation of local construction and multiplayer baseline; read-only visiting; v4 cloud download and v5 re-upload; response-loss exact-once retry; successful trade with failed refresh; mobile online dialog; no browser errors.');
  }catch(error){for(let i=0;i<pages.length;i++)try{if(pages[i].isClosed())continue;await pages[i].screenshot({path:'work/browser-failure-'+i+'.png'});}catch{}throw error;}
  finally{clearTimeout(watchdog);await browser.close();if(localServer){localServer.closeAllConnections();await new Promise(r=>localServer.close(r));await localServer.app.store.close();fs.rmSync(localDirectory,{recursive:true,force:true});}}
})().catch(error=>{console.error(error);process.exitCode=1;});
