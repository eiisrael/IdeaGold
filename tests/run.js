'use strict';
const assert=require('assert');
const os=require('os');
const fs=require('fs');
const path=require('path');
const S=require('../optimizer/statistics');
const P=require('../optimizer/profit-engine');
const {GaussianProcessOptimizer,generateSafeCandidates}=require('../optimizer/bayesian-optimizer');
const {SafetyEngine}=require('../optimizer/safety-engine');
const {scorePool}=require('../providers/pool/score');
const {normalizeConfig}=require('../miner/config-manager');
const {IdeaGoldDB}=require('../database/db');
const {niceQuantum,slopeRate}=require('../telemetry/engine');
const {defaults}=require('../backend/settings');

let passed=0;
function test(name,fn){try{fn();passed++;console.log(`OK ${name}`);}catch(e){console.error(`FAIL ${name}`);throw e;}}
function approx(actual,expected,tolerance=Math.max(1e-15,Math.abs(expected)*1e-12)){assert(Math.abs(actual-expected)<=tolerance,`${actual} ≉ ${expected}`);}

test('estatística robusta remove outlier',()=>{assert.deepStrictEqual(S.rejectOutliers([100,101,99,100,10000]),[100,101,99,100]);});
test('intervalo exponencial é probabilístico',()=>{const x=S.exponentialInterval(1/600,.8);assert(x.available);assert(x.lowSec<x.meanSec);assert(x.highSec>x.meanSec);});
test('custo energia 100W 24h',()=>{const e=P.energyCost(100,1,86400);approx(e.kwh,2.4);approx(e.brl,2.4);});
test('profit engine calcula break-even',()=>{const x=P.economics({xmrPerSec:1e-8,priceBrl:2000,powerW:100,electricityBrlKWh:.9,hashrate:1000,difficulty:1e12,reward:.6,poolFeePct:0});assert(x.available);assert(x.rows.day.netBrl<x.rows.day.revenueBrl);assert(Number.isFinite(x.breakEven.electricityBrlKWh));});
test('config é bounded',()=>{const c=normalizeConfig({threads:999,priority:99,scratchpadPrefetch:9});assert.equal(c.threads,256);assert.equal(c.priority,5);assert.equal(c.scratchpadPrefetch,1);});
test('settings detecta i5-4670K e limita threads',()=>{const d=defaults({logicalThreads:4,cpuModel:'Intel(R) Core(TM) i5-4670K CPU @ 3.40GHz'});assert.equal(d.profile.threads,3);assert.equal(d.logicalThreads,4);});
test('settings funciona com cpuModel ausente',()=>{const d=defaults({logicalThreads:4});assert(d.profile.threads>=1&&d.profile.threads<=4);});
test('safety rejeita threads acima do hardware',()=>{const s=new SafetyEngine();assert.equal(s.validateCandidate({threads:5,priority:3,randomxMode:'fast'},{logicalThreads:4}).ok,false);});
test('pool score explicita ausência',()=>{const s=scorePool({available:true,latencyMs:30,feePct:0});assert(s.score>0);assert(s.missing.includes('rejects'));});
test('Bayesian optimizer sugere candidato não testado',()=>{const gp=new GaussianProcessOptimizer({threads:{min:1,max:4}});const a={threads:1,priority:3,yield:true,hugePages:true,hugePagesJit:true,numa:true,scratchpadPrefetch:1},b={...a,threads:2},c={...a,threads:3};const r=gp.suggest([{config:a,value:1},{config:b,value:2}],[a,b,c]);assert.equal(r.config.threads,3);});
test('safe candidates respeitam logical threads',()=>{const c=generateSafeCandidates({logicalThreads:4,current:{}});assert(Math.max(...c.map(x=>x.threads))===4);assert(Math.min(...c.map(x=>x.threads))===1);});
test('quantum dinâmico não é valor fixo',()=>{approx(niceQuantum(0.0000017),0.000002);approx(niceQuantum(0.000007),0.00001);assert.notEqual(niceQuantum(0.0000017),niceQuantum(0.000007));});
test('taxa observada usa crescimento do pool',()=>{const t=Date.now();const r=slopeRate([{ts:t,totalPoolXmr:1},{ts:t+1000,totalPoolXmr:1.001},{ts:t+2000,totalPoolXmr:1.002}]);approx(r.rate,.001,1e-8);});
test('SQLite persiste settings/profiles/decisions',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ideagold-test-'));const db=new IdeaGoldDB(dir);try{db.setSetting('x',{a:1});assert.equal(db.getSetting('x').a,1);db.saveProfile({id:'p',name:'P',objective:'balanced',config:{threads:3}});assert.equal(db.listProfiles().length,1);db.addDecision({action:'TEST',reason:'unit'});assert.equal(db.listDecisions().length,1);}finally{db.db.close();fs.rmSync(dir,{recursive:true,force:true});}});
console.log(`\nIdeaGold 5.0 tests: ${passed} OK`);
