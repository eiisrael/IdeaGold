'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WALLET_RE = /\b[48][1-9A-HJ-NP-Za-km-z]{94,105}\b/g;
const SECRET_KEYS = /secret|token|password|passphrase|seed|private.?key|spend.?key|view.?key/i;

function maskWallet(value) {
  const s = String(value || '');
  return s.length > 24 ? `${s.slice(0, 10)}…${s.slice(-10)}` : s;
}

function sanitize(value, depth = 0, seen = new WeakSet()) {
  if (depth > 8) return '[depth-limit]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.replace(WALLET_RE, m => maskWallet(m)).slice(0, 20000);
  if (value instanceof Error) return { name: value.name, message: sanitize(value.message, depth + 1, seen), stack: sanitize(value.stack, depth + 1, seen), code: value.code || null };
  if (Array.isArray(value)) return value.slice(0, 200).map(v => sanitize(v, depth + 1, seen));
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 200)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : sanitize(v, depth + 1, seen);
    seen.delete(value);
    return out;
  }
  return String(value);
}

class StructuredLogger {
  constructor(root, options = {}) {
    this.dir = path.join(root, 'runtime', 'logs');
    fs.mkdirSync(this.dir, { recursive: true });
    this.file = path.join(this.dir, 'ideagold.jsonl');
    this.maxBytes = Number(options.maxBytes || 5 * 1024 * 1024);
    this.backups = Number(options.backups || 4);
    this.ringSize = Number(options.ringSize || 800);
    this.ring = [];
    this.throttleMap = new Map();
    this.runId = crypto.randomUUID();
  }

  rotate() {
    try {
      if (!fs.existsSync(this.file) || fs.statSync(this.file).size < this.maxBytes) return;
      for (let i = this.backups - 1; i >= 1; i--) {
        const src = `${this.file}.${i}`;
        if (fs.existsSync(src)) fs.renameSync(src, `${this.file}.${i + 1}`);
      }
      fs.renameSync(this.file, `${this.file}.1`);
    } catch {}
  }

  write(level, component, event, message, data = null) {
    const row = sanitize({ ts: Date.now(), iso: new Date().toISOString(), runId: this.runId, level, component, event, message, data });
    this.ring.push(row);
    if (this.ring.length > this.ringSize) this.ring.splice(0, this.ring.length - this.ringSize);
    try { this.rotate(); fs.appendFileSync(this.file, JSON.stringify(row) + '\n'); } catch {}
    const text = `[${row.iso}] ${String(level).toUpperCase()} ${component}/${event}: ${message}`;
    if (level === 'error') console.error(text); else if (level === 'warn') console.warn(text); else console.log(text);
    return row;
  }

  debug(component, event, message, data) { return this.write('debug', component, event, message, data); }
  info(component, event, message, data) { return this.write('info', component, event, message, data); }
  warn(component, event, message, data) { return this.write('warn', component, event, message, data); }
  error(component, event, message, data) { return this.write('error', component, event, message, data); }

  throttle(key, ms, fn) {
    const now = Date.now(), last = this.throttleMap.get(key) || 0;
    if (now - last < ms) return false;
    this.throttleMap.set(key, now); fn(); return true;
  }

  recent(limit = 300, level = null) {
    let rows = this.ring;
    if (level) rows = rows.filter(x => x.level === level);
    return rows.slice(-Math.max(1, Math.min(2000, Number(limit || 300))));
  }

  tail(maxBytes = 250000) {
    try {
      const st = fs.statSync(this.file), len = Math.min(maxBytes, st.size), fd = fs.openSync(this.file, 'r'), buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd); return buf.toString('utf8');
    } catch { return ''; }
  }
}

module.exports = { StructuredLogger, sanitize, maskWallet };
