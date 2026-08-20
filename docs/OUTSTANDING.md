# Outstanding (security-first)
Living queue for this repo. Detail: [SECURITY.md](../SECURITY.md). Suite march: [@fabric/core `docs/PRODUCTION_MARCH.md`](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-20 (core lockfile Git commit SHA `9938917804e2bf5ba5cf1fab7bf0975129d9063f` on `feature/rsi`, [#185](https://github.com/FabricLabs/fabric/pull/185); next pin [#186](https://github.com/FabricLabs/fabric/pull/186) HEAD **`9c6ade0`**).

## Blockers before public OAuth
1. **OAuth code exchange** — `_handleOAuthCallback` still returns **501** after a valid one-time `state` (no token exchange). `generateAuthorizeLink` now emits 64-hex CSRF `state` (TTL 10m, cap 64, consume-once). Stolen `code` without / with unknown `state` is **400**. Do not expose `/services/discord/authorize` on a public hub until code exchange lands.
2. Discord is a **third-party exfil** — mirrored chat is non-private. Never commit bot tokens / webhook URLs.

## Next slices
- [ ] discord.js 14.18 is a deprecated line — coordinated consumer bump later (GoonCitizen).

## Closed this cut
- OAuth CSRF `state`: `generateAuthorizeLink` emits a one-time 64-hex token (TTL 10m, cap 64). Missing/unknown/replayed state is 400. Callback still 501 (no code exchange).
- `@fabric/core` lockfile Git commit SHA `9938917804e2bf5ba5cf1fab7bf0975129d9063f` ([#185](https://github.com/FabricLabs/fabric/pull/185): Filesystem publish retain cut + MuSig2 `autoAccept` default off, BIP-21 `req-*`, collection cwd-containment; plus `fabricIdentityAccountPath` export, inventory JSON `type: 98` keeps AMP wire name, UTF-8 shoutbox `fabricChatText`, IPv6 `_connect` bracket strip, first-tier RC1 contract, IdentityCrossSign `_normPubkey`, `FROM_SEED` `status = 'seeded'`, `loadWallet({ fromFile: true })`). Next pin is [#186](https://github.com/FabricLabs/fabric/pull/186) HEAD **`9c6ade0`**. `report:install` removes `package-lock.json` then `npm i --allow-git=all`.
- Voice flag persist: session transitions `commit()` immediately; mute/deafen/stream flags debounce 5s. Unit test flushes the deferred timer (`_flushVoiceCommit`) so the second commit is observed.
- Activity `target.type` uses legacy `'dm'` / `'text'` / `'news'` strings (discord.js v14 ChannelType numbers).
- GoonCitizen already requires `@fabric/discord/functions/normalizeDiscordSettings` (local file is a re-export). Hub does not depend on this package.
- Blank alias credentials, voice replay/seed crashes, `catch().then()`, `stop()` listener leak, `sync()` Guild objects, DM log verbosity — already on tip (see [AUDIT.md](../AUDIT.md)).

## PRs
[#1](https://github.com/FabricLabs/fabric-discord/pull/1) (`feature/v0.1.0-RC1`) — April CodeRabbit Majors are already on **this** `feature/rsi` tip (Client options, OAuth fetch fail-closed, `await commit()`, member `.cache`, `listChannelMembers` rethrow, voice `changed: false` when untracked). Left on that older PR: OAuth CSRF (now in tree on #2). RSI additionally fails the authorize stub closed (501).
[#2](https://github.com/FabricLabs/fabric-discord/pull/2) (`feature/rsi`) — remaining open: OAuth **code exchange**. CSRF `state` is in tree (authorize URL + consume-once; callback still 501). Pin stays `FabricLabs/fabric#feature/rsi` (this lockfile **`9938917`**; next [#186](https://github.com/FabricLabs/fabric/pull/186) HEAD **`9c6ade0`**). Codacy SUCCESS. No GitHub Actions mocha workflow. Do not invent code exchange. Keep `report:install` lockfile wipe (suite RSI convention; script now `rm -f` instead of writing a blank line).
