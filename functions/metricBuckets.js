'use strict';

/**
 * UTC day buckets shared by metrics plugins.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {number} ms epoch ms
 * @returns {string} YYYY-MM-DD (UTC)
 */
function dayKey (ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Day keys for the `days` most recent UTC days ending at `now`.
 * @param {number} now
 * @param {number} days
 * @returns {string[]}
 */
function windowDays (now, days) {
  const keys = [];
  for (let i = 0; i < days; i++) keys.push(dayKey(now - i * DAY_MS));
  return keys;
}

/**
 * Split [from, to) into per-UTC-day durations.
 * @param {number} from
 * @param {number} to
 * @returns {Array<{ day: string, ms: number }>}
 */
function splitByDay (from, to) {
  const parts = [];
  let cursor = from;
  while (cursor < to) {
    const nextMidnight = (Math.floor(cursor / DAY_MS) + 1) * DAY_MS;
    const end = Math.min(to, nextMidnight);
    parts.push({ day: dayKey(cursor), ms: end - cursor });
    cursor = end;
  }
  return parts;
}

/**
 * Drop day buckets older than `retentionDays`.
 * @param {Object<string, *>} days
 * @param {number} now
 * @param {number} retentionDays
 */
function pruneDays (days, now, retentionDays) {
  if (!days || !(retentionDays > 0)) return;
  const oldest = dayKey(now - (retentionDays - 1) * DAY_MS);
  for (const key of Object.keys(days)) {
    if (key < oldest) delete days[key];
  }
}

/**
 * Union of `field` maps (e.g. member ids) across the given day buckets.
 * @param {Object<string, Object>} days
 * @param {string[]} keys
 * @param {string} field
 * @returns {number}
 */
function uniqueAcross (days, keys, field) {
  const seen = new Set();
  for (const key of keys) {
    const bucket = days && days[key];
    if (bucket && bucket[field]) Object.keys(bucket[field]).forEach((id) => seen.add(id));
  }
  return seen.size;
}

/**
 * Sum a numeric field across the given day buckets.
 * @param {Object<string, Object>} days
 * @param {string[]} keys
 * @param {string} field
 * @returns {number}
 */
function sumAcross (days, keys, field) {
  let total = 0;
  for (const key of keys) {
    const bucket = days && days[key];
    if (bucket && Number.isFinite(bucket[field])) total += bucket[field];
  }
  return total;
}

/**
 * Max of a numeric field across the given day buckets.
 * @param {Object<string, Object>} days
 * @param {string[]} keys
 * @param {string} field
 * @returns {number}
 */
function maxAcross (days, keys, field) {
  let max = 0;
  for (const key of keys) {
    const bucket = days && days[key];
    if (bucket && Number.isFinite(bucket[field]) && bucket[field] > max) max = bucket[field];
  }
  return max;
}

module.exports = {
  DAY_MS,
  dayKey,
  windowDays,
  splitByDay,
  pruneDays,
  uniqueAcross,
  sumAcross,
  maxAcross
};
