'use strict';

const merge = require('lodash.merge');
const Service = require('@fabric/core/types/service');

class Discord extends Service {
  constructor (settings = {}) {
    super(settings);
    this.settings = merge({}, this.settings, settings);

    // Stores the Discord client
    this.client = null;
    return this;
  }
}

module.exports = Discord;