# Presence

**An agent hits a step that needs a human. It pauses, the human's phone buzzes,
they do the one thing, the agent finishes.** Seconds of human attention instead
of a human doing the whole task.

Presence transports **context and attention**. It never transports an answer.

MIT licensed, zero dependencies, self-hosted. → [nymrel.com/presence](https://nymrel.com/presence)

---

## What it is not, and why that is load-bearing

It does not solve challenges. It does not simulate human signals. It does not
relay a challenge to a solving farm. It does not defeat bot detection.

That is enforced in code, not promised in a README:

| Guarantee | Where it lives | Test |
|---|---|---|
| An anti-bot gate can never use the input channel | `src/policy.js` → `YIELD_ONLY` | forced-yield tests |
| No message shape can carry a token or answer | `src/policy.js` → `INPUT_ALLOW` | rejects 10 known response fields |
| The ledger has nowhere to put a credential | `src/ledger.js` → closed field allowlist | throws on `token`/`password`/`address`/… |
| The browser never hides that it is automated | `src/bridge-cdp.js` | greps `src/` for 9 stealth techniques |
| No solving vendor can be pulled in | `package.json` | asserts zero dependencies |
| An agent cannot grant itself an approval bypass | `src/policy.js` → server-owned profile | unknown profiles fail closed; bypass set is exact |

`node --test tests/guarantees.test.js` → **20/20 passing** (`probed 2026-09-02`).

If you are reading this because you want to relax one of them: the product dies
the moment it becomes a bypass, and so does the customer's defence that a real
human was there.

## The commercial argument

Bypass services exist and every one of them is one enforcement wave from death.
A handoff rail is durable for the same reason it is honest: **sites want the
human to actually be there.** We are not fighting the control, we are supplying
what it asked for. Nobody has to lose for this to keep working.

## How it works

```
agent hits a gate
  └─ presence.pause({...})           returns in milliseconds
       ├─ writes a resume ticket      agent is free to end its turn and sleep
       ├─ ledger: gate.opened         hash-chained, frame hashed not stored
       └─ operator's pager buzzes     one bookmarked LAN page
            └─ human taps in, acts, taps Done
                 └─ ledger: human.attached / human.released
agent wakes, polls once, re-reads the live page itself
```

**The agent learns only that a human acted.** It then re-reads the page and
discovers the new state exactly as it would have if it had done the step itself.
There is no channel through which a result travels — which is precisely why
there is no channel a solved challenge could travel through either.

### Two delivery modes

- **ATTACH** — the human drives the agent's live browser from their phone. Taps
  become real input events in the real session. For consent screens, date
  pickers, dropdowns, confirmations.
- **YIELD** — the rail refuses to touch the session and hands the step to the
  human. **Anti-bot, OTP and identity gates are forced here by policy.**

  Yield has two shapes, and building it is how we found the second one:
  - `own_browser` — the human uses their own clean browser.
  - `agent_window` — the human acts at the browser window already open on the
    workstation. Required when the session cannot be recreated: WA DOR rejects a
    duplicated tab outright (`probed`), so sending the human elsewhere would
    throw away everything the agent already filled in.

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
node demo/dor-lookup.js --name Nymrel # the originating case, end to end
node src/cli.js receipt <gate-id>     # the audit artifact
node src/cli.js verify                # hash-chain integrity
```

Zero dependencies. Node 22+. No cloud hop — a screenshot of a half-filled
government form never leaves the operator's own network. That began as a
constraint (no spend, no accounts, no Upstash key in the vault — `probed`) and
turned out to be the better design.

## The audit trail is the enterprise half

```
PRESENCE RECEIPT  0c2fa1d9-…
gate            anti_bot on secure.dor.wa.gov
mode            yield  (forced by policy)
asked of human  Tick the "I'm not a robot" box
frame shown     sha256:fd10a23f187b83c3…  (the image itself was never stored)
human attached  2026-08-12T06:29:19Z  operator=… device=workstation
released        2026-08-12T06:31:02Z  outcome=resumed
human attention 102s
input relayed   none — the human acted in their own browser
chain           4 records, from genesis
seal            f152d827b4b72ae0…
```

A provable record that a specific human approved a specific action at a specific
moment — and, deliberately, no record of what they typed. It can prove presence.
It cannot leak a password. Both properties come from the same closed field list.

For a pre-authorized local tool prompt, the receipt instead states that the rail
retired it under the operator profile and that a human never attached.

## Next, in order

1. **Bind attach to a passkey.** Today, opening the console URL counts as a human
   arriving — forgeable by anything on the LAN. The receipt's value depends on
   fixing this. See `docs/COMPLIANCE.md` → Known weakness.
2. **WAN mode** behind an Upstash REST relay, once a credential exists. LAN-only
   is right for a single operator, not for a customer's field team.
3. **Sleep/wake across turns** wired into a real studio lane, replacing the demo's
   foreground `waitForHuman`.
4. **Check the DOR terms-of-use page** before using it as a public reference.

## Naming and hosting

Product name **Presence**. It sits beside the credential broker in the Nymrel
family: the broker brokers credentials, Presence brokers attention.

**No new domain.** Every studio domain was checked against
`portfolio-control/config/owned-domain-graph.json` (`probed`); nothing owned fits
better than the hub, and agents do not buy domains. Ship at **`nymrel.com/presence`**
— the hub where the agent-economy offers already live.

See `docs/COMPLIANCE.md` for which use cases are clean and which are not.

## What costs money, and what never will

The rail is MIT and stays that way. Run it on your own machine, forever, for
nothing.

The part we intend to charge for is **notarisation** — because a receipt you
generate, store, and can silently rebuild proves nothing to anyone but you. A
receipt is worth money only when an outside party binds it to a specific person
and timestamps the chain. That needs two things this repo does not have yet:
passkey-bound attach (item 1 in "Next") and a hosted witness. Neither exists
today, so neither is for sale today. `unmeasured` — we have not sold this to
anyone.

If you need that receipt to survive an auditor, say so: **contact@nymrel.com**.
Telling us what it has to prove is more useful to us right now than money.

## License

MIT — see [LICENSE](LICENSE).
