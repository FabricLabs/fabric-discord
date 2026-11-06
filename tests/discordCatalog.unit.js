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
    assert.strictEqual(m.globalName, null, 'a server nickname is not the global name');
    assert.strictEqual(m.bot, false);
    assert.strictEqual(serializeMember({ id: 'u3', nickname: 'Nick', displayName: 'Nick', user: { id: 'u3', username: 'n', globalName: 'Global' } }).globalName, 'Global');
    const content = {};
    foldGuild(content, { id: 'g1', channels: [], members: [serializeMember({ id: 'u3', user: { id: 'u3', username: 'n', globalName: 'Global' } })] });
    assert.strictEqual(content.users.u3.globalName, 'Global');
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

  it('an inferred display name follows the username; a Discord display name stays', function () {
    const content = {};
    foldMessageObservation(content, { authorId: 'u1', authorUsername: 'old' });
    assert.strictEqual(content.users.u1.displayName, 'old');
    foldMessageObservation(content, { authorId: 'u1', authorUsername: 'new' });
    assert.strictEqual(content.users.u1.displayName, 'new');
    foldUser(content, { id: 'u1', username: 'new', displayName: 'Nick' });
    foldMessageObservation(content, { authorId: 'u1', authorUsername: 'newer' });
    assert.strictEqual(content.users.u1.displayName, 'Nick');
    assert.strictEqual(content.users.u1.username, 'newer');
  });

  it('a guild message keeps a Discord display name the user row got after an inferred one', function () {
    const content = {};
    foldMessageObservation(content, { guildId: 'g1', authorId: 'u1', authorUsername: 'ace' });
    assert.strictEqual(content.guilds.g1.members[0].displayNameInferred, true);
    foldUser(content, { id: 'u1', username: 'ace', displayName: 'Ace Pilot' });
    foldMessageObservation(content, { guildId: 'g1', authorId: 'u1', authorUsername: 'ace' });
    assert.strictEqual(content.users.u1.displayName, 'Ace Pilot');
    assert.strictEqual(content.users.u1.displayNameInferred, undefined);
    foldMessageObservation(content, { guildId: 'g1', authorId: 'u1', authorUsername: 'ace2' });
    assert.strictEqual(content.users.u1.displayName, 'Ace Pilot');
    assert.strictEqual(content.users.u1.username, 'ace2');
    assert.strictEqual(content.guilds.g1.members[0].displayName, 'ace2', 'the guild row stays inferred');
  });

  it('a full snapshot with globalName: null clears a stored global name; a chat author does not', function () {
    const content = {};
    const member = (globalName) => serializeMember({ id: 'u1', user: { id: 'u1', username: 'a', globalName } });
    foldGuild(content, { id: 'g1', name: 'G', channels: [], members: [member('Global')] });
    foldMessageObservation(content, { guildId: 'g1', authorId: 'u1', authorUsername: 'a' });
    assert.strictEqual(content.users.u1.globalName, 'Global');
    assert.strictEqual(content.guilds.g1.members[0].globalName, 'Global');
    foldGuild(content, { id: 'g1', name: 'G', channels: [], members: [member(null)] });
    assert.strictEqual(content.users.u1.globalName, null);
    assert.strictEqual(content.guilds.g1.members[0].globalName, null);
    foldGuild(content, { id: 'g2', name: 'H', channels: [], members: [member('Later')] });
    foldMessageObservation(content, { guildId: 'g1', authorId: 'u1', authorUsername: 'a' });
    assert.strictEqual(content.users.u1.globalName, 'Later', "g1's stored null does not clear a newer global name");
    foldGuild(content, { id: 'g1', name: 'G', channels: [], members: [{ id: 'u2', username: 'b' }] });
    assert.strictEqual(content.users.u1.globalName, 'Later', 'a snapshot that omits u1 does not clear it either');
  });

  it('a full snapshot with avatar: null clears a stored avatar; a chat author does not', function () {
    const content = {};
    const guild = (avatar) => ({ id: 'g1', name: 'G', channels: [], members: [{ id: 'u1', username: 'a', displayName: 'A', bot: false, status: null, avatar }] });
    foldGuild(content, guild('av'));
    foldMessageObservation(content, { guildId: 'g1', authorId: 'u1', authorUsername: 'a' });
    assert.strictEqual(content.users.u1.avatar, 'av');
    assert.strictEqual(content.guilds.g1.members[0].avatar, 'av');
    foldGuild(content, guild(null));
    assert.strictEqual(content.users.u1.avatar, null);
    assert.strictEqual(content.guilds.g1.members[0].avatar, null);
  });

  it('a chat author the user map evicted gets the guild member back', function () {
    const content = {};
    foldGuild(content, { id: 'g1', name: 'G', channels: [], members: [{ id: 'u1', username: 'a', displayName: 'Ace', bot: false, status: 'online', avatar: 'av', roles: ['r1'] }] });
    delete content.users.u1;
    foldMessageObservation(content, { guildId: 'g1', authorId: 'u1', authorUsername: 'a' });
    assert.strictEqual(content.users.u1.displayName, 'Ace');
    assert.strictEqual(content.users.u1.avatar, 'av');
    assert.deepStrictEqual(content.users.u1.roles, ['r1']);
  });

  it('foldUser merges into content.users', function () {
    const content = ensureContentMaps({});
    foldUser(content, { id: 'u1', username: 'a', displayName: 'A', bot: false });
    foldUser(content, { id: 'u1', username: 'a', displayName: 'Ace', bot: false });
    assert.strictEqual(content.users.u1.displayName, 'Ace');
  });

  it('message observations keep stored nickname, roles, avatar, and status', function () {
    const content = {};
    const rich = { id: 'u1', username: 'ace', displayName: 'Ace Pilot', bot: false, status: 'online', avatar: 'av', roles: ['r1'] };
    foldGuild(content, { id: 'g1', name: 'G', channels: [], members: [rich], memberCount: 1 });
    foldMessageObservation(content, { guildId: 'g1', channelId: 'c1', authorId: 'u1', authorUsername: 'ace' });
    for (const row of [content.users.u1, content.guilds.g1.members.find((m) => m.id === 'u1')]) {
      assert.strictEqual(row.displayName, 'Ace Pilot');
      assert.deepStrictEqual(row.roles, ['r1']);
      assert.strictEqual(row.avatar, 'av');
      assert.strictEqual(row.status, 'online');
    }
  });
});
