'use strict';

const {validWallet,normalizeConfig}=require('../miner/config-manager');

function defaults(hardware){
  const logicalThreads=Math.max(1,Math.round(Number(hardware?.logicalThreads||1)));
  const cpuModel=String(hardware?.cpuModel||'');
  const preferredThreads=cpuModel.includes('i5-4670K')?3:Math.max(1,Math.round(logicalThreads*.75));
  const threads=Math.max(1,Math.min(logicalThreads,preferredThreads));
  return {
    wallet:'',poolId:'moneroocean',workerName:'IdeaGold',electricityBrlKWh:0.90,poolFeePct:0,
    objective:'balanced',supremeMindEnabled:false,basicMode:true,activeProfile:'default',
    profile:normalizeConfig({threads,priority:3,yield:true,hugePages:true,hugePagesJit:true,rdmsr:true,wrmsr:true,numa:true,randomxMode:'fast',scratchpadPrefetch:1}),
    measuredPowerWatts:0,basePowerWatts:30,cpuPowerWatts:75,logicalThreads,
    thermalWarningC:75,thermalCriticalC:85,maxRejectRate:.05,minHashrateRatio:.82,requireHugePages:false,
    benchmarkWarmupSec:20,benchmarkSampleSec:60,maxAutotuneExperiments:4,
    pauseCpuLoadPct:0,resumeAfterMinutes:5,p2poolHost:'127.0.0.1',p2poolPort:3333,p2poolDataApi:'',p2poolSidechain:'mini',
    privacy:{localOnly:true,externalTelemetry:false},scheduler:{enabled:false,start:'00:00',stop:'00:00'}
  };
}

class SettingsStore{
  constructor(db,hardware){this.db=db;this.hardware=hardware;this.key='settings-v5';}
  get(){return {...defaults(this.hardware),...(this.db.getSetting(this.key,{})||{})};}
  update(input={}){
    const old=this.get();const next={...old,...input};
    if(input.wallet!==undefined){const w=String(input.wallet||'').trim();if(w&&!validWallet(w))throw new Error('Carteira XMR inválida.');next.wallet=w;}
    if(input.profile)next.profile=normalizeConfig({...old.profile,...input.profile});
    next.workerName=String(next.workerName||'IdeaGold').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,32)||'IdeaGold';
    next.poolId=['moneroocean','p2pool'].includes(next.poolId)?next.poolId:'moneroocean';
    next.objective=['performance','efficiency','profit','balanced','silent','manual'].includes(next.objective)?next.objective:'balanced';
    next.electricityBrlKWh=Math.max(0,Math.min(20,Number(next.electricityBrlKWh||0)));
    next.poolFeePct=Math.max(0,Math.min(10,Number(next.poolFeePct||0)));
    next.measuredPowerWatts=Math.max(0,Math.min(5000,Number(next.measuredPowerWatts||0)));
    next.thermalWarningC=Math.max(40,Math.min(100,Number(next.thermalWarningC||75)));
    next.thermalCriticalC=Math.max(next.thermalWarningC+1,Math.min(110,Number(next.thermalCriticalC||85)));
    next.maxRejectRate=Math.max(0.001,Math.min(.5,Number(next.maxRejectRate||.05)));
    next.benchmarkWarmupSec=Math.max(10,Math.min(600,Math.round(Number(next.benchmarkWarmupSec||20))));
    next.benchmarkSampleSec=Math.max(30,Math.min(1800,Math.round(Number(next.benchmarkSampleSec||60))));
    next.maxAutotuneExperiments=Math.max(1,Math.min(12,Math.round(Number(next.maxAutotuneExperiments||4))));
    this.db.setSetting(this.key,next);return next;
  }
}
module.exports={SettingsStore,defaults};
