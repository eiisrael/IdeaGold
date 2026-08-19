'use strict';

const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { TelemetryEngine } = require('../telemetry/engine');
const { IdeaGoldDB } = require('../database/db');
const { candidateHosts, resolvePoolEndpoint } = require('../miner/pool-preflight');

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`OK ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

(async () => {
  await test('pool stale shares continuam numéricos quando fonte entra em cache', async () => {
    const engine = new TelemetryEngine({
      db: {}, controller: {}, hardware: {}, power: {}, market: {},
      poolRegistry: {}, getSettings: () => ({}), anomaly: {}, logger: null
    });

    const live = await engine.refreshOne('pool', 0, 600000, async () => ({
      available: true,
      adapter: 'moneroocean',
      dueXmr: 0,
      accepted: 10,
      rejected: 0,
      stale: 3
    }));
    assert.strictEqual(live.stale, 3);
    assert.strictEqual(live.sourceStale, false);

    const cached = await engine.refreshOne('pool', 0, 600000, async () => ({
      available: false,
      reason: 'falha temporária de teste'
    }));
    assert.strictEqual(cached.stale, 3);
    assert.strictEqual(cached.sourceStale, true);
    assert.strictEqual(cached.cached, true);
  });

  await test('pool snapshot aceita resultado cacheado sem boolean em coluna stale', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideagold-v511-'));
    const db = new IdeaGoldDB(dir);
    try {
      db.poolSnapshot({
        ts: Date.now(), adapter: 'moneroocean', dueXmr: 0, paidXmr: 0,
        hashrate: 1000, accepted: 1, rejected: 0, stale: 0,
        sourceStale: true, raw: { ok: true }
      });
      const row = db.db.prepare('SELECT stale FROM pool_snapshots LIMIT 1').get();
      assert.strictEqual(row.stale, 0);
    } finally {
      db.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('MoneroOcean tenta gulf e fallback sg sem usar IP fixo', async () => {
    assert.deepStrictEqual(candidateHosts({ host: 'gulf.moneroocean.stream' }), [
      'gulf.moneroocean.stream',
      'sg.moneroocean.stream'
    ]);
    const tried = [];
    const result = await resolvePoolEndpoint(
      { host: 'gulf.moneroocean.stream', port: 20128, tls: true },
      {
        probe: async host => {
          tried.push(host);
          return host === 'sg.moneroocean.stream'
            ? { ok: true, stage: 'tls', host }
            : { ok: false, stage: 'dns', host, error: 'ENOTFOUND' };
        }
      }
    );
    assert.deepStrictEqual(tried, ['gulf.moneroocean.stream', 'sg.moneroocean.stream']);
    assert.strictEqual(result.host, 'sg.moneroocean.stream');
  });

  await test('start recebe erro explícito quando nenhum endpoint do pool funciona', async () => {
    await assert.rejects(
      () => resolvePoolEndpoint(
        { host: 'gulf.moneroocean.stream', port: 20128, tls: true },
        { probe: async host => ({ ok: false, stage: 'dns', host, error: 'ENOTFOUND' }) }
      ),
      error => error.code === 'POOL_PREFLIGHT_FAILED' && /DNS\/internet\/firewall/.test(error.message)
    );
  });

  console.log(`\nIdeaGold V5.1.1 regression tests: ${passed} OK`);
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
