# Outstanding (security-first)
Living queue for this repo. Detail: [SECURITY.md](../SECURITY.md). Suite march: [@fabric/core `docs/PRODUCTION_MARCH.md`](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-15 (core lockfile Git commit SHA `4a1ff0a5707143d965a2da61f700eda4be3a24ae` on `feature/rsi`, [#185](https://github.com/FabricLabs/fabric/pull/185)).

## Blockers before public OAuth
1. **OAuth code exchange** — `_handleOAuthCallback` still returns **501** after a valid one-time `state` (no token exchange). `generateAuthorizeLink` now emits 64-hex CSRF `state` (TTL 10m, cap 64, consume-once). Stolen `code` without / with unknown `state` is **400**. Do not expose `/services/discord/authorize` on a public hub until code exchange lands.
2. Discord is a **third-party exfil** — mirrored chat is non-private. Never commit bot tokens / webhook URLs.

## Next slices
- [ ] discord.js 14.18 is a deprecated line — coordinated consumer bump later (GoonCitizen).

## Closed this cut
- OAuth CSRF `state`: `generateAuthorizeLink` emits a one-time 64-hex token (TTL 10m, cap 64). Missing/unknown/replayed state is 400. Callback still 501 (no code exchange).
- `@fabric/core` lockfile Git commit SHA `4a1ff0a5707143d965a2da61f700eda4be3a24ae` ([#185](https://github.com/FabricLabs/fabric/pull/185): UTF-8 shoutbox `fabricChatText`, IPv6 `_connect` bracket strip, first-tier RC1 contract, IdentityCrossSign `_normPubkey`, `FROM_SEED` `status = 'seeded'`, `loadWallet({ fromFile: true })`). Local core still has uncommitted `fabricIdentityAccountPath` / inventory `type: 98` wire-name follow-ups — not in this pin. `report:install` wipes the lockfile then `npm i --allow-git=all`.
- Voice flag persist: session transitions `commit()` immediately; mute/deafen/stream flags debounce 5s. Unit test flushes the deferred timer (`_flushVoiceCommit`) so the second commit is observed.
- Activity `target.type` uses legacy `'dm'` / `'text'` / `'news'` strings (discord.js v14 ChannelType numbers).
- GoonCitizen already requires `@fabric/discord/functions/normalizeDiscordSettings` (local file is a re-export). Hub does not depend on this package.
- Blank alias credentials, voice replay/seed crashes, `catch().then()`, `stop()` listener leak, `sync()` Guild objects, DM log verbosity — already on tip (see [AUDIT.md](../AUDIT.md)).

## PRs
[#1](https://github.com/FabricLabs/fabric-discord/pull/1) (`feature/v0.1.0-RC1`) — April CodeRabbit Majors are already on **this** `feature/rsi` tip (Client options, OAuth fetch fail-closed, `await commit()`, member `.cache`, `listChannelMembers` rethrow, voice `changed: false` when untracked). Left on that older PR: OAuth CSRF (heavy), `report:install` lockfile wipe (suite RSI convention). RSI additionally fails the authorize stub closed (501).
[#2](https://github.com/FabricLabs/fabric-discord/pull/2) (`feature/rsi`) — remaining open: OAuth **code exchange**. CSRF `state` is in tree (authorize URL + consume-once; callback still 501). Pin stays `FabricLabs/fabric#feature/rsi` (this lockfile **`4a1ff0a57`**). Codacy ACTION_REQUIRED was Vale on SECURITY.md plus lockfile `undici`/`uuid` (accepted in [AUDIT.md](../AUDIT.md)). Staged `.codacy.yml` excludes those from the 0-new-issue gate. Do not “fix” `report:install` lockfile wipe — suite RSI convention.
