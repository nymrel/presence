/**
 * The relay: one HTTP server with two faces.
 *
 *   /agent/*  — bound to loopback callers only. The agent opens gates here.
 *   /h/*      — the human console, reachable from the operator's phone on the LAN.
 *   /pager    — the page the operator keeps open. It buzzes.
 *
 * Deliberately LAN-only. There is no cloud hop, so a screenshot of a
 * half-filled form never leaves the operator's own network.
 */

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { AttachmentAssuranceError } from './attachment-assurance.js';
import { GateRegistry, GATE_KINDS } from './gates.js';
import { PresenceLedger, newGateId, hashFrame } from './ledger.js';
import {
  decideHumanRequirement,
  enforceMode,
  normalizeApprovalProfile,
  validateInput,
} from './policy.js';
import { gatePage, pagerPage } from './console-ui.js';
import { TrustedApprovalRegistry } from './trusted-approvals.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return '127.0.0.1';
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}
function pageNonce() {
  return randomBytes(18).toString('base64');
}

export function contentSecurityPolicy(nonce = null) {
  const scriptSource = nonce ? `'nonce-${nonce}'` : "'none'";
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    `script-src ${scriptSource}`,
    "style-src 'unsafe-inline'",
  ].join('; ');
}

function html(res, code, body, nonce = null) {
  res.writeHead(code, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': contentSecurityPolicy(nonce),
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}
function text(res, code, body) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}
async function readJson(req, limit = 8 * 1024 * 1024) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > limit) throw new Error('body too large');
    chunks.push(c);
  }
  if (!n) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * @param {object} opts
 * @param {string} opts.ledgerPath
 * @param {string} opts.ticketDir
 * @param {(gate:object, input:object)=>Promise<void>} [opts.onInput] injector for attach mode
 * @param {boolean} [opts.requireVerifiedAttachment] fail closed without host-verified assurance
 * @param {'prompt'|'bypass_tool_approvals'} [opts.approvalProfile]
 *   Operator-owned startup setting. Agent requests cannot override it.
 * @param {number} [opts.approvalCapabilityTtlMs]
 * @param {number} [opts.attachmentCapabilityTtlMs]
 * @param {()=>number} [opts.now] injectable clock for deterministic expiry tests
 */
