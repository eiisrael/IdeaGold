'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const EventEmitter = require('events');

const STOCK = {
  version: '6.26.0',
  asset: 'xmrig-6.26.0-windows-x64.zip',
  sha256: 'bba8097cb37d9b458a1cb1137876b27cde6740d17fe4ccbc086ba07d87d9e147'
};
STOCK.url = `https://github.com/xmrig/xmrig/releases/download/v${STOCK.version}/${STOCK.asset}`;

function processAlive(pid) {
  if (!pid) return false;
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

function findFile(dir, name) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return full;
    if (e.isDirectory()) {
      const nested = findFile(full, name);
      if (nested) return nested;
    }
  }
  return null;
}

class XMRigController extends EventEmitter {
  constructor(root, configManager) {
    super();
    this.root = root;
    this.configManager = configManager;
    this.runtime = path.join(root, 'runtime');
    this.metaFile = path.join(this.runtime, 'xmrig-v5-meta.json');
    this.stateFile = path.join(this.runtime, 'xmrig-v5-state.json');
    this.logFile = path.join(this.runtime, 'xmrig-v5.log');
    this.child = null;
    this.currentProfile = null;
    this.apiPort = 18080;
    fs.mkdirSync(this.runtime, { recursive: true });
  }

  readJson(file, fallback = {}) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  }
  writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2)); }

  async install() {
    if (process.platform !== 'win32') {
      const manual = process.env.XMRIG_PATH;
      if (manual && fs.existsSync(manual)) return this.verifyManual(manual);
      throw new Error('Instalação automática está habilitada somente no Windows x64. Em Linux configure XMRIG_PATH para o binário oficial.');
    }
    if (process.arch !== 'x64') throw new Error('O pacote XMRig automático deste perfil requer Windows x64.');
    const existing = this.readJson(this.metaFile, {});
    if (existing.exe && fs.existsSync(existing.exe) && existing.verified) return existing;

    const zip = path.join(this.runtime, STOCK.asset);
    const folder = path.join(this.runtime, `xmrig-${STOCK.version}`);
    const response = await fetch(STOCK.url, { redirect: 'follow', headers: { 'user-agent': 'IdeaGold/5.0' }, signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Falha ao baixar XMRig oficial: HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    if (sha256 !== STOCK.sha256) throw new Error('Checksum do XMRig não corresponde ao valor fixado. Nada foi executado.');
    fs.writeFileSync(zip, buffer);
    fs.rmSync(folder, { recursive: true, force: true });
    fs.mkdirSync(folder, { recursive: true });
    const quote = s => String(s).replaceAll("'", "''");
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath '${quote(zip)}' -DestinationPath '${quote(folder)}' -Force`], { encoding: 'utf8', windowsHide: true });
    fs.rmSync(zip, { force: true });
    if (result.status !== 0) throw new Error(`Falha ao extrair XMRig: ${result.stderr || result.stdout || 'erro desconhecido'}`);
    const exe = findFile(folder, 'xmrig.exe');
    if (!exe) throw new Error('xmrig.exe não encontrado após extração.');
    const meta = { exe, version: STOCK.version, sha256, verified: true, source: 'xmrig/xmrig official release', installedAt: Date.now() };
    this.writeJson(this.metaFile, meta);
    return meta;
  }

  verifyManual(exe) {
    const result = spawnSync(exe, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (result.status !== 0) throw new Error('XMRIG_PATH não parece apontar para um XMRig funcional.');
    const text = `${result.stdout || ''}\n${result.stderr || ''}`;
    const version = (text.match(/XMRig\s+v?([0-9.]+)/i) || [])[1] || 'desconhecida';
    const meta = { exe: path.resolve(exe), version, verified: false, source: 'XMRIG_PATH fornecido pelo usuário', installedAt: Date.now() };
    this.writeJson(this.metaFile, meta);
    return meta;
  }

  meta() { return this.readJson(this.metaFile, {}); }
  state() {
    const s = this.readJson(this.stateFile, {});
    s.processRunning = processAlive(s.pid);
    return s;
  }

  async start({ wallet, workerName, pool, profile, reason = 'user' }) {
    const current = this.state();
    if (current.processRunning) return { alreadyRunning: true, ...current };
    const meta = await this.install();
    const built = this.configManager.build({ wallet, workerName, pool, profile, apiPort: this.apiPort });
    const configFile = this.configManager.saveGenerated(built.config, { reason, profile: built.profile });
    const out = fs.openSync(this.logFile, 'a');
    const args = ['-c', configFile, '--http-host=127.0.0.1', `--http-port=${this.apiPort}`, '--threads', String(built.profile.threads)];
    if (built.profile.affinity) args.push('--cpu-affinity', built.profile.affinity);
    this.child = spawn(meta.exe, args, { cwd: path.dirname(meta.exe), stdio: ['ignore', out, out], windowsHide: true, detached: false });
    const state = {
      pid: this.child.pid,
      desired: 'running',
      startedAt: Date.now(),
      profile: built.profile,
      configFile,
      configHash: this.configManager.hash(built.config),
      restartTimes: [],
      reason
    };
    this.writeJson(this.stateFile, state);
    this.currentProfile = built.profile;
    this.child.on('exit', (code, signal) => {
      const s = this.readJson(this.stateFile, {});
      s.lastExitAt = Date.now(); s.exitCode = code; s.exitSignal = signal; s.pid = null;
      this.writeJson(this.stateFile, s);
      this.child = null;
      this.emit('exit', { code, signal, desired: s.desired });
    });
    this.emit('start', state);
    return state;
  }

  stop(reason = 'user') {
    const s = this.state();
    s.desired = 'stopped'; s.stopReason = reason; s.stoppedAt = Date.now();
    if (s.processRunning) this.killPid(s.pid);
    s.pid = null;
    this.writeJson(this.stateFile, s);
    this.child = null;
    this.emit('stop', s);
    return s;
  }

  pause() {
    const s = this.state();
    if (!s.processRunning) { s.desired = 'paused'; this.writeJson(this.stateFile, s); return s; }
    // Windows has no portable safe suspend API in stock Node. Pause is an explicit stop/resume cycle.
    s.desired = 'paused'; s.pausedAt = Date.now();
    this.killPid(s.pid); s.pid = null; this.writeJson(this.stateFile, s);
    this.child = null; this.emit('pause', s); return s;
  }

  async resume(context) {
    const s = this.state();
    if (s.processRunning) return s;
    return this.start({ ...context, profile: s.profile || context.profile, reason: 'resume' });
  }

  async restart(context, reason = 'restart') {
    const old = this.state();
    if (old.processRunning) this.killPid(old.pid);
    await new Promise(r => setTimeout(r, 700));
    return this.start({ ...context, reason });
  }

  killPid(pid) {
    if (!pid) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    else { try { process.kill(Number(pid), 'SIGTERM'); } catch {} }
  }

  async api(endpoint = '/2/summary') {
    try {
      const r = await fetch(`http://127.0.0.1:${this.apiPort}${endpoint}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(1800) });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }

  async telemetry() {
    const [summary, backends] = await Promise.all([this.api('/2/summary'), this.api('/2/backends')]);
    const state = this.state();
    const total = summary?.hashrate?.total || [];
    return {
      processRunning: state.processRunning,
      desired: state.desired || 'stopped',
      pid: state.pid || null,
      profile: state.profile || null,
      hashrate10s: Number(total[0] || 0),
      hashrate60s: Number(total[1] || 0),
      hashrate15m: Number(total[2] || 0),
      accepted: Number(summary?.connection?.accepted || 0),
      rejected: Number(summary?.connection?.rejected || 0),
      shareDifficulty: Number(summary?.connection?.diff || 0),
      algo: summary?.connection?.algo || null,
      pool: summary?.connection?.pool || null,
      uptime: Number(summary?.uptime || 0),
      hugePages: summary?.hugepages || null,
      backends: backends || null,
      apiConnected: Boolean(summary),
      version: this.meta().version || null,
      verifiedBinary: Boolean(this.meta().verified)
    };
  }

  canAutoRecover() {
    const s = this.state();
    const now = Date.now();
    const recent = (s.restartTimes || []).filter(ts => now - ts < 15 * 60_000);
    return { allowed: recent.length < 3, recent };
  }

  recordAutoRestart() {
    const s = this.state();
    const now = Date.now();
    s.restartTimes = (s.restartTimes || []).filter(ts => now - ts < 15 * 60_000);
    s.restartTimes.push(now);
    this.writeJson(this.stateFile, s);
    return s.restartTimes.length;
  }
}

module.exports = { XMRigController, STOCK, processAlive };
