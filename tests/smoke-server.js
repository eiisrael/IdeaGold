'use strict';

const {spawn}=require('child_process');
const path=require('path');
const {signWorkerPayload}=require('../backend/worker-auth');

const PORT=18081;
const HOST='127.0.0.1';
const SECRET='0123456789abcdef0123456789abcdef';
const root=path.resolve(__dirname,'..');
const child=spawn(process.execPath,[path.join(root,'backend','server.js')],{cwd:root,env:{...process.env,HOST,PORT:String(PORT),WORKER_SHARED_SECRET:SECRET},stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='';child.stdout.on('data',d=>{output+=d.toString();});child.stderr.on('data',d=>{output+=d.toString();});
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function stop(){if(child.exitCode==null)child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(3000)]);}

async function validateRuntime(){
  const base=`http://${HOST}:${PORT}`;
  const health=await fetch(`${base}/api/health`,{signal:AbortSignal.timeout(2000)});if(!health.ok)throw new Error(`Health HTTP ${health.status}`);const body=await health.json();if(body?.ok!==true||body?.version!=='5.1.0'||body?.observability!==true)throw new Error(`Health inesperado: ${JSON.stringify(body)}`);
  const wallet='4'+'A'.repeat(94);
  const set=await fetch(`${base}/api/settings`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({wallet,electricityBrlKWh:.9,scheduler:{enabled:false,start:'22:00',stop:'06:00'},profile:{pauseOnBattery:false,gpuMode:'off'}}),signal:AbortSignal.timeout(2500)});if(!set.ok)throw new Error(`Settings HTTP ${set.status}: ${await set.text()}`);
  const status=await fetch(`${base}/api/status`,{signal:AbortSignal.timeout(2000)}).then(r=>r.json());if(status?.settings?.wallet!==wallet)throw new Error('Status local não preservou a carteira pública completa para a UI.');if(status?.settings?.profile?.pauseOnBattery!==false)throw new Error('pauseOnBattery não permaneceu opt-in.');if(status?.scheduler?.enabled!==false)throw new Error('Scheduler deveria iniciar desligado.');
  const raw=JSON.stringify({id:'smoke-rig',name:'Smoke Rig',coin:'XMR',algo:'rx/0',hashrate:1234,hashrate60s:1200,hashrate15m:1180,accepted:2,rejected:0,uptime:60,pool:'127.0.0.1',minerVersion:'test',host:'ci',powerWatts:80,electricity:.9,cloudCostBrlDay:0,backends:[{type:'cpu',hashrate:1234,enabled:true}]});const timestamp=String(Date.now()),signature=signWorkerPayload(SECRET,timestamp,raw);
  const heartbeat=await fetch(`${base}/api/workers/heartbeat`,{method:'POST',headers:{'content-type':'application/json','x-ideagold-timestamp':timestamp,'x-ideagold-signature':signature},body:raw,signal:AbortSignal.timeout(2500)});if(!heartbeat.ok)throw new Error(`Worker heartbeat HTTP ${heartbeat.status}: ${await heartbeat.text()}`);const registry=await fetch(`${base}/api/workers`,{signal:AbortSignal.timeout(2000)}).then(r=>r.json());if(registry?.summary?.online!==1||registry?.workers?.[0]?.id!=='smoke-rig')throw new Error(`Worker registry inesperado: ${JSON.stringify(registry)}`);
  await fetch(`${base}/api/client-log`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'smoke',message:'frontend smoke event'}),signal:AbortSignal.timeout(2000)});
  const logs=await fetch(`${base}/api/logs?kind=system`,{signal:AbortSignal.timeout(2000)}).then(r=>r.json());if(!String(logs.text||'').includes('frontend smoke event'))throw new Error('System Log não registrou evento do frontend.');
  const diag=await fetch(`${base}/api/diagnostics`,{signal:AbortSignal.timeout(3000)}).then(r=>r.json());if(diag.version!=='5.1.0'||!Array.isArray(diag.structuredLogs))throw new Error('Bundle de diagnóstico incompleto.');if(JSON.stringify(diag).includes(wallet))throw new Error('Diagnóstico vazou carteira completa sem máscara.');
  console.log(`OK smoke backend: ${body.name} ${body.version} + observability/diagnostics + settings + worker HMAC/SQLite`);
}

(async()=>{const deadline=Date.now()+25000;let lastError=null;try{while(Date.now()<deadline){if(child.exitCode!=null)throw new Error(`Backend encerrou antes do health check (code ${child.exitCode}).\n${output}`);try{await validateRuntime();return;}catch(error){lastError=error;}await sleep(500);}throw new Error(`Backend não ficou saudável em 25s: ${lastError?.message||'sem resposta'}\n${output}`);}finally{await stop();}})().catch(error=>{console.error(error.stack||error.message||error);process.exitCode=1;});
