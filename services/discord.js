'use strict';

// Dependencies
const merge = require('lodash.merge');
const qs = require('querystring');
const { Client, Intents } = require('discord.js');

// Fabric Types
const Service = require('@fabric/core/types/service');

/**
 * Discord service for Fabric.
 */
class Discord extends Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      token: null,
      alerts: [],
      scopes: [
        'bot'
      ]
    }, settings);

    // Stores the Discord client
    this.client = new Client(this.settings);

    this._state = {
      status: 'STOPPED'
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
      service.client.once('ready', function () {
        service.emit('ready');
        service.emit('log', `Discord application link: ${service.generateApplicationLink()}`);
        resolve(service);
      });

      service.client.on('message', service._handleClientMessage.bind(service));
      service.client.login(service.settings.token).catch((exception) => {
        service.emit('error', `Discord Internal Exception (DIE): ${exception}`);
        reject(exception);
      });
    });

    return promise;
  }

  async _handleClientMessage (message) {
    const now = (new Date()).toISOString();
    this.emit('log', `Message received: ${message}`);
    if (message.content === '!ping') {
      message.channel.send(`Pong!  Received your ping at ${now}.`);
    }
  }

  async _handleOAuthCallback (req, res, next) {
    res.send('ok');
  }

  async _sendToChannel(channelID, msg) {
    const channel = await this.client.channels.fetch(channelID);
    await channel.send(msg);
  }

  _listChannels () {
    return this.client.channels.cache.keys();
  }

  generateApplicationLink () {
    const params = qs.encode({
      client_id: this.settings.app.id,
      permissions: 0,
      scope: this.settings.scopes.join(',')
    });
    return `https://discord.com/api/oauth2/authorize?${params}`;
  }
}

module.exports = Discord;
