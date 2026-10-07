'use strict';

const {
  dayKey,
  windowDays,
  pruneDays,
  uniqueAcross,
  sumAcross
} = require('../functions/metricBuckets');

/**
 * Message activity per operation: message and unique-author counts from the
 * Discord service's `activity` (DiscordMessage) events in matched channels.
 * Message content is never stored. Needs no privileged intents.
 *
 * State: `{ operations: { <id>: { total, days: { YYYY-MM-DD: { messages, authors } } } } }`
 * @param {Object} [options]
 * @param {number} [options.retentionDays] day buckets kept (default 90)
 * @returns {Object} metrics plugin
 */
function messageActivity (options = {}) {
  const retentionDays = options.retentionDays || 90;

  return {
    name: 'messages',
    title: 'Message activity',
    intents: ['Guilds', 'GuildMessages'],

    init () {
      return { operations: {} };
    },

    on: {
      activity (event, ctx) {
        if (!event || event.type !== 'DiscordMessage' || !event.target || event.target.ref == null) return false;
        const hits = ctx.operationsFor({ id: String(event.target.ref), name: event.target.name });
        if (!hits.length) return false;
        const day = dayKey(ctx.now);
        const author = event.actor && event.actor.ref != null ? String(event.actor.ref) : null;
        for (const { operation } of hits) {
          if (!ctx.state.operations[operation.id]) ctx.state.operations[operation.id] = { total: 0, days: {} };
          const opState = ctx.state.operations[operation.id];
          if (!opState.days[day]) opState.days[day] = { messages: 0, authors: {} };
          opState.days[day].messages += 1;
          if (author) opState.days[day].authors[author] = 1;
          opState.total += 1;
        }
        return true;
      },

      tick (event, ctx) {
        for (const opState of Object.values(ctx.state.operations)) pruneDays(opState.days, ctx.now, retentionDays);
      }
    },

    report (state, operation, entry, ctx) {
      const opState = (state.operations && state.operations[operation.id]) || { total: 0, days: {} };
      const summary = (days) => {
        const keys = windowDays(ctx.now, days);
        return {
          messages: sumAcross(opState.days, keys, 'messages'),
          authors: uniqueAcross(opState.days, keys, 'authors')
        };
      };
      return {
        last7Days: summary(7),
        last30Days: summary(30),
        totalMessages: opState.total
      };
    }
  };
}

module.exports = messageActivity;
