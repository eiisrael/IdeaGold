'use strict';

const dns = require('dns').promises;
const tls = require('tls');

const MONEROOCEAN_FALLBACKS = ['sg.moneroocean.stream'];

function candidateHosts(pool = {}) {
  const first = String(pool.host || '').trim();
  if (!first) return [];
  const extra = Array.isArray(pool.fallbackHosts) ? pool.fallbackHosts : [];
  const defaults = first === 'gulf.moneroocean.stream' ? MONEROOCEAN_FALLBACKS : [];
  return [...new Set([first, ...extra, ...defaults].map(String).map(x => x.trim()).filter(Boolean))];
}

async function resolveDns(host) {
  const errors = [];
  try {
    const v4 = await dns.resolve4(host);
    if (v4?.length) return { ok: true, family: 4, addresses: v4 };
  } catch (error) {
    errors.push(error.message);
  }
  try {
    const v6 = await dns.resolve6(host);
    if (v6?.length) return { ok: true, family: 6, addresses: v6 };
  } catch (error) {
    errors.push(error.message);
  }
  return { ok: false, error: errors.filter(Boolean).join(' | ') || 'DNS sem resposta' };
}

function tlsProbe(host, port, timeoutMs = 3500) {
  return new Promise(resolve => {
    let settled = false;
    const done = result => {
      if (settled) return;
      settled = true;
      try { socket?.destroy(); } catch {}
      resolve(result);
    };
    let socket;
    try {
      socket = tls.connect({
        host,
        port: Number(port),
        servername: host,
        rejectUnauthorized: true
      });
      socket.setTimeout(timeoutMs);
      socket.once('secureConnect', () => done({ ok: true }));
      socket.once('timeout', () => done({ ok: false, error: 'timeout TLS' }));
      socket.once('error', error => done({ ok: false, error: error.message }));
    } catch (error) {
      done({ ok: false, error: error.message });
    }
  });
}

async function probeHost(host, port, tlsEnabled = true) {
  const dnsResult = await resolveDns(host);
  if (!dnsResult.ok) return { ok: false, stage: 'dns', host, ...dnsResult };
  if (!tlsEnabled) return { ok: true, stage: 'dns', host, dns: dnsResult };
  const tlsResult = await tlsProbe(host, port);
  return tlsResult.ok
    ? { ok: true, stage: 'tls', host, dns: dnsResult }
    : { ok: false, stage: 'tls', host, dns: dnsResult, error: tlsResult.error };
}

async function resolvePoolEndpoint(pool, { probe = probeHost, logger = null } = {}) {
  if (!pool?.host || !pool?.port) throw new Error('Pool sem endpoint válido.');

  const host = String(pool.host);
  if (['127.0.0.1', 'localhost', '::1'].includes(host)) return { ...pool };

  const candidates = candidateHosts(pool);
  const failures = [];

  for (const candidate of candidates) {
    const result = await probe(candidate, pool.port, pool.tls !== false);
    if (result.ok) {
      if (candidate !== host) {
        logger?.warn?.(
          'pool',
          'endpoint-fallback',
          `Endpoint principal ${host} indisponível; usando fallback oficial ${candidate}.`,
          { primary: host, selected: candidate, failures }
        );
      } else {
        logger?.info?.('pool', 'endpoint-ok', `Pool ${candidate}:${pool.port} validado antes do start.`, { stage: result.stage });
      }
      return { ...pool, host: candidate, selectedFrom: candidates, preflight: result };
    }
    failures.push({ host: candidate, stage: result.stage, error: result.error || 'falha desconhecida' });
  }

  const details = failures.map(x => `${x.host} (${x.stage}: ${x.error})`).join('; ');
  const error = new Error(
    `Não foi possível conectar ao pool antes de iniciar. ${details}. ` +
    'Verifique DNS/internet/firewall. O IdeaGold não vai mostrar "minerando" enquanto o pool não estiver acessível.'
  );
  error.code = 'POOL_PREFLIGHT_FAILED';
  error.failures = failures;
  throw error;
}

module.exports = {
  MONEROOCEAN_FALLBACKS,
  candidateHosts,
  resolveDns,
  tlsProbe,
  probeHost,
  resolvePoolEndpoint
};
