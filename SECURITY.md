# Security (`@fabric/discord`)

Discord connectivity bridge for Fabric agents.

**Outstanding queue:** [docs/OUTSTANDING.md](docs/OUTSTANDING.md).

## Adversarial environment
Fabric networks are intended for deployment where **peers, relays, hubs, and operators may be hostile**. Design and review against:

- Untrusted TCP / WebSocket / WebRTC neighbors (forgery, replay, amplification, pin hijack)
- Phishing of identity flows (`fabric://login`, device-link) toward attacker-controlled hubs
- Public observability of unsigned or plaintext application traffic unless an explicit seal is used
- No reliance on an “honest majority” of random internet peers for key custody

Discord is a **third-party exfil / mirror surface**: treat mirrored chat and presence as non-private. Bot tokens, OAuth `client_secret`, and webhook URLs are credentials equivalent to network admin access for the linked application — never commit them.

**Bot mode** (`start()` / gateway login) requires a non-empty bot token. **Webhook-only** mode is supported by `normalizeDiscordSettings` when a webhook URL is set and no token is present — those consumers must not call `start()`.

**Basics coverage:** [`tests/adversarialEnvironment.basics.test.js`](tests/adversarialEnvironment.basics.test.js).

## Outstanding (PR #2 / RSI follow-ups)
- ~~**`@fabric/core` pin hygiene**~~ — `package.json` stays on `FabricLabs/fabric#feature/rsi`; lockfile SHA **`3745041e…`**. `report:install` wipes the lockfile then `npm i --allow-git=all`. Re-pin releases to the lockfile SHA.
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
- **OAuth CSRF** — `generateAuthorizeLink` still omits `state`; `_handleOAuthCallback` is a stub (`ok`) and does not exchange `code`. Do not expose `/services/discord/authorize` on a public hub until state + code exchange land (heavy lift).
- **Voice flag persist** — same-channel mute/deafen still `commit()`s when the member is tracked; busy guilds may want session-only persistence.
- **npm audit** — remaining advisories after pin (see [AUDIT.md](AUDIT.md)). Prefer deliberate overrides / bumps over `npm audit fix --force`. Re-check after each core bump.
- **Consumers** — GoonCitizen already requires `@fabric/discord/functions/normalizeDiscordSettings` (local wrapper is a re-export). Hub does not depend on this package.

## Process
1. `npm test` before merging token / OAuth / message-bridge changes.
2. Prefer env / local settings for bot tokens; never log the raw token.
3. Align with `@fabric/core` SECURITY.md when upgrading Fabric deps.
4. Prefer `npm ci` / keep `package-lock.json`; `npm run report:install` wipes the lockfile then `npm i --allow-git=all`.

## Disclosure
Canonical monitored contact: **`security@fabric.pub`**. GitHub Security Advisories and the repository issue tracker are alternate private channels.
