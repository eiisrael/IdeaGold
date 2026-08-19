'use strict';

class PowerProvider {
  constructor(settings = {}) { this.settings = settings; }
  update(settings) { this.settings = settings; }
  sample({ mining, hardwareSample, profile }) {
    const sensor = Number(hardwareSample?.sensorPowerW);
    if (sensor > 0) return { watts: sensor, source: 'sensor-local', kind: 'measured', label: 'W reais • sensor local' };

    const manual = Number(this.settings.measuredPowerWatts || 0);
    if (manual > 0) return { watts: manual, source: 'manual-wattmeter', kind: 'measured', label: 'W reais • informado pelo usuário' };

    if (!mining) return { watts: 0, source: 'estimated-profile', kind: 'estimated', label: 'W estimados • minerador parado' };
    const base = Number(this.settings.basePowerWatts ?? 30);
    const cpuMax = Number(this.settings.cpuPowerWatts ?? 75);
    const threadsPct = Math.max(0.25, Math.min(1, Number(profile?.threads || 1) / Math.max(1, Number(this.settings.logicalThreads || 4))));
    // Conservative linear approximation; explicitly marked estimated.
    const cpu = cpuMax * (0.55 + 0.45 * threadsPct);
    return { watts: Math.max(0, base + cpu), source: 'estimated-profile', kind: 'estimated', label: 'W estimados • perfil de hardware' };
  }
}

module.exports = { PowerProvider };
