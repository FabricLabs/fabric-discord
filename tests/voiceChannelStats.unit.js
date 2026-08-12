'use strict';

const assert = require('assert');
const {
  applyVoiceStateUpdate,
  seedActiveVoiceMember,
  guildActiveMemberCount
} = require('../functions/voiceChannelStats');

function emptyVoice () {
  return {
    active: {},
    aggregates: { channels: {}, guilds: {} }
  };
}

describe('voiceChannelStats', function () {
  describe('applyVoiceStateUpdate', function () {
    it('records join and updates peak concurrent for channel and guild', function () {
      const voice = emptyVoice();
      const t0 = 1000;
      const oldSlice = { channelId: null, guildId: 'g1', userId: 'u1', flags: {} };
      const newSlice = {
        channelId: 'c1',
        guildId: 'g1',
        userId: 'u1',
        flags: { selfMute: false, selfDeaf: false }
      };
      applyVoiceStateUpdate(voice, oldSlice, newSlice, t0, 'General');
      assert.strictEqual(voice.active.c1.name, 'General');
      assert.strictEqual(Object.keys(voice.active.c1.members).length, 1);
      assert.strictEqual(voice.aggregates.channels.c1.joinCount, 1);
      assert.strictEqual(voice.aggregates.channels.c1.peakConcurrent, 1);
      assert.strictEqual(voice.aggregates.guilds.g1.peakConcurrentMembers, 1);
    });

    it('accumulates totalMemberMs on leave', function () {
      const voice = emptyVoice();
      const tJoin = 10_000;
      const tLeave = 70_000;
      applyVoiceStateUpdate(
        voice,
        { channelId: null, guildId: 'g1', userId: 'u1', flags: {} },
        { channelId: 'c1', guildId: 'g1', userId: 'u1', flags: {} },
        tJoin,
        'A'
      );
      applyVoiceStateUpdate(
        voice,
        { channelId: 'c1', guildId: 'g1', userId: 'u1', flags: {} },
        { channelId: null, guildId: 'g1', userId: 'u1', flags: {} },
        tLeave,
        null
      );
      assert.strictEqual(voice.aggregates.channels.c1.totalMemberMs, 60_000);
      assert.strictEqual(voice.aggregates.guilds.g1.totalMemberMs, 60_000);
      assert.strictEqual(voice.aggregates.channels.c1.leaveCount, 1);
      assert.strictEqual(voice.active.c1, undefined);
    });

    it('moves user between channels without dropping peak stats', function () {
      const voice = emptyVoice();
      applyVoiceStateUpdate(
        voice,
        { channelId: null, guildId: 'g1', userId: 'u1', flags: {} },
        { channelId: 'c1', guildId: 'g1', userId: 'u1', flags: {} },
        1000,
        'A'
      );
      applyVoiceStateUpdate(
        voice,
        { channelId: 'c1', guildId: 'g1', userId: 'u1', flags: {} },
        { channelId: 'c2', guildId: 'g1', userId: 'u1', flags: {} },
        2000,
        'B'
      );
      assert.strictEqual(voice.active.c1, undefined);
      assert.ok(voice.active.c2.members.u1);
      assert.strictEqual(voice.aggregates.channels.c1.leaveCount, 1);
      assert.strictEqual(voice.aggregates.channels.c2.joinCount, 1);
      // A move runs leave then join, so guild counters count channel transitions.
      assert.strictEqual(voice.aggregates.guilds.g1.joinCount, 2);
      assert.strictEqual(voice.aggregates.guilds.g1.leaveCount, 1);
    });

    it('updates flags in place when channel unchanged', function () {
      const voice = emptyVoice();
      applyVoiceStateUpdate(
        voice,
        { channelId: null, guildId: 'g1', userId: 'u1', flags: {} },
        { channelId: 'c1', guildId: 'g1', userId: 'u1', flags: { selfMute: false } },
        1000,
        'A'
      );
      const r = applyVoiceStateUpdate(
        voice,
        { channelId: 'c1', guildId: 'g1', userId: 'u1', flags: { selfMute: false } },
        { channelId: 'c1', guildId: 'g1', userId: 'u1', flags: { selfMute: true } },
        1500,
        'A'
      );
      assert.strictEqual(r.changed, true);
      assert.strictEqual(r.kind, 'flags');
      assert.strictEqual(voice.active.c1.members.u1.selfMute, true);
      assert.strictEqual(voice.aggregates.channels.c1.joinCount, 1);
    });

    it('does not claim a flags change when the member is not tracked', function () {
      const voice = emptyVoice();
      const r = applyVoiceStateUpdate(
        voice,
        { channelId: 'c1', guildId: 'g1', userId: 'u-missing', flags: { selfMute: false } },
        { channelId: 'c1', guildId: 'g1', userId: 'u-missing', flags: { selfMute: true } },
        1500,
        'A'
      );
      assert.strictEqual(r.changed, false);
      assert.strictEqual(voice.active.c1, undefined);
    });

    it('does not claim a flags change when active members map is missing', function () {
      const voice = emptyVoice();
      voice.active.c1 = { guildId: 'g1', channelName: 'A', updatedAt: 1 };
      const r = applyVoiceStateUpdate(
        voice,
        { channelId: 'c1', guildId: 'g1', userId: 'u1', flags: { selfMute: false } },
        { channelId: 'c1', guildId: 'g1', userId: 'u1', flags: { selfMute: true } },
        1600,
        'A'
      );
      assert.strictEqual(r.changed, false);
      assert.strictEqual(voice.active.c1.members, undefined);
    });

    it('does not double-count joinCount when the member is already tracked', function () {
      const voice = emptyVoice();
      const join = { channelId: 'c1', guildId: 'g1', userId: 'u1', flags: {} };
      const none = { channelId: null, guildId: 'g1', userId: 'u1', flags: {} };
      applyVoiceStateUpdate(voice, none, join, 1000, 'A');
      applyVoiceStateUpdate(voice, none, join, 5000, 'A');
      assert.strictEqual(voice.aggregates.channels.c1.joinCount, 1);
      assert.strictEqual(voice.active.c1.members.u1.joinedAt, 1000);
    });
  });

  describe('seedActiveVoiceMember', function () {
    it('does not increment joinCount', function () {
      const voice = emptyVoice();
      seedActiveVoiceMember(
        voice,
        {
          channelId: 'c1',
          guildId: 'g1',
          userId: 'u1',
          flags: {}
        },
        5000,
        'Lobby'
      );
      assert.ok(voice.active.c1.members.u1);
      assert.strictEqual(voice.aggregates.channels.c1, undefined);
    });

    it('skips if member already tracked', function () {
      const voice = emptyVoice();
      seedActiveVoiceMember(
        voice,
        { channelId: 'c1', guildId: 'g1', userId: 'u1', flags: { selfMute: true } },
        1000,
        'L'
      );
      seedActiveVoiceMember(
        voice,
        { channelId: 'c1', guildId: 'g1', userId: 'u1', flags: { selfMute: false } },
        2000,
        'L'
      );
      assert.strictEqual(voice.active.c1.members.u1.selfMute, true);
    });

    it('does not throw when a persisted channel record has no members map', function () {
      const voice = emptyVoice();
      voice.active.c1 = { guildId: 'g1', name: 'A', updatedAt: 0 };
      assert.doesNotThrow(() => seedActiveVoiceMember(
        voice,
        { channelId: 'c1', guildId: 'g1', userId: 'u1', flags: {} },
        1000,
        'A'
      ));
      assert.ok(voice.active.c1.members.u1);
    });
  });

  describe('guildActiveMemberCount', function () {
    it('sums members across channels in a guild', function () {
      const voice = emptyVoice();
      applyVoiceStateUpdate(
        voice,
        { channelId: null, guildId: 'g1', userId: 'u1', flags: {} },
        { channelId: 'c1', guildId: 'g1', userId: 'u1', flags: {} },
        0,
        null
      );
      applyVoiceStateUpdate(
        voice,
        { channelId: null, guildId: 'g1', userId: 'u2', flags: {} },
        { channelId: 'c2', guildId: 'g1', userId: 'u2', flags: {} },
        0,
        null
      );
      assert.strictEqual(guildActiveMemberCount(voice.active, 'g1'), 2);
    });
  });
});
