'use strict';

// Dependencies
const fetch = require('cross-fetch');
const merge = require('lodash.merge');
const qs = require('querystring');
const { Client, GatewayIntentBits, SlashCommandBuilder, ChannelType } = require('discord.js');


// Fabric Types
const Actor = require('@fabric/core/types/actor');
const Service = require('@fabric/core/types/service');

const {
  applyVoiceStateUpdate,
  seedActiveVoiceMember,
  flagsFromVoiceState
} = require('../functions/voiceChannelStats');

/**
 * Map discord.js v14 numeric ChannelType values to the legacy string activity
 * contract (`'dm'` / `'text'` / `'news'`). Unknown types pass through.
 * @param {number} channelType
 * @returns {string|number}
 */
function legacyActivityChannelType (channelType) {
  switch (channelType) {
    case ChannelType.DM:
    case ChannelType.GroupDM:
      return 'dm';
    case ChannelType.GuildText:
      return 'text';
    case ChannelType.GuildAnnouncement:
      return 'news';
    case ChannelType.GuildVoice:
      return 'voice';
    case ChannelType.GuildCategory:
      return 'category';
    case ChannelType.GuildForum:
      return 'forum';
    default:
      return channelType;
  }
}

/**
 * Discord service for Fabric.
 */
class Discord extends Service {
  constructor (settings = {}) {
    super(settings);

    const defaults = {
      authority: 'localhost:3040',
      token: null,
      channel: null, // default announce / alert channel id
      app: {
        id: null,
        secret: null
      },
      alerts: [],
      scopes: [
        'bot',
        'identify',
        'guilds',
        'guilds.join'
      ],
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.MessageContent
      ],
      /**
       * When false, skip local !ping/!help/!status/!sync replies so a Fabric
       * consumer can claim DiscordRequest frames without multi-bot collisions.
       */
      autoCommands: true,
      secure: false,
      state: {
        channels: {},
        guilds: {},
        users: {},
        voice: {
          active: {},
          aggregates: {
            channels: {},
            guilds: {}
          }
        }
      }
    };
    this.settings = merge(defaults, settings);
    // lodash.merge arrays by index — caller-supplied lists must replace, not splice.
    if (Array.isArray(settings.intents)) this.settings.intents = settings.intents.slice();
    if (Array.isArray(settings.scopes)) this.settings.scopes = settings.scopes.slice();
    if (Array.isArray(settings.alerts)) this.settings.alerts = settings.alerts.slice();
    if (this.settings.token != null) {
      const trimmed = String(this.settings.token).trim();
      this.settings.token = trimmed || null;
    }

    this.slashCommands = {
      'activate': {
        data: new SlashCommandBuilder().setName('activate').setDescription('Enables the bot in the current channel.'),
        async execute (interaction) {
          await interaction.reply('Enabling...');
        }
      }
    };

    this._onClientError = (error) => { this.emit('error', error); };
    this._onVoiceStateUpdate = (oldState, newState) => {
      this._handleVoiceStateUpdate(oldState, newState).catch((err) => {
        this.emit('error', err);
      });
    };
    this._onClientMessage = this._handleClientMessage.bind(this);
    this._onClientReady = this._onClientReady.bind(this);
    this._clientDestroyed = false;
    this._voiceCommitTimer = null;

    // discord.js Client — intents only (token via login()).
    this.client = this._createClient();

    // Fabric State
    this._state = {
      status: 'STOPPED',
      guilds: {},
      content: this.settings.state
    };

