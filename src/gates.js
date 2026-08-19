/**
 * Gate registry + resume tickets.
 *
 * A "gate" is one moment where an agent stopped because a human must act.
 *
 * Two stores, deliberately different in durability:
 *
 *   1. LIVE STATE (memory only) — the screenshot frame, attach channel, and
 *      one-time attachment challenge. Frames and raw authentication material
 *      are NEVER written to disk.
 *
 *   2. RESUME TICKET (disk) — the small, boring, non-sensitive record the agent
 *      needs to wake up correctly: gate id, what it was doing, what it does next.
 */

import { randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  AttachmentAssuranceError,
  isVerifiedAttachment,
  unverifiedLanAttachment,
  verifiedAttachmentDecision,
} from './attachment-assurance.js';

export const GATE_KINDS = Object.freeze([
  'anti_bot',
  'consent',
  'otp',
  'payment',
  'signature',
  'identity',
  'other',
]);

export const MODES = Object.freeze(['attach', 'yield']);

export const STATES = Object.freeze([
  'open',
  'attached',
  'acting',
  'released',
  'abandoned',
  'timeout',
  'refused',
  'retired',
]);

export class GateRegistry {
  constructor({
    ledger,
    ticketDir,
    requireVerifiedAttachment = process.env.PRESENCE_REQUIRE_VERIFIED_ATTACH === '1',
  }) {
    this.ledger = ledger;
    this.ticketDir = ticketDir;
    this.requireVerifiedAttachment = Boolean(requireVerifiedAttachment);
    mkdirSync(ticketDir, { recursive: true });
    /** @type {Map<string, object>} in-memory only */
    this.live = new Map();
  }

  open({ id, mode, gate_kind, host, task, instruction, resumeHint, frameSha, handoffUrl, yieldTarget }) {
    const gate = {
      id,
      mode,
      gate_kind,
      host,
      task,
      instruction,
      yieldTarget: yieldTarget === 'own_browser' ? 'own_browser' : 'agent_window',
      state: 'open',
      openedAt: Date.now(),
      frame: null,
      frameSha,
      handoffUrl: handoffUrl || null,
      inputKinds: {},
      operator: null,
      device: null,
      attachment: null,
      // Server-generated, memory-only. A trusted verifier adapter must bind its
      // decision to the digest of this exact value and this exact gate id.
      attachmentChallenge: randomBytes(32).toString('base64url'),
    };
    this.live.set(id, gate);

    this.ledger.append({
      id, event: 'gate.opened', actor: 'agent', mode, gate_kind, host,
      task, instruction, frame_sha256: frameSha,
    });

    this.writeTicket(id, { id, mode, gate_kind, host, task, resumeHint, state: 'open' });
    return gate;
  }

  get(id) { return this.live.get(id) || null; }

  /** Trusted-host surface. Never expose this value in a receipt or log. */
  getAttachmentChallenge(id) {
    const g = this.live.get(id);
    if (!g || isVerifiedAttachment(g.attachment)) return null;
    return g.attachmentChallenge;
  }

  setFrame(id, buf, sha) {
    const g = this.live.get(id);
    if (!g) return;
    g.frame = buf;
    g.frameSha = sha;
  }

