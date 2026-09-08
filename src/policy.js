/**
 * Rail policy. These are enforced in code, not documented as intentions.
 *
 * The single most important rule in this codebase:
 *
 *   An anti-bot challenge can NEVER be driven through the attach channel.
 *
 * Not "should not". Cannot. `enforceMode()` downgrades it to YIELD before a
 * gate is ever created, so there is no code path in which relayed input reaches
 * a CAPTCHA widget. If you are reading this because you want to relax it: the
 * product dies the moment it becomes a bypass, and so does the customer's
 * defence that a real human was present.
 */

/** Gate kinds that are forced to YIELD — the human uses their own browser. */
export const YIELD_ONLY = Object.freeze([
  'anti_bot',  // relaying taps into a CAPTCHA is the thing we refuse to build
  'otp',       // a one-time code must never traverse the rail, even in memory
  'identity',  // ID documents / liveness stay on the human's own device
]);

/**
 * Approval profiles are operator-owned relay configuration. They are never
 * accepted from an agent request, so a task cannot promote its own privileges.
 */
export const APPROVAL_PROFILES = Object.freeze([
  'prompt',
  'bypass_tool_approvals',
]);

/**
 * The complete set of gate kinds that an operator may pre-authorize.
 *
 * This intentionally contains only local IDE/CLI/tool permission prompts.
 * Website consent, payment, signature, anti-bot, OTP, identity, and unknown
 * gates still require a human even in the permissive profile.
 */
export const BYPASSABLE_GATE_KINDS = Object.freeze([
  'tool_approval',
]);

/**
 * Unknown or misspelled profiles fail closed to the regular prompt behavior.
 */
export function normalizeApprovalProfile(value) {
  return APPROVAL_PROFILES.includes(value) ? value : 'prompt';
}

/**
 * Decide whether this gate needs human attention under the relay's profile.
 * The profile is supplied by the operator when the relay starts, not by the
 * requesting agent. A bypass additionally requires a one-time exact invocation
 * binding accepted by the server-owned trusted integration.
 */
export function decideHumanRequirement(
  gateKind,
  profile,
  { trustedToolApproval = false } = {},
) {
  const approvalProfile = normalizeApprovalProfile(profile);

  if (
    approvalProfile === 'bypass_tool_approvals'
    && BYPASSABLE_GATE_KINDS.includes(gateKind)
    && trustedToolApproval === true
  ) {
    return {
      humanRequired: false,
      approvalProfile,
      reason:
        'operator profile pre-authorizes local tool permission prompts; '
        + 'sensitive and external gates still require a human',
    };
  }

  return {
    humanRequired: true,
    approvalProfile,
    reason: null,
  };
}

/**
 * The closed set of message shapes the human console may send toward a session.
 * There is deliberately no shape that carries an answer, a token, a solved
 * challenge, or a credential. Adding one is not a feature, it is a rewrite of
 * what this product is.
 */
export const INPUT_ALLOW = Object.freeze({
  pointer: Object.freeze(['action', 'x', 'y', 'button']),
  key: Object.freeze(['action', 'code', 'key']),
  scroll: Object.freeze(['x', 'y', 'dy']),
});

/** Field names that must never appear on an inbound console message. */
export const FORBIDDEN_INPUT_FIELDS = Object.freeze([
  'token', 'response', 'g-recaptcha-response', 'h-captcha-response',
  'cf-turnstile-response', 'solution', 'answer', 'otp', 'code_value',
  'password', 'secret', 'credential', 'cookie', 'session', 'payload',
]);

export function enforceMode(requestedMode, gateKind) {
  if (YIELD_ONLY.includes(gateKind)) {
    return {
      mode: 'yield',
      forced: requestedMode === 'attach',
      reason: `gate_kind "${gateKind}" is yield-only by policy: the human completes this in their own browser, in their own session`,
    };
  }
  return { mode: requestedMode === 'attach' ? 'attach' : 'yield', forced: false, reason: null };
}

/**
 * Validate one inbound console message.
 * Throws on anything outside the allowlist. Returns the cleaned message.
 */
export function validateInput(msg) {
  if (!msg || typeof msg !== 'object') throw new Error('input must be an object');
  const kind = msg.kind;
  if (!Object.prototype.hasOwnProperty.call(INPUT_ALLOW, kind)) {
    throw new Error(`unsupported input kind "${kind}" — allowed: ${Object.keys(INPUT_ALLOW).join(', ')}`);
  }
  const allowed = INPUT_ALLOW[kind];
  const out = { kind };
  for (const [k, v] of Object.entries(msg)) {
    if (k === 'kind') continue;
    const lower = k.toLowerCase();
    if (FORBIDDEN_INPUT_FIELDS.includes(lower)) {
      throw new Error(
        `refused: field "${k}" is forbidden on the attach channel. ` +
        `Presence relays a human's input into a live session; it never carries a solved answer.`
      );
    }
    if (!allowed.includes(k)) {
      throw new Error(`refused: field "${k}" is not allowed on a "${kind}" message`);
    }
    out[k] = v;
  }
  return out;
}
