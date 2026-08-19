const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

loadEnv();

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const RUNTIME_DIR = path.join(ROOT, 'runtime');
const USER_FILE = path.join(DATA_DIR, 'user.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.ndjson');
const MINER_META = path.join(RUNTIME_DIR, 'miner.json');
const XMRIG_CONFIG = path.join(RUNTIME_DIR, 'xmrig-config.json');
const XMRIG_LOG = path.join(RUNTIME_DIR, 'xmrig.log');
const MAX_BODY = 1024 * 1024;
const XMRIG_VERSION = '6.26.0';
const XMRIG_ASSET = `xmrig-${XMRIG_VERSION}-windows-x64.zip`;
const XMRIG_SHA256 = 'bba8097cb37d9b458a1cb1137876b27cde6740d17fe4ccbc086ba07d87d9e147';
const XMRIG_URL = `https://github.com/xmrig/xmrig/releases/download/v${XMRIG_VERSION}/${XMRIG_ASSET}`;
const POOL_HOST = 'gulf.moneroocean.stream';
const POOL_PORT = 20128;
const marketCache = { at: 0, data: null };
let minerChild = null;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(RUNTIME_DIR, { recursive: true });

function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0,eq).trim();
    let value = line.slice(eq+1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1,-1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
function readJson(file, fallback={}) { try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; } }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value,null,2)); }
function audit(type,payload={}) { fs.appendFileSync(AUDIT_FILE, JSON.stringify({ts:new Date().toISOString(),type,...payload})+'\n'); }
function headers(extra={}) { return {
  'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer',
  'permissions-policy':'camera=(), microphone=(), geolocation=()',
  'content-security-policy':"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  ...extra
};}
function sendJson(res,status,data){ const body=JSON.stringify(data); res.writeHead(status,headers({'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-store'})); res.end(body); }
async function readBody(req){ const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>MAX_BODY)throw Object.assign(new Error('Payload muito grande'),{status:413});chunks.push(c)};if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Object.assign(new Error('JSON inválido'),{status:400})}}
function isLoopback(req){ const ip=String(req.socket.remoteAddress||''); return ip==='127.0.0.1'||ip==='::1'||ip.endsWith('127.0.0.1');}
function requireLocal(req){ if(!isLoopback(req)) throw Object.assign(new Error('Controle do minerador disponível somente neste computador.'),{status:403}); }
function maskWallet(w){ if(!w)return'';return w.length>18?`${w.slice(0,9)}…${w.slice(-9)}`:w; }
function validXmrAddress(v){
  const s=String(v||'').trim();
  return /^[48][1-9A-HJ-NP-Za-km-z]{94}$/.test(s) || /^[4][1-9A-HJ-NP-Za-km-z]{105}$/.test(s);
}
function userConfig(){ return readJson(USER_FILE,{wallet:'',electricity:0.90,threads:3,createdAt:null}); }
function saveUser(body){
  const wallet=String(body.wallet||'').trim();
  if(!validXmrAddress(wallet)) throw Object.assign(new Error('Carteira XMR inválida. Cole somente o endereço público de recebimento.'),{status:400});
  const old=userConfig();
  const data={...old,wallet,electricity:Math.max(0,Number(body.electricity??old.electricity??0.90)),threads:[2,3,4].includes(Number(body.threads))?Number(body.threads):3,updatedAt:new Date().toISOString()};
  if(!data.createdAt)data.createdAt=data.updatedAt;
  writeJson(USER_FILE,data); audit('wallet_saved',{wallet:maskWallet(wallet),threads:data.threads}); return data;
}
function minerMeta(){ return readJson(MINER_META,{installed:false,version:null,exe:null,sha256:null}); }
function pidAlive(pid){ if(!pid)return false;try{process.kill(Number(pid),0);return true}catch{return false}}
function findFile(dir,name){
  if(!fs.existsSync(dir))return null;
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isFile()&&ent.name.toLowerCase()===name.toLowerCase())return p;if(ent.isDirectory()){const f=findFile(p,name);if(f)return f}}
  return null;
}
async function download(url,dest){
  const r=await fetch(url,{headers:{'user-agent':'IdeaGold/3.0'},redirect:'follow',signal:AbortSignal.timeout(120000)});
  if(!r.ok) throw new Error(`Download HTTP ${r.status}`);
  const buf=Buffer.from(await r.arrayBuffer()); fs.writeFileSync(dest,buf); return buf;
}
async function installXmrig(){
  if(process.platform!=='win32') throw Object.assign(new Error('Instalação automática desta versão é para Windows 64-bit.'),{status:400});
  const existing=minerMeta();
  if(existing.installed && existing.exe && fs.existsSync(existing.exe)) return existing;
  const zip=path.join(RUNTIME_DIR,XMRIG_ASSET);
  const extract=path.join(RUNTIME_DIR,`xmrig-${XMRIG_VERSION}`);
  fs.rmSync(extract,{recursive:true,force:true}); fs.mkdirSync(extract,{recursive:true});
  const buf=await download(XMRIG_URL,zip);
  const sha=crypto.createHash('sha256').update(buf).digest('hex');
  if(sha!==XMRIG_SHA256){fs.rmSync(zip,{force:true});throw new Error('Falha de segurança: SHA-256 do XMRig não confere. Nada foi executado.')}
  const ps=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',`Expand-Archive -LiteralPath '${zip.replaceAll("'","''")}' -DestinationPath '${extract.replaceAll("'","''")}' -Force`],{encoding:'utf8',windowsHide:true});
  if(ps.status!==0) throw new Error(`Falha ao extrair XMRig: ${ps.stderr||ps.stdout}`);
  const exe=findFile(extract,'xmrig.exe');
  if(!exe) throw new Error('xmrig.exe não encontrado após extração');
  const meta={installed:true,version:XMRIG_VERSION,exe,sha256:sha,verified:true,source:'xmrig/xmrig official GitHub release',installedAt:new Date().toISOString()};
  writeJson(MINER_META,meta); fs.rmSync(zip,{force:true}); audit('xmrig_installed',{version:XMRIG_VERSION,sha256:sha}); return meta;
}
function buildXmrigConfig(user){
  return {
    autosave:false,background:false,colors:false,title:true,
    randomx:{init:-1,'init-avx2':-1,mode:'auto','1gb-pages':false,rdmsr:true,wrmsr:true,'cache-qos':false,numa:true,'scratchpad-prefetch-mode':1},
    cpu:{enabled:true,'huge-pages':true,'huge-pages-jit':false,'max-threads-hint':75,yield:true,asm:true},
    opencl:{enabled:false},cuda:{enabled:false},
    pools:[{url:`${POOL_HOST}:${POOL_PORT}`,user:user.wallet,pass:'IdeaGold-SNIPER~rx/0',keepalive:true,tls:true,enabled:true}],
    http:{enabled:true,host:'127.0.0.1',port:18080,'access-token':null,restricted:true},
    'donate-level':1,'print-time':15,'health-print-time':60,'pause-on-battery':true,'pause-on-active':false
  };
}
async function startMiner(){
  const user=userConfig(); if(!validXmrAddress(user.wallet)) throw Object.assign(new Error('Adicione sua carteira XMR antes de minerar.'),{status:400});
  let meta=minerMeta(); if(!meta.installed||!meta.exe||!fs.existsSync(meta.exe)) meta=await installXmrig();
  const prev=readJson(path.join(RUNTIME_DIR,'process.json'),{});
  if(pidAlive(prev.pid)) return {started:false,alreadyRunning:true,pid:prev.pid};
  const cfg=buildXmrigConfig(user); writeJson(XMRIG_CONFIG,cfg);
  const out=fs.openSync(XMRIG_LOG,'a'); const err=fs.openSync(XMRIG_LOG,'a');
  minerChild=spawn(meta.exe,['-c',XMRIG_CONFIG,'--threads',String(user.threads)],{cwd:path.dirname(meta.exe),stdio:['ignore',out,err],windowsHide:true,detached:false});
  writeJson(path.join(RUNTIME_DIR,'process.json'),{pid:minerChild.pid,startedAt:new Date().toISOString(),wallet:maskWallet(user.wallet)});
  minerChild.on('exit',(code)=>{audit('miner_exit',{code}); const p=readJson(path.join(RUNTIME_DIR,'process.json'),{});p.stoppedAt=new Date().toISOString();p.exitCode=code;writeJson(path.join(RUNTIME_DIR,'process.json'),p);minerChild=null;});
  audit('miner_start',{pid:minerChild.pid,wallet:maskWallet(user.wallet),threads:user.threads,pool:`${POOL_HOST}:${POOL_PORT}`});
  return {started:true,pid:minerChild.pid};
}
function stopMiner(){
  const p=readJson(path.join(RUNTIME_DIR,'process.json'),{});
  if(p.pid&&pidAlive(p.pid)){
    if(process.platform==='win32') spawnSync('taskkill',['/PID',String(p.pid),'/T','/F'],{windowsHide:true});
    else try{process.kill(Number(p.pid),'SIGTERM')}catch{}
  }
  p.stoppedAt=new Date().toISOString(); writeJson(path.join(RUNTIME_DIR,'process.json'),p); minerChild=null; audit('miner_stop',{pid:p.pid||null}); return {stopped:true};
}
async function xmrigSummary(){
  try{
    const r=await fetch('http://127.0.0.1:18080/2/summary',{headers:{accept:'application/json'},signal:AbortSignal.timeout(1500)});
    if(!r.ok)return null;return await r.json();
  }catch{return null}
}
async function poolStats(wallet){
  if(!validXmrAddress(wallet))return null;
  const candidates=[
    `https://api.moneroocean.stream/miner/${encodeURIComponent(wallet)}/stats`,
    `https://api.moneroocean.stream/miner/${encodeURIComponent(wallet)}/stats/IdeaGold-SNIPER`
  ];
  for(const url of candidates){try{const r=await fetch(url,{headers:{accept:'application/json','user-agent':'IdeaGold/3.0'},signal:AbortSignal.timeout(5000)});if(r.ok){const d=await r.json();return d}}catch{}}
  return null;
}
async function market(){
  if(marketCache.data&&Date.now()-marketCache.at<45000)return marketCache.data;
  const r=await fetch('https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=brl,usd&include_24hr_change=true',{headers:{accept:'application/json','user-agent':'IdeaGold/3.0'},signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw new Error(`Mercado HTTP ${r.status}`);const d=await r.json();marketCache.at=Date.now();marketCache.data=d;return d;
}
async function networkStats(){
  try{
    const r=await fetch('https://api.moneroocean.stream/network/stats',{headers:{accept:'application/json','user-agent':'IdeaGold/3.0'},signal:AbortSignal.timeout(5000)});
    if(!r.ok)return null;
    const d=await r.json();
    const difficulty=Number(d.difficulty||0);
    let reward=Number(d.value||0);
    if(reward>1000000) reward=reward/1e12;
    if(!(reward>0&&reward<10)) reward=0.6;
    return {difficulty,reward,height:Number(d.height||d.main_height||0)};
  }catch{return null}
}
function mapPool(d){
  if(!d)return null;
  const pick=(...ks)=>{for(const k of ks)if(d[k]!==undefined&&d[k]!==null)return Number(d[k])||0;return 0};
  return {hashrate:pick('hash','hash2','hashrate'),totalHashes:pick('totalHash','totalHashes'),validShares:pick('validShares','valid'),invalidShares:pick('invalidShares','invalid'),dueAtomic:pick('amtDue','amountDue','balance'),paidAtomic:pick('amtPaid','amountPaid','paid'),raw:d};
}
function monteCarlo({hashrate,price,electricity,difficulty,reward=0.6,powerWatts=115,days=30}){
  if(!(hashrate>0&&price>0&&difficulty>0)) return null;
  const sims=4000, out=[], donateFactor=0.99;
  for(let i=0;i<sims;i++){
    let p=price, diff=difficulty, rev=0;
    for(let day=0;day<days;day++){
      const priceShock=(Math.random()+Math.random()+Math.random()+Math.random()-2)*0.035;
      const diffShock=(Math.random()+Math.random()+Math.random()+Math.random()-2)*0.018;
      p=Math.max(0,p*(1+priceShock));
      diff=Math.max(1,diff*(1+diffShock));
      const coins=(hashrate*86400/diff)*reward*donateFactor;
      rev+=coins*p;
    }
    const cost=(powerWatts/1000)*24*days*electricity;
    out.push(rev-cost);
  }
  out.sort((a,b)=>a-b); const q=x=>out[Math.min(out.length-1,Math.floor(x*out.length))];
  const expectedCoinsDay=(hashrate*86400/difficulty)*reward*donateFactor;
  return {p10:q(.10),median:q(.50),p90:q(.90),lossProbability:out.filter(x=>x<0).length/out.length,simulations:sims,expectedCoinsDay,powerWatts};
}
async function simpleStatus(){
  const user=userConfig(), meta=minerMeta(), proc=readJson(path.join(RUNTIME_DIR,'process.json'),{});
  const sum=await xmrigSummary(); const running=Boolean(sum)||pidAlive(proc.pid);
  const h=sum?.hashrate?.total||[]; const conn=sum?.connection||{};
  let mkt=null;try{mkt=await market()}catch{}
  let ps=null;try{ps=mapPool(await poolStats(user.wallet))}catch{}
  let net=null;try{net=await networkStats()}catch{}
  const xmrBRL=Number(mkt?.monero?.brl||0);
  const hashrate=Number(h[0]||ps?.hashrate||0);
  const risk=monteCarlo({hashrate,price:xmrBRL,electricity:Number(user.electricity||.90),difficulty:Number(net?.difficulty||0),reward:Number(net?.reward||0.6)});
  return {
    version:'3.0.0',configured:validXmrAddress(user.wallet),wallet:maskWallet(user.wallet),walletFull:user.wallet||'',electricity:user.electricity||.90,threads:user.threads||3,
    miner:{installed:Boolean(meta.installed&&meta.exe&&fs.existsSync(meta.exe)),version:meta.version||null,verified:Boolean(meta.verified),running,pid:proc.pid||null,hashrate,hashrate60s:Number(h[1]||0),hashrate15m:Number(h[2]||0),accepted:Number(conn.accepted||ps?.validShares||0),rejected:Number(conn.rejected||ps?.invalidShares||0),uptime:Number(sum?.uptime||0),pool:conn.pool||`${POOL_HOST}:${POOL_PORT}`},
    pool:ps?{...ps,dueXmr:Number(ps.dueAtomic||0)/1e12,paidXmr:Number(ps.paidAtomic||0)/1e12}:null,
    network:net,
    market:{xmrBRL,xmrUSD:Number(mkt?.monero?.usd||0),change24h:Number(mkt?.monero?.brl_24h_change||0)},risk
  };
}
function serveStatic(res,urlPath){
  const file=urlPath==='/'||urlPath==='/index.html'?'index.html':urlPath==='/favicon.ico'?null:null;if(!file)return false;
  const p=path.join(ROOT,file);if(!fs.existsSync(p)){sendJson(res,404,{error:'arquivo não encontrado'});return true}
  const data=fs.readFileSync(p);res.writeHead(200,headers({'content-type':'text/html; charset=utf-8','content-length':data.length,'cache-control':'no-cache'}));res.end(data);return true;
}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(req.method==='GET'&&serveStatic(res,u.pathname))return;
    if(req.method==='GET'&&u.pathname==='/api/health')return sendJson(res,200,{ok:true,name:'IdeaGold',version:'3.0.0',time:new Date().toISOString()});
    if(req.method==='GET'&&u.pathname==='/api/simple/status')return sendJson(res,200,await simpleStatus());
    if(req.method==='POST'&&u.pathname==='/api/simple/wallet'){requireLocal(req);return sendJson(res,200,{ok:true,user:saveUser(await readBody(req))});
    if(req.method==='POST'&&u.pathname==='/api/simple/install'){requireLocal(req);return sendJson(res,200,{ok:true,miner:await installXmrig()});
    if(req.method==='POST'&&u.pathname==='/api/simple/start'){requireLocal(req);return sendJson(res,200,{ok:true,result:await startMiner()});
    if(req.method==='POST'&&u.pathname==='/api/simple/stop'){requireLocal(req);return sendJson(res,200,{ok:true,result:stopMiner()});
    if(req.method==='POST'&&u.pathname==='/api/simple/settings'){requireLocal(req);const b=await readBody(req);const cur=userConfig();return sendJson(res,200,{ok:true,user:saveUser({...cur,...b,wallet:cur.wallet})});
    return sendJson(res,404,{error:'Rota não encontrada'});
  }catch(e){console.error(e);sendJson(res,e.status||500,{error:e.message||'Erro interno'})}
});

server.listen(PORT,HOST,()=>{console.log(`\nIdeaGold 3.0: http://${HOST}:${PORT}`);console.log('Controle local protegido: minerador só pode ser iniciado pelo próprio PC.');});
