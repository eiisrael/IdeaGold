'use strict';
const S=require('./statistics');
function detect(value,history,{warnZ=3,criticalZ=5,direction='both'}={}){
  const r=S.robust(history); if(r.n<8||!(r.sigma>0))return {available:false,reason:'insufficient-history',stats:r};
  const z=(Number(value)-r.median)/r.sigma; const relevant=direction==='low'?-z:direction==='high'?z:Math.abs(z);
  return {available:true,z,level:relevant>=criticalZ?'critical':relevant>=warnZ?'warning':'normal',stats:r};
}
function evaluate(current,historyRows=[]){
  const field=f=>historyRows.map(x=>Number(x[f])).filter(Number.isFinite);
  return {
    hashrate:detect(current.localHash||0,field('local_hash'),{direction:'low'}),
    power: current.powerWatts!=null?detect(current.powerWatts,field('power_watts'),{direction:'high'}):{available:false,reason:'unavailable'},
    temperature: current.cpuTemp!=null?detect(current.cpuTemp,field('cpu_temp'),{direction:'high'}):{available:false,reason:'unavailable'},
    rejectRate: current.rejectRate!=null?detect(current.rejectRate,historyRows.map(x=>(x.accepted+x.rejected)>0?x.rejected/(x.accepted+x.rejected):0),{direction:'high'}):{available:false,reason:'unavailable'}
  };
}
module.exports={detect,evaluate};
