'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { fail } = require('./errors.cjs');
const { reportStorageError } = require('./diagnostics.cjs');

// One JSON document per entity. Postgres uses a transaction-scoped advisory lock
// for every mutation, including multi-player trades and persistent rate limits.
// This deliberately favors transparent correctness for a small community over
// high-volume write throughput. No serverless process-local financial locks.
class PostgresStore {
  constructor(url) {
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 20000, allowExitOnIdle: true,
      query_timeout: 12000 });
    this.pool.on('error', reportStorageError);
    this.kind = 'postgres';
    this.initializing = null;
  }
  async ready() {
    if (!this.initializing) this.initializing = this.withTransaction(async client => {
      // IF NOT EXISTS alone does not serialize concurrent serverless cold starts.
      await client.query('SELECT pg_advisory_xact_lock(918278433)');
      await client.query(`CREATE TABLE IF NOT EXISTS citys_documents (
        namespace text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
        PRIMARY KEY (namespace, id))`);
    }).catch(error => { this.initializing = null; throw error; });
    await this.initializing;
    await this.pool.query('SELECT 1');
  }
  async withTransaction(fn) {
    const client = await this.pool.connect();
    let failedQuery;
    const onError = error => { failedQuery = error; reportStorageError(error); };
    client.on('error', onError);
    const query = async (...args) => {
      if (failedQuery) throw failedQuery;
      try { return await client.query(...args); }
      catch (error) { failedQuery = error; throw error; }
    };
    try {
      await query('BEGIN');
      // Neon/PgBouncer rejects unsupported startup parameters. Transaction-local
      // settings work with transaction pooling and cannot leak to the next user.
      await query("SET LOCAL statement_timeout = '10s'");
      await query("SET LOCAL lock_timeout = '8s'");
      const result = await fn({ query });
      await query('COMMIT');
      return result;
    } catch (error) {
      // pg's query_timeout stops waiting but does not cancel the server query.
      // Discard a connection after any database error; closing it also rolls back
      // an uncommitted transaction. Only business errors can safely reuse it.
      if (!failedQuery) await query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release(failedQuery);
      client.removeListener('error', onError);
    }
  }
  async transaction(fn) {
    await this.ready();
    return this.withTransaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(918278433)');
      const tx = {
        get: async (namespace, id) => (await client.query('SELECT data FROM citys_documents WHERE namespace=$1 AND id=$2', [namespace, id])).rows[0]?.data ?? null,
        set: async (namespace, id, data) => { await client.query('INSERT INTO citys_documents(namespace,id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(namespace,id) DO UPDATE SET data=EXCLUDED.data', [namespace, id, JSON.stringify(data)]); },
        delete: async (namespace, id) => { await client.query('DELETE FROM citys_documents WHERE namespace=$1 AND id=$2', [namespace, id]); },
        list: async namespace => (await client.query('SELECT data FROM citys_documents WHERE namespace=$1', [namespace])).rows.map(r => r.data)
      };
      return fn(tx);
    });
  }
  async close() { await this.pool.end(); }
}

class LocalStore {
  constructor(file) { this.file = path.resolve(file); this.kind = 'local'; this.queue = Promise.resolve(); }
  async ready() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try { await fs.access(this.file); } catch { await fs.writeFile(this.file, '{}', { flag: 'wx', mode: 0o600 }).catch(e => { if (e.code !== 'EEXIST') throw e; }); }
    JSON.parse(await fs.readFile(this.file, 'utf8'));
  }
  transaction(fn) {
    const op = this.queue.then(async () => {
      await this.ready();
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      let dirty = false;
      const key = (namespace, id) => `${namespace}:${id}`;
      const tx = {
        get: async (namespace, id) => structuredClone(data[key(namespace, id)] ?? null),
        set: async (namespace, id, value) => { data[key(namespace, id)] = structuredClone(value); dirty = true; },
        delete: async (namespace, id) => { delete data[key(namespace, id)]; dirty = true; },
        list: async namespace => Object.entries(data).filter(([k]) => k.startsWith(`${namespace}:`)).map(([, v]) => structuredClone(v))
      };
      const result = await fn(tx);
      if (dirty) {
        const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
        try {
          const handle = await fs.open(temporary, 'wx', 0o600);
          try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); } finally { await handle.close(); }
          await fs.rename(temporary, this.file);
          const directory = await fs.open(path.dirname(this.file), 'r');
          try { await directory.sync(); } finally { await directory.close(); }
        } finally { await fs.rm(temporary, { force: true }); }
      }
      return result;
    });
    this.queue = op.catch(() => {});
    return op;
  }
  async close() { await this.queue; }
}

function createStore(env = process.env) {
  if (env.DATABASE_URL) return new PostgresStore(env.DATABASE_URL);
  if (env.VERCEL || env.NODE_ENV === 'production') return {
    kind: 'unconfigured',
    ready: async () => fail(503, 'DATABASE_NOT_CONFIGURED', '在线服务尚未配置持久数据库。请在部署环境设置 DATABASE_URL（PostgreSQL）后重新部署；本地城市仍可游玩。'),
    transaction: async () => fail(503, 'DATABASE_NOT_CONFIGURED', '线上账号、云存档与交易需要持久 PostgreSQL 数据库。'),
    close: async () => {}
  };
  return new LocalStore(env.DATA_FILE || path.resolve(__dirname, '../work/local-online.json'));
}
module.exports = { createStore, LocalStore, PostgresStore };
