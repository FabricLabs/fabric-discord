# Outstanding (security-first)
Living queue for this repo. Detail: [SECURITY.md](../SECURITY.md). Suite march: [@fabric/core `docs/PRODUCTION_MARCH.md`](https://github.com/FabricLabs/fabric/blob/feature/rsi/docs/PRODUCTION_MARCH.md).

**Last reviewed:** 2026-08-13 (core lockfile `3745041e` on `feature/rsi`).

## Blockers before public OAuth
1. **OAuth CSRF** — `generateAuthorizeLink` omits `state`; `_handleOAuthCallback` is a stub. Do not expose `/services/discord/authorize` on a public hub until state + code exchange land.
2. Discord is a **third-party exfil** — mirrored chat is non-private. Never commit bot tokens / webhook URLs.

## Next slices
- [ ] Voice mute/deafen `commit()` volume on busy guilds (session-only persist option).
- [ ] discord.js 14.18 is a deprecated line — coordinated consumer bump later (GoonCitizen).

## Closed this cut
- `@fabric/core` lockfile `3745041e`; `report:install` wipes the lockfile then `npm i --allow-git=all`.
- GoonCitizen already requires `@fabric/discord/functions/normalizeDiscordSettings` (local file is a re-export). Hub does not depend on this package.
- Blank alias credentials, voice replay/seed crashes, `catch().then()`, `stop()` listener leak, `sync()` Guild objects, DM log verbosity — already on tip (see [AUDIT.md](../AUDIT.md)).

## PRs
[#2](https://github.com/FabricLabs/fabric-discord/pull/2) — no human review comments. CodeRabbit Majors on this tip are stale or already fixed except OAuth CSRF and voice-flag persist volume.
