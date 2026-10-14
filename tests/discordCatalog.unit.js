'use strict';

const assert = require('assert');
const {
  collectionValues,
  serializeChannel,
  serializeMember,
  serializeGuild,
  uniqueUsersFromGuilds,
  buildDiscordGuildCatalog,
  refreshDiscordCaches,
  channelCanAnnounce,
  channelIsChatInsight
} = require('../functions/discordCatalog');
const {
  foldGuild,
  foldChannel,
  foldUser,
  foldMessageObservation,
  foldCatalog,
  catalogFromContent,
  ensureContentMaps
} = require('../functions/discordStateAccumulate');

describe('discordCatalog', function () {
  it('serializes channels with announce / chatInsight flags', function () {
    const text = serializeChannel({ id: '1', name: 'general', type: 0, position: 2 });
    assert.strictEqual(text.typeName, 'text');
    assert.strictEqual(text.canAnnounce, true);
    assert.strictEqual(text.chatInsight, true);
    assert.ok(channelCanAnnounce(5));
    assert.ok(channelIsChatInsight(5));
    assert.strictEqual(channelCanAnnounce(2), false);
  });

  it('serializes members and caps unique users across guilds', function () {
    const m = serializeMember({
      id: 'u1',
      user: { id: 'u1', username: 'pilot', bot: false },
      displayName: 'Pilot'
    });
    assert.strictEqual(m.displayName, 'Pilot');
    assert.strictEqual(m.bot, false);
    const guilds = [
      { members: [m, { id: 'u2', username: 'a', displayName: 'a', bot: true }] },
      { members: [{ id: 'u1', username: 'pilot', displayName: 'Pilot', bot: false }] }
    ];
    const users = uniqueUsersFromGuilds(guilds);
    assert.strictEqual(users.length, 2);
  });

  it('builds a catalog from a cache-shaped client stub', function () {
    const client = {
      user: { id: 'bot', username: 'Bot', tag: 'Bot#0001' },
      guilds: {
        cache: {
          values () {
            return [{
              id: 'g1',
              name: 'G00N',
              icon: null,
              memberCount: 3,
              channels: {
                cache: {
                  values () {
                    return [{ id: 'c1', name: 'ops', type: 0, position: 0, guildId: 'g1' }];
                  }
                }
              },
              members: {
                cache: {
                  values () {
                    return [{
                      id: 'u1',
                      displayName: 'Neorion',
                      user: { id: 'u1', username: 'neorion', bot: false }
                    }];
                  }
                }
              }
            }];
          }
        }
      }
    };
    const catalog = buildDiscordGuildCatalog(client, {
      botReady: true,
      appId: 'app-1',
      selectedChannelId: 'c1'
    });
    assert.strictEqual(catalog.error, null);
    assert.strictEqual(catalog.guilds.length, 1);
    assert.strictEqual(catalog.guilds[0].channels[0].id, 'c1');
    assert.strictEqual(catalog.users[0].id, 'u1');
    assert.strictEqual(catalog.appId, 'app-1');
  });

  it('refreshDiscordCaches reports no_client without throwing', async function () {
    const sync = await refreshDiscordCaches(null);
    assert.strictEqual(sync.ok, false);
    assert.strictEqual(sync.error, 'no_client');
  });

  it('collectionValues unwraps .cache and arrays', function () {
    assert.deepStrictEqual(collectionValues([1, 2]), [1, 2]);
    assert.deepStrictEqual(collectionValues({ cache: [3] }), [3]);
  });

  it('serializeGuild marks truncated when memberCount exceeds listed', function () {
    const g = serializeGuild({
      id: 'g',
      name: 'X',
      memberCount: 500,
      channels: { cache: { values: () => [] } },
      members: {
        cache: {
          values: () => [{
            id: 'u1',
            user: { id: 'u1', username: 'a' }
          }]
        }
      }
    }, { memberLimit: 1 });
    assert.strictEqual(g.truncated, true);
    assert.strictEqual(g.memberCount, 500);
    assert.strictEqual(g.members.length, 1);
  });
});

describe('discordStateAccumulate', function () {
  it('union-merges guilds without wiping richer prior members', function () {
    const content = ensureContentMaps({});
    foldGuild(content, {
      id: 'g1',
      name: 'G00N',
      memberCount: 2,
      channels: [{ id: 'c1', name: 'ops', type: 0 }],
      members: [
        { id: 'u1', username: 'a', displayName: 'A', bot: false },
        { id: 'u2', username: 'b', displayName: 'B', bot: false }
      ]
    });
    foldGuild(content, {
      id: 'g1',
      name: 'G00N SQUAD',
      memberCount: 2,
      channels: [{ id: 'c1', name: 'operations', type: 0 }],
      members: [{ id: 'u1', username: 'a', displayName: 'Alpha', bot: false }]
    });
    const g = content.guilds.g1;
    assert.strictEqual(g.name, 'G00N SQUAD');
    assert.strictEqual(g.channels[0].name, 'operations');
    assert.strictEqual(g.members.length, 2);
    assert.strictEqual(g.members.find((m) => m.id === 'u1').displayName, 'Alpha');
    assert.ok(content.users.u2);
    assert.strictEqual(content.channels.c1.guildId, 'g1');
  });

  it('folds message observations into users and channels', function () {
    const content = ensureContentMaps({});
    foldMessageObservation(content, {
      guildId: 'g1',
      guildName: 'G00N',
      channelId: 'c9',
      channelName: 'general',
      channelType: 0,
      authorId: 'u9',
      authorUsername: 'pilot',
      bot: false
    });
    assert.ok(content.users.u9);
    assert.strictEqual(content.users.u9.username, 'pilot');
    assert.ok(content.channels.c9);
    assert.ok(content.guilds.g1);
  });

  it('catalogFromContent and foldCatalog round-trip', function () {
    const content = ensureContentMaps({});
    const catalog = {
      guilds: [{
        id: 'g1',
        name: 'G',
        memberCount: 1,
        channels: [{ id: 'c1', name: 'x', type: 0, canAnnounce: true, chatInsight: true }],
        members: [{ id: 'u1', username: 'u', displayName: 'U', bot: false }]
      }],
      users: [{ id: 'u1', username: 'u', displayName: 'U', bot: false }]
    };
    foldCatalog(content, catalog);
    const out = catalogFromContent(content, { botReady: false, appId: 'a' });
    assert.strictEqual(out.source, 'state');
    assert.strictEqual(out.guilds[0].id, 'g1');
    assert.strictEqual(out.appId, 'a');
  });

  it('foldChannel keeps prior members when incoming omits them', function () {
    const content = ensureContentMaps({});
    foldChannel(content, {
      id: 'c1',
      name: 'ops',
      type: 0,
      guildId: 'g1',
      members: [{ id: 'u1', username: 'a', displayName: 'A', bot: false }]
    });
    foldChannel(content, { id: 'c1', name: 'ops2', type: 0, guildId: 'g1' });
    assert.strictEqual(content.channels.c1.name, 'ops2');
    assert.strictEqual(content.channels.c1.members.length, 1);
  });

  it('foldUser merges into content.users', function () {
    const content = ensureContentMaps({});
    foldUser(content, { id: 'u1', username: 'a', displayName: 'A', bot: false });
    foldUser(content, { id: 'u1', username: 'a', displayName: 'Ace', bot: false });
    assert.strictEqual(content.users.u1.displayName, 'Ace');
  });
});
