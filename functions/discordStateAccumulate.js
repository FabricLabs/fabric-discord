'use strict';

/**
 * Accumulate Discord guild / channel / user observations into service state.
 * Consumers (Sensemaker HTTP, GoonCitizen Store fold) can read a stable tip
 * without re-walking the live discord.js Client.
 */

const {
  serializeChannel,
  serializeMember,
  serializeGuild,
  uniqueUsersFromGuilds,
  DEFAULT_MEMBER_LIMIT,
  DEFAULT_USER_CAP
} = require('./discordCatalog');

const STORE_CHANNEL_CAP = 400;
const STORE_MEMBER_CAP = 2000;
const STORE_GUILD_CAP = 100;
const STORE_USER_CAP = DEFAULT_USER_CAP;

/**
 * @param {unknown} value
 * @returns {string}
 */
function isoNow (value) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/**
 * @param {unknown} incoming
 * @param {unknown} prev
 * @param {string} fallback
 * @returns {string}
 */
function pickName (incoming, prev, fallback) {
  const next = incoming != null && String(incoming).trim() ? String(incoming).trim() : '';
  if (next) return next;
  const old = prev != null && String(prev).trim() ? String(prev).trim() : '';
  return old || fallback;
}

/**
 * Ensure content maps exist on Discord service state.
 * @param {object} content — `_state.content`
 * @returns {object}
 */
function ensureContentMaps (content) {
  if (!content || typeof content !== 'object') {
    return { channels: {}, guilds: {}, users: {} };
  }
  if (!content.channels || typeof content.channels !== 'object') content.channels = {};
  if (!content.guilds || typeof content.guilds !== 'object') content.guilds = {};
  if (!content.users || typeof content.users !== 'object') content.users = {};
  return content;
}

/**
 * @param {Array|object|undefined} prevList
 * @param {Array|undefined} incomingList
 * @param {Function} sanitize
 * @param {number} cap
 * @returns {Array<object>}
 */
function mergeById (prevList, incomingList, sanitize, cap) {
  const byId = new Map();
  const prevArr = Array.isArray(prevList)
    ? prevList
    : (prevList && typeof prevList === 'object'
      ? Object.values(prevList)
      : []);
  for (const row of prevArr) {
    const clean = sanitize(row);
    if (clean && clean.id) byId.set(String(clean.id), clean);
  }
  for (const row of incomingList || []) {
    const clean = sanitize(row);
    if (!clean || !clean.id) continue;
    const id = String(clean.id);
    const prev = byId.get(id);
    byId.set(id, prev ? Object.assign({}, prev, clean) : clean);
  }
  let out = Array.from(byId.values());
  if (Number.isFinite(cap) && out.length > cap) {
    out.sort((a, b) => String(b.seenAt || b.updatedAt || '').localeCompare(String(a.seenAt || a.updatedAt || '')));
    out = out.slice(0, cap);
  }
  out.sort((a, b) => {
    const an = String((a && (a.displayName || a.name || a.username)) || '').toLowerCase();
    const bn = String((b && (b.displayName || b.name || b.username)) || '').toLowerCase();
    if (an !== bn) return an.localeCompare(bn);
    const ap = Number.isFinite(Number(a && a.position)) ? Number(a.position) : 0;
    const bp = Number.isFinite(Number(b && b.position)) ? Number(b.position) : 0;
    if (ap !== bp) return ap - bp;
    return String(a.id).localeCompare(String(b.id));
  });
  return out;
}

/**
 * @param {object} channel
 * @returns {object|null}
 */
function sanitizeChannelRow (channel) {
  if (!channel || channel.id == null) return null;
  if (channel.typeName != null || channel.canAnnounce != null || channel.chatInsight != null) {
    return {
      id: String(channel.id),
      name: String(channel.name || channel.id),
      type: channel.type != null ? Number(channel.type) : -1,
      typeName: channel.typeName != null ? String(channel.typeName) : undefined,
      parentId: channel.parentId != null ? String(channel.parentId) : null,
      position: Number.isFinite(Number(channel.position)) ? Number(channel.position) : 0,
      canAnnounce: channel.canAnnounce === true,
      chatInsight: channel.chatInsight === true,
      guildId: channel.guildId != null
        ? String(channel.guildId)
        : (channel.guild != null ? String(channel.guild) : null)
    };
  }
  return serializeChannel(channel);
}

/**
 * @param {object} member
 * @param {string} [seenAt]
 * @returns {object|null}
 */
