'use strict';
// Explicit production acceptance; never run implicitly in the local test suite.
// Requires SMOKE_BASE_URL. Never point tests/browser.cjs at production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
catch(error) { if(process.env.PLAYWRIGHT_MODULE)throw error; playwright=require('/opt/codex/cua_node/lib/node_modules/playwright'); }
const { chromium } = playwright;

function inheritedProxyOptions(env, protocol) {
  const raw = protocol === 'https:'
    ? env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy
    : env.HTTP_PROXY || env.http_proxy || env.HTTPS_PROXY || env.https_proxy;
  if (!raw) return undefined;
  let proxy;
  try { proxy = new URL(raw); } catch { throw new Error('The inherited proxy URL is invalid; repair environment proxy configuration before verification.'); }
  if (!['http:', 'https:', 'socks5:'].includes(proxy.protocol) || (proxy.pathname && proxy.pathname !== '/') || proxy.search || proxy.hash) {
    throw new Error('The inherited proxy URL is not supported; do not remove it or retry with a direct connection.');
  }
  const options = {server:`${proxy.protocol}//${proxy.host}`};
  // Proxy credentials never enter logs, reports, recovery files or URL strings.
  if(proxy.username)options.username=decodeURIComponent(proxy.username);
  if(proxy.password)options.password=decodeURIComponent(proxy.password);
  return options;
}

const recoveryInput = process.env.SMOKE_RECOVER_FILE;
const recovery = recoveryInput ? JSON.parse(fs.readFileSync(recoveryInput, 'utf8')) : null;
const target = process.env.SMOKE_BASE_URL || recovery?.base;
if (!target) throw new Error('Set SMOKE_BASE_URL explicitly; this draft never guesses a production target.');
const parsed = new URL(target);
const loopbackTarget=['localhost','127.0.0.1'].includes(parsed.hostname);
if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('SMOKE_BASE_URL must be an origin without credentials, path or query.');
if (parsed.protocol !== 'https:' && !loopbackTarget) throw new Error('Production verification requires HTTPS.');
const base = parsed.origin;
if (recovery && recovery.base !== base) throw new Error('Recovery target must match the original verification origin.');
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS verification is disabled in the environment; restore verified TLS before running this check.');
// Explicit local regression stays on this machine. External verification always
// inherits the configured proxy; no environment variable or bypass list changes.
const proxy = loopbackTarget ? undefined : inheritedProxyOptions(process.env, parsed.protocol);
if (!proxy && fs.existsSync('/etc/codex/network-policy.json') && !loopbackTarget) {
  throw new Error('This managed cloud environment has no inherited HTTP proxy; repair environment configuration. Direct production connections are not a fallback.');
}
// Both browser navigation and context.request use this explicit configuration.
// Never clear inherited proxies, add a destination bypass, or disable TLS checks.
const contextOptions = {ignoreHTTPSErrors:false,...(proxy ? {proxy} : {})};
const newContext = options => browser.newContext({...contextOptions,...options});

const stamp = Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
const privateDirectory = path.resolve('work/private');
fs.mkdirSync(privateDirectory, { recursive:true, mode:0o700 });
const recoveryFile = recoveryInput ? path.resolve(recoveryInput) : path.join(privateDirectory, `production-smoke-${stamp}.json`);
const reportFile = path.resolve(`work/production-smoke-${stamp}-report.json`);
const records = recovery?.accounts || [
  { role:'seller', username:`qa_s_${stamp}`, password:crypto.randomBytes(24).toString('base64url'), cityName:`验收云城${stamp}`, civilization:'china' },
  { role:'buyer', username:`qa_b_${stamp}`, password:crypto.randomBytes(24).toString('base64url'), cityName:`验收海城${stamp}`, civilization:'china' }
];
const players = [];
const report = { base, targetKind:loopbackTarget?'local':'production', startedAt:new Date().toISOString(), recoveryOnly:!!recovery, inheritedProxyUsed:!!proxy, success:false, checks:[], cleanup:[], errors:[] };
const pageErrors = [], assetErrors = [];
let browser;

