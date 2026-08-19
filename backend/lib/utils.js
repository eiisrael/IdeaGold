'use strict';
const fs = require('fs');
const path = require('path');

function clamp(n, min, max) { n = Number(n); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
function maskWallet(value) { const s=String(value||''); return s.length>22 ? `${s.slice(0,10)}…${s.slice(-10)}` : s; }
function validXmrWallet(value) { const s=String(value||'').trim(); return /^[48][1-9A-HJ-NP-Za-km-z]{94}$/.test(s) || /^4[1-9A-HJ-NP-Za-km-z]{105}$/.test(s); }
function median(values) { const a=values.map(Number).filter(Number.isFinite).sort((x,y)=>x-y); if(!a.length) return 0; const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; }
function mean(values) { const a=values.map(Number).filter(Number.isFinite); return a.length?a.reduce((s,v)=>s+v,0)/a.length:0; }
function stddev(values) { const a=values.map(Number).filter(Number.isFinite); if(a.length<2)return 0; const m=mean(a); return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1)); }
function percentile(values,p){ const a=values.map(Number).filter(Number.isFinite).sort((x,y)=>x-y); if(!a.length)return 0; const idx=(a.length-1)*clamp(p,0,1); const lo=Math.floor(idx),hi=Math.ceil(idx); return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(idx-lo); }
function processAlive(pid){ if(!pid)return false; try{process.kill(Number(pid),0);return true;}catch{return false;} }
function iso(){ return new Date().toISOString(); }
function safeNumber(v, fallback=0){ const n=Number(v); return Number.isFinite(n)?n:fallback; }
function sourceValue(value, source, status='real') { return { value: Number.isFinite(Number(value)) ? Number(value) : null, source, status, at: Date.now() }; }
module.exports={clamp,sleep,readJson,writeJsonAtomic,maskWallet,validXmrWallet,median,mean,stddev,percentile,processAlive,iso,safeNumber,sourceValue};
