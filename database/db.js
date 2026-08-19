'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

class IdeaGoldDB {
  constructor(root) {
    this.dir = path.join(root, 'data');
    fs.mkdirSync(this.dir, { recursive: true });
    this.file = path.join(this.dir, 'ideagold.sqlite');
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings(
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions(
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        stopped_at INTEGER,
        pool TEXT,
        wallet_masked TEXT,
        profile TEXT,
        objective TEXT,
        baseline_pool_xmr REAL DEFAULT 0,
        final_pool_xmr REAL,
        xmr_observed REAL,
        avg_hashrate REAL,
        avg_power_w REAL,
        avg_price_brl REAL,
        energy_kwh REAL,
        energy_cost_brl REAL,
        revenue_brl REAL,
        profit_brl REAL,
        accepted INTEGER DEFAULT 0,
        rejected INTEGER DEFAULT 0,
        stop_reason TEXT
      );
      CREATE TABLE IF NOT EXISTS telemetry(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        session_id TEXT,
        local_hashrate REAL,
        hash_10s REAL,
        hash_60s REAL,
        hash_15m REAL,
        pool_hashrate REAL,
        accepted INTEGER,
        rejected INTEGER,
        stale INTEGER,
        share_diff REAL,
        cpu_load REAL,
        memory_used_pct REAL,
        temperature_c REAL,
        temperature_source TEXT,
        power_w REAL,
        power_source TEXT,
        efficiency_hw REAL,
        xmr_due REAL,
        xmr_paid REAL,
        xmr_brl REAL,
        network_difficulty REAL,
        network_hashrate REAL,
        block_reward REAL,
        pool_latency_ms REAL,
        profile TEXT
      );
      CREATE INDEX IF NOT EXISTS telemetry_ts ON telemetry(ts);
      CREATE INDEX IF NOT EXISTS telemetry_session ON telemetry(session_id, ts);
      CREATE TABLE IF NOT EXISTS benchmarks(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        hardware_fingerprint TEXT NOT NULL,
        objective TEXT NOT NULL,
        profile_name TEXT,
        config_json TEXT NOT NULL,
        duration_sec REAL,
        samples INTEGER,
        hashrate REAL,
        power_w REAL,
        temperature_c REAL,
        efficiency_hw REAL,
        reject_rate REAL,
        stability REAL,
        profit_brl_day REAL,
        score REAL,
        confidence REAL,
        status TEXT NOT NULL,
        notes TEXT
      );
      CREATE TABLE IF NOT EXISTS profiles(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        objective TEXT NOT NULL,
        config_json TEXT NOT NULL,
        score REAL,
        confidence REAL,
        safe INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS decisions(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        engine TEXT NOT NULL,
        objective TEXT,
        action TEXT NOT NULL,
        reason TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        expected_json TEXT,
        observed_json TEXT,
        confidence REAL,
        result TEXT
      );
      CREATE TABLE IF NOT EXISTS alerts(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        severity TEXT NOT NULL,
        code TEXT NOT NULL,
        message TEXT NOT NULL,
        source TEXT,
        resolved_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS market_snapshots(
        ts INTEGER PRIMARY KEY,
        xmr_brl REAL,
        xmr_usd REAL,
        source TEXT,
        cached INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS pool_snapshots(
        ts INTEGER PRIMARY KEY,
        adapter TEXT,
        due_xmr REAL,
        paid_xmr REAL,
        pool_hashrate REAL,
        accepted INTEGER,
        rejected INTEGER,
        stale INTEGER,
        raw_json TEXT
      );
    `);
  }

  getSetting(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }
  setSetting(key, value) {
    this.db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
      .run(key, JSON.stringify(value), Date.now());
    return value;
  }

  startSession(row) {
    this.db.prepare(`INSERT INTO sessions(id,started_at,pool,wallet_masked,profile,objective,baseline_pool_xmr)
      VALUES(@id,@started_at,@pool,@wallet_masked,@profile,@objective,@baseline_pool_xmr)`).run(row);
  }
  finishSession(id, row) {
    this.db.prepare(`UPDATE sessions SET stopped_at=@stopped_at, final_pool_xmr=@final_pool_xmr,
      xmr_observed=@xmr_observed, avg_hashrate=@avg_hashrate, avg_power_w=@avg_power_w,
      avg_price_brl=@avg_price_brl, energy_kwh=@energy_kwh, energy_cost_brl=@energy_cost_brl,
      revenue_brl=@revenue_brl, profit_brl=@profit_brl, accepted=@accepted, rejected=@rejected,
      stop_reason=@stop_reason WHERE id=@id`).run({ id, ...row });
  }
  listSessions(limit = 100) {
    return this.db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?').all(Math.max(1, Math.min(1000, limit)));
  }

  addTelemetry(row) {
    const keys = Object.keys(row);
    const sql = `INSERT INTO telemetry(${keys.join(',')}) VALUES(${keys.map(k => '@' + k).join(',')})`;
    this.db.prepare(sql).run(row);
  }
  telemetrySince(since, limit = 5000) {
    return this.db.prepare('SELECT * FROM telemetry WHERE ts>=? ORDER BY ts ASC LIMIT ?')
      .all(Number(since || 0), Math.max(1, Math.min(20000, limit)));
  }
  sessionTelemetry(sessionId) {
    return this.db.prepare('SELECT * FROM telemetry WHERE session_id=? ORDER BY ts ASC').all(sessionId);
  }

  addBenchmark(row) {
    const data = { ...row, ts: row.ts || Date.now(), config_json: JSON.stringify(row.config || {}) };
    delete data.config;
    const keys = Object.keys(data);
    this.db.prepare(`INSERT INTO benchmarks(${keys.join(',')}) VALUES(${keys.map(k => '@' + k).join(',')})`).run(data);
  }
  listBenchmarks(limit = 500) {
    return this.db.prepare('SELECT * FROM benchmarks ORDER BY ts DESC LIMIT ?').all(Math.max(1, Math.min(5000, limit)));
  }

  saveProfile(profile) {
    const now = Date.now();
    this.db.prepare(`INSERT INTO profiles(id,name,kind,objective,config_json,score,confidence,safe,created_at,updated_at)
      VALUES(@id,@name,@kind,@objective,@config_json,@score,@confidence,@safe,@created_at,@updated_at)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,objective=excluded.objective,
      config_json=excluded.config_json,score=excluded.score,confidence=excluded.confidence,safe=excluded.safe,updated_at=excluded.updated_at`)
      .run({ id: profile.id, name: profile.name, kind: profile.kind || 'custom', objective: profile.objective || 'balanced',
        config_json: JSON.stringify(profile.config || {}), score: profile.score ?? null, confidence: profile.confidence ?? null,
        safe: profile.safe ? 1 : 0, created_at: profile.createdAt || now, updated_at: now });
  }
  getProfile(id) { return this.db.prepare('SELECT * FROM profiles WHERE id=?').get(id) || null; }
  listProfiles() { return this.db.prepare('SELECT * FROM profiles ORDER BY safe DESC, score DESC, updated_at DESC').all(); }
  deleteProfile(id) { return this.db.prepare('DELETE FROM profiles WHERE id=? AND safe=0').run(id); }

  addDecision(row) {
    this.db.prepare(`INSERT INTO decisions(ts,engine,objective,action,reason,before_json,after_json,expected_json,observed_json,confidence,result)
      VALUES(@ts,@engine,@objective,@action,@reason,@before_json,@after_json,@expected_json,@observed_json,@confidence,@result)`)
      .run({ ts: row.ts || Date.now(), engine: row.engine || 'Supreme Mind', objective: row.objective || null,
        action: row.action, reason: row.reason, before_json: JSON.stringify(row.before || null), after_json: JSON.stringify(row.after || null),
        expected_json: JSON.stringify(row.expected || null), observed_json: JSON.stringify(row.observed || null),
        confidence: row.confidence ?? null, result: row.result || null });
  }
  listDecisions(limit = 200) { return this.db.prepare('SELECT * FROM decisions ORDER BY ts DESC LIMIT ?').all(Math.max(1, Math.min(2000, limit))); }

  addAlert(severity, code, message, source = null) {
    this.db.prepare('INSERT INTO alerts(ts,severity,code,message,source) VALUES(?,?,?,?,?)')
      .run(Date.now(), severity, code, message, source);
  }
  activeAlerts() { return this.db.prepare('SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY ts DESC LIMIT 100').all(); }
  resolveAlert(id) { this.db.prepare('UPDATE alerts SET resolved_at=? WHERE id=?').run(Date.now(), id); }

  marketSnapshot(row) {
    this.db.prepare('INSERT OR REPLACE INTO market_snapshots(ts,xmr_brl,xmr_usd,source,cached) VALUES(?,?,?,?,?)')
      .run(row.ts || Date.now(), row.brl || null, row.usd || null, row.source || null, row.cached ? 1 : 0);
  }
  poolSnapshot(row) {
    this.db.prepare(`INSERT OR REPLACE INTO pool_snapshots(ts,adapter,due_xmr,paid_xmr,pool_hashrate,accepted,rejected,stale,raw_json)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(row.ts || Date.now(), row.adapter || null, row.dueXmr ?? null, row.paidXmr ?? null,
      row.hashrate ?? null, row.accepted ?? null, row.rejected ?? null, row.stale ?? null, JSON.stringify(row.raw || null));
  }

  cleanup() {
    const cutoff = Date.now() - 90 * 86400_000;
    this.db.prepare('DELETE FROM telemetry WHERE ts<?').run(cutoff);
    this.db.prepare('DELETE FROM pool_snapshots WHERE ts<?').run(cutoff);
    this.db.prepare('DELETE FROM market_snapshots WHERE ts<?').run(cutoff);
  }
}

module.exports = { IdeaGoldDB };
