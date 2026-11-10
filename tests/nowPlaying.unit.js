'use strict';

const assert = require('assert');
const messageText = require('../functions/messageText');
const parseNowPlaying = require('../functions/nowPlaying');
const Discord = require('../services/discord');

// Tempo 2's card in G00N SQUAD's PERMAFLEET voice chat (2026-11-10), API JSON.
function tempoCard (title, clock = '00:00:00 / 00:09:59') {
  return {
    content: '',
    embeds: [],
    components: [{
      type: 17,
      id: 1,
      accent_color: null,
      components: [
        { type: 10, id: 2, content: `**Playing: ${title}**` },
        { type: 14, id: 3, spacing: 1, divider: true },
        { type: 10, id: 5, content: '**Requester**: <@420222636954615808>' },
        { type: 10, id: 6, content: '**Volume**: 15/1000' },
        { type: 1, id: 8, components: [{ type: 2, id: 9, custom_id: 'nowplaying_track_previous', style: 2 }] },
        { type: 10, id: 19, content: `▬▬▬▬▬▬▬▬▬▬▬▬▬▬  **${clock}**` }
      ]
    }]
  };
}

describe('messageText', function () {
  it('reads content, embeds, and Components V2 text, skipping buttons', function () {
    const lines = messageText({
      content: 'hello\n\n  there ',
      embeds: [{ toJSON: () => ({ author: { name: 'Bot' }, title: 'Now', description: 'line', fields: [{ name: 'a', value: 'b' }], footer: { text: 'end' } }) }],
      components: [{ type: 17, components: [{ type: 9, components: [{ type: 10, content: 'inside' }] }, { type: 1, components: [{ type: 2, label: 'Skip' }] }] }]
    });
    assert.deepStrictEqual(lines, ['hello', 'there', 'Bot', 'Now', 'line', 'a', 'b', 'end', 'inside']);
    assert.deepStrictEqual(messageText(null), []);
  });
});

describe('parseNowPlaying', function () {
  it('reads Tempo\'s now-playing card', function () {
    const found = parseNowPlaying(messageText(tempoCard('Closer to Home (I\'m Your Captain) by Grand Funk Railroad', '00:00:22 / 00:04:39')));
    assert.deepStrictEqual(found, {
      type: 'playing',
      bot: 'tempo',
      title: 'Closer to Home (I\'m Your Captain)',
      artist: 'Grand Funk Railroad',
      requester: '420222636954615808',
      position: 22,
      duration: 279
    });
  });

  it('splits title and artist on the last " by " and unescapes markdown', function () {
    const found = parseNowPlaying(messageText(tempoCard('Stand by Me by Ben E\\. King')));
    assert.strictEqual(found.title, 'Stand by Me');
    assert.strictEqual(found.artist, 'Ben E. King');
    assert.strictEqual(parseNowPlaying(messageText(tempoCard('Untitled'))).artist, null);
  });

  it('reads Tempo leaving, and ignores its other posts', function () {
    assert.deepStrictEqual(
      parseNowPlaying(['<@420222636954615808> | It\'s sad to say goodbye, I\'ve stopped playing music and left the voice channel. :frowning:']),
      { type: 'stopped', bot: 'tempo' });
    assert.strictEqual(parseNowPlaying(['<@1> | Added `Let It Be` by `The Beatles` to position `6` in the queue (playing <t:1794267619:R>.)']), null);
    assert.strictEqual(parseNowPlaying(['I couldn\'t load **Back In Black** by **AC/DC**. If this keeps happening then please contact us.']), null);
    assert.strictEqual(parseNowPlaying([]), null);
  });

  it('reads clocks', function () {
    assert.strictEqual(parseNowPlaying.seconds('1:02:03'), 3723);
    assert.strictEqual(parseNowPlaying.seconds('4:39'), 279);
    assert.strictEqual(parseNowPlaying.seconds('x'), null);
  });
});

describe('Discord bot messages', function () {
  function botMessage (authorId) {
    return Object.assign(tempoCard('Let It Be by The Beatles'), {
      id: 'm1',
      guildId: 'g1',
      channelId: 'c1',
      createdTimestamp: 5,
      author: { bot: true, id: authorId, username: 'Tempo 2' }
    });
  }

  it('drops bot messages unless asked, and never emits its own', async function () {
    const quiet = new Discord({ autoCommands: false });
    const watching = new Discord({ autoCommands: false, bots: ['824464544188858369', 'self'] });
    watching.client.user = { id: 'self' };
    const seen = [];
    const activity = [];
    for (const discord of [quiet, watching]) {
      discord.on('bot', (event) => seen.push(event));
      discord.on('activity', (event) => activity.push(event));
    }
    await quiet._handleClientMessage(botMessage('824464544188858369'));
    await watching._handleClientMessage(botMessage('824464544188858369'));
    await watching._handleClientMessage(botMessage('999'));
    await watching._handleClientMessage(botMessage('self'));
    assert.strictEqual(activity.length, 0);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].authorName, 'Tempo 2');
    assert.strictEqual(seen[0].guildId, 'g1');
    assert.strictEqual(seen[0].channelId, 'c1');
    assert.strictEqual(seen[0].created, 5);
    assert.strictEqual(parseNowPlaying(seen[0].lines).title, 'Let It Be');
    const every = new Discord({ autoCommands: false, bots: true, messages: false });
    assert.ok(every._watchesBot('999'));
    every.on('activity', (event) => activity.push(event));
    await every._handleClientMessage({ author: { bot: false, id: 'u1', username: 'pilot' }, channel: { id: 'c1', type: 0 }, id: 'm2', content: 'hi', createdTimestamp: 1 });
    assert.strictEqual(activity.length, 0);
    assert.deepStrictEqual(every.users, []);
    for (const discord of [quiet, watching, every]) await discord.client.destroy();
  });
});
