# Outstanding (security-first)
Living queue for this repo. Detail: [SECURITY.md](../SECURITY.md). Suite march: [@fabric/core `docs/PRODUCTION_MARCH.md`](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-14 (core lockfile Git commit SHA `5557a2bfc830a3b472e6d26ed46b1a5fd7c16b9b` on `feature/rsi`, [#185](https://github.com/FabricLabs/fabric/pull/185)).

## Blockers before public OAuth
1. **OAuth CSRF** — `generateAuthorizeLink` omits `state`; `_handleOAuthCallback` returns 501 (no code exchange). Do not expose `/services/discord/authorize` on a public hub until state + code exchange land.
2. Discord is a **third-party exfil** — mirrored chat is non-private. Never commit bot tokens / webhook URLs.

## Next slices
- [ ] discord.js 14.18 is a deprecated line — coordinated consumer bump later (GoonCitizen).

## Closed this cut
- `@fabric/core` lockfile Git commit SHA `5557a2bfc830a3b472e6d26ed46b1a5fd7c16b9b` ([#185](https://github.com/FabricLabs/fabric/pull/185): UTF-8 shoutbox `fabricChatText`, IPv6 `_connect` bracket strip, first-tier RC1 contract, IdentityCrossSign `_normPubkey`, `FROM_SEED` `status = 'seeded'`, `loadWallet({ fromFile: true })`). `report:install` wipes the lockfile then `npm i --allow-git=all`.
- Voice flag persist: session transitions `commit()` immediately; mute/deafen/stream flags debounce 5s.
- Activity `target.type` uses legacy `'dm'` / `'text'` / `'news'` strings (discord.js v14 ChannelType numbers).
- GoonCitizen already requires `@fabric/discord/functions/normalizeDiscordSettings` (local file is a re-export). Hub does not depend on this package.
- Blank alias credentials, voice replay/seed crashes, `catch().then()`, `stop()` listener leak, `sync()` Guild objects, DM log verbosity — already on tip (see [AUDIT.md](../AUDIT.md)).

## PRs
[#1](https://github.com/FabricLabs/fabric-discord/pull/1) (`feature/v0.1.0-RC1`) — April CodeRabbit Majors are already on **this** `feature/rsi` tip (Client options, OAuth fetch fail-closed, `await commit()`, member `.cache`, `listChannelMembers` rethrow, voice `changed: false` when untracked). Left on that older PR: OAuth CSRF (heavy), `report:install` lockfile wipe (suite RSI convention). RSI additionally fails the authorize stub closed (501).
[#2](https://github.com/FabricLabs/fabric-discord/pull/2) (`feature/rsi`) — remaining open: OAuth CSRF (`state` + code exchange). Pin stays `FabricLabs/fabric#feature/rsi` until a release tag (currently **`5557a2bf`**). CodeRabbit AUDIT MD058 (blank line before status table) is in this slice. Do not “fix” `report:install` lockfile wipe — suite RSI convention.
