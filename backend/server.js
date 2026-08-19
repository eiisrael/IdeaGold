'use strict';

const http=require('http');
const fs=require('fs');
const path=require('path');
const os=require('os');
const {IdeaGoldDB}=require('../database/db');
const {WorkerStore}=require('../database/workers');
const {ConfigManager}=require('../miner/config-manager');
const {XMRigController}=require('../miner/xmrig-controller');
const {SystemHardwareProvider}=require('../providers/hardware/system-provider');
const {PowerProvider}=require('../providers/power/power-provider');
const {XmrMarketProvider}=require('../providers/market/xmr-market');
const {PoolRegistry}=require('../providers/pool');
const {scorePool}=require('../providers/pool/score');
const {SettingsStore}=require('./settings');
const {verifyWorkerSignature,normalizeWorkerPayload}=require('./worker-auth');
const {TelemetryEngine}=require('../telemetry/engine');
const {AnomalyDetector}=require('../optimizer/anomaly-detector');
const {SafetyEngine}=require('../optimizer/safety-engine');
const {BenchmarkEngine}=require('../optimizer/benchmark-engine');
const {SupremeMind}=require('../optimizer/supreme-mind');
const Profit=require('../optimizer/profit-engine');

const VERSION='5.0.0';
const ROOT=path.resolve(__dirname,'..');
const FRONTEND=path.join(ROOT,'frontend');
loadEnv();
const HOST=process.env.HOST||'127.0.0.1';
const PORT=Number(process.env.PORT||8080);

const db=new IdeaGoldDB(ROOT);
const workers=new WorkerStore(db);
const hardware=new SystemHardwareProvider();
const hardwareStatic=hardware.staticInfo();
const settingsStore=new SettingsStore(db,hardwareStatic);
let settings=settingsStore.get();
let pools=new PoolRegistry(settings);
const power=new PowerProvider({...settings,logicalThreads:hardwareStatic.logicalThreads});
const market=new XmrMarketProvider(db);
const configManager=new ConfigManager(ROOT);
const controller=new XMRigController(ROOT,configManager);
const anomaly=new AnomalyDetector();
const safety=new SafetyEngine(settings);

function getSettings(){return settings;}
function minerContext(profile=settings.profile){
  const adapter=pools.get(settings.poolId);
  return {wallet:settings.wallet,workerName:settings.workerName,pool:adapter.connection(settings.workerName),profile,settings,hardware:hardwareStatic};
}

const telemetry=new TelemetryEngine({db,controller,hardware,power,market,poolRegistry:pools,getSettings,anomaly});
const benchmark=new BenchmarkEngine({
  db,controller,safety,hardwareFingerprint:hardwareStatic.fingerprint,
  getContext:()=>minerContext(settings.profile),
  getSample:async()=>{
    const s=telemetry.snapshot()||await telemetry.tick();
    return s?{localHashrate:s.localHashrate,powerW:s.power?.watts,powerKind:s.power?.kind,temperatureC:s.hardware?.temperatureC,accepted:s.session?.accepted||0,rejected:s.session?.rejected||0,poolFresh:s.pool?.fresh,profitBrlDay:s.economics?.rows?.day?.netBrl??null}:null;
  }
});
const supreme=new SupremeMind({db,benchmark,safety,configManager,controller,getContext:()=>minerContext(settings.profile),getCurrent:()=>telemetry.snapshot()});
supreme.setObjective(settings.objective);supreme.setEnabled(settings.supremeMindEnabled);

