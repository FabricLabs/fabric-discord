'use strict';

const assert = require('assert');
const { PassThrough } = require('stream');
const Discord = require('../services/discord');
const {
  SAMPLE_RATE,
  CHANNELS,
  joinVoiceReceive,
  subscribeVoiceReceive,
  leaveVoiceReceive
} = require('../functions/voiceReceive');

describe('voiceReceive', function () {
  it('exports 48 kHz stereo', function () {
    assert.strictEqual(SAMPLE_RATE, 48000);
    assert.strictEqual(CHANNELS, 2);
    assert.strictEqual(Discord.voiceReceive.joinVoiceReceive, joinVoiceReceive);
  });

  it('joins receive-only (muted, not deaf) and waits until ready', async function () {
    const connection = { id: 'conn' };
    const adapter = () => {};
    const calls = [];
    const voice = {
      VoiceConnectionStatus: { Ready: 'ready' },
      joinVoiceChannel (opts) {
        calls.push(opts);
        return connection;
      },
      async entersState (conn, status, timeout) {
        assert.strictEqual(conn, connection);
        assert.strictEqual(status, 'ready');
        assert.strictEqual(timeout, 20000);
      }
    };
    const out = await joinVoiceReceive({
      channelId: 'c1',
      guildId: 'g1',
      adapterCreator: adapter
    }, { voice });
    assert.strictEqual(out, connection);
    assert.deepStrictEqual(calls[0], {
      channelId: 'c1',
      guildId: 'g1',
      adapterCreator: adapter,
      selfDeaf: false,
      selfMute: true
    });
  });

  it('refuses a join without a channel or adapter', async function () {
    await assert.rejects(() => joinVoiceReceive({}), /Need a voice channel/);
    await assert.rejects(
      () => joinVoiceReceive({ channelId: 'c1', guildId: 'g1' }),
      /Need a voice adapter/
    );
  });

  it('subscribes a speaker to s16le PCM', function () {
    const opus = new PassThrough();
    class Decoder extends PassThrough {
      constructor (opts) {
        super();
        this.opts = opts;
      }
    }
    const connection = {
      receiver: {
        subscribe (id, opts) {
          this.id = id;
          this.opts = opts;
          return opus;
        }
      }
    };
    const voice = { EndBehaviorType: { AfterSilence: 'silence' } };
    const prism = { opus: { Decoder } };
    const stream = subscribeVoiceReceive(connection, 'u1', { voice, prism });
    assert.ok(stream instanceof Decoder);
    assert.deepStrictEqual(stream.opts, { frameSize: 960, channels: 2, rate: 48000 });
    assert.strictEqual(connection.receiver.id, 'u1');
    assert.deepStrictEqual(connection.receiver.opts, {
      end: { behavior: 'silence', duration: 200 }
    });
  });

  it('leaves by destroying the connection, and is safe when missing', function () {
    const connection = { destroy () { this.gone = true; } };
    leaveVoiceReceive(connection);
    assert.strictEqual(connection.gone, true);
    leaveVoiceReceive(null);
  });

  it('Discord#joinVoiceReceive fills the adapter from the guild cache', async function () {
    const discord = new Discord();
    const adapter = () => {};
    discord.client.guilds.cache.get = (id) => (id === 'g1' ? { voiceAdapterCreator: adapter } : null);
    const orig = Discord.voiceReceive;
    let seen;
    Discord.voiceReceive = {
      joinVoiceReceive: async (input) => {
        seen = input;
        return { ok: true };
      }
    };
    try {
      const out = await discord.joinVoiceReceive({ guildId: 'g1', channelId: 'c1' });
      assert.deepStrictEqual(out, { ok: true });
      assert.strictEqual(seen.adapterCreator, adapter);
      assert.strictEqual(seen.guildId, 'g1');
      assert.strictEqual(seen.channelId, 'c1');
    } finally {
      Discord.voiceReceive = orig;
      await discord.client.destroy();
    }
  });

  it('Discord subscribe and leave delegate to voiceReceive', async function () {
    const discord = new Discord();
    const orig = Discord.voiceReceive;
    const connection = { id: 'conn' };
    Discord.voiceReceive = {
      subscribeVoiceReceive (conn, userId) {
        return { conn, userId };
      },
      leaveVoiceReceive (conn) {
        conn.gone = true;
      }
    };
    try {
      assert.deepStrictEqual(discord.subscribeVoiceReceive(connection, 'u1'), {
        conn: connection,
        userId: 'u1'
      });
      discord.leaveVoiceReceive(connection);
      assert.strictEqual(connection.gone, true);
    } finally {
      Discord.voiceReceive = orig;
      await discord.client.destroy();
    }
  });
});
