# `@fabric/discord`
Discord connectivity for Fabric agents.

## Voice receive
Join a channel muted and subscribe to speakers as s16le PCM (48 kHz stereo).
`@discordjs/voice` lives here so apps do not take that dependency.

```js
const { joinVoiceReceive, subscribeVoiceReceive, leaveVoiceReceive } = require('@fabric/discord/functions/voiceReceive');
// or discord.joinVoiceReceive({ guildId, channelId })
```

Does not capture Go Live / screenshare RTP. Mixer, files, and clip records stay in the app.

## Other bots' posts
Messages from bots are dropped unless `bots` is set: `true` for every bot
but this one, or a list of bot user ids. Each one is emitted as `bot`
`{ id, guildId, channelId, authorId, authorName, created, lines }`, where
`lines` is the readable text of the post (content, embeds, and Components V2
text displays; `functions/messageText`). In servers this needs the
privileged MessageContent intent. `messages: false` skips people's messages
(no `activity`, nothing folded into the catalog) for a client that only reads
bots.

`functions/nowPlaying` reads music bots' now-playing posts from those lines:
`{ type: 'playing', bot, title, artist, requester, position, duration }` or
`{ type: 'stopped', bot }`, else null. Tempo is understood today.

Security leftovers: [SECURITY.md](SECURITY.md), [docs/OUTSTANDING.md](docs/OUTSTANDING.md). Never commit bot tokens or webhook URLs.
