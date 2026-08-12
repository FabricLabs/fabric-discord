'use strict';

const assert = require('assert');
const {
  normalizeDiscordSettings,
  discordRuntimeSummary
} = require('../functions/normalizeDiscordSettings');

describe('normalizeDiscordSettings', function () {
  it('builds app + channel from flat aliases', function () {
    const n = normalizeDiscordSettings({
      enable: true,
      token: 'tok',
      appId: '123',
      appSecret: 'sec',
      channelId: '456',
      announceActivities: true
    });
    assert.strictEqual(n.token, 'tok');
    assert.strictEqual(n.app.id, '123');
    assert.strictEqual(n.app.secret, 'sec');
    assert.strictEqual(n.channel, '456');
    assert.strictEqual(n.announceActivities, true);
  });

  it('runtime summary never echoes secrets', function () {
    const summary = discordRuntimeSummary({
      enable: true,
      token: 'super-secret',
      webhook: 'https://discord.com/api/webhooks/x/y',
      app: { id: '99', secret: 'nope' },
      channel: 'chan'
    }, { botReady: true, botUser: 'Bot#0001' });
    assert.strictEqual(summary.botConfigured, true);
    assert.strictEqual(summary.webhookConfigured, true);
    assert.strictEqual(summary.appId, '99');
    assert.strictEqual(summary.mode, 'bot');
    assert.strictEqual(summary.botReady, true);
    assert.ok(!JSON.stringify(summary).includes('super-secret'));
    assert.ok(!JSON.stringify(summary).includes('nope'));
    assert.ok(!JSON.stringify(summary).includes('webhooks/x'));
  });
});
