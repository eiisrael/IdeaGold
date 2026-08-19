const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

loadEnv();

const SERVER = (process.env.IDEAGOLD_SERVER || 'http://127.0.0.1:8080').replace(/\/+$/,'');
const SECRET = process.env.WORKER_SHARED_SECRET || '';
const WORKER_ID = process.env.WORKER_ID || os.hostname().replace(/[^a-zA-Z0-9._-]/g,'-');
const WORKER_NAME = process.env.WORKER_NAME || WORKER_ID;
const WORKER_COIN = process.env.WORKER_COIN || 'XMR';
const XMRIG_API = process.env.XMRIG_API || 'http://127.0.0.1:18080/2/summary';
const XMRIG_API_TOKEN = process.env.XMRIG_API_TOKEN || '';
const INTERVAL = Math.max(5000, Number(process.env.WORKER_INTERVAL_MS || 15000));

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value=value.slice(1,-1);
    if (process.env[key] === undefined) process.env[key]=value;
  }
}
function maybeStartXmrig() {
  if (String(process.env.AUTO_START_XMRIG).toLowerCase() !== 'true') return;
  const exe = process.env.XMRIG_EXECUTABLE || '';
  const config = process.env.XMRIG_CONFIG || '';
  if (!exe || !config) throw new Error('AUTO_START_XMRIG exige XMRIG_EXECUTABLE e XMRIG_CONFIG');
  if (!/^xmrig(?:\.exe)?$/i.test(path.basename(exe))) throw new Error('Por segurança, XMRIG_EXECUTABLE deve apontar para xmrig ou xmrig.exe');
  if (!fs.existsSync(exe) || !fs.existsSync(config)) throw new Error('XMRig ou config não encontrado');
  console.log('Iniciando XMRig local configurado pelo operador...');
  const child = spawn(exe, ['-c', config], { stdio: 'inherit', windowsHide: false });
  child.on('exit', code => console.log(`XMRig encerrou com código ${code}`));
}
async function xmrigSummary() {
  const headers = { accept:'application/json' };
  if (XMRIG_API_TOKEN) headers.authorization = `Bearer ${XMRIG_API_TOKEN}`;
  const r = await fetch(XMRIG_API, { headers, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`XMRig API HTTP ${r.status}`);
  return r.json();
}
function normalize(summary) {
  const h = summary.hashrate?.total || [];
  const conn = summary.connection || {};
  return {
    id: WORKER_ID,
    name: WORKER_NAME,
    coin: WORKER_COIN,
    hashrate: Number(h[0] || 0),
    hashrate60s: Number(h[1] || 0),
    hashrate15m: Number(h[2] || 0),
    accepted: Number(conn.accepted || 0),
    rejected: Number(conn.rejected || 0),
    uptime: Number(summary.uptime || 0),
    pool: conn.pool || '',
    minerVersion: summary.version || '',
    host: os.hostname()
  };
}
async function heartbeat(payload) {
  const raw = JSON.stringify(payload);
  const ts = String(Date.now());
  const sig = crypto.createHmac('sha256', SECRET).update(ts).update('.').update(raw).digest('hex');
  const r = await fetch(`${SERVER}/api/workers/heartbeat`, {
    method:'POST',
    headers:{'content-type':'application/json','x-ideagold-timestamp':ts,'x-ideagold-signature':sig},
    body:raw,
    signal:AbortSignal.timeout(8000)
  });
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || `Servidor HTTP ${r.status}`);
}
async function tick() {
  try {
    if (!SECRET || SECRET === 'troque-por-um-segredo-forte') throw new Error('Configure WORKER_SHARED_SECRET igual ao servidor');
    const summary = await xmrigSummary();
    const payload = normalize(summary);
    await heartbeat(payload);
    console.log(`[${new Date().toLocaleTimeString()}] ${payload.hashrate.toFixed(1)} H/s -> ${SERVER}`);
  } catch (e) {
    console.error(`[${new Date().toLocaleTimeString()}] ${e.message}`);
  }
}

try { maybeStartXmrig(); } catch(e) { console.error(e.message); process.exitCode=1; }
tick();
setInterval(tick, INTERVAL);
