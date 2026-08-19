'use strict';
const os=require('os');
const crypto=require('crypto');
const {spawnSync}=require('child_process');
const {clamp}=require('../lib/utils');

function powershell(script){
  if(process.platform!=='win32')return null;
  const r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',script],{encoding:'utf8',windowsHide:true,timeout:5000});
  return r.status===0?r.stdout.trim():null;
}
function cpuLoadSample(){
  const cpus=os.cpus();
  let idle=0,total=0;
  for(const c of cpus){idle+=c.times.idle; total+=Object.values(c.times).reduce((a,b)=>a+b,0);}
  return {idle,total,ts:Date.now()};
}
class HardwareProvider{
  constructor(){this.prev=cpuLoadSample();this.static=this.detectStatic();}
  detectStatic(){
    const cpus=os.cpus()||[], model=cpus[0]?.model||'Unknown CPU';
    let cores=null,l3Bytes=null;
    if(process.platform==='win32'){
      const raw=powershell("Get-CimInstance Win32_Processor | Select-Object -First 1 NumberOfCores,L3CacheSize | ConvertTo-Json -Compress");
      try{const d=JSON.parse(raw||'{}');cores=Number(d.NumberOfCores)||null;l3Bytes=(Number(d.L3CacheSize)||0)*1024||null;}catch{}
    }
    if(process.platform==='linux'){
      try{const fs=require('fs');const cpuinfo=fs.readFileSync('/proc/cpuinfo','utf8');const ids=[...cpuinfo.matchAll(/^core id\s*:\s*(\d+)/gm)].map(m=>m[1]);cores=new Set(ids).size||null;}catch{}
    }
    const fingerprint=crypto.createHash('sha256').update([model,cores||'',cpus.length,Math.round(os.totalmem()/1024/1024),process.platform,process.arch].join('|')).digest('hex').slice(0,20);
    return {fingerprint,cpuModel:model,cores:cores||cpus.length,threads:cpus.length,cacheL3Bytes:l3Bytes,memoryBytes:os.totalmem(),os:`${os.type()} ${os.release()}`,platform:process.platform,arch:process.arch,hostname:os.hostname()};
  }
  load(){
    const cur=cpuLoadSample(),didle=cur.idle-this.prev.idle,dtotal=cur.total-this.prev.total;this.prev=cur;
    return dtotal>0?clamp((1-didle/dtotal)*100,0,100):null;
  }
  async libreHardwareMonitor(){
    const candidates=['http://127.0.0.1:8085/data.json','http://127.0.0.1:8085/data.json?auth='];
    for(const url of candidates){
      try{const r=await fetch(url,{signal:AbortSignal.timeout(900)});if(!r.ok)continue;const data=await r.json();const flat=[];const walk=n=>{if(!n||typeof n!=='object')return;if(n.Text&&n.Value)flat.push({text:n.Text,value:n.Value,min:n.Min,max:n.Max});for(const c of n.Children||[])walk(c);};walk(data);
        const parse=(re,unit)=>{const x=flat.find(v=>re.test(v.text)&&String(v.value).includes(unit));return x?Number(String(x.value).replace(',','.').match(/-?\d+(?:\.\d+)?/)?.[0]):null;};
        return {connected:true,cpuTempC:parse(/CPU Package|CPU Core|Core Max/i,'°C'),gpuTempC:parse(/GPU Core|GPU Temperature/i,'°C'),cpuPowerW:parse(/CPU Package|Package/i,'W'),gpuPowerW:parse(/GPU Power|GPU Package/i,'W'),source:'LibreHardwareMonitor local API'};
      }catch{}
    }
    return {connected:false,cpuTempC:null,gpuTempC:null,cpuPowerW:null,gpuPowerW:null,source:'unavailable'};
  }
  async snapshot(){const sensors=await this.libreHardwareMonitor();return {...this.static,cpuLoadPct:this.load(),sensors};}
}
module.exports={HardwareProvider};
