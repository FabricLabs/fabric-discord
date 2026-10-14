'use strict';

const { GatewayIntentBits } = require('discord.js');
const voiceActivity = require('./voiceActivity');
const messageActivity = require('./messageActivity');

/**
 * discord.js intent bits for a set of metrics plugins (or a MetricsPipeline),
 * so a metrics-only bot connects with no privileged intents.
 * @param {Array<Object>|{ intents: string[] }} pluginsOrPipeline
 * @returns {number[]}
 */
function gatewayIntents (pluginsOrPipeline) {
  const names = Array.isArray(pluginsOrPipeline)
    ? [].concat(...pluginsOrPipeline.map((p) => p.intents || []))
    : (pluginsOrPipeline && pluginsOrPipeline.intents) || [];
  return Array.from(new Set(names))
    .map((name) => GatewayIntentBits[name])
    .filter((bit) => bit != null);
}

module.exports = {
  voiceActivity,
  messageActivity,
  gatewayIntents
};
