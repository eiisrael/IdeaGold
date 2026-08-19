'use strict';

function finite(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function clamp(v, min, max) { return Math.min(max, Math.max(min, finite(v, min))); }
function mean(xs) { const a = xs.filter(Number.isFinite); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function median(values) {
  const xs = values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if (!xs.length) return 0;
  const m = Math.floor(xs.length/2); return xs.length % 2 ? xs[m] : (xs[m-1]+xs[m])/2;
}
function quantile(values, q) {
  const xs = values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if (!xs.length) return 0;
  const p = clamp(q, 0, 1) * (xs.length - 1), lo = Math.floor(p), hi = Math.ceil(p);
  return xs[lo] + (xs[hi] - xs[lo]) * (p - lo);
}
function robust(values) {
  const xs = values.map(Number).filter(x=>Number.isFinite(x));
  if (!xs.length) return { n:0, mean:0, median:0, mad:0, sigma:0, cv:1, p10:0, p90:0 };
  const med=median(xs), mad=median(xs.map(x=>Math.abs(x-med))), sigma=1.4826*mad;
  return { n:xs.length, mean:mean(xs), median:med, mad, sigma, cv: med ? Math.abs(sigma/med) : 1, p10:quantile(xs,.1), p90:quantile(xs,.9) };
}
function standardError(values) {
  const xs=values.map(Number).filter(Number.isFinite); if(xs.length<2)return Infinity;
  const m=mean(xs); const variance=xs.reduce((s,x)=>s+(x-m)**2,0)/(xs.length-1); return Math.sqrt(variance/xs.length);
}
function confidenceInterval(values, z=1.96) {
  const xs=values.map(Number).filter(Number.isFinite); if(!xs.length)return {low:0,high:0,center:0};
  const center=mean(xs), se=standardError(xs); if(!Number.isFinite(se))return {low:center,high:center,center};
  return {low:center-z*se,high:center+z*se,center};
}
function confidenceScore({samples=0, durationSec=0, cv=1, accepted=0, rejected=0, sourceQuality=1}={}) {
  const sampleScore=1-Math.exp(-Math.max(0,samples)/18);
  const timeScore=1-Math.exp(-Math.max(0,durationSec)/900);
  const stability=Math.exp(-Math.max(0,cv)*2.2);
  const shares=accepted+rejected; const shareScore=shares ? Math.max(0, accepted/shares) : .55;
  return clamp((.30*sampleScore+.25*timeScore+.25*stability+.10*shareScore+.10*clamp(sourceQuality,0,1)),0,1);
}
function exponentialEta(ratePerSec, confidence=0) {
  if (!(ratePerSec>0)) return {available:false};
  const meanSec=1/ratePerSec;
  return { available:true, meanSec, optimisticSec:-Math.log(1-.25)/ratePerSec, conservativeSec:-Math.log(1-.75)/ratePerSec, confidence:clamp(confidence,0,1) };
}
function shareEta(hashrate, shareDifficulty, observedIntervalsSec=[]) {
  const theoretical = hashrate>0 && shareDifficulty>0 ? exponentialEta(hashrate/shareDifficulty, .45) : null;
  const obs=robust(observedIntervalsSec.filter(x=>x>0));
  if (obs.n>=4) {
    const rate=1/Math.max(1,obs.median); const conf=confidenceScore({samples:obs.n,durationSec:observedIntervalsSec.reduce((s,x)=>s+x,0),cv:obs.cv,sourceQuality:.9});
    const e=exponentialEta(rate,conf); return {...e, source:'observed-share-intervals', observed:obs, theoretical};
  }
  return theoretical ? {...theoretical, source:'share-difficulty-model', observed:obs} : {available:false,source:'insufficient-data'};
}
function linearTrend(points) {
  const p=points.filter(x=>Number.isFinite(x.x)&&Number.isFinite(x.y)); if(p.length<2)return {slope:0,intercept:p[0]?.y||0,r2:0,n:p.length};
  const mx=mean(p.map(x=>x.x)), my=mean(p.map(x=>x.y));
  let num=0,den=0,ss=0,res=0; for(const a of p){num+=(a.x-mx)*(a.y-my);den+=(a.x-mx)**2;ss+=(a.y-my)**2;}
  const slope=den?num/den:0, intercept=my-slope*mx; for(const a of p)res+=(a.y-(slope*a.x+intercept))**2;
  return {slope,intercept,r2:ss?Math.max(0,1-res/ss):0,n:p.length};
}
module.exports={finite,clamp,mean,median,quantile,robust,standardError,confidenceInterval,confidenceScore,exponentialEta,shareEta,linearTrend};
