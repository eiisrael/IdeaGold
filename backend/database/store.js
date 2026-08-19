'use strict';
const fs=require('fs');
const path=require('path');
const {DatabaseSync}=require('node:sqlite');

class Store{
  constructor(file){fs.mkdirSync(path.dirname(file),{recursive:true});this.db=new DatabaseSync(file);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');this.migrate();}
  migrate(){this.db.exec(`
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,started_at TEXT NOT NULL,stopped_at TEXT,duration_sec REAL,profile_id TEXT,pool TEXT,start_total_xmr REAL DEFAULT 0,end_total_xmr REAL DEFAULT 0,earned_xmr REAL DEFAULT 0,energy_kwh REAL DEFAULT 0,cost_brl REAL DEFAULT 0,avg_hashrate REAL DEFAULT 0,accepted INTEGER DEFAULT 0,rejected INTEGER DEFAULT 0,avg_xmr_price_brl REAL);
    CREATE TABLE IF NOT EXISTS telemetry(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER NOT NULL,session_id TEXT,hash10 REAL,hash60 REAL,hash15 REAL,pool_hash REAL,accepted INTEGER,rejected INTEGER,stale INTEGER,cpu_load REAL,temp_c REAL,watts REAL,power_source TEXT,efficiency REAL,xmr_due REAL,xmr_paid REAL,xmr_price_brl REAL,difficulty REAL,algo TEXT);
    CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry(ts);
    CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,config TEXT NOT NULL,score REAL DEFAULT 0,confidence REAL DEFAULT 0,stable INTEGER DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS benchmarks(id TEXT PRIMARY KEY,started_at TEXT NOT NULL,finished_at TEXT,objective TEXT,baseline_profile TEXT,candidate_profile TEXT,result TEXT,status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS decisions(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER NOT NULL,type TEXT NOT NULL,objective TEXT,reason TEXT NOT NULL,before_json TEXT,after_json TEXT,impact_json TEXT,decision TEXT,confidence REAL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER NOT NULL,severity TEXT NOT NULL,code TEXT NOT NULL,message TEXT NOT NULL,details TEXT,ack INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS market_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER NOT NULL,xmr_brl REAL,xmr_usd REAL,source TEXT,cached INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS pool_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER NOT NULL,pool TEXT,due_xmr REAL,paid_xmr REAL,hashrate REAL,accepted INTEGER,rejected INTEGER,last_share INTEGER,raw TEXT);
    CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT,ts INTEGER NOT NULL,kind TEXT NOT NULL,level TEXT NOT NULL,message TEXT NOT NULL,details TEXT);
    CREATE TABLE IF NOT EXISTS workers(id TEXT PRIMARY KEY,name TEXT,hashrate REAL DEFAULT 0,power_watts REAL DEFAULT 0,cloud_cost_brl_day REAL DEFAULT 0,accepted INTEGER DEFAULT 0,rejected INTEGER DEFAULT 0,algo TEXT,source TEXT,last_seen INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_workers_last_seen ON workers(last_seen);
  `);}
  set(key,value){this.db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key,JSON.stringify(value),new Date().toISOString());}
  get(key,fallback=null){const r=this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);if(!r)return fallback;try{return JSON.parse(r.value);}catch{return fallback;}}
  startSession(row){this.db.prepare('INSERT INTO sessions(id,started_at,profile_id,pool,start_total_xmr) VALUES(?,?,?,?,?)').run(row.id,row.startedAt,row.profileId||null,row.pool||null,row.startTotalXmr||0);}
  stopSession(id,row){this.db.prepare('UPDATE sessions SET stopped_at=?,duration_sec=?,end_total_xmr=?,earned_xmr=?,energy_kwh=?,cost_brl=?,avg_hashrate=?,accepted=?,rejected=?,avg_xmr_price_brl=? WHERE id=?').run(row.stoppedAt,row.durationSec,row.endTotalXmr||0,row.earnedXmr||0,row.energyKwh||0,row.costBrl||0,row.avgHashrate||0,row.accepted||0,row.rejected||0,row.avgXmrPriceBrl||null,id);}
  addTelemetry(t){this.db.prepare(`INSERT INTO telemetry(ts,session_id,hash10,hash60,hash15,pool_hash,accepted,rejected,stale,cpu_load,temp_c,watts,power_source,efficiency,xmr_due,xmr_paid,xmr_price_brl,difficulty,algo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(t.ts,t.sessionId||null,t.hash10||0,t.hash60||0,t.hash15||0,t.poolHash||0,t.accepted||0,t.rejected||0,t.stale||0,t.cpuLoad??null,t.tempC??null,t.watts??null,t.powerSource||null,t.efficiency??null,t.xmrDue||0,t.xmrPaid||0,t.xmrPriceBrl??null,t.difficulty??null,t.algo||null);}
  telemetrySince(ts,limit=5000){return this.db.prepare('SELECT * FROM telemetry WHERE ts>=? ORDER BY ts ASC LIMIT ?').all(ts,limit);}
  recentTelemetry(limit=180){return this.db.prepare('SELECT * FROM telemetry ORDER BY ts DESC LIMIT ?').all(limit).reverse();}
  telemetryForSession(id,limit=20000){return this.db.prepare('SELECT * FROM telemetry WHERE session_id=? ORDER BY ts ASC LIMIT ?').all(id,limit);}
  listSessions(limit=100){return this.db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?').all(limit);}
  saveProfile(p){const now=new Date().toISOString();this.db.prepare('INSERT INTO profiles(id,name,kind,config,score,confidence,stable,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,config=excluded.config,score=excluded.score,confidence=excluded.confidence,stable=excluded.stable,updated_at=excluded.updated_at').run(p.id,p.name,p.kind||'custom',JSON.stringify(p.config||{}),p.score||0,p.confidence||0,p.stable?1:0,p.createdAt||now,now);return this.getProfile(p.id);}
  getProfile(id){const r=this.db.prepare('SELECT * FROM profiles WHERE id=?').get(id);return r?this.profile(r):null;}
  listProfiles(){return this.db.prepare('SELECT * FROM profiles ORDER BY stable DESC, score DESC, updated_at DESC').all().map(r=>this.profile(r));}
  profile(r){return {...r,config:JSON.parse(r.config||'{}'),stable:Boolean(r.stable)};}
  deleteProfile(id){return this.db.prepare('DELETE FROM profiles WHERE id=? AND kind=?').run(id,'custom').changes>0;}
  addBenchmark(b){this.db.prepare('INSERT INTO benchmarks(id,started_at,objective,baseline_profile,candidate_profile,result,status) VALUES(?,?,?,?,?,?,?)').run(b.id,b.startedAt,b.objective,b.baselineProfile||null,b.candidateProfile||null,b.result?JSON.stringify(b.result):null,b.status||'running');}
  finishBenchmark(id,status,result){this.db.prepare('UPDATE benchmarks SET finished_at=?,status=?,result=? WHERE id=?').run(new Date().toISOString(),status,JSON.stringify(result||{}),id);}
  listBenchmarks(limit=100){return this.db.prepare('SELECT * FROM benchmarks ORDER BY started_at DESC LIMIT ?').all(limit).map(r=>({...r,result:r.result?JSON.parse(r.result):null}));}
  decision(d){this.db.prepare('INSERT INTO decisions(ts,type,objective,reason,before_json,after_json,impact_json,decision,confidence) VALUES(?,?,?,?,?,?,?,?,?)').run(d.ts||Date.now(),d.type,d.objective||null,d.reason,JSON.stringify(d.before||null),JSON.stringify(d.after||null),JSON.stringify(d.impact||null),d.decision||null,d.confidence||0);}
  decisions(limit=100){return this.db.prepare('SELECT * FROM decisions ORDER BY ts DESC LIMIT ?').all(limit).map(r=>({...r,before:r.before_json?JSON.parse(r.before_json):null,after:r.after_json?JSON.parse(r.after_json):null,impact:r.impact_json?JSON.parse(r.impact_json):null}));}
  alert(a){this.db.prepare('INSERT INTO alerts(ts,severity,code,message,details) VALUES(?,?,?,?,?)').run(a.ts||Date.now(),a.severity||'warning',a.code,a.message,JSON.stringify(a.details||null));}
  alerts(limit=100){return this.db.prepare('SELECT * FROM alerts ORDER BY ts DESC LIMIT ?').all(limit).map(r=>({...r,details:r.details?JSON.parse(r.details):null}));}
  log(kind,level,message,details=null){this.db.prepare('INSERT INTO logs(ts,kind,level,message,details) VALUES(?,?,?,?,?)').run(Date.now(),kind,level,message,details?JSON.stringify(details):null);}
  logs(kind='all',limit=300){const rows=kind==='all'?this.db.prepare('SELECT * FROM logs ORDER BY ts DESC LIMIT ?').all(limit):this.db.prepare('SELECT * FROM logs WHERE kind=? ORDER BY ts DESC LIMIT ?').all(kind,limit);return rows;}
  upsertWorker(w){this.db.prepare('INSERT INTO workers(id,name,hashrate,power_watts,cloud_cost_brl_day,accepted,rejected,algo,source,last_seen) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,hashrate=excluded.hashrate,power_watts=excluded.power_watts,cloud_cost_brl_day=excluded.cloud_cost_brl_day,accepted=excluded.accepted,rejected=excluded.rejected,algo=excluded.algo,source=excluded.source,last_seen=excluded.last_seen').run(w.id,w.name,w.hashrate||0,w.powerWatts||0,w.cloudCostBrlDay||0,w.accepted||0,w.rejected||0,w.algo||null,w.source||null,w.lastSeen||Date.now());}
  listWorkers(limit=200){return this.db.prepare('SELECT * FROM workers ORDER BY last_seen DESC LIMIT ?').all(limit);}
  market(m){this.db.prepare('INSERT INTO market_snapshots(ts,xmr_brl,xmr_usd,source,cached) VALUES(?,?,?,?,?)').run(Date.now(),m.brl||null,m.usd||null,m.source||null,m.cached?1:0);}
  pool(p){this.db.prepare('INSERT INTO pool_snapshots(ts,pool,due_xmr,paid_xmr,hashrate,accepted,rejected,last_share,raw) VALUES(?,?,?,?,?,?,?,?,?)').run(Date.now(),p.pool||null,p.dueXmr||0,p.paidXmr||0,p.hashrate||0,p.accepted||0,p.rejected||0,p.lastShareTs||null,JSON.stringify(p.raw||null));}
  close(){this.db.close();}
}
module.exports={Store};
