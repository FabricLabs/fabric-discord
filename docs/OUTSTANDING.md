# Outstanding (security-first)
Living queue for this repo. Detail: [SECURITY.md](../SECURITY.md). Suite march: [@fabric/core `docs/PRODUCTION_MARCH.md`](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-25 (core lockfile tip on `feature/rsi`; next pin
[#186](https://github.com/FabricLabs/fabric/pull/186)).

## Blockers before public OAuth
1. **OAuth code exchange** — `_handleOAuthCallback` still returns **501** after a valid one-time `state` (no token exchange). `generateAuthorizeLink` now emits 64-hex CSRF `state` (TTL 10m, cap 64, consume-once). Stolen `code` without / with unknown `state` is **400**. Do not expose `/services/discord/authorize` on a public hub until code exchange lands.
2. Discord is a **third-party exfil** — mirrored chat is non-private. Never commit bot tokens / webhook URLs.

## Next slices
- [ ] discord.js 14.18 is a deprecated line — coordinated consumer bump later (GoonCitizen).

## Closed this cut
- Activity `object.created` rejects non-positive timestamps (`Number(null)` / `''` → epoch 0). Helper: `Discord.positiveCreatedMs`.
- `!sync` awaits `sync()` and replies `Synced.` (was returning a bare Promise with no channel reply).
- OAuth / channel fetch failures emit `error` instead of bare `console.error`.
- Constructor trims blank `channel` / `app.id` / `app.secret` like `token`.
- Package export `./functions/voiceChannelStats` for consumers that already require the leaf.
- OAuth CSRF `state`: `generateAuthorizeLink` emits a one-time 64-hex token (TTL 10m, cap 64). Missing/unknown/replayed state is 400. Callback still 501 (no code exchange).
- `@fabric/core` lockfile tracks `#feature/rsi` (see lockfile SHA). `report:install` removes `package-lock.json` then `npm i --allow-git=all`.
- Voice flag persist: session transitions `commit()` immediately; mute/deafen/stream flags debounce 5s. Unit test flushes the deferred timer (`_flushVoiceCommit`) so the second commit is observed.
- Activity `target.type` uses legacy `'dm'` / `'text'` / `'news'` strings (discord.js v14 ChannelType numbers).
- GoonCitizen already requires `@fabric/discord/functions/normalizeDiscordSettings` (local file is a re-export). Hub does not depend on this package.
- Blank alias credentials, voice replay/seed crashes, `catch().then()`, `stop()` listener leak, `sync()` Guild objects, DM log verbosity — already on tip (see [AUDIT.md](../AUDIT.md)).

## PRs
[#1](https://github.com/FabricLabs/fabric-discord/pull/1) (`feature/v0.1.0-RC1`) — April CodeRabbit Majors are already on **this** `feature/rsi` tip (Client options, OAuth fetch fail-closed, `await commit()`, member `.cache`, `listChannelMembers` rethrow, voice `changed: false` when untracked). Left on that older PR: OAuth CSRF (now in tree on #2). RSI additionally fails the authorize stub closed (501).
[#2](https://github.com/FabricLabs/fabric-discord/pull/2) (`feature/rsi`) — remaining open: OAuth **code exchange**. CSRF `state` is in tree (authorize URL + consume-once; callback still 501). Pin stays `FabricLabs/fabric#feature/rsi`. Codacy SUCCESS. No GitHub Actions mocha workflow. Do not invent code exchange. Keep `report:install` lockfile wipe (suite RSI convention; script now `rm -f` instead of writing a blank line).
