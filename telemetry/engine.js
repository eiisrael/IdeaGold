'use strict';

const EventEmitter=require('events');
const crypto=require('crypto');
const S=require('../optimizer/statistics');
const Profit=require('../optimizer/profit-engine');

function maskWallet(w){const s=String(w||'');return s.length>20?`${s.slice(0,10)}…${s.slice(-10)}`:s;}
function niceQuantum(value){
  if(!(value>0))return null;
  const exp=Math.floor(Math.log10(value));const base=10**exp;const m=value/base;const nice=m<=1?1:m<=2?2:m<=5?5:10;return nice*base;
}
function slopeRate(rows){
  const good=(rows||[]).filter(r=>Number.isFinite(Number(r.ts))&&Number.isFinite(Number(r.totalPoolXmr)));
  if(good.length<3)return {rate:null,confidence:0};
  const t0=good[0].ts;const xs=good.map(r=>(r.ts-t0)/1000);const ys=good.map(r=>Number(r.totalPoolXmr));
  const xm=S.mean(xs),ym=S.mean(ys);let num=0,den=0;for(let i=0;i<xs.length;i++){num+=(xs[i]-xm)*(ys[i]-ym);den+=(xs[i]-xm)**2;}
  const rate=den>0?num/den:null;const span=(good.at(-1).ts-good[0].ts)/1000;
  return {rate:rate>0?rate:null,confidence:Math.min(.9,good.length/30)*Math.min(1,span/3600)};
}

