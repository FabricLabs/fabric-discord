'use strict';

/**
 * Normalize Discord application settings for `@fabric/discord`.
 * Secrets (`token`, `app.secret`) come from env / local settings — never log them.
 *
 * @param {object} [raw]
 * @returns {object}
 */
function normalizeDiscordSettings (raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const appIn = (src.app && typeof src.app === 'object') ? src.app : {};
  const token = String(src.token || src.botToken || '').trim() || null;
  const appId = String(appIn.id || src.appId || src.clientId || '').trim() || null;
  const appSecret = String(appIn.secret || src.appSecret || src.clientSecret || '').trim() || null;
  const channel = String(src.channel || src.channelId || '').trim() || null;
  const webhook = String(src.webhook || src.webhookUrl || '').trim() || null;
  const enable = src.enable === true || src.enable === 1 || src.enable === 'true' ||
    !!(token || webhook);

  return {
    enable: !!enable,
    token,
    webhook,
    channel,
    authority: String(src.authority || '').trim() || undefined,
    app: {
      id: appId,
      secret: appSecret
    },
    announceKills: src.announceKills !== false,
    announcePlayerJoins: src.announcePlayerJoins !== false,
    announceActivities: !!src.announceActivities,
    announceMissions: !!src.announceMissions,
    announceCombat: !!src.announceCombat,
    announceIncaps: !!src.announceIncaps
  };
}

/**
 * Public runtime summary (never includes secrets).
 * @param {object} [cfg] normalized settings
 * @param {object} [status] live bot status
 * @returns {object}
 */
function discordRuntimeSummary (cfg = {}, status = {}) {
  const n = normalizeDiscordSettings(cfg);
  return {
    enable: n.enable === true,
    botConfigured: !!n.token,
    webhookConfigured: !!n.webhook,
    appId: n.app.id || null,
    channel: n.channel || null,
    announceKills: n.announceKills !== false,
    announcePlayerJoins: n.announcePlayerJoins !== false,
    announceActivities: !!n.announceActivities,
    announceMissions: !!n.announceMissions,
    announceCombat: !!n.announceCombat,
    announceIncaps: !!n.announceIncaps,
    botReady: status.botReady === true,
    botUser: status.botUser || null,
    mode: n.token ? 'bot' : (n.webhook ? 'webhook' : 'off')
  };
}

module.exports = {
  normalizeDiscordSettings,
  discordRuntimeSummary
};
