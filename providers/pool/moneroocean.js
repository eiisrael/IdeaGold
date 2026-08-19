'use strict';

class MoneroOceanAdapter {
  constructor() {
    this.id = 'moneroocean';
    this.name = 'MoneroOcean';
    this.host = 'gulf.moneroocean.stream';
    this.port = 20128;
    this.tls = true;
  }
  connection(worker = 'IdeaGold') {
    return {
      id: this.id,
      name: this.name,
      host: this.host,
      port: this.port,
      tls: true,
      passwordBuilder: w => `${w || worker}~rx/0`
    };
  }
  async fetchJson(url, timeout = 5000) {
    const started = performance.now();
    const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'IdeaGold/5.0' }, signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error(`MoneroOcean HTTP ${r.status}`);
    return { data: await r.json(), latencyMs: performance.now() - started };
  }
  async walletStats(wallet) {
    if (!wallet) return { available: false, reason: 'wallet-not-configured' };
    try {
      const { data, latencyMs } = await this.fetchJson(`https://api.moneroocean.stream/miner/${encodeURIComponent(wallet)}/stats`);
      const n = (...keys) => {
        for (const key of keys) if (data[key] !== undefined && data[key] !== null) return Number(data[key]) || 0;
        return 0;
      };
      const last = n('lastHash', 'lastShare', 'lts', 'last');
      const lastShareTs = last > 1e12 ? last : last * 1000;
      return {
        available: true,
        adapter: this.id,
        dueXmr: n('amtDue', 'due', 'balance') / 1e12,
        paidXmr: n('amtPaid', 'paid') / 1e12,
        hashrate: n('hash2', 'hash', 'hashrate'),
        rawHashrate: n('hash', 'hashrate'),
        accepted: n('validShares', 'valid', 'vs'),
        rejected: n('invalidShares', 'invalid', 'is'),
        stale: data.staleShares !== undefined ? Number(data.staleShares) || 0 : null,
        totalHashes: n('totalHashes', 'totalHash', 'th'),
        lastShareTs: lastShareTs || null,
        lastAlgo: String(data.la || data.lastShareAlgo || ''),
        latencyMs,
        payoutMinimumXmr: null,
        payoutMinimumSource: 'wallet-setting-not-exposed-by-this-endpoint',
        raw: data
      };
    } catch (error) {
      return { available: false, adapter: this.id, reason: error.message };
    }
  }
  async networkStats() {
    try {
      const { data, latencyMs } = await this.fetchJson('https://api.moneroocean.stream/network/stats');
      let reward = Number(data.value || data.reward || 0);
      if (reward > 1e6) reward /= 1e12;
      const difficulty = Number(data.difficulty || 0);
      const target = Number(data.target || data.block_time || 120) || 120;
      return {
        available: difficulty > 0 && reward > 0,
        difficulty,
        reward,
        height: Number(data.height || data.main_height || 0),
        networkHashrate: difficulty > 0 ? difficulty / target : 0,
        targetSeconds: target,
        latencyMs,
        source: 'MoneroOcean network/stats'
      };
    } catch (error) {
      return { available: false, reason: error.message, source: 'MoneroOcean network/stats' };
    }
  }
  async workers(wallet) {
    if (!wallet) return { available: false, workers: [] };
    try {
      const { data, latencyMs } = await this.fetchJson(`https://api.moneroocean.stream/miner/${encodeURIComponent(wallet)}/allWorkers`);
      const rows = Array.isArray(data) ? data : Object.entries(data || {}).map(([name, value]) => ({ name, ...value }));
      return { available: true, workers: rows, latencyMs };
    } catch (error) {
      return { available: false, workers: [], reason: error.message };
    }
  }
}

module.exports = { MoneroOceanAdapter };
