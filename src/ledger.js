/**
 * Presence ledger — append-only, hash-chained record of human attention events.
 *
 * STRUCTURAL GUARANTEE (do not "improve" this away):
 *   append() accepts a fixed, closed set of fields. There is NO payload,
 *   NO value, NO token, NO response field, and no `...rest` spread.
 *   Anything the caller passes outside the allowlist is dropped before write.
 *
 * That is deliberate. It means:
 *   - a challenge response cannot be recorded here, because there is nowhere to put it;
 *   - a typed password or 2FA code cannot leak into the audit trail, because
 *     key events are counted, never captured;
 *   - a screenshot cannot be retained, because frames are hashed and discarded;
 *   - a WebAuthn assertion cannot be retained; only bounded assurance metadata
 *     and SHA-256 digests produced by a trusted verifier may survive;
 *   - verified-human and unverified-console lifecycle events cannot silently
 *     swap actors or assurance classes.
 */

import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** The only fields that may ever be written. Closed set. */
const ALLOWED_FIELDS = Object.freeze([
  'id',
  'seq',
  'at',
  'event',
  'actor',
  'operator',
  'device',
  'mode',
  'gate_kind',
  'host',
  'task',
  'instruction',
  'frame_sha256',
  'input_kinds',
  'outcome',
  'note',
  'assurance',
  'verifier',
  'credential_sha256',
  'challenge_sha256',
  'user_verified',
  'prev_hash',
  'hash',
]);

const REDACTED_KEYS = Object.freeze([
  'value', 'values', 'payload', 'token', 'response', 'g-recaptcha-response',
  'solution', 'answer', 'code', 'otp', 'password', 'secret', 'credential',
  'credential_id', 'cookie', 'session', 'address', 'street', 'url', 'text', 'keys',
  'challenge', 'assertion', 'signature', 'authenticator_data', 'client_data_json',
  'user_handle', 'public_key', 'attestation_object',
]);

const ASSURANCE_FIELDS = Object.freeze([
  'assurance',
  'verifier',
  'credential_sha256',
  'challenge_sha256',
  'user_verified',
]);
const ASSURANCE_EVENTS = new Set([
  'console.attached',
  'console.released',
  'human.attached',
  'human.released',
]);
const SHA256 = /^[a-f0-9]{64}$/;
const HANDLE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function canonical(obj) {
  const keys = Object.keys(obj).sort();
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return JSON.stringify(out);
}

function requireHandle(value, label) {
  if (typeof value !== 'string' || !HANDLE.test(value)) {
    throw new Error(`presence-ledger: ${label} must be a bounded non-sensitive handle`);
  }
}

function requireDigest(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`presence-ledger: ${label} must be a lowercase SHA-256 digest`);
  }
}

/**
 * Keep assurance semantics closed even when a caller bypasses GateRegistry and
 * appends directly. This does not prove that a verifier was honest; it prevents
 * incomplete or mislabeled evidence from entering the chain.
 */
function validateAssuranceRecord(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error('presence-ledger: record fields must be an object');
  }

  const event = fields.event;
  if (!ASSURANCE_EVENTS.has(event)) {
    const leaked = ASSURANCE_FIELDS.filter((field) => fields[field] !== undefined);
    if (leaked.length) {
      throw new Error(
        `presence-ledger: assurance fields are only valid on attachment lifecycle events: ${leaked.join(', ')}`
      );
    }
    return;
  }

  const isHuman = event.startsWith('human.');
  if (isHuman) {
    if (fields.actor !== 'human') {
      throw new Error('presence-ledger: verified-human events require actor "human"');
    }
    if (fields.assurance !== 'webauthn-verified') {
      throw new Error('presence-ledger: verified-human events require webauthn-verified assurance');
    }
    if (fields.user_verified !== true) {
      throw new Error('presence-ledger: verified-human events require user_verified=true');
    }
    requireHandle(fields.operator, 'operator');
    requireHandle(fields.verifier, 'verifier');
    requireDigest(fields.credential_sha256, 'credential_sha256');
    requireDigest(fields.challenge_sha256, 'challenge_sha256');
    return;
  }

  if (fields.actor !== 'rail') {
    throw new Error('presence-ledger: unverified-console events require actor "rail"');
  }
  if (fields.assurance !== 'lan-unverified') {
    throw new Error('presence-ledger: unverified-console events require lan-unverified assurance');
  }
  if (fields.user_verified !== false) {
    throw new Error('presence-ledger: unverified-console events require user_verified=false');
  }
  for (const forbidden of ['operator', 'verifier', 'credential_sha256', 'challenge_sha256']) {
    if (fields[forbidden] !== undefined) {
      throw new Error(`presence-ledger: unverified-console events may not include ${forbidden}`);
    }
  }
}

export class PresenceLedger {
  constructor(path) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) appendFileSync(path, '');
  }

  all() {
    const raw = readFileSync(this.path, 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  tail() {
    const rows = this.all();
    return rows.length ? rows[rows.length - 1] : null;
  }

  /**
   * Append one record. Unknown fields are DROPPED, not stored.
   * Returns the written record.
   */
  append(fields) {
    validateAssuranceRecord(fields);

    for (const k of Object.keys(fields)) {
      if (REDACTED_KEYS.includes(k.toLowerCase())) {
        throw new Error(
          `presence-ledger: refusing to write forbidden field "${k}". ` +
          `The ledger records that a human acted, never what they entered.`
        );
      }
    }

    const prev = this.tail();
    const rec = {
      seq: prev ? prev.seq + 1 : 0,
      at: new Date().toISOString(),
      prev_hash: prev ? prev.hash : 'GENESIS',
    };

    for (const k of ALLOWED_FIELDS) {
      if (k === 'hash' || k === 'prev_hash' || k === 'seq' || k === 'at') continue;
      if (fields[k] !== undefined) rec[k] = fields[k];
    }

    if (rec.input_kinds !== undefined) {
      const clean = {};
      for (const [k, v] of Object.entries(rec.input_kinds || {})) {
        if (Number.isInteger(v) && v >= 0) clean[String(k).slice(0, 24)] = v;
      }
      rec.input_kinds = clean;
    }

    rec.hash = createHash('sha256').update(canonical(rec)).digest('hex');
    appendFileSync(this.path, JSON.stringify(rec) + '\n');
    return rec;
  }

  verify() {
    const rows = this.all();
    let prevHash = 'GENESIS';
    for (const row of rows) {
      const { hash, ...body } = row;
      if (body.prev_hash !== prevHash) return { ok: false, length: rows.length, brokenAt: row.seq, reason: 'prev_hash mismatch' };
      const recomputed = createHash('sha256').update(canonical(body)).digest('hex');
      if (recomputed !== hash) return { ok: false, length: rows.length, brokenAt: row.seq, reason: 'hash mismatch' };
      prevHash = hash;
    }
    return { ok: true, length: rows.length, brokenAt: null };
  }

  receipt(id) {
    return this.all().filter((r) => r.id === id);
  }
}

export function newGateId() {
  return randomUUID();
}

export function hashFrame(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export const _internals = {
  ALLOWED_FIELDS,
  ASSURANCE_EVENTS,
  ASSURANCE_FIELDS,
  REDACTED_KEYS,
  canonical,
  validateAssuranceRecord,
};
