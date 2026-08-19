'use strict';

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function median(values) {
  const xs = (values || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function robustStats(values) {
  const xs = (values || []).map(Number).filter(x => Number.isFinite(x) && x >= 0);
  if (!xs.length) return { samples: 0, median: 0, mad: 0, sigma: 0, cv: 1 };
  const med = median(xs);
  const mad = median(xs.map(x => Math.abs(x - med)));
  const sigma = 1.4826 * mad;
  const cv = med > 0 ? clamp(sigma / med, 0, 5) : 1;
  return { samples: xs.length, median: med, mad, sigma, cv };
}

function billableWatts({ miningWatts = 0, idleWatts = 0, mode = 'full' } = {}) {
  const mining = Math.max(0, finite(miningWatts));
  const idle = Math.max(0, finite(idleWatts));
  if (mode === 'incremental') return Math.max(0, mining - idle);
  return mining;
}

function dailyEconomics(input = {}) {
  const xmrPerHour = Math.max(0, finite(input.xmrPerHour));
  const priceBrl = Math.max(0, finite(input.priceBrl));
  const tariff = Math.max(0, finite(input.tariffBrlKwh));
  const cloud = Math.max(0, finite(input.cloudCostBrlDay));
  const watts = billableWatts({
    miningWatts: input.miningWatts,
    idleWatts: input.idleWatts,
    mode: input.costMode
  });
  const xmrDay = xmrPerHour * 24;
  const grossBrlDay = xmrDay * priceBrl;
  const energyBrlDay = watts / 1000 * 24 * tariff;
  const netBrlDay = grossBrlDay - energyBrlDay - cloud;
  const costBrlDay = energyBrlDay + cloud;
  const revenueCostRatio = costBrlDay > 0 ? grossBrlDay / costBrlDay : (grossBrlDay > 0 ? Infinity : 0);
  const improvementToBreakEven = grossBrlDay > 0 ? Math.max(1, costBrlDay / grossBrlDay) : Infinity;
  const breakEvenTariff = watts > 0 ? Math.max(0, (grossBrlDay - cloud) / (watts / 1000 * 24)) : null;
  return {
    xmrDay,
    grossBrlDay,
    energyBrlDay,
    cloudBrlDay: cloud,
    costBrlDay,
    netBrlDay,
    billableWatts: watts,
    revenueCostRatio,
    improvementToBreakEven,
    breakEvenTariff
  };
}

function candidateUtility(candidate = {}, options = {}) {
  const maxTempC = finite(options.maxTempC, 82);
  const temp = finite(candidate.temperatureC, 0);
  const rejected = Math.max(0, finite(candidate.rejected));
  const accepted = Math.max(0, finite(candidate.accepted));
  const shares = accepted + rejected;
  const acceptance = shares > 0 ? accepted / shares : 1;
  const hashrate = Math.max(0, finite(candidate.hashrate));
  const watts = Math.max(0, finite(candidate.powerWatts));
  const stabilityCv = clamp(candidate.stabilityCv ?? 0.15, 0, 5);
  const measuredEconomics = Number.isFinite(Number(candidate.netBrlDay)) && candidate.powerMeasured === true;

  if (temp > 0 && temp > maxTempC) {
    return { utility: -Infinity, safe: false, reason: `temperatura ${temp.toFixed(1)} C acima do limite ${maxTempC} C`, acceptance };
  }
  if (acceptance < 0.97 && shares >= 5) {
    return { utility: -Infinity, safe: false, reason: `taxa de shares aceitas ${(acceptance * 100).toFixed(1)}%`, acceptance };
  }
  if (!(hashrate > 0)) return { utility: -Infinity, safe: false, reason: 'sem hashrate real', acceptance };

  const stability = 1 / (1 + stabilityCv * 2);
  if (measuredEconomics) {
    const utility = finite(candidate.netBrlDay) * 100 + stability * 5 + acceptance * 5;
    return { utility, safe: true, basis: 'net_brl_measured', acceptance, stability };
  }
  if (watts > 0 && candidate.powerMeasured === true) {
    const hashPerWatt = hashrate / watts;
    return { utility: hashPerWatt * stability * acceptance, safe: true, basis: 'hash_per_watt_measured', acceptance, stability, hashPerWatt };
  }
  return { utility: Math.log1p(hashrate) * stability * acceptance, safe: true, basis: 'hashrate_only_low_confidence', acceptance, stability };
}

function chooseCandidate(candidates = [], options = {}) {
  const minImprovementPct = Math.max(0, finite(options.minImprovementPct, 5));
  const scored = candidates.map(candidate => ({ ...candidate, score: candidateUtility(candidate, options) }));
  const safe = scored.filter(item => item.score.safe && Number.isFinite(item.score.utility));
  if (!safe.length) return { winner: null, switchRecommended: false, scored, reason: 'nenhum candidato seguro' };
  safe.sort((a, b) => b.score.utility - a.score.utility);
  const winner = safe[0];
  const current = scored.find(item => item.current);
  if (!current || !current.score.safe || !Number.isFinite(current.score.utility)) {
    return { winner, switchRecommended: true, scored, improvementPct: Infinity, reason: 'configuração atual sem score seguro' };
  }
  const denom = Math.max(Math.abs(current.score.utility), 1e-9);
  const improvementPct = (winner.score.utility - current.score.utility) / denom * 100;
  const switchRecommended = winner.id !== current.id && improvementPct >= minImprovementPct;
  return {
    winner,
    current,
    switchRecommended,
    improvementPct,
    scored,
    reason: switchRecommended ? `ganho robusto >= ${minImprovementPct}%` : 'histerese evita troca sem ganho suficiente'
  };
}

function ucb1(candidates = [], options = {}) {
  const exploration = Math.max(0, finite(options.exploration, 1.15));
  const rows = candidates.filter(c => c && c.enabled !== false);
  if (!rows.length) return null;
  const untested = rows.find(c => Math.max(0, finite(c.samples)) === 0);
  if (untested) return { candidate: untested, reason: 'candidato ainda não medido', score: Infinity };
  const total = Math.max(1, rows.reduce((sum, c) => sum + Math.max(1, finite(c.samples, 1)), 0));
  let best = null;
  for (const candidate of rows) {
    const n = Math.max(1, finite(candidate.samples, 1));
    const mean = finite(candidate.meanUtility);
    const score = mean + exploration * Math.sqrt(Math.log(total) / n);
    if (!best || score > best.score) best = { candidate, score, reason: 'UCB1: exploração controlada x desempenho observado' };
  }
  return best;
}

function recommendations(status = {}, economics = null) {
  const out = [];
  const diag = status.miner?.diagnostics || {};
  if (diag.hugePagesPct === 0) out.push({ priority: 100, code: 'huge_pages', text: 'Huge Pages está em 0%. Corrigir isso antes de testar mineradores novos.' });
  if (diag.msr === 'error') out.push({ priority: 95, code: 'msr', text: 'MSR falhou. Corrigir privilégios/driver antes de qualquer tuning.' });
  if (status.profit?.powerSource !== 'measured') out.push({ priority: 90, code: 'wattmeter', text: 'Consumo ainda é estimado. Medir watts na tomada é necessário para otimizar R$/W de verdade.' });
  if (economics && economics.netBrlDay < 0) out.push({ priority: 80, code: 'negative_net', text: `Configuração atual está negativa em R$ ${Math.abs(economics.netBrlDay).toFixed(2)}/dia; benchmark deve buscar eficiência, não apenas H/s.` });
  if (!status.miner?.gpuActive) out.push({ priority: 60, code: 'gpu_probe', text: 'GPU ainda não tem backend real confirmado. Testar somente em laboratório/capability probe antes de ativar em produção.' });
  if ((status.session?.rejectedShares || 0) > 0) out.push({ priority: 70, code: 'rejects', text: 'Há shares rejeitadas na sessão; estabilidade/rede deve ser corrigida antes de aumentar carga.' });
  return out.sort((a, b) => b.priority - a.priority);
}

module.exports = {
  finite,
  clamp,
  median,
  robustStats,
  billableWatts,
  dailyEconomics,
  candidateUtility,
  chooseCandidate,
  ucb1,
  recommendations
};
