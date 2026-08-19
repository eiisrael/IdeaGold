'use strict';

class PowerProvider {
  constructor(settings = {}) { this.settings = settings; }
  update(settings) { this.settings = settings; }
  sample({ mining, hardwareSample, profile }) {
    const manual = Number(this.settings.measuredPowerWatts || 0);
    if (manual > 0) return { watts: manual, source: 'manual-wattmeter', kind: 'measured', label: 'W reais na tomada • informado pelo usuário', accuracy: 'wall-measured' };

    const custom = Number(hardwareSample?.sensorPowerW);
    if (custom > 0) return { watts: custom, source: 'custom-local-sensor', kind: 'measured', label: 'W reais • sensor local configurado', accuracy: 'sensor-reported' };

    if (!mining) return { watts: 0, source: 'estimated-profile', kind: 'estimated', label: 'W estimados • minerador parado', accuracy: 'estimated' };

    const component = Number(hardwareSample?.componentPowerW || 0);
    const base = Math.max(0, Number(this.settings.basePowerWatts ?? 30));
    if (component > 0) return { watts: component + base, componentWatts: component, baseEstimateWatts: base, source: 'librehardwaremonitor-components+base', kind: 'hybrid', label: 'W híbridos • sensores de componentes + base estimada', accuracy: 'hybrid-not-wall' };

    const cpuMax = Number(this.settings.cpuPowerWatts ?? 75);
    const threadsPct = Math.max(0.25, Math.min(1, Number(profile?.threads || 1) / Math.max(1, Number(this.settings.logicalThreads || 4))));
    const cpu = cpuMax * (0.55 + 0.45 * threadsPct);
    const gpuExtra = profile?.gpuMode === 'on' ? 55 : 0;
    return { watts: Math.max(0, base + cpu + gpuExtra), source: 'estimated-profile', kind: 'estimated', label: 'W estimados • perfil de hardware', accuracy: 'estimated' };
  }
}

module.exports = { PowerProvider };
