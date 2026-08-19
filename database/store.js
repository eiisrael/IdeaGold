'use strict';

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR } = require('../backend/config');

class Store {
  constructor(file = path.join(DATA_DIR, 'ideagold.sqlite')) {
    this.file = file;
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS telemetry (
        id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, session_id TEXT,
        local_hash REAL, hash_10s REAL, hash_60s REAL, hash_15m REAL, pool_hash REAL,
        accepted INTEGER, rejected INTEGER, stale INTEGER,
        cpu_load REAL, memory_load REAL, cpu_temp REAL, gpu_temp REAL,
        power_watts REAL, power_source TEXT, xmr_price_brl REAL, xmr_due REAL,
        xmr_session REAL, xmr_per_hour REAL, profit_day_brl REAL,
        miner_state TEXT, pool_state TEXT, algo TEXT, profile_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry(ts);
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, stopped_at INTEGER,
        pool TEXT, wallet_masked TEXT, profile_id TEXT, mode TEXT,
        starting_pool_total REAL DEFAULT 0, ending_pool_total REAL,
        starting_accepted INTEGER DEFAULT 0, starting_rejected INTEGER DEFAULT 0,
        accepted INTEGER DEFAULT 0, rejected INTEGER DEFAULT 0,
        avg_hash REAL, avg_power REAL, energy_kwh REAL, energy_cost_brl REAL,
        xmr_observed REAL, avg_xmr_price_brl REAL, estimated_profit_brl REAL,
        stop_reason TEXT
      );
      CREATE TABLE IF NOT EXISTS benchmarks (
        id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, fingerprint TEXT NOT NULL,
        objective TEXT NOT NULL, config_json TEXT NOT NULL,
        warmup_sec INTEGER, sample_sec INTEGER, samples INTEGER,
        hash_median REAL, hash_cv REAL, power_median REAL, efficiency REAL,
        temp_max REAL, accepted INTEGER, rejected INTEGER, score REAL,
        confidence REAL, valid INTEGER NOT NULL, reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_bench_fingerprint ON benchmarks(fingerprint, created_at);
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, fingerprint TEXT NOT NULL,
        config_json TEXT NOT NULL, metrics_json TEXT, safe INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, source TEXT NOT NULL,
        objective TEXT, action TEXT NOT NULL, reason TEXT NOT NULL,
        before_json TEXT, after_json TEXT, impact_expected_json TEXT,
        impact_observed_json TEXT, confidence REAL
      );
      CREATE INDEX IF NOT EXISTS idx_decisions_ts ON decisions(ts);
      CREATE TABLE IF NOT EXISTS pool_snapshots (
        id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, adapter TEXT,
        due_xmr REAL, paid_xmr REAL, hash REAL, accepted INTEGER,
        rejected INTEGER, workers INTEGER, last_share_ts INTEGER, raw_json TEXT
      );
      CREATE TABLE IF NOT EXISTS market_snapshots (
        id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, xmr_brl REAL,
        xmr_usd REAL, source TEXT, cached INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY, name TEXT, last_seen INTEGER NOT NULL, payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, type TEXT NOT NULL,
        level TEXT NOT NULL, message TEXT NOT NULL, meta_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);
    `);
    for (const sql of [
      'ALTER TABLE sessions ADD COLUMN starting_accepted INTEGER DEFAULT 0',
      'ALTER TABLE sessions ADD COLUMN starting_rejected INTEGER DEFAULT 0'
    ]) { try { this.db.exec(sql); } catch {} }
  }

  close() { this.db.close(); }
  log(type, level, message, meta = null) {
    this.db.prepare('INSERT INTO logs(ts,type,level,message,meta_json) VALUES(?,?,?,?,?)')
      .run(Date.now(), type, level, String(message).slice(0, 4000), meta ? JSON.stringify(meta) : null);
    this.db.prepare('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 10000)').run();
  }
  startSession(row) {
    this.db.prepare(`INSERT OR REPLACE INTO sessions(id,started_at,pool,wallet_masked,profile_id,mode,starting_pool_total,starting_accepted,starting_rejected)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(row.id, row.startedAt, row.pool || '', row.walletMasked || '', row.profileId || null, row.mode || null, row.startingPoolTotal || 0, row.startingAccepted || 0, row.startingRejected || 0);
  }
  endSession(id, row = {}) {
    this.db.prepare(`UPDATE sessions SET stopped_at=?, ending_pool_total=?, accepted=?, rejected=?, avg_hash=?, avg_power=?, energy_kwh=?, energy_cost_brl=?, xmr_observed=?, avg_xmr_price_brl=?, estimated_profit_brl=?, stop_reason=? WHERE id=?`)
      .run(row.stoppedAt || Date.now(), row.endingPoolTotal ?? null, row.accepted || 0, row.rejected || 0, row.avgHash ?? null, row.avgPower ?? null, row.energyKwh ?? null, row.energyCostBrl ?? null, row.xmrObserved ?? null, row.avgXmrPriceBrl ?? null, row.estimatedProfitBrl ?? null, row.stopReason || 'user', id);
  }
  addTelemetry(t) {
    this.db.prepare(`INSERT INTO telemetry(ts,session_id,local_hash,hash_10s,hash_60s,hash_15m,pool_hash,accepted,rejected,stale,cpu_load,memory_load,cpu_temp,gpu_temp,power_watts,power_source,xmr_price_brl,xmr_due,xmr_session,xmr_per_hour,profit_day_brl,miner_state,pool_state,algo,profile_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      t.ts || Date.now(), t.sessionId || null, t.localHash || 0, t.hash10s || 0, t.hash60s || 0, t.hash15m || 0, t.poolHash || 0,
      t.accepted || 0, t.rejected || 0, t.stale || 0, t.cpuLoad ?? null, t.memoryLoad ?? null, t.cpuTemp ?? null, t.gpuTemp ?? null,
      t.powerWatts ?? null, t.powerSource || null, t.xmrPriceBrl ?? null, t.xmrDue ?? null, t.xmrSession ?? null, t.xmrPerHour ?? null,
      t.profitDayBrl ?? null, t.minerState || null, t.poolState || null, t.algo || null, t.profileId || null
    );
    this.prune();
  }
  prune() {
    const minTs = Date.now() - 45 * 24 * 3600_000;
    this.db.prepare('DELETE FROM telemetry WHERE ts < ?').run(minTs);
    this.db.prepare('DELETE FROM pool_snapshots WHERE ts < ?').run(minTs);
    this.db.prepare('DELETE FROM market_snapshots WHERE ts < ?').run(minTs);
  }
  history(rangeMs = 3600_000, limit = 2000) {
    const since = Date.now() - Math.max(60_000, rangeMs);
    return this.db.prepare('SELECT * FROM telemetry WHERE ts >= ? ORDER BY ts ASC LIMIT ?').all(since, Math.min(10000, limit));
  }
  session(id) { return this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id) || null; }
  sessions(limit = 50) { return this.db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?').all(Math.min(500, limit)); }
  sessionTelemetry(id, limit = 10000) { return this.db.prepare('SELECT * FROM telemetry WHERE session_id=? ORDER BY ts ASC LIMIT ?').all(id, Math.min(20000, limit)); }
  poolSnapshots(rangeMs = 6*3600_000, limit = 2000) { return this.db.prepare('SELECT * FROM pool_snapshots WHERE ts>=? ORDER BY ts ASC LIMIT ?').all(Date.now()-rangeMs, Math.min(10000, limit)); }
  addPoolSnapshot(p) {
    this.db.prepare('INSERT INTO pool_snapshots(ts,adapter,due_xmr,paid_xmr,hash,accepted,rejected,workers,last_share_ts,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(Date.now(), p.adapter || '', p.dueXmr || 0, p.paidXmr || 0, p.hashrate || 0, p.accepted || 0, p.rejected || 0, p.workers || 0, p.lastShareTs || 0, p.raw ? JSON.stringify(p.raw) : null);
  }
  addMarketSnapshot(m) {
    this.db.prepare('INSERT INTO market_snapshots(ts,xmr_brl,xmr_usd,source,cached) VALUES(?,?,?,?,?)')
      .run(Date.now(), m.brl || 0, m.usd || 0, m.source || '', m.cached ? 1 : 0);
  }
  saveBenchmark(b) {
    this.db.prepare(`INSERT OR REPLACE INTO benchmarks(id,created_at,fingerprint,objective,config_json,warmup_sec,sample_sec,samples,hash_median,hash_cv,power_median,efficiency,temp_max,accepted,rejected,score,confidence,valid,reason)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      b.id, b.createdAt || Date.now(), b.fingerprint, b.objective, JSON.stringify(b.config || {}), b.warmupSec || 0, b.sampleSec || 0,
      b.samples || 0, b.hashMedian || 0, b.hashCv || 0, b.powerMedian ?? null, b.efficiency ?? null, b.tempMax ?? null,
      b.accepted || 0, b.rejected || 0, b.score ?? null, b.confidence || 0, b.valid ? 1 : 0, b.reason || ''
    );
  }
  benchmarks(fingerprint, limit = 100) {
    const rows = fingerprint
      ? this.db.prepare('SELECT * FROM benchmarks WHERE fingerprint=? ORDER BY created_at DESC LIMIT ?').all(fingerprint, Math.min(500, limit))
      : this.db.prepare('SELECT * FROM benchmarks ORDER BY created_at DESC LIMIT ?').all(Math.min(500, limit));
    return rows.map(r => ({ ...r, config: JSON.parse(r.config_json), valid: Boolean(r.valid) }));
  }
  saveProfile(p) {
    const now = Date.now();
    this.db.prepare(`INSERT INTO profiles(id,name,kind,fingerprint,config_json,metrics_json,safe,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,config_json=excluded.config_json,metrics_json=excluded.metrics_json,safe=excluded.safe,updated_at=excluded.updated_at`)
      .run(p.id, p.name, p.kind, p.fingerprint, JSON.stringify(p.config || {}), JSON.stringify(p.metrics || {}), p.safe ? 1 : 0, p.createdAt || now, now);
  }
  profiles(fingerprint) {
    const rows = fingerprint ? this.db.prepare('SELECT * FROM profiles WHERE fingerprint=? ORDER BY safe DESC, updated_at DESC').all(fingerprint) : this.db.prepare('SELECT * FROM profiles ORDER BY updated_at DESC').all();
    return rows.map(r => ({ ...r, config: JSON.parse(r.config_json), metrics: JSON.parse(r.metrics_json || '{}'), safe: Boolean(r.safe) }));
  }
  profile(id) {
    const r = this.db.prepare('SELECT * FROM profiles WHERE id=?').get(id);
    return r ? { ...r, config: JSON.parse(r.config_json), metrics: JSON.parse(r.metrics_json || '{}'), safe: Boolean(r.safe) } : null;
  }
  safeProfile(fingerprint) {
    const r = this.db.prepare('SELECT * FROM profiles WHERE fingerprint=? AND safe=1 ORDER BY updated_at DESC LIMIT 1').get(fingerprint);
    return r ? { ...r, config: JSON.parse(r.config_json), metrics: JSON.parse(r.metrics_json || '{}'), safe: true } : null;
  }
  decision(d) {
    this.db.prepare('INSERT INTO decisions(ts,source,objective,action,reason,before_json,after_json,impact_expected_json,impact_observed_json,confidence) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(Date.now(), d.source || 'supreme-mind', d.objective || null, d.action, d.reason, d.before ? JSON.stringify(d.before) : null, d.after ? JSON.stringify(d.after) : null, d.expected ? JSON.stringify(d.expected) : null, d.observed ? JSON.stringify(d.observed) : null, d.confidence ?? null);
  }
  decisions(limit = 100) {
    return this.db.prepare('SELECT * FROM decisions ORDER BY ts DESC LIMIT ?').all(Math.min(1000, limit)).map(r => ({ ...r,
      before: r.before_json ? JSON.parse(r.before_json) : null, after: r.after_json ? JSON.parse(r.after_json) : null,
      expected: r.impact_expected_json ? JSON.parse(r.impact_expected_json) : null, observed: r.impact_observed_json ? JSON.parse(r.impact_observed_json) : null
    }));
  }
  upsertWorker(w) {
    this.db.prepare(`INSERT INTO workers(id,name,last_seen,payload_json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,last_seen=excluded.last_seen,payload_json=excluded.payload_json`)
      .run(w.id, w.name || w.id, Date.now(), JSON.stringify(w));
  }
  workers() {
    const now=Date.now(); return this.db.prepare('SELECT * FROM workers ORDER BY last_seen DESC').all().map(r=>({ ...JSON.parse(r.payload_json), id:r.id, name:r.name, lastSeen:r.last_seen, online:now-r.last_seen<45000 }));
  }
  workerSummary() {
    const workers=this.workers(), online=workers.filter(w=>w.online); return {workers,online:online.length,hashrate:online.reduce((s,w)=>s+Number(w.hashrate||0),0),powerWatts:online.reduce((s,w)=>s+Number(w.powerWatts||0),0),energyCostBrlDay:online.reduce((s,w)=>s+(Number(w.powerWatts||0)/1000*24*Number(w.electricity||0)),0),cloudCostBrlDay:online.reduce((s,w)=>s+Number(w.cloudCostBrlDay||0),0)};
  }
  logs(type, limit = 300) {
    const rows = type && type !== 'all' ? this.db.prepare('SELECT * FROM logs WHERE type=? ORDER BY ts DESC LIMIT ?').all(type, Math.min(2000, limit)) : this.db.prepare('SELECT * FROM logs ORDER BY ts DESC LIMIT ?').all(Math.min(2000, limit));
    return rows.map(r => ({ ...r, meta: r.meta_json ? JSON.parse(r.meta_json) : null }));
  }
}

module.exports = { Store };
