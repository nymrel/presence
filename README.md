# Presence

**An agent hits a step that needs a human. It pauses, the human's phone buzzes,
they do the one thing, the agent finishes.** Seconds of human attention instead
of a human doing the whole task.

Presence transports **context and attention**. It never transports an answer.

MIT licensed, zero runtime dependencies, self-hosted. → [nymrel.com/presence](https://nymrel.com/presence)

---

## What it is not, and why that is load-bearing

It does not solve challenges. It does not simulate human signals. It does not
relay a challenge to a solving farm. It does not defeat bot detection.

That is enforced in code, not promised in a README:

| Guarantee | Where it lives | Test |
|---|---|---|
| An anti-bot gate can never use the input channel | `src/policy.js` → `YIELD_ONLY` | forced-yield tests |
| No message shape can carry a token or answer | `src/policy.js` → `INPUT_ALLOW` | rejects known response fields |
| The ledger has nowhere to put a credential or raw WebAuthn proof | `src/ledger.js` → closed field allowlist | forbidden-field tests |
| Unverified LAN arrival cannot become a verified-human receipt | `src/attachment-assurance.js` + `src/gates.js` | assurance tests |
| The browser never hides that it is automated | `src/bridge-cdp.js` | greps `src/` for stealth techniques |
| No solving vendor can be pulled in | `package.json` | asserts zero dependencies |
| An agent cannot grant itself an approval bypass | `src/policy.js` → server-owned profile | unknown profiles fail closed; bypass set is exact |

Run the complete gate:

```bash
npm test
```

If you are reading this because you want to relax one of these guarantees: the
product dies the moment it becomes a bypass, and so does the customer's defence
that a real human was there.

## The commercial argument

Bypass services exist and every one of them is one enforcement wave from death.
A handoff rail is durable for the same reason it is honest: **sites want the
human to actually be there.** We are not fighting the control, we are supplying
what it asked for. Nobody has to lose for this to keep working.

## How it works

```text
agent hits a gate
  └─ presence.pause({...})           returns in milliseconds
       ├─ writes a resume ticket      agent is free to end its turn and sleep
       ├─ ledger: gate.opened         hash-chained, frame hashed not stored
       └─ operator's pager buzzes     one bookmarked LAN page
            ├─ current LAN mode       console.attached (identity unverified)
            └─ future verifier        human.attached (gate-bound WebAuthn proof)
                 human acts, then releases
agent wakes, polls once, re-reads the live page itself
```

**The agent learns only that the step was released.** It then re-reads the page
and discovers the new state exactly as it would have if it had done the step
itself. There is no channel through which a result travels — which is precisely
why there is no channel a solved challenge could travel through either.

### Two delivery modes

- **ATTACH** — the human drives the agent's live browser from their phone. Taps
  become input events in the real session. For consent screens, date pickers,
  dropdowns, and confirmations.
- **YIELD** — the rail refuses to touch the session and hands the step to the
  human. **Anti-bot, OTP, and identity gates are forced here by policy.**

  Yield has two shapes:
  - `own_browser` — the human uses their own clean browser.
  - `agent_window` — the human acts at the browser window already open on the
    workstation. Required when the session cannot be recreated.

## Attachment assurance

Opening the LAN console is not authentication. Presence now keeps that fact
separate from a cryptographically verified human assertion.

- `lan-unverified` emits `console.attached` / `console.released`, actor `rail`.
  It records that the local console participated, not which person did so.
- `webauthn-verified` is reserved for a trusted verifier adapter that has
  validated a fresh gate-bound WebAuthn assertion. Only that state may emit
  `human.attached` / `human.released`, actor `human`.

The core does **not** implement WebAuthn verification from scratch and no
verifier adapter ships yet. The adapter contract is intentionally narrow and
stores only credential/challenge hashes plus bounded assurance metadata. Raw
assertions, signatures, credential IDs, challenges, authenticator data, public
keys, and user handles are forbidden from the ledger.

Set `PRESENCE_REQUIRE_VERIFIED_ATTACH=1` to fail closed: unverified consoles
cannot attach, send input, or release a gate. Until a reviewed verifier adapter
exists, that strict mode makes the rail deliberately unusable rather than
manufacturing verified-human evidence.

See [`docs/ATTACHMENT_ASSURANCE.md`](docs/ATTACHMENT_ASSURANCE.md).

### Approval profiles

Presence separates a **local tool permission prompt** from a step where a person
must actually act.

The relay defaults to the regular, fail-closed profile:

```bash
PRESENCE_APPROVAL_PROFILE=prompt node src/cli.js serve
```

A trusted single-operator environment can pre-authorize local IDE, CLI, or tool
permission prompts:

```bash
PRESENCE_APPROVAL_PROFILE=bypass_tool_approvals node src/cli.js serve
```

That profile retires only gates declared as:

```js
{ gate_kind: 'tool_approval' }
```

It does **not** bypass `anti_bot`, `otp`, `identity`, `consent`, `payment`,
`signature`, or `other`. Those still open a human handoff. Unknown profile
values normalize to `prompt`, and the approval profile is read when the relay
starts; it is not accepted from `presence.pause(...)`, so an agent cannot
promote itself.

A pre-authorized tool prompt returns immediately with:

```json
{
  "state": "retired",
  "human_required": false,
  "approval_profile": "bypass_tool_approvals",
  "console_url": null,
  "pager_url": null
}
```

The terminal ticket remains pollable and the ledger records
`rail.approval_bypassed`. It never writes `human.attached` or
`human.released`, because no human attended.

## Run it

```bash
node src/cli.js serve                 # relay: agent API on loopback, console on LAN
node src/cli.js pager                 # the URL to open on the phone
node demo/dor-lookup.js --name Nymrel # originating demo, end to end
node src/cli.js receipt <gate-id>     # audit artifact
node src/cli.js verify                # hash-chain integrity
```

Zero dependencies. Node 22+. No cloud hop — a screenshot of a half-filled form
never leaves the operator's own network. The frame stays in memory; only its
SHA-256 survives.

## The audit trail is the enterprise-shaped half — not enterprise-ready yet

A current LAN receipt can honestly look like:

```text
PRESENCE RECEIPT  0c2fa1d9-…
gate            consent on admin.example.com
mode            attach
asked of human  Review and approve this bounded change
frame shown     sha256:fd10a23f187b83c3…  (image never stored)
console arrived 2026-08-12T06:29:19Z  assurance=lan-unverified device=phone
released        2026-08-12T06:31:02Z  actor=rail outcome=resumed
input relayed   pointer=2, key=6      (counts only)
chain           4 records, from genesis
```

That proves the chain is internally consistent and a LAN console participated.
It does **not** prove which human held the phone.

A future verified receipt may name a bounded operator handle only after a
trusted WebAuthn adapter validates the exact gate and challenge. That adapter,
credential enrollment, recovery policy, origin/RP configuration, counter store,
and external witness do not exist in this repository today.

For a pre-authorized local tool prompt, the receipt instead states that the rail
retired it under the operator profile and that a human never attached.


## Current roadmap, in order

1. **Implement and independently review a WebAuthn verifier adapter.** The core
   assurance contract and strict mode exist; registration, assertion
   verification, credential storage, recovery, and browser ceremony do not.
2. **Add an external signed checkpoint/witness.** A local hash chain can detect
   edits inside the retained chain but cannot independently prove final-row
   truncation or prevent the host from rebuilding a new chain.
3. **WAN mode** behind a narrowly scoped relay, only after the authentication
   and privacy model survives review.
4. **Sleep/wake across turns** wired into a real studio lane, replacing the
   demo's foreground wait.
5. **Check each target system's automation terms** before using it as a public
   reference. Human presence does not authorize an agent that was never allowed
   to access the rest of the flow.

## Naming and hosting

Product name **Presence**. It sits beside the credential broker in the Nymrel
family: the broker brokers credentials; Presence brokers attention.

No separate domain is required. The intended public home is
**`nymrel.com/presence`**.

See [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) for clean and disallowed use cases.

## What costs money, and what never will

The rail is MIT and stays that way. Run it on your own machine, forever, for
nothing.

A possible hosted product is independent notarisation of verified receipts. It
cannot be sold honestly until both passkey-bound attachment and an external
witness exist. Neither is production-ready today, so neither is offered today.

## License

MIT — see [LICENSE](LICENSE).
