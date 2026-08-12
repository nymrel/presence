# Where the line actually falls

Written to be argued with. Every claim is labelled `probed` (we checked it),
`declared` (established law/doctrine we are relying on), or `unmeasured` (we
have not checked and you should not act as if we have).

## The one distinction that decides everything

There are **two independent questions**, and conflating them is how a product
like this gets someone sued.

**Question 1 — is the human's act legitimate?**
By construction, yes. A real person, acting under their own authority, in a
live session, personally satisfies a control that exists to confirm a person is
there. Nothing is solved elsewhere and imported. Nothing simulates a human
signal. A CAPTCHA wants a human; it gets one.

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
   commercial ground and the audit trail is the product.

## Not clean — do not sell here

1. **Any site whose ToS prohibits automated access.** Human presence at the gate
   does not cure it. This is the single most common disqualifier.
2. **Banking, brokerage, payments, insurance portals.** Near-universally
   prohibited, and credential-sharing rules compound it.
3. **Accounts the human is not authorised on.** Presence proves a human was
   present; it cannot prove they had authority. That is the customer's duty.
4. **Anything sold as "get past CAPTCHAs."** Even where technically clean, that
   framing invites the enforcement wave that kills bypass vendors, and it
   misdescribes the product.
5. **Ticket resale, sneaker drops, scalping, mass account creation.** The gate is
   the *point* of those systems. Routing a human to it at scale is defeating the
   control by paying for attention, which is what the solving farms do with extra
   steps.

## The honest sales sentence

> Presence does not get you past anything. It gets a human to the exact spot
> where one is required, in seconds instead of minutes, and leaves a signed
> record that they were there. If a site does not permit your agent to be there
> at all, Presence will not fix that and we will tell you so.

## Known weakness — state it to customers, do not hide it

**Opening the console page currently counts as a human arriving.** Anything that
can reach the LAN URL can produce a `human.attached` record. For a single-operator
LAN that is acceptable; for an enterprise audit trail it is not, because the
receipt's whole value is that it is hard to forge.

The fix, before any enterprise sale: bind attach to a device-held key
(WebAuthn/passkey on the operator's phone) and sign the release event with it, so
the receipt proves *which human*, not merely *that the console was opened*.
`unmeasured` — not built. Tracked as the top item in README "Next".
