'use strict';

function networkRateXmrPerSec(hashrate, difficulty, reward, feePct = 0) {
  const h = Number(hashrate), d = Number(difficulty), r = Number(reward);
  if (!(h > 0 && d > 0 && r > 0)) return null;
  return (h / d) * r * Math.max(0, 1 - Number(feePct || 0) / 100);
}

function energyCost(powerW, electricityBrlKWh, seconds) {
  const kwh = Math.max(0, Number(powerW || 0)) / 1000 * Math.max(0, Number(seconds || 0)) / 3600;
  return { kwh, brl: kwh * Math.max(0, Number(electricityBrlKWh || 0)) };
}

function minimumHashrate(input) {
  const d = Number(input.difficulty), r = Number(input.reward), price = Number(input.priceBrl);
  const watts = Number(input.powerW), tariff = Number(input.electricityBrlKWh), fee = Number(input.poolFeePct || 0) / 100;
  if (!(d > 0 && r > 0 && price > 0 && watts > 0) || fee >= 1) return null;
  const costDay = watts / 1000 * 24 * tariff + Number(input.cloudCostBrlDay || 0);
  return costDay * d / (86400 * r * (1 - fee) * price);
}
function minimumEfficiency(input) {
  const h = minimumHashrate(input);
  return h != null && Number(input.powerW) > 0 ? h / Number(input.powerW) : null;
}

function economics(input) {
  const { xmrPerSec, priceBrl, powerW, electricityBrlKWh, cloudCostBrlDay = 0 } = input;
  if (!(Number(xmrPerSec) > 0) || !(Number(priceBrl) > 0)) return { available: false };
  const rate = Number(xmrPerSec), price = Number(priceBrl), watts = Math.max(0, Number(powerW || 0));
  const tariff = Math.max(0, Number(electricityBrlKWh || 0));
  const intervals = [['hour', 3600], ['day', 86400], ['week', 604800], ['month30', 2592000]];
  const rows = {};
  for (const [name, sec] of intervals) {
    const xmr = rate * sec;
    const revenue = xmr * price;
    const energy = energyCost(watts, tariff, sec);
    const cloud = Number(cloudCostBrlDay || 0) * sec / 86400;
    rows[name] = { seconds: sec, xmr, revenueBrl: revenue, energyKWh: energy.kwh, energyBrl: energy.brl, cloudBrl: cloud, netBrl: revenue - energy.brl - cloud };
  }
  const xmrPerKWh = watts > 0 ? rate * 3600 / (watts / 1000) : null;
  const revenuePerKWh = xmrPerKWh != null ? xmrPerKWh * price : null;
  const breakEvenTariff = watts > 0 ? (rows.day.revenueBrl - Number(cloudCostBrlDay || 0)) / (watts / 1000 * 24) : null;
  const breakEvenXmrPrice = rows.day.xmr > 0 ? (rows.day.energyBrl + Number(cloudCostBrlDay || 0)) / rows.day.xmr : null;
  return {
    available: true,
    rows,
    efficiency: {
      hashesPerWatt: watts > 0 && Number(input.hashrate) >= 0 ? Number(input.hashrate) / watts : null,
      hashesPerKWh: watts > 0 && Number(input.hashrate) >= 0 ? Number(input.hashrate) * 3600000 / watts : null,
      xmrPerKWh,
      revenuePerKWh,
      profitPerKWh: revenuePerKWh != null ? revenuePerKWh - tariff : null
    },
    breakEven: {
      electricityBrlKWh: breakEvenTariff,
      xmrPriceBrl: breakEvenXmrPrice,
      minimumHashrate: minimumHashrate(input),
      minimumEfficiency: minimumEfficiency(input)
    }
  };
}

function theoreticalRevenue(input) {
  const rate = networkRateXmrPerSec(input.hashrate, input.difficulty, input.reward, input.poolFeePct || 0);
  return economics({ ...input, xmrPerSec: rate });
}

function whatIf(base, change = {}) {
  const merged = { ...base, ...change };
  const econ = theoreticalRevenue(merged);
  return { input: merged, economics: econ };
}

module.exports = { networkRateXmrPerSec, energyCost, economics, theoreticalRevenue, whatIf, minimumHashrate, minimumEfficiency };
