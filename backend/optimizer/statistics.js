'use strict';
const {mean,stddev,median,percentile,clamp}=require('../lib/utils');

function robustSeries(values){
  const a=values.map(Number).filter(Number.isFinite);
  if(a.length<5) return a;
  const med=median(a); const mad=median(a.map(v=>Math.abs(v-med)))||1e-9;
  return a.filter(v=>Math.abs(v-med)/(1.4826*mad) <= 4.5);
}
function stability(values){
  const a=robustSeries(values); if(!a.length)return {mean:0,sd:0,cv:1,score:0,n:0};
  const m=mean(a),sd=stddev(a),cv=m>0?sd/m:1;
  return {mean:m,sd,cv,score:clamp(1-cv*4,0,1),n:a.length};
}
function meanCI(values, confidence=0.95){
  const a=robustSeries(values); if(!a.length)return {mean:0,low:0,high:0,n:0};
  const m=mean(a),se=stddev(a)/Math.sqrt(Math.max(1,a.length));
  const z=confidence>=0.99?2.576:confidence>=0.95?1.96:1.645;
  return {mean:m,low:m-z*se,high:m+z*se,n:a.length};
}
function exponentialArrival(ratePerSec, confidence=0.8){
  if(!(ratePerSec>0)) return null;
  const expected=1/ratePerSec;
  const alpha=(1-confidence)/2;
  return {expectedSec:expected,lowSec:-Math.log(1-alpha)/ratePerSec,highSec:-Math.log(alpha)/ratePerSec,confidence};
}
function shareEta(hashrate, shareDifficulty, sampleCount=0, runtimeSec=0, cv=1){
  if(!(hashrate>0&&shareDifficulty>0))return {available:false,reason:'difficulty-or-hashrate-unavailable'};
  const arrival=exponentialArrival(hashrate/shareDifficulty,0.8);
  const dataScore=clamp(sampleCount/30,0,1)*0.55+clamp(runtimeSec/7200,0,1)*0.25+clamp(1-cv,0,1)*0.20;
  return {...arrival,available:true,confidence:clamp(dataScore,0.05,0.95)};
}
function etaConfidence({runtimeSec=0,shares=0,hashCv=1,poolFresh=false,samples=0}){
  return clamp(0.10+clamp(runtimeSec/10800,0,1)*0.25+clamp(shares/50,0,1)*0.25+clamp(samples/180,0,1)*0.20+clamp(1-hashCv*3,0,1)*0.15+(poolFresh?0.05:0),0.05,0.95);
}
function anomalyZ(current, history){
  const a=robustSeries(history); if(a.length<8)return {z:0,anomaly:false,reason:'insufficient-samples'};
  const m=mean(a),sd=stddev(a)||1e-9,z=(current-m)/sd;
  return {z,anomaly:Math.abs(z)>=3,mean:m,sd};
}
function compareAB(baseline,candidate){
  const bm=meanCI(baseline.hashrates||[]),cm=meanCI(candidate.hashrates||[]);
  const bp=mean(baseline.watts||[]),cp=mean(candidate.watts||[]);
  const be=bp>0?bm.mean/bp:null,ce=cp>0?cm.mean/cp:null;
  const overlap=!(cm.low>bm.high||bm.low>cm.high);
  return {
    baselineHash:bm.mean,candidateHash:cm.mean,
    hashDeltaPct:bm.mean?((cm.mean/bm.mean)-1)*100:0,
    baselineWatts:bp||null,candidateWatts:cp||null,
    efficiencyDeltaPct:be&&ce?((ce/be)-1)*100:null,
    statisticallySeparated:!overlap,
    nBaseline:bm.n,nCandidate:cm.n,
    confidence:clamp(Math.min(bm.n,cm.n)/30,0,1)*(overlap?0.65:0.95)
  };
}
module.exports={robustSeries,stability,meanCI,exponentialArrival,shareEta,etaConfidence,anomalyZ,compareAB,percentile};
