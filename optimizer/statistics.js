'use strict';

function finite(values) { return (values || []).map(Number).filter(Number.isFinite); }
function mean(values) { const v = finite(values); return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null; }
function median(values) { const v = finite(values).sort((a,b)=>a-b); if (!v.length) return null; const m=Math.floor(v.length/2); return v.length%2?v[m]:(v[m-1]+v[m])/2; }
function variance(values) { const v=finite(values); if (v.length<2) return 0; const m=mean(v); return v.reduce((s,x)=>s+(x-m)**2,0)/(v.length-1); }
function stddev(values) { return Math.sqrt(variance(values)); }
function mad(values) { const m=median(values); if (m==null) return null; return median(finite(values).map(x=>Math.abs(x-m))); }
function cv(values) { const m=mean(values); return m ? stddev(values)/Math.abs(m) : null; }
function quantile(values, q) { const v=finite(values).sort((a,b)=>a-b); if(!v.length)return null; const pos=(v.length-1)*Math.max(0,Math.min(1,q)); const lo=Math.floor(pos), hi=Math.ceil(pos); return lo===hi?v[lo]:v[lo]+(v[hi]-v[lo])*(pos-lo); }
function trimmedMean(values, trim=0.1) { const v=finite(values).sort((a,b)=>a-b); if(!v.length)return null; const n=Math.floor(v.length*trim); const s=v.slice(n, Math.max(n+1,v.length-n)); return mean(s); }
function confidence95(values) { const v=finite(values); if(!v.length)return {mean:null,low:null,high:null,n:0}; const m=mean(v); if(v.length<2)return {mean:m,low:m,high:m,n:v.length}; const se=stddev(v)/Math.sqrt(v.length); const t=v.length<30?2.262:1.96; return {mean:m,low:m-t*se,high:m+t*se,n:v.length}; }
function robustZ(value, values) { const m=median(values), d=mad(values); if(m==null||!d)return 0; return 0.6745*(Number(value)-m)/d; }
function rejectOutliers(values, z=3.5) { const v=finite(values); return v.filter(x=>Math.abs(robustZ(x,v))<=z); }
function stabilityScore(values) { const v=rejectOutliers(values); if(v.length<3)return 0; const c=cv(v); if(c==null)return 0; return Math.max(0,Math.min(1,1-c/0.15)); }
function confidenceScore({ samples=0, seconds=0, shares=0, rateCv=1, poolFresh=false, powerMeasured=false }) {
  const sampleScore=Math.min(1,Number(samples)/60);
  const timeScore=Math.min(1,Number(seconds)/1800);
  const shareScore=Math.min(1,Number(shares)/20);
  const stability=Math.max(0,Math.min(1,1-Number(rateCv||1)/0.35));
  const pool=poolFresh?1:0.35;
  const power=powerMeasured?1:0.65;
  return Math.max(0,Math.min(1,0.24*sampleScore+0.22*timeScore+0.14*shareScore+0.22*stability+0.12*pool+0.06*power));
}
function exponentialInterval(ratePerSecond, confidence=0.8) {
  const r=Number(ratePerSecond); if(!(r>0))return {available:false};
  const meanSec=1/r;
  const alpha=(1-confidence)/2;
  return { available:true, meanSec, lowSec:-Math.log(1-alpha)/r, highSec:-Math.log(alpha)/r, confidence };
}

module.exports={finite,mean,median,variance,stddev,mad,cv,quantile,trimmedMean,confidence95,robustZ,rejectOutliers,stabilityScore,confidenceScore,exponentialInterval};
