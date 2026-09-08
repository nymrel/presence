# Where the line actually falls

Written to be argued with. Every claim is labelled `probed` (we checked it),
`declared` (established law/doctrine we are relying on), or `unmeasured` (we
have not checked and you should not act as if we have).

## The one distinction that decides everything

There are **two independent questions**, and conflating them is how a product
like this gets someone sued.

**Question 1 — is the human's act legitimate?**
By construction, yes only when a real person, acting under their own authority,
in a live session, personally satisfies a control that exists to confirm a
person is there. Nothing is solved elsewhere and imported. Nothing simulates a
human signal. A CAPTCHA wants a human; it gets one.

**Question 2 — is the agent's automated access to the *rest* of the flow
permitted?**
This is a completely separate question and **Presence does not improve it at
all.** If a site prohibits automated access generally, then steps 1–4 of the
task are already a problem, and a human ticking the box at step 5 does not cure
it. `declared`.

A clean deployment needs **both** answers to be yes. Most of the commercial risk
lives in Question 2, and no amount of good behaviour at the gate touches it.

## What the legal exposure actually is

- **Computer Fraud and Abuse Act (US).** Accessing a *public, unauthenticated*
  page is generally not "access without authorization." *Van Buren v. United
  States* (2021) narrowed "exceeds authorized access" to information one is not
  entitled to obtain at all; *hiQ v. LinkedIn* (9th Cir. 2022) held scraping
  public data is not CFAA access. `declared`. This is why public-records lookups
  are the cleanest ground and why authenticated systems are not.
- **Terms of service.** A ToS ban on automated access is a **contract** matter,
  not a crime. It is also the constraint that most often actually bites, because
  it is the one the site can enforce cheaply — account termination. `declared`.
- **DMCA §1201 (anti-circumvention).** Applies to measures protecting
  *copyrighted works*. Presence never circumvents a measure — a human satisfies
  it as designed. Satisfying an access control the intended way is the opposite
  of circumvention. `declared`.
- **Privacy law (GDPR / CCPA / state records law).** Screenshots of a
  half-completed form are the sharp edge, not the automation. Presence keeps
  frames in memory on the operator's own LAN and stores only a SHA-256. See
  ARCHITECTURE. `probed` — see `tests/guarantees.test.js`.
- **Sector rules.** Financial (GLBA-adjacent ToS), health (HIPAA), and most bank
  and brokerage terms prohibit automated access and credential sharing outright,
  regardless of human presence. `declared`.

## Clean — sell here

1. **Systems the customer owns or is authorised on.** Their own cloud console,
   their own CI, their own CRM, their own SaaS admin. The enterprise authorises
   both the agent and the human. Question 2 answers itself.
2. **Public government records with no automation prohibition.** The originating
   case. `probed 2026-08-12`: `secure.dor.wa.gov` serves **no robots.txt at all**
   (the host returns a WebSEAL 404 template), and `dor.wa.gov`'s robots.txt
   carries **no blanket disallow** of automated access. `unmeasured`: the DOR
   site's own terms-of-use page — check it before this is used as a reference
   customer, because robots.txt is not a ToS.
3. **Vendor portals where the contract permits automation.** Common in
   procurement and logistics; the right to automate is negotiated.
4. **Internal enterprise workflows** where a compliance rule — not a bot
   detector — requires a named human to approve a step. This is the strongest
   commercial ground only after attachment identity and receipt witnessing are
   actually implemented and reviewed.

## Not clean — do not sell here

1. **Any site whose ToS prohibits automated access.** Human presence at the gate
   does not cure it. This is the single most common disqualifier.
2. **Banking, brokerage, payments, insurance portals.** Near-universally
   prohibited, and credential-sharing rules compound it.
3. **Accounts the human is not authorised on.** Presence can record attention;
   it cannot prove the person's external legal authority. That is the customer's
   duty.
4. **Anything sold as "get past CAPTCHAs."** Even where technically clean, that
   framing invites the enforcement wave that kills bypass vendors, and it
   misdescribes the product.
5. **Ticket resale, sneaker drops, scalping, mass account creation.** The gate is
   the *point* of those systems. Routing a human to it at scale is defeating the
   control by paying for attention, which is what the solving farms do with extra
   steps.

## The honest sales sentence

> Presence does not get you past anything. It gets a human to the exact spot
> where one is required, in seconds instead of minutes, and leaves a hash-chained
> record of the handoff. Current LAN receipts do not prove which human acted. If
> a site does not permit your agent to be there at all, Presence will not fix that
> and we will tell you so.

## Attachment identity — current measured boundary

An unauthenticated LAN page visit must not be represented as a verified human.
The core now uses two explicit assurance states:

- `lan-unverified`: emits rail-authored `console.attached` and
  `console.released` events. It proves only that a console participated.
- `webauthn-verified`: reserved for a trusted host adapter that verified a fresh
  gate-bound WebAuthn assertion with required user verification. Only this state
  may emit `human.attached`. It may emit `human.released` only when the caller
  presents the short-lived capability bound to that verified attachment.

`PRESENCE_REQUIRE_VERIFIED_ATTACH=1` blocks unverified attach, input, and release.
That is the only acceptable posture for a future named-human or enterprise audit
claim.

The core contract and refusal behavior are implemented in the current draft.
The actual WebAuthn verifier adapter, credential enrollment, registration
ceremony, expected-origin/RP configuration, counter store, recovery process,
browser ceremony, and authenticated capability delivery remain `unmeasured`
and unbuilt. No enterprise-ready claim is permitted until those pieces pass
independent review.

Presence stores only bounded operator/verifier handles, coarse device class, and
SHA-256 bindings for credential ID and challenge. Raw assertions, credentials,
challenges, signatures, authenticator data, client-data JSON, user handles,
public keys, and attestation objects are structurally refused by the ledger.

See `docs/ATTACHMENT_ASSURANCE.md` and
`tests/attachment-assurance.test.js`.

## Receipt integrity — separate limitation

The ledger is hash-chained and can detect modification within the retained
chain. A host that controls the whole file can still truncate final rows or
rebuild a different chain. A future external signed checkpoint or witness is
required before describing the receipt as independently notarised. `unmeasured`
— not built and not for sale.
