'use strict';

function clamp(x,a=0,b=1){return Math.max(a,Math.min(b,Number(x)||0));}
function normalize(x,ref){return ref>0?clamp(Number(x)/ref):0;}
function profileScores(row, refs={}){
  const h=Math.max(0,Number(row.hashrate||0));
  const w=Math.max(0,Number(row.powerW||0));
  const t=Number(row.temperatureC);
  const stability=clamp(row.stability ?? 0);
  const reject=clamp(Number(row.rejectRate||0));
  const profit=Number(row.profitBrlDay);
  const performance=normalize(h, refs.maxHash||h||1);
  const efficiency=normalize(w>0?h/w:0, refs.maxEfficiency||(w>0?h/w:1));
  const profitScore=refs.maxProfit!==refs.minProfit ? clamp((profit-refs.minProfit)/((refs.maxProfit-refs.minProfit)||1)) : (profit>=0?1:0.5);
  const thermal=Number.isFinite(t)?clamp(1-Math.max(0,t-55)/35):0.5;
  const stabilityScore=clamp(stability*(1-reject));
  const global=clamp(0.27*performance+0.25*efficiency+0.22*profitScore+0.12*thermal+0.14*stabilityScore);
  return {performance,efficiency,profit:profitScore,thermal,stability:stabilityScore,global};
}
function objectiveValue(mode,row){
  const h=Number(row.hashrate||0), w=Number(row.powerW||0), p=Number(row.profitBrlDay||0), s=Number(row.stability||0), t=Number(row.temperatureC);
  switch(mode){
    case 'performance': return h;
    case 'efficiency': return w>0?h/w:0;
    case 'profit': return p;
    case 'silent': return h*Math.max(0.1,s)/(1+Math.max(0,w));
    case 'balanced': default: {
      const thermalPenalty=Number.isFinite(t)?Math.max(0,t-70)*0.03:0;
      return Math.log1p(Math.max(0,h))*Math.max(0.2,s)*(w>0?Math.sqrt(h/w):1)-thermalPenalty;
    }
  }
}
function explain(mode,baseline,candidate){
  const pct=(a,b)=>a?100*(b-a)/Math.abs(a):null;
  const out={
    hashratePct:pct(Number(baseline.hashrate||0),Number(candidate.hashrate||0)),
    powerPct:pct(Number(baseline.powerW||0),Number(candidate.powerW||0)),
    efficiencyPct:pct(Number(baseline.efficiencyHW||0),Number(candidate.efficiencyHW||0)),
    profitDeltaBrl:Number(candidate.profitBrlDay||0)-Number(baseline.profitBrlDay||0),
    objective:mode
  };
  return out;
}
module.exports={clamp,profileScores,objectiveValue,explain};
