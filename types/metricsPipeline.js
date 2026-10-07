'use strict';

const EventEmitter = require('events');
const { matchesAnyChannel } = require('../functions/channelMatcher');

const STORE_PREFIX = '/metrics/plugins/';

/**
 * Operation-scoped metrics built from Discord service events by plugins.
 *
 * An operation is `{ id, name?, guildId?, channels?, metrics? }`. `metrics`
 * lists the plugins that report for it — plugin names, or objects
 * `{ plugin, channels?, guildId?, ...options }` whose `channels` (channel
 * matchers, see functions/channelMatcher) override the operation's.
 * Omitting `metrics` enables every registered plugin.
 *
 * A plugin is:
 *   {
 *     name: 'voice',
 *     intents: ['Guilds', 'GuildVoiceStates'],   // discord.js GatewayIntentBits names
 *     init () { return {} },                     // fresh persisted state
 *     on: { ready (event, ctx) {}, voice (event, ctx) {}, tick (event, ctx) {} },
 *     report (state, operation, entry, ctx) { return { ... } }
 *   }
 * Handlers mutate `ctx.state`; the pipeline persists each plugin's state in
 * the Fabric Store at `/metrics/plugins/<name>`.
 */
class MetricsPipeline extends EventEmitter {
  /**
   * @param {Object} [settings]
   * @param {Object} settings.store Fabric Store (`get` / `set`), already started
   * @param {Array<Object>} [settings.operations]
   * @param {Array<Object>} [settings.plugins]
   * @param {number} [settings.flushMs] debounce for Store writes (default 5s)
   * @param {number} [settings.tickMs] `tick` interval for checkpointing (default 60s; 0 disables)
   * @param {Function} [settings.now] clock (default Date.now)
   */
  constructor (settings = {}) {
    super();
    this.settings = Object.assign({
      store: null,
      operations: [],
      plugins: [],
      flushMs: 5000,
      tickMs: 60000,
      now: () => Date.now()
    }, settings);
    this.plugins = new Map();
    this.states = new Map();
    this.operations = [];
    this.source = null;
    this._dirty = new Set();
    this._listeners = [];
    this._flushTimer = null;
    this._tickTimer = null;
    this._queue = Promise.resolve();
    for (const plugin of this.settings.plugins) this.use(plugin);
    this.setOperations(this.settings.operations);
  }

  /**
   * Union of the gateway intents (GatewayIntentBits names) every plugin needs.
   * @returns {string[]}
   */
  get intents () {
    const names = new Set();
    for (const plugin of this.plugins.values()) (plugin.intents || []).forEach((n) => names.add(n));
    return Array.from(names);
  }

  /**
   * @param {Object} plugin
   * @returns {MetricsPipeline}
   */
  use (plugin) {
    if (!plugin || typeof plugin.name !== 'string' || !plugin.name) throw new Error('Metrics plugin needs a name');
    if (!/^[a-z0-9-]+$/i.test(plugin.name)) throw new Error(`Invalid metrics plugin name: ${plugin.name}`);
    this.plugins.set(plugin.name, plugin);
    return this;
  }

  /**
   * @param {Array<Object>} operations
   * @returns {MetricsPipeline}
   */
  setOperations (operations) {
    this.operations = (operations || [])
      .filter((op) => op && op.id)
      .map((op) => {
        const entries = (Array.isArray(op.metrics) ? op.metrics : Array.from(this.plugins.keys()))
          .map((entry) => (typeof entry === 'string' ? { plugin: entry } : Object.assign({}, entry)))
          .filter((entry) => entry.plugin)
          .map((entry) => Object.assign(entry, {
            channels: Array.isArray(entry.channels) ? entry.channels : (op.channels || []),
            guildId: entry.guildId != null ? String(entry.guildId) : (op.guildId != null ? String(op.guildId) : null)
          }));
        return Object.assign({}, op, { id: String(op.id), metrics: entries });
      });
    return this;
  }

  /**
   * Operations (with their metrics entry) a plugin should credit for a channel.
   * @param {string} pluginName
   * @param {{ id?: string, name?: string, guildId?: string }} channel
   * @returns {Array<{ operation: Object, entry: Object }>}
   */
  operationsFor (pluginName, channel) {
    const hits = [];
    for (const operation of this.operations) {
      for (const entry of operation.metrics) {
        if (entry.plugin !== pluginName) continue;
        if (entry.guildId && channel.guildId && String(channel.guildId) !== entry.guildId) continue;
        if (matchesAnyChannel(entry.channels, channel)) hits.push({ operation, entry });
      }
    }
    return hits;
  }

