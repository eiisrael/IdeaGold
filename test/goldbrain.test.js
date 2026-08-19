'use strict';
const assert = require('assert');
const G = require('../lib/goldbrain');

function approx(a,b,tol=1e-12){assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`)}

assert.strictEqual(G.networkXmrRate(0, 100, 1), 0);
approx(G.networkXmrRate(100, 1000, 2, 1), 0.2);

const no = G.nextDynamicGain({ sessionEarnedXmr: 0, xmrPerSec: 0, samples: [] });
assert.strictEqual(no.available, false);
assert.strictEqual(no.expectedSec, null);

const dyn = G.nextDynamicGain({ sessionEarnedXmr: 0, xmrPerSec: 1e-9, samples: [] });
assert.strictEqual(dyn.available, true);
assert.ok(dyn.quantumXmr >= 1e-8);
assert.ok(dyn.expectedSec > 0);

const observed = G.nextDynamicGain({
  sessionEarnedXmr: 2e-7,
  xmrPerSec: 1e-9,
  samples: [
    {ts:1,totalEarnedXmr:1},
    {ts:2,totalEarnedXmr:1.0000001},
    {ts:3,totalEarnedXmr:1.0000002},
    {ts:4,totalEarnedXmr:1.0000003}
  ]
});
assert.strictEqual(observed.source, 'incremento_observado_pool');
assert.ok(observed.quantumXmr > 0);

const hybrid = G.hybridRateEstimate({
  empiricalRate: 2e-9, empiricalConfidence: 0.8,
  poolRate: 1e-9, poolConfidence: 0.8,
  localRate: 0.8e-9, localConfidence: 0.5
});
assert.ok(hybrid.rate > 0);
assert.ok(hybrid.confidence > 0);
assert.ok(hybrid.sources.length >= 2);

const p = G.projectionTable({
  xmrPerSec: 1e-9,
  priceBrl: 2000,
  electricityBrlKwh: 0.9,
  powerWatts: 100,
  cloudCostBrlDay: 0
});
assert.ok(p.periods.day.grossXmr > 0);
assert.ok(p.periods.day.energyBrl > 0);
assert.ok(Number.isFinite(p.periods.day.netBrl));

const share = G.shareArrivalEstimate(1000, 100000);
approx(share.meanSec, 100);

console.log('goldbrain 4.1 tests: OK');
