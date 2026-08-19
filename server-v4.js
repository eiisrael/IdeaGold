'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const G = require('./lib/goldbrain');

loadEnv();

const VERSION = '4.1.0';
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const RUNTIME_DIR = path.join(ROOT, 'runtime');

const USER_FILE = path.join(DATA_DIR, 'user.json');
const WORKERS_FILE = path.join(DATA_DIR, 'workers.json');
const PROCESS_FILE = path.join(RUNTIME_DIR, 'process.json');
const ESTIMATOR_FILE = path.join(RUNTIME_DIR, 'estimator.json');
const MARKET_CACHE_FILE = path.join(RUNTIME_DIR, 'market-cache.json');
const NETWORK_CACHE_FILE = path.join(RUNTIME_DIR, 'network-cache.json');

const STOCK_META_FILE = path.join(RUNTIME_DIR, 'miner-stock.json');
const ADV_META_FILE = path.join(RUNTIME_DIR, 'miner-advanced.json');
const LEGACY_META_FILE = path.join(RUNTIME_DIR, 'miner.json');
const STOCK_CONFIG_FILE = path.join(RUNTIME_DIR, 'xmrig-stock-config.json');
const ADV_CONFIG_FILE = path.join(RUNTIME_DIR, 'xmrig-advanced-config.json');
const XMRIG_LOG = path.join(RUNTIME_DIR, 'xmrig.log');

const STOCK = {
  version: '6.26.0',
  asset: 'xmrig-6.26.0-windows-x64.zip',
  sha256: 'bba8097cb37d9b458a1cb1137876b27cde6740d17fe4ccbc086ba07d87d9e147'
};
STOCK.url = `https://github.com/xmrig/xmrig/releases/download/v${STOCK.version}/${STOCK.asset}`;

const ADV = {
  commit: '13b87c26ebfb2b9e9c1fb1cf1156856ea5cd2cb0',
  blobSha1: 'fff8cbec64afdad231cb416037b96cee5f56ccf9',
  version: '6.26.0-mo4',
  asset: 'xmrig.zip'
};
ADV.url = `https://raw.githubusercontent.com/MoneroOcean/xmrig_setup/${ADV.commit}/${ADV.asset}`;

const POOL_HOST = process.env.POOL_HOST || 'gulf.moneroocean.stream';
const POOL_PORT = Number(process.env.POOL_PORT || 20128);
const WORKER_SECRET = process.env.WORKER_SHARED_SECRET || '';

let minerChild = null;
let watchdogBusy = false;

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
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
function isLoopback(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(req.socket.remoteAddress || ''));
}
function requireLocal(req) {
  if (!isLoopback(req)) throw Object.assign(new Error('Controle local somente.'), { status: 403 });
}
function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer'
  });
  res.end(body);
}
async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw Object.assign(new Error('Payload muito grande.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON inválido.'), { status: 400 }); }
}
function validWallet(value) {
  const s = String(value || '').trim();
  return /^[48][1-9A-HJ-NP-Za-km-z]{94}$/.test(s) || /^4[1-9A-HJ-NP-Za-km-z]{105}$/.test(s);
}
function maskWallet(value) {
  const s = String(value || '');
  return s.length > 20 ? `${s.slice(0, 10)}…${s.slice(-10)}` : s;
}
function processAlive(pid) {
  if (!pid) return false;
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

function hardwareProfile() {
  const cpus = os.cpus() || [];
  const model = cpus[0]?.model || '';
  const logicalThreads = Math.max(1, cpus.length || 1);
  const isI54670K = /i5-4670K/i.test(model);
  const recommendedThreads = isI54670K ? 3 : Math.max(1, Math.round(logicalThreads * 0.75));
  return { cpuModel: model, logicalThreads, isI54670K, recommendedThreads };
}

function defaults() {
  const hw = hardwareProfile();
  return {
    wallet: '',
    electricity: 0.90,
    performanceMode: 'max',
    engineMode: 'stable',
    gpuMode: 'auto',
    cpuThreadsPercent: Math.round((hw.recommendedThreads / hw.logicalThreads) * 100),
    basePowerWatts: 30,
    cpuPowerWatts: 75,
    gpuPowerWatts: 47,
    measuredPowerWatts: 0,
    createdAt: null
  };
}
function userConfig() {
  return { ...defaults(), ...readJson(USER_FILE, {}) };
}
function saveUser(input) {
  const old = userConfig();
  const wallet = String(input.wallet ?? old.wallet ?? '').trim();
  if (!validWallet(wallet)) {
    throw Object.assign(new Error('Carteira XMR inválida. Cole apenas o endereço público.'), { status: 400 });
  }
  const data = {
    ...old,
    ...input,
    wallet,
    electricity: G.clamp(Number(input.electricity ?? old.electricity ?? 0.90), 0, 20),
    performanceMode: ['smart', 'max'].includes(input.performanceMode) ? input.performanceMode : old.performanceMode,
    engineMode: ['stable', 'advanced'].includes(input.engineMode) ? input.engineMode : (old.engineMode || 'stable'),
    gpuMode: ['auto', 'on', 'off'].includes(input.gpuMode) ? input.gpuMode : old.gpuMode,
    cpuThreadsPercent: G.clamp(Number(input.cpuThreadsPercent ?? old.cpuThreadsPercent ?? 75), 25, 100),
    measuredPowerWatts: G.clamp(Number(input.measuredPowerWatts ?? old.measuredPowerWatts ?? 0), 0, 2000),
    updatedAt: new Date().toISOString()
  };
  if (!data.createdAt) data.createdAt = data.updatedAt;
  writeJson(USER_FILE, data);
  return data;
}

function findFile(dir, fileName) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return full;
    if (entry.isDirectory()) {
      const nested = findFile(full, fileName);
      if (nested) return nested;
    }
  }
  return null;
}
async function download(url, destination) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': `IdeaGold/${VERSION}` },
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`Falha de download HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destination, buffer);
  return buffer;
}
function unzip(zipFile, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  const quote = s => String(s).replaceAll("'", "''");
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `Expand-Archive -LiteralPath '${quote(zipFile)}' -DestinationPath '${quote(destination)}' -Force`
  ], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Falha ao extrair minerador: ${result.stderr || result.stdout || 'erro desconhecido'}`);
}
function gitBlobSha1(buffer) {
  return crypto.createHash('sha1').update(Buffer.from(`blob ${buffer.length}\0`)).update(buffer).digest('hex');
}

