'use strict';

const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { GatewayIntentBits } = require('discord.js');
const Store = require('@fabric/core/types/store');

const MetricsPipeline = require('../types/metricsPipeline');
const { voiceActivity, messageActivity, gatewayIntents } = require('../plugins');
const { matchesChannel } = require('../functions/channelMatcher');
const { splitByDay, dayKey } = require('../functions/metricBuckets');

const GUILD = '1190527980120850493';
const ALPHA_VOICE = '1205020182226010152';
const ALPHA_TEXT = '1298475903780782240';
const BRAVO_VOICE = '1205020246394671174';
const LOBBY = '1190527980120850999';
const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 6, 18, 0, 0);

const OPERATIONS = [
  {
    id: 'alpha-squadron',
    name: 'ALPHA SQUADRON',
    guildId: GUILD,
    metrics: [
      { plugin: 'voice', channels: [ALPHA_VOICE] },
      { plugin: 'messages', channels: [ALPHA_TEXT] }
    ]
  },
  {
    id: 'bravo-squadron',
    name: 'BRAVO SQUADRON',
    guildId: GUILD,
    channels: ['/^bravo/'],
    metrics: ['voice']
  }
];

describe('metrics pipeline', function () {
  let dir;
  let store;
  let clock;
  let source;

  async function pipeline () {
    const p = new MetricsPipeline({
      store,
      operations: OPERATIONS,
      plugins: [voiceActivity(), messageActivity()],
      flushMs: 10,
      tickMs: 0,
      now: () => clock
    });
    await p.start();
    p.attach(source);
    return p;
  }

  function voice (userId, oldChannelId, newChannelId, channelName) {
    source.emit('voice', { guildId: GUILD, userId, oldChannelId, newChannelId, channelName, kind: 'x' });
  }

  beforeEach(async function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-discord-metrics-'));
    store = new Store({ name: 'metrics-test', path: dir, persistent: true });
    await store.start();
    clock = T0;
    source = new EventEmitter();
    source.voice = { active: {} };
  });

  afterEach(async function () {
    try { await store.stop(); } catch (_) {}
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('matches channels by id, name, and /regex/', function () {
    assert.ok(matchesChannel(ALPHA_VOICE, { id: ALPHA_VOICE }));
    assert.ok(matchesChannel('alpha squadron', { id: '1', name: 'ALPHA SQUADRON' }));
    assert.ok(matchesChannel('/^bravo/', { id: '1', name: 'BRAVO SQUADRON' }));
    assert.ok(!matchesChannel('/^bravo/', { id: '1', name: 'ALPHA SQUADRON' }));
    assert.ok(!matchesChannel(ALPHA_VOICE, { id: BRAVO_VOICE }));
  });

  it('splits durations at UTC midnight', function () {
    const parts = splitByDay(Date.UTC(2026, 0, 1, 23, 0), Date.UTC(2026, 0, 2, 1, 0));
    assert.deepStrictEqual(parts, [
      { day: '2026-01-01', ms: HOUR },
      { day: '2026-01-02', ms: HOUR }
    ]);
  });

  it('maps plugin intents to non-privileged gateway bits', function () {
    const bits = gatewayIntents([voiceActivity(), messageActivity()]).sort((a, b) => a - b);
    const expected = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages].sort((a, b) => a - b);
    assert.deepStrictEqual(bits, expected);
    assert.ok(!bits.includes(GatewayIntentBits.MessageContent));
    assert.ok(!bits.includes(GatewayIntentBits.GuildMembers));
  });

  it('credits voice time, sessions, members, and peak per operation', async function () {
    const p = await pipeline();
    voice('u1', null, ALPHA_VOICE, 'ALPHA SQUADRON');
    voice('u2', null, ALPHA_VOICE, 'ALPHA SQUADRON');
    voice('u3', null, LOBBY, 'Lobby');
    await p.dispatch('noop');
    clock = T0 + HOUR;
    voice('u1', ALPHA_VOICE, BRAVO_VOICE, 'BRAVO SQUADRON');
    clock = T0 + 2 * HOUR;
    voice('u1', BRAVO_VOICE, null);

    const report = await p.report();
    const alpha = report.operations.find((op) => op.id === 'alpha-squadron').metrics.voice;
    const bravo = report.operations.find((op) => op.id === 'bravo-squadron').metrics.voice;

    assert.strictEqual(alpha.live, 1, 'u2 is still in ALPHA');
    assert.strictEqual(alpha.last7Days.hours, 3, 'u1 1h + u2 2h');
    assert.strictEqual(alpha.last7Days.sessions, 2);
    assert.strictEqual(alpha.last7Days.members, 2);
    assert.strictEqual(alpha.last7Days.peak, 2);
    assert.strictEqual(bravo.live, 0);
    assert.strictEqual(bravo.last7Days.hours, 1);
    assert.strictEqual(bravo.last7Days.sessions, 1);
    assert.strictEqual(bravo.totalSessions, 1);
    await p.stop();
  });

  it('counts messages and authors without storing content', async function () {
    const p = await pipeline();
    const message = (author, channel, content) => source.emit('activity', {
      type: 'DiscordMessage',
      actor: { ref: author },
      object: { content },
      target: { ref: channel, name: 'alpha-squadron' }
    });
    message('u1', ALPHA_TEXT, 'secret plans');
    message('u1', ALPHA_TEXT, 'more');
    message('u2', ALPHA_TEXT, 'hi');
    message('u3', LOBBY, 'elsewhere');
    await p.flush();
    await p.dispatch('noop');
    await p.flush();

    const report = await p.report();
    const alpha = report.operations.find((op) => op.id === 'alpha-squadron').metrics;
    assert.deepStrictEqual(alpha.messages.last7Days, { messages: 3, authors: 2 });
    assert.ok(!('messages' in report.operations.find((op) => op.id === 'bravo-squadron').metrics));

    const saved = await store.get(MetricsPipeline.STORE_PREFIX + 'messages');
    assert.ok(!JSON.stringify(saved).includes('secret plans'));
    await p.stop();
  });

  it('persists state in the Fabric Store across restarts and re-seeds live voice on ready', async function () {
    let p = await pipeline();
    voice('u1', null, ALPHA_VOICE, 'ALPHA SQUADRON');
    await p.dispatch('noop');
    clock = T0 + HOUR;
    await p.stop();

    const saved = await store.get(MetricsPipeline.STORE_PREFIX + 'voice');
    assert.strictEqual(saved.operations['alpha-squadron'].days[dayKey(T0)].memberMs, HOUR);

    clock = T0 + 3 * HOUR;
    source = new EventEmitter();
    source.voice = { active: { [ALPHA_VOICE]: { guildId: GUILD, name: 'ALPHA SQUADRON', members: { u1: {} } } } };
    p = await pipeline();
    source.emit('ready');
    await p.dispatch('noop');
    clock = T0 + 4 * HOUR;

    const alpha = (await p.report()).operations.find((op) => op.id === 'alpha-squadron').metrics.voice;
    assert.strictEqual(alpha.last7Days.hours, 2, '1h before restart + 1h after; the offline gap is not guessed');
    assert.strictEqual(alpha.last7Days.sessions, 1, 're-seeding does not count a new session');
    assert.strictEqual(alpha.live, 1);
    await p.stop();
  });
});
