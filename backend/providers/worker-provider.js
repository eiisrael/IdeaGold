'use strict';
const crypto=require('crypto');

class WorkerProvider{
  constructor({store,secret='',ttlMs=45000}={}){this.store=store;this.secret=secret;this.ttlMs=ttlMs;}
  enabled(){return Boolean(this.secret&&this.secret!=='troque-por-um-segredo-forte');}
  verify(headers,raw){if(!this.enabled())return false;const ts=String(headers['x-ideagold-timestamp']||'');const sig=String(headers['x-ideagold-signature']||'');if(!/^\d{10,16}$/.test(ts)||!/^[a-f0-9]{64}$/i.test(sig))return false;if(Math.abs(Date.now()-Number(ts))>300000)return false;const expected=crypto.createHmac('sha256',this.secret).update(ts).update('.').update(raw).digest('hex');try{return crypto.timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(expected,'hex'));}catch{return false;}}
  heartbeat(data){const id=String(data.id||'').slice(0,80);if(!/^[\w.-]+$/.test(id))throw Object.assign(new Error('Worker inválido'),{status:400});const clean={id,name:String(data.name||id).slice(0,80),hashrate:Math.max(0,Number(data.hashrate||0)),powerWatts:Math.max(0,Number(data.powerWatts||0)),cloudCostBrlDay:Math.max(0,Number(data.cloudCostBrlDay||0)),accepted:Math.max(0,Number(data.accepted||0)),rejected:Math.max(0,Number(data.rejected||0)),algo:String(data.algo||'').slice(0,40),source:String(data.source||'worker-agent').slice(0,60),lastSeen:Date.now()};this.store.upsertWorker(clean);return clean;}
  summary(){const now=Date.now();const workers=this.store.listWorkers(200).map(w=>({...w,online:now-Number(w.last_seen||0)<this.ttlMs}));const online=workers.filter(w=>w.online);return {enabled:this.enabled(),workers,online:online.length,hashrate:online.reduce((s,w)=>s+Number(w.hashrate||0),0),powerWatts:online.reduce((s,w)=>s+Number(w.power_watts||0),0),cloudCostBrlDay:online.reduce((s,w)=>s+Number(w.cloud_cost_brl_day||0),0),accepted:online.reduce((s,w)=>s+Number(w.accepted||0),0),rejected:online.reduce((s,w)=>s+Number(w.rejected||0),0)};}
}
module.exports={WorkerProvider};
