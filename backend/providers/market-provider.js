'use strict';
class MarketProvider{
  constructor(store){this.store=store;this.cache=null;}
  async coinGecko(){const headers={accept:'application/json','user-agent':'IdeaGold/5'};if(process.env.COINGECKO_API_KEY)headers['x-cg-demo-api-key']=process.env.COINGECKO_API_KEY;const r=await fetch('https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=brl,usd&include_24hr_change=true',{headers,signal:AbortSignal.timeout(4500)});if(!r.ok)throw new Error(`CoinGecko ${r.status}`);const d=(await r.json()).monero||{};if(!(Number(d.brl)>0))throw new Error('CoinGecko sem BRL');return {brl:Number(d.brl),usd:Number(d.usd)||null,change24h:Number(d.brl_24h_change)||null,source:'CoinGecko'};}
  async cryptoCompare(){const r=await fetch('https://min-api.cryptocompare.com/data/price?fsym=XMR&tsyms=BRL,USD&extraParams=IdeaGold',{signal:AbortSignal.timeout(4500)});if(!r.ok)throw new Error(`CryptoCompare ${r.status}`);const d=await r.json();if(!(Number(d.BRL)>0))throw new Error('CryptoCompare sem BRL');return {brl:Number(d.BRL),usd:Number(d.USD)||null,change24h:null,source:'CryptoCompare'};}
  async krakenFx(){const [a,b]=await Promise.all([fetch('https://api.kraken.com/0/public/Ticker?pair=XMRUSD',{signal:AbortSignal.timeout(4500)}),fetch('https://api.frankfurter.dev/v2/rate/USD/BRL',{signal:AbortSignal.timeout(4500)})]);if(!a.ok||!b.ok)throw new Error('Kraken/FX indisponível');const k=await a.json(),f=await b.json(),ticker=Object.values(k.result||{})[0],usd=Number(ticker?.c?.[0]),fx=Number(f.rate);if(!(usd>0&&fx>0))throw new Error('Kraken/FX inválido');return {brl:usd*fx,usd,change24h:null,source:'Kraken XMR/USD + Frankfurter USD/BRL'};}
  async get(force=false){if(!force&&this.cache&&Date.now()-this.cache.at<60_000)return this.cache;for(const fn of [this.coinGecko.bind(this),this.cryptoCompare.bind(this),this.krakenFx.bind(this)]){try{const m={...(await fn()),at:Date.now(),cached:false,status:'real'};this.cache=m;this.store?.market(m);return m;}catch{}}
    if(this.cache&&Date.now()-this.cache.at<15*60_000)return {...this.cache,cached:true,status:'cache recente'};
    return {brl:null,usd:null,change24h:null,source:null,at:Date.now(),cached:false,status:'API desconectada'};
  }
}
module.exports={MarketProvider};
