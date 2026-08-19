'use strict';
const net=require('net');
const {validXmrWallet}=require('../lib/utils');

function mapMoneroOcean(data){
  if(!data)return null;
  const num=(...keys)=>{for(const k of keys)if(data[k]!=null)return Number(data[k])||0;return 0;};
  const last=num('lastHash','lastShare','lts','last');
  return {adapter:'moneroocean',pool:'MoneroOcean',dueXmr:num('amtDue','due','balance')/1e12,paidXmr:num('amtPaid','paid')/1e12,hashrate:num('hash2','hash','hashrate'),rawHashrate:num('hash','hashrate'),accepted:num('validShares','valid','vs'),rejected:num('invalidShares','invalid','is'),stale:num('staleShares','stale'),totalHashes:num('totalHashes','totalHash','th'),lastShareTs:last,lastAlgo:String(data.la||data.lastShareAlgo||''),raw:data};
}
async function tcpPing(host,port,timeout=1600){return new Promise(resolve=>{const started=Date.now(),s=net.createConnection({host,port});let done=false;const finish=v=>{if(done)return;done=true;s.destroy();resolve(v);};s.setTimeout(timeout);s.on('connect',()=>finish({ok:true,ms:Date.now()-started}));s.on('timeout',()=>finish({ok:false,ms:null}));s.on('error',()=>finish({ok:false,ms:null}));});}
class MoneroOceanAdapter{
  constructor({host='gulf.moneroocean.stream',port=20128}={}){this.host=host;this.port=port;this.id='moneroocean';}
  async stats(wallet){if(!validXmrWallet(wallet))return {available:false,reason:'wallet-required'};try{const r=await fetch(`https://api.moneroocean.stream/miner/${encodeURIComponent(wallet)}/stats`,{headers:{accept:'application/json','user-agent':'IdeaGold/5'},signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);return {available:true,...mapMoneroOcean(await r.json())};}catch(e){return {available:false,reason:e.message};}}
  async network(){try{const r=await fetch('https://api.moneroocean.stream/network/stats',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);const d=await r.json();let reward=Number(d.value||d.reward||0);if(reward>1e6)reward/=1e12;return {available:Number(d.difficulty)>0&&reward>0,difficulty:Number(d.difficulty)||null,rewardXmr:reward||null,height:Number(d.height||d.main_height)||null,networkHashrate:Number(d.hash||d.hashrate)||null,source:'MoneroOcean network/stats'};}catch(e){return {available:false,reason:e.message};}}
  async health(){const ping=await tcpPing(this.host,this.port);return {host:this.host,port:this.port,pingMs:ping.ms,online:ping.ok};}
}
class P2PoolAdapter{
  constructor({stratumHost='127.0.0.1',stratumPort=3333,monerodRpc='http://127.0.0.1:18081/json_rpc'}={}){this.id='p2pool';this.host=stratumHost;this.port=stratumPort;this.monerodRpc=monerodRpc;}
  async detect(){const stratum=await tcpPing(this.host,this.port,800);let node=false,height=null;try{const r=await fetch(this.monerodRpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'0',method:'get_info'}),signal:AbortSignal.timeout(1200)});const d=await r.json();node=Boolean(d?.result);height=Number(d?.result?.height)||null;}catch{}return {available:stratum.ok,stratumOnline:stratum.ok,pingMs:stratum.ms,monerodOnline:node,height,statsStatus:'indisponível sem API de dados P2Pool configurada',source:'local TCP + monerod JSON-RPC'};}
}
function poolScore({health={},stats={}}){
  const parts=[];
  if(health.pingMs!=null){const score=Math.max(0,100-health.pingMs/4);parts.push({name:'latency',score,weight:0.35,detail:`${health.pingMs} ms`});}
  if(stats.rejected!=null&&stats.accepted!=null&&stats.accepted+stats.rejected>0){const rr=stats.rejected/(stats.accepted+stats.rejected);parts.push({name:'reject-rate',score:Math.max(0,100-rr*1000),weight:0.35,detail:`${(rr*100).toFixed(2)}%`});}
  if(health.online!=null)parts.push({name:'availability',score:health.online?100:0,weight:0.30,detail:health.online?'online':'offline'});
  if(!parts.length)return {available:false,score:null,parts:[],missing:['latency','reject-rate','availability']};
  const weight=parts.reduce((s,p)=>s+p.weight,0),score=parts.reduce((s,p)=>s+p.score*p.weight,0)/weight;
  return {available:true,score:Math.round(score),parts,missing:['fee','payout-threshold','variance'].filter(()=>true)};
}
module.exports={MoneroOceanAdapter,P2PoolAdapter,poolScore,tcpPing,mapMoneroOcean};
