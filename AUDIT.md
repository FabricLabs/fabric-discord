# Fabric Discord Security Audit
Living posture notes for **`@fabric/discord`**. Re-run **`npm audit`** after dependency changes; keep this file aligned with the current lockfile.

## Status (2026-08-12)

| Area | Posture |
|------|---------|
| `@fabric/core` | Git pin `FabricLabs/fabric#3c96383430f9f233a2f2be0850c0f2eb4c8366fb` (immutable SHA from `feature/rsi`) |
| npm `allow-git` | **`.npmrc` `allow-git=all`** — required for git-dep preparation of core |
| Node | **`engines.node` = `24.15.0`** |
| discord.js | **`14.18.0`** (deprecated upstream line; bump is a separate product decision) |
| npm audit (this tree) | **11** (6 moderate, 5 high) after 2026-08-12 tip refresh — see residual |

## Residual (accepted)

| Package | Severity | Notes |
|---------|----------|-------|
| `ws` (via jayson / `@fabric/core`) | high | Uninitialized memory disclosure. Hub/http override `ws@8.21.2`; add the same override here when bumping without waiting on core. |
| `undici` (via discord.js / `@discordjs/rest`) | high / moderate | Unbounded decompression. Tied to discord.js 14.18; do not `audit fix --force`. |
| `serialize-javascript` (mocha) | high | Dev-only (test runner). |
| `brace-expansion` / `js-yaml` | high | Dev-only (mocha tree). |
| `uuid` (jayson) | moderate | Same class as Hub; core already overrides `uuid@11.1.1` in some trees. |
| `discord.js@14.18.0` | deprecation | Stay until a coordinated consumer bump. |

## Recommendations

1. After dependency edits: **`npm i --allow-git=all`** then **`npm audit`** and **`npm test`**. Plain **`npm run report:install` keeps `package-lock.json`** — bump core with `npm install FabricLabs/fabric#feature/rsi --allow-git=all` then re-pin `package.json` to the lockfile SHA.
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
| OAuth CSRF / authorize stub | Open — heavy lift |
| Voice flag `commit()` volume | Open — busy-guild persist policy |
| Large WIP split | Open — process |

## Disclosure

Canonical monitored contact: **`security@fabric.pub`**.
