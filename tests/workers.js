'use strict';

const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {IdeaGoldDB}=require('../database/db');
const {WorkerStore}=require('../database/workers');
const {signWorkerPayload,verifyWorkerSignature,normalizeWorkerPayload}=require('../backend/worker-auth');

let passed=0;
function test(name,fn){try{fn();passed++;console.log(`OK ${name}`);}catch(error){console.error(`FAIL ${name}`);throw error;}}

const secret='0123456789abcdef0123456789abcdef';
test('worker HMAC válido é aceito',()=>{
  const timestamp=String(Date.now()),raw='{"id":"rig-01","hashrate":1000}',signature=signWorkerPayload(secret,timestamp,raw);
  assert.equal(verifyWorkerSignature({secret,timestamp,rawBody:raw,signature}).ok,true);
});
test('worker HMAC adulterado é rejeitado',()=>{
  const timestamp=String(Date.now()),raw='{"id":"rig-01","hashrate":1000}',signature=signWorkerPayload(secret,timestamp,raw);
  assert.equal(verifyWorkerSignature({secret,timestamp,rawBody:raw+' ',signature}).ok,false);
});
test('worker timestamp antigo é rejeitado',()=>{
  const timestamp=String(Date.now()-600000),raw='{}',signature=signWorkerPayload(secret,timestamp,raw);
  assert.equal(verifyWorkerSignature({secret,timestamp,rawBody:raw,signature}).ok,false);
});
test('worker payload é limitado e normalizado',()=>{
  const w=normalizeWorkerPayload({id:'rig 01!?',name:'Teste',hashrate:-10,powerWatts:999999,electricity:-1,backends:[{type:'cpu',hashrate:123}]});
  assert.equal(w.id,'rig-01--');assert.equal(w.hashrate,0);assert.equal(w.powerWatts,100000);assert.equal(w.electricityBrlKWh,0);assert.equal(w.backends.length,1);
});
test('worker SQLite persiste heartbeat e calcula resumo online',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ideagold-worker-'));const db=new IdeaGoldDB(dir);
  try{
    const store=new WorkerStore(db);store.upsert(normalizeWorkerPayload({id:'rig-1',name:'Rig 1',hashrate:1500,powerWatts:90,cloudCostBrlDay:2}),'127.0.0.1');
    const row=store.get('rig-1');assert(row);assert.equal(row.online,true);assert.equal(row.hashrate,1500);
    const sum=store.summary();assert.equal(sum.online,1);assert.equal(sum.totalHashrate,1500);assert.equal(sum.powerWattsReported,90);assert.equal(sum.cloudCostBrlDay,2);
  }finally{db.db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

console.log(`\nIdeaGold worker tests: ${passed} OK`);
