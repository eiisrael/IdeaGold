'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');

function tcpProbe(host, port, timeout = 900) {
  return new Promise(resolve => {
    const started = performance.now();
    const s = net.createConnection({ host, port });
    const done = ok => { try { s.destroy(); } catch {} resolve({ ok, latencyMs: ok ? performance.now() - started : null }); };
    s.setTimeout(timeout);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

class P2PoolAdapter {
  constructor(options = {}) {
    this.id = 'p2pool';
    this.name = 'P2Pool local';
    this.host = options.host || '127.0.0.1';
    this.port = Number(options.port || 3333);
    this.dataApi = options.dataApi || process.env.P2POOL_DATA_API || '';
    this.sidechain = options.sidechain || 'main';
  }
  connection() {
    return { id: this.id, name: this.name, host: this.host, port: this.port, tls: false, password: 'x' };
  }
  async detect() {
    const stratum = await tcpProbe(this.host, this.port);
    const root = this.dataApi ? path.resolve(this.dataApi) : null;
    return {
      available: stratum.ok,
      stratum,
      dataApi: root && fs.existsSync(root) ? root : null,
      sidechain: this.sidechain,
      note: root && fs.existsSync(root) ? 'P2Pool Stratum + data-api detectados.' : 'Stratum pode funcionar; configure P2POOL_DATA_API para métricas locais detalhadas.'
    };
  }
  async walletStats() {
    const detected = await this.detect();
    if (!detected.available) return { available: false, adapter: this.id, reason: 'local-stratum-offline' };
    if (!detected.dataApi) {
      return { available: true, adapter: this.id, mode: 'stratum-only', hashrate: null, dueXmr: null, paidXmr: null,
        accepted: null, rejected: null, stale: null, latencyMs: detected.stratum.latencyMs,
        reason: 'P2POOL_DATA_API não configurado; métricas não serão inventadas.' };
    }
    const local = readJson(path.join(detected.dataApi, 'local', 'stratum')) || readJson(path.join(detected.dataApi, 'local', 'stratum.json'));
    const p2pool = readJson(path.join(detected.dataApi, 'local', 'p2pool')) || readJson(path.join(detected.dataApi, 'local', 'p2pool.json'));
    return {
      available: true,
      adapter: this.id,
      mode: 'data-api',
      hashrate: Number(local?.hashrate_15m ?? local?.hashrate ?? 0) || null,
      dueXmr: null,
      paidXmr: null,
      accepted: Number(local?.shares_found ?? local?.shares ?? 0) || null,
      rejected: Number(local?.shares_failed ?? local?.rejected ?? 0) || null,
      stale: null,
      effort: Number(p2pool?.sidechain?.effort ?? p2pool?.effort ?? 0) || null,
      sidechain: this.sidechain,
      latencyMs: detected.stratum.latencyMs,
      raw: { local, p2pool }
    };
  }
  async networkStats() {
    const detected = await this.detect();
    if (!detected.dataApi) return { available: false, source: 'P2Pool local data-api', reason: 'P2POOL_DATA_API not configured' };
    const network = readJson(path.join(detected.dataApi, 'network', 'stats')) || readJson(path.join(detected.dataApi, 'network', 'stats.json'));
    if (!network) return { available: false, source: 'P2Pool local data-api', reason: 'network/stats unavailable' };
    return {
      available: true,
      difficulty: Number(network.difficulty || 0),
      reward: Number(network.reward || 0),
      height: Number(network.height || 0),
      networkHashrate: Number(network.hash || network.hashrate || 0),
      source: 'P2Pool local data-api'
    };
  }
}

module.exports = { P2PoolAdapter, tcpProbe };
