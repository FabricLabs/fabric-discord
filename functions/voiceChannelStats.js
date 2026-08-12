'use strict';

/**
 * @typedef {Object} VoiceFlags
 * @property {boolean|null} [mute]
 * @property {boolean|null} [deaf]
 * @property {boolean|null} [selfMute]
 * @property {boolean|null} [selfDeaf]
 * @property {boolean|null} [streaming]
 * @property {boolean|null} [selfVideo]
 * @property {boolean|null} [suppress]
 */

/**
 * @typedef {Object} VoiceStateSlice
 * @property {string|null} channelId
 * @property {string} guildId
 * @property {string} userId
 * @property {VoiceFlags} flags
 */

/**
 * @param {Object} aggregates
 * @param {string} channelId
 */
function ensureChannelAgg (aggregates, channelId) {
  if (!aggregates.channels[channelId]) {
    aggregates.channels[channelId] = {
      joinCount: 0,
      leaveCount: 0,
      peakConcurrent: 0,
      totalMemberMs: 0
    };
  }
  return aggregates.channels[channelId];
}

/**
 * @param {Object} aggregates
 * @param {string} guildId
 */
function ensureGuildAgg (aggregates, guildId) {
  if (!aggregates.guilds[guildId]) {
    aggregates.guilds[guildId] = {
      joinCount: 0,
      leaveCount: 0,
      peakConcurrentMembers: 0,
      totalMemberMs: 0
    };
  }
  return aggregates.guilds[guildId];
}

/**
 * @param {Object<string, { guildId: string, members?: Object }>} active
 * @param {string} guildId
 */
function guildActiveMemberCount (active, guildId) {
  let n = 0;
  for (const rec of Object.values(active)) {
    if (rec.guildId === guildId && rec.members) n += Object.keys(rec.members).length;
  }
  return n;
}

/**
 * @param {Object} vs — discord.js `VoiceState` or plain object with the same flag fields
 * @returns {VoiceFlags}
 */
function flagsFromVoiceState (vs) {
  return {
    mute: vs.mute,
    deaf: vs.deaf,
    selfMute: vs.selfMute,
    selfDeaf: vs.selfDeaf,
    streaming: vs.streaming,
    selfVideo: vs.selfVideo,
    suppress: vs.suppress
  };
}

/**
 * Shallow-copy voice flags from a slice (tests / callers that must not mutate the slice).
 * @param {VoiceStateSlice} vs
 * @returns {VoiceFlags}
 */
function flagsFromSlice (vs) {
  return { ...vs.flags };
}

/**
 * Apply a Discord voice state transition to accumulated stats and active map.
 *
 * @param {Object} voice — `content.voice` from Discord service state
 * @param {VoiceStateSlice} oldSlice
 * @param {VoiceStateSlice} newSlice
 * @param {number} now — epoch ms
 * @param {string|null} channelName — resolved name for new channel when joining
 * @returns {{ changed: boolean, kind?: 'flags'|'session' }}
 */
function applyVoiceStateUpdate (voice, oldSlice, newSlice, now, channelName) {
  const { active, aggregates } = voice;
  const oldC = oldSlice.channelId;
  const newC = newSlice.channelId;
  const guildId = newSlice.guildId;
  const userId = newSlice.userId;

  if (oldC === newC) {
    if (!newC) return { changed: false };
    const rec = active[newC];
    // Guard missing active records / members map (partial state) — do not claim a change.
    if (rec && rec.members && typeof rec.members === 'object' && rec.members[userId]) {
      Object.assign(rec.members[userId], flagsFromSlice(newSlice));
      rec.updatedAt = now;
      return { changed: true, kind: 'flags' };
    }
    return { changed: false };
  }

  let kind = null;

  if (oldC) {
    const rec = active[oldC];
    if (rec && rec.members && typeof rec.members === 'object' && rec.members[userId]) {
      const m = rec.members[userId];
      const joinedAt = typeof m.joinedAt === 'number' ? m.joinedAt : now;
      const ms = Math.max(0, now - joinedAt);
      const chAgg = ensureChannelAgg(aggregates, oldC);
      const gAgg = ensureGuildAgg(aggregates, guildId);
      chAgg.leaveCount += 1;
      chAgg.totalMemberMs += ms;
      gAgg.leaveCount += 1;
      gAgg.totalMemberMs += ms;
      delete rec.members[userId];
      if (Object.keys(rec.members).length === 0) delete active[oldC];
      kind = 'session';
    }
  }

  if (newC) {
    if (!active[newC]) {
      active[newC] = {
        guildId,
        name: channelName,
        members: {},
        updatedAt: now
      };
    } else {
      active[newC].guildId = guildId;
      if (channelName != null) active[newC].name = channelName;
      active[newC].updatedAt = now;
      if (!active[newC].members || typeof active[newC].members !== 'object') {
        active[newC].members = {};
      }
    }
    const rec = active[newC];
    // Gateway RESUME can replay a join with uncached oldState (oldC null) while
    // the member is already in the map — do not reset joinedAt or double-count.
    if (rec.members[userId]) {
      Object.assign(rec.members[userId], flagsFromSlice(newSlice));
      rec.updatedAt = now;
      if (!kind) kind = 'flags';
    } else {
      rec.members[userId] = {
        joinedAt: now,
        ...newSlice.flags
      };
      const chAgg = ensureChannelAgg(aggregates, newC);
      const gAgg = ensureGuildAgg(aggregates, guildId);
      chAgg.joinCount += 1;
      gAgg.joinCount += 1;
      const n = Object.keys(rec.members).length;
      if (n > chAgg.peakConcurrent) chAgg.peakConcurrent = n;
      const guildSum = guildActiveMemberCount(active, guildId);
      if (guildSum > gAgg.peakConcurrentMembers) gAgg.peakConcurrentMembers = guildSum;
      kind = 'session';
    }
  }

  if (!kind) return { changed: false };
  return { changed: true, kind };
}

/**
 * Seed active voice map from guild voice state cache (no aggregate increments).
 *
 * @param {Object} voice
 * @param {VoiceStateSlice} slice
 * @param {number} now
 * @param {string|null} channelName
 */
function seedActiveVoiceMember (voice, slice, now, channelName) {
  const { channelId, guildId, userId } = slice;
  if (!channelId) return;
  const { active } = voice;
  const existing = active[channelId];
  if (existing && existing.members && existing.members[userId]) return;
  if (!existing) {
    active[channelId] = {
      guildId,
      name: channelName,
      members: {},
      updatedAt: now
    };
  } else {
    existing.guildId = guildId;
    if (channelName != null) existing.name = channelName;
    existing.updatedAt = now;
    if (!existing.members || typeof existing.members !== 'object') {
      existing.members = {};
    }
  }
  active[channelId].members[userId] = {
    joinedAt: now,
    seeded: true,
    ...slice.flags
  };
}

module.exports = {
  applyVoiceStateUpdate,
  seedActiveVoiceMember,
  flagsFromVoiceState,
  flagsFromSlice,
  ensureChannelAgg,
  ensureGuildAgg,
  guildActiveMemberCount
};
