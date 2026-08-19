const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

loadEnv();

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.ndjson');
const MAX_BODY = 1024 * 1024;
const workerSecret = process.env.WORKER_SHARED_SECRET || '';
const allowedExchanges = new Set((process.env.ALLOWED_EXCHANGES || 'mercado,kraken').split(',').map(x=>x.trim()).filter(Boolean));
const marketCache = { at: 0, data: null };
const rateBuckets = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
let state = readJson(STATE_FILE, { workers: {}, createdAt: new Date().toISOString() });

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
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function persistState() {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}
function audit(type, payload) {
  const safe = { ts: new Date().toISOString(), type, ...payload };
  fs.appendFileSync(AUDIT_FILE, JSON.stringify(safe) + '\n');
}
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, securityHeaders({
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  }));
  res.end(body);
}
function securityHeaders(extra={}) {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    ...extra
  };
}
function ipOf(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}
function rateLimit(req, limit=180, windowMs=60_000) {
  const key = ipOf(req);
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || now - b.start > windowMs) { rateBuckets.set(key, { start: now, count: 1 }); return true; }
  b.count++;
  return b.count <= limit;
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Payload muito grande'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  let json = {};
  if (raw.length) {
    try { json = JSON.parse(raw.toString('utf8')); }
    catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
  }
  return { raw, json };
}
function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
function powProfit(input={}) {
  const algorithm = input.algorithm === 'randomx' ? 'randomx' : 'sha256';
  const hashrate = Math.max(0, Number(input.hashrate || 0));
  const difficulty = Math.max(1, Number(input.difficulty || 1));
  const reward = Math.max(0, Number(input.blockReward || 0));
  const price = Math.max(0, Number(input.price || 0));
  const uptime = clamp(input.uptime ?? 99, 0, 100) / 100;
  const poolFee = clamp(input.poolFee ?? 1, 0, 100) / 100;
  const powerWatts = Math.max(0, Number(input.powerWatts || 0));
  const electricity = Math.max(0, Number(input.electricityCostKwh || 0));
  const cloudCost = Math.max(0, Number(input.cloudCostPerDay || 0));

  const expectedHashesPerBlock = algorithm === 'randomx' ? difficulty : difficulty * 2 ** 32;
  const expectedBlocksDay = (hashrate * 86400 * uptime) / expectedHashesPerBlock;
  const coinsGross = expectedBlocksDay * reward;
  const coinsNet = coinsGross * (1 - poolFee);
  const revenue = coinsNet * price;
  const powerCost = (powerWatts / 1000) * 24 * electricity;
  const cost = powerCost + cloudCost;
  const net = revenue - cost;
  return {
    algorithm, expectedBlocksDay, coinsGross, coinsNet, revenue, powerCost, cloudCost,
    totalCost: cost, net, marginPct: revenue > 0 ? (net / revenue) * 100 : 0,
    breakEvenAssetPrice: coinsNet > 0 ? cost / coinsNet : null
  };
}
async function fetchMarket() {
  if (marketCache.data && Date.now() - marketCache.at < 45_000) return marketCache.data;
  const ids = 'bitcoin,monero,ethereum,litecoin';
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,brl&include_24hr_change=true&include_last_updated_at=true`;
  const headers = { accept: 'application/json', 'user-agent': 'IdeaGold/2.0' };
  if (process.env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`);
  const data = await response.json();
  marketCache.at = Date.now();
  marketCache.data = data;
  return data;
}
function workerStats() {
  const now = Date.now();
  const workers = Object.values(state.workers).map(w => ({
    ...w,
    online: now - new Date(w.lastSeen).getTime() < 45_000
  }));
  const online = workers.filter(w=>w.online);
  const totalHashrate = online.reduce((s,w)=>s + Number(w.hashrate || 0), 0);
  return { workers, online: online.length, total: workers.length, totalHashrate };
}
function verifyHeartbeat(req, raw) {
  if (!workerSecret || workerSecret === 'troque-por-um-segredo-forte') return { ok:false, error:'WORKER_SHARED_SECRET não configurado com segurança' };
  const ts = String(req.headers['x-ideagold-timestamp'] || '');
  const sig = String(req.headers['x-ideagold-signature'] || '');
  if (!/^\d{10,16}$/.test(ts) || !/^[a-f0-9]{64}$/i.test(sig)) return { ok:false, error:'assinatura ausente' };
  const age = Math.abs(Date.now() - Number(ts));
  if (age > 5 * 60_000) return { ok:false, error:'assinatura expirada' };
  const expected = crypto.createHmac('sha256', workerSecret).update(ts).update('.').update(raw).digest('hex');
  const a = Buffer.from(sig, 'hex'), b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return { ok:false, error:'assinatura inválida' };
  return { ok:true };
}
function cleanWorker(body) {
  const id = String(body.id || '').trim().slice(0,80);
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(id)) throw Object.assign(new Error('worker id inválido'), {status:400});
  return {
    id,
    name: String(body.name || id).slice(0,100),
    coin: String(body.coin || 'XMR').toUpperCase().slice(0,10),
    hashrate: Math.max(0, Number(body.hashrate || 0)),
    hashrate60s: Math.max(0, Number(body.hashrate60s || 0)),
    hashrate15m: Math.max(0, Number(body.hashrate15m || 0)),
    accepted: Math.max(0, Number(body.accepted || 0)),
    rejected: Math.max(0, Number(body.rejected || 0)),
    uptime: Math.max(0, Number(body.uptime || 0)),
    pool: String(body.pool || '').slice(0,180),
    minerVersion: String(body.minerVersion || '').slice(0,80),
    host: String(body.host || '').slice(0,120),
    lastSeen: new Date().toISOString()
  };
}
function safePool(v) {
  const s = String(v || '').trim();
  if (!/^[a-zA-Z0-9._:\-\[\]]{3,200}$/.test(s)) throw Object.assign(new Error('pool inválido'), {status:400});
  return s;
}
function xmrigConfig(body) {
  const wallet = String(body.wallet || '').trim();
  if (wallet.length < 20 || wallet.length > 200) throw Object.assign(new Error('endereço de carteira inválido'), {status:400});
  const pool = safePool(body.pool || '127.0.0.1:3333');
  const worker = String(body.workerName || 'ideagold-rig').replace(/[^a-zA-Z0-9._-]/g,'').slice(0,48) || 'ideagold-rig';
  return {
    autosave: true,
    cpu: true,
    opencl: Boolean(body.opencl),
    cuda: Boolean(body.cuda),
    pools: [{
      coin: String(body.coin || 'monero').toLowerCase(),
      url: pool,
      user: wallet,
      pass: worker,
      rig_id: worker,
      keepalive: true,
      tls: Boolean(body.tls)
    }],
    http: { enabled: true, host: '127.0.0.1', port: Number(body.apiPort || 18080), restricted: true },
    print_time: 30,
    health_print_time: 60
  };
}
let ccxtModule;
async function ccxt() {
  if (!ccxtModule) ccxtModule = require('ccxt');
  return ccxtModule;
}
function exchangeEnv(id) {
  const p = id.toUpperCase().replace(/[^A-Z0-9]/g,'_');
  return {
    apiKey: process.env[`${p}_API_KEY`] || '',
    secret: process.env[`${p}_SECRET`] || '',
    uid: process.env[`${p}_UID`] || '',
    password: process.env[`${p}_PASSWORD`] || ''
  };
}
async function getExchange(id, privateMode=false) {
  id = String(id || 'mercado').toLowerCase();
  if (!allowedExchanges.has(id)) throw Object.assign(new Error('Exchange não permitida'), {status:400});
  const lib = await ccxt();
  const Klass = lib[id];
  if (!Klass) throw Object.assign(new Error('Exchange não suportada pelo CCXT instalado'), {status:400});
  const creds = exchangeEnv(id);
  if (privateMode && (!creds.apiKey || !creds.secret)) throw Object.assign(new Error(`Credenciais ${id} não configuradas no .env`), {status:503});
  return new Klass({ ...creds, enableRateLimit: true, timeout: 15000 });
}
async function exchangeQuote(body) {
  const exchange = await getExchange(body.exchange || 'mercado', false);
  const symbol = String(body.symbol || 'BTC/BRL').toUpperCase();
  const side = body.side === 'buy' ? 'buy' : 'sell';
  const amount = Math.max(0, Number(body.amount || 0));
  if (!amount) throw Object.assign(new Error('Informe amount > 0'), {status:400});
  await exchange.loadMarkets();
  if (!exchange.markets[symbol]) throw Object.assign(new Error(`Par ${symbol} indisponível em ${exchange.id}`), {status:400});
  const ticker = await exchange.fetchTicker(symbol);
  const px = side === 'sell' ? (ticker.bid || ticker.last) : (ticker.ask || ticker.last);
  return { exchange: exchange.id, symbol, side, amount, price: px, estimatedQuote: amount * px, timestamp: ticker.timestamp || Date.now() };
}
async function convertLive(body, req) {
  if (String(process.env.ENABLE_LIVE_TRADING).toLowerCase() !== 'true')
    throw Object.assign(new Error('Trading real está desligado. Defina ENABLE_LIVE_TRADING=true somente após testar.'), {status:403});
  if (body.confirmation !== 'CONVERTER_AGORA')
    throw Object.assign(new Error('Confirmação inválida. Digite CONVERTER_AGORA.'), {status:400});
  const exchange = await getExchange(body.exchange || 'mercado', true);
  const symbol = String(body.symbol || 'BTC/BRL').toUpperCase();
  const side = body.side === 'buy' ? 'buy' : 'sell';
  const amount = Math.max(0, Number(body.amount || 0));
  if (!amount) throw Object.assign(new Error('Informe amount > 0'), {status:400});
  await exchange.loadMarkets();
  if (!exchange.markets[symbol]) throw Object.assign(new Error(`Par ${symbol} indisponível`), {status:400});
  const ticker = await exchange.fetchTicker(symbol);
  const price = side === 'sell' ? (ticker.bid || ticker.last) : (ticker.ask || ticker.last);
  const quote = symbol.split('/')[1];
  const notional = amount * price;
  if (quote === 'BRL') {
    const max = Math.max(1, Number(process.env.MAX_LIVE_TRADE_BRL || 500));
    if (notional > max) throw Object.assign(new Error(`Ordem excede MAX_LIVE_TRADE_BRL=${max}`), {status:403});
  }
  const order = await exchange.createOrder(symbol, 'market', side, amount);
  audit('live_trade', { ip: ipOf(req), exchange: exchange.id, symbol, side, amount, orderId: order.id || null });
  return { ok:true, order: { id: order.id, status: order.status, symbol: order.symbol, side: order.side, amount: order.amount, filled: order.filled, cost: order.cost } };
}
function serveStatic(req, res, urlPath) {
  const map = { '/':'index.html', '/index.html':'index.html' };
  const file = map[urlPath];
  if (!file) return false;
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) { sendJson(res,404,{error:'arquivo não encontrado'}); return true; }
  const data = fs.readFileSync(p);
  res.writeHead(200, securityHeaders({
    'content-type': 'text/html; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-cache'
  }));
  res.end(data);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    if (!rateLimit(req)) return sendJson(res, 429, {error:'Muitas requisições'});
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && serveStatic(req,res,u.pathname)) return;

    if (req.method === 'GET' && u.pathname === '/api/health') {
      return sendJson(res,200,{ok:true,name:'IdeaGold GoldMesh',version:'2.0.0',time:new Date().toISOString(),trading:String(process.env.ENABLE_LIVE_TRADING).toLowerCase()==='true'});
    }
    if (req.method === 'GET' && u.pathname === '/api/market') {
      try { return sendJson(res,200,{source:'coingecko',data:await fetchMarket()}); }
      catch (e) {
        if (marketCache.data) return sendJson(res,200,{source:'coingecko-cache',warning:e.message,data:marketCache.data});
        throw e;
      }
    }
    if (req.method === 'GET' && u.pathname === '/api/workers') return sendJson(res,200,workerStats());

    if (req.method === 'POST' && u.pathname === '/api/workers/heartbeat') {
      const {raw,json} = await readBody(req);
      const verified = verifyHeartbeat(req, raw);
      if (!verified.ok) return sendJson(res,401,{error:verified.error});
      const worker = cleanWorker(json);
      state.workers[worker.id] = worker;
      persistState();
      return sendJson(res,200,{ok:true,serverTime:Date.now()});
    }
    if (req.method === 'POST' && u.pathname === '/api/profitability') {
      const {json} = await readBody(req);
      return sendJson(res,200,{result:powProfit(json)});
    }
    if (req.method === 'POST' && u.pathname === '/api/miner/config') {
      const {json} = await readBody(req);
      return sendJson(res,200,{config:xmrigConfig(json)});
    }
    if (req.method === 'GET' && u.pathname === '/api/exchange/status') {
      const id = String(u.searchParams.get('exchange') || 'mercado').toLowerCase();
      const ex = await getExchange(id,false);
      const creds = exchangeEnv(id);
      return sendJson(res,200,{
        exchange:id,
        allowed:true,
        credentialsConfigured:Boolean(creds.apiKey && creds.secret),
        liveTrading:String(process.env.ENABLE_LIVE_TRADING).toLowerCase()==='true',
        capabilities:{fetchTicker:Boolean(ex.has.fetchTicker),fetchBalance:Boolean(ex.has.fetchBalance),createMarketOrder:Boolean(ex.has.createMarketOrder),withdraw:Boolean(ex.has.withdraw)}
      });
    }
    if (req.method === 'POST' && u.pathname === '/api/exchange/quote') {
      const {json} = await readBody(req);
      return sendJson(res,200,{quote:await exchangeQuote(json)});
    }
    if (req.method === 'POST' && u.pathname === '/api/exchange/balance') {
      const {json} = await readBody(req);
      const ex = await getExchange(json.exchange || 'mercado',true);
      const b = await ex.fetchBalance();
      const totals = {};
      for (const [asset,value] of Object.entries(b.total || {})) if (Number(value)) totals[asset]=value;
      return sendJson(res,200,{exchange:ex.id,total:totals});
    }
    if (req.method === 'POST' && u.pathname === '/api/exchange/convert') {
      const {json} = await readBody(req);
      return sendJson(res,200,await convertLive(json,req));
    }
    return sendJson(res,404,{error:'Rota não encontrada'});
  } catch (e) {
    console.error(e);
    sendJson(res, e.status || 500, { error: e.message || 'Erro interno' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\nIdeaGold 2.0 GoldMesh: http://${HOST}:${PORT}`);
  if (!workerSecret || workerSecret === 'troque-por-um-segredo-forte') console.warn('AVISO: configure WORKER_SHARED_SECRET antes de aceitar workers.');
  if (String(process.env.ENABLE_LIVE_TRADING).toLowerCase() === 'true') console.warn('ATENÇÃO: TRADING REAL ATIVADO.');
});
