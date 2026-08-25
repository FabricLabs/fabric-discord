'use strict';

const assert = require('assert');
const Discord = require('../services/discord');

describe('Discord', function () {
  this.timeout(10000);
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
        intents: [GatewayIntentBits.Guilds],
        alerts: ['only-this']
      });
      assert.deepStrictEqual(discord.settings.intents, [GatewayIntentBits.Guilds]);
      assert.deepStrictEqual(discord.settings.alerts, ['only-this']);
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

    it('maps discord.js ChannelType numbers to the legacy activity strings', function () {
      const { ChannelType } = require('discord.js');
      const map = Discord.legacyActivityChannelType;
      assert.strictEqual(map(ChannelType.DM), 'dm');
      assert.strictEqual(map(ChannelType.GroupDM), 'dm');
      assert.strictEqual(map(ChannelType.GuildText), 'text');
      assert.strictEqual(map(ChannelType.GuildAnnouncement), 'news');
      assert.strictEqual(map(ChannelType.GuildVoice), 'voice');
      assert.strictEqual(map(ChannelType.GuildCategory), 'category');
      assert.strictEqual(map(ChannelType.GuildForum), 'forum');
      assert.strictEqual(map(99), 99);
    });

    it('commits voice session transitions immediately and defers flag toggles', async function () {
      const discord = new Discord();
      let commits = 0;
      discord.commit = async function () { commits += 1; };
      const guild = { id: 'g1', channels: { cache: { get: () => ({ name: 'A' }) } } };
      const none = { id: 'u1', channelId: null, guild };
      const inChannel = {
        id: 'u1',
        channelId: 'c1',
        guild,
        channel: { name: 'A' },
        selfMute: false,
        selfDeaf: false
      };
      await discord._handleVoiceStateUpdate(none, inChannel);
      assert.strictEqual(commits, 1);
      await discord._handleVoiceStateUpdate(inChannel, { ...inChannel, selfMute: true });
      assert.strictEqual(commits, 1);
      assert.ok(discord._voiceCommitTimer);
      await discord._flushVoiceCommit();
      assert.strictEqual(commits, 2);
      assert.strictEqual(discord._voiceCommitTimer, null);
      if (discord.client && typeof discord.client.destroy === 'function') {
        await discord.client.destroy();
      }
    });

    it('OAuth authorize URL carries CSRF state; callback still does not exchange code', async function () {
      const discord = new Discord({ app: { id: '123' }, authority: 'localhost:3040' });
      const authorize = new URL(discord.generateAuthorizeLink());
      const state = authorize.searchParams.get('state');
      assert.ok(/^[0-9a-f]{64}$/.test(state), '64-hex CSRF state');
      assert.strictEqual(authorize.searchParams.get('response_type'), 'code');
      function mockRes () {
        let status = 200;
        let body = null;
        return {
          status (code) { status = code; return this; },
          json (obj) { body = obj; return this; },
          send (msg) { body = msg; return this; },
          get statusCode () { return status; },
          get body () { return body; }
        };
      }
      const stolen = mockRes();
      await discord._handleOAuthCallback({ query: { code: 'stolen', state: '' } }, stolen);
      assert.strictEqual(stolen.statusCode, 400, 'stolen code without state is rejected');
      const unknown = mockRes();
      await discord._handleOAuthCallback({ query: { code: 'stolen', state: 'ab'.repeat(32) } }, unknown);
      assert.strictEqual(unknown.statusCode, 400, 'unknown state is rejected');
      const okState = mockRes();
      await discord._handleOAuthCallback({ query: { code: 'stolen', state } }, okState);
      assert.strictEqual(okState.statusCode, 501, 'do not exchange codes yet');
      assert.strictEqual(okState.body && okState.body.status, 'error');
      const replay = mockRes();
      await discord._handleOAuthCallback({ query: { code: 'stolen', state } }, replay);
      assert.strictEqual(replay.statusCode, 400, 'state is one-time');
      if (discord.client && typeof discord.client.destroy === 'function') {
        await discord.client.destroy();
      }
    });

    it('this core pin loads IdentityCrossSign (fabric #185)', function () {
      const crypto = require('crypto');
      const Key = require('@fabric/core/types/key');
      const Identity = require('@fabric/core/types/identity');
      const { SIGN_TYPE, buildCrossSignMessage } = require('@fabric/core/functions/identityCrossSign');
      const { signCrossSign } = require('@fabric/core/functions/identityCrossSignVerify');
      const { fabricIdentityIdFromPubkeyHex } = require('@fabric/core/functions/fabricIdentitySchnorr');
      assert.strictEqual(SIGN_TYPE, 'IdentityCrossSign');
      assert.strictEqual(typeof buildCrossSignMessage, 'function');
      const nonce = 'ab'.repeat(32);
      const local = '11'.repeat(32);
      const peer = '22'.repeat(32);
      assert.ok(buildCrossSignMessage(nonce, local, peer));
      assert.strictEqual(buildCrossSignMessage(nonce, 'aa:bb', peer), null);
      const ident = new Identity(new Key());
      const other = new Identity(new Key());
      assert.throws(
        () => signCrossSign(ident, { peerPubkey: other.pubkey, nonce: crypto.randomBytes(32).toString('hex') }, 'ChatMessage'),
        /unknown cross-sign type/i
      );
      assert.throws(() => fabricIdentityIdFromPubkeyHex('02aa'), /66 hex/i);
    });

    it('emits DiscordMessage activity with legacy target.type strings', async function () {
      const { ChannelType } = require('discord.js');
      const discord = new Discord({ autoCommands: false });
      const seen = [];
      const debugLines = [];
      discord.on('activity', (activity) => seen.push(activity));
      discord.on('debug', (line) => debugLines.push(String(line)));
      await discord._handleClientMessage({
        author: { bot: false, id: 'u1', username: 'pilot' },
        channel: { id: 'c-dm', type: ChannelType.DM, name: undefined },
        id: 'm1',
        content: 'secret-dm-body',
        createdTimestamp: 1
      });
      await discord._handleClientMessage({
        author: { bot: false, id: 'u1', username: 'pilot' },
        channel: { id: 'c-text', type: ChannelType.GuildText, name: 'general' },
        id: 'm2',
        content: 'secret-guild-body',
        createdTimestamp: 2
      });
      assert.strictEqual(seen[0].target.type, 'dm');
      assert.strictEqual(seen[1].target.type, 'text');
      assert.strictEqual(seen[0].object.created, 1);
      assert.strictEqual(seen[1].object.created, 2);
      const joined = debugLines.join('\n');
      assert.ok(!joined.includes('secret-dm-body'));
      assert.ok(!joined.includes('secret-guild-body'));
      assert.ok(!joined.includes('pilot'));
      if (discord.client && typeof discord.client.destroy === 'function') {
        await discord.client.destroy();
      }
    });

    it('never stamps non-positive activity created (Number(null)===0)', async function () {
      const { ChannelType } = require('discord.js');
      const discord = new Discord({ autoCommands: false });
      const seen = [];
      discord.on('activity', (activity) => seen.push(activity));
      const before = Date.now();
      await discord._handleClientMessage({
        author: { bot: false, id: 'u1', username: 'pilot' },
        channel: { id: 'c1', type: ChannelType.GuildText, name: 'general' },
        id: 'm0',
        content: 'hi',
        createdTimestamp: null
      });
      const after = Date.now();
      assert.ok(seen[0].object.created >= before && seen[0].object.created <= after);
      assert.strictEqual(Discord.positiveCreatedMs(0), Discord.positiveCreatedMs(0));
      assert.ok(Discord.positiveCreatedMs(0) > 0);
      assert.strictEqual(Discord.positiveCreatedMs(42), 42);
      if (discord.client && typeof discord.client.destroy === 'function') {
        await discord.client.destroy();
      }
    });

    it('trims blank channel / app credentials like tokens', async function () {
      const discord = new Discord({
        channel: '  ',
        app: { id: '  ', secret: '\t' }
      });
      assert.strictEqual(discord.settings.channel, null);
      assert.strictEqual(discord.settings.app.id, null);
      assert.strictEqual(discord.settings.app.secret, null);
      if (discord.client && typeof discord.client.destroy === 'function') {
        await discord.client.destroy();
      }
    });

    it('!sync awaits sync and replies instead of returning a bare Promise', async function () {
      const { ChannelType } = require('discord.js');
      const discord = new Discord({ autoCommands: true });
      let synced = 0;
      const replies = [];
      discord.sync = async function () { synced += 1; return this; };
      await discord._handleClientMessage({
        author: { bot: false, id: 'u1', username: 'pilot' },
        channel: {
          id: 'c1',
          type: ChannelType.GuildText,
          name: 'general',
          send: async (msg) => { replies.push(msg); return msg; }
        },
        id: 'm-sync',
        content: '!sync',
        createdTimestamp: 99
      });
      assert.strictEqual(synced, 1);
      assert.strictEqual(replies[0], 'Synced.');
      if (discord.client && typeof discord.client.destroy === 'function') {
        await discord.client.destroy();
      }
    });
  });
});
