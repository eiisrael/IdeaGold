'use strict';
const {clamp}=require('../lib/utils');

function networkXmrPerSec(hashrate,difficulty,rewardXmr,feePct=1){
  if(!(hashrate>0&&difficulty>0&&rewardXmr>0))return 0;
  return hashrate/difficulty*rewardXmr*(1-clamp(feePct,0,100)/100);
}
function energyCost({watts=0,kwhBrl=0,hours=24}){ return Math.max(0,watts)/1000*Math.max(0,hours)*Math.max(0,kwhBrl); }
function project({xmrPerSec=0,priceBrl=0,watts=0,kwhBrl=0,cloudBrlDay=0}){
  const horizons=[['1h',3600],['24h',86400],['7d',604800],['30d',2592000]];
  const rows=horizons.map(([label,sec])=>{
    const xmr=xmrPerSec*sec, gross=xmr*priceBrl;
    const energy=energyCost({watts,kwhBrl,hours:sec/3600});
    const cloud=cloudBrlDay*(sec/86400); const cost=energy+cloud;
    return {label,seconds:sec,xmr,grossBrl:gross,costBrl:cost,netBrl:gross-cost};
  });
  const xmrDay=xmrPerSec*86400, grossDay=xmrDay*priceBrl;
  const kwhDay=watts/1000*24;
  const breakEvenKwh=kwhDay>0?Math.max(0,(grossDay-cloudBrlDay)/kwhDay):null;
  const breakEvenPrice=xmrDay>0?(energyCost({watts,kwhBrl,hours:24})+cloudBrlDay)/xmrDay:null;
  const revenuePerKwh=kwhDay>0?grossDay/kwhDay:null;
  return {rows,xmrDay,grossDay,costDay:energyCost({watts,kwhBrl,hours:24})+cloudBrlDay,netDay:grossDay-energyCost({watts,kwhBrl,hours:24})-cloudBrlDay,breakEvenKwh,breakEvenPrice,revenuePerKwh,profitPerKwh:revenuePerKwh==null?null:revenuePerKwh-kwhBrl};
}
function efficiency({hashrate=0,watts=0,xmrPerSec=0}){
  if(!(watts>0))return {hashPerWatt:null,hashPerKwh:null,xmrPerKwh:null};
  return {hashPerWatt:hashrate/watts,hashPerKwh:hashrate*3600000/watts,xmrPerKwh:xmrPerSec*3600000/watts};
}
function breakEvenHashrate({difficulty,rewardXmr,feePct=1,priceBrl,watts,kwhBrl,cloudBrlDay=0}){
  const costDay=energyCost({watts,kwhBrl,hours:24})+cloudBrlDay;
  const coinPerHashDay=difficulty>0?86400/difficulty*rewardXmr*(1-clamp(feePct,0,100)/100):0;
  return coinPerHashDay>0&&priceBrl>0?costDay/(coinPerHashDay*priceBrl):null;
}
function scenario(base,{pricePct=0,difficultyPct=0,energyPct=0,hashPct=0}){
  const price=base.priceBrl*(1+pricePct/100),difficulty=base.difficulty*(1+difficultyPct/100),kwh=base.kwhBrl*(1+energyPct/100),hash=base.hashrate*(1+hashPct/100);
  const rate=networkXmrPerSec(hash,difficulty,base.rewardXmr,base.feePct);
  return {...project({xmrPerSec:rate,priceBrl:price,watts:base.watts,kwhBrl:kwh,cloudBrlDay:base.cloudBrlDay||0}),price,difficulty,kwh,hash,xmrPerSec:rate};
}
module.exports={networkXmrPerSec,energyCost,project,efficiency,breakEvenHashrate,scenario};
