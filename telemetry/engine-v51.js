'use strict';

const EventEmitter=require('events');
const crypto=require('crypto');
const S=require('../optimizer/statistics');
const Profit=require('../optimizer/profit-engine');

function maskWallet(w){const s=String(w||'');return s.length>20?`${s.slice(0,10)}…${s.slice(-10)}`:s;}
function niceQuantum(value){if(!(value>0))return null;const exp=Math.floor(Math.log10(value)),base=10**exp,m=value/base,nice=m<=1?1:m<=2?2:m<=5?5:10;return nice*base;}
function slopeRate(rows){const good=(rows||[]).filter(r=>Number.isFinite(Number(r.ts))&&Number.isFinite(Number(r.totalPoolXmr)));if(good.length<3)return{rate:null,confidence:0};const t0=good[0].ts,xs=good.map(r=>(r.ts-t0)/1000),ys=good.map(r=>Number(r.totalPoolXmr)),xm=S.mean(xs),ym=S.mean(ys);let num=0,den=0;for(let i=0;i<xs.length;i++){num+=(xs[i]-xm)*(ys[i]-ym);den+=(xs[i]-xm)**2;}const rate=den>0?num/den:null,span=(good.at(-1).ts-good[0].ts)/1000;return{rate:rate>0?rate:null,confidence:Math.min(.9,good.length/30)*Math.min(1,span/3600)};}

