'use strict';

const DEFAULT_PERIODS = {
  hour: 3600,
  day: 86400,
  week: 7 * 86400,
  month: 30 * 86400
};

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function median(values) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function percentile(values, q) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const idx = clamp(q, 0, 1) * (xs.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return xs[lo];
  return xs[lo] * (hi - idx) + xs[hi] * (idx - lo);
}

function weightedRegressionRate(samples, options = {}) {
  const horizonMs = finite(options.horizonMs, 6 * 3600_000);
  const halfLifeMs = finite(options.halfLifeMs, 45 * 60_000);
  const now = Date.now();
  const rows = (samples || [])
    .map(row => ({ ts: Number(row.ts), y: Number(row.totalEarnedXmr) }))
    .filter(row => Number.isFinite(row.ts) && Number.isFinite(row.y) && now - row.ts <= horizonMs)
    .sort((a, b) => a.ts - b.ts);

  if (rows.length < 3) return { rate: 0, confidence: 0, r2: 0, spanSec: 0, samples: rows.length };
  const t0 = rows[0].ts;
  const spanSec = Math.max(0, (rows.at(-1).ts - t0) / 1000);
  if (spanSec < 120) return { rate: 0, confidence: 0, r2: 0, spanSec, samples: rows.length };

  let sw = 0, sx = 0, sy = 0;
  const weighted = rows.map(row => {
    const ageMs = Math.max(0, now - row.ts);
    const w = Math.max(0.03, Math.pow(0.5, ageMs / halfLifeMs));
    const x = (row.ts - t0) / 1000;
    sw += w; sx += w * x; sy += w * row.y;
    return { ...row, x, w };
  });
  if (!sw) return { rate: 0, confidence: 0, r2: 0, spanSec, samples: rows.length };
  const mx = sx / sw, my = sy / sw;
  let cov = 0, vx = 0, vy = 0;
  for (const row of weighted) {
    const dx = row.x - mx, dy = row.y - my;
    cov += row.w * dx * dy;
    vx += row.w * dx * dx;
    vy += row.w * dy * dy;
  }
  const slope = vx > 0 ? cov / vx : 0;
  const r2 = vx > 0 && vy > 0 ? clamp((cov * cov) / (vx * vy), 0, 1) : 0;
  const delta = rows.at(-1).y - rows[0].y;
  const hasMovement = delta > 0;
  const timeConfidence = clamp(spanSec / 3600, 0, 1);
  const sampleConfidence = clamp((rows.length - 2) / 30, 0, 1);
  const confidence = hasMovement ? clamp(timeConfidence * 0.45 + sampleConfidence * 0.20 + r2 * 0.35, 0, 1) : 0;
  return { rate: slope > 0 ? slope : 0, confidence, r2, spanSec, samples: rows.length, deltaXmr: delta };
}

function networkXmrRate(hashrate, difficulty, reward, factor = 0.99) {
  const h = Math.max(0, finite(hashrate));
  const d = Math.max(1, finite(difficulty, 1));
  const r = Math.max(0, finite(reward));
  const f = clamp(factor, 0, 1);
  return h > 0 && d > 0 && r > 0 ? (h / d) * r * f : 0;
}

function hashVariability(samples, key = 'effectiveHashrate', horizonMs = 30 * 60_000) {
  const now = Date.now();
  const xs = (samples || [])
    .filter(row => now - Number(row.ts) <= horizonMs)
    .map(row => Number(row[key]))
    .filter(x => Number.isFinite(x) && x > 0);
  if (xs.length < 3) return { mean: xs[0] || 0, cv: 0.25, samples: xs.length };
  const med = median(xs);
  const absDev = xs.map(x => Math.abs(x - med));
  const mad = median(absDev);
  const robustSigma = 1.4826 * mad;
  const cv = med > 0 ? clamp(robustSigma / med, 0.03, 1.5) : 0.25;
  return { mean: med, cv, samples: xs.length };
}

