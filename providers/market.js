'use strict';
const fs=require('fs'); const path=require('path'); const {RUNTIME_DIR,readJson,writeJsonAtomic}=require('../backend/config');
const CACHE=path.join(RUNTIME_DIR,'market-v5.json');
async function json(url,headers={}){const r=await fetch(url,{headers:{accept:'application/json','user-agent':'IdeaGold/5.0',...headers},signal:AbortSignal.timeout(6000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();}
async function coinGecko(){const d=(await json('https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=brl,usd&include_24hr_change=true')).monero; if(!(Number(d?.brl)>0))throw new Error('invalid');return {brl:Number(d.brl),usd:Number(d.usd||0),change24h:Number(d.brl_24h_change||0),source:'CoinGecko'};}
async function cryptoCompare(){const d=await json('https://min-api.cryptocompare.com/data/price?fsym=XMR&tsyms=BRL,USD&extraParams=IdeaGold');if(!(Number(d?.BRL)>0))throw new Error('invalid');return {brl:Number(d.BRL),usd:Number(d.USD||0),change24h:null,source:'CryptoCompare'};}
async function krakenFx(){const [k,f]=await Promise.all([json('https://api.kraken.com/0/public/Ticker?pair=XMRUSD'),json('https://api.frankfurter.dev/v2/rate/USD/BRL')]);const t=Object.values(k?.result||{})[0],usd=Number(t?.c?.[0]||0),rate=Number(f?.rate||0);if(!(usd>0&&rate>0))throw new Error('invalid');return {brl:usd*rate,usd,change24h:null,source:'Kraken XMR/USD + Frankfurter USD/BRL'};}
class MarketDataProvider{
  constructor(){this.last=null;}
  async get(){if(this.last&&Date.now()-Number(this.last.at||0)<30000)return {...this.last,status:'real'};for(const fn of [coinGecko,cryptoCompare,krakenFx]){try{const v={...await fn(),at:Date.now(),cached:false,status:'real'};this.last=v;writeJsonAtomic(CACHE,v);return v;}catch{}}
    const c=readJson(CACHE,null);if(c&&Date.now()-Number(c.at||0)<15*60_000)return {...c,cached:true,status:'cached',ageSec:(Date.now()-c.at)/1000};return {brl:null,usd:null,source:null,at:null,cached:false,status:'unavailable'};}
}
module.exports={MarketDataProvider};