class TelemetryEngine extends EventEmitter{
  constructor({db,controller,hardware,power,market,poolRegistry,getSettings,anomaly,logger=null}){
    super();Object.assign(this,{db,controller,hardware,power,market,poolRegistry,getSettings,anomaly,logger});
    this.current=null;this.timer=null;this.busy=false;this.session=null;this.poolSeries=[];this.lastPoolSeriesGoodAt=0;this.lastRecorded=0;this.lastAlerts=new Map();this.lastState=null;
    this.sources={pool:this.slot(),network:this.slot(),market:this.slot()};
  }
  slot(){return{value:null,lastGoodAt:0,lastAttemptAt:0,lastError:null,failures:0};}
  start(){if(this.timer)return;this.tick().catch(e=>this.emit('error',e));this.timer=setInterval(()=>this.tick().catch(e=>this.emit('error',e)),5000);this.timer.unref?.();this.logger?.info('telemetry','start','Telemetry Engine V5.1 iniciado.',{intervalMs:5000});}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;this.logger?.info('telemetry','stop','Telemetry Engine interrompido.');}
  async refreshOne(name,intervalMs,maxStaleMs,fn){
    const slot=this.sources[name],now=Date.now();
    if(now-slot.lastAttemptAt>=intervalMs){
      slot.lastAttemptAt=now;
      try{
        const v=await fn();
        if(!v?.available)throw new Error(v?.reason||`${name} retornou unavailable`);
        const wasFail=Boolean(slot.lastError);slot.value=v;slot.lastGoodAt=Date.now();slot.lastError=null;slot.failures=0;
        if(wasFail)this.logger?.info('telemetry',`${name}-recovered`,`${name} voltou a responder.`,{source:v.source||v.adapter||null});
      }catch(error){
        slot.lastError=error.message;slot.failures++;
        this.logger?.throttle(`source-${name}`,30000,()=>this.logger?.warn('telemetry',`${name}-failure`,`Falha temporária na fonte ${name}; último valor válido será preservado dentro da janela segura.`,{error:error.message,failures:slot.failures,lastGoodAgeSec:slot.lastGoodAt?Math.round((Date.now()-slot.lastGoodAt)/1000):null}));
      }
    }
    if(slot.value&&now-slot.lastGoodAt<=maxStaleMs){const age=now-slot.lastGoodAt;return{...slot.value,available:true,cached:age>intervalMs*1.5||Boolean(slot.lastError),stale:Boolean(slot.lastError)||age>maxStaleMs*.5,staleSec:Math.round(age/1000),sourceError:slot.lastError,_lastGoodAt:slot.lastGoodAt,_freshFetch:!slot.lastError&&slot.lastGoodAt===slot.lastAttemptAt?true:(!slot.lastError&&age<Math.min(intervalMs,8000))};}
    return{available:false,cached:false,stale:true,staleSec:slot.lastGoodAt?Math.round((now-slot.lastGoodAt)/1000):null,reason:slot.lastError||'ainda sem valor válido',_lastGoodAt:slot.lastGoodAt||0};
  }
  async refreshSlow(settings){
    const adapter=this.poolRegistry.get(settings.poolId);
    const [pool,network,market]=await Promise.all([
      this.refreshOne('pool',15000,10*60_000,()=>adapter.walletStats(settings.wallet)),
      this.refreshOne('network',60000,15*60_000,()=>adapter.networkStats()),
      this.refreshOne('market',60000,30*60_000,()=>this.market.get())
    ]);
    if(pool._lastGoodAt&&pool._lastGoodAt!==this.lastPoolSeriesGoodAt)this.db.poolSnapshot({...pool,ts:pool._lastGoodAt});
    return{pool,network,market};
  }
  sessionStart(settings,pool){
    const id=crypto.randomUUID(),live=Boolean(pool?.available&&!pool?.cached),total=live?(Number(pool?.dueXmr)||0)+(Number(pool?.paidXmr)||0):null;
    this.session={id,startedAt:Date.now(),baselinePoolXmr:total,baselinePending:total==null,baselineAccepted:live?Number(pool?.accepted||0):null,baselineRejected:live?Number(pool?.rejected||0):null};this.poolSeries=[];this.lastPoolSeriesGoodAt=0;
    this.db.startSession({id,started_at:this.session.startedAt,pool:settings.poolId,wallet_masked:maskWallet(settings.wallet),profile:settings.activeProfile||'manual',objective:settings.objective||'balanced',baseline_pool_xmr:total||0});
    this.logger?.info('session','start','Sessão de mineração iniciada.',{id,baselinePending:this.session.baselinePending,baselinePoolXmr:total});return this.session;
  }
  establishBaseline(pool){
    if(!this.session?.baselinePending||!pool?.available||pool?.cached)return;
    const total=(Number(pool.dueXmr)||0)+(Number(pool.paidXmr)||0);this.session.baselinePoolXmr=total;this.session.baselineAccepted=Number(pool.accepted||0);this.session.baselineRejected=Number(pool.rejected||0);this.session.baselinePending=false;
    try{this.db.db.prepare('UPDATE sessions SET baseline_pool_xmr=? WHERE id=?').run(total,this.session.id);}catch{}
    this.logger?.info('session','baseline-established','Baseline real da sessão estabelecido após primeira leitura válida do pool.',{id:this.session.id,baselinePoolXmr:total});
  }
  finishSession(reason='user'){
    if(!this.session)return;const rows=this.db.sessionTelemetry(this.session.id),last=this.current||{},started=this.session.startedAt,stopped=Date.now(),sec=Math.max(1,(stopped-started)/1000),avgHash=S.mean(rows.map(r=>r.local_hashrate))||0,avgPower=S.mean(rows.map(r=>r.power_w))||0,avgPrice=S.mean(rows.map(r=>r.xmr_brl))||0,energy=avgPower/1000*sec/3600,settings=this.getSettings(),energyCost=energy*Number(settings.electricityBrlKWh||0),finalPool=(Number(last.pool?.dueXmr)||0)+(Number(last.pool?.paidXmr)||0),observed=this.session.baselinePoolXmr==null?0:Math.max(0,finalPool-this.session.baselinePoolXmr),revenue=observed*avgPrice;
    this.db.finishSession(this.session.id,{stopped_at:stopped,final_pool_xmr:finalPool,xmr_observed:observed,avg_hashrate:avgHash,avg_power_w:avgPower,avg_price_brl:avgPrice,energy_kwh:energy,energy_cost_brl:energyCost,revenue_brl:revenue,profit_brl:revenue-energyCost,accepted:Number(last.session?.accepted||0),rejected:Number(last.session?.rejected||0),stop_reason:reason});this.logger?.info('session','finish','Sessão finalizada.',{id:this.session.id,reason,observedXmr:observed});this.session=null;this.poolSeries=[];this.lastPoolSeriesGoodAt=0;
  }
  async tick(){
    if(this.busy){this.logger?.throttle('telemetry-overlap',30000,()=>this.logger?.warn('telemetry','overlap-prevented','Tick anterior ainda estava em execução; sobreposição foi evitada.'));return this.current;}
    this.busy=true;
    try{
      const settings=this.getSettings(),slowPromise=this.refreshSlow(settings),minerPromise=this.controller.telemetry(),hwPromise=this.hardware.sample();
      const [{pool,network,market},miner,hw]=await Promise.all([slowPromise,minerPromise,hwPromise]);
      const mining=Boolean(miner.processRunning&&miner.hashrate10s>0);
      if(mining&&!this.session)this.sessionStart(settings,pool);this.establishBaseline(pool);
      if(!miner.processRunning&&this.session&&miner.desired==='stopped')this.finishSession(miner.stopReason||'stopped');
      const power=this.power.sample({mining,hardwareSample:hw,profile:miner.profile||{}}),totalPoolXmr=(Number(pool?.dueXmr)||0)+(Number(pool?.paidXmr)||0);
      if(pool?.available&&pool._lastGoodAt&&pool._lastGoodAt!==this.lastPoolSeriesGoodAt&&!this.session?.baselinePending){this.poolSeries.push({ts:pool._lastGoodAt,totalPoolXmr});this.lastPoolSeriesGoodAt=pool._lastGoodAt;this.poolSeries=this.poolSeries.filter(r=>Date.now()-r.ts<12*3600_000);}
      const observed=slopeRate(this.poolSeries),effectiveHash=Number(pool?.hashrate||0)>0?Number(pool.hashrate):Number(miner.hashrate60s||miner.hashrate10s||0),theoretical=network?.available&&effectiveHash>0?Profit.networkRateXmrPerSec(effectiveHash,network.difficulty,network.reward,Number(settings.poolFeePct||0)):null;
      let xmrPerSec=null,rateSource='indisponível',rateConfidence=0;
      if(observed.rate&&observed.confidence>=.25){xmrPerSec=observed.rate;rateSource='crescimento observado do saldo do pool';rateConfidence=observed.confidence;}
      else if(theoretical){xmrPerSec=theoretical;rateSource=Number(pool?.hashrate||0)>0?'modelo de rede + hash efetivo do pool':'modelo de rede + hash local';rateConfidence=Number(pool?.hashrate||0)>0?.55:.32;if(pool.cached)rateConfidence*=.7;if(network.cached)rateConfidence*=.75;}
      const econ=xmrPerSec&&market?.brl?Profit.economics({xmrPerSec,priceBrl:market.brl,powerW:power.watts,electricityBrlKWh:settings.electricityBrlKWh,cloudCostBrlDay:0,hashrate:effectiveHash,difficulty:network?.difficulty,reward:network?.reward,poolFeePct:settings.poolFeePct}):{available:false};
      const poolAccepted=Number(pool?.accepted),poolRejected=Number(pool?.rejected),sessionAccepted=this.session?(this.session.baselineAccepted!=null&&Number.isFinite(poolAccepted)?Math.max(0,poolAccepted-this.session.baselineAccepted):Number(miner.accepted||0)):Number(miner.accepted||0),sessionRejected=this.session?(this.session.baselineRejected!=null&&Number.isFinite(poolRejected)?Math.max(0,poolRejected-this.session.baselineRejected):Number(miner.rejected||0)):Number(miner.rejected||0),poolFresh=pool?.lastShareTs?Date.now()-Number(pool.lastShareTs)<15*60_000:false,shareRate=miner.hashrate10s>0&&miner.shareDifficulty>0?miner.hashrate10s/miner.shareDifficulty:null,shareEta=shareRate?S.exponentialInterval(shareRate,.8):{available:false},quantum=xmrPerSec?niceQuantum(xmrPerSec*15*60):null,prodEta=xmrPerSec&&quantum?S.exponentialInterval(xmrPerSec/quantum,.8):{available:false},sessionEarned=this.session&&this.session.baselinePoolXmr!=null?Math.max(0,totalPoolXmr-this.session.baselinePoolXmr):0;
      const state=miner.processRunning?(mining?'mining':miner.desired==='paused'?'paused':'starting'):(miner.desired==='paused'?'paused':miner.desired==='running'?'recovering':'stopped');
      const current={ts:Date.now(),state,miner,localHashrate:miner.hashrate10s,hash10s:miner.hashrate10s,hash60s:miner.hashrate60s,hash15m:miner.hashrate15m,pool:{...pool,fresh:poolFresh},network,market,hardware:{...this.hardware.staticInfo(),...hw},power,session:this.session?{...this.session,earnedXmrReal:sessionEarned,accepted:sessionAccepted,rejected:sessionRejected}:null,rate:{xmrPerSec,xmrPerHour:xmrPerSec?xmrPerSec*3600:null,source:rateSource,confidence:rateConfidence},shareEta,productionEta:{...prodEta,quantumXmr:quantum},economics:econ,efficiency:{hashesPerWatt:power.watts>0?effectiveHash/power.watts:null},dataQuality:{pool:Boolean(pool?.available),poolCached:Boolean(pool?.cached),poolAgeSec:pool?.staleSec??null,poolFresh,market:Boolean(market?.available),marketCached:Boolean(market?.cached),marketAgeSec:market?.staleSec??null,network:Boolean(network?.available),networkCached:Boolean(network?.cached),xmrigApi:miner.apiConnected,power:power.kind,temperature:hw.temperatureC!=null?hw.temperatureSource:'indisponível'}};
      const history=this.db.telemetrySince(Date.now()-30*60_000,200);current.anomalies=this.anomaly.inspect({...current,processRunning:miner.processRunning,apiConnected:miner.apiConnected,accepted:sessionAccepted,rejected:sessionRejected,powerW:power.watts,temperatureC:hw.temperatureC},history);
      for(const a of current.anomalies){const last=this.lastAlerts.get(a.code)||0;if(Date.now()-last>15*60_000){this.db.addAlert(a.severity,a.code,a.message,'telemetry');this.lastAlerts.set(a.code,Date.now());this.logger?.warn('anomaly',a.code,a.message,{severity:a.severity});}}
      if(state!==this.lastState){this.logger?.info('telemetry','state-change',`Estado mudou: ${this.lastState||'none'} -> ${state}.`,{minerDesired:miner.desired,pid:miner.pid,hashrate:miner.hashrate10s,apiConnected:miner.apiConnected});this.lastState=state;}
      this.current=current;
      if(Date.now()-this.lastRecorded>=20000){this.lastRecorded=Date.now();this.db.addTelemetry({ts:current.ts,session_id:this.session?.id||null,local_hashrate:miner.hashrate10s,hash_10s:miner.hashrate10s,hash_60s:miner.hashrate60s,hash_15m:miner.hashrate15m,pool_hashrate:pool?.available?pool.hashrate??null:null,accepted:sessionAccepted,rejected:sessionRejected,stale:pool?.stale??null,share_diff:miner.shareDifficulty||null,cpu_load:hw.cpuLoadPct,memory_used_pct:hw.memoryUsedPct,temperature_c:hw.temperatureC,temperature_source:hw.temperatureSource,power_w:power.watts,power_source:power.source,efficiency_hw:current.efficiency.hashesPerWatt,xmr_due:pool?.available?pool.dueXmr??null:null,xmr_paid:pool?.available?pool.paidXmr??null:null,xmr_brl:market?.available?market.brl??null:null,network_difficulty:network?.available?network.difficulty??null:null,network_hashrate:network?.available?network.networkHashrate??null:null,block_reward:network?.available?network.reward??null:null,pool_latency_ms:pool?.latencyMs??null,profile:settings.activeProfile||null});}
      this.emit('sample',current);return current;
    }finally{this.busy=false;}
  }
  snapshot(){return this.current;}
}
module.exports={TelemetryEngine,niceQuantum,slopeRate};
