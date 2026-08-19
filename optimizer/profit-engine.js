'use strict';

function networkRateXmrPerSec(hashrate, difficulty, reward, feePct = 0) {
  const h=Number(hashrate), d=Number(difficulty), r=Number(reward);
  if (!(h>0&&d>0&&r>0)) return null;
  return (h/d)*r*Math.max(0,1-Number(feePct||0)/100);
}

function energyCost(powerW, electricityBrlKwh, seconds) {
  const kwh=Math.max(0,Number(powerW||0))/1000*Math.max(0,Number(seconds||0))/3600;
  return { kwh, brl:kwh*Math.max(0,Number(electricityBrlKwh||0)) };
}

function economics({xmrPerSec, priceBrl, powerW, electricityBrlKwh, cloudCostBrlDay=0}) {
  if (!(Number(xmrPerSec)>0) || !(Number(priceBrl)>0)) return {available:false};
  const rate=Number(xmrPerSec), price=Number(priceBrl), watts=Math.max(0,Number(powerW||0)), tariff=Math.max(0,Number(electricityBrlKwh||0));
  const intervals=[['hour',3600],['day',86400],['week',604800],['month30',2592000]];
  const rows={};
  for(const [name,sec] of intervals){
    const xmr=rate*sec;
    const revenue=xmr*price;
    const energy=energyCost(watts,tariff,sec);
    const cloud=Number(cloudCostBrlDay||0)*sec/86400;
    rows[name]={seconds:sec,xmr,revenueBrl:revenue,energyKwh:energy.kwh,energyBrl:energy.brl,cloudBrl:cloud,netBrl:revenue-energy.brl-cloud};
  }
  const xmrPerKwh=watts>0?rate*3600/(watts/1000):null;
  const revenuePerKwh=xmrPerKwh!=null?xmrPerKwh*price:null;
  const breakEvenTariff=watts>0?(rows.day.revenueBrl-Number(cloudCostBrlDay||0))/(watts/1000*24):null;
  const breakEvenXmrPrice=rows.day.xmr>0?(rows.day.energyBrl+Number(cloudCostBrlDay||0))/rows.day.xmr:null;
  const revenuePerHashSec=(Number(price)*Number(rewardSafe(arguments[0]))/Math.max(1,Number(difficultySafe(arguments[0]))));
  return {
    available:true, rows,
    efficiency:{ hashesPerWatt: watts>0?Number(arguments[0].hashrate||0)/watts:null, hashesPerKwh: watts>0?Number(arguments[0].hashrate||0)*3600000/watts:null, xmrPerKwh, revenuePerKwh, profitPerKwh:revenuePerKwh!=null?revenuePerKwh-tariff:null },
    breakEven:{ electricityBrlKwh:breakEvenTariff, xmrPriceBrl:breakEvenXmrPrice, minimumHashrate:minimumHashrate(arguments[0]), minimumEfficiency:minimumEfficiency(arguments[0]) }
  };
}
function difficultySafe(x){return x?.difficulty||0;}
function rewardSafe(x){return x?.reward||0;}
function minimumHashrate(x){
  const d=Number(x.difficulty), r=Number(x.reward), price=Number(x.priceBrl), watts=Number(x.powerW), tariff=Number(x.electricityBrlKwh), fee=Number(x.poolFeePct||0)/100;
  if(!(d>0&&r>0&&price>0&&watts>0))return null;
  const costDay=watts/1000*24*tariff+Number(x.cloudCostBrlDay||0);
  return costDay*d/(86400*r*(1-fee)*price);
}
function minimumEfficiency(x){const h=minimumHashrate(x);return h!=null&&Number(x.powerW)>0?h/Number(x.powerW):null;}

function theoreticalRevenue(input){
  const rate=networkRateXmrPerSec(input.hashrate,input.difficulty,input.reward,input.poolFeePct||0);
  return economics({...input,xmrPerSec:rate});
}

function whatIf(base, change={}) {
  const merged={...base,...change};
  const econ=theoreticalRevenue(merged);
  return {input:merged,economics:econ};
}

module.exports={networkRateXmrPerSec,energyCost,economics,theoreticalRevenue,whatIf,minimumHashrate,minimumEfficiency};
