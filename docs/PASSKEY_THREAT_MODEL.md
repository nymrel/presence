# Passkey-bound human presence: threat model and acceptance contract

**Status: design gate only — not implemented.**

Presence currently records that the LAN console was opened; it does not prove which human opened it. This document defines the minimum boundary a future WebAuthn/passkey implementation must satisfy before any receipt may claim operator authentication.

Primary specification: [Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/).

## Deployment blocker: the current LAN URL is not enough

WebAuthn is exposed only in secure contexts. For web pages, the origin must use HTTPS without certificate errors; HTTP is permitted only when the host is `localhost`. A phone opening `http://192.168.x.x:<port>` is neither HTTPS nor localhost. The WebAuthn RP ID is domain-based and cannot be an arbitrary LAN IP.

Therefore the current phone-on-LAN console cannot gain a trustworthy passkey merely by adding browser JavaScript. One of these deployment contracts must be chosen first:

1. an operator-owned HTTPS hostname with an exact, stable origin and RP ID, reachable from the phone;
2. a local DNS name with a certificate chain trusted by every enrolled device;
3. a separately reviewed native application binding that supplies an equivalent platform origin contract.

There must be no silent fallback from failed passkey verification to “console opened.” If the secure-origin contract is unavailable, authenticated attach and release must fail closed.

## What the ceremony is meant to prove

A successful assertion may support only this bounded statement:

> A credential enrolled to operator `<operator_id>` produced a valid WebAuthn assertion, with user verification, for this exact Presence event and unconsumed challenge at the configured RP ID and origin.

It does **not** prove:

- that the operator had legal authority over the external site or account;
- what the operator clicked, typed, approved, or viewed;
- that every action in the browser session was human-authored;
- that the device or account was uncompromised;
- that an anti-bot or identity control was bypassed legitimately;
- that a synced passkey identifies one physical device.

## Assets

- integrity of `human.attached` and `human.released` ledger events;
- binding between a human assertion and one gate, one intended event, and one ledger state;
- operator credential public keys and revocation state;
- one-time challenge state;
- privacy of screenshots, form contents, credential identifiers, and operator metadata;
- the rule that no answer or credential entered by the human reaches the agent.

## Trust boundaries

### Enrollment

Credential enrollment must be a separate, authenticated operator-administration flow. The pager or an open gate must never be able to self-enroll a new credential. Enrollment must require an already trusted administrative channel or an explicit recovery ceremony with independently recorded approval.

Store, at minimum:

- stable operator ID;
- credential ID;
- credential public key and algorithm;
- RP ID used at registration;
- registration origin;
- creation timestamp;
- revocation state and timestamp;
- authenticator backup eligibility/state when returned;
- signature counter observations, treated as a signal rather than an infallible clone detector.

Attestation should default to `none` unless a later deployment has a documented need and privacy review. A valid attestation alone does not establish that the intended person enrolled the credential.

### Assertion challenge

The trusted server side must generate each challenge using a cryptographically secure random source. Presence should use at least 32 random bytes. The challenge must be stored server-side, expire quickly, and be consumed atomically exactly once.

Challenge state must bind:

- challenge ID and challenge bytes;
- operator ID;
- credential allowlist or account context;
- gate ID;
- exact intended event (`human.attached`, or `human.released` when a deployment
  requires a fresh release assertion);
- current ledger chain head or another immutable pre-event digest;
- RP ID and exact allowed origin;
- creation and expiration timestamps;
- a random ceremony nonce distinct from the gate ID.

The browser must not be trusted to supply any of these binding facts.

### Verification

Before writing a human event, the verifier must reject unless all required checks succeed:

