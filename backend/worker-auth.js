'use strict';

const crypto=require('crypto');

function signWorkerPayload(secret,timestamp,rawBody){
  return crypto.createHmac('sha256',String(secret||'')).update(String(timestamp)).update('.').update(String(rawBody||'')).digest('hex');
}

function verifyWorkerSignature({secret,timestamp,rawBody,signature,now=Date.now(),maxSkewMs=300000}){
  const key=String(secret||'');
  if(key.length<16||key==='troque-por-um-segredo-forte')return{ok:false,reason:'worker-secret-not-configured'};
  const ts=Number(timestamp);
  if(!Number.isFinite(ts)||Math.abs(Number(now)-ts)>Math.max(1000,Number(maxSkewMs||300000)))return{ok:false,reason:'timestamp-out-of-window'};
  const sig=String(signature||'').toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(sig))return{ok:false,reason:'invalid-signature-format'};
  const expected=signWorkerPayload(key,String(timestamp),String(rawBody||''));
  const a=Buffer.from(sig,'hex'),b=Buffer.from(expected,'hex');
  return a.length===b.length&&crypto.timingSafeEqual(a,b)?{ok:true,ts}:{ok:false,reason:'signature-mismatch'};
}

function normalizeWorkerPayload(input={}){
  const id=String(input.id||'').replace(/[^a-zA-Z0-9._-]/g,'-').slice(0,80);
  if(!id)throw new Error('Worker id inválido.');
  const text=(v,max=120)=>String(v||'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,max);
  const num=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>Math.max(min,Math.min(max,Number.isFinite(Number(v))?Number(v):0));
  const backends=Array.isArray(input.backends)?input.backends.slice(0,16).map(b=>({type:text(b?.type,40),hashrate:num(b?.hashrate,0,1e15),enabled:b?.enabled!==false})):[];
  return {
    id,name:text(input.name||id,80)||id,coin:text(input.coin||'XMR',16),algo:text(input.algo,40),
    hashrate:num(input.hashrate,0,1e15),hashrate60s:num(input.hashrate60s,0,1e15),hashrate15m:num(input.hashrate15m,0,1e15),
    accepted:Math.round(num(input.accepted,0,1e15)),rejected:Math.round(num(input.rejected,0,1e15)),uptime:num(input.uptime,0,1e12),
    pool:text(input.pool,200),minerVersion:text(input.minerVersion,80),host:text(input.host,120),
    powerWatts:num(input.powerWatts,0,100000),electricityBrlKWh:num(input.electricity,0,100),cloudCostBrlDay:num(input.cloudCostBrlDay,0,1e9),backends
  };
}

module.exports={signWorkerPayload,verifyWorkerSignature,normalizeWorkerPayload};