    return this;
  }

  get channels () {
    return Object.values(this._state.content.channels);
  }

  get guilds () {
    return Object.values(this._state.content.guilds);
  }

  /** @returns {Object} Live voice occupancy plus per-channel/guild aggregates (joins, leaves, peaks, totalMemberMs). */
  get voice () {
    return this._ensureVoiceState();
  }

  get routes () {
    return [{
      handler: this._handleOAuthCallback.bind(this),
      method: 'GET',
      path: '/services/discord/authorize'
    }];
  }

  async alert (msg) {
    this.emit('debug', 'Alerting Discord…');
    const channelId = String(this.settings.channel || '').trim();
    if (!channelId) {
      this.emit('warning', 'Discord alert skipped: no settings.channel');
      return null;
    }
    try {
      return await this.postToChannel(channelId, msg);
    } catch (exception) {
      this.emit('error', `Discord alert failed: ${exception}`);
      return null;
    }
  }

  /**
   * Post to a guild/DM channel. Accepts a string, or a discord.js message
   * payload (`{ content, embeds, … }`) so consumers can mirror webhook embeds.
   * @param {string} channelID
   * @param {string|object} msg
   * @returns {Promise<object|null>}
   */
  async postToChannel (channelID, msg) {
    const id = String(channelID || '').trim();
    if (!id) throw new Error('Discord channel id required');
    if (!this.client || !this.client.isReady || !this.client.isReady()) {
      throw new Error('Discord client is not ready');
    }
    const channel = await this.client.channels.fetch(id);
    if (!channel || typeof channel.send !== 'function') {
      throw new Error(`Discord channel not sendable: ${id}`);
    }
    const payload = (typeof msg === 'string')
      ? { content: msg }
      : (msg && typeof msg === 'object' ? msg : { content: String(msg) });
    return channel.send(payload);
  }

  /** @deprecated Prefer {@link postToChannel} */
  async _sendToChannel (channelID, msg) {
    return this.postToChannel(channelID, msg);
  }

  /**
   * Post using the configured default channel (`settings.channel`).
   * @param {string|object} msg
   */
  async post (msg) {
    const channelId = String(this.settings.channel || '').trim();
    if (!channelId) throw new Error('Discord settings.channel required for post()');
    return this.postToChannel(channelId, msg);
  }

  _createClient () {
    return new Client({
      intents: Array.isArray(this.settings.intents) ? this.settings.intents : []
    });
  }

  _attachClientListeners () {
    this.client.on('error', this._onClientError);
    this.client.once('ready', this._onClientReady);
    this.client.on('voiceStateUpdate', this._onVoiceStateUpdate);
    this.client.on('messageCreate', this._onClientMessage);
  }

  _detachClientListeners () {
    if (!this.client) return;
    this.client.removeListener('error', this._onClientError);
    this.client.removeListener('ready', this._onClientReady);
    this.client.removeListener('voiceStateUpdate', this._onVoiceStateUpdate);
    this.client.removeListener('messageCreate', this._onClientMessage);
  }

  async _onClientReady () {
    try {
      await this.sync();
      await this._seedActiveVoiceFromGuilds();
      this._state.status = 'READY';
      this.emit('ready');
    } catch (err) {
      this.emit('error', err);
    }
  }

  async start () {
    // Bot mode: fail closed before wiring the Discord client when no token is configured.
    // Webhook-only consumers should not call start().
    const token = String(this.settings.token || '').trim();
    if (!token) {
      let hint = 'https://discord.com/developers/applications';
      try {
        if (this.settings.app && this.settings.app.id) {
          hint = this.generateApplicationLink();
        }
      } catch (_) {
        // ignore link generation failures; token absence is the security gate
      }
      throw new Error(`Discord token not provided.  Please visit ${hint} to generate a token.`);
    }
    this.settings.token = token;

    if (!this.client || this._clientDestroyed) {
      this.client = this._createClient();
      this._clientDestroyed = false;
    }

    this._detachClientListeners();
    this._attachClientListeners();

    try {
      await this.client.login(token);
    } catch (exception) {
      this.emit('error', `Discord Internal Exception (DIE): ${exception}`);
      throw exception;
    }
    this.emit('log', 'Discord client started.');
    void this.syncGuilds().catch((err) => this.emit('error', err));
    return this;
  }

  async stop () {
    this._state.status = 'STOPPING';
    const pendingVoice = !!this._voiceCommitTimer;
    this._clearVoiceCommitTimer();
    if (pendingVoice) {
      try { await this.commit(); } catch (err) { this.emit('error', err); }
    }
    this._detachClientListeners();
    try {
      if (this.client && typeof this.client.destroy === 'function') {
        await this.client.destroy();
      }
    } catch (err) {
      this.emit('error', err);
    }
    this._clientDestroyed = true;
    this._state.status = 'STOPPED';
    this.emit('stopped');
    return this;
  }

  async _handleClientMessage (message) {
    if (message.author.bot) return; // ignore bots

    const now = (new Date()).toISOString();
    const isDm = message.channel.type === ChannelType.DM;
    // Do not write DM bodies / usernames at default log verbosity.
    this.emit('debug', isDm
      ? `${now} discord dm from ${message.author.id} (${String(message.content || '').length} chars)`
      : `${now} ${message.author.username}: ${message.content}`);

    // ## Fabric API
    // Interact with the Fabric network using a local, message-based API.
    // Activity Stream
    const actor = new Actor({ name: `discord/users/${message.author.id}` });
    const target = new Actor({ name: `discord/channels/${message.channel.id}` });

    // Sensemaker / GoonCitizen expect legacy strings (`'dm'` / `'text'`), not
    // discord.js v14 numeric ChannelType values (DM === 1, GuildText === 0).
    const targetType = legacyActivityChannelType(message.channel.type);

    // Standard Activity Object (emit before local commands so coordinators can claim).
    this.emit('activity', {
      type: 'DiscordMessage',
      actor: {
        id: actor.id,
        username: message.author.username,
        ref: message.author.id // TODO: change name to "upstream ID" (UID)?
      },
      object: {
        id: message.id,
        content: message.content,
        created: message.createdTimestamp
      },
      target: {
        id: target.id,
        name: message.channel.name, // is undefined in case of DM
        type: targetType,
        ref: message.channel.id // TODO: change name to "upstream ID" (UID)?
      }
    });

    // Standalone Commands — optional; disable when Fabric claim coordination owns replies.
    if (this.settings.autoCommands === false) return;

    if (message.content === '!ping') {
      return message.channel.send(`Pong!  Received your ping at ${now}.`);
    }

    if (message.content === '!help') {
      return message.channel.send('I am a bot!  I can help you with things.');
    }

    if (message.content === '!status') {
      return message.channel.send('I am alive and well!');
    }

    if (message.content === '!sync') {
      return this.sync();
    }
  }

  async _handleOAuthCallback (req, res) {
    // Fail closed: no `state` + no code exchange yet. Do not claim success.
    const payload = {
      status: 'error',
      message: 'Discord OAuth callback is not implemented'
    };
    if (res && typeof res.status === 'function') {
      if (typeof res.json === 'function') return res.status(501).json(payload);
      return res.status(501).send(payload.message);
    }
    if (res && typeof res.send === 'function') return res.send(payload.message);
  }

  _ensureVoiceState () {
    const c = this._state.content;
    if (!c.voice) {
      c.voice = {
        active: {},
        aggregates: { channels: {}, guilds: {} }
      };
    }
    if (!c.voice.active) c.voice.active = {};
    if (!c.voice.aggregates) c.voice.aggregates = { channels: {}, guilds: {} };
    if (!c.voice.aggregates.channels) c.voice.aggregates.channels = {};
    if (!c.voice.aggregates.guilds) c.voice.aggregates.guilds = {};
    return c.voice;
  }

  async _seedActiveVoiceFromGuilds () {
    const voice = this._ensureVoiceState();
    const now = Date.now();
    for (const guild of this.client.guilds.cache.values()) {
      for (const vs of guild.voiceStates.cache.values()) {
        if (!vs.channelId) continue;
        const ch = guild.channels.cache.get(vs.channelId);
        const slice = {
          channelId: vs.channelId,
          guildId: guild.id,
          userId: vs.id,
          flags: flagsFromVoiceState(vs)
        };
        seedActiveVoiceMember(voice, slice, now, ch?.name ?? null);
      }
    }
    await this.commit();
    this.emit('log', 'Seeded active voice channels from cache.');
    return this;
  }

  async _handleVoiceStateUpdate (oldState, newState) {
    const voice = this._ensureVoiceState();
    const now = Date.now();
    const userId = newState.id;
    const newChannelId = newState.channelId;
    const channelName = newChannelId
      ? (newState.guild.channels.cache.get(newChannelId)?.name ?? newState.channel?.name ?? null)
      : null;

    const oldSlice = {
      channelId: oldState.channelId,
      guildId: oldState.guild.id,
      userId,
      flags: flagsFromVoiceState(oldState)
    };
    const newSlice = {
      channelId: newState.channelId,
      guildId: newState.guild.id,
      userId,
      flags: flagsFromVoiceState(newState)
    };

    const result = applyVoiceStateUpdate(voice, oldSlice, newSlice, now, channelName);
    if (!result.changed) return;

    this.emit('voice', {
      guildId: newSlice.guildId,
      userId,
      oldChannelId: oldSlice.channelId,
      newChannelId: newSlice.channelId,
      kind: result.kind,
      channelName
    });

    // Session join/leave/move persists immediately. Mute/deafen/stream flags
    // are high-frequency; coalesce those commits so busy guilds do not write
    // full state on every toggle.
    if (result.kind === 'session') {
      await this._flushVoiceCommit();
    } else {
      this._scheduleVoiceCommit();
    }
  }

  _clearVoiceCommitTimer () {
    if (!this._voiceCommitTimer) return;
    clearTimeout(this._voiceCommitTimer);
    this._voiceCommitTimer = null;
  }

  _scheduleVoiceCommit (delay = 5000) {
    if (this._voiceCommitTimer) return;
    this._voiceCommitTimer = setTimeout(() => {
      this._voiceCommitTimer = null;
      Promise.resolve(this.commit()).catch((exception) => {
        this.emit('error', `Discord voice commit failed: ${exception}`);
      });
    }, delay);
    if (typeof this._voiceCommitTimer.unref === 'function') this._voiceCommitTimer.unref();
  }

  async _flushVoiceCommit () {
    this._clearVoiceCommitTimer();
    await this.commit();
  }

  async exchangeCodeForToken (code) {
    const scheme = this.settings.secure ? 'https' : 'http';
    const params = {
      client_id: this.settings.app.id,
      client_secret: this.settings.app.secret,
      code: code,
      grant_type: 'authorization_code',
      scope: 'identify',
      redirect_uri: `${scheme}://${this.settings.authority}/services/discord/authorize`
    };

    let response;
    try {
      response = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: qs.encode(params)
      });
    } catch (exception) {
      console.error('Could not fetch token:', exception);
      throw exception;
    }
    if (!response || !response.ok) {
      const status = response ? response.status : 'no-response';
      throw new Error(`Discord OAuth token exchange failed (${status})`);
    }
    return response.json();
  }

  async getTokenUser (token) {
    let response;
    try {
      response = await fetch('https://discord.com/api/oauth2/@me', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
    } catch (exception) {
      console.error('Could not fetch user:', exception);
      throw exception;
    }
    if (!response || !response.ok) {
      const status = response ? response.status : 'no-response';
      throw new Error(`Discord OAuth user lookup failed (${status})`);
    }
    const body = await response.json();
    return body && body.user ? body.user : null;
  }

  async sync () {
    this.emit('log', 'Syncing Discord service...');
    await this.syncGuilds();
    return this;
  }

  async syncAllChannels () {
    const channels = await this._listChannels();
    for (let i = 0; i < channels.length; i++) {
      const channel = channels[i];
      this._state.content.channels[channel.id] = {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        guild: channel.guild.id
      };
      const members = await this.listChannelMembers(channel.id);
      this.emit('debug', `Discord channel ${channel.id} has ${members.length} members.`);
    }
    await this.commit();
    return this;
  }

  async syncGuilds () {
    const guilds = await this._listGuilds();
    for (let i = 0; i < guilds.length; i++) {
      const guild = guilds[i];
      this._state.content.guilds[guild.id] = {
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        channels: guild.channels.cache.map(channel => channel.id),
        members: guild.members.cache.map(member => member.id)
      };
    }
    await this.commit();
    return this;
  }

  async _listChannels () {
    const channels = [];
    const guilds = await this._listGuilds();
    for (let i = 0; i < guilds.length; i++) {
      const guild = guilds[i];
      const these = guild.channels.cache.map(channel => channel);
      channels.push(...these);
    }
    return channels;
  }

  async _listGuilds () {
    return this.client.guilds.cache.map(guild => guild);
  }

  async _listGuildMembers (guildID) {
    return this.listGuildMembers(guildID);
  }

  async listGuildMembers (guildID) {
    const guild = await this.client.guilds.fetch(guildID);
    // discord.js v14: members is a GuildMemberManager — use .cache
    return Array.from(guild.members.cache.values());
  }

  async listChannelMembers (channelID) {
    let channel;
    try {
      channel = await this.client.channels.fetch(channelID);
    } catch (error) {
      console.error('Could not fetch channel:', error);
      throw error;
    }
    if (!channel) throw new Error('Channel not found.');
    if (!channel.members || typeof channel.members.values !== 'function') {
      // Text channels may not expose a member collection the same way as voice.
      return [];
    }
    return Array.from(channel.members.values());
  }

  generateApplicationLink () {
    const params = qs.encode({
      client_id: this.settings.app.id,
      permissions: 0,
      scope: this.settings.scopes.join(' ')
    });

    return `https://discord.com/api/oauth2/authorize?${params}`;
  }

  generateAuthorizeLink () {
    const scheme = this.settings.secure ? 'https' : 'http';
    const params = qs.encode({
      client_id: this.settings.app.id,
      permissions: 0,
      redirect_uri: `${scheme}://${this.settings.authority}/services/discord/authorize`,
      scope: ['identify'].join(' '),
      response_type: 'code'
    });

    return `https://discord.com/oauth2/authorize?${params}`;
  }
}

Discord.legacyActivityChannelType = legacyActivityChannelType;

module.exports = Discord;
