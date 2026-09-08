# Security policy

Presence is a human-attention handoff rail. Its most important security property is negative: it must not become a channel for challenge answers, credentials, or covert human-simulation data.

## Supported versions

The current `main` branch is supported while the project remains experimental. No tagged release or hosted enterprise authentication service is claimed yet.

## Report privately

Send security reports to **contact@nymrel.com**. Do not place secrets, private source, customer screenshots, credentials, challenge material, or live exploit details in a public issue.

Useful reports include:

- a message shape that can carry a token, answer, password, OTP, cookie, or other credential;
- a way for an agent or unauthenticated network client to forge `human.attached` or `human.released` evidence;
- replay, substitution, or cross-gate confusion in a future passkey ceremony;
- ledger-chain tampering that verifies as intact;
- persisted frames or sensitive form contents;
- exposure of the loopback agent API to the LAN;
- stealth, anti-detection, or solving-vendor behavior entering the source tree;
- a claim or receipt that materially overstates what was authenticated or observed.

Include the affected commit, operating system and Node version, the smallest synthetic reproducer, expected and observed behavior, and whether the issue can expose data or forge human-presence evidence.

## Known public weakness

Opening the current LAN console proves only that a client reached the console. It emits rail-authored `console.attached` / `console.released` events with `lan-unverified` assurance and cannot emit `human.attached` or `human.released`. This is acceptable only for the current single-operator experimental LAN posture and is not an identity guarantee.

The reserved `webauthn-verified` mode requires a trusted adapter and the full passkey-bound attach/release contract. It is **not built**. Until a reviewed WebAuthn implementation satisfies `docs/PASSKEY_THREAT_MODEL.md`, Presence must not claim to prove which human acted.

## Out of scope

Presence will not accept features that solve or relay anti-bot challenges, conceal automation, share credentials, or convert human attention into a bypass service. A report asking for those capabilities is not a product request the project will implement.
