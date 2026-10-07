'use strict';

/**
 * Pure Discord catalog helpers for Fabric consumers.
 * Pass a live discord.js Client (or a cache-shaped stub). No Store / gossip.
 */

const DEFAULT_MEMBER_LIMIT = 200;
const DEFAULT_USER_CAP = 1000;

/** discord.js ChannelType values we surface for announce / chat ops. */
const CHANNEL_TYPE_NAMES = Object.freeze({
  0: 'text',
  2: 'voice',
  4: 'category',
  5: 'announcement',
  13: 'stage',
  15: 'forum',
  16: 'media'
});

/**
 * Whether the channel is a reasonable announce/post target (text or announcement).
 * @param {number|string} type
 * @returns {boolean}
 */
function channelCanAnnounce (type) {
  const t = Number(type);
  return t === 0 || t === 5;
}

/**
 * Text-bearing channels a Fabric chat rail can open as a bridged Discord thread.
 * @param {number|string} type
 * @returns {boolean}
 */
function channelIsChatInsight (type) {
  const t = Number(type);
  return t === 0 || t === 5;
}

/**
 * discord.js Collection, manager `.cache`, array, or Map → array of values.
 * @param {*} maybe
 * @returns {Array}
 */
function collectionValues (maybe) {
  if (!maybe) return [];
  if (Array.isArray(maybe)) return maybe;
  if (maybe.cache) return collectionValues(maybe.cache);
  if (typeof maybe.values === 'function') return Array.from(maybe.values());
  if (typeof maybe.map === 'function' && typeof maybe.length === 'number') {
    return Array.from(maybe);
  }
  return [];
}

/**
 * @param {object} channel discord.js GuildChannel-like
 * @returns {object|null}
 */
function serializeChannel (channel) {
  if (!channel || channel.id == null) return null;
  const type = channel.type != null ? Number(channel.type) : -1;
  return {
    id: String(channel.id),
    name: String(channel.name || channel.id),
    type,
    typeName: CHANNEL_TYPE_NAMES[type] || `type:${type}`,
    parentId: channel.parentId != null ? String(channel.parentId) : null,
    position: Number.isFinite(Number(channel.position)) ? Number(channel.position) : 0,
    canAnnounce: channelCanAnnounce(type),
    chatInsight: channelIsChatInsight(type),
    guildId: channel.guildId != null
      ? String(channel.guildId)
      : (channel.guild && channel.guild.id != null ? String(channel.guild.id) : null)
  };
}

/**
 * @param {object} member discord.js GuildMember-like or User-like
 * @returns {object|null}
 */
function serializeMember (member) {
  if (!member) return null;
  const user = member.user && typeof member.user === 'object' ? member.user : member;
  const id = member.id != null ? member.id : user.id;
  if (id == null) return null;
  const username = String(user.username || user.globalName || member.displayName || id);
  const displayName = String(
    member.displayName || user.globalName || user.displayName || username
  );
  let status = null;
  if (member.presence && member.presence.status) {
    status = String(member.presence.status);
  } else if (user.presence && user.presence.status) {
    status = String(user.presence.status);
  }
  const avatar = user.avatar != null
    ? String(user.avatar)
    : (member.avatar != null ? String(member.avatar) : null);
  const row = {
    id: String(id),
    username,
    displayName,
    bot: user.bot === true || member.bot === true,
    status,
    avatar
  };
  if (Array.isArray(member.roles)) {
    row.roles = member.roles.map((r) => (r != null ? String(r) : null)).filter(Boolean);
  } else if (member.roles && typeof member.roles === 'object') {
    const ids = collectionValues(member.roles).map((r) => {
      if (r == null) return null;
      if (typeof r === 'string' || typeof r === 'number') return String(r);
      return r.id != null ? String(r.id) : null;
    }).filter(Boolean);
    if (ids.length) row.roles = ids;
  }
  return row;
}

/**
 * @param {Array<object>} members
 * @param {number} [limit]
 * @returns {Array<object>}
 */
function capMembers (members, limit) {
  const max = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(1000, Number(limit)))
    : DEFAULT_MEMBER_LIMIT;
  const list = (Array.isArray(members) ? members : []).slice();
  list.sort((a, b) => {
    const an = String((a && (a.displayName || a.username)) || '').toLowerCase();
    const bn = String((b && (b.displayName || b.username)) || '').toLowerCase();
    return an.localeCompare(bn);
  });
  return list.slice(0, max);
}

/**
 * Unique users across guild member lists.
 * @param {Array<object>} guilds
 * @param {number} [limit]
 * @returns {Array<object>}
 */
function uniqueUsersFromGuilds (guilds, limit = DEFAULT_USER_CAP) {
  const byId = new Map();
  for (const g of guilds || []) {
    for (const m of g.members || []) {
      if (!m || m.id == null || byId.has(m.id)) continue;
      byId.set(String(m.id), m);
    }
  }
  return capMembers(Array.from(byId.values()), limit);
}

/**
 * @param {object} guild discord.js Guild-like
 * @param {Object} [opts]
 * @param {number} [opts.memberLimit]
 * @returns {object|null}
 */