function hybridRateEstimate(input = {}) {
  const empirical = Math.max(0, finite(input.empiricalRate));
  const empiricalConfidence = clamp(input.empiricalConfidence, 0, 1);
  const poolRate = Math.max(0, finite(input.poolRate));
  const poolConfidence = clamp(input.poolConfidence ?? (poolRate > 0 ? 0.75 : 0), 0, 1);
  const localRate = Math.max(0, finite(input.localRate));
  const localConfidence = clamp(input.localConfidence ?? (localRate > 0 ? 0.45 : 0), 0, 1);
  const signals = [
    { name: 'saldo_real_pool', rate: empirical, rawWeight: 0.55 * empiricalConfidence },
    { name: 'hashrate_normalizado_pool', rate: poolRate, rawWeight: 0.35 * poolConfidence },
    { name: 'modelo_rede_local', rate: localRate, rawWeight: 0.10 * localConfidence }
  ].filter(s => s.rate > 0 && s.rawWeight > 0);
  if (!signals.length) return { rate: 0, confidence: 0, sources: [] };
  const sumWeight = signals.reduce((sum, s) => sum + s.rawWeight, 0);
  let rate = 0;
  for (const signal of signals) { signal.weight = signal.rawWeight / sumWeight; rate += signal.rate * signal.weight; }
  const disagreement = signals.length > 1
    ? Math.sqrt(signals.reduce((sum, s) => sum + s.weight * ((s.rate - rate) / Math.max(rate, 1e-18)) ** 2, 0))
    : 0.30;
  const confidence = clamp(sumWeight * (1 - clamp(disagreement, 0, 0.8) * 0.55), 0.05, 0.98);
  return { rate, confidence, disagreement, sources: signals.map(s => ({ name: s.name, weight: s.weight, rate: s.rate })) };
}

function projectionTable(input = {}) {
  const rate = Math.max(0, finite(input.xmrPerSec));
  const price = Math.max(0, finite(input.priceBrl));
  const tariff = Math.max(0, finite(input.electricityBrlKwh));
  const watts = Math.max(0, finite(input.powerWatts));
  const cloudCostPerDay = Math.max(0, finite(input.cloudCostBrlDay));
  const periods = input.periods || DEFAULT_PERIODS;
  const result = {};
  for (const [name, sec] of Object.entries(periods)) {
    const seconds = Math.max(0, finite(sec));
    const hours = seconds / 3600;
    const days = seconds / 86400;
    const grossXmr = rate * seconds;
    const grossBrl = grossXmr * price;
    const energyBrl = (watts / 1000) * hours * tariff;
    const cloudBrl = cloudCostPerDay * days;
    const netBrl = grossBrl - energyBrl - cloudBrl;
    result[name] = { seconds, grossXmr, grossBrl, energyBrl, cloudBrl, netBrl };
  }
  const daily = result.day || projectionTable({ ...input, periods: { day: 86400 } }).day;
  const breakEvenElectricity = watts > 0 ? Math.max(0, (daily.grossBrl - cloudCostPerDay) / ((watts / 1000) * 24)) : null;
  const breakEvenXmrPrice = rate > 0 ? (daily.energyBrl + daily.cloudBrl) / (rate * 86400) : null;
  return { periods: result, breakEvenElectricity, breakEvenXmrPrice };
}

function nextMilestone(input = {}) {
  const total = Math.max(0, finite(input.totalEarnedXmr));
  const step = Math.max(1e-12, finite(input.stepXmr, 0.000015));
  const rate = Math.max(0, finite(input.xmrPerSec));
  const cv = clamp(input.rateCv ?? 0.25, 0.03, 1.5);
  const bucket = Math.floor((total + 1e-15) / step) + 1;
  const target = bucket * step;
  const remaining = Math.max(0, target - total);
  if (!(rate > 0)) return { targetXmr: target, remainingXmr: remaining, expectedSec: null, optimisticSec: null, conservativeSec: null };
  const expectedSec = remaining / rate;
  const spread = clamp(1.2816 * cv, 0.08, 0.85);
  const fastRate = rate * (1 + spread);
  const slowRate = Math.max(rate * (1 - spread), rate * 0.12);
  return { targetXmr: target, remainingXmr: remaining, expectedSec, optimisticSec: remaining / fastRate, conservativeSec: remaining / slowRate, rateCv: cv };
}

