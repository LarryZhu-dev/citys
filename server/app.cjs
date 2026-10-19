'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { createStore } = require('./store.cjs');
const { ApiError, fail } = require('./errors.cjs');
const { storageDiagnostic } = require('./diagnostics.cjs');
const { RESOURCES, MAX_INVENTORY, sanitizeState, sanitizeCity, publicState, citySummary, number, object } = require('./validate.cjs');
const scrypt = promisify(crypto.scrypt);
const SESSION_SECONDS = 60 * 60 * 24 * 14;
const MAX_BODY = 3 * 1024 * 1024;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const userView = user => ({ id:user.id, username:user.username });
const saveView = save => save ? ({ revision:save.revision, clientRevision:save.clientRevision ?? save.revision, state:save.state, city:save.city, updatedAt:save.updatedAt }) : null;

function sameOrigin(req, env) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return;
  if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'CROSS_ORIGIN', '请从游戏页面发起此操作。');
  if (!req.headers.origin) return; // CLI clients have no ambient browser credentials.
  const expected = env.APP_ORIGIN || `${env.VERCEL || env.NODE_ENV === 'production' || req.socket?.encrypted ? 'https' : 'http'}://${req.headers.host}`;
  try { if (new URL(req.headers.origin).origin === new URL(expected).origin) return; } catch { /* reject malformed origin */ }
  fail(403, 'CROSS_ORIGIN', '此操作不允许跨站请求。');
}
async function readBody(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) fail(415, 'JSON_REQUIRED', '请求必须使用 application/json。');
  if (Number(req.headers['content-length']) > MAX_BODY) fail(413, 'BODY_TOO_LARGE', '存档超过 3 MB 上限。');
  let raw;
  // Vercel exposes body as a lazy JSON getter, which can itself throw.
  try { raw = req.body; } catch { fail(400, 'INVALID_JSON', '无法解析 JSON 请求。'); }
  if (raw === undefined) {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) fail(413, 'BODY_TOO_LARGE', '存档超过 3 MB 上限。');
      chunks.push(chunk);
    }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  try {
    if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
    if (typeof raw === 'string') { if (Buffer.byteLength(raw) > MAX_BODY) fail(413,'BODY_TOO_LARGE','请求过大。'); raw = JSON.parse(raw || '{}'); }
    else if (Buffer.byteLength(JSON.stringify(raw)) > MAX_BODY) fail(413,'BODY_TOO_LARGE','请求过大。');
  } catch (error) { if (error instanceof ApiError) throw error; fail(400, 'INVALID_JSON', '无法解析 JSON 请求。'); }
  return object(raw, 'request');
}
function credentials(body) {
  if (typeof body.username !== 'string' || !/^[\p{L}\p{N}_-]{3,24}$/u.test(body.username)) fail(400, 'INVALID_USERNAME', '用户名需为 3–24 个中文、字母、数字、下划线或短横线。');
  if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 128) fail(400, 'INVALID_PASSWORD', '密码长度需为 10–128 个字符。');
  return { username:body.username.normalize('NFKC'), key:body.username.normalize('NFKC').toLocaleLowerCase('en-US'), password:body.password };
}
function cookieToken(req) {
  const match = /(?:^|;\s*)citys_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || '');
  return match?.[1];
}
function sessionCookie(token, secure, clear = false) {
  return `citys_session=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_SECONDS}${secure ? '; Secure' : ''}`;
}
function requireRevision(input, save) {
  if (!Number.isSafeInteger(input) || input < 0) fail(400, 'INVALID_REVISION', '请提供有效存档版本号。');
  if (input !== (save?.revision || 0)) fail(409, 'REVISION_CONFLICT', '云端城市已更新，请下载云端存档再继续。旧存档不会覆盖交易结算。', {save:saveView(save)});
}
function requireCampaign(save) {
  if (!save) fail(409, 'SAVE_REQUIRED', '请先将城市保存到云端。');
  if (save.state.mode !== 'campaign') fail(403, 'SANDBOX_NOT_ELIGIBLE', '沙盒城市不参与玩家交易和休闲排行。');
}
function advance(save) { save.revision++; save.updatedAt = now(); }
function requestKey(body) {
  if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(body.requestId)) fail(400, 'REQUEST_ID_REQUIRED', '交易操作需要唯一 requestId（推荐 UUID）。');
  return body.requestId;
}
async function ledger(tx, userId, trade, kind, resourceDelta, goldDelta, revision) {
  const id = crypto.randomUUID();
  await tx.set('ledger', id, {id,userId,tradeId:trade.id,kind,resource:trade.resource,resourceDelta,goldDelta,revision,createdAt:now()});
}

