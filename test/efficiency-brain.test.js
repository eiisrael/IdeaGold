'use strict';

const assert = require('assert');
const E = require('../lib/efficiency-brain');

{
  const s = E.robustStats([1000, 1005, 995, 1002, 5000]);
  assert(s.median >= 995 && s.median <= 1005, 'median must resist outlier');
  assert(s.cv < 0.1, 'MAD CV must resist outlier');
}

{
  assert.strictEqual(E.billableWatts({ miningWatts: 105, idleWatts: 55, mode: 'incremental' }), 50);
  assert.strictEqual(E.billableWatts({ miningWatts: 105, idleWatts: 55, mode: 'full' }), 105);
}

{
  const e = E.dailyEconomics({ xmrPerHour: 0.000004, priceBrl: 2100, tariffBrlKwh: 1.6, miningWatts: 105 });
  assert(e.grossBrlDay > 0);
  assert(e.energyBrlDay > e.grossBrlDay);
  assert(e.netBrlDay < 0);
  assert(e.improvementToBreakEven > 1);
}

{
  const hot = E.candidateUtility({ hashrate: 2000, powerWatts: 80, powerMeasured: true, temperatureC: 90 }, { maxTempC: 82 });
  assert.strictEqual(hot.safe, false);
}

{
  const badShares = E.candidateUtility({ hashrate: 2000, accepted: 90, rejected: 10, powerWatts: 80, powerMeasured: true });
  assert.strictEqual(badShares.safe, false);
}

{
  const result = E.chooseCandidate([
    { id: 'current', current: true, hashrate: 1000, powerWatts: 100, powerMeasured: true, netBrlDay: -2.0, accepted: 20, rejected: 0, stabilityCv: 0.08 },
    { id: 'candidate', hashrate: 1100, powerWatts: 100, powerMeasured: true, netBrlDay: -1.0, accepted: 20, rejected: 0, stabilityCv: 0.08 }
  ], { minImprovementPct: 5 });
  assert.strictEqual(result.winner.id, 'candidate');
  assert.strictEqual(result.switchRecommended, true);
}

{
  const noChurn = E.chooseCandidate([
    { id: 'current', current: true, hashrate: 1000, powerWatts: 80, powerMeasured: false, accepted: 20, rejected: 0, stabilityCv: 0.08 },
    { id: 'tiny', hashrate: 1010, powerWatts: 80, powerMeasured: false, accepted: 20, rejected: 0, stabilityCv: 0.08 }
  ], { minImprovementPct: 5 });
  assert.strictEqual(noChurn.switchRecommended, false, 'small gain must not cause churn');
}

{
  const pick = E.ucb1([
    { id: 'a', samples: 10, meanUtility: 1.0 },
    { id: 'b', samples: 0, meanUtility: 0 }
  ]);
  assert.strictEqual(pick.candidate.id, 'b', 'UCB must explore untested candidate');
}

console.log('efficiency-brain tests: OK');
