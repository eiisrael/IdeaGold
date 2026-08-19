'use strict';
const S=require('./statistics');

function networkXmrPerHour(hashrate,difficulty,reward,feePct=1,uptime=.98){
  if(!(hashrate>0&&difficulty>0&&reward>0))return 0;
  return (hashrate*3600/difficulty)*reward*Math.max(0,1-feePct/100)*S.clamp(uptime,0,1);
}
function powerCost({watts=0,idleWatts=0,costMode='full',tariff=0,hours=24}={}){
  const billable=costMode==='incremental'?Math.max(0,watts-idleWatts):Math.max(0,watts);
  const kwh=billable/1000*Math.max(0,hours); return {billableWatts:billable,kwh,costBrl:kwh*Math.max(0,tariff)};
}
function calculate(input={}){
  const xmrPerHour=Math.max(0,S.finite(input.xmrPerHour)); const price=Math.max(0,S.finite(input.priceBrl));
  const p=powerCost({watts:input.watts,idleWatts:input.idleWatts,costMode:input.costMode,tariff:input.tariff,hours:24});
  const cloud=Math.max(0,S.finite(input.cloudCostBrlDay)); const grossDay=xmrPerHour*24*price; const netDay=grossDay-p.costBrl-cloud;
  const energyPerHour=p.costBrl/24; const maxTariff=p.billableWatts>0?Math.max(0,(grossDay-cloud)/(p.billableWatts/1000*24)):null;
  const breakEvenXmrPrice=xmrPerHour>0? (p.costBrl+cloud)/(xmrPerHour*24):null;
  const xmrPerKwh=p.kwh>0?(xmrPerHour*24)/p.kwh:null; const revenuePerKwh=p.kwh>0?grossDay/p.kwh:null; const profitPerKwh=p.kwh>0?netDay/p.kwh:null;
  const hPerWatt=input.hashrate>0&&p.billableWatts>0?input.hashrate/p.billableWatts:null;
  const hPerKwh=input.hashrate>0&&p.billableWatts>0?input.hashrate*1000/p.billableWatts:null;
  const requiredHashrate=input.hashrate>0&&grossDay>0&&netDay<0?input.hashrate*(p.costBrl+cloud)/grossDay:input.hashrate||null;
  return {xmrPerHour,xmrDay:xmrPerHour*24,grossDayBrl:grossDay,energyDayBrl:p.costBrl,cloudDayBrl:cloud,netDayBrl:netDay,netMonthBrl:netDay*30,
    costHourBrl:energyPerHour+cloud/24,costMonthBrl:(p.costBrl+cloud)*30,billableWatts:p.billableWatts,kwhDay:p.kwh,
    hPerWatt,hPerKwh,xmrPerKwh,revenuePerKwh,profitPerKwh,breakEvenXmrPrice,maxTariffBrlKwh:maxTariff,requiredHashrate,
    efficiencyRequiredHPerWatt:requiredHashrate&&p.billableWatts>0?requiredHashrate/p.billableWatts:null};
}
function rows(base){return [1,24,24*7,24*30].map(hours=>({hours,xmr:base.xmrPerHour*hours,grossBrl:base.grossDayBrl*(hours/24),energyBrl:base.energyDayBrl*(hours/24),netBrl:base.netDayBrl*(hours/24)}));}
function scenarios(input={}){
  const base=calculate(input); const out=[];
  for(const pricePct of [-20,-10,0,10,20]) for(const difficultyPct of [0,10,20]){
    const adjustedRate=input.difficulty>0?Math.max(0,input.xmrPerHour)/(1+difficultyPct/100):input.xmrPerHour;
    const r=calculate({...input,xmrPerHour:adjustedRate,priceBrl:input.priceBrl*(1+pricePct/100)});
    out.push({pricePct,difficultyPct,netDayBrl:r.netDayBrl,xmrDay:r.xmrDay});
  } return {base,out};
}
module.exports={networkXmrPerHour,powerCost,calculate,rows,scenarios};