function createApp(options = {}) {
  const env = options.env || process.env;
  const store = options.store || createStore(env);
  const production = !!env.VERCEL || env.NODE_ENV === 'production';
  async function rateLimit(key, limit, duration) {
    const blocked = await store.transaction(async tx => {
      const timestamp = Date.now();
      const id = hash(key);
      let record = await tx.get('limits', id);
      if (!record || record.until <= timestamp) record = {id,count:0,until:timestamp+duration};
      record.count++;
      await tx.set('limits', id, record);
      // Occasional housekeeping removes expired session and rate records.
      if (record.count === 1 && crypto.randomInt(100) === 0) {
        for (const session of await tx.list('sessions')) if (session.expiresAt <= timestamp) await tx.delete('sessions', session.id);
        for (const limit of await tx.list('limits')) if (limit.id && limit.until <= timestamp) await tx.delete('limits', limit.id);
      }
      return record.count > limit;
    });
    if (blocked) fail(429, 'RATE_LIMITED', '操作过于频繁，请稍后再试。');
  }
  async function identity(req, tx, required = true) {
    const token = cookieToken(req);
    const session = token ? await tx.get('sessions', hash(token)) : null;
    if (!session || session.expiresAt <= Date.now()) {
      if (session) await tx.delete('sessions', session.id);
      if (required) fail(401, 'AUTH_REQUIRED', '请先登录。');
      return null;
    }
    const user = await tx.get('users', session.userId);
    if (!user && required) fail(401, 'AUTH_REQUIRED', '账号不存在，请重新登录。');
    return user;
  }
  async function openSession(tx, user, token) {
    const sessions = (await tx.list('sessions')).filter(s => s.userId === user.id).sort((a,b)=>b.expiresAt-a.expiresAt);
    for (const old of sessions.slice(4)) await tx.delete('sessions', old.id);
    const id = hash(token);
    await tx.set('sessions', id, {id,userId:user.id,expiresAt:Date.now()+SESSION_SECONDS*1000});
  }
  async function current(tx, user) { return {user:userView(user),save:saveView(await tx.get('saves',user.id))}; }

  const app = async (req, res) => {
    let healthRequest = false;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    try {
      sameOrigin(req,env);
      const url = new URL(req.url, 'http://localhost');
      const route = url.pathname.replace(/\/+$/,'');
      healthRequest = route === '/api/health' && req.method === 'GET';
      if (route === '/api/health' && req.method === 'GET') {
        await store.ready();
        res.statusCode = 200;
        return res.end(JSON.stringify({ok:true,storage:store.kind,persistent:true,production,competitive:false}));
      }
      await store.ready();
      const ip = env.VERCEL ? String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim() : req.socket?.remoteAddress || 'unknown';
      await rateLimit(`ip:${ip}`, 300, 60000);
      const method = req.method;
      const body = ['POST','PUT','PATCH','DELETE'].includes(method) ? await readBody(req) : null;
      let result, status = 200;

      if (['/api/account/register','/api/account/login'].includes(route) && method === 'POST') {
        const input = credentials(body);
        await rateLimit(`auth-ip:${ip}`,30,15*60000);
        await rateLimit(`auth-name:${input.key}`,12,15*60000);
        const token = crypto.randomBytes(32).toString('base64url');
        if (route.endsWith('/register')) {
          await rateLimit(`register:${ip}`,10,60*60000);
          const salt = crypto.randomBytes(32).toString('hex');
          const derived = (await scrypt(input.password,salt,64,{N:16384,r:8,p:1})).toString('hex');
          result = await store.transaction(async tx => {
            if (await tx.get('usernames',input.key)) fail(409,'USERNAME_TAKEN','这个用户名已被使用。');
            const user = {id:crypto.randomUUID(),username:input.username,salt,passwordHash:derived,createdAt:now()};
            await tx.set('users',user.id,user);
            await tx.set('usernames',input.key,{userId:user.id});
            await openSession(tx,user,token);
            return current(tx,user);
          });
          status = 201;
        } else {
          const account = await store.transaction(async tx => { const index = await tx.get('usernames',input.key); return index ? tx.get('users',index.userId) : null; });
          const derived = await scrypt(input.password,account?.salt || 'invalid-user-constant-salt',64,{N:16384,r:8,p:1});
          if (!account || !crypto.timingSafeEqual(derived,Buffer.from(account.passwordHash,'hex'))) fail(401,'INVALID_CREDENTIALS','用户名或密码错误。');
          result = await store.transaction(async tx => { await openSession(tx,account,token); return current(tx,account); });
        }
        res.setHeader('Set-Cookie',sessionCookie(token,production || req.socket?.encrypted));
      } else if (route === '/api/account/logout' && method === 'POST') {
        await store.transaction(async tx => { const token = cookieToken(req); if (token) await tx.delete('sessions',hash(token)); });
        res.setHeader('Set-Cookie',sessionCookie('',production || req.socket?.encrypted,true));
        result = {ok:true};
      } else if (route === '/api/account/me' && method === 'GET') {
        result = await store.transaction(async tx => current(tx,await identity(req,tx)));
      } else if (route === '/api/save' && method === 'GET') {
        result = await store.transaction(async tx => { const user = await identity(req,tx); return {save:saveView(await tx.get('saves',user.id))}; });
      } else if (route === '/api/save' && method === 'PUT') {
        // Authentication and revision precede validation; invalid anonymous saves
        // never cause expensive map scanning.
        result = await store.transaction(async tx => {
          const user = await identity(req,tx), previous = await tx.get('saves',user.id);
          requireRevision(body.revision,previous);
          const state = sanitizeState(body.state), city = sanitizeCity(body.city,state,previous?.city);
          if (previous && (previous.state.seed !== state.seed || previous.state.civilization !== state.civilization || previous.state.mode !== state.mode)) {
            if ((await tx.list('trades')).some(t => t.sellerId === user.id && t.status === 'open')) fail(409,'OPEN_TRADES','请先撤销挂单，再替换城市或切换游戏模式。');
            if (previous.state.mode === 'sandbox' && state.mode === 'campaign' && previous.state.seed === state.seed) fail(403,'SANDBOX_PROMOTION','沙盒城市不能转为经营城市，请创建新的经营城市。');
          }
          city.id = previous?.city.id || user.id;
          const revision = (previous?.revision || 0)+1;
          const save = {userId:user.id,revision,clientRevision:revision,state,city,updatedAt:now()};
          await tx.set('saves',user.id,save);
          return {save:saveView(save)};
        });
      } else if ((route === '/api/cities' || route === '/api/leaderboard') && method === 'GET') {
        result = await store.transaction(async tx => {
          const users = new Map((await tx.list('users')).map(u=>[u.id,u]));
          let cities = (await tx.list('saves')).filter(s=>s.city.public && users.has(s.userId));
          if (route.endsWith('leaderboard')) cities = cities.filter(s=>s.state.mode === 'campaign');
          const entries = cities.map(s=>citySummary(s,users.get(s.userId)));
          if (route.endsWith('leaderboard')) return {entries:entries.sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id)).slice(0,100).map((c,i)=>({...c,rank:i+1})),competitive:false};
          return {cities:entries.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,100)};
        });
      } else if (/^\/api\/cities\/[A-Za-z0-9-]+$/.test(route) && method === 'GET') {
        const id = route.split('/').pop();
        result = await store.transaction(async tx => {
          const save = await tx.get('saves',id), user = await tx.get('users',id);
          if (!save?.city.public || !user) fail(404,'CITY_NOT_FOUND','城市不存在或尚未公开。');
          return {city:citySummary(save,user),state:publicState(save.state)};
        });
      } else if (route === '/api/trades' && method === 'GET') {
        result = await store.transaction(async tx => {
          const user = await identity(req,tx,false), all = (await tx.list('trades')).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
          return {trades:all.filter(t=>t.status === 'open').slice(0,100),mine:user ? all.filter(t=>t.sellerId === user.id || t.buyerId === user.id).slice(0,100) : []};
        });
      } else if (method === 'POST' && (route === '/api/trades' || /^\/api\/trades\/[A-Za-z0-9-]+\/(buy|cancel)$/.test(route))) {
        const requestId = requestKey(body);
        const action = route === '/api/trades' ? 'create' : route.split('/').pop();
        const tradeId = action === 'create' ? null : route.split('/')[3];
        const fingerprint = hash(JSON.stringify({action,tradeId,resource:body.resource,quantity:body.quantity,unitPrice:body.unitPrice}));
        result = await store.transaction(async tx => {
          const user = await identity(req,tx);
          const save = await tx.get('saves',user.id);
          const key = `${user.id}:${requestId}`;
          const prior = await tx.get('requests',key);
          if (prior) {
            if (prior.fingerprint !== fingerprint) fail(409,'IDEMPOTENCY_CONFLICT','此 requestId 已用于另一笔操作。');
            return {trade:await tx.get('trades',prior.tradeId),save:saveView(save),duplicate:true};
          }
          let trade = tradeId ? await tx.get('trades',tradeId) : null;
          if (action !== 'create' && !trade) fail(404,'TRADE_NOT_FOUND','挂单不存在。');
          // Repeating an already completed own operation never transfers again,
          // even if the client accidentally creates a new idempotency key.
          if ((action === 'cancel' && trade.status === 'cancelled' && trade.sellerId === user.id) ||
              (action === 'buy' && trade.status === 'sold' && trade.buyerId === user.id)) {
            await tx.set('requests',key,{fingerprint,tradeId:trade.id});
            return {trade,save:saveView(save),duplicate:true};
          }
          requireCampaign(save);
          requireRevision(body.revision,save);
          if (action === 'create') {
            if (!RESOURCES.has(body.resource)) fail(400,'INVALID_RESOURCE','不支持交易此物资。');
            const quantity = number(body.quantity,'交易数量',1,100000,true), unitPrice = number(body.unitPrice,'单价',1,100000,true);
            const totalPrice = quantity * unitPrice;
            if (totalPrice > MAX_INVENTORY) fail(400,'TRADE_TOO_LARGE','交易总价过高。');
            if ((await tx.list('trades')).filter(t=>t.sellerId === user.id && t.status === 'open').length >= 20) fail(409,'TOO_MANY_TRADES','最多同时挂出 20 笔订单。');
            if ((save.state.goods[body.resource] || 0) < quantity) fail(409,'INSUFFICIENT_GOODS','云端仓库没有足够物资，请先保存城市。');
            save.state.goods[body.resource] -= quantity;
            advance(save);
            trade = {id:crypto.randomUUID(),sellerId:user.id,seller:user.username,resource:body.resource,quantity,unitPrice,totalPrice,status:'open',buyerId:null,createdAt:now(),closedAt:null};
            await ledger(tx,user.id,trade,'escrow',-quantity,0,save.revision);
          } else {
            if (action === 'cancel' && trade.sellerId !== user.id) fail(403,'NOT_YOUR_TRADE','只能撤销自己的挂单。');
            if (action === 'buy' && trade.sellerId === user.id) fail(409,'SELF_TRADE','不能购买自己的挂单。');
            if (trade.status !== 'open') fail(409,'TRADE_CLOSED','此挂单已成交或已撤销。');
            if (action === 'cancel') {
              if (save.state.goods[trade.resource] + trade.quantity > MAX_INVENTORY) fail(409,'INVENTORY_LIMIT','库存达到系统上限，暂时不能退回物资。');
              save.state.goods[trade.resource] += trade.quantity;
              advance(save);
              trade.status = 'cancelled';
              await ledger(tx,user.id,trade,'refund',trade.quantity,0,save.revision);
            } else {
              if (save.state.gold < trade.totalPrice) fail(409,'INSUFFICIENT_GOLD','云端金币不足，请先保存城市。');
              const seller = await tx.get('saves',trade.sellerId);
              if (!seller || seller.state.gold + trade.totalPrice > MAX_INVENTORY || save.state.goods[trade.resource] + trade.quantity > MAX_INVENTORY) fail(409,'INVENTORY_LIMIT','交易会超过库存上限。');
              save.state.gold -= trade.totalPrice;
              save.state.goods[trade.resource] += trade.quantity;
              seller.state.gold += trade.totalPrice;
              advance(save); advance(seller);
              trade.status = 'sold'; trade.buyerId = user.id;
              await tx.set('saves',trade.sellerId,seller);
              await ledger(tx,user.id,trade,'purchase',trade.quantity,-trade.totalPrice,save.revision);
              await ledger(tx,trade.sellerId,trade,'sale',0,trade.totalPrice,seller.revision);
            }
            trade.closedAt = now();
          }
          await tx.set('saves',user.id,save);
          await tx.set('trades',trade.id,trade);
          await tx.set('requests',key,{fingerprint,tradeId:trade.id});
          return {trade,save:saveView(save)};
        });
        status = action === 'create' && !result.duplicate ? 201 : 200;
      } else if (route === '/api/ledger' && method === 'GET') {
        result = await store.transaction(async tx => { const user = await identity(req,tx); return {entries:(await tx.list('ledger')).filter(e=>e.userId === user.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100)}; });
      } else fail(404,'NOT_FOUND','接口不存在。');
      res.statusCode = status;
      res.end(JSON.stringify(result));
    } catch (error) {
      const known = error instanceof ApiError;
      res.statusCode = known ? error.status : 503;
      if (res.statusCode === 429) res.setHeader('Retry-After','60');
      // Never echo SQL, connection URLs, password inputs, or driver errors.
      res.end(JSON.stringify({error:{code:known ? error.code : 'SERVICE_UNAVAILABLE',message:known ? error.message : '在线存储服务暂时不可用，请稍后重试；本地城市仍可游玩。'},...(known ? error.extra : {}),...(!known && healthRequest ? {diagnostic:storageDiagnostic(error)} : {})}));
      if (!known && options.onError) options.onError(error);
    }
  };
  app.store = store;
  return app;
}
module.exports = { createApp };
