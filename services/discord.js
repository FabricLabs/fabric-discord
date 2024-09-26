'use strict';

// Dependencies
const fetch = require('cross-fetch');
const merge = require('lodash.merge');
const qs = require('querystring');
const { Client, Intents } = require('discord.js');

// Fabric Types
const Actor = require('@fabric/core/types/actor');
const Service = require('@fabric/core/types/service');

/**
 * Discord service for Fabric.
 */
class Discord extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      authority: 'localhost:3040',
      token: null,
      alerts: [],
      scopes: [
        'bot',
        'identify',
        'guilds',
        'guilds.join'
      ],
      intents: ['GUILDS', 'GUILD_MESSAGES', 'GUILD_MESSAGE_REACTIONS', 'DIRECT_MESSAGES'],
      secure: false
    }, settings);

    // Stores the Discord client
    this.client = new Client(this.settings);

    this._state = {
      status: 'STOPPED',
      guilds: {},
    };

    return this;
  }

  get routes () {
    return [{
      handler: this._handleOAuthCallback.bind(this),
      method: 'GET',
      path: '/services/discord/authorize'
    }];
  }

  async alert (msg) {
    console.warn('Alerting Discord: ', msg);
  }

  async start () {
    const service = this;
    const promise = new Promise((resolve, reject) => {
      service.client.once('ready', async function () {
        await service.sync();
        service.emit('ready');
      });

      // Handle messages
      service.client.on('message', service._handleClientMessage.bind(service));
      service.client.on('messageCreate', service._handleClientMessage.bind(service));

      if (!service.settings.token) {
        const link = this.generateApplicationLink();
        service.emit('error', `Discord token not provided.  Please visit ${link} to generate a token.`);
        return reject(new Error('Discord token not provided.'));
      }

      service.client.login(service.settings.token).catch((exception) => {
        service.emit('error', `Discord Internal Exception (DIE): ${exception}`);
        reject(exception);
      }).then(() => {
        service.emit('log', 'Discord client started.');
        const guilds = service.client.guilds.cache.map(guild => guild.id);
        service._state.guilds = guilds;
        service.emit('log', `Discord guilds: ${guilds}`);
        resolve(service);
      });
    });

    return promise;
  }

  async _handleClientMessage (message) {
    if (message.author.bot) return; // ignore bots

    const now = (new Date()).toISOString();
    this.emit('log', `${now} ${message.author.username}: ${message.content}`);

    // Standalone Commands
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

    // ## Fabric API
    // Interact with the Fabric network using a local, message-based API.
    // Activity Stream
    const actor = new Actor({ name: `discord/users/${message.author.id}` });
    const target = new Actor({ name: `discord/channels/${message.channel.id}` });

    // Standard Activity Object
    this.emit('activity', {
      type: 'DiscordMessage',
      actor: {
        id: actor.id,
        username: message.author.username,
        ref: message.author.id // TODO: change name to "upstream ID" (UID)?
      },
      object: {
        content: message.content,
        created: message.createdTimestamp,
      },
      target: {
        id: target.id,
        name: message.channel.name, // is undefined in case of DM
        type: message.channel.type,
        ref: message.channel.id // TODO: change name to "upstream ID" (UID)?
      }
    });
  }

  async _handleOAuthCallback (req, res, next) {
    res.send('ok');
  }

  async _sendToChannel (channelID, msg) {
    const channel = await this.client.channels.fetch(channelID);
    await channel.send(msg);
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
    console.debug('guilds cache:', guilds);

    this._state.guilds = guilds;

    await this.commit();

    return this;
  }

  _listChannels () {
    return this.client.channels.cache.keys();
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
