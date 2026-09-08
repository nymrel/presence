/**
 * Attachment assurance contract.
 *
 * Presence core does not verify WebAuthn assertions. A host-trusted adapter must
 * perform the cryptographic ceremony and return the bounded decision accepted
 * here. Raw assertions, credential IDs, challenges, signatures, public keys,
 * user handles, and authenticator data never enter the ledger contract.
 */

import { createHash, randomBytes } from 'node:crypto';

export const ATTACHMENT_ASSURANCES = Object.freeze([
  'lan-unverified',
  'webauthn-verified',
]);

const DEVICES = new Set(['phone', 'workstation', 'unknown']);
const SHA256 = /^[a-f0-9]{64}$/;
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const EXACT_VERIFIED_KEYS = new Set([
  'assurance',
  'challenge_sha256',
  'credential_sha256',
  'device',
  'gate_id',
  'operator',
  'user_verified',
  'verified',
  'verifier',
]);

export class AttachmentAssuranceError extends Error {
  constructor(message) {
    super(`presence-attachment: ${message}`);
    this.name = 'AttachmentAssuranceError';
  }
}

export function sha256Text(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/** Generate the bearer capability a trusted adapter binds to one attachment. */
export function newAttachmentCapability() {
  return randomBytes(32).toString('base64url');
}

export function normalizeDevice(value) {
  return DEVICES.has(value) ? value : 'unknown';
}

export function unverifiedLanAttachment({ device } = {}) {
  return Object.freeze({
    assurance: 'lan-unverified',
    challenge_sha256: null,
    credential_sha256: null,
    device: normalizeDevice(device),
    operator: null,
    user_verified: false,
    verified: false,
    verifier: null,
  });
}

function boundedHandle(value, label) {
  if (typeof value !== 'string' || !HANDLE.test(value)) {
    throw new AttachmentAssuranceError(
      `${label} must be a bounded non-sensitive handle`
    );
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new AttachmentAssuranceError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

/**
 * Validate the decision returned by a trusted WebAuthn adapter.
 *
 * This function proves only that the adapter's decision is structurally bound
 * to the exact gate and server-held challenge. The adapter remains responsible
 * for verifying clientDataJSON type/challenge/origin, RP ID hash, UP/UV flags,
 * the credential signature, and its signature-counter policy.
 */
export function verifiedAttachmentDecision(value, { gateId, challenge }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AttachmentAssuranceError('verified decision must be an object');
  }
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !EXACT_VERIFIED_KEYS.has(key));
  const missing = [...EXACT_VERIFIED_KEYS].filter((key) => !(key in value));
  if (unknown.length || missing.length) {
    throw new AttachmentAssuranceError(
      `verified decision fields are not exact (missing: ${missing.join(', ') || 'none'}; ` +
      `unknown: ${unknown.join(', ') || 'none'})`
    );
  }
  if (value.verified !== true || value.assurance !== 'webauthn-verified') {
    throw new AttachmentAssuranceError('adapter did not return verified WebAuthn assurance');
  }
  if (value.user_verified !== true) {
    throw new AttachmentAssuranceError('user verification is required');
  }
  if (value.gate_id !== gateId) {
    throw new AttachmentAssuranceError('decision is bound to a different gate');
  }
  if (typeof challenge !== 'string' || challenge.length < 22) {
    throw new AttachmentAssuranceError('server challenge is missing or too short');
  }
  const expectedChallengeDigest = sha256Text(challenge);
  if (value.challenge_sha256 !== expectedChallengeDigest) {
    throw new AttachmentAssuranceError('decision is not bound to the active challenge');
  }

  return Object.freeze({
    assurance: 'webauthn-verified',
    challenge_sha256: digest(value.challenge_sha256, 'challenge_sha256'),
    credential_sha256: digest(value.credential_sha256, 'credential_sha256'),
    device: normalizeDevice(value.device),
    operator: boundedHandle(value.operator, 'operator'),
    user_verified: true,
    verified: true,
    verifier: boundedHandle(value.verifier, 'verifier'),
  });
}

export function isVerifiedAttachment(value) {
  return Boolean(
    value &&
    value.verified === true &&
    value.assurance === 'webauthn-verified' &&
    value.user_verified === true
  );
}
