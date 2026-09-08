/**
 * One-time capabilities issued by a trusted host integration for one exact
 * local tool invocation. Generic agent gate requests cannot mint these.
 */

import { createHash, randomBytes } from 'node:crypto';

const SHA256 = /^[a-f0-9]{64}$/;
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
const EXACT_REQUEST_KEYS = new Set([
  'action_sha256',
  'capability',
  'invocation_id',
  'tool_name',
]);

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requireHandle(value, label) {
  if (typeof value !== 'string' || !HANDLE.test(value)) {
    throw new Error(`presence-approval: ${label} must be a bounded handle`);
  }
  return value;
}

function requireDigest(value) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error('presence-approval: action_sha256 must be a lowercase SHA-256 digest');
  }
  return value;
}

export class TrustedApprovalRegistry {
  constructor({ now = Date.now, ttlMs = 60_000 } = {}) {
    this.now = now;
    this.ttlMs = ttlMs;
    this.pending = new Map();
  }

  /** Trusted-host API. The returned bearer capability must remain process-local. */
  issue({ gate_kind, invocation_id, tool_name, action_sha256 }) {
    if (gate_kind !== 'tool_approval') {
      throw new Error('presence-approval: trusted capabilities are only valid for tool_approval');
    }

    const capability = randomBytes(32).toString('base64url');
    const binding = Object.freeze({
      gate_kind: 'tool_approval',
      invocation_id: requireHandle(invocation_id, 'invocation_id'),
      tool_name: requireHandle(tool_name, 'tool_name'),
      action_sha256: requireDigest(action_sha256),
    });
    const expiresAt = this.now() + this.ttlMs;

    this.pending.set(digest(capability), { binding, expiresAt });
    return Object.freeze({
      capability,
      invocation_id: binding.invocation_id,
      tool_name: binding.tool_name,
      action_sha256: binding.action_sha256,
    });
  }

  /**
   * Consume an exact, unexpired capability. Invalid or malformed requests fail
   * closed to null so the caller can open a normal human gate.
   */
  consume(value, gateKind) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const keys = Object.keys(value);
    if (
      keys.some((key) => !EXACT_REQUEST_KEYS.has(key))
      || [...EXACT_REQUEST_KEYS].some((key) => !(key in value))
      || typeof value.capability !== 'string'
      || !CAPABILITY.test(value.capability)
    ) return null;

    const capabilityDigest = digest(value.capability);
    const record = this.pending.get(capabilityDigest);
    if (!record) return null;
    if (this.now() >= record.expiresAt) {
      this.pending.delete(capabilityDigest);
      return null;
    }

    const expected = record.binding;
    if (
      gateKind !== expected.gate_kind
      || value.invocation_id !== expected.invocation_id
      || value.tool_name !== expected.tool_name
      || value.action_sha256 !== expected.action_sha256
    ) return null;

    this.pending.delete(capabilityDigest);
    return expected;
  }
}