function serializeGuild (guild, opts = {}) {
  if (!guild || guild.id == null) return null;
  const channels = collectionValues(guild.channels)
    .map(serializeChannel)
    .filter(Boolean);
  channels.sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return String(a.name).localeCompare(String(b.name));
  });
  const members = capMembers(
    collectionValues(guild.members).map(serializeMember).filter(Boolean),
    opts.memberLimit
  );
  const memberCount = Number.isFinite(Number(guild.memberCount))
    ? Number(guild.memberCount)
    : members.length;
  return {
    id: String(guild.id),
    name: String(guild.name || guild.id),
    icon: guild.icon != null ? String(guild.icon) : null,
    memberCount,
    truncated: members.length < memberCount,
    channels,
    members
  };
}

/**
 * Pull guild / channel / member lists from Discord into the client cache.
 * Prefers bounded `members.list({ limit })` so large guilds do not chunk the
 * entire member list over the gateway.
 *
 * @param {object|null} client
 * @param {Object} [opts]
 * @param {number} [opts.memberLimit]
 * @returns {Promise<object>}
 */
async function refreshDiscordCaches (client, opts = {}) {
  const memberLimit = Number.isFinite(Number(opts.memberLimit))
    ? Math.max(1, Math.min(1000, Number(opts.memberLimit)))
    : DEFAULT_MEMBER_LIMIT;
  const errors = [];
  let guildsFetched = 0;
  let channelsFetched = 0;
  let membersFetched = 0;

  if (!client) {
    return {
      ok: false,
      error: 'no_client',
      guildsFetched,
      channelsFetched,
      membersFetched,
      memberLimit,
      errors
    };
  }

  try {
    if (client.guilds && typeof client.guilds.fetch === 'function') {
      await client.guilds.fetch();
    }
  } catch (e) {
    errors.push({
      scope: 'guilds',
      message: e && e.message ? e.message : String(e)
    });
  }

  const guilds = collectionValues(client.guilds);
  guildsFetched = guilds.length;

  for (const guild of guilds) {
    const guildId = guild && guild.id != null ? String(guild.id) : null;
    try {
      if (guild.channels && typeof guild.channels.fetch === 'function') {
        await guild.channels.fetch();
      }
      channelsFetched += collectionValues(guild.channels).length;
    } catch (e) {
      errors.push({
        scope: 'channels',
        guildId,
        message: e && e.message ? e.message : String(e)
      });
    }
    try {
      const mgr = guild.members;
      if (mgr && typeof mgr.list === 'function') {
        await mgr.list({ limit: memberLimit });
      } else if (mgr && typeof mgr.fetch === 'function') {
        await mgr.fetch();
      }
      membersFetched += collectionValues(guild.members).length;
    } catch (e) {
      errors.push({
        scope: 'members',
        guildId,
        message: e && e.message ? e.message : String(e)
      });
    }
  }

  return {
    ok: errors.length === 0,
    error: errors.length ? (errors[0].message || 'sync_partial') : null,
    guildsFetched,
    channelsFetched,
    membersFetched,
    memberLimit,
    errors
  };
}

/**
 * Build a UI / Store catalog from a discord.js Client (or stub with guilds.cache).
 *
 * @param {object|null} client
 * @param {Object} [opts]
 * @param {string|null} [opts.selectedChannelId]
 * @param {boolean} [opts.botReady]
 * @param {string|null} [opts.botUser]
 * @param {string|null} [opts.botUserId]
 * @param {string|null} [opts.appId]
 * @param {object|null} [opts.sync]
 * @param {number} [opts.memberLimit]
 * @returns {object}
 */
function buildDiscordGuildCatalog (client, opts = {}) {
  const selectedChannelId = opts.selectedChannelId != null
    ? String(opts.selectedChannelId).trim() || null
    : null;
  const botReady = opts.botReady === true;
  const botUser = opts.botUser != null ? String(opts.botUser) : null;
  const botUserId = opts.botUserId != null
    ? String(opts.botUserId).trim() || null
    : ((client && client.user && client.user.id != null)
      ? String(client.user.id)
      : null);
  const sync = opts.sync && typeof opts.sync === 'object' ? opts.sync : null;
  const appId = opts.appId != null && String(opts.appId).trim()
    ? String(opts.appId).trim()
    : null;

  if (!client || !client.guilds) {
    return {
      botReady,
      botUser,
      botUserId,
      appId,
      selectedChannelId,
      guilds: [],
      users: [],
      sync,
      error: botReady ? 'discord_client_unavailable' : 'bot_not_ready'
    };
  }

  const guilds = collectionValues(client.guilds)
    .map((g) => serializeGuild(g, { memberLimit: opts.memberLimit }))
    .filter(Boolean)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return {
    botReady,
    botUser,
    botUserId,
    appId,
    selectedChannelId,
    guilds,
    users: uniqueUsersFromGuilds(guilds),
    sync,
    error: null
  };
}

module.exports = {
  DEFAULT_MEMBER_LIMIT,
  DEFAULT_USER_CAP,
  CHANNEL_TYPE_NAMES,
  channelCanAnnounce,
  channelIsChatInsight,
  collectionValues,
  serializeChannel,
  serializeMember,
  serializeGuild,
  capMembers,
  uniqueUsersFromGuilds,
  refreshDiscordCaches,
  buildDiscordGuildCatalog
};
