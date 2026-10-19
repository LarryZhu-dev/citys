'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {createApp} = require('../server/app.cjs');
const {reportStorageError} = require('../server/diagnostics.cjs');

test('database failures expose a bounded health category, never driver secrets or stack traces', async t => {
  const secret = 'postgresql://private_user:never_publish_this@private-host.example/private_db';
  const failure = Object.assign(new Error(`password authentication failed: ${secret}`), {code:'28P01',query:'SELECT sensitive_data',detail:secret});
  const logger = t.mock.method(console, 'error', () => {});
  const app = createApp({env:{NODE_ENV:'production'},store:{ready:async()=>{throw failure;}},onError:reportStorageError});
  const server = http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(base+'/api/health');
  assert.equal(health.status,503);
  const body = await health.json();
  assert.deepEqual(body.diagnostic,{category:'DB_AUTH_FAILED',retryable:false});
  assert.equal(body.error.code,'SERVICE_UNAVAILABLE');
  const normal = await (await fetch(base+'/api/save')).json();
  assert.equal(normal.diagnostic,undefined);
  const combined=JSON.stringify([body,normal,logger.mock.calls.map(call=>call.arguments)]);
  for (const value of [secret,'private_user','never_publish_this','private-host','SELECT sensitive_data',failure.stack]) assert.ok(!combined.includes(value));
  assert.deepEqual(JSON.parse(logger.mock.calls[0].arguments[0]),{event:'storage_failure',category:'DB_AUTH_FAILED',retryable:false});
});
