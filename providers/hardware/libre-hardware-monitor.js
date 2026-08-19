'use strict';

const { spawnSync } = require('child_process');

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function normalizeType(v) { return String(v || '').toLowerCase(); }
function normalizeName(v) { return String(v || '').toLowerCase(); }

function chooseSensors(rows = []) {
  const sensors = rows.map(r => ({
    hardware: String(r.Hardware || r.hardware || r.Parent || ''),
    name: String(r.Name || r.name || ''),
    type: String(r.SensorType || r.sensorType || r.Type || ''),
    value: num(r.Value ?? r.value)
  })).filter(r => r.value != null);
  const find = (type, patterns) => sensors.find(s => normalizeType(s.type).includes(type) && patterns.some(p => normalizeName(`${s.hardware} ${s.name}`).includes(p)));
  const cpuTemp = find('temperature', ['cpu package', 'cpu tctl', 'cpu die', 'core max']);
  const gpuTemp = find('temperature', ['gpu core', 'gpu temperature', 'radeon']);
  const cpuPower = find('power', ['cpu package', 'package']);
  const gpuPower = find('power', ['gpu package', 'gpu board', 'gpu power', 'radeon']);
  const cpuClock = find('clock', ['cpu core #1', 'cpu core 1', 'core #1']);
  return {
    available: sensors.length > 0,
    source: 'LibreHardwareMonitor',
    cpuPackageC: cpuTemp?.value ?? null,
    gpuC: gpuTemp?.value ?? null,
    cpuPowerW: cpuPower?.value ?? null,
    gpuPowerW: gpuPower?.value ?? null,
    componentPowerW: [cpuPower?.value, gpuPower?.value].filter(Number.isFinite).reduce((a, b) => a + b, 0) || null,
    cpuClockMHz: cpuClock?.value ?? null,
    sensorCount: sensors.length
  };
}

function flattenRest(node, hardware = '', out = []) {
  if (!node || typeof node !== 'object') return out;
  const nextHardware = String(node.Text || node.text || node.Name || hardware || '');
  const type = node.Type || node.type || node.SensorType || node.sensorType;
  const value = node.Value ?? node.value;
  if (type && value !== undefined) {
    const parsed = typeof value === 'string' ? Number(String(value).replace(/[^0-9+-.]/g, '')) : Number(value);
    if (Number.isFinite(parsed)) out.push({ Hardware: hardware, Name: nextHardware, SensorType: type, Value: parsed });
  }
  const children = node.Children || node.children || node.SubHardware || [];
  if (Array.isArray(children)) for (const child of children) flattenRest(child, nextHardware || hardware, out);
  return out;
}

class LibreHardwareMonitorProvider {
  constructor(logger = null) { this.logger = logger; this.last = null; this.lastAt = 0; }

  powershell(script, timeout = 4500) {
    if (process.platform !== 'win32') return null;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout });
    if (r.status !== 0 || !String(r.stdout || '').trim()) return null;
    try { return JSON.parse(r.stdout); } catch { return null; }
  }

  probeWmi() {
    const data = this.powershell(`$ErrorActionPreference='SilentlyContinue'; $s=Get-CimInstance -Namespace root\\LibreHardwareMonitor -Class Sensor | Select-Object Name,SensorType,Value,Identifier,Parent; if($s){@($s)|ConvertTo-Json -Depth 4 -Compress}`);
    if (!data) return { available: false, reason: 'WMI root\\LibreHardwareMonitor indisponível' };
    const rows = Array.isArray(data) ? data : [data];
    return { ...chooseSensors(rows), transport: 'WMI' };
  }

  async probeRest() {
    try {
      const r = await fetch('http://127.0.0.1:8085/data.json', { signal: AbortSignal.timeout(1800) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      return { ...chooseSensors(flattenRest(data)), transport: 'REST 127.0.0.1:8085' };
    } catch (error) { return { available: false, reason: error.message, transport: 'REST' }; }
  }

  async sample(force = false) {
    if (!force && this.last && Date.now() - this.lastAt < 4000) return this.last;
    let value = this.probeWmi();
    if (!value.available) value = await this.probeRest();
    this.last = { ...value, ts: Date.now() }; this.lastAt = Date.now();
    return this.last;
  }

  installWinget() {
    if (process.platform !== 'win32') return { ok: false, reason: 'Instalação automática disponível somente no Windows.' };
    const probe = spawnSync('winget.exe', ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (probe.status !== 0) return { ok: false, reason: 'winget não está disponível neste Windows.' };
    const args = ['install', '--id', 'LibreHardwareMonitor.LibreHardwareMonitor', '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements'];
    const r = spawnSync('winget.exe', args, { encoding: 'utf8', windowsHide: false, timeout: 180000 });
    const ok = r.status === 0;
    this.logger?.[ok ? 'info' : 'error']('sensors', 'lhm-install', ok ? 'LibreHardwareMonitor instalado/atualizado via winget.' : 'Falha ao instalar LibreHardwareMonitor via winget.', { status: r.status, stdout: String(r.stdout || '').slice(-4000), stderr: String(r.stderr || '').slice(-4000) });
    return { ok, status: r.status, output: `${r.stdout || ''}\n${r.stderr || ''}`.slice(-8000) };
  }
}

module.exports = { LibreHardwareMonitorProvider, chooseSensors, flattenRest };
