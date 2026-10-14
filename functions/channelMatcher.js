'use strict';

/**
 * Channel matchers for metrics configuration.
 *
 * A matcher is one of:
 *   - a snowflake string (`'1205020182226010152'`) — exact channel id
 *   - `'/pattern/'` — case-insensitive RegExp on the channel name
 *   - any other string — case-insensitive exact channel name
 *   - `{ id }` or `{ name }` objects with the same meaning
 */

const SNOWFLAKE = /^\d{15,25}$/;

/**
 * @param {string|Object} matcher
 * @param {{ id?: string, name?: string }} channel
 * @returns {boolean}
 */
function matchesChannel (matcher, channel) {
  if (!matcher || !channel) return false;
  const id = channel.id != null ? String(channel.id) : null;
  const name = channel.name != null ? String(channel.name) : null;
  if (typeof matcher === 'object') {
    if (matcher.id != null) return id === String(matcher.id);
    if (matcher.name != null) return matchesChannel(String(matcher.name), { name });
    return false;
  }
  const raw = String(matcher).trim();
  if (!raw) return false;
  if (SNOWFLAKE.test(raw)) return id === raw;
  if (name == null) return false;
  const regex = /^\/(.+)\/$/.exec(raw);
  if (regex) {
    try {
      return new RegExp(regex[1], 'i').test(name);
    } catch (_) {
      return false;
    }
  }
  return name.toLowerCase() === raw.toLowerCase();
}

/**
 * @param {Array<string|Object>} matchers
 * @param {{ id?: string, name?: string }} channel
 * @returns {boolean}
 */
function matchesAnyChannel (matchers, channel) {
  return Array.isArray(matchers) && matchers.some((m) => matchesChannel(m, channel));
}

module.exports = {
  matchesChannel,
  matchesAnyChannel
};
