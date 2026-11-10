'use strict';

// Music bots' "now playing" posts, read from the lines `messageText` returns.
// Only formats seen in real posts are listed; add a bot by adding a parser.

const CLOCK = '(\\d{1,2}:\\d{2}(?::\\d{2})?)';

function unescape (text) {
  return String(text || '').replace(/\\([!-/:-@[-`{-~])/g, '$1').trim();
}

/**
 * Seconds in a `m:ss` or `h:mm:ss` clock.
 * @param {string} clock
 * @returns {number|null}
 */
function seconds (clock) {
  const parts = String(clock || '').split(':').map(Number);
  if (!parts.length || parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** "Title by Artist": the last " by " splits, so "Stand by Me by Ben E. King" keeps its title. */
function titleAndArtist (text) {
  const at = text.lastIndexOf(' by ');
  if (at <= 0) return { title: text, artist: null };
  return { title: text.slice(0, at).trim(), artist: text.slice(at + 4).trim() || null };
}

/**
 * Tempo (tempobot.net), as its instances (Tempo, Tempo 2, …) posted in
 * G00N SQUAD in October and November 2026: a Components V2 card reading
 * `**Playing: <title> by <artist>**`, `**Requester**: <@id>`, a volume line,
 * and `▬▬▬ **00:00:22 / 00:04:39**`; and, when it leaves,
 * `<@id> | It's sad to say goodbye, I've stopped playing music and left the voice channel. :frowning:`.
 * @private
 */
function tempo (lines) {
  if (lines.some((line) => /I've stopped playing music and left the voice channel/.test(line))) {
    return { type: 'stopped', bot: 'tempo' };
  }
  let playing = null;
  let requester = null;
  let position = null;
  let duration = null;
  for (const line of lines) {
    const title = /^\*\*Playing: (.+)\*\*$/.exec(line);
    if (title && !playing) playing = titleAndArtist(unescape(title[1]));
    const who = /^\*\*Requester\*\*:\s*<@!?(\d{5,25})>/.exec(line);
    if (who) requester = who[1];
    const clock = new RegExp(`\\*\\*${CLOCK} / ${CLOCK}\\*\\*`).exec(line);
    if (clock) {
      position = seconds(clock[1]);
      duration = seconds(clock[2]);
    }
  }
  if (!playing || !playing.title) return null;
  return { type: 'playing', bot: 'tempo', title: playing.title, artist: playing.artist, requester, position, duration: duration || null };
}

const PARSERS = [tempo];

/**
 * What a music bot's post says about playback: a song starting
 * (`{ type: 'playing', bot, title, artist, requester, position, duration }`,
 * `requester` a Discord user id, `position` and `duration` in seconds or null),
 * the bot stopping (`{ type: 'stopped', bot }`), or null for anything else.
 * @param {string[]} lines From `messageText`.
 * @returns {Object|null}
 */
function parseNowPlaying (lines) {
  if (!Array.isArray(lines) || !lines.length) return null;
  for (const parser of PARSERS) {
    const found = parser(lines);
    if (found) return found;
  }
  return null;
}

module.exports = parseNowPlaying;
module.exports.parseNowPlaying = parseNowPlaying;
module.exports.seconds = seconds;