function shareArrivalEstimate(hashrate, shareDifficulty) {
  const h = Math.max(0, finite(hashrate));
  const d = Math.max(0, finite(shareDifficulty));
  if (!(h > 0 && d > 0)) return null;
  const meanSec = d / h;
  return { meanSec, medianSec: Math.log(2) * meanSec, p80Sec: -Math.log(0.2) * meanSec, p95Sec: -Math.log(0.05) * meanSec };
}

function priceVolatility(prices) {
  const xs = (prices || []).map(Number).filter(x => Number.isFinite(x) && x > 0);
  if (xs.length < 4) return 0.045;
  const returns = [];
  for (let i = 1; i < xs.length; i++) returns.push(Math.log(xs[i] / xs[i - 1]));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return clamp(Math.sqrt(variance), 0.01, 0.20);
}

function seededRandom(seed) {
  let x = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
}
function normal(rand) {
  const u1 = Math.max(1e-12, rand());
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function monteCarloProfit(input = {}) {
  const xmrPerSec = Math.max(0, finite(input.xmrPerSec));
  const price = Math.max(0, finite(input.priceBrl));
  if (!(xmrPerSec > 0 && price > 0)) return null;
  const days = Math.max(1, Math.floor(finite(input.days, 30)));
  const simulations = clamp(Math.floor(finite(input.simulations, 8000)), 1000, 25000);
  const sigmaPrice = clamp(input.priceVolDaily ?? 0.045, 0.005, 0.30);
  const sigmaYield = clamp(input.yieldVolDaily ?? 0.02, 0.002, 0.15);
  const yieldDrift = clamp(input.yieldDriftDaily ?? 0, -0.10, 0.10);
  const tariff = Math.max(0, finite(input.electricityBrlKwh));
  const watts = Math.max(0, finite(input.powerWatts));
  const cloudCost = Math.max(0, finite(input.cloudCostBrlDay));
  const rand = seededRandom(input.seed ?? 1);
  const outcomes = new Array(simulations);
  for (let sim = 0; sim < simulations; sim++) {
    let p = price, yieldFactor = 1, revenue = 0;
    for (let day = 0; day < days; day++) {
      p *= Math.exp(-0.5 * sigmaPrice * sigmaPrice + sigmaPrice * normal(rand));
      yieldFactor *= Math.exp(yieldDrift - 0.5 * sigmaYield * sigmaYield + sigmaYield * normal(rand));
      revenue += xmrPerSec * 86400 * yieldFactor * p;
    }
    const energy = (watts / 1000) * 24 * days * tariff;
    outcomes[sim] = revenue - energy - cloudCost * days;
  }
  outcomes.sort((a, b) => a - b);
  return {
    simulations, days,
    p10: percentile(outcomes, 0.10), median: percentile(outcomes, 0.50), p90: percentile(outcomes, 0.90),
    probabilityProfit: outcomes.filter(x => x > 0).length / outcomes.length,
    probabilityLoss: outcomes.filter(x => x < 0).length / outcomes.length,
    priceVolDaily: sigmaPrice, yieldVolDaily: sigmaYield
  };
}

function goldBrainScore(input = {}) {
  const netDay = finite(input.netDay);
  const grossDay = Math.max(1e-9, finite(input.grossDay));
  const efficiency = Math.max(0, finite(input.hashPerWatt));
  const maxEfficiency = Math.max(1e-9, finite(input.maxHashPerWatt, efficiency || 1));
  const stability = clamp(input.stability ?? 0.8, 0, 1);
  const acceptance = clamp(input.acceptance ?? 1, 0, 1);
  const normalizedProfit = clamp(0.5 + netDay / Math.max(grossDay, 0.01) / 2, 0, 1);
  const normalizedEfficiency = clamp(efficiency / maxEfficiency, 0, 1);
  return 100 * (0.45 * normalizedProfit + 0.25 * normalizedEfficiency + 0.20 * stability + 0.10 * acceptance);
}

module.exports = {
  DEFAULT_PERIODS, clamp, median, percentile, weightedRegressionRate, networkXmrRate,
  hashVariability, hybridRateEstimate, projectionTable, nextMilestone,
  shareArrivalEstimate, priceVolatility, monteCarloProfit, goldBrainScore
};
