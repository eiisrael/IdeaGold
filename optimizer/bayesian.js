'use strict';
// Small Gaussian-process Bayesian optimizer for a low-dimensional, bounded config space.
// Intended for safe discrete miner settings, not arbitrary hardware voltage control.
function dot(a,b){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;}
function rbf(a,b,length=1,variance=1){let d=0;for(let i=0;i<a.length;i++)d+=(a[i]-b[i])**2;return variance*Math.exp(-d/(2*length*length));}
function cholesky(A){const n=A.length,L=Array.from({length:n},()=>Array(n).fill(0));for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let s=A[i][j];for(let k=0;k<j;k++)s-=L[i][k]*L[j][k];if(i===j){if(s<=1e-12)s=1e-12;L[i][j]=Math.sqrt(s);}else L[i][j]=s/L[j][j];}return L;}
function solveCholesky(L,b){const n=L.length,y=Array(n),x=Array(n);for(let i=0;i<n;i++){let s=b[i];for(let k=0;k<i;k++)s-=L[i][k]*y[k];y[i]=s/L[i][i];}for(let i=n-1;i>=0;i--){let s=y[i];for(let k=i+1;k<n;k++)s-=L[k][i]*x[k];x[i]=s/L[i][i];}return x;}
function erf(x){const sign=x<0?-1:1;x=Math.abs(x);const a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=.3275911,t=1/(1+p*x);const y=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);return sign*y;}
function phi(z){return Math.exp(-.5*z*z)/Math.sqrt(2*Math.PI);} function Phi(z){return .5*(1+erf(z/Math.sqrt(2)));}
class GaussianProcess{
  constructor({length=1,variance=1,noise=.03}={}){this.length=length;this.variance=variance;this.noise=noise;this.X=[];this.y=[];this.L=null;this.alpha=null;}
  fit(X,y){this.X=X.map(x=>x.map(Number));this.y=y.map(Number);if(!X.length){this.L=null;this.alpha=null;return this;}const K=X.map((a,i)=>X.map((b,j)=>rbf(a,b,this.length,this.variance)+(i===j?this.noise**2:0)));this.L=cholesky(K);this.alpha=solveCholesky(this.L,this.y);return this;}
  predict(x){if(!this.X.length)return {mean:0,variance:this.variance};const k=this.X.map(a=>rbf(a,x,this.length,this.variance));const mean=dot(k,this.alpha);const v=[];for(let i=0;i<this.L.length;i++){let s=k[i];for(let j=0;j<i;j++)s-=this.L[i][j]*v[j];v[i]=s/this.L[i][i];}return {mean,variance:Math.max(1e-9,rbf(x,x,this.length,this.variance)-dot(v,v))};}
}
function expectedImprovement(mean,variance,best,xi=.01){const sigma=Math.sqrt(Math.max(0,variance));if(sigma<1e-9)return 0;const imp=mean-best-xi,z=imp/sigma;return imp*Phi(z)+sigma*phi(z);}
function normalizeConfig(c,bounds){return bounds.map(([k,min,max])=>{const v=Number(c[k]);return max===min?0:(v-min)/(max-min);});}
function propose({observations=[],candidates=[],bounds,xi=.02}={}){
  const untested=candidates.filter(c=>!observations.some(o=>o.id===c.id));if(!observations.length)return {candidate:untested[0]||candidates[0]||null,reason:'baseline-required',acquisition:Infinity};
  if(!untested.length)return {candidate:null,reason:'all-candidates-tested',acquisition:0};
  const ys=observations.map(o=>Number(o.score));const ym=ys.reduce((s,x)=>s+x,0)/ys.length;const ysd=Math.sqrt(ys.reduce((s,x)=>s+(x-ym)**2,0)/Math.max(1,ys.length-1))||1;
  const yNorm=ys.map(y=>(y-ym)/ysd), X=observations.map(o=>normalizeConfig(o.config,bounds));const gp=new GaussianProcess({length:.45,variance:1,noise:.05}).fit(X,yNorm);const best=Math.max(...yNorm);
  let chosen=null;for(const c of untested){const pred=gp.predict(normalizeConfig(c.config,bounds));const ei=expectedImprovement(pred.mean,pred.variance,best,xi);if(!chosen||ei>chosen.acquisition)chosen={candidate:c,acquisition:ei,predictedScore:pred.mean*ysd+ym,predictedStd:Math.sqrt(pred.variance)*ysd,reason:'gaussian-process expected-improvement'};}
  return chosen;
}
module.exports={rbf,cholesky,solveCholesky,GaussianProcess,expectedImprovement,normalizeConfig,propose};
