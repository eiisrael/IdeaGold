'use strict';

const base = require('./xmrig-controller-v51');
const { resolvePoolEndpoint } = require('./pool-preflight');

class XMRigController extends base.XMRigController {
  async start(context = {}) {
    const pool = await resolvePoolEndpoint(context.pool, { logger: this.logger });
    return super.start({ ...context, pool });
  }
}

module.exports = {
  ...base,
  XMRigController
};