  /**
   * Record console arrival or a trusted verifier decision.
   *
   * `verification` is not a browser assertion. It is the bounded result of a
   * host-trusted adapter that already performed cryptographic verification.
   */
  attach(id, { device, verification } = {}) {
    const g = this.live.get(id);
    const mayUpgrade = g?.state === 'attached' && !isVerifiedAttachment(g.attachment) && verification;
    if (!g || (g.state !== 'open' && !mayUpgrade)) return g;

    const attachment = verification
      ? verifiedAttachmentDecision(verification, {
          gateId: id,
          challenge: g.attachmentChallenge,
        })
      : unverifiedLanAttachment({ device });

    if (this.requireVerifiedAttachment && !isVerifiedAttachment(attachment)) {
      throw new AttachmentAssuranceError(
        'verified attachment is required before this gate may be used'
      );
    }

    const verified = isVerifiedAttachment(attachment);
    g.state = 'attached';
    g.attachment = attachment;
    g.operator = attachment.operator;
    g.device = attachment.device;
    g.attachedAt = Date.now();
    if (verified) g.attachmentChallenge = null;

    this.ledger.append({
      id,
      event: verified ? 'human.attached' : 'console.attached',
      actor: verified ? 'human' : 'rail',
      operator: verified ? attachment.operator : undefined,
      device: attachment.device,
      mode: g.mode,
      assurance: attachment.assurance,
      verifier: verified ? attachment.verifier : undefined,
      credential_sha256: verified ? attachment.credential_sha256 : undefined,
      challenge_sha256: verified ? attachment.challenge_sha256 : undefined,
      user_verified: attachment.user_verified,
      note: verified
        ? 'trusted verifier accepted a gate-bound WebAuthn assertion'
        : 'LAN console arrived; operator identity was not verified',
    });

    this.writeTicket(id, {
      ...this.readTicket(id),
      state: 'attached',
      assurance: attachment.assurance,
    });
    return g;
  }

  assertUsableAttachment(g) {
    if (this.requireVerifiedAttachment && !isVerifiedAttachment(g?.attachment)) {
      throw new AttachmentAssuranceError(
        'verified attachment is required before input or release'
      );
    }
  }

  countInput(id, kind) {
    const g = this.live.get(id);
    if (!g) return;
    this.assertUsableAttachment(g);
    g.state = 'acting';
    g.inputKinds[kind] = (g.inputKinds[kind] || 0) + 1;
  }

  release(id, outcome = 'resumed') {
    const g = this.live.get(id);
    if (!g) return null;
    this.assertUsableAttachment(g);

    const verified = isVerifiedAttachment(g.attachment);
    const attachment = g.attachment || unverifiedLanAttachment({ device: g.device });
    g.state = outcome === 'resumed' ? 'released' : outcome;
    g.releasedAt = Date.now();
    g.frame = null;

    this.ledger.append({
      id,
      event: verified ? 'human.released' : 'console.released',
      actor: verified ? 'human' : 'rail',
      operator: verified ? g.operator : undefined,
      device: g.device,
      mode: g.mode,
      input_kinds: g.inputKinds,
      outcome,
      assurance: attachment.assurance,
      verifier: verified ? attachment.verifier : undefined,
      credential_sha256: verified ? attachment.credential_sha256 : undefined,
      challenge_sha256: verified ? attachment.challenge_sha256 : undefined,
      user_verified: attachment.user_verified,
      note: verified
        ? `verified human attention ${Math.round(((g.releasedAt - (g.attachedAt || g.openedAt)) / 1000))}s`
        : `unverified LAN console attention ${Math.round(((g.releasedAt - (g.attachedAt || g.openedAt)) / 1000))}s`,
    });

    this.writeTicket(id, {
      ...this.readTicket(id),
      state: g.state,
      outcome,
      assurance: attachment.assurance,
    });
    return g;
  }

  retire(id, note) {
    const g = this.live.get(id);
    if (!g) return null;
    g.state = 'retired';
    g.releasedAt = Date.now();
    g.frame = null;

    this.ledger.append({
      id, event: 'gate.retired', actor: 'agent', mode: g.mode,
      outcome: 'retired', note: note || 'no longer requires a human',
    });

    this.writeTicket(id, { ...this.readTicket(id), state: 'retired', outcome: 'retired' });
    this.live.delete(id);
    return g;
  }

  ticketPath(id) { return join(this.ticketDir, `${id}.json`); }

  writeTicket(id, obj) {
    writeFileSync(this.ticketPath(id), JSON.stringify({ ...obj, updatedAt: new Date().toISOString() }, null, 2));
  }

  readTicket(id) {
    const p = this.ticketPath(id);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8'));
  }

  openTickets() {
    return readdirSync(this.ticketDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(this.ticketDir, f), 'utf8')))
      .filter((t) => t.state === 'open' || t.state === 'attached');
  }

  clearTicket(id) {
    const p = this.ticketPath(id);
    if (existsSync(p)) unlinkSync(p);
  }
}