function migrateLegacyAdvancedMeta() {
  if (fs.existsSync(ADV_META_FILE)) return;
  const legacy = readJson(LEGACY_META_FILE, {});
  if (legacy.engine === 'moneroocean-advanced' && legacy.exe && fs.existsSync(legacy.exe)) {
    writeJson(ADV_META_FILE, legacy);
  }
}

async function installStock() {
  if (process.platform !== 'win32') throw new Error('Instalação automática local disponível para Windows x64.');
  const existing = readJson(STOCK_META_FILE, {});
  if (existing.exe && fs.existsSync(existing.exe) && existing.verified) return existing;

  const zip = path.join(RUNTIME_DIR, STOCK.asset);
  const folder = path.join(RUNTIME_DIR, `xmrig-stock-${STOCK.version}`);
  const buffer = await download(STOCK.url, zip);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  if (sha256 !== STOCK.sha256) {
    fs.rmSync(zip, { force: true });
    throw new Error('Falha de integridade do XMRig oficial.');
  }
  unzip(zip, folder);
  fs.rmSync(zip, { force: true });
  const exe = findFile(folder, 'xmrig.exe');
  const base = findFile(folder, 'config.json');
  if (!exe) throw new Error('xmrig.exe não encontrado após instalação.');
  const meta = {
    engine: 'xmrig-stock',
    version: STOCK.version,
    exe,
    base,
    verified: true,
    source: 'xmrig/xmrig',
    sha256,
    installedAt: new Date().toISOString()
  };
  writeJson(STOCK_META_FILE, meta);
  return meta;
}

async function installAdvanced() {
  if (process.platform !== 'win32') throw new Error('Instalação automática local disponível para Windows x64.');
  migrateLegacyAdvancedMeta();
  const existing = readJson(ADV_META_FILE, {});
  if (existing.exe && fs.existsSync(existing.exe) && existing.verified) return existing;

  const zip = path.join(RUNTIME_DIR, 'xmrig-mo.zip');
  const folder = path.join(RUNTIME_DIR, `xmrig-mo-${ADV.version}`);
  const buffer = await download(ADV.url, zip);
  const blob = gitBlobSha1(buffer);
  if (blob !== ADV.blobSha1) {
    fs.rmSync(zip, { force: true });
    throw new Error('Falha de integridade do XMRig MoneroOcean.');
  }
  unzip(zip, folder);
  fs.rmSync(zip, { force: true });
  const exe = findFile(folder, 'xmrig.exe');
  const base = findFile(folder, 'config.json');
  if (!exe) throw new Error('XMRig MoneroOcean não encontrado após instalação.');
  const meta = {
    engine: 'moneroocean-advanced',
    version: ADV.version,
    exe,
    base,
    verified: true,
    source: 'MoneroOcean/xmrig_setup',
    commit: ADV.commit,
    gitBlobSha1: blob,
    installedAt: new Date().toISOString()
  };
  writeJson(ADV_META_FILE, meta);
  return meta;
}

async function ensureMiner(engineMode) {
  return engineMode === 'advanced' ? installAdvanced() : installStock();
}

function recommendedThreads(user) {
  const hw = hardwareProfile();
  if (hw.isI54670K) return 3;
  const percentage = user.performanceMode === 'max' ? Math.max(75, user.cpuThreadsPercent) : user.cpuThreadsPercent;
  return Math.max(1, Math.min(hw.logicalThreads, Math.round(hw.logicalThreads * percentage / 100)));
}

function baseMinerConfig(meta, configFile) {
  if (fs.existsSync(configFile)) return readJson(configFile, {});
  if (meta.base && fs.existsSync(meta.base)) return readJson(meta.base, {});
  return {};
}

