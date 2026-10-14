'use strict';

/**
 * Basics tied to SECURITY.md § Adversarial environment.
 */

const assert = require('assert');
const Discord = require('../services/discord');

describe('adversarialEnvironment.basics (@fabric/discord)', function () {
  this.timeout(10000);

  const created = [];
  afterEach(async function () {
    for (const service of created) {
      try {
        if (service && typeof service.stop === 'function') await service.stop();
        else if (service && service.client && typeof service.client.destroy === 'function') {
          await service.client.destroy();
        }
      } catch (_) { /* ignore */ }
    }
    created.length = 0;
  });

  it('refuses to start without a Discord bot token', async function () {
    const service = new Discord({ token: null });
    created.push(service);
    await assert.rejects(
      () => service.start(),
      (err) => {
        assert.match(String(err && err.message ? err.message : err), /token/i);
        return true;
      }
    );
  });

  it('does not treat an empty string token as configured', async function () {
    const service = new Discord({ token: '' });
    created.push(service);
    await assert.rejects(() => service.start(), /token/i);
  });

  it('does not treat a whitespace-only token as configured', async function () {
    const service = new Discord({ token: '   ' });
    created.push(service);
    await assert.rejects(() => service.start(), /token/i);
  });
});
