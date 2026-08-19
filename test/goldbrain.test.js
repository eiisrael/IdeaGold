'use strict';
const assert = require('assert');
const G = require('../lib/goldbrain');

function approx(actual, expected, eps, label) {
  assert(Math.abs(actual - expected) <= eps, `${label || 'value'}: ${actual} != ${expected}`);
}

const rate = G.networkXmrRate(2000, 600_000_000_000, 0.6, 0.99);
approx(rate, 2000 / 600_000_000_000 * 0.6 * 0.99, 1e-18, 'network rate');

const hybrid = G.hybridRateEstimate({
  empiricalRate: 2e-9,
  empiricalConfidence: 1,
  poolRate: 1e-9,
  poolConfidence: 1,
  localRate: 0.5e-9,
  localConfidence: 1
});
assert(hybrid.rate > 1e-9 && hybrid.rate < 2e-9, 'hybrid weighted range');
assert(hybrid.sources.length === 3, 'hybrid sources');

const proj = G.projectionTable({ xmrPerSec: 1e-8, priceBrl: 2000, electricityBrlKwh: 1, powerWatts: 100, cloudCostBrlDay: 0 });
approx(proj.periods.day.grossXmr, 0.000864, 1e-12, 'daily xmr');
approx(proj.periods.day.energyBrl, 2.4, 1e-12, 'daily energy');
assert(proj.periods.day.netBrl < 0, 'negative net expected');

const milestone = G.nextMilestone({ totalEarnedXmr: 0, stepXmr: 0.000015, xmrPerSec: 1e-8, rateCv: 0.2 });
approx(milestone.targetXmr, 0.000015, 1e-15, 'milestone target');
approx(milestone.expectedSec, 1500, 1e-9, 'milestone eta');
assert(milestone.optimisticSec < milestone.expectedSec, 'optimistic faster');
assert(milestone.conservativeSec > milestone.expectedSec, 'conservative slower');

const share = G.shareArrivalEstimate(1000, 100000);
approx(share.meanSec, 100, 1e-12, 'share mean');
assert(share.medianSec < share.meanSec, 'exponential median');

const base = Date.now() - 20 * 60_000;
const samples = [];
for (let i = 0; i < 20; i++) samples.push({ ts: base + i * 60_000, totalEarnedXmr: i * 0.000001, effectiveHashrate: 1000 + (i % 3) * 20 });
const empirical = G.weightedRegressionRate(samples);
assert(empirical.rate > 0, 'empirical slope');
assert(empirical.confidence > 0, 'empirical confidence');

const risk = G.monteCarloProfit({ xmrPerSec: 1e-8, priceBrl: 2000, electricityBrlKwh: 0.1, powerWatts: 30, simulations: 1200, seed: 42 });
assert(risk && risk.simulations === 1200, 'risk sim count');
assert(risk.p10 <= risk.median && risk.median <= risk.p90, 'risk percentiles');

console.log('goldbrain tests: OK');