function buildMinerConfig(user, meta, configFile) {
  const base = baseMinerConfig(meta, configFile);
  const worker = os.hostname().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'IdeaGold';
  const advanced = meta.engine === 'moneroocean-advanced';
  const threads = recommendedThreads(user);

  const openclEnabled = user.gpuMode === 'on';

  const config = {
    ...base,
    autosave: advanced,
    background: false,
    colors: false,
    randomx: {
      ...(base.randomx || {}),
      mode: 'fast',
      '1gb-pages': false,
      rdmsr: true,
      wrmsr: true,
      numa: true,
      'scratchpad-prefetch-mode': 1
    },
    cpu: {
      ...(base.cpu || {}),
      enabled: true,
      'huge-pages': true,
      'huge-pages-jit': true,
      'max-threads-hint': Math.round(threads / hardwareProfile().logicalThreads * 100),
      yield: false,
      priority: 3,
      asm: true
    },
    opencl: {
      ...(base.opencl || {}),
      enabled: openclEnabled,
      cache: true,
      adl: true
    },
    cuda: { ...(base.cuda || {}), enabled: false },
    pools: [{
      ...(base.pools?.[0] || {}),
      url: `${POOL_HOST}:${POOL_PORT}`,
      user: user.wallet,
      pass: advanced ? `IdeaGold-${worker}` : `IdeaGold-${worker}~rx/0`,
      'rig-id': worker,
      tls: true,
      keepalive: true,
      enabled: true
    }],
    http: {
      ...(base.http || {}),
      enabled: true,
      host: '127.0.0.1',
      port: 18080,
      'access-token': null,
      restricted: true
    },
    'donate-level': 1,
    'print-time': 10,
    'health-print-time': 30,
    'pause-on-battery': true,
    'log-file': XMRIG_LOG
  };

  if (advanced) {
    config['rebench-algo'] = false;
    config['bench-algo-time'] = Math.max(8, Number(base['bench-algo-time'] || 8));
    config['algo-min-time'] = Math.max(30, Number(base['algo-min-time'] || 30));
  }
  return { config, threads, openclEnabled };
}

async function xmrPoolStats(wallet) {
  if (!validWallet(wallet)) return null;
  try {
    const response = await fetch(`https://api.moneroocean.stream/miner/${encodeURIComponent(wallet)}/stats`, {
      headers: { accept: 'application/json', 'user-agent': `IdeaGold/${VERSION}` },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return null;
    return mapPoolStats(await response.json());
  } catch {
    return null;
  }
}
function mapPoolStats(data) {
  if (!data) return null;
  const num = (...keys) => {
    for (const key of keys) if (data[key] !== undefined && data[key] !== null) return Number(data[key]) || 0;
    return 0;
  };
  const lastHash = num('lastHash', 'lastShare', 'lts', 'last');
  return {
    normalizedHashrate: num('hash2', 'hash', 'hashrate'),
    rawHashrate: num('hash', 'hashrate'),
    dueXmr: num('amtDue', 'due', 'balance') / 1e12,
    paidXmr: num('amtPaid', 'paid') / 1e12,
    validShares: num('validShares', 'valid', 'vs'),
    invalidShares: num('invalidShares', 'invalid', 'is'),
    totalHashes: num('totalHashes', 'totalHash', 'th'),
    lastHashTs: lastHash,
    lastAlgo: String(data.la || data.lastShareAlgo || '')
  };
}
function poolFresh(pool) {
  if (!pool?.lastHashTs) return false;
  const seconds = pool.lastHashTs > 1e12 ? pool.lastHashTs / 1000 : pool.lastHashTs;
  return Date.now() / 1000 - seconds <= 15 * 60;
}

async function startMiner() {
  const user = userConfig();
  if (!validWallet(user.wallet)) throw new Error('Salve sua carteira XMR antes de minerar.');

  const current = readJson(PROCESS_FILE, {});
  if (processAlive(current.pid)) return { alreadyRunning: true, pid: current.pid };

  const beforePool = await xmrPoolStats(user.wallet);
  const meta = await ensureMiner(user.engineMode || 'stable');
  const configFile = meta.engine === 'moneroocean-advanced' ? ADV_CONFIG_FILE : STOCK_CONFIG_FILE;
  const built = buildMinerConfig(user, meta, configFile);
  writeJson(configFile, built.config);

  const logOffset = fs.existsSync(XMRIG_LOG) ? fs.statSync(XMRIG_LOG).size : 0;
  const out = fs.openSync(XMRIG_LOG, 'a');

  const args = [
    '-c', configFile,
    '--http-host=127.0.0.1',
    '--http-port=18080',
    '--threads', String(built.threads)
  ];

  minerChild = spawn(meta.exe, args, {
    cwd: path.dirname(meta.exe),
    stdio: ['ignore', out, out],
    windowsHide: true,
    detached: false
  });

  const processState = {
    pid: minerChild.pid,
    desiredRunning: true,
    sessionId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    restarts: 0,
    engine: meta.engine,
    threads: built.threads,
    openclRequested: built.openclEnabled,
    logOffset,
    baseline: {
      totalEarnedXmr: Number(beforePool?.dueXmr || 0) + Number(beforePool?.paidXmr || 0),
      validShares: Number(beforePool?.validShares || 0),
      invalidShares: Number(beforePool?.invalidShares || 0)
    }
  };
  writeJson(PROCESS_FILE, processState);

  minerChild.on('exit', code => {
    const state = readJson(PROCESS_FILE, {});
    state.stoppedAt = new Date().toISOString();
    state.exitCode = code;
    writeJson(PROCESS_FILE, state);
    minerChild = null;
  });

  return { started: true, pid: minerChild.pid, engine: meta.engine, threads: built.threads };
}

function stopMiner() {
  const state = readJson(PROCESS_FILE, {});
  state.desiredRunning = false;
  state.userStoppedAt = new Date().toISOString();
  if (processAlive(state.pid)) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(state.pid), '/T', '/F'], { windowsHide: true });
    else { try { process.kill(Number(state.pid), 'SIGTERM'); } catch {} }
  }
  writeJson(PROCESS_FILE, state);
  minerChild = null;
  return { stopped: true };
}

