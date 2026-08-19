'use strict';

function clamp(x,a=0,b=1){return Math.max(a,Math.min(b,Number(x)||0));}
function scorePool({latencyMs,feePct,rejectRate,available,payoutMinimumXmr,stability=null}){
  const parts=[];
  if(typeof available==='boolean')parts.push({name:'availability',weight:3,value:available?1:0,label:available?'online':'offline'});
  if(Number.isFinite(Number(latencyMs))){const v=clamp(1-Number(latencyMs)/500);parts.push({name:'ping',weight:2,value:v,label:`${Number(latencyMs).toFixed(0)} ms`});}
  if(Number.isFinite(Number(feePct))){const v=clamp(1-Number(feePct)/3);parts.push({name:'fee',weight:2,value:v,label:`${Number(feePct).toFixed(2)}%`});}
  if(Number.isFinite(Number(rejectRate))){const v=clamp(1-Number(rejectRate)/.05);parts.push({name:'rejects',weight:2,value:v,label:`${(Number(rejectRate)*100).toFixed(2)}%`});}
  if(Number.isFinite(Number(stability))){parts.push({name:'stability',weight:2,value:clamp(stability),label:`${(clamp(stability)*100).toFixed(0)}%`});}
  if(Number.isFinite(Number(payoutMinimumXmr))){const v=clamp(1-Math.log10(1+Number(payoutMinimumXmr)*1000)/3);parts.push({name:'payout',weight:1,value:v,label:`${Number(payoutMinimumXmr)} XMR`});}
  const weight=parts.reduce((s,p)=>s+p.weight,0);const score=weight?100*parts.reduce((s,p)=>s+p.value*p.weight,0)/weight:null;
  return {score:score==null?null:Math.round(score),confidence:Math.min(1,parts.length/6),parts,missing:['availability','ping','fee','rejects','stability','payout'].filter(name=>!parts.some(p=>p.name===name))};
}
module.exports={scorePool};