const sseClients=new Set();
function emitSse(event,data){const text=`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;for(const res of [...sseClients]){try{res.write(text);}catch{sseClients.delete(res);}}}
telemetry.on('sample',sample=>{emitSse('telemetry',publicStatus(sample));supreme.observe(sample).catch(()=>{});});
telemetry.on('error',error=>emitSse('error',{message:error.message}));
benchmark.on('progress',p=>emitSse('benchmark',p));
supreme.on('state',s=>emitSse('supreme',s));
supreme.on('decision',d=>emitSse('decision',d));
telemetry.start();

setInterval(async()=>{
  const st=controller.state();
  if(st.desired==='running'&&!st.processRunning&&!benchmark.running&&supreme.state.status!=='learning'){
    const gate=controller.canAutoRecover();
    if(gate.allowed&&settings.wallet){
      try{controller.recordAutoRestart();db.addDecision({engine:'Watchdog',objective:settings.objective,action:'RESTART',reason:'XMRig deveria estar rodando, mas o processo terminou.',before:st,after:null,confidence:1,result:'AUTO-RECOVERY'});await controller.start({...minerContext(st.profile||settings.profile),reason:'watchdog'});}catch(error){db.addAlert('critical','watchdog-restart',`Falha no auto-recovery: ${error.message}`,'watchdog');}
    }else if(!gate.allowed){db.addAlert('critical','watchdog-limit','Limite de 3 reinícios em 15 minutos atingido. Mineração não será reiniciada em loop.','watchdog');}
  }
},30000).unref();
setInterval(()=>{db.cleanup();workers.cleanup();},6*3600_000).unref();

function loadEnv(){const file=path.join(ROOT,'.env');if(!fs.existsSync(file))return;for(const raw of fs.readFileSync(file,'utf8').split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith('#'))continue;const i=line.indexOf('=');if(i<1)continue;const k=line.slice(0,i).trim();let v=line.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);if(process.env[k]===undefined)process.env[k]=v;}}
function isLocal(req){return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(String(req.socket.remoteAddress||''));}
function requireLocal(req){if(!isLocal(req))throw Object.assign(new Error('Esta ação só pode ser executada localmente.'),{status:403});}
function sendJson(res,status,value){const body=JSON.stringify(value);res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"});res.end(body);}
async function readRawBody(req,maxBytes=1024*1024){const chunks=[];let bytes=0;for await(const c of req){bytes+=c.length;if(bytes>maxBytes)throw Object.assign(new Error('Payload grande demais.'),{status:413});chunks.push(c);}return Buffer.concat(chunks).toString('utf8');}
async function readBody(req){const raw=await readRawBody(req);if(!raw)return{};try{return JSON.parse(raw);}catch{throw Object.assign(new Error('JSON inválido.'),{status:400});}}
function contentType(file){if(file.endsWith('.html'))return'text/html; charset=utf-8';if(file.endsWith('.js'))return'application/javascript; charset=utf-8';if(file.endsWith('.css'))return'text/css; charset=utf-8';if(file.endsWith('.svg'))return'image/svg+xml';return'application/octet-stream';}
function serveStatic(res,urlPath){let rel=urlPath==='/'?'index.html':urlPath.replace(/^\//,'');if(!['index.html','app.js','styles.css'].includes(rel))return false;const full=path.join(FRONTEND,rel);if(!fs.existsSync(full)){sendJson(res,404,{error:'Frontend não encontrado.'});return true;}const data=fs.readFileSync(full);res.writeHead(200,{'content-type':contentType(full),'content-length':data.length,'cache-control':rel==='index.html'?'no-cache':'public, max-age=60','x-content-type-options':'nosniff'});res.end(data);return true;}
function parseProfileRow(row){if(!row)return null;return{...row,config:JSON.parse(row.config_json||'{}'),safe:Boolean(row.safe)};}
function healthScore(s){
  if(!s)return{score:null,parts:[],reason:'aguardando telemetria'};
  const parts=[];const add=(name,value,detail)=>parts.push({name,value,detail});
  add('XMRig',s.miner?.apiConnected?1:(s.miner?.processRunning?.4:.7),s.miner?.apiConnected?'API local OK':s.miner?.processRunning?'processo sem API':'parado');
  add('Pool',s.pool?.available?(s.pool?.fresh?1:.7):.3,s.pool?.available?(s.pool?.fresh?'recente':'sem share recente'):'API indisponível');
  const rr=(Number(s.session?.accepted||0)+Number(s.session?.rejected||0))>0?Number(s.session?.rejected||0)/(Number(s.session.accepted)+Number(s.session.rejected)):0;add('Shares',Math.max(0,1-rr/.05),`${(rr*100).toFixed(2)}% rejeição`);
  if(s.hardware?.temperatureC!=null){const warn=Number(settings.thermalWarningC);add('Temperatura',Math.max(0,1-Math.max(0,s.hardware.temperatureC-warn+10)/25),`${Number(s.hardware.temperatureC).toFixed(1)}°C`);}
  if(s.efficiency?.hashesPerWatt!=null)add('Eficiência',1,`${Number(s.efficiency.hashesPerWatt).toFixed(2)} H/W`);
  const score=parts.length?Math.round(100*parts.reduce((a,p)=>a+p.value,0)/parts.length):null;return{score,parts};
}
function publicStatus(sample=telemetry.snapshot()){
  const s=sample||{state:'starting'};
  return{version:VERSION,state:s.state||'starting',settings:{...settings,wallet:settings.wallet?`${settings.wallet.slice(0,10)}…${settings.wallet.slice(-10)}`:'',profile:settings.profile},hardware:hardwareStatic,telemetry:s,supreme:supreme.snapshot(),benchmark:benchmark.status(),profiles:db.listProfiles().map(parseProfileRow),workers:workers.summary(),alerts:db.activeAlerts(),health:healthScore(s)};
}
function tailFile(file,max=120000){try{const st=fs.statSync(file),len=Math.min(max,st.size),fd=fs.openSync(file,'r'),buf=Buffer.alloc(len);fs.readSync(fd,buf,0,len,st.size-len);fs.closeSync(fd);return buf.toString('utf8').replace(/\x1b\[[0-9;]*m/g,'');}catch{return'';}}

const workerReplay=new Map();
function pruneWorkerReplay(){const cutoff=Date.now()-5*60_000;for(const [sig,ts] of workerReplay)if(ts<cutoff)workerReplay.delete(sig);}
async function handleWorkerHeartbeat(req,res){
  const raw=await readRawBody(req,256*1024);
  const timestamp=String(req.headers['x-ideagold-timestamp']||'');
  const signature=String(req.headers['x-ideagold-signature']||'').toLowerCase();
  const auth=verifyWorkerSignature({secret:process.env.WORKER_SHARED_SECRET,timestamp,rawBody:raw,signature});
  if(!auth.ok)return sendJson(res,401,{error:`Worker não autorizado: ${auth.reason}`});
  pruneWorkerReplay();
  if(workerReplay.has(signature))return sendJson(res,409,{error:'Heartbeat repetido/replay rejeitado.'});
  let body;try{body=JSON.parse(raw);}catch{throw Object.assign(new Error('JSON inválido no heartbeat.'),{status:400});}
  const worker=normalizeWorkerPayload(body);
  const saved=workers.upsert(worker,req.socket.remoteAddress||'');
  workerReplay.set(signature,Date.now());
  emitSse('workers',{summary:workers.summary()});
  return sendJson(res,200,{ok:true,id:saved.id,lastSeen:saved.last_seen});
}

async function poolStatuses(){
  const out=[];
  for(const p of pools.list()){
    const a=pools.get(p.id);const stats=await a.walletStats(settings.wallet);let stability=null;
    const hist=db.telemetrySince(Date.now()-6*3600_000,2000).filter(x=>x.pool_hashrate!=null).map(x=>Number(x.pool_hashrate));
    if(hist.length>10){const m=hist.reduce((a,b)=>a+b,0)/hist.length;const variance=hist.reduce((a,b)=>a+(b-m)**2,0)/hist.length;stability=m>0?Math.max(0,1-Math.sqrt(variance)/m):null;}
    const total=Number(stats.accepted||0)+Number(stats.rejected||0);const rr=total>0?Number(stats.rejected||0)/total:null;
    const fee=p.id==='p2pool'?0:Number(settings.poolFeePct||0);
    const score=scorePool({latencyMs:stats.latencyMs,feePct:fee,rejectRate:rr,available:stats.available,payoutMinimumXmr:stats.payoutMinimumXmr,stability});
    out.push({...p,stats:{...stats,raw:undefined},score});
  }return out;
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(req.method==='GET'&&serveStatic(res,url.pathname))return;
    if(req.method==='GET'&&url.pathname==='/api/events'){
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive','x-accel-buffering':'no'});res.write('retry: 3000\n\n');sseClients.add(res);req.on('close',()=>sseClients.delete(res));return;
    }
    if(req.method==='GET'&&url.pathname==='/api/health')return sendJson(res,200,{ok:true,name:'IdeaGold Mining Intelligence',version:VERSION,node:process.version,host:HOST,time:new Date().toISOString()});
    if(req.method==='GET'&&url.pathname==='/api/status')return sendJson(res,200,publicStatus());
    if(req.method==='GET'&&url.pathname==='/api/hardware')return sendJson(res,200,{static:hardwareStatic,sample:(telemetry.snapshot()?.hardware||null)});
    if(req.method==='GET'&&url.pathname==='/api/workers')return sendJson(res,200,{workers:workers.list(200),summary:workers.summary()});
    if(req.method==='GET'&&url.pathname==='/api/telemetry'){const ranges={'5m':5*60000,'15m':15*60000,'1h':3600000,'6h':21600000,'24h':86400000,'7d':604800000,'30d':2592000000};const span=ranges[url.searchParams.get('range')]||3600000;return sendJson(res,200,{range:span,rows:db.telemetrySince(Date.now()-span,20000)});}
    if(req.method==='GET'&&url.pathname==='/api/history/sessions')return sendJson(res,200,{sessions:db.listSessions(Number(url.searchParams.get('limit')||100))});
    if(req.method==='GET'&&url.pathname==='/api/history/decisions')return sendJson(res,200,{decisions:db.listDecisions(Number(url.searchParams.get('limit')||200))});
    if(req.method==='GET'&&url.pathname==='/api/benchmarks')return sendJson(res,200,{benchmarks:db.listBenchmarks(1000),status:benchmark.status()});
    if(req.method==='GET'&&url.pathname==='/api/profiles')return sendJson(res,200,{profiles:db.listProfiles().map(parseProfileRow)});
    if(req.method==='GET'&&url.pathname==='/api/profiles/export')return sendJson(res,200,{format:'IdeaGoldProfiles/1',exportedAt:Date.now(),hardwareFingerprint:hardwareStatic.fingerprint,profiles:db.listProfiles().map(parseProfileRow)});
    if(req.method==='GET'&&url.pathname==='/api/pools')return sendJson(res,200,{pools:await poolStatuses(),selected:settings.poolId});
    if(req.method==='GET'&&url.pathname==='/api/logs'){requireLocal(req);const kind=url.searchParams.get('kind')||'mining';const files={mining:path.join(ROOT,'runtime','xmrig-v5.log'),config:path.join(ROOT,'runtime','config-audit.jsonl')};return sendJson(res,200,{kind,text:tailFile(files[kind]||files.mining)});}
    if(req.method==='POST'&&url.pathname==='/api/workers/heartbeat')return handleWorkerHeartbeat(req,res);

    if(req.method==='POST'){requireLocal(req);const body=await readBody(req);
      if(url.pathname==='/api/settings'){
        settings=settingsStore.update(body);pools=new PoolRegistry(settings);telemetry.poolRegistry=pools;power.update({...settings,logicalThreads:hardwareStatic.logicalThreads});safety.update(settings);supreme.setObjective(settings.objective);supreme.setEnabled(settings.supremeMindEnabled);emitSse('settings',{ok:true});return sendJson(res,200,{ok:true,settings:{...settings,wallet:settings.wallet?'configured':''}});
      }
      if(url.pathname==='/api/miner/install')return sendJson(res,200,{ok:true,miner:await controller.install()});
      if(url.pathname==='/api/miner/start'){if(!settings.wallet)throw Object.assign(new Error('Configure sua carteira XMR primeiro.'),{status:400});const result=await controller.start({...minerContext(settings.profile),reason:'user'});return sendJson(res,200,{ok:true,result});}
      if(url.pathname==='/api/miner/stop'){const result=controller.stop('user');telemetry.finishSession('user');return sendJson(res,200,{ok:true,result});}
      if(url.pathname==='/api/miner/pause')return sendJson(res,200,{ok:true,result:controller.pause(),note:'No Windows a pausa é implementada como parada controlada; o crédito já registrado no pool não é perdido.'});
      if(url.pathname==='/api/miner/resume')return sendJson(res,200,{ok:true,result:await controller.resume(minerContext(settings.profile))});
      if(url.pathname==='/api/miner/restart')return sendJson(res,200,{ok:true,result:await controller.restart(minerContext(settings.profile),'user-restart')});
      if(url.pathname==='/api/benchmark/start'){
        if(benchmark.running)throw Object.assign(new Error('Benchmark já em andamento.'),{status:409});
        const config={...settings.profile,...(body.config||{})};benchmark.runCandidate(config,{objective:body.objective||settings.objective,warmupSec:body.warmupSec||settings.benchmarkWarmupSec,sampleSec:body.sampleSec||settings.benchmarkSampleSec,label:body.label||'manual-benchmark'}).catch(error=>db.addAlert('warning','benchmark',error.message,'benchmark'));
        return sendJson(res,202,{ok:true,status:'started'});
      }
      if(url.pathname==='/api/benchmark/stop'){benchmark.cancel();return sendJson(res,200,{ok:true,status:benchmark.status()});}
      if(url.pathname==='/api/supreme/toggle'){settings=settingsStore.update({supremeMindEnabled:Boolean(body.enabled)});supreme.setEnabled(settings.supremeMindEnabled);return sendJson(res,200,{ok:true,supreme:supreme.snapshot()});}
      if(url.pathname==='/api/supreme/objective'){settings=settingsStore.update({objective:body.objective});supreme.setObjective(settings.objective);return sendJson(res,200,{ok:true,supreme:supreme.snapshot()});}
      if(url.pathname==='/api/supreme/autotune'){
        if(!supreme.state.enabled)throw Object.assign(new Error('Ative o Supreme Mind antes do autotuning.'),{status:400});
        supreme.autotune(body||{}).then(()=>{settings=settingsStore.update({profile:supreme.state.best?.config||settings.profile,activeProfile:`best-${settings.objective}`});}).catch(error=>db.addAlert('warning','autotune',error.message,'Supreme Mind'));
        return sendJson(res,202,{ok:true,status:'started'});
      }
      if(url.pathname==='/api/supreme/stop'){supreme.cancel();return sendJson(res,200,{ok:true,supreme:supreme.snapshot()});}
      if(url.pathname==='/api/profiles/save'){
        const id=String(body.id||`custom-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,80);db.saveProfile({id,name:String(body.name||id).slice(0,80),kind:'custom',objective:body.objective||settings.objective,config:body.config||settings.profile,score:null,confidence:null,safe:false});return sendJson(res,200,{ok:true,profile:parseProfileRow(db.getProfile(id))});
      }
      if(url.pathname==='/api/profiles/apply'){
        const row=db.getProfile(String(body.id||''));if(!row)throw Object.assign(new Error('Perfil não encontrado.'),{status:404});const p=parseProfileRow(row);settings=settingsStore.update({profile:p.config,activeProfile:p.id});if(controller.state().processRunning)await controller.restart(minerContext(p.config),'profile-apply');return sendJson(res,200,{ok:true,profile:p});
      }
      if(url.pathname==='/api/profiles/delete'){db.deleteProfile(String(body.id||''));return sendJson(res,200,{ok:true});}
      if(url.pathname==='/api/profiles/import'){
        if(body.format!=='IdeaGoldProfiles/1'||!Array.isArray(body.profiles))throw Object.assign(new Error('Arquivo de perfis incompatível.'),{status:400});for(const p of body.profiles){if(p?.id&&p?.config)db.saveProfile({...p,safe:false,kind:'imported'});}return sendJson(res,200,{ok:true,count:body.profiles.length});
      }
      if(url.pathname==='/api/config/import')return sendJson(res,200,{ok:true,result:configManager.importExisting(body.path)});
      if(url.pathname==='/api/config/restore-safe'){
        const safe=configManager.readSafe();if(!safe)throw Object.assign(new Error('Ainda não existe Last Known Good Configuration.'),{status:404});
        const cpu=safe.cpu||{};const rx=safe.randomx||{};const profile={...settings.profile,priority:cpu.priority??3,yield:cpu.yield!==false,hugePages:cpu['huge-pages']!==false,hugePagesJit:cpu['huge-pages-jit']!==false,rdmsr:rx.rdmsr!==false,wrmsr:rx.wrmsr!==false,numa:rx.numa!==false,randomxMode:rx.mode||'fast',scratchpadPrefetch:rx['scratchpad-prefetch-mode']??1};settings=settingsStore.update({profile,activeProfile:'last-known-good'});if(controller.state().processRunning)await controller.restart(minerContext(profile),'restore-safe');return sendJson(res,200,{ok:true,profile});
      }
      if(url.pathname==='/api/profit/what-if'){
        const s=telemetry.snapshot();if(!s?.network?.available||!s?.market?.available)throw Object.assign(new Error('Dados de rede/preço indisponíveis.'),{status:503});const result=Profit.whatIf({hashrate:s.localHashrate,powerW:s.power?.watts,electricityBrlKWh:settings.electricityBrlKWh,priceBrl:s.market.brl,difficulty:s.network.difficulty,reward:s.network.reward,poolFeePct:settings.poolFeePct},body);return sendJson(res,200,result);
      }
      if(url.pathname==='/api/alerts/resolve'){db.resolveAlert(Number(body.id));return sendJson(res,200,{ok:true});}
    }
    return sendJson(res,404,{error:'Rota não encontrada.'});
  }catch(error){console.error(error);return sendJson(res,error.status||500,{error:error.message||'Erro interno.'});}
});

server.listen(PORT,HOST,()=>{
  console.log(`\nIdeaGold ${VERSION} Mining Intelligence: http://${HOST}:${PORT}`);
  console.log(`Hardware fingerprint local: ${hardwareStatic.fingerprint}`);
  console.log('Dados ausentes aparecem como indisponíveis/estimados; o backend não fabrica telemetria.');
});

module.exports={server,db,workers,controller,telemetry,benchmark,supreme};