async function restartMiner() {
  const state = readJson(PROCESS_FILE, {});
  if (processAlive(state.pid)) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(state.pid), '/T', '/F'], { windowsHide: true });
    else { try { process.kill(Number(state.pid), 'SIGTERM'); } catch {} }
  }
  await new Promise(resolve => setTimeout(resolve, 900));
  state.desiredRunning = true;
  writeJson(PROCESS_FILE, state);
  return startMiner();
}

async function xapi(endpoint) {
  try {
    const response = await fetch(`http://127.0.0.1:18080${endpoint}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(1600)
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function readLogSince(offset = 0, maxBytes = 768 * 1024) {
  try {
    const size = fs.statSync(XMRIG_LOG).size;
    const start = Math.max(Number(offset || 0), size - maxBytes, 0);
    const length = Math.max(0, size - start);
    if (!length) return '';
    const fd = fs.openSync(XMRIG_LOG, 'r');
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    fs.closeSync(fd);
    return buffer.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
  } catch {
    return '';
  }
}
function parseHashValue(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const u = String(unit || 'H/s').toLowerCase();
  if (u.startsWith('kh')) return n * 1e3;
  if (u.startsWith('mh')) return n * 1e6;
  if (u.startsWith('gh')) return n * 1e9;
  return n;
}
function parseXmrigLog(text) {
  const result = {
    hashrate: 0,
    hashrate60s: 0,
    hashrate15m: 0,
    accepted: 0,
    rejected: 0,
    algo: '',
    calibrating: false,
    calibrationText: '',
    hugePagesPct: null,
    msr: 'unknown',
    openclActive: false,
    lastActivity: ''
  };
  if (!text) return result;

  const speedRe = /speed\s+10s\/60s\/15m\s+([0-9.]+|n\/a)\s+([0-9.]+|n\/a)\s+([0-9.]+|n\/a)\s+([kmg]?h\/s)/ig;
  let match;
  while ((match = speedRe.exec(text))) {
    result.hashrate = match[1].toLowerCase() === 'n/a' ? 0 : parseHashValue(match[1], match[4]);
    result.hashrate60s = match[2].toLowerCase() === 'n/a' ? 0 : parseHashValue(match[2], match[4]);
    result.hashrate15m = match[3].toLowerCase() === 'n/a' ? 0 : parseHashValue(match[3], match[4]);
    result.lastActivity = match[0];
  }

  const acceptedMatches = text.match(/\baccepted\b/ig);
  const rejectedMatches = text.match(/\brejected\b/ig);
  result.accepted = acceptedMatches ? acceptedMatches.length : 0;
  result.rejected = rejectedMatches ? rejectedMatches.length : 0;

  const algoMatches = [...text.matchAll(/(?:algo(?:rithm)?|new job[^\n]*?)\s+([a-z0-9_.\/-]+)/ig)];
  if (algoMatches.length) result.algo = String(algoMatches.at(-1)[1] || '').toLowerCase();

  const hugeMatches = [...text.matchAll(/huge pages[^\n]*?(\d{1,3})%/ig)];
  if (hugeMatches.length) result.hugePagesPct = Number(hugeMatches.at(-1)[1]);

  if (/msr[^\n]*(?:set successfully|register values.*set)/i.test(text)) result.msr = 'ok';
  if (/msr[^\n]*(?:failed|cannot|permission|error)/i.test(text)) result.msr = 'error';

  result.openclActive = /opencl[^\n]*(?:ready|gpu|device)/i.test(text);
  const calibrationLines = text.split(/\r?\n/).filter(line => /bench|benchmark|calibrat|algo[_ -]?perf/i.test(line));
  if (calibrationLines.length) {
    const tail = calibrationLines.slice(-1)[0].trim();
    const lastSpeedIndex = text.toLowerCase().lastIndexOf('speed 10s/60s/15m');
    const lastBenchIndex = Math.max(
      text.toLowerCase().lastIndexOf('benchmark'),
      text.toLowerCase().lastIndexOf('bench '),
      text.toLowerCase().lastIndexOf('algo-perf')
    );
    result.calibrating = lastBenchIndex > lastSpeedIndex;
    result.calibrationText = tail.slice(0, 180);
  }
  return result;
}

function normalizeBackends(backends) {
  const list = Array.isArray(backends?.backends) ? backends.backends : Array.isArray(backends) ? backends : [];
  return list.map(item => {
    const total = item?.hashrate?.total;
    const hashrate = Array.isArray(total) ? Number(total[0] || 0) : Number(item?.hashrate || 0);
    return {
      type: String(item?.type || item?.name || '').toLowerCase(),
      enabled: item?.enabled !== false,
      hashrate
    };
  });
}

async function networkStats() {
  try {
    const response = await fetch('https://api.moneroocean.stream/network/stats', {
      headers: { accept: 'application/json', 'user-agent': `IdeaGold/${VERSION}` },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    let reward = Number(data.value || 0);
    if (reward > 1e6) reward /= 1e12;
    if (!(reward > 0 && reward < 10)) throw new Error('recompensa XMR inválida');
    const result = {
      difficulty: Number(data.difficulty || 0),
      reward,
      height: Number(data.height || data.main_height || 0),
      at: Date.now(),
      source: 'MoneroOcean network/stats'
    };
    if (!(result.difficulty > 0)) throw new Error('dificuldade XMR inválida');
    writeJson(NETWORK_CACHE_FILE, result);
    return result;
  } catch {
    const cached = readJson(NETWORK_CACHE_FILE, null);
    if (cached && Date.now() - Number(cached.at || 0) < 30 * 60_000) return { ...cached, cached: true };
    return null;
  }
}

async function priceCoinGecko() {
  const headers = { accept: 'application/json', 'user-agent': `IdeaGold/${VERSION}` };
  if (process.env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
  const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=brl,usd&include_24hr_change=true', {
    headers, signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`CoinGecko ${response.status}`);
  const data = (await response.json()).monero;
  const brl = Number(data?.brl || 0), usd = Number(data?.usd || 0);
  if (!(brl > 0 || usd > 0)) throw new Error('CoinGecko sem preço');
  return { brl, usd, change24h: Number(data?.brl_24h_change || 0), source: 'CoinGecko' };
}
async function priceCryptoCompare() {
  const response = await fetch('https://min-api.cryptocompare.com/data/price?fsym=XMR&tsyms=BRL,USD&extraParams=IdeaGold', {
    headers: { accept: 'application/json', 'user-agent': `IdeaGold/${VERSION}` },
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`CryptoCompare ${response.status}`);
  const data = await response.json();
  const brl = Number(data?.BRL || 0), usd = Number(data?.USD || 0);
  if (!(brl > 0 || usd > 0)) throw new Error('CryptoCompare sem preço');
  return { brl, usd, change24h: 0, source: 'CryptoCompare' };
}
async function priceKrakenFx() {
  const [krakenResponse, fxResponse] = await Promise.all([
    fetch('https://api.kraken.com/0/public/Ticker?pair=XMRUSD', {
      headers: { accept: 'application/json', 'user-agent': `IdeaGold/${VERSION}` },
      signal: AbortSignal.timeout(5000)
    }),
    fetch('https://api.frankfurter.dev/v2/rate/USD/BRL', {
      headers: { accept: 'application/json', 'user-agent': `IdeaGold/${VERSION}` },
      signal: AbortSignal.timeout(5000)
    })
  ]);
  if (!krakenResponse.ok || !fxResponse.ok) throw new Error('Kraken/FX indisponível');
  const kraken = await krakenResponse.json();
  const ticker = Object.values(kraken?.result || {})[0];
  const usd = Number(ticker?.c?.[0] || 0);
  const fx = await fxResponse.json();
  const usdBrl = Number(fx?.rate || 0);
  if (!(usd > 0 && usdBrl > 0)) throw new Error('Kraken/FX inválido');
  return { brl: usd * usdBrl, usd, change24h: 0, source: 'Kraken XMR/USD + Frankfurter USD/BRL' };
}
async function marketPrice() {
  const attempts = [priceCoinGecko, priceCryptoCompare, priceKrakenFx];
  for (const fn of attempts) {
    try {
      const value = await fn();
      const result = { ...value, at: Date.now(), cached: false };
      writeJson(MARKET_CACHE_FILE, result);
      return result;
    } catch {}
  }
  const cached = readJson(MARKET_CACHE_FILE, null);
  if (cached && Date.now() - Number(cached.at || 0) < 15 * 60_000) {
    return { ...cached, cached: true, ageSec: (Date.now() - Number(cached.at || 0)) / 1000 };
  }
  return null;
}

function workerSummary() {
  const store = readJson(WORKERS_FILE, { workers: {} });
  const now = Date.now();
  const workers = Object.values(store.workers || {}).map(item => ({
    ...item,
    online: now - new Date(item.lastSeen).getTime() < 45_000
  }));
  const online = workers.filter(item => item.online);
  return {
    workers,
    online: online.length,
    hashrate: online.reduce((sum, item) => sum + Number(item.hashrate || 0), 0),
    powerWatts: online.reduce((sum, item) => sum + Number(item.powerWatts || 0), 0),
    cloudCostBrlDay: online.reduce((sum, item) => sum + Number(item.cloudCostBrlDay || 0), 0)
  };
}
function verifyWorker(req, raw) {
  if (!WORKER_SECRET || WORKER_SECRET === 'troque-por-um-segredo-forte') return false;
  const timestamp = String(req.headers['x-ideagold-timestamp'] || '');
  const signature = String(req.headers['x-ideagold-signature'] || '');
  if (!/^\d{10,16}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 300_000) return false;
  const expected = crypto.createHmac('sha256', WORKER_SECRET).update(timestamp).update('.').update(raw).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function estimatorSamples() {
  return readJson(ESTIMATOR_FILE, { samples: [] });
}
function appendEstimatorSample(row) {
  const state = estimatorSamples();
  const previous = state.samples.at(-1);
  if (!previous || row.ts - previous.ts >= 20_000 || row.sessionId !== previous.sessionId) state.samples.push(row);
  state.samples = state.samples
    .filter(item => Date.now() - Number(item.ts) < 72 * 3600_000)
    .slice(-6000);
  writeJson(ESTIMATOR_FILE, state);
  return state.samples;
}

function estimatePower(user, miningState, gpuActive, remote) {
  const measured = Number(user.measuredPowerWatts || 0);
  if (measured > 0) {
    return {
      localWatts: ['hashing', 'pool-confirmed', 'calibrating', 'starting'].includes(miningState) ? measured : 0,
      source: 'measured',
      label: 'medido pelo usuário'
    };
  }
  if (!['hashing', 'pool-confirmed', 'calibrating', 'starting'].includes(miningState)) {
    return { localWatts: 0, source: 'estimated', label: 'estimado; minerador parado' };
  }
  const local = Number(user.basePowerWatts || 30) + Number(user.cpuPowerWatts || 75) + (gpuActive ? Number(user.gpuPowerWatts || 47) : 0);
  return { localWatts: local, source: 'estimated', label: 'estimado pelo perfil de hardware' };
}

function chooseState({ pidAlive, hashrate, poolIsFresh, poolHashrate, calibrating, startedAt }) {
  if (!pidAlive) return 'stopped';
  if (hashrate > 0) return 'hashing';
  if (poolIsFresh && poolHashrate > 0) return 'pool-confirmed';
  if (calibrating) return 'calibrating';
  const ageMs = startedAt ? Date.now() - new Date(startedAt).getTime() : Infinity;
  if (ageMs < 120_000) return 'starting';
  return 'stalled';
}

async function status(req) {
  const user = userConfig();
  const processState = readJson(PROCESS_FILE, {});
  const workers = workerSummary();

  const [summary, backendsRaw, pool, network, market] = await Promise.all([
    xapi('/2/summary'),
    xapi('/2/backends'),
    xmrPoolStats(user.wallet),
    networkStats(),
    marketPrice()
  ]);

  const log = parseXmrigLog(readLogSince(processState.logOffset || 0));
  const pidAlive = processAlive(processState.pid);
  const apiHash = Number(summary?.hashrate?.total?.[0] || 0);
  const localHashrate = apiHash > 0 ? apiHash : Number(log.hashrate || 0);
  const localHash60s = Number(summary?.hashrate?.total?.[1] || log.hashrate60s || 0);
  const localHash15m = Number(summary?.hashrate?.total?.[2] || log.hashrate15m || 0);
  const poolIsFresh = poolFresh(pool);
  const poolHashrate = poolIsFresh ? Number(pool?.normalizedHashrate || 0) : 0;
  const backendList = normalizeBackends(backendsRaw);
  const gpuActive = backendList.some(item => /opencl|cuda/.test(item.type) && item.enabled && item.hashrate > 0) || log.openclActive;

  const state = chooseState({
    pidAlive,
    hashrate: localHashrate,
    poolIsFresh,
    poolHashrate,
    calibrating: log.calibrating,
    startedAt: processState.startedAt
  });

  const localAccepted = summary ? Number(summary?.connection?.accepted || 0) : Number(log.accepted || 0);
  const localRejected = summary ? Number(summary?.connection?.rejected || 0) : Number(log.rejected || 0);
  const baselineShares = Number(processState.baseline?.validShares || 0);
  const baselineInvalid = Number(processState.baseline?.invalidShares || 0);
  const sessionPoolShares = Math.max(0, Number(pool?.validShares || 0) - baselineShares);
  const sessionPoolInvalid = Math.max(0, Number(pool?.invalidShares || 0) - baselineInvalid);
  const sessionAccepted = Math.max(localAccepted, sessionPoolShares);
  const sessionRejected = Math.max(localRejected, sessionPoolInvalid);

  const algo = String(summary?.connection?.algo || log.algo || '').toLowerCase();
  const totalEarned = Number(pool?.dueXmr || 0) + Number(pool?.paidXmr || 0);
  const baselineEarned = Number(processState.baseline?.totalEarnedXmr || totalEarned || 0);
  const sessionEarned = Math.max(0, totalEarned - baselineEarned);

  const effectiveHashrate = poolHashrate > 0 ? poolHashrate : (localHashrate + Number(workers.hashrate || 0));
  const allSamples = validWallet(user.wallet)
    ? appendEstimatorSample({
        ts: Date.now(),
        sessionId: processState.sessionId || 'no-session',
        totalEarnedXmr: totalEarned,
        sessionEarnedXmr: sessionEarned,
        effectiveHashrate
      })
    : estimatorSamples().samples || [];

  const sessionSamples = allSamples.filter(row => row.sessionId === processState.sessionId);
  const empirical = G.weightedRegressionRate(sessionSamples, { horizonMs: 12 * 3600_000 });
  const poolRate = network && poolHashrate > 0
    ? G.networkXmrRate(poolHashrate, network.difficulty, network.reward, 0.99)
    : 0;

  const stableRandomX = processState.engine !== 'moneroocean-advanced' || /rx\/0|randomx/.test(algo);
  const localRate = network && localHashrate > 0 && stableRandomX
    ? G.networkXmrRate(localHashrate + Number(workers.hashrate || 0), network.difficulty, network.reward, 0.99)
    : 0;

  const hybrid = G.hybridRateEstimate({
    empiricalRate: empirical.rate,
    empiricalConfidence: empirical.confidence,
    poolRate,
    poolConfidence: poolHashrate > 0 ? 0.85 : 0,
    localRate,
    localConfidence: localRate > 0 ? 0.55 : 0
  });

  const variability = G.hashVariability(sessionSamples);
  const nextGain = G.nextDynamicGain({
    sessionEarnedXmr: sessionEarned,
    xmrPerSec: hybrid.rate,
    samples: sessionSamples,
    rateCv: Math.max(variability.cv, (1 - hybrid.confidence) * 0.35)
  });

  const shareDifficulty = Number(summary?.connection?.diff || 0);
  const shareEta = G.shareArrivalEstimate(localHashrate, shareDifficulty);

  const power = estimatePower(user, state, gpuActive, workers);
  const totalPowerWatts = power.localWatts + Number(workers.powerWatts || 0);
  const priceBrl = Number(market?.brl || 0);
  const profitAvailable = hybrid.rate > 0 && priceBrl > 0;
  const projection = profitAvailable
    ? G.projectionTable({
        xmrPerSec: hybrid.rate,
        priceBrl,
        electricityBrlKwh: Number(user.electricity || 0),
        powerWatts: totalPowerWatts,
        cloudCostBrlDay: Number(workers.cloudCostBrlDay || 0)
      })
    : null;

  const risk = profitAvailable
    ? G.monteCarloProfit({
        xmrPerSec: hybrid.rate,
        priceBrl,
        electricityBrlKwh: Number(user.electricity || 0),
        powerWatts: totalPowerWatts,
        cloudCostBrlDay: Number(workers.cloudCostBrlDay || 0),
        simulations: 8000,
        days: 30,
        seed: Math.floor(Date.now() / 300_000)
      })
    : null;

  const currentMeta = processState.engine === 'moneroocean-advanced'
    ? readJson(ADV_META_FILE, readJson(LEGACY_META_FILE, {}))
    : readJson(STOCK_META_FILE, {});

  const minerInstalled = Boolean(
    (readJson(STOCK_META_FILE, {}).exe && fs.existsSync(readJson(STOCK_META_FILE, {}).exe || '')) ||
    (readJson(ADV_META_FILE, {}).exe && fs.existsSync(readJson(ADV_META_FILE, {}).exe || '')) ||
    (readJson(LEGACY_META_FILE, {}).exe && fs.existsSync(readJson(LEGACY_META_FILE, {}).exe || ''))
  );

  return {
    version: VERSION,
    configured: validWallet(user.wallet),
    walletFull: isLoopback(req) ? user.wallet : '',
    walletMasked: maskWallet(user.wallet),
    settings: user,
    hardware: hardwareProfile(),
    session: {
      id: processState.sessionId || null,
      startedAt: processState.startedAt || null,
      earnedXmrReal: sessionEarned,
      baselineTotalXmr: baselineEarned,
      acceptedShares: sessionAccepted,
      rejectedShares: sessionRejected
    },
    miner: {
      installed: minerInstalled,
      verified: Boolean(currentMeta.verified),
      engine: processState.engine || currentMeta.engine || null,
      source: currentMeta.source || null,
      version: currentMeta.version || null,
      processRunning: pidAlive,
      mining: state === 'hashing' || state === 'pool-confirmed',
      state,
      pid: processState.pid || null,
      hashrate: localHashrate,
      hashrate60s: localHash60s,
      hashrate15m: localHash15m,
      effectiveHashrate,
      algo,
      pool: summary?.connection?.pool || `${POOL_HOST}:${POOL_PORT}`,
      gpuActive,
      backends: backendList,
      telemetrySource: summary ? 'xmrig-api' : (log.hashrate > 0 ? 'xmrig-log' : 'none'),
      diagnostics: {
        calibrating: log.calibrating,
        calibrationText: log.calibrationText,
        hugePagesPct: log.hugePagesPct,
        msr: log.msr,
        openclRequested: Boolean(processState.openclRequested),
        threads: Number(processState.threads || recommendedThreads(user))
      }
    },
    pool: pool ? {
      ...pool,
      fresh: poolIsFresh,
      totalEarnedXmr: totalEarned
    } : null,
    workers,
    network,
    market: market ? {
      xmrBRL: Number(market.brl || 0),
      xmrUSD: Number(market.usd || 0),
      change24h: Number(market.change24h || 0),
      source: market.source,
      cached: Boolean(market.cached),
      ageSec: Number(market.ageSec || 0)
    } : null,
    estimator: {
      available: hybrid.rate > 0,
      xmrPerSecond: hybrid.rate,
      xmrPerHour: hybrid.rate * 3600,
      confidence: hybrid.confidence,
      sources: hybrid.sources,
      empirical,
      nextGain,
      shareEta,
      sampleCount: sessionSamples.length
    },
    profit: {
      available: profitAvailable,
      ...(projection || {}),
      powerWatts: totalPowerWatts,
      localPowerWatts: power.localWatts,
      powerSource: power.source,
      powerLabel: power.label,
      cloudCostBrlDay: Number(workers.cloudCostBrlDay || 0),
      risk
    }
  };
}

function serveStatic(res, pathname) {
  const file = pathname === '/' || pathname === '/index.html' ? 'index-v4.html' : null;
  if (!file) return false;
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    sendJson(res, 404, { error: 'Arquivo não encontrado.' });
    return true;
  }
  const data = fs.readFileSync(full);
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-cache'
  });
  res.end(data);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && serveStatic(res, url.pathname)) return;
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, name: 'IdeaGold GoldBrain', version: VERSION, time: new Date().toISOString() });
    }
    if (req.method === 'GET' && url.pathname === '/api/simple/status') {
      return sendJson(res, 200, await status(req));
    }
    if (req.method === 'GET' && url.pathname === '/api/workers') {
      requireLocal(req);
      return sendJson(res, 200, workerSummary());
    }

    if (req.method === 'POST' && url.pathname === '/api/workers/heartbeat') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks);
      if (!verifyWorker(req, raw)) return sendJson(res, 401, { error: 'Assinatura inválida.' });
      const data = JSON.parse(raw.toString('utf8'));
      const id = String(data.id || '').slice(0, 80);
      if (!/^[\w.-]+$/.test(id)) throw new Error('Worker inválido.');
      const store = readJson(WORKERS_FILE, { workers: {} });
      store.workers[id] = { ...data, id, lastSeen: new Date().toISOString() };
      writeJson(WORKERS_FILE, store);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/simple/')) {
      requireLocal(req);
      const action = url.pathname.split('/').at(-1);
      if (action === 'wallet') return sendJson(res, 200, { ok: true, user: saveUser(await readBody(req)) });
      if (action === 'settings') {
        const body = await readBody(req);
        const current = userConfig();
        return sendJson(res, 200, { ok: true, user: saveUser({ ...current, ...body, wallet: current.wallet }) });
      }
      if (action === 'install') {
        const user = userConfig();
        return sendJson(res, 200, { ok: true, miner: await ensureMiner(user.engineMode || 'stable') });
      }
      if (action === 'start') return sendJson(res, 200, { ok: true, result: await startMiner() });
      if (action === 'stop') return sendJson(res, 200, { ok: true, result: stopMiner() });
      if (action === 'restart') return sendJson(res, 200, { ok: true, result: await restartMiner() });
    }

    return sendJson(res, 404, { error: 'Rota não encontrada.' });
  } catch (error) {
    console.error(error);
    return sendJson(res, error.status || 500, { error: error.message || 'Erro interno.' });
  }
});

async function watchdog() {
  if (watchdogBusy) return;
  watchdogBusy = true;
  try {
    const state = readJson(PROCESS_FILE, {});
    if (state.desiredRunning && !processAlive(state.pid) && validWallet(userConfig().wallet)) {
      const restarts = Number(state.restarts || 0);
      if (restarts < 5) {
        state.restarts = restarts + 1;
        writeJson(PROCESS_FILE, state);
        await startMiner();
      }
    }
  } catch (error) {
    console.error('watchdog:', error.message);
  } finally {
    watchdogBusy = false;
  }
}
setInterval(watchdog, 30_000).unref();

server.listen(PORT, HOST, () => {
  console.log(`\nIdeaGold ${VERSION}: http://${HOST}:${PORT}`);
  console.log('Estado real: processo, hashrate local, pool, preço e ETA só aparecem quando a fonte existe.');
});
