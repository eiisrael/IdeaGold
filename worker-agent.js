'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

loadEnv();

const SERVER = (process.env.IDEAGOLD_SERVER || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const SECRET = process.env.WORKER_SHARED_SECRET || '';
const WORKER_ID = process.env.WORKER_ID || os.hostname().replace(/[^a-zA-Z0-9._-]/g, '-');
const WORKER_NAME = process.env.WORKER_NAME || WORKER_ID;
const WORKER_COIN = process.env.WORKER_COIN || 'XMR';
const XMRIG_API = process.env.XMRIG_API || 'http://127.0.0.1:18080';
const XMRIG_API_TOKEN = process.env.XMRIG_API_TOKEN || '';
const INTERVAL = Math.max(5000, Number(process.env.WORKER_INTERVAL_MS || 15000));
const POWER_WATTS = Math.max(0, Number(process.env.WORKER_POWER_WATTS || 0));
const ELECTRICITY = Math.max(0, Number(process.env.WORKER_ELECTRICITY_BRL_KWH || 0));
const CLOUD_COST = Math.max(0, Number(process.env.WORKER_CLOUD_COST_BRL_DAY || 0));

function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function maybeStartXmrig() {
  if (String(process.env.AUTO_START_XMRIG).toLowerCase() !== 'true') return;
  const exe = process.env.XMRIG_EXECUTABLE || '';
  const config = process.env.XMRIG_CONFIG || '';
  if (!exe || !config) throw new Error('AUTO_START_XMRIG exige XMRIG_EXECUTABLE e XMRIG_CONFIG');
  if (!/^xmrig(?:\.exe)?$/i.test(path.basename(exe))) throw new Error('XMRIG_EXECUTABLE deve apontar para xmrig/xmrig.exe');
  if (!fs.existsSync(exe) || !fs.existsSync(config)) throw new Error('XMRig ou config não encontrado');
  console.log('Iniciando XMRig local autorizado...');
  const child = spawn(exe, ['-c', config], { stdio: 'inherit', windowsHide: false });
  child.on('exit', code => console.log(`XMRig encerrou com código ${code}`));
}

async function localJson(endpoint) {
  const headers = { accept: 'application/json' };
  if (XMRIG_API_TOKEN) headers.authorization = `Bearer ${XMRIG_API_TOKEN}`;
  const response = await fetch(`${XMRIG_API}${endpoint}`, { headers, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`XMRig API HTTP ${response.status}`);
  return response.json();
}

function normalize(summary, backends) {
  const hash = summary.hashrate?.total || [];
  const connection = summary.connection || {};
  const list = Array.isArray(backends?.backends) ? backends.backends : Array.isArray(backends) ? backends : [];
  const backendSummary = list.map(item => {
    const total = item?.hashrate?.total;
    const h = Array.isArray(total) ? Number(total[0] || 0) : Number(item?.hashrate || 0);
    return { type: String(item?.type || item?.name || 'unknown'), hashrate: h, enabled: item?.enabled !== false };
  });
  return {
    id: WORKER_ID,
    name: WORKER_NAME,
    coin: WORKER_COIN,
    algo: String(connection.algo || summary.algo || ''),
    hashrate: Number(hash[0] || 0),
    hashrate60s: Number(hash[1] || 0),
    hashrate15m: Number(hash[2] || 0),
    accepted: Number(connection.accepted || 0),
    rejected: Number(connection.rejected || 0),
    uptime: Number(summary.uptime || 0),
    pool: connection.pool || '',
    minerVersion: summary.version || '',
    host: os.hostname(),
    powerWatts: POWER_WATTS,
    electricity: ELECTRICITY,
    cloudCostBrlDay: CLOUD_COST,
    backends: backendSummary
  };
}

async function heartbeat(payload) {
  const raw = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = crypto.createHmac('sha256', SECRET).update(timestamp).update('.').update(raw).digest('hex');
  const response = await fetch(`${SERVER}/api/workers/heartbeat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ideagold-timestamp': timestamp,
      'x-ideagold-signature': signature
    },
    body: raw,
    signal: AbortSignal.timeout(8000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Servidor HTTP ${response.status}`);
}

async function tick() {
  try {
    if (SECRET.length < 16 || SECRET === 'troque-por-um-segredo-forte') throw new Error('Configure WORKER_SHARED_SECRET forte (mínimo 16 caracteres) igual ao servidor');
    const [summary, backends] = await Promise.all([
      localJson('/2/summary'),
      localJson('/2/backends').catch(() => null)
    ]);
    const payload = normalize(summary, backends);
    await heartbeat(payload);
    console.log(`[${new Date().toLocaleTimeString()}] ${payload.hashrate.toFixed(1)} H/s ${payload.algo || ''} -> ${SERVER}`);
  } catch (error) {
    console.error(`[${new Date().toLocaleTimeString()}] ${error.message}`);
  }
}

try { maybeStartXmrig(); } catch (error) { console.error(error.message); process.exitCode = 1; }
tick();
setInterval(tick, INTERVAL);
