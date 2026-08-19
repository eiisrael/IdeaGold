'use strict';

const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { LibreHardwareMonitorProvider } = require('./libre-hardware-monitor');

function clamp(n, a, b) { return Math.max(a, Math.min(b, Number(n) || 0)); }

class SystemHardwareProvider {
  constructor(logger = null) {
    this.logger = logger;
    this.prevCpu = this.cpuTimes();
    this.staticCache = null;
    this.lhm = new LibreHardwareMonitorProvider(logger);
    this.lastSource = null;
  }
  cpuTimes() {
    const cpus = os.cpus() || [];
    let idle = 0, total = 0;
    for (const c of cpus) {
      const t = c.times || {}; idle += t.idle || 0; total += Object.values(t).reduce((a, b) => a + Number(b || 0), 0);
    }
    return { idle, total };
  }
  cpuLoad() {
    const now = this.cpuTimes(), di = now.idle - this.prevCpu.idle, dt = now.total - this.prevCpu.total;
    this.prevCpu = now; return dt > 0 ? clamp(100 * (1 - di / dt), 0, 100) : null;
  }
  powershellJson(script, timeout = 5000) {
    if (process.platform !== 'win32') return null;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout });
    if (r.status !== 0 || !String(r.stdout || '').trim()) return null;
    try { return JSON.parse(r.stdout); } catch { return null; }
  }
  staticInfo() {
    if (this.staticCache) return this.staticCache;
    const cpus = os.cpus() || [];
    const base = { platform: process.platform, arch: process.arch, os: `${os.type()} ${os.release()}`, cpuModel: cpus[0]?.model || 'desconhecida', logicalThreads: cpus.length, memoryGB: Number((os.totalmem() / 1073741824).toFixed(2)), cacheL3KB: null, cores: null, gpu: [], source: 'Node.js os' };
    if (process.platform === 'win32') {
      const data = this.powershellJson(`$c=Get-CimInstance Win32_Processor | Select-Object -First 1 Name,NumberOfCores,NumberOfLogicalProcessors,L3CacheSize,Architecture; $g=Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,PNPDeviceID; [pscustomobject]@{cpu=$c;gpu=@($g)} | ConvertTo-Json -Depth 4 -Compress`);
      if (data?.cpu) {
        base.cpuModel = data.cpu.Name || base.cpuModel; base.cores = Number(data.cpu.NumberOfCores || 0) || null; base.logicalThreads = Number(data.cpu.NumberOfLogicalProcessors || base.logicalThreads); base.cacheL3KB = Number(data.cpu.L3CacheSize || 0) || null;
        base.gpu = (data.gpu || []).map(g => ({ name: g.Name, vramGB: Number(g.AdapterRAM || 0) / 1073741824 || null, driver: g.DriverVersion || null, pnpDeviceId: g.PNPDeviceID || null })); base.source = 'Win32 CIM + Node.js os';
      }
    }
    base.fingerprint = crypto.createHash('sha256').update(JSON.stringify({ cpu: base.cpuModel, cores: base.cores, threads: base.logicalThreads, l3: base.cacheL3KB, ram: Math.round(base.memoryGB), gpu: base.gpu.map(g => g.name), os: base.os, arch: base.arch })).digest('hex').slice(0, 24);
    this.staticCache = base; return base;
  }
  acpiThermal() {
    if (process.platform !== 'win32') return { available: false, valueC: null, source: null };
    const data = this.powershellJson(`$x=Get-CimInstance -Namespace root/wmi -Class MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -First 1 CurrentTemperature; if($x){[pscustomobject]@{c=([double]$x.CurrentTemperature/10-273.15)}|ConvertTo-Json -Compress}`, 3000);
    const c = Number(data?.c); if (!(c > -50 && c < 150)) return { available: false, valueC: null, source: null };
    return { available: true, valueC: c, source: 'Windows ACPI thermal zone', caveat: 'Zona ACPI; não é CPU Package.' };
  }
  async externalSensors() {
    const url = process.env.IDEAGOLD_SENSOR_URL;
    if (!url) return { available: false, source: null };
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url)) return { available: false, source: null, reason: 'IDEAGOLD_SENSOR_URL deve apontar para localhost.' };
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1800) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); const d = await r.json();
      return { available: true, source: 'sensor local configurado pelo usuário', cpuPackageC: Number.isFinite(Number(d.cpuPackageC)) ? Number(d.cpuPackageC) : null, gpuC: Number.isFinite(Number(d.gpuC)) ? Number(d.gpuC) : null, powerW: Number.isFinite(Number(d.powerW)) ? Number(d.powerW) : null, cpuClockMHz: Number.isFinite(Number(d.cpuClockMHz)) ? Number(d.cpuClockMHz) : null };
    } catch (error) { return { available: false, source: 'sensor local configurado pelo usuário', reason: error.message }; }
  }
  async sample() {
    const ext = await this.externalSensors();
    const lhm = ext.available ? { available: false } : await this.lhm.sample();
    const acpi = ext.cpuPackageC != null || lhm.cpuPackageC != null ? null : this.acpiThermal();
    const total = os.totalmem(), free = os.freemem();
    const source = ext.available ? ext.source : lhm.available ? `LibreHardwareMonitor ${lhm.transport || ''}`.trim() : acpi?.source || null;
    if (source !== this.lastSource) { this.logger?.info('hardware', 'sensor-source', `Fonte de sensores alterada para ${source || 'indisponível'}.`, { external: ext.available, lhm: lhm.available, acpi: acpi?.available }); this.lastSource = source; }
    return {
      ts: Date.now(), cpuLoadPct: this.cpuLoad(), memoryUsedPct: total ? 100 * (1 - free / total) : null,
      temperatureC: ext.cpuPackageC ?? lhm.cpuPackageC ?? acpi?.valueC ?? null,
      temperatureSource: ext.cpuPackageC != null ? ext.source : lhm.cpuPackageC != null ? `LibreHardwareMonitor ${lhm.transport || ''}`.trim() : acpi?.source || null,
      temperatureCaveat: ext.cpuPackageC != null || lhm.cpuPackageC != null ? null : acpi?.caveat || null,
      gpuTemperatureC: ext.gpuC ?? lhm.gpuC ?? null,
      sensorPowerW: ext.powerW ?? null,
      componentPowerW: lhm.componentPowerW ?? null,
      cpuPowerW: lhm.cpuPowerW ?? null, gpuPowerW: lhm.gpuPowerW ?? null,
      cpuClockMHz: ext.cpuClockMHz ?? lhm.cpuClockMHz ?? null,
      sensorsAvailable: ext.available || Boolean(lhm.available) || Boolean(acpi?.available), sensorProvider: source,
      lhm: { available: Boolean(lhm.available), transport: lhm.transport || null, sensorCount: lhm.sensorCount || 0 }
    };
  }
}

module.exports = { SystemHardwareProvider };
