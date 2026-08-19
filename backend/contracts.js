'use strict';

function telemetrySsePayload(sample) {
  if (!sample || typeof sample !== 'object') return null;
  return sample;
}

function isTelemetrySsePayload(payload) {
  return Boolean(payload && typeof payload === 'object' && !Object.prototype.hasOwnProperty.call(payload, 'telemetry') && Object.prototype.hasOwnProperty.call(payload, 'ts') && Object.prototype.hasOwnProperty.call(payload, 'state'));
}

module.exports = { telemetrySsePayload, isTelemetrySsePayload };
