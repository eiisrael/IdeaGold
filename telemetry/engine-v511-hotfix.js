'use strict';

const base = require('./engine-v51');

/**
 * V5.1.1 regression fix.
 *
 * engine-v51 used the property name `stale` for two different meanings:
 *   1) MoneroOcean stale-share count (number/null), and
 *   2) source-cache staleness (boolean).
 *
 * SQLite INTEGER bindings reject JS booleans in Node's built-in sqlite API,
 * so a cached/failed pool refresh could send `true/false` into the
 * `pool_snapshots.stale` column and abort the whole Telemetry Engine.
 *
 * Keep `stale` exclusively for the pool stale-share metric and expose cache
 * freshness as `sourceStale`. Existing UI fields already use `cached` and
 * `staleSec` for source age, so this change is backward compatible.
 */
class TelemetryEngine extends base.TelemetryEngine {
  async refreshOne(name, intervalMs, maxStaleMs, fn) {
    const slot = this.sources[name];
    const now = Date.now();

    if (now - slot.lastAttemptAt >= intervalMs) {
      slot.lastAttemptAt = now;
      try {
        const value = await fn();
        if (!value?.available) throw new Error(value?.reason || `${name} retornou unavailable`);

        const wasFail = Boolean(slot.lastError);
        slot.value = value;
        slot.lastGoodAt = Date.now();
        slot.lastError = null;
        slot.failures = 0;

        if (wasFail) {
          this.logger?.info(
            'telemetry',
            `${name}-recovered`,
            `${name} voltou a responder.`,
            { source: value.source || value.adapter || null }
          );
        }
      } catch (error) {
        slot.lastError = error.message;
        slot.failures++;
        this.logger?.throttle(`source-${name}`, 30000, () =>
          this.logger?.warn(
            'telemetry',
            `${name}-failure`,
            `Falha temporária na fonte ${name}; último valor válido será preservado dentro da janela segura.`,
            {
              error: error.message,
              failures: slot.failures,
              lastGoodAgeSec: slot.lastGoodAt
                ? Math.round((Date.now() - slot.lastGoodAt) / 1000)
                : null
            }
          )
        );
      }
    }

    if (slot.value && now - slot.lastGoodAt <= maxStaleMs) {
      const age = now - slot.lastGoodAt;
      const sourceStale = Boolean(slot.lastError) || age > maxStaleMs * 0.5;
      return {
        ...slot.value,
        available: true,
        cached: age > intervalMs * 1.5 || Boolean(slot.lastError),
        sourceStale,
        staleSec: Math.round(age / 1000),
        sourceError: slot.lastError,
        _lastGoodAt: slot.lastGoodAt,
        _freshFetch:
          !slot.lastError && slot.lastGoodAt === slot.lastAttemptAt
            ? true
            : !slot.lastError && age < Math.min(intervalMs, 8000)
      };
    }

    return {
      available: false,
      cached: false,
      sourceStale: true,
      staleSec: slot.lastGoodAt ? Math.round((now - slot.lastGoodAt) / 1000) : null,
      reason: slot.lastError || 'ainda sem valor válido',
      _lastGoodAt: slot.lastGoodAt || 0
    };
  }
}

module.exports = {
  ...base,
  TelemetryEngine
};
