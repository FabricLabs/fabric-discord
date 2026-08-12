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
 * Discord service for Fabric.
 */
class Discord extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
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
    }, settings);

    this.slashCommands = {
      'activate': {
        data: new SlashCommandBuilder().setName('activate').setDescription('Enables the bot in the current channel.'),
        async execute (interaction) {
          await interaction.reply('Enabling...');
        }
      }
    };

    // discord.js Client — intents only (token via login()).
    this.client = new Client({
      intents: Array.isArray(this.settings.intents) ? this.settings.intents : []
    });

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
    return this.postToChannel(channelId, msg);
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

  async start () {
    const service = this;
    // Fail closed before wiring the Discord client when no bot token is configured.
    if (!service.settings.token) {
      let hint = 'https://discord.com/developers/applications';
      try {
        if (service.settings.app && service.settings.app.id) {
          hint = service.generateApplicationLink();
        }
      } catch (_) {
        // ignore link generation failures; token absence is the security gate
      }
      service.emit('error', `Discord token not provided.  Please visit ${hint} to generate a token.`);
      throw new Error('Discord token not provided.');
    }

    const promise = new Promise((resolve, reject) => {
      service.client.on('error', (error) => {
        this.emit('error', error);
      });

      service.client.once('ready', async function () {
        await service.sync();
        await service._seedActiveVoiceFromGuilds();
        service._state.status = 'READY';
        service.emit('ready');
      });

      service.client.on('voiceStateUpdate', (oldState, newState) => {
        service._handleVoiceStateUpdate(oldState, newState).catch((err) => {
          service.emit('error', err);
        });
      });

      // Handle messages
      service.client.on('message', service._handleClientMessage.bind(service));
      service.client.on('messageCreate', service._handleClientMessage.bind(service));

      service.client.login(service.settings.token).catch((exception) => {
        service.emit('error', `Discord Internal Exception (DIE): ${exception}`);
        reject(exception);
      }).then(() => {
        service.emit('log', 'Discord client started.');
        this.syncGuilds();
        resolve(service);
      });
    });

    return promise;
  }

  async stop () {
    this._state.status = 'STOPPING';
    try {
      if (this.client && typeof this.client.destroy === 'function') {
        await this.client.destroy();
      }
    } catch (err) {
      this.emit('error', err);
    }
    this._state.status = 'STOPPED';
    this.emit('stopped');
    return this;
  }

  async _handleClientMessage (message) {
    if (message.author.bot) return; // ignore bots

    const now = (new Date()).toISOString();
    this.emit('log', `${now} ${message.author.username}: ${message.content}`);

    // ## Fabric API
    // Interact with the Fabric network using a local, message-based API.
    // Activity Stream
    const actor = new Actor({ name: `discord/users/${message.author.id}` });
    const target = new Actor({ name: `discord/channels/${message.channel.id}` });

    // Sensemaker (and other consumers) expect `type: 'dm'` for DMs — discord.js v14 uses numeric ChannelType (DM === 1).
    const targetType = message.channel.type === ChannelType.DM ? 'dm' : message.channel.type;

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

  async _handleOAuthCallback (req, res, next) {
    res.send('ok');
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

    await this.commit();
  }

  async exchangeCodeForToken (code) {
    const params = {
      client_id: this.settings.app.id,
      client_secret: this.settings.app.secret,
      code: code,
      grant_type: 'authorization_code',
      scope: 'identify',
      redirect_uri: `http://${this.settings.authority}/services/discord/authorize`,
    };

    const token = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: qs.encode(params)
    }).catch((exception) => {
      console.error('Could not fetch token:', exception);
    }).then(response => response.json());

    return token;
  }

  async getTokenUser (token) {
    const response = await fetch('https://discord.com/api/oauth2/@me', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }).catch((exception) => {
      console.error('Could not fetch user:', exception);
    }).then(response => response.json());

    return response.user;
  }

  async sync () {
    this.emit('log', 'Syncing Discord service...');
    const guilds = this.client.guilds.cache.map(guild => guild);
    this._state.guilds = guilds;
    await this.commit();
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
      console.debug('channel members:', members);
    }
    this.commit();
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
    this.commit();
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
    console.debug('listing guild members:', guildID);
  }

  async listGuildMembers (guildID) {
    const guild = await this.client.guilds.fetch(guildID);
    return Object.values(guild.members);
  }

  async listChannelMembers (channelID) {
    return new Promise((resolve, reject) => {
      this.client.channels.fetch(channelID).catch((error) => {
        console.error('Could not fetch channel:', error);
      }).then((channel) => {
        if (!channel) return reject(new Error('Channel not found.'));
        resolve(Object.values(channel.members));
      });
    });
  }

  generateApplicationLink () {
    const params = qs.encode({
      client_id: this.settings.app.id,
      permissions: 0,
      // redirect_uri: `http://${this.settings.authority}/services/discord/authorize`,
      scope: this.settings.scopes.join(',')
    });

    return `http://discord.com/api/oauth2/authorize?${params}`;
  }

  generateAuthorizeLink () {
    const params = qs.encode({
      client_id: this.settings.app.id,
      permissions: 0,
      redirect_uri: `http${(this.settings.secure) ? 's' : ''}://${this.settings.authority}/services/discord/authorize`,
      scope: ['identify'].join(','),
      response_type: 'code'
    });

    return `https://discord.com/oauth2/authorize?${params}`;
  }
}

module.exports = Discord;