- response type is the expected `webauthn.get` ceremony;
- returned challenge exactly matches the stored challenge;
- challenge is unexpired and unconsumed;
- origin exactly matches an allowlisted HTTPS origin;
- RP ID hash matches the configured RP ID;
- credential is enrolled to the expected operator and is not revoked;
- user-presence bit is set;
- user-verification bit is set, with `userVerification: "required"` requested;
- signature verifies under the stored credential public key and declared algorithm;
- cross-origin/top-origin state is absent or exactly matches an explicitly supported embedding contract;
- gate ID, intended event, and pre-event ledger digest still match current state;
- no other worker has already consumed the challenge or released the gate.

Verification and challenge consumption must be one atomic state transition. A
valid assertion that loses a race must not write a second release event.

### Verified session capability

The current core contract permits release through continuity with a verified
attachment rather than requiring a second WebAuthn ceremony. At attach time the
trusted adapter must generate a separate 32-byte random capability, deliver it
only to the authenticated browser session, and bind its SHA-256 server-side to:

- the exact gate and verified attachment;
- the operator and credential decision already accepted for that attachment;
- a short expiration time;
- input and one terminal release for that gate only.

The pager, gate listing, ledger, resume ticket, URLs, and error messages must
never expose the raw capability. Missing, expired, cross-gate, and replayed
capabilities fail closed before input injection or a release event. A successful
terminal release destroys the server-side session state before another request
can win.

This bearer capability proves continuity with the verified attachment session;
it is not a fresh user-verification ceremony. A deployment that advertises
fresh verification at release must instead issue and atomically consume a
distinct `human.released` challenge.

## Receipt shape

The ledger may record bounded verification metadata, but never private-key material, raw biometric data, challenge bytes, authenticator responses, or form contents.

A human event should include fields such as:

- `authentication: "webauthn"`;
- operator ID or a stable privacy-preserving operator reference;
- digest of the credential ID rather than the raw identifier when downstream lookup is unnecessary;
- RP ID and exact verified origin;
- user presence/user verification results;
- ceremony ID;
- gate ID and intended event;
- bound pre-event chain head;
- verifier version;
- verification timestamp;
- explicit `model_attested: false` and `external_authority_attested: false`-style boundaries where relevant.

The ledger event must not claim “signed by this phone.” Synced passkeys and multi-device credentials can move between authenticators.

## Recovery and revocation

- Operators should enroll at least two independent recovery credentials before enterprise use.
- Credential removal must require another verified credential or an independently governed recovery path.
- Revocation must take effect before new challenges are issued and before outstanding challenges are accepted.
- Lost-device recovery must not silently downgrade to console reachability.
- Operator deletion must define what public-safe identifier remains in historical receipts.

## Adversarial acceptance suite

A passkey implementation is not reviewable without executable tests proving rejection of:

1. random or altered challenge;
2. replayed assertion;
3. expired challenge;
4. challenge issued for another gate;
5. attach assertion reused for release;
6. stale pre-event ledger chain head;
7. wrong origin, scheme, port policy, or RP ID;
8. unexpected cross-origin or top-origin context;
9. credential enrolled to another operator;
10. revoked credential;
11. missing user-presence or user-verification flags;
12. invalid signature or unsupported algorithm;
13. concurrent double-release attempts;
14. enrollment initiated from an unauthenticated pager;
15. unavailable HTTPS/RP configuration attempting to fall back to LAN reachability;
16. receipt output containing raw challenge, authenticator response, private data, or human-entered values.

The positive suite must also prove registration, assertion, revocation, recovery, and ledger verification against deterministic test vectors or a standards-conformant test harness.

## Release gate

Presence may move beyond “console reachability” only when:

- an owned secure-origin deployment contract exists;
- registration and assertion verification are implemented server-side;
- the adversarial suite passes on every supported Node/platform target;
- a second reviewer confirms origin/RP/challenge/event binding;
- receipt wording is updated to the bounded claim above;
- the current known-weakness text is replaced rather than quietly deleted;
- rollback restores the unauthenticated experimental LAN mode only under an explicit non-enterprise label, never as an invisible authentication fallback.
