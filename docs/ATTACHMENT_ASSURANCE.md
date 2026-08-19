# Attachment assurance

Presence must distinguish **a browser reached the LAN console** from **a specific human proved control of an enrolled device-held credential**. Those are different facts and must produce different receipts.

## Assurance states

### `lan-unverified`

What happened:

- a console reached the gate URL;
- the caller supplied a coarse device class;
- no identity, credential, signature, user-presence flag, or user-verification flag was verified.

Ledger events:

- `console.attached`, actor `rail`;
- `console.released`, actor `rail`.

An unverified caller cannot select the `operator` written to the ledger. These events support the current single-operator LAN convenience workflow, but they are not named-human evidence.

### `webauthn-verified`

What must already have happened before Presence accepts this assurance:

- a trusted host adapter issued a fresh server challenge for the exact gate;
- the browser returned a WebAuthn authentication assertion;
- the adapter verified the `webauthn.get` client-data type;
- the signed challenge equals the active server challenge;
- the origin is an exact expected origin;
- the RP ID hash matches the expected relying party;
- the user-presence flag is set;
- the user-verification flag is set;
- the credential signature verifies against the registered public key;
- the adapter applied an explicit signature-counter policy;
- the decision is bound to the exact gate ID.

Ledger events:

- `human.attached`, actor `human`;
- `human.released`, actor `human`.

The core accepts only the adapter's bounded decision. It does not accept a browser's self-assertion that verification succeeded.

## What the ledger may retain

Only:

- assurance name;
- bounded operator handle;
- coarse device class;
- bounded verifier-adapter name;
- SHA-256 of the credential ID;
- SHA-256 of the server challenge;
- whether the adapter verified user verification.

The closed ledger refuses raw:

- assertions;
- challenges;
- credential IDs;
- signatures;
- authenticator data;
- client-data JSON;
- user handles;
- public keys;
- attestation objects.

This keeps the receipt useful without turning it into an authentication-secret archive.

## Trusted adapter contract

A host adapter passes its decision to `GateRegistry.attach(..., { verification })`. The decision must contain exactly:

```json
{
  "assurance": "webauthn-verified",
  "challenge_sha256": "<64 lowercase hex>",
  "credential_sha256": "<64 lowercase hex>",
  "device": "phone",
  "gate_id": "<exact active gate id>",
  "operator": "<bounded non-sensitive handle>",
  "user_verified": true,
  "verified": true,
  "verifier": "<bounded adapter identifier>"
}
```

The core rejects unknown fields, missing fields, a different gate, a different challenge digest, false user verification, malformed hashes, and unbounded identifiers.

This is an adapter contract, not a WebAuthn implementation. No verifier adapter, credential enrollment store, origin/RP configuration, browser ceremony, recovery policy, or counter store ships in this slice.

## Strict mode

Set:

```bash
PRESENCE_REQUIRE_VERIFIED_ATTACH=1
```

Then an unverified console cannot attach, relay input, or release the gate. The gate remains open and no human event is written.

Strict mode is the required posture for any future enterprise or notarised receipt claim. It is not enabled by default because the current self-hosted LAN workflow has no verifier adapter yet.

## References

- W3C Web Authentication Level 3, especially the authentication-assertion verification procedure and origin/RP validation requirements.
- `docs/COMPLIANCE.md` for the product and legal boundary.
- `tests/attachment-assurance.test.js` for executable assurance and redaction guarantees.
