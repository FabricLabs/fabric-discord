'use strict';

/**
 * Receive-only voice: join a channel, subscribe to speakers as s16le PCM,
 * leave. `@discordjs/voice` stays here so apps do not take that dependency.
 * Does not capture Go Live / screenshare RTP. Speak is not required; Connect is.
 */

const { createRequire } = require('module');

const SAMPLE_RATE = 48000;
const CHANNELS = 2;

function fail (status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function loadVoice () {
  return require('@discordjs/voice');
}

function loadPrism () {
  try {
    return require('prism-media');
  } catch (_) {
    return createRequire(require.resolve('@discordjs/voice'))('prism-media');
  }
}

/**
 * Join a voice channel muted, listening only.
 * @param {Object} input
 * @param {string} input.channelId
 * @param {string} input.guildId
 * @param {Function} input.adapterCreator discord.js `guild.voiceAdapterCreator`
 * @param {number} [input.timeoutMs] how long to wait for Ready (default 20s)
 * @param {Object} [deps]
 * @param {Object} [deps.voice] injectable `@discordjs/voice` (tests)
 * @returns {Promise<Object>} voice connection
 */
async function joinVoiceReceive (input = {}, deps = {}) {
  const channelId = String(input.channelId || '');
  const guildId = String(input.guildId || '');
  if (!channelId || !guildId) throw fail(400, 'Need a voice channel to join.');
  if (typeof input.adapterCreator !== 'function') throw fail(400, 'Need a voice adapter.');
  const voice = deps.voice || loadVoice();
  const connection = voice.joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator: input.adapterCreator,
    selfDeaf: false,
    selfMute: true
  });
  const timeoutMs = Number(input.timeoutMs) > 0 ? Number(input.timeoutMs) : 20000;
  await voice.entersState(connection, voice.VoiceConnectionStatus.Ready, timeoutMs);
  return connection;
}

/**
 * Subscribe to one speaker; returns a stream of s16le stereo PCM at 48 kHz.
 * @param {Object} connection from {@link joinVoiceReceive}
 * @param {string} userId
 * @param {Object} [deps]
 * @param {Object} [deps.voice]
 * @param {Object} [deps.prism]
 * @param {number} [deps.silenceMs] opus end-after-silence (default 200)
 * @returns {stream.Readable}
 */
function subscribeVoiceReceive (connection, userId, deps = {}) {
  const id = String(userId || '');
  if (!connection || !connection.receiver || typeof connection.receiver.subscribe !== 'function') {
    throw fail(500, 'Voice connection has no receiver.');
  }
  if (!id) throw fail(400, 'Need a speaker to subscribe.');
  const voice = deps.voice || loadVoice();
  const prism = deps.prism || loadPrism();
  const silenceMs = Number(deps.silenceMs) > 0 ? Number(deps.silenceMs) : 200;
  const opus = connection.receiver.subscribe(id, {
    end: { behavior: voice.EndBehaviorType.AfterSilence, duration: silenceMs }
  });
  const decoder = new prism.opus.Decoder({ frameSize: 960, channels: CHANNELS, rate: SAMPLE_RATE });
  return opus.pipe(decoder);
}

/**
 * Destroy a receive connection. Safe when `connection` is missing.
 * @param {Object} [connection]
 */
function leaveVoiceReceive (connection) {
  if (connection && typeof connection.destroy === 'function') connection.destroy();
}

module.exports = {
  SAMPLE_RATE,
  CHANNELS,
  joinVoiceReceive,
  subscribeVoiceReceive,
  leaveVoiceReceive
};
