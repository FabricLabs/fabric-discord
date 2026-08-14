# Fabric Discord Security Audit
Living posture notes for **`@fabric/discord`**. Re-run **`npm audit`** after dependency changes; keep this file aligned with the current lockfile.

## Status (2026-08-14)
| Area | Posture |
|------|---------|
| `@fabric/core` | Git pin `FabricLabs/fabric#feature/rsi` (lockfile Git commit SHA `488a87da150b23c2591f1c75fa2c1ad6dac201f4`, [#185](https://github.com/FabricLabs/fabric/pull/185)) |
| npm `allow-git` | **`.npmrc` `allow-git=all`** — required for git-dep preparation of core |
| Node | **`engines.node` = `24.15.0`** |
| discord.js | **`14.18.0`** (deprecated upstream line; bump is a separate product decision) |
| npm audit (this tree) | **7** (5 moderate, 2 high) after the `#185` pin — see residual |

## Residual (accepted)

| Package | Severity | Notes |
|---------|----------|-------|
| `undici` (via discord.js / `@discordjs/rest`) | high / moderate | Unbounded decompression. Tied to discord.js 14.18; do not `audit fix --force`. |
| `serialize-javascript` (mocha) | high | Dev-only (test runner). |
| `uuid` (jayson) | moderate | Same class as Hub; core already overrides `uuid@11.1.1` in some trees. |
| `discord.js@14.18.0` | deprecation | Stay until a coordinated consumer bump. |

## Recommendations

1. After dependency edits: **`npm i --allow-git=all`** then **`npm audit`** and **`npm test`**. **`npm run report:install` wipes `package-lock.json`** then `npm i --allow-git=all` — bump core with `npm install FabricLabs/fabric#feature/rsi --allow-git=all`. Keep `package.json` on `#feature/rsi` during RSI; re-pin releases to lockfile Git commit SHA `488a87da150b23c2591f1c75fa2c1ad6dac201f4`. This pin already resolves `ws@8.21.3` (the old `ws` high via jayson is gone). Remaining highs are mocha `serialize-javascript` (dev) and discord.js `undici`. Diff the new lockfile before committing — do not treat the wiped lockfile as a release artifact until that review.
2. Do not run **`npm audit fix --force`** — it will fight discord.js / mocha pins.
3. Revisit discord.js when consumers can take a current major together.

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
| OAuth CSRF / authorize stub | Open — heavy lift (callback is 501, not `ok`) |
| Voice flag `commit()` volume | Open — busy-guild persist policy |
| Large WIP split | Open — process |

## Disclosure

Canonical monitored contact: **`security@fabric.pub`**.
