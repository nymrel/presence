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
 *   - a screenshot cannot be retained, because frames are hashed and discarded.
 *
 * The ledger proves THAT a specific human acted at a specific moment on a
 * specific gate. It deliberately cannot prove WHAT they typed.
 */

import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** The only fields that may ever be written. Closed set. */
const ALLOWED_FIELDS = Object.freeze([
  'id',           // gate id (uuid)
  'seq',          // monotonic per-ledger sequence
  'at',           // ISO timestamp
  'event',        // lifecycle event name
  'actor',        // 'agent' | 'human' | 'rail'
  'operator',     // stable operator handle, e.g. 'jalen' — never an email, never a device id
  'device',       // coarse device class only: 'phone' | 'workstation' | 'unknown'
  'mode',         // 'attach' | 'yield'
  'gate_kind',    // 'anti_bot' | 'consent' | 'otp' | 'payment' | 'signature' | 'other'
  'host',         // hostname only — never the full URL with query params
  'task',         // short human-readable description of what the agent was doing
  'instruction',  // what the human is being asked to do
  'frame_sha256', // hash of the screenshot shown to the human; the frame itself is never stored
  'input_kinds',  // e.g. { pointer: 2, key: 6, scroll: 1 } — COUNTS ONLY, never contents
  'outcome',      // 'resumed' | 'abandoned' | 'timeout' | 'refused'
  'note',         // rail-authored note; never echoes user input
  'prev_hash',
  'hash',
]);

const REDACTED_KEYS = Object.freeze([
  'value', 'values', 'payload', 'token', 'response', 'g-recaptcha-response',
  'solution', 'answer', 'code', 'otp', 'password', 'secret', 'credential',
  'cookie', 'session', 'address', 'street', 'url', 'text', 'keys',
]);

function canonical(obj) {
  // Stable stringify so the hash chain is reproducible across processes.
  const keys = Object.keys(obj).sort();
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return JSON.stringify(out);
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
    if (fields && typeof fields === 'object') {
      for (const k of Object.keys(fields)) {
        if (REDACTED_KEYS.includes(k.toLowerCase())) {
          throw new Error(
            `presence-ledger: refusing to write forbidden field "${k}". ` +
            `The ledger records that a human acted, never what they entered.`
          );
        }
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

    // input_kinds must be a flat map of string -> integer count. Nothing else.
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

  /**
   * Verify the hash chain end to end.
   * Returns { ok, length, brokenAt } — brokenAt is the seq of the first bad link.
   */
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

  /** All records for one gate, oldest first. */
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

export const _internals = { ALLOWED_FIELDS, REDACTED_KEYS, canonical };
