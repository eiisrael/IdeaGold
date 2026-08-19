'use strict';

function features(c={}){
  return [1,Number(c.threads||1),Number(c.priority??3),c.yield===false?0:1,c.hugePages===false?0:1,c.hugePagesJit===false?0:1,c.numa===false?0:1,Number(c.scratchpadPrefetch??1),c.randomxMode==='light'?1:0,c.randomxMode==='auto'?1:0,c.gpuMode==='on'?1:0];
}
function transpose(a){return a[0].map((_,i)=>a.map(r=>r[i]));}
function multiply(a,b){return a.map(r=>b[0].map((_,j)=>r.reduce((s,v,k)=>s+v*b[k][j],0)));}
function inverse(a){const n=a.length,m=a.map((r,i)=>[...r,...Array.from({length:n},(_,j)=>i===j?1:0)]);for(let i=0;i<n;i++){let p=i;for(let r=i+1;r<n;r++)if(Math.abs(m[r][i])>Math.abs(m[p][i]))p=r;[m[i],m[p]]=[m[p],m[i]];let d=m[i][i];if(Math.abs(d)<1e-12)return null;for(let j=0;j<2*n;j++)m[i][j]/=d;for(let r=0;r<n;r++){if(r===i)continue;const f=m[r][i];for(let j=0;j<2*n;j++)m[r][j]-=f*m[i][j];}}return m.map(r=>r.slice(n));}
function dot(a,b){return a.reduce((s,v,i)=>s+v*b[i],0);}

class LocalMLPredictor{
  constructor({minSamples=8,lambda=1}={}){this.minSamples=minSamples;this.lambda=lambda;this.model=null;this.stats={ready:false,samples:0,unique:0,mae:null,r2:null,trainedAt:null};}
  signature(c){return JSON.stringify(features(c));}
  fit(rows=[]){
    const usable=rows.filter(r=>r?.config&&Number.isFinite(Number(r.value)));const unique=new Map();for(const r of usable)unique.set(this.signature(r.config),r);const data=[...unique.values()];this.stats={...this.stats,samples:usable.length,unique:data.length,ready:false};if(data.length<this.minSamples){this.model=null;return this.status();}
    const X=data.map(r=>features(r.config)),y=data.map(r=>[Number(r.value)]),Xt=transpose(X),XtX=multiply(Xt,X);for(let i=1;i<XtX.length;i++)XtX[i][i]+=this.lambda;const inv=inverse(XtX);if(!inv){this.model=null;return this.status();}const beta=multiply(multiply(inv,Xt),y).map(r=>r[0]);const pred=X.map(x=>dot(x,beta)),mean=y.reduce((a,b)=>a+b[0],0)/y.length,mae=pred.reduce((s,p,i)=>s+Math.abs(p-y[i][0]),0)/pred.length,ssRes=pred.reduce((s,p,i)=>s+(p-y[i][0])**2,0),ssTot=y.reduce((s,v)=>s+(v[0]-mean)**2,0),r2=ssTot>0?1-ssRes/ssTot:null;this.model={beta};this.stats={ready:true,samples:usable.length,unique:data.length,mae,r2,trainedAt:Date.now(),algorithm:'ridge-regression-local'};return this.status();
  }
  predict(config){if(!this.model)return null;return dot(features(config),this.model.beta);}
  rank(candidates=[]){if(!this.model)return[];return candidates.map(config=>({config,prediction:this.predict(config)})).filter(x=>Number.isFinite(x.prediction)).sort((a,b)=>b.prediction-a.prediction);}
  status(){return{...this.stats,needed:Math.max(0,this.minSamples-(this.stats.unique||0)),algorithm:'ridge regression local',note:this.stats.ready?'Modelo treinado apenas com benchmarks reais deste hardware.':'Coletando benchmarks; ML não decide antes do dataset mínimo.'};}
}
module.exports={LocalMLPredictor,features,inverse};
