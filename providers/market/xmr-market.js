'use strict';

class XmrMarketProvider {
  constructor(db) {
    this.db = db;
    this.cache = null;
  }
  async fetchJson(url, headers = {}) {
    const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'IdeaGold/5.0', ...headers }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }
  async coinGecko() {
    const headers = {};
    if (process.env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY;
    const data = (await this.fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=brl,usd&include_24hr_change=true', headers)).monero;
    if (!(Number(data?.brl) > 0)) throw new Error('CoinGecko sem preço BRL');
    return { brl: Number(data.brl), usd: Number(data.usd || 0), change24h: Number(data.brl_24h_change || 0), source: 'CoinGecko' };
  }
  async cryptoCompare() {
    const data = await this.fetchJson('https://min-api.cryptocompare.com/data/price?fsym=XMR&tsyms=BRL,USD&extraParams=IdeaGold');
    if (!(Number(data?.BRL) > 0)) throw new Error('CryptoCompare sem preço BRL');
    return { brl: Number(data.BRL), usd: Number(data.USD || 0), change24h: null, source: 'CryptoCompare' };
  }
  async krakenFx() {
    const [k, fx] = await Promise.all([
      this.fetchJson('https://api.kraken.com/0/public/Ticker?pair=XMRUSD'),
      this.fetchJson('https://api.frankfurter.dev/v2/rate/USD/BRL')
    ]);
    const ticker = Object.values(k?.result || {})[0];
    const usd = Number(ticker?.c?.[0] || 0);
    const rate = Number(fx?.rate || 0);
    if (!(usd > 0 && rate > 0)) throw new Error('Kraken/FX sem cotação válida');
    return { brl: usd * rate, usd, change24h: null, source: 'Kraken XMR/USD + Frankfurter USD/BRL' };
  }
  async get() {
    if (this.cache && Date.now() - this.cache.ts < 60_000) return this.cache;
    for (const fn of [this.coinGecko.bind(this), this.cryptoCompare.bind(this), this.krakenFx.bind(this)]) {
      try {
        const value = { ...(await fn()), ts: Date.now(), cached: false, available: true };
        this.cache = value;
        this.db?.marketSnapshot(value);
        return value;
      } catch {}
    }
    if (this.cache && Date.now() - this.cache.ts < 15 * 60_000) return { ...this.cache, cached: true, staleSec: (Date.now() - this.cache.ts) / 1000 };
    return { available: false, brl: null, usd: null, source: null, ts: Date.now(), reason: 'Todas as APIs de preço falharam e não há cache recente.' };
  }
}

module.exports = { XmrMarketProvider };
