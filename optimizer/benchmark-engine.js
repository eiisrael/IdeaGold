'use strict';

const EventEmitter=require('events');
const crypto=require('crypto');
const S=require('./statistics');
const {objectiveValue,explain}=require('./scoring');

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

class BenchmarkEngine extends EventEmitter{
  constructor({db,controller,safety,hardwareFingerprint,getContext,getSample}){
    super();this.db=db;this.controller=controller;this.safety=safety;this.hardwareFingerprint=hardwareFingerprint;
    this.getContext=getContext;this.getSample=getSample;this.running=false;this.cancelled=false;this.progress={state:'idle'};
  }
  status(){return {...this.progress,running:this.running};}
  cancel(){this.cancelled=true;this.progress={...this.progress,state:'cancelling'};}
  async runCandidate(config,{objective='balanced',warmupSec=30,sampleSec=90,label='candidate',baseline=null}={}){
    if(this.running)throw new Error('Já existe benchmark em andamento.');
    this.running=true;this.cancelled=false;
    const id=crypto.randomUUID();
    try{
      const ctx=this.getContext();
      const valid=this.safety.validateCandidate(config,ctx.hardware);
      if(!valid.ok)throw new Error(`Configuração rejeitada: ${valid.errors.join(', ')}`);
      this.progress={id,state:'applying',label,objective,config,warmupSec,sampleSec,startedAt:Date.now()};this.emit('progress',this.status());
      await this.controller.restart({...ctx,profile:config},'benchmark');
      for(let i=0;i<warmupSec;i++){
        if(this.cancelled)throw new Error('benchmark-cancelled');
        this.progress={...this.progress,state:'warmup',remaining:warmupSec-i};this.emit('progress',this.status());await sleep(1000);
      }
      const samples=[];
      for(let i=0;i<sampleSec;i++){
        if(this.cancelled)throw new Error('benchmark-cancelled');
        const s=await this.getSample();
        if(s&&Number(s.localHashrate)>0)samples.push(s);
        this.progress={...this.progress,state:'sampling',remaining:sampleSec-i,samples:samples.length};this.emit('progress',this.status());
        await sleep(1000);
      }
      if(samples.length<Math.max(10,Math.floor(sampleSec*.35)))throw new Error('Amostras válidas insuficientes para comparar.');
      const hashes=S.rejectOutliers(samples.map(s=>s.localHashrate));
      const powers=S.rejectOutliers(samples.map(s=>s.powerW).filter(x=>Number(x)>0));
      const temps=S.rejectOutliers(samples.map(s=>s.temperatureC).filter(Number.isFinite));
      const h=S.trimmedMean(hashes,.1)||0;
      const p=S.trimmedMean(powers,.1)||0;
      const t=S.trimmedMean(temps,.1);
      const accepted=Math.max(...samples.map(s=>Number(s.accepted||0)))-Math.min(...samples.map(s=>Number(s.accepted||0)));
      const rejected=Math.max(...samples.map(s=>Number(s.rejected||0)))-Math.min(...samples.map(s=>Number(s.rejected||0)));
      const rejectRate=accepted+rejected>0?rejected/(accepted+rejected):0;
      const result={
        id,config,hashrate:h,powerW:p||null,temperatureC:t,efficiencyHW:p>0?h/p:null,rejectRate,
        stability:S.stabilityScore(hashes),samples:samples.length,durationSec:sampleSec,
        confidence:S.confidenceScore({samples:samples.length,seconds:sampleSec,shares:accepted,rateCv:S.cv(hashes)||1,poolFresh:samples.some(x=>x.poolFresh),powerMeasured:samples.some(x=>x.powerKind==='measured')})
      };
      result.profitBrlDay=samples.at(-1)?.profitBrlDay ?? null;
      result.objectiveValue=objectiveValue(objective,result);
      const safety=baseline?this.safety.compare(baseline,result):{safe:true,reason:'baseline inicial'};
      result.safe=safety.safe;result.safetyReason=safety.reason;
      if(!safety.safe)result.status='rollback'; else result.status='complete';
      this.db.addBenchmark({
        hardware_fingerprint:this.hardwareFingerprint,objective,profile_name:label,config,
        duration_sec:sampleSec,samples:result.samples,hashrate:result.hashrate,power_w:result.powerW,temperature_c:result.temperatureC,
        efficiency_hw:result.efficiencyHW,reject_rate:result.rejectRate,stability:result.stability,profit_brl_day:result.profitBrlDay,
        score:result.objectiveValue,confidence:result.confidence,status:result.status,notes:result.safetyReason
      });
      if(baseline)result.comparison=explain(objective,baseline,result);
      this.progress={...this.progress,state:result.status,result,finishedAt:Date.now()};this.emit('progress',this.status());
      return result;
    }catch(error){
      this.progress={...this.progress,state:error.message==='benchmark-cancelled'?'cancelled':'error',error:error.message,finishedAt:Date.now()};this.emit('progress',this.status());
      throw error;
    }finally{this.running=false;}
  }
}
module.exports={BenchmarkEngine};
