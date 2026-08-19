'use strict';
const crypto=require('crypto');
const {clamp,mean,stddev}=require('../lib/utils');
const Stats=require('./statistics');

function scoreProfile(metrics,objective='balanced'){
  const hash=Math.max(0,Number(metrics.hashrate||0));
  const watts=Number(metrics.watts||0); const hw=watts>0?hash/watts:0;
  const net=Number(metrics.netBrlDay||0); const temp=Number(metrics.tempC||0);
  const rejected=Number(metrics.rejectRate||0); const stability=clamp(Number(metrics.stability??1),0,1);
  const thermal=temp>0?clamp(1-Math.max(0,temp-65)/30,0,1):0.75;
  const rejectScore=clamp(1-rejected*20,0,1);
  const hNorm=hash/(hash+1000), eNorm=hw/(hw+12), pNorm=1/(1+Math.exp(-net/2));
  let score;
  if(objective==='performance')score=hNorm*0.85+stability*0.10+rejectScore*0.05;
  else if(objective==='efficiency')score=eNorm*0.70+stability*0.15+thermal*0.10+rejectScore*0.05;
  else if(objective==='profit')score=pNorm*0.70+stability*0.15+eNorm*0.10+rejectScore*0.05;
  else if(objective==='silent')score=thermal*0.30+eNorm*0.30+stability*0.25+(1-hNorm)*0.15;
  else score=hNorm*0.30+eNorm*0.25+pNorm*0.20+stability*0.15+thermal*0.07+rejectScore*0.03;
  return {score:clamp(score,0,1)*100,components:{hash:hNorm*100,efficiency:eNorm*100,profit:pNorm*100,stability:stability*100,thermal:thermal*100,reject:rejectScore*100}};
}

