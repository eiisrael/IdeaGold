'use strict';
const os=require('os');
const {clamp,validXmrWallet}=require('./lib/utils');

const DEFAULTS={
  wallet:'',poolMode:'moneroocean',p2poolEndpoint:'127.0.0.1:3333',workerName:os.hostname(),electricityBrlKwh:0.90,currency:'BRL',
  optimizationMode:'balanced',supremeMindEnabled:true,supremeMindAutoApply:false,basicMode:true,
  cpuThreadsPercent:75,priority:3,yield:false,prefetch:1,affinity:null,
  measuredPowerWatts:0,estimatedBaseWatts:30,estimatedCpuWatts:75,
  thermalWarningC:75,thermalCriticalC:85,pauseOnCpuLoad:false,cpuLoadThreshold:85,resumeAfterMin:5,
  telemetryIntervalMs:5000,privacyLocalOnly:true,poolFeePct:1
};
function loadSettings(store){return {...DEFAULTS,...store.get('settings',{})};}
function sanitizeSettings(input,current=DEFAULTS){
  const out={...current,...input};
  if(input.wallet!==undefined){const w=String(input.wallet||'').trim();if(w&&!validXmrWallet(w))throw Object.assign(new Error('Endereço XMR público inválido.'),{status:400});out.wallet=w;}
  out.poolMode=['moneroocean','p2pool'].includes(out.poolMode)?out.poolMode:'moneroocean';
  out.optimizationMode=['performance','efficiency','profit','balanced','silent','manual'].includes(out.optimizationMode)?out.optimizationMode:'balanced';
  out.electricityBrlKwh=clamp(out.electricityBrlKwh,0,20);out.cpuThreadsPercent=clamp(out.cpuThreadsPercent,25,100);out.priority=clamp(out.priority,0,5);out.prefetch=clamp(out.prefetch,0,3);out.measuredPowerWatts=clamp(out.measuredPowerWatts,0,3000);out.estimatedBaseWatts=clamp(out.estimatedBaseWatts,0,500);out.estimatedCpuWatts=clamp(out.estimatedCpuWatts,0,500);out.thermalWarningC=clamp(out.thermalWarningC,40,100);out.thermalCriticalC=clamp(out.thermalCriticalC,Math.max(out.thermalWarningC+1,50),110);out.cpuLoadThreshold=clamp(out.cpuLoadThreshold,30,100);out.resumeAfterMin=clamp(out.resumeAfterMin,1,120);out.telemetryIntervalMs=clamp(out.telemetryIntervalMs,2000,30000);out.poolFeePct=clamp(out.poolFeePct,0,10);
  for(const k of ['supremeMindEnabled','supremeMindAutoApply','basicMode','pauseOnCpuLoad','privacyLocalOnly','yield'])out[k]=Boolean(out[k]);
  return out;
}
function saveSettings(store,input){const current=loadSettings(store);const out=sanitizeSettings(input,current);store.set('settings',out);return out;}
module.exports={DEFAULTS,loadSettings,sanitizeSettings,saveSettings};