function sanitizeMemberRow (member, seenAt) {
  const row = (member && member.username != null && member.id != null)
    ? {
      id: String(member.id),
      username: String(member.username),
      displayName: String(member.displayName || member.username),
      bot: member.bot === true,
      status: member.status != null ? String(member.status) : null,
      avatar: member.avatar != null ? String(member.avatar) : null,
      roles: Array.isArray(member.roles) ? member.roles.map(String) : undefined
    }
    : serializeMember(member);
  if (!row) return null;
  row.seenAt = isoNow((member && member.seenAt) || seenAt);
  return row;
}

/**
 * Fold one guild snapshot into content.guilds (union-merge).
 * @param {object} content
 * @param {object} incoming — serializeGuild-shaped or discord.js Guild
 * @param {Object} [opts]
 * @param {number} [opts.memberLimit]
 * @returns {object|null}
 */
function foldGuild (content, incoming, opts = {}) {
  const maps = ensureContentMaps(content);
  const snap = (incoming && Array.isArray(incoming.channels))
    ? incoming
    : serializeGuild(incoming, { memberLimit: opts.memberLimit });
  if (!snap || snap.id == null) return null;
  const id = String(snap.id);
  const prev = maps.guilds[id] || null;
  const observedAt = isoNow(opts.observedAt || snap.observedAt || snap.updatedAt);
  const channels = mergeById(
    (prev && prev.channels) || [],
    snap.channels || [],
    (ch) => sanitizeChannelRow(ch),
    STORE_CHANNEL_CAP
  );
  const members = mergeById(
    (prev && prev.members) || [],
    snap.members || [],
    (m) => sanitizeMemberRow(m, observedAt),
    STORE_MEMBER_CAP
  );
  const listed = members.length;
  const memberCount = Math.max(
    Number(prev && prev.memberCount) || 0,
    Number(snap.memberCount) || 0,
    listed
  );
  const row = {
    id,
    name: pickName(snap.name, prev && prev.name, id),
    icon: snap.icon != null ? snap.icon : ((prev && prev.icon) || null),
    memberCount,
    truncated: listed < memberCount,
    channels,
    members,
    updatedAt: observedAt,
    observedAt
  };
  maps.guilds[id] = row;
  for (const ch of channels) {
    if (!ch || !ch.id) continue;
    foldChannel(maps, Object.assign({}, ch, { guildId: id }), { observedAt, skipGuild: true });
  }
  for (const m of members) {
    if (!m || !m.id) continue;
    foldUser(maps, m, { observedAt });
  }
  pruneMap(maps.guilds, STORE_GUILD_CAP, (g) => g && (g.updatedAt || g.observedAt));
  return row;
}

/**
 * @param {object} content
 * @param {object} incoming
 * @param {Object} [opts]
 * @returns {object|null}
 */
function foldChannel (content, incoming, opts = {}) {
  const maps = ensureContentMaps(content);
  const snap = sanitizeChannelRow(incoming);
  if (!snap || !snap.id) return null;
  const id = String(snap.id);
  const prev = maps.channels[id] || null;
  const observedAt = isoNow(opts.observedAt);
  const guildId = snap.guildId || (prev && prev.guild) || (prev && prev.guildId) || null;
  const row = {
    id,
    name: pickName(snap.name, prev && prev.name, id),
    type: snap.type != null ? snap.type : ((prev && prev.type) != null ? prev.type : -1),
    typeName: snap.typeName || (prev && prev.typeName) || undefined,
    parentId: snap.parentId != null ? snap.parentId : ((prev && prev.parentId) || null),
    position: Number.isFinite(Number(snap.position))
      ? Number(snap.position)
      : (Number(prev && prev.position) || 0),
    canAnnounce: snap.canAnnounce === true || (prev && prev.canAnnounce) === true,
    chatInsight: snap.chatInsight === true || (prev && prev.chatInsight) === true,
    guild: guildId,
    guildId,
    updatedAt: observedAt
  };
  if (Array.isArray(incoming.members) && incoming.members.length) {
    row.members = mergeById(
      (prev && prev.members) || [],
      incoming.members,
      (m) => sanitizeMemberRow(m, observedAt),
      DEFAULT_MEMBER_LIMIT
    );
  } else if (prev && Array.isArray(prev.members)) {
    row.members = prev.members;
  }
  maps.channels[id] = row;
  pruneMap(maps.channels, STORE_CHANNEL_CAP, (c) => c && c.updatedAt);
  if (!opts.skipGuild && guildId && maps.guilds[guildId]) {
    const g = maps.guilds[guildId];
    g.channels = mergeById(g.channels || [], [row], (ch) => sanitizeChannelRow(ch), STORE_CHANNEL_CAP);
    g.updatedAt = observedAt;
  }
  return row;
}

/**
 * @param {object} content
 * @param {object} incoming
 * @param {Object} [opts]
 * @returns {object|null}
 */