function invert(matrix){
  const n=matrix.length,a=matrix.map((r,i)=>[...r,...Array.from({length:n},(_,j)=>i===j?1:0)]);
  for(let i=0;i<n;i++){let pivot=i;for(let r=i+1;r<n;r++)if(Math.abs(a[r][i])>Math.abs(a[pivot][i]))pivot=r;[a[i],a[pivot]]=[a[pivot],a[i]];let d=a[i][i];if(Math.abs(d)<1e-10)return null;for(let j=0;j<2*n;j++)a[i][j]/=d;for(let r=0;r<n;r++){if(r===i)continue;const f=a[r][i];for(let j=0;j<2*n;j++)a[r][j]-=f*a[i][j];}}
  return a.map(r=>r.slice(n));
}
function dot(a,b){return a.reduce((s,v,i)=>s+v*b[i],0);}
function rbf(a,b,length=0.8){const d=a.reduce((s,v,i)=>s+(v-b[i])**2,0);return Math.exp(-d/(2*length*length));}
function features(config,maxThreads){return [Number(config.threads||1)/Math.max(1,maxThreads),Number(config.priority??3)/5,config.yield?1:0,Number(config.prefetch??1)/3];}
function gaussianProcessPredict(observations,candidates,maxThreads){
  if(observations.length<2)return candidates.map(c=>({config:c,mean:0.5,variance:1,ucb:1.5}));
  const X=observations.map(o=>features(o.config,maxThreads)),y=observations.map(o=>Number(o.score)/100);
  const K=X.map((x,i)=>X.map((z,j)=>rbf(x,z)+(i===j?0.03:0)));const inv=invert(K);if(!inv)return candidates.map(c=>({config:c,mean:mean(y),variance:1,ucb:mean(y)+1}));
  return candidates.map(c=>{const x=features(c,maxThreads),k=X.map(z=>rbf(x,z));const alpha=inv.map(r=>dot(r,y));const mu=dot(k,alpha);const v=inv.map(r=>dot(r,k));const variance=Math.max(0.001,1-dot(k,v));return {config:c,mean:mu,variance,ucb:mu+1.2*Math.sqrt(variance)};});
}
function candidateSpace(maxThreads,mode='balanced'){
  const out=[];for(let t=1;t<=maxThreads;t++){for(const priority of mode==='silent'?[1,2]:[2,3,4]){for(const yieldMode of [false,true])out.push({threads:t,priority,yield:yieldMode,prefetch:1});}}
  return out;
}
function nextBayesianCandidate(observations,maxThreads,mode='balanced'){
  const seen=new Set(observations.map(o=>JSON.stringify(o.config)));const candidates=candidateSpace(maxThreads,mode).filter(c=>!seen.has(JSON.stringify(c)));if(!candidates.length)return null;
  return gaussianProcessPredict(observations,candidates,maxThreads).sort((a,b)=>b.ucb-a.ucb)[0];
}
function banditChoice(profiles){
  const usable=profiles.filter(p=>p.pulls>0);if(!usable.length)return null;const total=usable.reduce((s,p)=>s+p.pulls,0);return usable.map(p=>({...p,ucb:Number(p.reward||0)+Math.sqrt(2*Math.log(Math.max(2,total))/p.pulls)})).sort((a,b)=>b.ucb-a.ucb)[0];
}
function confidence({samples=0,runtimeSec=0,hashrates=[]}){const st=Stats.stability(hashrates);return clamp(0.1+clamp(samples/120,0,1)*0.35+clamp(runtimeSec/7200,0,1)*0.25+st.score*0.30,0.05,0.97);}
function healthScore({mining=true,hashrates=[],rejectRate=0,tempC=null,hugePages=null,msr=null,poolOnline=true,restarts=0}){
  const parts=[];parts.push({name:'Miner',score:mining?100:0,reason:mining?'ativo':'parado'});const st=Stats.stability(hashrates);parts.push({name:'Hashrate',score:Math.round(st.score*100),reason:`CV ${(st.cv*100).toFixed(1)}%`});parts.push({name:'Shares',score:Math.round(clamp(1-rejectRate*20,0,1)*100),reason:`reject ${(rejectRate*100).toFixed(2)}%`});if(tempC!=null)parts.push({name:'Temperatura',score:Math.round(clamp(1-Math.max(0,tempC-65)/30,0,1)*100),reason:`${tempC.toFixed(1)}°C`});if(hugePages!=null)parts.push({name:'HugePages',score:hugePages?100:45,reason:hugePages?'ativo':'não confirmado'});if(msr!=null)parts.push({name:'MSR',score:msr?100:55,reason:msr?'ativo':'não confirmado'});parts.push({name:'Pool',score:poolOnline?100:0,reason:poolOnline?'online':'offline'});parts.push({name:'Recovery',score:Math.max(0,100-restarts*18),reason:`${restarts} reinícios`});return {score:Math.round(mean(parts.map(p=>p.score))),parts};
}
function detectAnomalies(current,history,{criticalTemp=85}={}){
  const alerts=[];const hashes=history.map(x=>Number(x.hash10||0)).filter(v=>v>0);if(current.hash10>0){const z=Stats.anomalyZ(current.hash10,hashes);if(z.anomaly&&z.z<0)alerts.push({severity:'warning',code:'HASHRATE_DROP',message:`Hashrate caiu fora do padrão (${z.z.toFixed(1)}σ)`,details:z});}
  if(current.tempC!=null&&current.tempC>=criticalTemp)alerts.push({severity:'critical',code:'THERMAL_CRITICAL',message:`Temperatura atingiu ${current.tempC.toFixed(1)}°C`,details:{criticalTemp}});
  if(current.rejectRate>0.05)alerts.push({severity:'warning',code:'REJECT_SPIKE',message:`Taxa de rejeição ${(current.rejectRate*100).toFixed(1)}%`});return alerts;
}
function makeProfile(name,kind,config,metrics,objective){const scored=scoreProfile(metrics,objective);return {id:`${kind}-${crypto.randomUUID()}`,name,kind,config,score:scored.score,confidence:metrics.confidence||0,stable:Boolean(metrics.stable),metrics,scored};}
module.exports={scoreProfile,gaussianProcessPredict,nextBayesianCandidate,candidateSpace,banditChoice,confidence,healthScore,detectAnomalies,makeProfile,features};
