'use strict';

const assert=require('assert');
const {restartHistoryForStart}=require('../miner/xmrig-controller');
const {BenchmarkEngine}=require('../optimizer/benchmark-engine');

let passed=0;
async function test(name,fn){try{await fn();passed++;console.log(`OK ${name}`);}catch(error){console.error(`FAIL ${name}`);throw error;}}

(async()=>{
  await test('watchdog preserva histórico em reinício automático',async()=>{
    const history=[Date.now()-1000,Date.now()-2000];
    assert.deepStrictEqual(restartHistoryForStart({restartTimes:history},'watchdog'),history);
    assert.deepStrictEqual(restartHistoryForStart({restartTimes:history},'user'),[]);
  });

  await test('benchmark cancelado restaura perfil anterior',async()=>{
    const previous={threads:3,priority:3,randomxMode:'fast'};
    const calls=[];
    const controller={
      state:()=>({processRunning:true,profile:previous}),
      restart:async(ctx,reason)=>{calls.push({profile:ctx.profile,reason});return{processRunning:true,profile:ctx.profile};},
      stop:()=>{throw new Error('não deveria parar um minerador que estava rodando');}
    };
    const safety={validateCandidate:()=>({ok:true,errors:[]}),compare:()=>({safe:true,reason:'ok'})};
    const db={addBenchmark:()=>{}};
    const engine=new BenchmarkEngine({db,controller,safety,hardwareFingerprint:'test',getContext:()=>({hardware:{logicalThreads:4},profile:previous}),getSample:async()=>({localHashrate:1000,powerW:80,powerKind:'estimated',temperatureC:null,accepted:0,rejected:0,poolFresh:false,profitBrlDay:null})});
    const promise=engine.runCandidate({threads:2,priority:3,randomxMode:'fast'},{warmupSec:0,sampleSec:10}).then(()=>{throw new Error('benchmark deveria ter sido cancelado');},error=>error);
    setTimeout(()=>engine.cancel(),30);
    const error=await promise;
    assert(String(error.message).startsWith('benchmark-cancelled'));
    assert(calls.length>=2,'deveria aplicar candidato e restaurar perfil');
    assert.deepStrictEqual(calls.at(-1).profile,previous);
    assert.equal(calls.at(-1).reason,'benchmark-error-rollback');
  });

  console.log(`\nIdeaGold runtime safety tests: ${passed} OK`);
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
