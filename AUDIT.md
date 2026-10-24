# Fabric Discord Security Audit
Living posture notes for **`@fabric/discord`**. Re-run **`npm audit`** after dependency changes; keep this file aligned with the current lockfile.

## Status (2026-10-24)

| Area | Posture |
|------|---------|
| `@fabric/core` | Git pin `FabricLabs/fabric#feature/channels` (lockfile Git commit SHA `1ba3b3cd0376858824c94ae17929eb2e77111a91`) |
| npm `allow-git` | **`.npmrc` `allow-git=all`** — required for git-dep preparation of core |
| Node | **`engines.node` = `26.12.1`** (`.nvmrc`, same as the rest of the suite) |
| discord.js | **`14.27.0`** (from `14.18.0`, which pinned `undici@6.21.1` exactly: smuggling, CRLF injection, WebSocket DoS). Now `undici@6.29.1`. The client listens for `Events.ClientReady` (`clientReady`); the bare `ready` event is deprecated in 14.22+ and gone in v15. This service still emits its own `ready` |
| Test tooling | **`mocha@12.0.3`** (same as core / Hub); `cross-fetch@4.1.0` matches core |
| npm audit (this tree) | **0** |

Consumers (goon.vc, GoonCitizen, Doorman) inherit discord.js from this pin: npm `overrides` do not reach them, so each needs a lockfile refresh after this lands.

## Recommendations

1. After dependency edits: **`npm i --allow-git=all`** then **`npm audit`** and **`npm test`**. **`npm run report:install` removes `package-lock.json`** then `npm i --allow-git=all` — bump core with `npm install FabricLabs/fabric#feature/channels --allow-git=all`. Re-pin releases to the lockfile Git commit SHA. Diff the new lockfile before committing — do not treat the wiped lockfile as a release artifact until that review.
2. Do not run **`npm audit fix --force`** — it will fight discord.js / mocha pins.
3. Keep discord.js on the newest 14.x; v15 is a coordinated consumer bump.

### PR #2 review triage (`feature/rsi`)

| Item | Status |
|------|--------|
| Blank alias credentials | Fixed — first non-empty after trim |
| Voice flags change with no member | Fixed |
| Voice join replay double-count | Fixed |
| Seed crash on missing `members` | Fixed |
| `catch().then()` OAuth / channel fetch | Fixed |
| `login().catch().then()` | Fixed — `await login()` |
| Ready-handler unhandled rejection | Fixed — try/catch |
| `stop()` listener leak | Fixed — detach + recreate client after destroy |
| Whitespace / empty token | Fixed |
| OAuth scope commas | Fixed — space-delimited |
| `sync()` live Guild objects | Fixed — `syncGuilds()` only |
| Default log of DM content | Fixed — `debug` only |
| `alert()` hard-fail | Fixed — catch + `null` |
| `_listGuildMembers` stub | Fixed — delegates to `listGuildMembers` |
| Instantiable unit test | Fixed — constructs + destroys client |
| Activity `target.type` | Fixed — legacy `'dm'` / `'text'` / `'news'` strings (not numeric ChannelType) |
| OAuth CSRF `state` | Fixed — authorize URL + consume-once; missing/unknown/replayed is 400 |
| Activity `object.created` | Fixed — reject non-positive (`Number(null)` / `''` → epoch 0) |
| `!sync` bare Promise | Fixed — await `sync()` + channel reply |
| OAuth / channel `console.error` | Fixed — emit `error` events |
| Blank `channel` / app id/secret | Fixed — trim like token |
| `voiceChannelStats` package export | Fixed — `./functions/voiceChannelStats` |
| OAuth code exchange | Open — callback still 501 after valid `state` (heavy lift) |
| Voice flag `commit()` volume | Fixed — session transitions persist immediately; flag toggles debounce 5s |
| DM debug username leak test | Fixed — asserts debug lines omit username, not only `username:` |
| `report:install` blank lockfile | Fixed — `rm -f package-lock.json` (wipe kept; echo-newline was a no-op wipe) |
| `.codacy.yml` `engines.enabled` | Fixed — Codacy CLI ignores tool toggles; exclusions kept |
| GitHub mocha CI | Open — Codacy only; no `.github/workflows` |
| Large WIP split | Open — process |

## Disclosure

Canonical monitored contact: **`security@fabric.pub`**.
