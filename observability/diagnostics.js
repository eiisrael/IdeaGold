'use strict';

const fs=require('fs');
const path=require('path');
const {sanitize,maskWallet}=require('./logger');

function tail(file,max=80000){try{const st=fs.statSync(file),len=Math.min(max,st.size),fd=fs.openSync(file,'r'),buf=Buffer.alloc(len);fs.readSync(fd,buf,0,len,st.size-len);fs.closeSync(fd);return buf.toString('utf8').replace(/\x1b\[[0-9;]*m/g,'');}catch{return'';}}
function diagnostics({root,version,logger,settings,hardware,controller,telemetry,supreme,benchmark,workers,scheduler,gpu,p2pool,db}){
  const safeSettings={...settings,wallet:settings.wallet?maskWallet(settings.wallet):'',privacy:settings.privacy};
  return sanitize({
    generatedAt:Date.now(),iso:new Date().toISOString(),version,node:process.version,platform:process.platform,arch:process.arch,
    hardware,settings:safeSettings,
    controller:controller.state(),telemetry:telemetry.snapshot(),supreme:supreme.snapshot(),benchmark:benchmark.status(),workers:workers.summary(),scheduler:scheduler.snapshot(),gpu:gpu.snapshot(),p2poolState:p2pool.read? p2pool.read(path.join(root,'runtime','p2pool','state.json'),{}):null,
    alerts:db.activeAlerts(),recentDecisions:db.listDecisions(100),structuredLogs:logger.recent(400),
    tails:{xmrig:tail(path.join(root,'runtime','xmrig-v51.log')),config:tail(path.join(root,'runtime','config-audit.jsonl')),p2pool:tail(path.join(root,'runtime','p2pool','p2pool.log'))}
  });
}
module.exports={diagnostics,tail};
