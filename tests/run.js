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
const {telemetrySsePayload,isTelemetrySsePayload}=require('../backend/contracts');
const {insideWindow}=require('../optimizer/scheduler-engine');
const {LocalMLPredictor}=require('../optimizer/ml-predictor');
const {chooseSensors}=require('../providers/hardware/libre-hardware-monitor');
const {PowerProvider}=require('../providers/power/power-provider');
const {sanitize}=require('../observability/logger');

let passed=0;
function test(name,fn){try{fn();passed++;console.log(`OK ${name}`);}catch(e){console.error(`FAIL ${name}`);throw e;}}
function approx(actual,expected,tolerance=Math.max(1e-15,Math.abs(expected)*1e-12)){assert(Math.abs(actual-expected)<=tolerance,`${actual} ≉ ${expected}`);}

test('estatística robusta remove outlier',()=>{assert.deepStrictEqual(S.rejectOutliers([100,101,99,100,10000]),[100,101,99,100]);});
test('intervalo exponencial é probabilístico',()=>{const x=S.exponentialInterval(1/600,.8);assert(x.available);assert(x.lowSec<x.meanSec);assert(x.highSec>x.meanSec);});
test('custo energia 100W 24h',()=>{const e=P.energyCost(100,1,86400);approx(e.kwh,2.4);approx(e.brl,2.4);});
test('profit engine calcula break-even',()=>{const x=P.economics({xmrPerSec:1e-8,priceBrl:2000,powerW:100,electricityBrlKWh:.9,hashrate:1000,difficulty:1e12,reward:.6,poolFeePct:0});assert(x.available);assert(x.rows.day.netBrl<x.rows.day.revenueBrl);assert(Number.isFinite(x.breakEven.electricityBrlKWh));});
test('config é bounded e pause-on-battery é opt-in',()=>{const c=normalizeConfig({threads:999,priority:99,scratchpadPrefetch:9});assert.equal(c.threads,256);assert.equal(c.priority,5);assert.equal(c.scratchpadPrefetch,1);assert.equal(c.pauseOnBattery,false);assert.equal(c.gpuMode,'off');});
test('settings detecta i5-4670K e limita threads',()=>{const d=defaults({logicalThreads:4,cpuModel:'Intel(R) Core(TM) i5-4670K CPU @ 3.40GHz'});assert.equal(d.profile.threads,3);assert.equal(d.logicalThreads,4);assert.equal(d.scheduler.enabled,false);});
test('settings funciona com cpuModel ausente',()=>{const d=defaults({logicalThreads:4});assert(d.profile.threads>=1&&d.profile.threads<=4);});
test('SSE telemetry entrega amostra e não status aninhado',()=>{const sample={ts:Date.now(),state:'mining',miner:{apiConnected:true},hash10s:950};const payload=telemetrySsePayload(sample);assert.strictEqual(payload,sample);assert.equal(isTelemetrySsePayload(payload),true);assert.equal(isTelemetrySsePayload({ts:sample.ts,state:'mining',telemetry:sample}),false);});
test('safety rejeita threads acima do hardware',()=>{const s=new SafetyEngine();assert.equal(s.validateCandidate({threads:5,priority:3,randomxMode:'fast'},{logicalThreads:4}).ok,false);});
test('pool score explicita ausência',()=>{const s=scorePool({available:true,latencyMs:30,feePct:0});assert(s.score>0);assert(s.missing.includes('rejects'));});
test('Bayesian optimizer sugere candidato não testado',()=>{const gp=new GaussianProcessOptimizer({threads:{min:1,max:4}});const a={threads:1,priority:3,yield:true,hugePages:true,hugePagesJit:true,numa:true,scratchpadPrefetch:1},b={...a,threads:2},c={...a,threads:3};const r=gp.suggest([{config:a,value:1},{config:b,value:2}],[a,b,c]);assert.equal(r.config.threads,3);});
test('safe candidates respeitam logical threads',()=>{const c=generateSafeCandidates({logicalThreads:4,current:{}});assert(Math.max(...c.map(x=>x.threads))===4);assert(Math.min(...c.map(x=>x.threads))===1);});
test('quantum dinâmico não é valor fixo',()=>{approx(niceQuantum(0.0000017),0.000002);approx(niceQuantum(0.000007),0.00001);assert.notEqual(niceQuantum(0.0000017),niceQuantum(0.000007));});
test('taxa observada usa crescimento do pool',()=>{const t=Date.now();const r=slopeRate([{ts:t,totalPoolXmr:1},{ts:t+1000,totalPoolXmr:1.001},{ts:t+2000,totalPoolXmr:1.002}]);approx(r.rate,.001,1e-8);});
test('scheduler entende janela normal e atravessando meia-noite',()=>{assert(insideWindow(new Date(2026,0,1,12,0),'08:00','18:00'));assert(!insideWindow(new Date(2026,0,1,22,0),'08:00','18:00'));assert(insideWindow(new Date(2026,0,1,23,0),'22:00','06:00'));assert(insideWindow(new Date(2026,0,1,5,0),'22:00','06:00'));});
test('ML local só ativa após dataset mínimo e produz predição',()=>{const ml=new LocalMLPredictor({minSamples:4,lambda:.1});const rows=[1,2,3,4].map(t=>({config:{threads:t,priority:3,yield:true,hugePages:true,hugePagesJit:true,numa:true,scratchpadPrefetch:1,gpuMode:'off'},value:t*100}));assert.equal(ml.fit(rows.slice(0,3)).ready,false);assert.equal(ml.fit(rows).ready,true);assert(Number.isFinite(ml.predict({...rows[0].config,threads:3})));});
test('LibreHardwareMonitor escolhe sensores relevantes',()=>{const r=chooseSensors([{Hardware:'Intel CPU',Name:'CPU Package',SensorType:'Temperature',Value:62},{Hardware:'Intel CPU',Name:'CPU Package',SensorType:'Power',Value:45},{Hardware:'AMD Radeon',Name:'GPU Core',SensorType:'Temperature',Value:58},{Hardware:'AMD Radeon',Name:'GPU Power',SensorType:'Power',Value:39}]);assert.equal(r.cpuPackageC,62);assert.equal(r.gpuC,58);assert.equal(r.componentPowerW,84);});
test('power provider prioriza wattímetro e rotula híbrido sem fingir tomada',()=>{const measured=new PowerProvider({measuredPowerWatts:123,logicalThreads:4}).sample({mining:true,hardwareSample:{componentPowerW:50},profile:{threads:3}});assert.equal(measured.kind,'measured');assert.equal(measured.watts,123);const hybrid=new PowerProvider({measuredPowerWatts:0,basePowerWatts:25,logicalThreads:4}).sample({mining:true,hardwareSample:{componentPowerW:60},profile:{threads:3}});assert.equal(hybrid.kind,'hybrid');assert.equal(hybrid.watts,85);});
test('logger sanitiza segredo e mascara carteira',()=>{const wallet='4'+'A'.repeat(94);const x=sanitize({password:'abc',wallet,message:`carteira ${wallet}`});assert.equal(x.password,'[redacted]');assert.notEqual(x.wallet,wallet);assert(!x.message.includes(wallet));});
test('SQLite persiste settings/profiles/decisions',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ideagold-test-'));const db=new IdeaGoldDB(dir);try{db.setSetting('x',{a:1});assert.equal(db.getSetting('x').a,1);db.saveProfile({id:'p',name:'P',objective:'balanced',config:{threads:3}});assert.equal(db.listProfiles().length,1);db.addDecision({action:'TEST',reason:'unit'});assert.equal(db.listDecisions().length,1);}finally{db.db.close();fs.rmSync(dir,{recursive:true,force:true});}});
console.log(`\nIdeaGold 5.1 tests: ${passed} OK`);