function foldUser (content, incoming, opts = {}) {
  const maps = ensureContentMaps(content);
  const snap = sanitizeMemberRow(incoming, opts.observedAt);
  if (!snap || !snap.id) return null;
  const id = String(snap.id);
  const prev = maps.users[id] || null;
  const row = prev ? Object.assign({}, prev, snap) : snap;
  maps.users[id] = row;
  pruneMap(maps.users, STORE_USER_CAP, (u) => u && u.seenAt);
  return row;
}

/**
 * Fold a message author / channel observation (chat path).
 * @param {object} content
 * @param {object} obs
 * @returns {object|null} updated guild row when guildId known
 */
function foldMessageObservation (content, obs) {
  if (!content || !obs) return null;
  const maps = ensureContentMaps(content);
  const observedAt = isoNow(obs.observedAt || obs.ts || obs.createdTimestamp);
  let guildId = obs.guildId != null ? String(obs.guildId).trim() : '';
  const channelId = obs.channelId != null ? String(obs.channelId).trim() : '';
  if (!guildId && channelId && maps.channels[channelId]) {
    guildId = String(maps.channels[channelId].guildId || maps.channels[channelId].guild || '');
  }
  if (channelId) {
    foldChannel(maps, {
      id: channelId,
      name: obs.channelName || channelId,
      type: obs.channelType != null ? obs.channelType : 0,
      guildId: guildId || null
    }, { observedAt });
  }
  const member = obs.member || (obs.authorId
    ? {
      id: obs.authorId,
      username: obs.authorUsername || obs.authorId,
      displayName: obs.authorUsername || obs.authorId,
      bot: !!obs.bot
    }
    : null);
  if (member) foldUser(maps, member, { observedAt });
  if (!guildId) return null;
  return foldGuild(maps, {
    id: guildId,
    name: obs.guildName || undefined,
    channels: channelId
      ? [{
        id: channelId,
        name: obs.channelName || channelId,
        type: obs.channelType != null ? obs.channelType : 0,
        guildId
      }]
      : [],
    members: member ? [member] : [],
    memberCount: 0
  }, { observedAt, memberLimit: STORE_MEMBER_CAP });
}

/**
 * @param {object} map
 * @param {number} cap
 * @param {Function} stampFn
 */
function pruneMap (map, cap, stampFn) {
  const keys = Object.keys(map || {});
  if (keys.length <= cap) return;
  keys.sort((a, b) => {
    const as = String(stampFn(map[a]) || '');
    const bs = String(stampFn(map[b]) || '');
    return as.localeCompare(bs);
  });
  const drop = keys.length - cap;
  for (let i = 0; i < drop; i++) delete map[keys[i]];
}

/**
 * Build a catalog-shaped object from accumulated service content.
 * @param {object} content
 * @param {Object} [opts]
 * @returns {object}
 */
function catalogFromContent (content, opts = {}) {
  const maps = ensureContentMaps(content);
  const guilds = Object.values(maps.guilds)
    .filter((g) => g && g.id != null)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const users = Object.keys(maps.users).length
    ? Object.values(maps.users).filter((u) => u && u.id != null)
    : uniqueUsersFromGuilds(guilds);
  return {
    botReady: opts.botReady === true,
    botUser: opts.botUser != null ? String(opts.botUser) : null,
    botUserId: opts.botUserId != null ? String(opts.botUserId) : null,
    appId: opts.appId != null ? String(opts.appId) : null,
    selectedChannelId: opts.selectedChannelId != null
      ? String(opts.selectedChannelId).trim() || null
      : null,
    guilds,
    users: Array.isArray(users) ? users.slice(0, STORE_USER_CAP) : [],
    sync: opts.sync || null,
    error: opts.error != null ? opts.error : null,
    source: 'state'
  };
}

/**
 * Apply a live buildDiscordGuildCatalog result into content maps.
 * @param {object} content
 * @param {object} catalog
 * @returns {object[]} folded guild rows
 */
function foldCatalog (content, catalog) {
  const out = [];
  if (!catalog || !Array.isArray(catalog.guilds)) return out;
  for (const g of catalog.guilds) {
    const row = foldGuild(content, g);
    if (row) out.push(row);
  }
  for (const u of catalog.users || []) {
    foldUser(content, u);
  }
  return out;
}

module.exports = {
  STORE_CHANNEL_CAP,
  STORE_MEMBER_CAP,
  STORE_GUILD_CAP,
  STORE_USER_CAP,
  ensureContentMaps,
  mergeById,
  foldGuild,
  foldChannel,
  foldUser,
  foldMessageObservation,
  foldCatalog,
  catalogFromContent,
  isoNow
};
