'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Client } = require('pg');
const { PostgresStore } = require('../server/store.cjs');

function fixture(t, rejectQuery = () => null) {
  // This synthetic address is never connected to. Keep the real pg Pool config
  // so the startup-packet check exercises the installed driver, not a mock.
  const store = new PostgresStore('postgresql://fixture:fixture@localhost/fixture?sslmode=verify-full');
  const clients = [], health = [];
  store.pool.connect = async () => {
    const client = new EventEmitter();
    client.queries = [];
    client.query = async (text, values) => {
      client.queries.push({text, values});
      const error = rejectQuery(text, clients.length - 1);
      if (error) throw error;
      return {rows: []};
    };
    client.release = error => { client.released = true; client.releaseError = error; };
    clients.push(client);
    return client;
  };
  store.pool.query = async text => { health.push(text); return {rows: [{'?column?': 1}]}; };
  t.after(() => store.close());
  return {store, clients, health};
}

test('pg startup packet omits pooler-incompatible timeout parameters while retaining TLS', async t => {
  const {store} = fixture(t);
  const client = new Client(store.pool.options);
  const startup = client.getStartupConf();
  for (const key of ['options', 'statement_timeout', 'lock_timeout']) {
    assert.equal(Object.hasOwn(startup, key), false, `${key} must not enter PgBouncer startup packets`);
  }
  assert.notEqual(client.ssl, false);
  assert.notEqual(client.ssl.rejectUnauthorized, false);
  assert.ok(store.pool.options.query_timeout > 10000, 'client timeout must leave room for the server timeout');
});

test('initialization has transaction-local timeouts and can recover after a failed schema query', async t => {
  const denied = Object.assign(new Error('synthetic schema denial'), {code: '42501'});
  const {store, clients, health} = fixture(t, (sql, index) => index === 0 && sql.startsWith('CREATE TABLE') ? denied : null);
  await assert.rejects(store.ready(), error => error === denied);
  assert.equal(clients[0].releaseError, denied);
  assert.equal(clients[0].queries.some(q => q.text === 'COMMIT'), false);
  await store.ready();
  const statements = clients[1].queries.map(q => q.text);
  assert.deepEqual(statements.slice(0,3), ['BEGIN', "SET LOCAL statement_timeout = '10s'", "SET LOCAL lock_timeout = '8s'"]);
  assert.equal(statements[3], 'SELECT pg_advisory_xact_lock(918278433)');
  assert.match(statements[4], /^CREATE TABLE IF NOT EXISTS/);
  assert.equal(statements.at(-1), 'COMMIT');
  assert.equal(clients[1].releaseError, undefined);
  assert.deepEqual(health, ['SELECT 1']);
});

test('timeouts precede the trade lock and writes, while business rejection rolls back for reuse', async t => {
  const {store, clients} = fixture(t);
  await store.ready();
  const rejected = new Error('synthetic insufficient inventory');
  await assert.rejects(store.transaction(async tx => {
    await tx.set('inventory', 'seller', {wood: 1});
    throw rejected;
  }), error => error === rejected);
  const client = clients[1], statements = client.queries.map(q => q.text);
  assert.deepEqual(statements.slice(0,4), ['BEGIN', "SET LOCAL statement_timeout = '10s'", "SET LOCAL lock_timeout = '8s'", 'SELECT pg_advisory_xact_lock(918278433)']);
  assert.match(statements[4], /^INSERT INTO citys_documents/);
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.equal(statements.includes('COMMIT'), false);
  assert.equal(client.releaseError, undefined);
  assert.equal(await store.transaction(async tx => { await tx.get('inventory', 'seller'); return 'next request'; }), 'next request');
  assert.equal(clients[2].queries.at(-1).text, 'COMMIT');
});

test('a client read timeout discards its connection without queueing rollback or commit behind the pending query', async t => {
  const timeout = new Error('Query read timeout');
  const {store, clients} = fixture(t, sql => sql.startsWith('INSERT INTO') ? timeout : null);
  await assert.rejects(store.transaction(tx => tx.set('inventory', 'buyer', {wood: 2})), error => error === timeout);
  const client = clients[1];
  assert.equal(client.releaseError, timeout);
  assert.match(client.queries.at(-1).text, /^INSERT INTO/);
  assert.equal(client.queries.some(q => q.text === 'COMMIT' || q.text === 'ROLLBACK'), false);
});

