'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createServer } = require('../server/index.cjs');
const { PostgresStore } = require('../server/store.cjs');
const { createApp } = require('../server/app.cjs');
const { vercelHandler } = require('../server/vercel.cjs');
const http = require('node:http');

function fixture(overrides = {}) {
  const tiles = Array.from({length:8},()=>Array.from({length:8},()=>({t:'grass',b:null})));
  tiles[0][0].b = {id:1,type:'house',origin:[0,0],lvl:2,pop:10,staffed:false};
  return {v:4,tick:123,pop:10,goods:{grain:100,wood:100,stone:100},gold:1000,caps:{food:300,mat:400},prestige:40,chapter:0,taskDone:[[false]],chapterCompleted:[false],tiles,
    stats:{taxed:100,maxPop:10,totalBuilt:1,disasters:0},won:false,uid:1,signpost:{x:7,y:0},start:{x:2,y:2},civilization:'china',cityName:'青云城',seed:12345,mode:'campaign',rngState:12345,log:[{msg:'我的私人城市日志',cls:'good'}],...overrides};
}
async function listen(server) {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) { await new Promise(resolve=>server.close(resolve)); await server.app.store.close(); }

test('persistent real HTTP account, saves, public cities, atomic marketplace and security', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'citys-api-'));
  const env = {DATA_FILE:path.join(directory,'db.json')};
  const database = process.env.TEST_DATABASE_URL ? new PostgresStore(process.env.TEST_DATABASE_URL) : null;
  let server = createServer({env, ...(database ? {store:database} : {}),onError:e=>console.error(e.message)});
  let base = await listen(server);
  const peer = database ? createServer({env,store:new PostgresStore(process.env.TEST_DATABASE_URL)}) : null;
  const peerBase = peer ? await listen(peer) : null;
  t.after(async()=>{ await close(server); if(peer)await close(peer); await fs.rm(directory,{recursive:true,force:true}); });
  async function call(route,{method='GET',body,cookie,headers={},target=base}={}) {
    const response = await fetch(target+route,{method,headers:{...(body !== undefined ? {'Content-Type':'application/json'} : {}),...(cookie ? {Cookie:cookie} : {}),...headers},...(body !== undefined ? {body:typeof body === 'string' ? body : JSON.stringify(body)} : {})});
    const raw = await response.text();
    let data; try { data = JSON.parse(raw); } catch { data = raw; }
    return {status:response.status,data,cookie:response.headers.get('set-cookie'),headers:response.headers};
  }
  const suffix = crypto.randomBytes(4).toString('hex');
  let alice,bob,carol,sandbox;
  let a,b,c,s;
  const password = 'correct horse battery';
  async function register(name) {
    const result = await call('/api/account/register',{method:'POST',body:{username:name+suffix,password}});
    assert.equal(result.status,201,JSON.stringify(result.data));
    assert.match(result.cookie,/HttpOnly/); assert.match(result.cookie,/SameSite=Lax/);
    assert.equal(result.data.save,null);
    assert.deepEqual(Object.keys(result.data.user).sort(),['id','username']);
    return {cookie:result.cookie.split(';')[0],user:result.data.user};
  }
  async function save(player,state,revision=0,isPublic=true) {
    return call('/api/save',{method:'PUT',cookie:player.cookie,body:{revision,state,city:{name:state.cityName,public:isPublic}}});
  }
  async function trade(player,body,route='/api/trades',target=base) { return call(route,{method:'POST',cookie:player.cookie,body:{requestId:crypto.randomUUID(),...body},target}); }

  await t.test('health checks storage, passwords are salted hashes, login cookie never exposes a token in JSON',async()=>{
    const health = await call('/api/health'); assert.equal(health.status,200); assert.equal(health.data.persistent,true);
    assert.equal((await call('/api/account/me')).status,401);
    assert.equal((await call('/api/account/register',{method:'POST',body:{username:'short',password:'123'}})).status,400);
    alice=await register('alice'); bob=await register('bob'); carol=await register('carol'); sandbox=await register('sandbox');
    assert.equal((await call('/api/account/login',{method:'POST',body:{username:alice.user.username,password:'wrong password'}})).status,401);
    const login=await call('/api/account/login',{method:'POST',body:{username:alice.user.username.toUpperCase(),password}}); assert.equal(login.status,200);
    alice.cookie=login.cookie.split(';')[0];
    const users=await server.app.store.transaction(tx=>tx.list('users'));
    const saved=users.filter(u=>[alice.user.id,bob.user.id].includes(u.id));
    assert.notEqual(saved[0].salt,saved[1].salt); assert.notEqual(saved[0].passwordHash,saved[1].passwordHash);
    assert.ok(!JSON.stringify(saved).includes(password));
  });
  await t.test('save schema rejects unsafe/invalid state, strips arbitrary fields, persists full construction footprints',async()=>{
    assert.equal((await save(alice,fixture({goods:{wood:-1}}))).status,400);
    const invalid=fixture(); invalid.tiles[0][0].b.type='__proto__'; assert.equal((await save(alice,invalid)).status,400);
    const orphan=fixture(); orphan.tiles[0][0].b.type='villa'; assert.equal((await save(alice,orphan)).status,400);
    const constructing=fixture();
    const building={id:2,type:'villa',origin:[2,2],lvl:2,construction:{remaining:5,total:10,fromLevel:1,toLevel:2},privatePassword:'not persisted'};
    for(let y=2;y<4;y++) for(let x=2;x<4;x++) constructing.tiles[y][x].b=building;
    constructing.evil='<script>alert(1)</script>'; constructing.uid=2;
    const first=await save(alice,constructing); assert.equal(first.status,200,JSON.stringify(first.data)); a=first.data.save;
    assert.equal(a.revision,1); assert.equal(a.clientRevision,1); assert.equal(a.state.evil,undefined); assert.equal(a.state.tiles[2][2].b.privatePassword,undefined);
    assert.equal(a.state.tiles[2][2].b.construction.toLevel,2);
    b=(await save(bob,fixture())).data.save; c=(await save(carol,fixture(),0,false)).data.save;
    s=(await save(sandbox,fixture({mode:'sandbox'}))).data.save;
    const stale=await save(alice,fixture(),0); assert.equal(stale.status,409); assert.equal(stale.data.error.code,'REVISION_CONFLICT'); assert.equal(stale.data.save.revision,a.revision);
    assert.equal((await save({cookie:bob.cookie},fixture(),a.revision+100)).status,409);
  });
  await t.test('public visits exclude private cities, rankings use real campaign saves and public snapshots omit logs',async()=>{
    const listing=await call('/api/cities'); assert.ok(listing.data.cities.some(x=>x.id===alice.user.id)); assert.ok(!listing.data.cities.some(x=>x.id===carol.user.id));
    assert.equal((await call('/api/cities/'+carol.user.id)).status,404);
    const visit=await call('/api/cities/'+alice.user.id); assert.equal(visit.status,200); assert.equal(visit.data.state.log.length,0); assert.equal(visit.data.state.tiles[2][2].b.construction.remaining,5);
    const board=await call('/api/leaderboard'); assert.equal(board.data.competitive,false); assert.ok(!board.data.entries.some(x=>x.id===sandbox.user.id));
    assert.equal((await trade(sandbox,{revision:s.revision,resource:'wood',quantity:5,unitPrice:2})).status,403);
  });
  let offer;
  await t.test('posting escrows inventory and idempotency cannot double escrow or change request payload',async()=>{
    const requestId=crypto.randomUUID();
    const result=await trade(alice,{revision:a.revision,resource:'wood',quantity:20,unitPrice:3,requestId});
    assert.equal(result.status,201,JSON.stringify(result.data)); offer=result.data.trade; a=result.data.save;
    assert.equal(a.state.goods.wood,80); assert.equal(a.revision,2); assert.equal(a.clientRevision,1);
    const duplicate=await trade(alice,{revision:1,resource:'wood',quantity:20,unitPrice:3,requestId});
    assert.equal(duplicate.status,200); assert.equal(duplicate.data.duplicate,true); assert.equal(duplicate.data.save.state.goods.wood,80);
    assert.equal((await trade(alice,{revision:a.revision,resource:'wood',quantity:21,unitPrice:3,requestId})).status,409);
    assert.equal((await trade(alice,{revision:a.revision,resource:'wood',quantity:1000,unitPrice:3})).data.error.code,'INSUFFICIENT_GOODS');
    assert.equal((await trade(alice,{revision:a.revision},`/api/trades/${offer.id}/buy`)).data.error.code,'SELF_TRADE');
    assert.equal((await trade(bob,{revision:b.revision},`/api/trades/${offer.id}/cancel`)).status,403);
    assert.equal((await save(alice,fixture({seed:888}),a.revision)).data.error.code,'OPEN_TRADES');
  });
  await t.test('simultaneous buyers transfer exactly once, both revisions advance, old saves cannot restore spent inventory',async()=>{
    const [r1,r2]=await Promise.all([trade(bob,{revision:b.revision},`/api/trades/${offer.id}/buy`),trade(carol,{revision:c.revision},`/api/trades/${offer.id}/buy`,peerBase||base)]);
    assert.deepEqual([r1.status,r2.status].sort(),[200,409]);
    const winner=r1.status===200 ? bob : carol;
    const winning=r1.status===200 ? r1 : r2;
    assert.equal(winning.data.save.state.goods.wood,120); assert.equal(winning.data.save.state.gold,940);
    const repeated=await trade(winner,{revision:1},`/api/trades/${offer.id}/buy`); assert.equal(repeated.data.duplicate,true); assert.equal(repeated.data.save.state.gold,940);
    const seller=(await call('/api/save',{cookie:alice.cookie})).data.save;
    assert.equal(seller.state.gold,1060); assert.equal(seller.state.goods.wood,80); assert.equal(seller.revision,a.revision+1);
    const stale=await save(alice,fixture(),a.revision); assert.equal(stale.status,409); assert.equal(stale.data.save.state.gold,1060);
    // The owner has kept building locally during a remote sale. The unchanged
    // clientRevision distinguishes transaction deltas from another device's PUT.
    assert.equal(seller.clientRevision,a.clientRevision);
    const localProgress=structuredClone(a.state);
    localProgress.tick += 15;
    localProgress.tiles[4][4].b={id:3,type:'house',origin:[4,4],lvl:1,pop:0}; localProgress.uid=3;
    localProgress.goods.wood -= 10;
    for(const key of Object.keys(seller.state.goods)) localProgress.goods[key] += seller.state.goods[key] - a.state.goods[key];
    localProgress.gold += seller.state.gold-a.state.gold;
    const merged=await save(alice,localProgress,seller.revision);
    assert.equal(merged.status,200); assert.equal(merged.data.save.state.tiles[4][4].b.id,3);
    assert.equal(merged.data.save.state.gold,1060); assert.equal(merged.data.save.state.goods.wood,70);
    assert.equal(merged.data.save.clientRevision,merged.data.save.revision);
    // Restore only the ten wood spent by this synthetic construction fixture so
    // conservation assertions below continue to start from 300 total resources.
    merged.data.save.state.goods.wood += 10;
    a=(await save(alice,merged.data.save.state,merged.data.save.revision)).data.save;
    b=(await call('/api/save',{cookie:bob.cookie})).data.save;
    c=(await call('/api/save',{cookie:carol.cookie})).data.save;
    const ledger=(await call('/api/ledger',{cookie:alice.cookie})).data.entries;
    assert.equal(ledger.filter(x=>x.tradeId===offer.id).length,2);
    assert.equal(ledger.filter(x=>x.tradeId===offer.id).reduce((sum,x)=>sum+x.goldDelta,0),60);
  });
  await t.test('cancel is idempotent and concurrent buy/cancel never refunds and delivers the same goods',async()=>{
    let result=await trade(alice,{revision:a.revision,resource:'wood',quantity:10,unitPrice:2}); a=result.data.save;
    const id=result.data.trade.id;
    const [cancel,buy]=await Promise.all([trade(alice,{revision:a.revision},`/api/trades/${id}/cancel`),trade(bob,{revision:b.revision},`/api/trades/${id}/buy`)]);
    assert.deepEqual([cancel.status,buy.status].sort(),[200,409]);
    a=(await call('/api/save',{cookie:alice.cookie})).data.save;
    b=(await call('/api/save',{cookie:bob.cookie})).data.save;
    c=(await call('/api/save',{cookie:carol.cookie})).data.save;
    assert.equal(a.state.goods.wood+b.state.goods.wood+c.state.goods.wood,300);
    assert.equal(a.state.gold+b.state.gold+c.state.gold,3000);
    result=await trade(alice,{revision:a.revision,resource:'stone',quantity:10,unitPrice:2}); a=result.data.save;
    const refund=await trade(alice,{revision:a.revision},`/api/trades/${result.data.trade.id}/cancel`); a=refund.data.save;
    const again=await trade(alice,{revision:0},`/api/trades/${result.data.trade.id}/cancel`); assert.equal(again.data.duplicate,true); assert.equal(again.data.save.state.goods.stone,100);
  });
  await t.test('CSRF, malformed JSON, oversized requests, private server files and logout are enforced',async()=>{
    assert.equal((await call('/api/account/logout',{method:'POST',cookie:alice.cookie,body:{},headers:{Origin:'https://evil.example'}})).status,403);
    assert.equal((await call('/api/account/logout',{method:'POST',cookie:alice.cookie,body:{},headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
    assert.equal((await call('/api/save',{method:'PUT',cookie:alice.cookie,body:'{broken'})).status,400);
    const oversized=await call('/api/save',{method:'PUT',cookie:alice.cookie,body:{padding:'x'.repeat(3*1024*1024)}}); assert.equal(oversized.status,413);
    for(const file of ['/server/app.cjs','/.env','/work/local-online.json','/package.json','/js/../server/app.cjs']) assert.equal((await call(file)).status,404);
    assert.equal((await call('/index.html')).status,200);
    const out=await call('/api/account/logout',{method:'POST',cookie:alice.cookie,body:{},headers:{Origin:base}}); assert.equal(out.status,200); assert.match(out.cookie,/Max-Age=0/);
    assert.equal((await call('/api/account/me',{cookie:alice.cookie})).status,401);
  });
  await t.test('persistent store survives server restart and sessions and inventories are restored',async()=>{
    await close(server);
    server=createServer({env,...(process.env.TEST_DATABASE_URL ? {store:new PostgresStore(process.env.TEST_DATABASE_URL)} : {})});
    base=await listen(server);
    const me=await call('/api/account/me',{cookie:bob.cookie}); assert.equal(me.status,200); assert.equal(me.data.user.id,bob.user.id); assert.equal(me.data.save.state.gold,b.state.gold);
    const login=await call('/api/account/login',{method:'POST',body:{username:alice.user.username,password}}); assert.equal(login.status,200); assert.equal(login.data.save.revision,a.revision);
  });
  await t.test('failed login rate limits persist in storage, including separate instances',async()=>{
    const username='unknown'+suffix;
    for(let i=0;i<12;i++) assert.equal((await call('/api/account/login',{method:'POST',body:{username,password},target:i%2 ? peerBase||base : base})).status,401);
    const limited=await call('/api/account/login',{method:'POST',body:{username,password}});
    assert.equal(limited.status,429); assert.equal(limited.data.error.code,'RATE_LIMITED');
  });
});

test('Vercel without a persistent database fails closed with explicit 503 and no local fallback', async t=>{
  const server=createServer({env:{VERCEL:'1'}}),base=await listen(server);
  t.after(()=>close(server));
  for(const route of ['/api/health','/api/cities','/api/leaderboard']) {
    const response=await fetch(base+route); assert.equal(response.status,503);
    const data=await response.json(); assert.equal(data.error.code,'DATABASE_NOT_CONFIGURED');
  }
  assert.equal(server.app.store.kind,'unconfigured');
});

test('Vercel rewrite adapter preserves nested API paths, parsed request bodies and queries',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'citys-vercel-'));
  const app=createApp({env:{DATA_FILE:path.join(directory,'db.json')}});
  const handler=vercelHandler(app);
  const server=http.createServer(async(req,res)=>{
    if(req.headers['x-test-body-error']) Object.defineProperty(req,'body',{get(){throw new SyntaxError('malformed JSON');}});
    // Reproduce Vercel's optional body/query parsing before calling our entry.
    if(req.headers['x-test-parsed']) {
      req.query=Object.fromEntries(new URL(req.url,'http://localhost').searchParams);
      if(req.method==='POST') { let raw=''; for await(const chunk of req)raw+=chunk; req.body=JSON.parse(raw); }
      req.url='/api/index';
    }
    return handler(req,res);
  });
  server.app=app;
  const base=await listen(server);
  t.after(async()=>{await close(server);await fs.rm(directory,{recursive:true,force:true});});
  const health=await fetch(base+'/api/index?__path=health'); assert.equal(health.status,200);
  const register=await fetch(base+'/api/index?__path=account%2Fregister',{method:'POST',headers:{'Content-Type':'application/json','X-Test-Parsed':'true'},body:JSON.stringify({username:'vercel-test',password:'long test password'})});
  assert.equal(register.status,201);
  const cookie=register.headers.get('set-cookie').split(';')[0];
  const me=await fetch(base+'/api/index?__path=account%2Fme',{headers:{Cookie:cookie}});
  assert.equal(me.status,200); assert.equal((await me.json()).user.username,'vercel-test');
  const nested=await fetch(base+'/api/index?__path=trades%2Fmissing%2Fbuy',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Test-Parsed':'true'},body:JSON.stringify({revision:0,requestId:crypto.randomUUID()})});
  assert.equal(nested.status,404); assert.equal((await nested.json()).error.code,'TRADE_NOT_FOUND');
  const malformed=await fetch(base+'/api/index?__path=account%2Flogin',{method:'POST',headers:{'Content-Type':'application/json','X-Test-Body-Error':'true'},body:'{broken'});
  assert.equal(malformed.status,400); assert.equal((await malformed.json()).error.code,'INVALID_JSON');
});
