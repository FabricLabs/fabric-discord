'use strict';

const {
  dayKey,
  windowDays,
  splitByDay,
  pruneDays,
  uniqueAcross,
  sumAcross,
  maxAcross
} = require('../functions/metricBuckets');

const HOUR_MS = 60 * 60 * 1000;

/**
 * Voice activity per operation: member-hours, sessions, unique members, peak
 * concurrency, and who is live now — from the Discord service's `voice`
 * (join / leave / move) and `ready` events. Only channels some operation
 * matches are tracked. Open sessions are credited on every `tick`, so a
 * restart loses at most one tick of time.
 *
 * State: `{ open: { '<guild>:<user>': { guildId, channelId, channelName, since } },
 *           operations: { <id>: { totalMemberMs, sessions, days: { YYYY-MM-DD: { memberMs, sessions, peak, members } } } } }`
 * @param {Object} [options]
 * @param {number} [options.retentionDays] day buckets kept (default 90)
 * @returns {Object} metrics plugin
 */
function voiceActivity (options = {}) {
  const retentionDays = options.retentionDays || 90;

  function operationState (state, id) {
    if (!state.operations[id]) state.operations[id] = { totalMemberMs: 0, sessions: 0, days: {} };
    return state.operations[id];
  }

  function bucket (opState, day) {
    if (!opState.days[day]) opState.days[day] = { memberMs: 0, sessions: 0, peak: 0, members: {} };
    return opState.days[day];
  }

  function channelOf (session) {
    return { id: session.channelId, name: session.channelName, guildId: session.guildId };
  }

  function credit (ctx, session, userId, to) {
    if (!(to > session.since)) return;
    for (const { operation } of ctx.operationsFor(channelOf(session))) {
      const opState = operationState(ctx.state, operation.id);
      for (const part of splitByDay(session.since, to)) {
        const b = bucket(opState, part.day);
        b.memberMs += part.ms;
        b.members[userId] = 1;
        opState.totalMemberMs += part.ms;
      }
    }
    session.since = to;
  }

  function live (ctx, operationId) {
    let n = 0;
    for (const session of Object.values(ctx.state.open)) {
      if (ctx.operationsFor(channelOf(session)).some((hit) => hit.operation.id === operationId)) n += 1;
    }
    return n;
  }

  function open (ctx, { guildId, userId, channelId, channelName }, countSession) {
    const session = { guildId, channelId, channelName: channelName || null, since: ctx.now };
    const hits = ctx.operationsFor(channelOf(session));
    if (!hits.length) return false;
    ctx.state.open[guildId + ':' + userId] = session;
    const day = dayKey(ctx.now);
    for (const { operation } of hits) {
      const opState = operationState(ctx.state, operation.id);
      const b = bucket(opState, day);
      b.members[userId] = 1;
      if (countSession) {
        b.sessions += 1;
        opState.sessions += 1;
      }
      b.peak = Math.max(b.peak, live(ctx, operation.id));
    }
    return true;
  }

  function close (ctx, guildId, userId) {
    const key = guildId + ':' + userId;
    const session = ctx.state.open[key];
    if (!session) return false;
    credit(ctx, session, userId, ctx.now);
    delete ctx.state.open[key];
    return true;
  }

  return {
    name: 'voice',
    title: 'Voice activity',
    intents: ['Guilds', 'GuildVoiceStates'],

    init () {
      return { open: {}, operations: {} };
    },

    on: {
      // Sessions open before a restart were credited up to the last tick;
      // re-seed from who is in voice right now instead of guessing the gap.
      ready (event, ctx) {
        ctx.state.open = {};
        const active = ctx.source && ctx.source.voice && ctx.source.voice.active;
        for (const [channelId, rec] of Object.entries(active || {})) {
          for (const userId of Object.keys((rec && rec.members) || {})) {
            open(ctx, { guildId: rec.guildId, userId, channelId, channelName: rec.name }, false);
          }
        }
      },

      voice (event, ctx) {
        if (!event || !event.userId || event.oldChannelId === event.newChannelId) return false;
        const guildId = String(event.guildId);
        const userId = String(event.userId);
        let changed = close(ctx, guildId, userId);
        if (event.newChannelId) {
          changed = open(ctx, { guildId, userId, channelId: String(event.newChannelId), channelName: event.channelName }, true) || changed;
        }
        return changed;
      },

      tick (event, ctx) {
        for (const [key, session] of Object.entries(ctx.state.open)) {
          credit(ctx, session, key.slice(key.indexOf(':') + 1), ctx.now);
        }
        for (const opState of Object.values(ctx.state.operations)) pruneDays(opState.days, ctx.now, retentionDays);
      }
    },

    report (state, operation, entry, ctx) {
      const opState = (state.operations && state.operations[operation.id]) || { totalMemberMs: 0, sessions: 0, days: {} };
      const summary = (days) => {
        const keys = windowDays(ctx.now, days);
        return {
          hours: Math.round(sumAcross(opState.days, keys, 'memberMs') / HOUR_MS * 10) / 10,
          sessions: sumAcross(opState.days, keys, 'sessions'),
          members: uniqueAcross(opState.days, keys, 'members'),
          peak: maxAcross(opState.days, keys, 'peak')
        };
      };
      return {
        live: live(Object.assign({}, ctx, { state }), operation.id),
        last7Days: summary(7),
        last30Days: summary(30),
        totalHours: Math.round(opState.totalMemberMs / HOUR_MS * 10) / 10,
        totalSessions: opState.sessions
      };
    }
  };
}

module.exports = voiceActivity;
