'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const RUNTIME_DIR = path.join(ROOT, 'runtime');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const LEGACY_USER_FILE = path.join(DATA_DIR, 'user.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(RUNTIME_DIR, { recursive: true });

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('='); if (eq < 1) continue;
    const key = line.slice(0, eq).trim(); let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnv();

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
function clamp(value, min, max, fallback = min) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function validWallet(value) {
  const s = String(value || '').trim();
  return /^[48][1-9A-HJ-NP-Za-km-z]{94}$/.test(s) || /^4[1-9A-HJ-NP-Za-km-z]{105}$/.test(s);
}
function hardwareFingerprint() {
  const cpus = os.cpus() || [];
  const raw = JSON.stringify({
    cpu: cpus[0]?.model || 'unknown',
    logical: cpus.length,
    arch: os.arch(),
    memoryBucketGB: Math.round(os.totalmem() / 1024 ** 3),
    platform: os.platform(),
    release: os.release().split('.').slice(0, 2).join('.')
  });
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}
function defaultThreads() {
  const cpus = os.cpus() || [];
  const model = cpus[0]?.model || '';
  if (/i5-4670K/i.test(model)) return 3;
  return Math.max(1, Math.round(Math.max(1, cpus.length) * 0.75));
}
function defaults() {
  return {
    wallet: '',
    pool: { adapter: 'moneroocean', host: 'gulf.moneroocean.stream', port: 20128, tls: true, workerName: os.hostname().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'IdeaGold' },
    electricityBrlKwh: 0.90,
    currency: 'BRL',
    power: { mode: 'estimated', measuredMiningWatts: 0, idleWatts: 0, costMode: 'full', estimatedBaseWatts: 30, estimatedCpuWatts: 75 },
    thermal: { warningC: 75, criticalC: 85, autoPauseCritical: true },
    mining: { threads: defaultThreads(), priority: 3, yield: false, pauseOnActiveSeconds: 0, donationPct: 1 },
    optimization: { enabled: false, mode: 'balanced', autoApply: false, minImprovementPct: 5, warmupSec: 35, sampleSec: 75, minSamples: 6 },
    privacy: { localOnly: true },
    ui: { mode: 'basic' },
    fingerprint: hardwareFingerprint(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
function migrateLegacy() {
  if (fs.existsSync(SETTINGS_FILE)) return;
  const legacy = readJson(LEGACY_USER_FILE, null);
  if (!legacy) return;
  const d = defaults();
  if (validWallet(legacy.wallet)) d.wallet = legacy.wallet;
  if (Number.isFinite(Number(legacy.electricity))) d.electricityBrlKwh = Number(legacy.electricity);
  if (Number(legacy.measuredPowerWatts) > 0) {
    d.power.mode = 'manual-wattmeter';
    d.power.measuredMiningWatts = Number(legacy.measuredPowerWatts);
  }
  if (Number(legacy.cpuThreadsPercent) > 0) {
    const total = Math.max(1, os.cpus().length);
    d.mining.threads = Math.max(1, Math.min(total, Math.round(total * Number(legacy.cpuThreadsPercent) / 100)));
  }
  d.migratedFrom = 'IdeaGold 4.1 data/user.json';
  writeJsonAtomic(SETTINGS_FILE, d);
}
function sanitize(input = {}, current = defaults()) {
  const out = structuredClone(current);
  if (Object.hasOwn(input, 'wallet')) {
    const wallet = String(input.wallet || '').trim();
    if (wallet && !validWallet(wallet)) throw Object.assign(new Error('Carteira XMR pública inválida.'), { status: 400 });
    out.wallet = wallet;
  }
  if (input.pool && typeof input.pool === 'object') {
    const previousAdapter = out.pool.adapter;
    out.pool.adapter = ['moneroocean', 'p2pool'].includes(input.pool.adapter) ? input.pool.adapter : out.pool.adapter;
    if (out.pool.adapter !== previousAdapter && input.pool.host === undefined) {
      if (out.pool.adapter === 'p2pool') { out.pool.host = '127.0.0.1'; out.pool.port = 3333; out.pool.tls = false; }
      else { out.pool.host = 'gulf.moneroocean.stream'; out.pool.port = 20128; out.pool.tls = true; }
    }
    if (typeof input.pool.host === 'string' && /^[a-zA-Z0-9.-]{1,253}$/.test(input.pool.host)) out.pool.host = input.pool.host;
    out.pool.port = Math.round(clamp(input.pool.port, 1, 65535, out.pool.port));
    out.pool.tls = input.pool.tls !== undefined ? Boolean(input.pool.tls) : out.pool.tls;
    if (typeof input.pool.workerName === 'string') out.pool.workerName = input.pool.workerName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || out.pool.workerName;
  }
  if (input.electricityBrlKwh !== undefined) out.electricityBrlKwh = clamp(input.electricityBrlKwh, 0, 20, out.electricityBrlKwh);
  if (input.power && typeof input.power === 'object') {
    if (['estimated', 'manual-wattmeter'].includes(input.power.mode)) out.power.mode = input.power.mode;
    out.power.measuredMiningWatts = clamp(input.power.measuredMiningWatts ?? out.power.measuredMiningWatts, 0, 3000, out.power.measuredMiningWatts);
    out.power.idleWatts = clamp(input.power.idleWatts ?? out.power.idleWatts, 0, 3000, out.power.idleWatts);
    if (['full', 'incremental'].includes(input.power.costMode)) out.power.costMode = input.power.costMode;
    out.power.estimatedBaseWatts = clamp(input.power.estimatedBaseWatts ?? out.power.estimatedBaseWatts, 0, 1000, out.power.estimatedBaseWatts);
    out.power.estimatedCpuWatts = clamp(input.power.estimatedCpuWatts ?? out.power.estimatedCpuWatts, 0, 1000, out.power.estimatedCpuWatts);
  }
  if (input.thermal && typeof input.thermal === 'object') {
    out.thermal.warningC = clamp(input.thermal.warningC ?? out.thermal.warningC, 40, 100, out.thermal.warningC);
    out.thermal.criticalC = clamp(input.thermal.criticalC ?? out.thermal.criticalC, out.thermal.warningC + 1, 110, out.thermal.criticalC);
    if (input.thermal.autoPauseCritical !== undefined) out.thermal.autoPauseCritical = Boolean(input.thermal.autoPauseCritical);
  }
  if (input.mining && typeof input.mining === 'object') {
    const maxThreads = Math.max(1, os.cpus().length);
    out.mining.threads = Math.round(clamp(input.mining.threads ?? out.mining.threads, 1, maxThreads, out.mining.threads));
    out.mining.priority = Math.round(clamp(input.mining.priority ?? out.mining.priority, 0, 5, out.mining.priority));
    if (input.mining.yield !== undefined) out.mining.yield = Boolean(input.mining.yield);
    out.mining.pauseOnActiveSeconds = Math.round(clamp(input.mining.pauseOnActiveSeconds ?? out.mining.pauseOnActiveSeconds, 0, 3600, out.mining.pauseOnActiveSeconds));
    out.mining.donationPct = Math.round(clamp(input.mining.donationPct ?? out.mining.donationPct, 1, 10, 1));
  }
  if (input.optimization && typeof input.optimization === 'object') {
    if (input.optimization.enabled !== undefined) out.optimization.enabled = Boolean(input.optimization.enabled);
    if (['performance', 'efficiency', 'profit', 'balanced', 'eco', 'manual'].includes(input.optimization.mode)) out.optimization.mode = input.optimization.mode;
    if (input.optimization.autoApply !== undefined) out.optimization.autoApply = Boolean(input.optimization.autoApply);
    out.optimization.minImprovementPct = clamp(input.optimization.minImprovementPct ?? out.optimization.minImprovementPct, 1, 50, out.optimization.minImprovementPct);
    out.optimization.warmupSec = Math.round(clamp(input.optimization.warmupSec ?? out.optimization.warmupSec, 20, 600, out.optimization.warmupSec));
    out.optimization.sampleSec = Math.round(clamp(input.optimization.sampleSec ?? out.optimization.sampleSec, 30, 1800, out.optimization.sampleSec));
    out.optimization.minSamples = Math.round(clamp(input.optimization.minSamples ?? out.optimization.minSamples, 3, 120, out.optimization.minSamples));
  }
  if (input.ui && typeof input.ui === 'object' && ['basic', 'advanced'].includes(input.ui.mode)) out.ui.mode = input.ui.mode;
  out.fingerprint = current.fingerprint || hardwareFingerprint();
  out.updatedAt = new Date().toISOString();
  return out;
}

migrateLegacy();

function getSettings() {
  return { ...defaults(), ...readJson(SETTINGS_FILE, {}) };
}
function saveSettings(input) {
  const next = sanitize(input, getSettings());
  writeJsonAtomic(SETTINGS_FILE, next);
  return next;
}

module.exports = { ROOT, DATA_DIR, RUNTIME_DIR, SETTINGS_FILE, readJson, writeJsonAtomic, validWallet, getSettings, saveSettings, hardwareFingerprint, defaultThreads, clamp };
