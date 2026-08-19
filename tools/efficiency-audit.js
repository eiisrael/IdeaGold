'use strict';

const fs = require('fs');
const path = require('path');
const E = require('../lib/efficiency-brain');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME = path.join(ROOT, 'runtime');
const API = process.env.IDEAGOLD_LOCAL_API || 'http://127.0.0.1:8080/api/simple/status';

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(v => v.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const seconds = Math.max(30, Math.min(1800, Number(arg('seconds', 180)) || 180));
const intervalSec = Math.max(3, Math.min(60, Number(arg('interval', 10)) || 10));
const idleWatts = Math.max(0, Number(arg('idle-watts', 0)) || 0);
const miningWattsOverride = Math.max(0, Number(arg('mining-watts', 0)) || 0);
const costMode = String(arg('cost-mode', idleWatts > 0 ? 'incremental' : 'full')).toLowerCase() === 'incremental' ? 'incremental' : 'full';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getStatus() {
  const response = await fetch(API, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`IdeaGold API HTTP ${response.status}`);
  return response.json();
}

function fmt(n, digits = 2) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function brl(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function main() {
  fs.mkdirSync(RUNTIME, { recursive: true });
  console.log('\nIdeaGold Efficiency Lab — auditoria passiva');
  console.log('Nenhuma configuração será alterada. O minerador continua exatamente como está.');
  console.log(`Coletando ${seconds}s, amostra a cada ${intervalSec}s...\n`);

  const samples = [];
  const started = Date.now();
  let first = null;
  while ((Date.now() - started) / 1000 < seconds) {
    try {
      const status = await getStatus();
      if (!first) first = status;
      const sample = {
        ts: Date.now(),
        mining: Boolean(status.miner?.mining),
        state: status.miner?.state || 'unknown',
        localHashrate: Number(status.miner?.hashrate || 0),
        effectiveHashrate: Number(status.miner?.effectiveHashrate || 0),
        accepted: Number(status.session?.acceptedShares || 0),
        rejected: Number(status.session?.rejectedShares || 0),
        xmrPerHour: Number(status.estimator?.xmrPerHour || 0),
        confidence: Number(status.estimator?.confidence || 0),
        poolFresh: Boolean(status.pool?.fresh),
        poolHashrate: Number(status.pool?.normalizedHashrate || 0),
        priceBrl: Number(status.market?.xmrBRL || 0),
        powerWatts: miningWattsOverride || Number(status.profit?.powerWatts || 0),
        powerMeasured: miningWattsOverride > 0 || status.profit?.powerSource === 'measured',
        hugePagesPct: status.miner?.diagnostics?.hugePagesPct,
        msr: status.miner?.diagnostics?.msr || 'unknown',
        gpuActive: Boolean(status.miner?.gpuActive),
        algo: status.miner?.algo || ''
      };
      samples.push(sample);
      process.stdout.write(`\r${samples.length} amostras | local ${fmt(sample.localHashrate, 0)} H/s | efetivo ${fmt(sample.effectiveHashrate, 0)} H/s | ETA conf ${fmt(sample.confidence * 100, 0)}%   `);
    } catch (error) {
      process.stdout.write(`\rAPI indisponível: ${error.message}                         `);
    }
    await sleep(intervalSec * 1000);
  }
  console.log('\n');

  if (!samples.length) throw new Error('Nenhuma amostra válida. Deixe o IdeaGold aberto em http://127.0.0.1:8080.');
  const miningSamples = samples.filter(s => s.mining && s.localHashrate > 0);
  const local = E.robustStats(miningSamples.map(s => s.localHashrate));
  const effective = E.robustStats(miningSamples.map(s => s.effectiveHashrate).filter(v => v > 0));
  const latest = samples.at(-1);
  const xmrRate = E.robustStats(miningSamples.map(s => s.xmrPerHour).filter(v => v > 0));
  const miningWatts = miningWattsOverride || E.robustStats(miningSamples.map(s => s.powerWatts).filter(v => v > 0)).median;
  const tariff = Number(first?.settings?.electricity || 0);
  const priceBrl = E.robustStats(samples.map(s => s.priceBrl).filter(v => v > 0)).median;
  const economics = E.dailyEconomics({
    xmrPerHour: xmrRate.median,
    priceBrl,
    tariffBrlKwh: tariff,
    miningWatts,
    idleWatts,
    costMode
  });
  const recommendationStatus = {
    ...first,
    miner: {
      ...(first?.miner || {}),
      diagnostics: {
        ...(first?.miner?.diagnostics || {}),
        hugePagesPct: latest.hugePagesPct,
        msr: latest.msr
      },
      gpuActive: latest.gpuActive
    },
    profit: {
      ...(first?.profit || {}),
      powerSource: miningWattsOverride > 0 ? 'measured-manual' : first?.profit?.powerSource
    },
    session: {
      ...(first?.session || {}),
      rejectedShares: latest.rejected
    }
  };
  const advice = E.recommendations(recommendationStatus, economics);
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    durationSec: Math.round((Date.now() - started) / 1000),
    samples: samples.length,
    realMiningSamples: miningSamples.length,
    hash: { local, effective },
    rate: { xmrPerHour: xmrRate },
    power: {
      miningWatts,
      idleWatts,
      costMode,
      measured: miningWattsOverride > 0 || latest.powerMeasured
    },
    market: { xmrBrl: priceBrl, tariffBrlKwh: tariff },
    economics,
    latest: {
      state: latest.state,
      accepted: latest.accepted,
      rejected: latest.rejected,
      hugePagesPct: latest.hugePagesPct,
      msr: latest.msr,
      gpuActive: latest.gpuActive,
      algo: latest.algo
    },
    advice,
    rawSamples: samples
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(RUNTIME, `efficiency-audit-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));

  console.log('=== RESULTADO ===');
  console.log(`Hash local robusto: ${fmt(local.median, 0)} H/s (CV ${fmt(local.cv * 100, 1)}%)`);
  console.log(`Hash efetivo robusto: ${fmt(effective.median, 0)} H/s`);
  console.log(`Ritmo robusto: ${Number(xmrRate.median || 0).toFixed(12)} XMR/h`);
  console.log(`Potência usada na conta: ${fmt(economics.billableWatts, 1)} W (${costMode}${report.power.measured ? ', medida' : ', estimada'})`);
  console.log(`Receita estimada/dia: ${brl(economics.grossBrlDay)}`);
  console.log(`Energia estimada/dia: ${brl(economics.energyBrlDay)}`);
  console.log(`Líquido estimado/dia: ${brl(economics.netBrlDay)}`);
  if (Number.isFinite(economics.improvementToBreakEven)) console.log(`Multiplicador necessário para empatar, mantendo custos: ${fmt(economics.improvementToBreakEven, 2)}x`);
  console.log('\nPrioridades:');
  if (!advice.length) console.log('- Nenhum bloqueador óbvio detectado nesta janela.');
  for (const item of advice) console.log(`- [${item.priority}] ${item.text}`);
  console.log(`\nRelatório salvo em: ${file}`);
}

main().catch(error => {
  console.error(`\nERRO: ${error.message}`);
  process.exitCode = 1;
});