test('rollback failure discards the connection and preserves the original business error', async t => {
  const rollbackFailure = Object.assign(new Error('synthetic closed socket'), {code: 'ECONNRESET'});
  const original = new Error('synthetic business refusal');
  const {store, clients} = fixture(t, sql => sql === 'ROLLBACK' ? rollbackFailure : null);
  await assert.rejects(store.transaction(async () => { throw original; }), error => error === original);
  assert.equal(clients[1].releaseError, rollbackFailure);
});

test('uncertain COMMIT is never retried and the connection is discarded', async t => {
  const timeout = new Error('Query read timeout');
  const {store, clients} = fixture(t, (sql, index) => index === 1 && sql === 'COMMIT' ? timeout : null);
  let calls = 0;
  await assert.rejects(store.transaction(async tx => { calls++; await tx.set('requests', 'idempotent-key', {done:true}); }), error => error === timeout);
  assert.equal(calls, 1);
  assert.equal(clients[1].queries.at(-1).text, 'COMMIT');
  assert.equal(clients[1].releaseError, timeout);
});

test('idle and checked-out socket errors are handled without leaking driver details', async t => {
  const {store, clients} = fixture(t);
  const log = t.mock.method(console, 'error', () => {});
  const disconnected = Object.assign(new Error('private-host private-password'), {code:'ECONNRESET'});
  store.pool.emit('error', disconnected);
  await assert.rejects(store.transaction(async () => {
    clients[1].emit('error', disconnected);
  }), error => error === disconnected);
  assert.equal(clients[1].releaseError, disconnected);
  for (const entry of log.mock.calls) {
    const value = entry.arguments[0];
    assert.equal(JSON.parse(value).category, 'DB_CONNECTION_FAILED');
    assert.doesNotMatch(value, /private-host|private-password/);
  }
  assert.equal(log.mock.calls.length, 2);
});

test('real PostgreSQL scopes timeouts to the transaction and rolls back rejected writes', {skip: !process.env.TEST_DATABASE_URL}, async t => {
  const store = new PostgresStore(process.env.TEST_DATABASE_URL);
  const peer = new PostgresStore(process.env.TEST_DATABASE_URL);
  t.after(async () => { await store.close(); await peer.close(); });
  await Promise.all([store.ready(), peer.ready()]);
  const outsideBefore = (await store.pool.query("SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock")).rows[0];
  const inside = await store.withTransaction(async client => (await client.query("SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock")).rows[0]);
  assert.deepEqual(inside, {statement:'10s', lock:'8s'});
  const outsideAfter = (await store.pool.query("SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock")).rows[0];
  assert.deepEqual(outsideAfter, outsideBefore);
  const id = `rollback-${require('node:crypto').randomUUID()}`;
  await assert.rejects(store.transaction(async tx => {
    await tx.set('store-regression', id, {wood: 42});
    throw new Error('expected rejection');
  }), /expected rejection/);
  assert.equal(await store.transaction(tx => tx.get('store-regression', id)), null);
});

test('strict PgBouncer reproduces the former startup failure and accepts the corrected store', {skip: !process.env.TEST_PGBOUNCER_URL}, async t => {
  // Only set this to an isolated test pooler, never a player's database.
  const previous = new Client({connectionString:process.env.TEST_PGBOUNCER_URL,
    connectionTimeoutMillis:5000, options:'-c statement_timeout=10000 -c lock_timeout=8000'});
  try { await assert.rejects(previous.connect(), /unsupported startup parameter/i); }
  finally { await previous.end(); }
  const store = new PostgresStore(process.env.TEST_PGBOUNCER_URL);
  t.after(() => store.close());
  await store.ready();
  assert.equal(await store.transaction(async tx => (await tx.get('store-regression', 'missing')) === null), true);
});
