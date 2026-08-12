'use strict';

const assert = require('assert');
const Discord = require('../services/discord');

describe('Discord', function () {
  describe('@fabric/discord', function () {
    it('should be instantiable', async function () {
      assert.strictEqual(typeof Discord, 'function');
      const discord = new Discord();
      assert.ok(discord instanceof Discord);
      assert.ok(Array.isArray(discord.channels));
      assert.ok(discord.voice && discord.voice.aggregates);
      if (discord.client && typeof discord.client.destroy === 'function') {
        await discord.client.destroy();
      }
    });

    it('replaces caller-supplied intents instead of merging by index', async function () {
      const { GatewayIntentBits } = require('discord.js');
      const discord = new Discord({
        intents: [GatewayIntentBits.Guilds]
      });
      assert.deepStrictEqual(discord.settings.intents, [GatewayIntentBits.Guilds]);
      if (discord.client && typeof discord.client.destroy === 'function') {
        await discord.client.destroy();
      }
    });

    it('joins OAuth scopes with spaces', async function () {
      const discord = new Discord({ app: { id: '123' }, authority: 'localhost:3040' });
      const authorize = new URL(discord.generateAuthorizeLink());
      assert.strictEqual(authorize.searchParams.get('scope'), 'identify');
      const application = new URL(discord.generateApplicationLink());
      assert.ok(application.searchParams.get('scope').includes(' '));
      assert.ok(!application.searchParams.get('scope').includes(','));
      if (discord.client && typeof discord.client.destroy === 'function') {
        await discord.client.destroy();
      }
    });
  });
});