function redact(value) {
  let text=String(value);
  // Playwright can include fill("password") in a failed action's call log.
  for(const secret of [...records.map(record=>record.password),proxy?.username,proxy?.password]) {
    if(secret)text=text.split(secret).join('[REDACTED]');
  }
  return text;
}
const safeError=error=>redact(error?.message||error);
function persistRecovery() {
  // Passwords stay only in this ignored, permission-restricted recovery file.
  fs.writeFileSync(recoveryFile, JSON.stringify({base,accounts:records}, null, 2), {mode:0o600});
  fs.chmodSync(recoveryFile, 0o600);
}
function mark(check) { report.checks.push(check); }
async function api(context, route, options = {}) {
  const method = options.method || 'GET';
  const response = await context.request.fetch(base + '/api/' + route, {
    method, timeout:25000, failOnStatusCode:false, ignoreHTTPSErrors:false,
    headers:{ ...(method === 'GET' ? {} : {'Content-Type':'application/json',Origin:base}) },
    ...(options.body !== undefined ? {data:options.body} : {})
  });
  const status = response.status();
  let data;
  try { data = await response.json(); } catch { throw new Error(`${method} /api/${route}: HTTP ${status}, expected JSON; check deployment protection and API routing.`); }
  if (options.expectedStatus !== undefined ? status !== options.expectedStatus : status < 200 || status >= 300) {
    const error = new Error(`${method} /api/${route}: HTTP ${status} ${data.error?.code || 'UNEXPECTED_STATUS'}`);
    error.status=status; error.code=data.error?.code; throw error;
  }
  return data;
}
async function idle(page) {
  await page.locator('#onlineModal .online-content[aria-busy="false"]').waitFor({timeout:30000});
  assert.equal(await page.locator('.online-notice.error').count(),0,'Online UI showed an error.');
}
async function dispatch(page,name,payload={}) {
  return page.evaluate(({name,payload})=>CityBridge.dispatch(name,JSON.stringify(payload)),{name,payload});
}
async function bootEngine(page) {
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.CityBridge&&typeof S!=='undefined'&&!!S);
  await page.waitForFunction(()=>window.godotReady===true,{},{timeout:120000});
}
async function openOnline(page,tab='cloud') {
  await page.evaluate(tab=>OnlineUI.open(tab),tab);await idle(page);
}
// Keep independent device storage and API sessions, but release inactive WebGL
// contexts so software-rendered CI does not spend all its GPU time on old pages.
async function park(player) { await player.page.goto('about:blank'); }
async function resume(player) {
  await bootEngine(player.page);
  if(await player.page.evaluate(()=>speed!==0))await dispatch(player.page,'pause');
  return player.page.evaluate(()=>({wood:S.goods.wood,gold:S.gold}));
}
async function createPlayer(record) {
  const context = await newContext({viewport:{width:1365,height:900}});
  const player = {record,context,page:null}; players.push(player);
  record.attempted = true; persistRecovery();
  const page = await context.newPage(); player.page=page;
  page.setDefaultTimeout(30000);
  page.on('pageerror',error=>pageErrors.push(safeError(error)));
  page.on('console',message=>{if(/SCRIPT ERROR:|Parse Error:|Compile Error:|Failed to load script/.test(message.text()))pageErrors.push(message.text());});
  page.on('crash',()=>pageErrors.push('Godot browser page crashed'));
  page.on('response',response=>{if(response.status()>=400 && /\/(?:assets|js|engine-web)\/|\/(?:style|online)\.css$/.test(new URL(response.url()).pathname))assetErrors.push({path:new URL(response.url()).pathname,status:response.status()});});
  await bootEngine(page);
  await dispatch(page,'new_city',{cityName:record.cityName,seed:`qa-${stamp}-${record.role}`,mode:'campaign'});
  await dispatch(page,'pause');
  assert.equal(await page.evaluate(()=>S.tiles.length),64);
  assert.equal(await page.evaluate(()=>S.civilization),'china');
  assert.equal(await page.evaluate(()=>speed),0);
  await openOnline(page);
  await page.locator('[data-action="auth"]').click();
  await page.locator('#onlineAuth [name="username"]').fill(record.username);
  await page.locator('#onlineAuth [name="password"]').fill(record.password);
  await page.locator('#onlineAuth button[type="submit"]').click();
  await page.locator('#cityPublic').waitFor(); await idle(page);
  const me = await api(context,'account/me');
  assert.equal(me.user.username,record.username); record.id=me.user.id; persistRecovery();
  await page.locator('#cityPublic').uncheck();
  await page.locator('[data-action="upload"]').click(); await idle(page);
  const cloud = (await api(context,'save')).save;
  assert.equal(cloud.city.public,false); assert.equal(cloud.state.cityName,record.cityName);
  assert.equal(cloud.state.version,5);assert.equal(cloud.state.clock.version,1);
  mark(`${record.role}: full Godot startup, browser registration and private v5 cloud upload`);
  return player;
}
async function setPublicUI(player,value) {
  await player.page.locator('[data-tab="cloud"]').click(); await idle(player.page);
  await player.page.locator('#cityPublic').setChecked(value);
  await player.page.locator('[data-action="upload"]').click(); await idle(player.page);
  assert.equal((await api(player.context,'save')).save.city.public,value);
}
async function loginForCleanup(player) {
  let me;
  try { me=await api(player.context,'account/me'); }
  catch(error) {
    if(error.status !== 401)throw error;
    me=await api(player.context,'account/login',{method:'POST',body:{username:player.record.username,password:player.record.password}});
  }
  assert.equal(me.user.username,player.record.username,'Cleanup must never touch another account.');
  if(player.record.id)assert.equal(me.user.id,player.record.id);
  player.record.id=me.user.id; persistRecovery();
  return me;
}
async function cleanPlayer(player) {
  const outcome={role:player.record.role,username:player.record.username,private:false,noOpenTrades:false,loggedOut:false,errors:[]};
  report.cleanup.push(outcome);
  try { await loginForCleanup(player); }
  catch(error) {
    // A UI error before successful registration can leave only a recovery intent.
    if(error.code==='INVALID_CREDENTIALS' && !player.record.id){outcome.notCreated=true;return;}
    outcome.errors.push(safeError(error));return;
  }
  try {
    const orders=await api(player.context,'trades');
    for(const trade of orders.mine.filter(order=>order.sellerId===player.record.id && order.status==='open')) {
      const requestId=crypto.randomUUID();
      for(let attempt=0;attempt<3;attempt++) {
        const save=(await api(player.context,'save')).save;
        try { await api(player.context,`trades/${trade.id}/cancel`,{method:'POST',body:{revision:save.revision,requestId}});break; }
        catch(error){if(error.code==='TRADE_CLOSED')break;if(error.code!=='REVISION_CONFLICT'||attempt===2)throw error;}
      }
    }
    const after=await api(player.context,'trades');
    assert.ok(!after.mine.some(order=>order.sellerId===player.record.id&&order.status==='open'));
    outcome.noOpenTrades=true;
  } catch(error) { outcome.errors.push(safeError(error)); }
  // Privacy cleanup still runs even if cancellation encountered a service error.
  try {
    for(let attempt=0;attempt<3;attempt++) {
      const save=(await api(player.context,'save')).save;
      if(!save){outcome.private=true;break;}
      try {
        const result=await api(player.context,'save',{method:'PUT',body:{revision:save.revision,state:save.state,city:{name:save.city.name,public:false}}});
        assert.equal(result.save.city.public,false);outcome.private=true;break;
      } catch(error){if(error.code!=='REVISION_CONFLICT'||attempt===2)throw error;}
    }
    await api(player.context,'cities/'+player.record.id,{expectedStatus:404});
    const cities=await api(player.context,'cities'),board=await api(player.context,'leaderboard');
    assert.ok(!cities.cities.some(city=>city.id===player.record.id));
    assert.ok(!board.entries.some(city=>city.id===player.record.id));
  } catch(error) { outcome.private=false;outcome.errors.push(safeError(error)); }
  try {
    await api(player.context,'account/logout',{method:'POST',body:{}});
    await api(player.context,'account/me',{expectedStatus:401});outcome.loggedOut=true;
  } catch(error) { outcome.errors.push(safeError(error)); }
}

