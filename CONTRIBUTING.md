# Contributing

Presence transports context and human attention. It never transports a solved answer or credential. Contributions are welcome only when they preserve that boundary structurally.

## Before opening a change

Run:

```bash
npm run check
npm pack --dry-run --json > presence-pack.json
node scripts/verify-pack-contract.mjs presence-pack.json
```

The project intentionally has zero dependencies. Do not add a runtime or development dependency without showing why the same guarantee cannot reasonably remain on the Node standard library and documenting the new supply-chain surface.

## Load-bearing invariants

A contribution must not:

- add a token, answer, password, OTP, cookie, form value, or arbitrary text field to the input or ledger schemas;
- allow `anti_bot`, `otp`, or `identity` gates onto the attach channel;
- persist screenshots, frames, or form contents;
- expose the agent API beyond loopback;
- add stealth, anti-detection, human-simulation, or challenge-solving behavior;
- treat console reachability as verified identity;
- claim a passkey, signature, timestamp, or person was verified unless the corresponding verifier actually ran;
- weaken a refusal test merely to make a feature pass.

## Passkey work

Passkey authentication is a security protocol change, not a UI enhancement. Read `docs/PASSKEY_THREAT_MODEL.md` first. A passkey pull request must include:

- an owned HTTPS origin and fixed RP ID/origin contract;
- authenticated enrollment separate from gate handling;
- one-time, expiring, server-generated challenges;
- exact binding to gate ID, ledger chain head, operator identity, and intended event;
- required user verification and exact origin/RP verification;
- atomic replay prevention, credential revocation, and recovery behavior;
- adversarial tests for replay, wrong gate, wrong origin, wrong RP ID, expired challenge, revoked credential, missing UV, and concurrent release attempts;
- receipt wording that proves only what the verifier observed.

Do not ship an authentication-looking local demo that silently falls back to the current unauthenticated LAN behavior.

## Pull requests

Keep changes narrow. Explain the failure mode, smallest reproducer, tests added, claim changes, privacy impact, and rollback. New public claims require executable evidence in the same change.
