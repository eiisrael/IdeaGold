'use strict';

const {spawn}=require('child_process');
const path=require('path');
const {signWorkerPayload}=require('../backend/worker-auth');

const PORT=18081;
const HOST='127.0.0.1';
const SECRET='0123456789abcdef0123456789abcdef';
const root=path.resolve(__dirname,'..');
const child=spawn(process.execPath,[path.join(root,'backend','server.js')],{
  cwd:root,
  env:{...process.env,HOST,PORT:String(PORT),WORKER_SHARED_SECRET:SECRET},
  stdio:['ignore','pipe','pipe'],
  windowsHide:true
});

let output='';
child.stdout.on('data',d=>{output+=d.toString();});
child.stderr.on('data',d=>{output+=d.toString();});
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function stop(){if(child.exitCode==null)child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(3000)]);}

async function validateRuntime(){
  const health=await fetch(`http://${HOST}:${PORT}/api/health`,{signal:AbortSignal.timeout(1500)});
  if(!health.ok)throw new Error(`Health HTTP ${health.status}`);
  const body=await health.json();
  if(body?.ok!==true||body?.version!=='5.0.0')throw new Error(`Health respondeu conteúdo inesperado: ${JSON.stringify(body)}`);

  const raw=JSON.stringify({id:'smoke-rig',name:'Smoke Rig',coin:'XMR',algo:'rx/0',hashrate:1234,hashrate60s:1200,hashrate15m:1180,accepted:2,rejected:0,uptime:60,pool:'127.0.0.1',minerVersion:'test',host:'ci',powerWatts:80,electricity:.9,cloudCostBrlDay:0,backends:[{type:'cpu',hashrate:1234,enabled:true}]});
  const timestamp=String(Date.now()),signature=signWorkerPayload(SECRET,timestamp,raw);
  const heartbeat=await fetch(`http://${HOST}:${PORT}/api/workers/heartbeat`,{method:'POST',headers:{'content-type':'application/json','x-ideagold-timestamp':timestamp,'x-ideagold-signature':signature},body:raw,signal:AbortSignal.timeout(2000)});
  if(!heartbeat.ok)throw new Error(`Worker heartbeat HTTP ${heartbeat.status}: ${await heartbeat.text()}`);
  const registry=await fetch(`http://${HOST}:${PORT}/api/workers`,{signal:AbortSignal.timeout(1500)}).then(r=>r.json());
  if(registry?.summary?.online!==1||registry?.workers?.[0]?.id!=='smoke-rig')throw new Error(`Worker registry inesperado: ${JSON.stringify(registry)}`);
  console.log(`OK smoke backend: ${body.name} ${body.version} + worker HMAC/SQLite`);
}

(async()=>{
  const deadline=Date.now()+20000;let lastError=null;
  try{
    while(Date.now()<deadline){
      if(child.exitCode!=null)throw new Error(`Backend encerrou antes do health check (code ${child.exitCode}).\n${output}`);
      try{await validateRuntime();return;}catch(error){lastError=error;}
      await sleep(500);
    }
    throw new Error(`Backend não ficou saudável em 20s: ${lastError?.message||'sem resposta'}\n${output}`);
  }finally{await stop();}
})().catch(error=>{console.error(error.stack||error.message||error);process.exitCode=1;});