class TelemetryEngine extends EventEmitter{
  constructor({db,controller,hardware,power,market,poolRegistry,getSettings,anomaly}){
    super();Object.assign(this,{db,controller,hardware,power,market,poolRegistry,getSettings,anomaly});
    this.current=null;this.timer=null;this.fastPool=null;this.fastNetwork=null;this.fastMarket=null;this.poolAt=0;this.networkAt=0;this.marketAt=0;
    this.session=null;this.poolSeries=[];this.lastRecorded=0;this.lastAlerts=new Map();
  }
  start(){if(this.timer)return;this.tick().catch(()=>{});this.timer=setInterval(()=>this.tick().catch(e=>this.emit('error',e)),5000);this.timer.unref?.();}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
  async refreshSlow(settings){
    const adapter=this.poolRegistry.get(settings.poolId);
    const now=Date.now();
    if(now-this.poolAt>15000){this.fastPool=await adapter.walletStats(settings.wallet);this.poolAt=now;if(this.fastPool?.available)this.db.poolSnapshot({...this.fastPool,ts:now});}
    if(now-this.networkAt>60000){this.fastNetwork=await adapter.networkStats();this.networkAt=now;}
    if(now-this.marketAt>60000){this.fastMarket=await this.market.get();this.marketAt=now;}
  }
  sessionStart(settings,pool){
    const id=crypto.randomUUID();const total=(Number(pool?.dueXmr)||0)+(Number(pool?.paidXmr)||0);
    this.session={id,startedAt:Date.now(),baselinePoolXmr:total,baselineAccepted:Number(pool?.accepted||0),baselineRejected:Number(pool?.rejected||0)};
    this.poolSeries=[];
    this.db.startSession({id,started_at:this.session.startedAt,pool:settings.poolId,wallet_masked:maskWallet(settings.wallet),profile:settings.activeProfile||'manual',objective:settings.objective||'balanced',baseline_pool_xmr:total});
    return this.session;
  }
  finishSession(reason='user'){
    if(!this.session)return;
    const rows=this.db.sessionTelemetry(this.session.id);const last=this.current||{};
    const started=this.session.startedAt,stopped=Date.now();const sec=Math.max(1,(stopped-started)/1000);
    const avgHash=S.mean(rows.map(r=>r.local_hashrate))||0,avgPower=S.mean(rows.map(r=>r.power_w))||0,avgPrice=S.mean(rows.map(r=>r.xmr_brl))||0;
    const energy=avgPower/1000*sec/3600;const settings=this.getSettings();const energyCost=energy*Number(settings.electricityBrlKwh||0);
    const finalPool=(Number(last.pool?.dueXmr)||0)+(Number(last.pool?.paidXmr)||0);const observed=Math.max(0,finalPool-this.session.baselinePoolXmr);const revenue=observed*avgPrice;
    this.db.finishSession(this.session.id,{stopped_at:stopped,final_pool_xmr:finalPool,xmr_observed:observed,avg_hashrate:avgHash,avg_power_w:avgPower,avg_price_brl:avgPrice,energy_kwh:energy,energy_cost_brl:energyCost,revenue_brl:revenue,profit_brl:revenue-energyCost,accepted:Number(last.session?.accepted||0),rejected:Number(last.session?.rejected||0),stop_reason:reason});
    this.session=null;this.poolSeries=[];
  }
  async tick(){
    const settings=this.getSettings();await this.refreshSlow(settings);
    const [miner,hw]=await Promise.all([this.controller.telemetry(),this.hardware.sample()]);
    const pool=this.fastPool||{available:false};const network=this.fastNetwork||{available:false};const market=this.fastMarket||{available:false};
    const mining=Boolean(miner.processRunning&&miner.hashrate10s>0);
    if(mining&&!this.session)this.sessionStart(settings,pool);
    if(!miner.processRunning&&this.session&&miner.desired!=='paused')this.finishSession(miner.desired||'stopped');
    const power=this.power.sample({mining,hardwareSample:hw,profile:miner.profile||{}});
    const totalPoolXmr=(Number(pool?.dueXmr)||0)+(Number(pool?.paidXmr)||0);
    if(pool?.available){this.poolSeries.push({ts:Date.now(),totalPoolXmr});this.poolSeries=this.poolSeries.filter(r=>Date.now()-r.ts<12*3600_000);}
    const observed=slopeRate(this.poolSeries);
    const theoretical=network?.available?Profit.networkRateXmrPerSec(pool?.hashrate>0?pool.hashrate:miner.hashrate60s,network.difficulty,network.reward,Number(settings.poolFeePct||0)):null;
    let xmrPerSec=null,rateSource='indisponível',rateConfidence=0;
    if(observed.rate&&observed.confidence>=.25){xmrPerSec=observed.rate;rateSource='crescimento observado do saldo do pool';rateConfidence=observed.confidence;}
    else if(theoretical){xmrPerSec=theoretical;rateSource=pool?.hashrate>0?'modelo de rede + hash efetivo do pool':'modelo de rede + hash local';rateConfidence=pool?.hashrate>0?.55:.35;}
    const econ=xmrPerSec&&market?.brl?Profit.economics({xmrPerSec,priceBrl:market.brl,powerW:power.watts,electricityBrlKwh:settings.electricityBrlKwh,cloudCostBrlDay:0,hashrate:miner.hashrate60s,difficulty:network?.difficulty,reward:network?.reward,poolFeePct:settings.poolFeePct}):{available:false};
    const sessionAccepted=this.session?Math.max(0,Number(pool?.accepted||miner.accepted||0)-this.session.baselineAccepted):Number(miner.accepted||0);
    const sessionRejected=this.session?Math.max(0,Number(pool?.rejected||miner.rejected||0)-this.session.baselineRejected):Number(miner.rejected||0);
    const poolFresh=pool?.lastShareTs?Date.now()-Number(pool.lastShareTs)<15*60_000:false;
    const shareRate=miner.hashrate10s>0&&miner.shareDifficulty>0?miner.hashrate10s/miner.shareDifficulty:null;
    const shareEta=shareRate?S.exponentialInterval(shareRate,.8):{available:false};
    const quantum=xmrPerSec?niceQuantum(xmrPerSec*15*60):null;
    const prodEta=xmrPerSec&&quantum?S.exponentialInterval(xmrPerSec/quantum,.8):{available:false};
    const sessionEarned=this.session?Math.max(0,totalPoolXmr-this.session.baselinePoolXmr):0;
    const current={
      ts:Date.now(),state:miner.processRunning?(mining?'mining':miner.desired==='paused'?'paused':'starting'):'stopped',miner,
      localHashrate:miner.hashrate10s,hash10s:miner.hashrate10s,hash60s:miner.hashrate60s,hash15m:miner.hashrate15m,
      pool:{...pool,fresh:poolFresh},network,market,hardware:{...this.hardware.staticInfo(),...hw},power,
      session:this.session?{...this.session,earnedXmrReal:sessionEarned,accepted:sessionAccepted,rejected:sessionRejected}:null,
      rate:{xmrPerSec,xmrPerHour:xmrPerSec?xmrPerSec*3600:null,source:rateSource,confidence:rateConfidence},
      shareEta,productionEta:{...prodEta,quantumXmr:quantum},economics:econ,
      efficiency:{hashesPerWatt:power.watts>0?miner.hashrate10s/power.watts:null},
      dataQuality:{pool:Boolean(pool?.available),poolFresh,market:Boolean(market?.available),network:Boolean(network?.available),xmrigApi:miner.apiConnected,power:power.kind,temperature:hw.temperatureC!=null?hw.temperatureSource:'indisponível'}
    };
    const history=this.db.telemetrySince(Date.now()-30*60_000,200);
    current.anomalies=this.anomaly.inspect({...current,processRunning:miner.processRunning,apiConnected:miner.apiConnected,accepted:sessionAccepted,rejected:sessionRejected,powerW:power.watts,temperatureC:hw.temperatureC},history);
    for(const a of current.anomalies){const last=this.lastAlerts.get(a.code)||0;if(Date.now()-last>15*60_000){this.db.addAlert(a.severity,a.code,a.message,'telemetry');this.lastAlerts.set(a.code,Date.now());}}
    this.current=current;
    if(Date.now()-this.lastRecorded>=20000){
      this.lastRecorded=Date.now();
      this.db.addTelemetry({ts:current.ts,session_id:this.session?.id||null,local_hashrate:miner.hashrate10s,hash_10s:miner.hashrate10s,hash_60s:miner.hashrate60s,hash_15m:miner.hashrate15m,pool_hashrate:pool?.hashrate??null,accepted:sessionAccepted,rejected:sessionRejected,stale:pool?.stale??null,share_diff:miner.shareDifficulty||null,cpu_load:hw.cpuLoadPct,memory_used_pct:hw.memoryUsedPct,temperature_c:hw.temperatureC,temperature_source:hw.temperatureSource,power_w:power.watts,power_source:power.source,efficiency_hw:current.efficiency.hashesPerWatt,xmr_due:pool?.dueXmr??null,xmr_paid:pool?.paidXmr??null,xmr_brl:market?.brl??null,network_difficulty:network?.difficulty??null,network_hashrate:network?.networkHashrate??null,block_reward:network?.reward??null,pool_latency_ms:pool?.latencyMs??null,profile:settings.activeProfile||null});
    }
    this.emit('sample',current);return current;
  }
  snapshot(){return this.current;}
}
module.exports={TelemetryEngine,niceQuantum,slopeRate};