  async start () {
    const store = this.settings.store;
    if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
      throw new Error('MetricsPipeline needs a started Fabric Store');
    }
    for (const plugin of this.plugins.values()) {
      let state = null;
      try { state = await store.get(STORE_PREFIX + plugin.name); } catch (_) { state = null; }
      this.states.set(plugin.name, state && typeof state === 'object' ? state : this._init(plugin));
    }
    if (this.settings.tickMs > 0) {
      this._tickTimer = setInterval(() => this.tick().catch((err) => this.emit('error', err)), this.settings.tickMs);
      if (typeof this._tickTimer.unref === 'function') this._tickTimer.unref();
    }
    return this;
  }

  async stop () {
    if (this._tickTimer) clearInterval(this._tickTimer);
    this._tickTimer = null;
    this.detach();
    await this.tick();
    await this.flush();
    return this;
  }

  /**
   * Subscribe to a Discord service (or any EventEmitter with the same events).
   * @param {EventEmitter} source
   * @returns {MetricsPipeline}
   */
  attach (source) {
    this.detach();
    this.source = source;
    const events = new Set();
    for (const plugin of this.plugins.values()) {
      Object.keys(plugin.on || {}).filter((name) => name !== 'tick').forEach((name) => events.add(name));
    }
    for (const name of events) {
      const handler = (payload) => this.dispatch(name, payload).catch((err) => this.emit('error', err));
      source.on(name, handler);
      this._listeners.push([name, handler]);
    }
    return this;
  }

  detach () {
    if (this.source) {
      for (const [name, handler] of this._listeners) this.source.removeListener(name, handler);
    }
    this._listeners = [];
    this.source = null;
    return this;
  }

  /**
   * Run every plugin handler for `event`, in order, one event at a time.
   * @param {string} event
   * @param {*} payload
   * @returns {Promise<void>}
   */
  dispatch (event, payload) {
    const now = this.settings.now();
    const run = async () => {
      for (const plugin of this.plugins.values()) {
        const handler = plugin.on && plugin.on[event];
        if (typeof handler !== 'function') continue;
        try {
          const changed = await handler.call(plugin, payload, this._context(plugin, now));
          if (changed !== false) this._markDirty(plugin.name);
        } catch (err) {
          this.emit('error', err);
        }
      }
    };
    this._queue = this._queue.then(run, run);
    return this._queue;
  }

  /** Checkpoint plugins (e.g. credit open voice sessions up to now). */
  tick () {
    return this.dispatch('tick', { now: this.settings.now() });
  }

  async flush () {
    if (this._flushTimer) clearTimeout(this._flushTimer);
    this._flushTimer = null;
    const names = Array.from(this._dirty);
    this._dirty.clear();
    for (const name of names) {
      await this.settings.store.set(STORE_PREFIX + name, this.states.get(name));
    }
  }

  /**
   * Metrics per operation from every plugin it enables.
   * @returns {Promise<{ generatedAt: string, operations: Array<{ id: string, name: string, metrics: Object }> }>}
   */
  async report () {
    const now = this.settings.now();
    await this.tick();
    const operations = this.operations.map((operation) => {
      const metrics = {};
      for (const entry of operation.metrics) {
        const plugin = this.plugins.get(entry.plugin);
        if (!plugin || typeof plugin.report !== 'function') continue;
        try {
          const ctx = this._context(plugin, now);
          metrics[entry.plugin] = plugin.report(ctx.state, operation, entry, ctx);
        } catch (err) {
          this.emit('error', err);
        }
      }
      return { id: operation.id, name: operation.name || operation.id, metrics };
    });
    return { generatedAt: new Date(now).toISOString(), operations };
  }

  _init (plugin) {
    return typeof plugin.init === 'function' ? plugin.init() : {};
  }

  _context (plugin, now = this.settings.now()) {
    if (!this.states.has(plugin.name)) this.states.set(plugin.name, this._init(plugin));
    return {
      now,
      state: this.states.get(plugin.name),
      source: this.source,
      operations: this.operations,
      operationsFor: (channel) => this.operationsFor(plugin.name, channel)
    };
  }

  _markDirty (name) {
    this._dirty.add(name);
    if (this._flushTimer || !this.settings.store) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.flush().catch((err) => this.emit('error', err));
    }, this.settings.flushMs);
    if (typeof this._flushTimer.unref === 'function') this._flushTimer.unref();
  }
}

module.exports = MetricsPipeline;
module.exports.STORE_PREFIX = STORE_PREFIX;
