# Security (`@fabric/discord`)

Discord connectivity bridge for Fabric agents.

## Adversarial environment
Fabric networks are intended for deployment where **peers, relays, hubs, and operators may be hostile**. Design and review against:

- Untrusted TCP / WebSocket / WebRTC neighbors (forgery, replay, amplification, pin hijack)
- Phishing of identity flows (`fabric://login`, device-link) toward attacker-controlled hubs
- Public observability of unsigned or plaintext application traffic unless an explicit seal is used
- No reliance on an “honest majority” of random internet peers for key custody

Discord is a **third-party exfil / mirror surface**: treat mirrored chat and presence as non-private. Bot tokens and OAuth `client_secret` are credentials equivalent to network admin access for the linked application — never commit them; refuse to start without an explicit token.

**Basics coverage:** [`tests/adversarialEnvironment.basics.test.js`](tests/adversarialEnvironment.basics.test.js).

## Process
1. `npm test` before merging token / OAuth / message-bridge changes.
2. Prefer env / local settings for bot tokens; never log the raw token.
3. Align with `@fabric/core` SECURITY.md when upgrading Fabric deps.

## Disclosure
Report issues via the repository issue tracker / maintainer contact in README.