export function createRelay({
  ledgerPath,
  ticketDir,
  onInput,
  requireVerifiedAttachment,
  approvalProfile,
  approvalCapabilityTtlMs,
  attachmentCapabilityTtlMs,
  now,
}) {
  const ledger = new PresenceLedger(ledgerPath);
  const gates = new GateRegistry({
    ledger,
    ticketDir,
    requireVerifiedAttachment,
    attachmentCapabilityTtlMs,
    now,
  });
  const profile = normalizeApprovalProfile(
    approvalProfile ?? process.env.PRESENCE_APPROVAL_PROFILE
  );
  const approvals = new TrustedApprovalRegistry({ now, ttlMs: approvalCapabilityTtlMs });

  const issueTrustedToolApproval = (binding) => {
    if (profile !== 'bypass_tool_approvals') {
      throw new Error('presence-approval: relay profile does not permit tool approval bypass');
    }
    return approvals.issue(binding);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;
    const remote = req.socket.remoteAddress;

    try {
      // ---------- agent API (loopback only) ----------
      if (path.startsWith('/agent/')) {
        if (!LOOPBACK.has(remote)) return text(res, 403, 'agent API is loopback-only');

        if (path === '/agent/gate' && req.method === 'POST') {
          const b = await readJson(req);
          const gate_kind = GATE_KINDS.includes(b.gate_kind) ? b.gate_kind : 'other';
          const modeDecision = enforceMode(b.mode, gate_kind);
          const approvalBinding = profile === 'bypass_tool_approvals'
            ? approvals.consume(b.trusted_tool_approval, gate_kind)
            : null;
          const humanDecision = decideHumanRequirement(gate_kind, profile, {
            trustedToolApproval: Boolean(approvalBinding),
          });
          const id = newGateId();

          if (!humanDecision.humanRequired) {
            gates.bypass({
              id,
              mode: modeDecision.mode,
              gate_kind,
              host: b.host,
              task: b.task,
              instruction: b.instruction,
              resumeHint: b.resume_hint,
              reason: humanDecision.reason,
              approvalBinding,
            });

            return json(res, 201, {
              id,
              state: 'retired',
              human_required: false,
              approval_profile: profile,
              mode: modeDecision.mode,
              mode_forced: modeDecision.forced,
              mode_reason: modeDecision.reason,
              console_url: null,
              pager_url: null,
            });
          }

          let frameSha = null;

          if (b.frame_base64) {
            const buf = Buffer.from(b.frame_base64, 'base64');
            frameSha = hashFrame(buf);
            gates.open({
              id, mode: modeDecision.mode, gate_kind, host: b.host, task: b.task,
              instruction: b.instruction, resumeHint: b.resume_hint, frameSha,
              handoffUrl: b.handoff_url, yieldTarget: b.yield_target,
            });
            gates.setFrame(id, buf, frameSha);
          } else {
            gates.open({
              id, mode: modeDecision.mode, gate_kind, host: b.host, task: b.task,
              instruction: b.instruction, resumeHint: b.resume_hint, frameSha: null,
              handoffUrl: b.handoff_url, yieldTarget: b.yield_target,
            });
          }

          if (modeDecision.forced) {
            ledger.append({
              id, event: 'rail.mode_forced', actor: 'rail', mode: 'yield', gate_kind,
              note: modeDecision.reason,
            });
          }

          return json(res, 201, {
            id,
            state: 'open',
            human_required: true,
            approval_profile: profile,
            mode: modeDecision.mode,
            mode_forced: modeDecision.forced,
            mode_reason: modeDecision.reason,
            console_url: `http://${lanAddress()}:${server.address().port}/h/${id}`,
            pager_url: `http://${lanAddress()}:${server.address().port}/pager`,
            verified_attachment_required: gates.requireVerifiedAttachment,
          });
        }

        const rm = path.match(/^\/agent\/gate\/([0-9a-f-]{36})\/retire$/i);
        if (rm && req.method === 'POST') {
          const b = await readJson(req);
          const g = gates.retire(rm[1], typeof b.note === 'string' ? b.note.slice(0, 200) : null);
          if (!g) return json(res, 404, { error: 'unknown or not-live gate' });
          return json(res, 200, { ok: true, id: rm[1], state: 'retired' });
        }

        const m = path.match(/^\/agent\/gate\/([0-9a-f-]{36})(\/frame)?$/i);
        if (m && req.method === 'GET' && !m[2]) {
          const g = gates.get(m[1]);
          const t = gates.readTicket(m[1]);
          if (!g && !t) return json(res, 404, { error: 'unknown gate' });
          return json(res, 200, {
            id: m[1],
            state: g ? g.state : t.state,
            outcome: t?.outcome ?? null,
            mode: g?.mode ?? t?.mode,
            assurance: g?.attachment?.assurance ?? t?.assurance ?? null,
            input_kinds: g?.inputKinds ?? {},
          });
        }
        if (m && m[2] && req.method === 'POST') {
          const b = await readJson(req);
          const buf = Buffer.from(b.frame_base64 || '', 'base64');
          gates.setFrame(m[1], buf, hashFrame(buf));
          return json(res, 200, { ok: true });
        }
        return json(res, 404, { error: 'no such agent route' });
      }

      // ---------- pager ----------
      if (path === '/pager') {
        const nonce = pageNonce();
        return html(res, 200, pagerPage({ nonce }), nonce);
      }
      if (path === '/pager/gates') {
        const open = [...gates.live.values()]
          .filter((g) => g.state === 'open' || g.state === 'attached' || g.state === 'acting')
          .map((g) => ({
            id: g.id,
            host: g.host,
            task: g.task,
            instruction: g.instruction,
            mode: g.mode,
            assurance: g.attachment?.assurance ?? null,
          }));
        return json(res, 200, open);
      }

      // ---------- human console ----------
      const hm = path.match(/^\/h\/([0-9a-f-]{36})(\/(frame|state|attach|input|release))?$/i);
      if (hm) {
        const g = gates.get(hm[1]);
        if (!g) return html(res, 404, '<body style="background:#0b0d10;color:#8b95a6;font:16px system-ui;padding:48px;text-align:center">This gate is no longer open.</body>');
        const sub = hm[3];

        if (!sub) {
          const nonce = pageNonce();
          return html(res, 200, gatePage(g, { nonce }), nonce);
        }

        if (sub === 'frame') {
          if (!g.frame) return text(res, 404, 'no frame');
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
          return res.end(g.frame);
        }
        if (sub === 'state') return json(res, 200, {
          state: g.state,
          mode: g.mode,
          assurance: g.attachment?.assurance ?? null,
          verified_attachment_required: gates.requireVerifiedAttachment,
        });

        if (sub === 'attach' && req.method === 'POST') {
          const b = await readJson(req);
          const device = ['phone', 'workstation'].includes(b.device) ? b.device : 'unknown';
          // The stock HTTP LAN route deliberately cannot submit a verification
          // decision. Only trusted host code may call GateRegistry.attach with
          // the bounded result of a real verifier adapter.
          const attached = gates.attach(g.id, { device });
          return json(res, 200, {
            ok: true,
            assurance: attached?.attachment?.assurance ?? null,
          });
        }

        if (sub === 'input' && req.method === 'POST') {
          if (g.mode !== 'attach') {
            return text(res, 409, 'this gate is yield-mode: the rail does not relay input into it');
          }
          let clean;
          try {
            clean = validateInput(await readJson(req));
          } catch (e) {
            return text(res, 400, e.message);
          }
          const attachmentCapability = req.headers['x-presence-attachment-capability'];
          gates.countInput(g.id, clean.kind, {
            attachmentCapability: typeof attachmentCapability === 'string'
              ? attachmentCapability
              : null,
          });
          if (onInput) await onInput(g, clean);
          return json(res, 200, { ok: true, assurance: g.attachment?.assurance ?? null });
        }

        if (sub === 'release' && req.method === 'POST') {
          const b = await readJson(req);
          const outcome = ['resumed', 'abandoned'].includes(b.outcome) ? b.outcome : 'resumed';
          const attachmentCapability = req.headers['x-presence-attachment-capability'];
          const released = gates.release(g.id, outcome, {
            attachmentCapability: typeof attachmentCapability === 'string'
              ? attachmentCapability
              : null,
          });
          return json(res, 200, {
            ok: true,
            assurance: released?.attachment?.assurance ?? null,
          });
        }
      }

      if (path === '/health') {
        return json(res, 200, {
          ok: true,
          lan: lanAddress(),
          approval_profile: profile,
          verified_attachment_required: gates.requireVerifiedAttachment,
        });
      }
      return text(res, 404, 'not found');
    } catch (e) {
      if (e instanceof AttachmentAssuranceError) return text(res, 403, e.message);
      return text(res, 500, e.message);
    }
  });

  return {
    server,
    gates,
    ledger,
    approvalProfile: profile,
    issueTrustedToolApproval,
  };
}
