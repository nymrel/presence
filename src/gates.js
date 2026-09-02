/**
 * Gate registry + resume tickets.
 *
 * A "gate" is one moment where an agent stopped because a human must act.
 *
 * Two stores, deliberately different in durability:
 *
 *   1. LIVE STATE (memory only) — the screenshot frame and the attach channel.
 *      Frames are NEVER written to disk. A frame of a filled-in form can contain
 *      a home address, a licence number, a card. We show it to the operator on
 *      his own LAN and then we forget it. Only the SHA-256 survives.
 *
 *   2. RESUME TICKET (disk) — the small, boring, non-sensitive record the agent
 *      needs to wake up correctly: gate id, what it was doing, what it does next.
 *      This is what makes the agent sleepable instead of blocked.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { BYPASSABLE_GATE_KINDS } from './policy.js';

export const GATE_KINDS = Object.freeze([
  'tool_approval', // local IDE/CLI/tool permission prompt; operator may pre-authorize
  'anti_bot',      // reCAPTCHA / Turnstile / hCaptcha / bot interstitial
  'consent',       // accept terms, cookie wall, permission grant
  'otp',           // SMS / TOTP / email code the agent must never see
  'payment',       // confirm a charge
  'signature',     // e-sign
  'identity',      // upload ID, liveness check
  'other',
]);

/**
 * Delivery mode.
 *
 *   ATTACH — the human drives the agent's own live browser from their phone.
 *            Input events originate from a real finger and are injected into the
 *            real session. Nothing is solved anywhere else and shipped in.
 *
 *   YIELD  — the rail refuses to touch the session and hands the whole step to
 *            the human in THEIR own clean browser. This is the correct mode for
 *            anti-bot gates: the honest response to "this site does not want an
 *            automated browser" is to give it a browser that isn't one, with a
 *            real person at it — not to make the automated one look human.
 */
export const MODES = Object.freeze(['attach', 'yield']);

export const STATES = Object.freeze([
  'open',        // agent paused, waiting for a human
  'attached',    // a human has opened the console and is present
  'acting',      // input is being relayed
  'released',    // human says done — agent may resume
  'abandoned',   // human declined
  'timeout',     // nobody came
  'refused',     // the rail itself refused the gate (policy)
  'retired',     // the world or operator profile closed it without human attention
]);

export class GateRegistry {
  constructor({ ledger, ticketDir }) {
    this.ledger = ledger;
    this.ticketDir = ticketDir;
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
      // Where the human should act when mode === 'yield':
      //   'agent_window' — physically, at the browser window already open on the
      //                    workstation. Correct when the session cannot be
      //                    recreated (WA DOR rejects duplicated tabs outright),
      //                    so sending the human to a fresh browser would throw
      //                    away the work the agent already did.
      //   'own_browser'  — in the human's own clean browser, via handoffUrl.
      //                    Correct when the step is self-contained.
      yieldTarget: yieldTarget === 'own_browser' ? 'own_browser' : 'agent_window',
      state: 'open',
      openedAt: Date.now(),
      frame: null,            // Buffer, memory only, replaced on every refresh
      frameSha,
      handoffUrl: handoffUrl || null,
      inputKinds: {},         // counts only
      operator: null,
      device: null,
    };
    this.live.set(id, gate);

    this.ledger.append({
      id, event: 'gate.opened', actor: 'agent', mode, gate_kind, host,
      task, instruction, frame_sha256: frameSha,
    });

    this.writeTicket(id, { id, mode, gate_kind, host, task, resumeHint, state: 'open' });
    return gate;
  }

  /**
   * Record an operator-pre-authorized local tool prompt as a terminal ticket.
   *
   * No live gate is created and no human event is forged. The agent may poll the
   * durable ticket and observe only that the rail retired the gate under its
   * server-side approval profile.
   */
  bypass({ id, mode, gate_kind, host, task, instruction, resumeHint, reason }) {
    if (!BYPASSABLE_GATE_KINDS.includes(gate_kind)) {
      throw new Error(
        `approval bypass refused for gate_kind "${gate_kind}"; `
        + `allowed: ${BYPASSABLE_GATE_KINDS.join(', ')}`
      );
    }

    this.ledger.append({
      id,
      event: 'rail.approval_bypassed',
      actor: 'rail',
      mode,
      gate_kind,
      host,
      task,
      instruction,
      outcome: 'retired',
      note: reason || 'operator profile pre-authorized this local tool prompt',
    });

    this.writeTicket(id, {
      id,
      mode,
      gate_kind,
      host,
      task,
      resumeHint,
      state: 'retired',
      outcome: 'retired',
    });

    return this.readTicket(id);
  }

  get(id) { return this.live.get(id) || null; }

  setFrame(id, buf, sha) {
    const g = this.live.get(id);
    if (!g) return;
    g.frame = buf;       // memory only — never written to disk
    g.frameSha = sha;
  }

  attach(id, { operator, device }) {
    const g = this.live.get(id);
    if (!g || g.state !== 'open') return g;
    g.state = 'attached';
    g.operator = operator;
    g.device = device;
    g.attachedAt = Date.now();
    this.ledger.append({ id, event: 'human.attached', actor: 'human', operator, device, mode: g.mode });
    return g;
  }

  countInput(id, kind) {
    const g = this.live.get(id);
    if (!g) return;
    g.state = 'acting';
    g.inputKinds[kind] = (g.inputKinds[kind] || 0) + 1;
  }

  release(id, outcome = 'resumed') {
    const g = this.live.get(id);
    if (!g) return null;
    g.state = outcome === 'resumed' ? 'released' : outcome;
    g.releasedAt = Date.now();
    g.frame = null; // forget the pixels immediately

    this.ledger.append({
      id,
      event: 'human.released',
      actor: 'human',
      operator: g.operator,
      device: g.device,
      mode: g.mode,
      input_kinds: g.inputKinds,
      outcome,
      note: `human attention ${Math.round(((g.releasedAt - (g.attachedAt || g.openedAt)) / 1000))}s`,
    });

    this.writeTicket(id, { ...this.readTicket(id), state: g.state, outcome });
    return g;
  }

  /**
   * Retire a gate the world closed while it was waiting.
   *
   * Deliberately NOT release(). A release is a human event and says a human
   * attended. If an agent could write that, every receipt in the ledger would
   * be worth less — the whole enterprise value of this rail is that
   * `human.attached` means a human actually attached. So retirement is its own
   * event, actor 'agent', and it is visibly absent a human leg.
   *
   * The case this exists for: an operator queue item stops needing him (the
   * world satisfied it, or a probe showed it never required him). Without this
   * the gate sits on his pager forever and the rail accumulates exactly the
   * phantom asks the register was built to kill.
   */
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

  // ---- resume tickets (durable, non-sensitive) ----

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
