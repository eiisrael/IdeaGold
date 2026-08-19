'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function validWallet(value) {
  const s = String(value || '').trim();
  return /^[48][1-9A-HJ-NP-Za-km-z]{94}$/.test(s) || /^4[1-9A-HJ-NP-Za-km-z]{105}$/.test(s);
}

function normalizeConfig(input = {}) {
  return {
    threads: Math.max(1, Math.min(256, Math.round(Number(input.threads || 1)))),
    priority: Math.max(0, Math.min(5, Math.round(Number(input.priority ?? 3)))),
    yield: input.yield !== false,
    hugePages: input.hugePages !== false,
    hugePagesJit: input.hugePagesJit !== false,
    rdmsr: input.rdmsr !== false,
    wrmsr: input.wrmsr !== false,
    numa: input.numa !== false,
    randomxMode: ['auto', 'fast', 'light'].includes(input.randomxMode) ? input.randomxMode : 'fast',
    scratchpadPrefetch: [0, 1, 2, 3].includes(Number(input.scratchpadPrefetch)) ? Number(input.scratchpadPrefetch) : 1,
    pauseOnBattery: input.pauseOnBattery !== false,
    pauseOnActive: Math.max(0, Math.round(Number(input.pauseOnActive || 0))),
    affinity: typeof input.affinity === 'string' ? input.affinity.trim().slice(0, 128) : '',
    donateLevel: Math.max(1, Math.min(5, Math.round(Number(input.donateLevel || 1))))
  };
}

class ConfigManager {
  constructor(root) {
    this.root = root;
    this.runtime = path.join(root, 'runtime');
    fs.mkdirSync(this.runtime, { recursive: true });
    this.generated = path.join(this.runtime, 'config.generated.json');
    this.safe = path.join(this.runtime, 'config.safe.json');
    this.user = path.join(this.runtime, 'config.user.json');
    this.audit = path.join(this.runtime, 'config-audit.jsonl');
  }

  build({ wallet, workerName, pool, profile, apiPort = 18080 }) {
    if (!validWallet(wallet)) throw new Error('Carteira XMR pública inválida.');
    if (!pool?.host || !pool?.port) throw new Error('Pool sem endpoint válido.');
    const p = normalizeConfig(profile);
    const worker = String(workerName || 'IdeaGold').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'IdeaGold';
    const pass = pool.passwordBuilder ? pool.passwordBuilder(worker) : (pool.password || worker);
    const cfg = {
      autosave: false,
      background: false,
      colors: false,
      randomx: {
        init: -1,
        mode: p.randomxMode,
        '1gb-pages': false,
        rdmsr: p.rdmsr,
        wrmsr: p.wrmsr,
        numa: p.numa,
        'scratchpad-prefetch-mode': p.scratchpadPrefetch
      },
      cpu: {
        enabled: true,
        'huge-pages': p.hugePages,
        'huge-pages-jit': p.hugePagesJit,
        'max-threads-hint': 100,
        yield: p.yield,
        priority: p.priority,
        asm: true
      },
      opencl: { enabled: false },
      cuda: { enabled: false },
      pools: [{
        url: `${pool.host}:${pool.port}`,
        user: wallet,
        pass,
        'rig-id': worker,
        keepalive: true,
        tls: pool.tls !== false,
        'tls-fingerprint': null,
        enabled: true
      }],
      http: {
        enabled: true,
        host: '127.0.0.1',
        port: apiPort,
        'access-token': null,
        restricted: true
      },
      'donate-level': p.donateLevel,
      'print-time': 10,
      'health-print-time': 30,
      'pause-on-battery': p.pauseOnBattery,
      'pause-on-active': p.pauseOnActive,
      'log-file': path.join(this.runtime, 'xmrig-v5.log')
    };
    return { config: cfg, profile: p };
  }

  saveGenerated(config, meta = {}) {
    this.backupFile(this.generated, 'generated');
    fs.writeFileSync(this.generated, JSON.stringify(config, null, 2));
    this.log('generated', meta);
    return this.generated;
  }

  saveUser(config) {
    this.backupFile(this.user, 'user');
    fs.writeFileSync(this.user, JSON.stringify(config, null, 2));
    this.log('user-saved', {});
  }

  saveSafe(config, meta = {}) {
    this.backupFile(this.safe, 'safe');
    fs.writeFileSync(this.safe, JSON.stringify(config, null, 2));
    this.log('safe-saved', meta);
  }

  readSafe() {
    try { return JSON.parse(fs.readFileSync(this.safe, 'utf8')); } catch { return null; }
  }
  readUser() {
    try { return JSON.parse(fs.readFileSync(this.user, 'utf8')); } catch { return null; }
  }

  importExisting(file) {
    const full = path.resolve(String(file || ''));
    if (!fs.existsSync(full)) throw new Error('Config informado não existe.');
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    this.saveUser(data);
    return { imported: true, source: full, target: this.user };
  }

  backupFile(file, label) {
    if (!fs.existsSync(file)) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${file}.${stamp}.${label}.bak`;
    fs.copyFileSync(file, backup);
    return backup;
  }

  hash(config) {
    return crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
  }

  log(action, meta) {
    fs.appendFileSync(this.audit, JSON.stringify({ ts: Date.now(), action, ...meta }) + '\n');
  }
}

module.exports = { ConfigManager, validWallet, normalizeConfig };
