# Security (`@fabric/discord`)

Discord connectivity bridge for Fabric agents.

**Outstanding queue:** [docs/OUTSTANDING.md](docs/OUTSTANDING.md).

## Adversarial environment
Fabric networks are intended for deployment where **peers, relays, hubs, and operators may be hostile**. Design and review against:

- Untrusted TCP / WebSocket / WebRTC neighbors (forgery, replay, amplification, pin hijack)
- Phishing of identity flows (`fabric://login`, device-link) toward attacker-controlled hubs
- Public observability of unsigned or plaintext application traffic unless an explicit seal is used
- No reliance on an “honest majority” of random internet peers for key custody

Discord is a **third-party exfil / mirror surface**: treat mirrored chat and presence as non-private. A **bot token** grants that Discord application’s gateway and REST capabilities. An OAuth **`client_secret`** is the application credential for the OAuth2 code exchange. A **webhook URL** authorizes posting through that webhook only. Never commit any of them.

**Bot mode** (`start()` / gateway login) requires a non-empty bot token. **Webhook-only** mode is supported by `normalizeDiscordSettings` when a webhook URL is set and no token is present — those consumers must not call `start()`.

**Basics coverage:** [`tests/adversarialEnvironment.basics.test.js`](tests/adversarialEnvironment.basics.test.js).

## Outstanding (PR #2 / RSI follow-ups)
- ~~**`@fabric/core` pin hygiene**~~ — `package.json` stays on `FabricLabs/fabric#feature/rsi`; lockfile Git commit SHA **`488a87da150b23c2591f1c75fa2c1ad6dac201f4`** ([#185](https://github.com/FabricLabs/fabric/pull/185): IdentityCrossSign `_normPubkey` + peer dial guards). `report:install` refreshes the lockfile after an upstream RSI push (`npm i --allow-git=all`). Re-pin releases to that lockfile SHA.
- ~~**OAuth fetch fail-closed**~~ — `exchangeCodeForToken` / `getTokenUser` throw on network / non-OK responses (no swallowed `.catch` + `.then` on `undefined`).
- ~~**OAuth redirect scheme**~~ — `exchangeCodeForToken` / `generateAuthorizeLink` use `settings.secure` for the hub `redirect_uri` scheme; Discord authorize endpoints stay on `https://discord.com`.
- ~~**OAuth scope delimiter**~~ — authorize / application links join scopes with spaces (Discord OAuth2).
- ~~**discord.js v14 member lists**~~ — `listGuildMembers` / `listChannelMembers` use Collection `.cache` / `.values()`; sync paths `await this.commit()`.
- ~~**Legacy `message` event**~~ — listen on `messageCreate` only; `stop()` detaches listeners and recreates the client after `destroy()`.
- ~~**Voice flag updates**~~ — same-channel updates require an active `members` map entry; otherwise `{ changed: false }` (no spurious commit).
- ~~**Voice join replay**~~ — already-tracked members are not double-counted; `seedActiveVoiceMember` tolerates a missing `members` map.
- ~~**Blank setting aliases**~~ — `normalizeDiscordSettings` skips whitespace-only values before falling back (`token: ' '` + `botToken: 'tok'`).
- ~~**Whitespace token gate**~~ — `start()` trims the token; whitespace-only is refused locally.
- ~~**`sync()` live Guild objects**~~ — `sync()` persists via `syncGuilds()` (plain ids), not discord.js `Guild` instances.
- ~~**Default message log verbosity**~~ — DM bodies / usernames go to `debug`, not `log`.
- **OAuth CSRF** — `generateAuthorizeLink` still omits `state`; `_handleOAuthCallback` returns **501** and does not exchange `code` (no longer replies `ok`). Do not expose `/services/discord/authorize` on a public hub until state + code exchange land (heavy lift).
- **Voice flag persist** — same-channel mute/deafen still `commit()`s when the member is tracked; busy guilds may want session-only persistence.
- **npm audit** — remaining advisories after pin (see [AUDIT.md](AUDIT.md)). Prefer deliberate overrides / bumps over `npm audit fix --force`. Re-check after each core bump.
- **Consumers** — GoonCitizen already requires `@fabric/discord/functions/normalizeDiscordSettings` (local wrapper is a re-export). Hub does not depend on this package.

## Process
1. `npm test` before merging token / OAuth / message-bridge changes.
2. Prefer env / local settings for bot tokens; never log the raw token.
3. Align with `@fabric/core` SECURITY.md when upgrading Fabric deps.
4. Normal install is **`npm ci`**. `npm run report:install` is the RSI lockfile refresh (wipes `package-lock.json`, then `npm i --allow-git=all`). Commit the regenerated lockfile and verify the `@fabric/core` resolved Git commit SHA before merge or release.

## Disclosure
Canonical monitored contact: **`security@fabric.pub`**. GitHub Security Advisories are the alternate private channel.
