'use strict';

class WorkerStore{
  constructor(ideaGoldDb){
    this.db=ideaGoldDb.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS workers(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      coin TEXT,
      algo TEXT,
      hashrate REAL DEFAULT 0,
      hashrate_60s REAL DEFAULT 0,
      hashrate_15m REAL DEFAULT 0,
      accepted INTEGER DEFAULT 0,
      rejected INTEGER DEFAULT 0,
      uptime REAL DEFAULT 0,
      pool TEXT,
      miner_version TEXT,
      host TEXT,
      power_w REAL DEFAULT 0,
      electricity_brl_kwh REAL DEFAULT 0,
      cloud_cost_brl_day REAL DEFAULT 0,
      backends_json TEXT,
      remote_addr TEXT,
      last_seen INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workers_last_seen ON workers(last_seen);`);
  }
  upsert(worker,remoteAddr=''){
    const row={
      id:worker.id,name:worker.name,coin:worker.coin,algo:worker.algo,hashrate:worker.hashrate,hashrate_60s:worker.hashrate60s,
      hashrate_15m:worker.hashrate15m,accepted:worker.accepted,rejected:worker.rejected,uptime:worker.uptime,pool:worker.pool,
      miner_version:worker.minerVersion,host:worker.host,power_w:worker.powerWatts,electricity_brl_kwh:worker.electricityBrlKWh,
      cloud_cost_brl_day:worker.cloudCostBrlDay,backends_json:JSON.stringify(worker.backends||[]),remote_addr:String(remoteAddr||'').slice(0,80),last_seen:Date.now()
    };
    this.db.prepare(`INSERT INTO workers(id,name,coin,algo,hashrate,hashrate_60s,hashrate_15m,accepted,rejected,uptime,pool,miner_version,host,power_w,electricity_brl_kwh,cloud_cost_brl_day,backends_json,remote_addr,last_seen)
      VALUES(@id,@name,@coin,@algo,@hashrate,@hashrate_60s,@hashrate_15m,@accepted,@rejected,@uptime,@pool,@miner_version,@host,@power_w,@electricity_brl_kwh,@cloud_cost_brl_day,@backends_json,@remote_addr,@last_seen)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,coin=excluded.coin,algo=excluded.algo,hashrate=excluded.hashrate,hashrate_60s=excluded.hashrate_60s,
      hashrate_15m=excluded.hashrate_15m,accepted=excluded.accepted,rejected=excluded.rejected,uptime=excluded.uptime,pool=excluded.pool,miner_version=excluded.miner_version,
      host=excluded.host,power_w=excluded.power_w,electricity_brl_kwh=excluded.electricity_brl_kwh,cloud_cost_brl_day=excluded.cloud_cost_brl_day,
      backends_json=excluded.backends_json,remote_addr=excluded.remote_addr,last_seen=excluded.last_seen`).run(row);
    return this.get(worker.id);
  }
  parse(row,now=Date.now()){
    if(!row)return null;let backends=[];try{backends=JSON.parse(row.backends_json||'[]');}catch{}
    return {...row,backends,online:Number(now)-Number(row.last_seen)<45000};
  }
  get(id){return this.parse(this.db.prepare('SELECT * FROM workers WHERE id=?').get(String(id||'')));}
  list(limit=100){const now=Date.now();return this.db.prepare('SELECT * FROM workers ORDER BY last_seen DESC LIMIT ?').all(Math.max(1,Math.min(500,Number(limit)||100))).map(r=>this.parse(r,now));}
  summary(){
    const online=this.list(500).filter(w=>w.online);
    return {online:online.length,totalHashrate:online.reduce((a,w)=>a+Number(w.hashrate||0),0),powerWattsReported:online.reduce((a,w)=>a+Number(w.power_w||0),0),cloudCostBrlDay:online.reduce((a,w)=>a+Number(w.cloud_cost_brl_day||0),0)};
  }
  cleanup(){this.db.prepare('DELETE FROM workers WHERE last_seen<?').run(Date.now()-30*86400_000);}
}

module.exports={WorkerStore};