async function verify() {
  const probe=await newContext();
  try {
    const health=await api(probe,'health');
    assert.equal(health.ok,true);assert.equal(health.persistent,true);
    if(!loopbackTarget) {assert.equal(health.storage,'postgres');assert.equal(health.production,true);}
    mark(loopbackTarget?'persistent local health (loopback)':'persistent production health');
  } finally { await probe.close(); }
  const seller=await createPlayer(records[0]);await park(seller);
  const buyer=await createPlayer(records[1]);await park(buyer);
  const s=seller.page,b=buyer.page;
  await resume(seller);await openOnline(s);
  await setPublicUI(seller,true);
  const sellerId=seller.record.id;
  await park(seller);await resume(buyer);await openOnline(b);
  const buyerHome=await b.evaluate(()=>({name:S.cityName,wood:S.goods.wood,gold:S.gold}));
  const publicCity=await api(buyer.context,'cities/'+sellerId);
  assert.equal(publicCity.state.log.length,0);
  const board=await api(buyer.context,'leaderboard');assert.equal(board.competitive,false);
  // The list is capped at 100; new cities need not rank on an established server.
  if(board.entries.length<100)assert.ok(board.entries.some(city=>city.id===sellerId));
  await b.locator('[data-tab="cities"]').click();await idle(b);
  await b.locator(`[data-action="visit"][data-id="${sellerId}"]`).click();
  await b.locator('#cityVisitBar').waitFor();
  assert.equal(await b.evaluate(()=>OnlineUI.visiting),true);
  assert.equal(await b.evaluate(()=>S.cityName),seller.record.cityName);
  await b.keyboard.press('Space');await b.keyboard.press('4');
  assert.equal(await b.evaluate(()=>speed),0);assert.equal(await b.evaluate(()=>save()),false);
  await b.locator('#cityVisitBar button').click();
  assert.equal(await b.evaluate(()=>S.cityName),buyerHome.name);
  assert.equal(await b.evaluate(()=>S.goods.wood),buyerHome.wood);
  await park(buyer);await resume(seller);await openOnline(s);
  await setPublicUI(seller,false); // Minimize the public city exposure window.
  await api(buyer.context,'cities/'+sellerId,{expectedStatus:404});
  mark('temporary public visit, read-only behavior, return home, then private again');

  const sellerBefore=await s.evaluate(()=>({wood:S.goods.wood,gold:S.gold}));
  await s.locator('[data-tab="market"]').click();await idle(s);
  await s.locator('[name="resource"]').selectOption('wood');
  await s.locator('[name="quantity"]').fill('1');await s.locator('[name="unitPrice"]').fill('1');
  await s.locator('#onlineTrade button[type="submit"]').click();await idle(s);
  const trade=(await api(seller.context,'trades')).mine.find(order=>order.sellerId===sellerId&&order.status==='open');
  assert.ok(trade,'The seller must have one real escrow order.');report.tradeId=trade.id;
  assert.equal(await s.evaluate(()=>S.goods.wood),sellerBefore.wood-1);
  await park(seller);await resume(buyer);await openOnline(b,'market');
  const buyerBefore=await b.evaluate(()=>({wood:S.goods.wood,gold:S.gold}));
  await b.locator(`[data-action="buyTrade"][data-id="${trade.id}"]`).click();await idle(b);
  assert.equal(await b.evaluate(()=>S.goods.wood),buyerBefore.wood+1);
  assert.equal(await b.evaluate(()=>S.gold),buyerBefore.gold-1);
  await park(buyer);const sellerResume=await resume(seller);await openOnline(s);
  assert.equal(await s.evaluate(()=>S.gold),sellerResume.gold+1);
  const sellerCloud=(await api(seller.context,'save')).save;
  assert.equal(sellerCloud.state.goods.wood,sellerBefore.wood-1);
  const complete=(await api(seller.context,'trades')).mine.find(order=>order.id===trade.id);
  assert.equal(complete.status,'sold');assert.equal(complete.buyerId,buyer.record.id);
  assert.ok((await api(seller.context,'ledger')).entries.some(entry=>entry.tradeId===trade.id&&entry.kind==='sale'));
  assert.ok((await api(buyer.context,'ledger')).entries.some(entry=>entry.tradeId===trade.id&&entry.kind==='purchase'));
  mark('one-wood/one-gold browser trade, both inventories, seller reconciliation and ledger');

  const independent=await newContext();
  const independentCleanup={role:'independent-session',loggedOut:false,errors:[]};report.cleanup.push(independentCleanup);
  try {
    const login=await api(independent,'account/login',{method:'POST',body:{username:seller.record.username,password:seller.record.password}});
    assert.equal(login.user.id,sellerId);assert.equal(login.save.revision,sellerCloud.revision);
    assert.equal(login.save.state.gold,sellerBefore.gold+1);
  } finally {
    try {
      await api(independent,'account/logout',{method:'POST',body:{}});
      await api(independent,'account/me',{expectedStatus:401});independentCleanup.loggedOut=true;
    } catch(error) { independentCleanup.errors.push(safeError(error)); }
    finally { await independent.close(); }
  }
  mark('independent session login restores the persisted cloud settlement');
  await s.locator('[data-action="close"]').click();
  await dispatch(s,'night',{mode:'day'});
  await s.screenshot({path:`work/production-smoke-${stamp}.png`});
  assert.deepEqual(pageErrors,[]);assert.deepEqual(assetErrors,[]);
  mark('runtime assets and browser console');
}

(async()=>{
  persistRecovery();
  try {
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl'],...(proxy ? {proxy} : {})});
    if(recovery){for(const record of records)players.push({record,context:await newContext()});}
    else await verify();
    report.success=true;
  } catch(error) { report.errors.push(safeError(error));process.exitCode=1; }
  finally {
    for(const player of players) {
      try { await cleanPlayer(player); }
      catch(error) { report.cleanup.push({role:player.record.role,errors:[safeError(error)]}); }
    }
    if(report.cleanup.some(item=>item.errors.length)){report.success=false;process.exitCode=1;}
    report.finishedAt=new Date().toISOString();report.accounts=records.map(({role,username,id})=>({role,username,id}));
    fs.writeFileSync(reportFile,redact(JSON.stringify(report,null,2)),{mode:0o600});
    if(browser)await browser.close();
    console.log(redact(JSON.stringify({targetKind:report.targetKind,success:report.success,checks:report.checks,cleanup:report.cleanup,reportFile,recoveryFile},null,2)));
    if(!report.success)process.exitCode=1;
  }
})();
