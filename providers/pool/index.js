'use strict';

const { MoneroOceanAdapter } = require('./moneroocean');
const { P2PoolAdapter } = require('./p2pool');

class PoolRegistry {
  constructor(settings = {}) {
    this.settings = settings;
    this.adapters = new Map();
    this.register(new MoneroOceanAdapter());
    this.register(new P2PoolAdapter({
      host: settings.p2poolHost || '127.0.0.1',
      port: settings.p2poolPort || 3333,
      dataApi: settings.p2poolDataApi || '',
      sidechain: settings.p2poolSidechain || 'mini'
    }));
  }
  register(adapter) { this.adapters.set(adapter.id, adapter); }
  get(id = 'moneroocean') { return this.adapters.get(id) || this.adapters.get('moneroocean'); }
  list() {
    return [...this.adapters.values()].map(a => ({ id: a.id, name: a.name, host: a.host, port: a.port, tls: a.tls !== false }));
  }
}

module.exports = { PoolRegistry };
