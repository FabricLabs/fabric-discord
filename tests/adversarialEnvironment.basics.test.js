'use strict';

/**
 * Basics tied to SECURITY.md § Adversarial environment.
 */

const assert = require('assert');
const Discord = require('../services/discord');

describe('adversarialEnvironment.basics (@fabric/discord)', function () {
  this.timeout(10000);

  it('refuses to start without a Discord bot token', async function () {
    const service = new Discord({ token: null });
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
    await assert.rejects(() => service.start(), /token/i);
  });
});
