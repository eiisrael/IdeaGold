'use strict';

// Small Gaussian-process optimizer for a discrete, safety-bounded XMRig search space.
// No external ML dependency. It is used only after measured benchmark observations exist.

function erf(x){
  const sign=x<0?-1:1; x=Math.abs(x);
  const a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=.3275911;
  const t=1/(1+p*x); const y=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x); return sign*y;
}
function normalPdf(x){return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI);}
function normalCdf(x){return .5*(1+erf(x/Math.sqrt(2)));}
function rbf(a,b,length=1){let s=0;for(let i=0;i<a.length;i++)s+=(a[i]-b[i])**2;return Math.exp(-s/(2*length*length));}
function identity(n){return Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?1:0));}
function invert(matrix){
  const n=matrix.length; if(!n)return [];
  const a=matrix.map((r,i)=>[...r,...identity(n)[i]]);
  for(let i=0;i<n;i++){
    let pivot=i; for(let r=i+1;r<n;r++)if(Math.abs(a[r][i])>Math.abs(a[pivot][i]))pivot=r;
    if(Math.abs(a[pivot][i])<1e-12)throw new Error('GP matrix singular');
    [a[i],a[pivot]]=[a[pivot],a[i]];
    const d=a[i][i]; for(let c=0;c<2*n;c++)a[i][c]/=d;
    for(let r=0;r<n;r++)if(r!==i){const f=a[r][i];for(let c=0;c<2*n;c++)a[r][c]-=f*a[i][c];}
  }
  return a.map(r=>r.slice(n));
}
function matVec(m,v){return m.map(r=>r.reduce((s,x,i)=>s+x*v[i],0));}
function dot(a,b){return a.reduce((s,x,i)=>s+x*b[i],0);}

function encode(config, bounds){
  const scale=(v,min,max)=>max>min?(Number(v)-min)/(max-min):0;
  return [
    scale(config.threads,bounds.threads.min,bounds.threads.max),
    scale(config.priority??3,0,5),
    config.yield===false?0:1,
    config.hugePages===false?0:1,
    config.hugePagesJit===false?0:1,
    config.numa===false?0:1,
    scale(config.scratchpadPrefetch??1,0,3)
  ];
}

class GaussianProcessOptimizer {
  constructor(bounds, options={}){
    this.bounds=bounds;
    this.noise=Number(options.noise||1e-4);
    this.length=Number(options.length||.65);
    this.xi=Number(options.xi||.01);
  }
  fit(observations){
    const obs=(observations||[]).filter(o=>Number.isFinite(Number(o.value)));
    if(obs.length<2)return null;
    const X=obs.map(o=>encode(o.config,this.bounds));
    const y=obs.map(o=>Number(o.value));
    const ym=y.reduce((a,b)=>a+b,0)/y.length;
    const ys=Math.sqrt(y.reduce((s,v)=>s+(v-ym)**2,0)/Math.max(1,y.length-1))||1;
    const yn=y.map(v=>(v-ym)/ys);
    const K=X.map((a,i)=>X.map((b,j)=>rbf(a,b,this.length)+(i===j?this.noise:0)));
    let inv; try{inv=invert(K);}catch{return null;}
    return {X,yn,ym,ys,inv,best:Math.max(...yn)};
  }
  predict(model,config){
    if(!model)return {mean:null,std:null};
    const x=encode(config,this.bounds);
    const k=model.X.map(xi=>rbf(xi,x,this.length));
    const alpha=matVec(model.inv,model.yn);
    const meanN=dot(k,alpha);
    const v=matVec(model.inv,k);
    const varN=Math.max(1e-9,1-dot(k,v));
    return {mean:meanN*model.ys+model.ym,std:Math.sqrt(varN)*model.ys,meanN,stdN:Math.sqrt(varN)};
  }
  expectedImprovement(model,config){
    const p=this.predict(model,config); if(p.meanN==null||p.stdN<=1e-9)return 0;
    const improvement=p.meanN-model.best-this.xi;
    const z=improvement/p.stdN;
    return Math.max(0,improvement*normalCdf(z)+p.stdN*normalPdf(z));
  }
  suggest(observations,candidates){
    const model=this.fit(observations);
    const tested=new Set((observations||[]).map(o=>JSON.stringify(o.config)));
    const remaining=(candidates||[]).filter(c=>!tested.has(JSON.stringify(c)));
    if(!remaining.length)return null;
    if(!model)return remaining[0];
    return remaining.map(config=>({config,ei:this.expectedImprovement(model,config),prediction:this.predict(model,config)})).sort((a,b)=>b.ei-a.ei)[0];
  }
}

function generateSafeCandidates({logicalThreads=4,current={}}={}){
  const max=Math.max(1,Math.min(64,Number(logicalThreads)||1));
  const candidates=[];
  for(let threads=1;threads<=max;threads++){
    for(const priority of [2,3,4]){
      for(const yieldMode of [true,false]){
        candidates.push({
          ...current,
          threads, priority, yield:yieldMode,
          hugePages:true, hugePagesJit:true, rdmsr:true, wrmsr:true, numa:true,
          randomxMode:'fast', scratchpadPrefetch:1
        });
      }
    }
  }
  return candidates;
}

module.exports={GaussianProcessOptimizer,generateSafeCandidates,encode,rbf};
