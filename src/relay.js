/**
 * The relay: one HTTP server with two faces.
 *
 *   /agent/*  — bound to loopback callers only. The agent opens gates here.
 *   /h/*      — the human console, reachable from the operator's phone on the LAN.
 *   /pager    — the page the operator keeps open. It buzzes.
 *
 * Deliberately LAN-only. There is no cloud hop, so a screenshot of a
 * half-filled government form never leaves the operator's own network. That
 * started as a constraint (no spend, no accounts) and turned out to be the
 * better design.
 */

import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { GateRegistry, GATE_KINDS } from './gates.js';
import { PresenceLedger, newGateId, hashFrame } from './ledger.js';
import { enforceMode, validateInput } from './policy.js';
import { gatePage, pagerPage } from './console-ui.js';

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
function html(res, code, body) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
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
 */
export function createRelay({ ledgerPath, ticketDir, onInput }) {
  const ledger = new PresenceLedger(ledgerPath);
  const gates = new GateRegistry({ ledger, ticketDir });

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
          const decision = enforceMode(b.mode, gate_kind);
          const id = newGateId();
          let frameSha = null;

          if (b.frame_base64) {
            const buf = Buffer.from(b.frame_base64, 'base64');
            frameSha = hashFrame(buf);
            gates.open({
              id, mode: decision.mode, gate_kind, host: b.host, task: b.task,
              instruction: b.instruction, resumeHint: b.resume_hint, frameSha,
              handoffUrl: b.handoff_url, yieldTarget: b.yield_target,
            });
            gates.setFrame(id, buf, frameSha);
          } else {
            gates.open({
              id, mode: decision.mode, gate_kind, host: b.host, task: b.task,
              instruction: b.instruction, resumeHint: b.resume_hint, frameSha: null,
              handoffUrl: b.handoff_url, yieldTarget: b.yield_target,
            });
          }

          if (decision.forced) {
            ledger.append({
              id, event: 'rail.mode_forced', actor: 'rail', mode: 'yield', gate_kind,
              note: decision.reason,
            });
          }

          return json(res, 201, {
            id,
            mode: decision.mode,
            mode_forced: decision.forced,
            mode_reason: decision.reason,
            console_url: `http://${lanAddress()}:${server.address().port}/h/${id}`,
            pager_url: `http://${lanAddress()}:${server.address().port}/pager`,
          });
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
      if (path === '/pager') return html(res, 200, pagerPage());
      if (path === '/pager/gates') {
        const open = [...gates.live.values()]
          .filter((g) => g.state === 'open' || g.state === 'attached' || g.state === 'acting')
          .map((g) => ({ id: g.id, host: g.host, task: g.task, instruction: g.instruction, mode: g.mode }));
        return json(res, 200, open);
      }

      // ---------- human console ----------
      const hm = path.match(/^\/h\/([0-9a-f-]{36})(\/(frame|state|attach|input|release))?$/i);
      if (hm) {
        const g = gates.get(hm[1]);
        if (!g) return html(res, 404, '<body style="background:#0b0d10;color:#8b95a6;font:16px system-ui;padding:48px;text-align:center">This gate is no longer open.</body>');
        const sub = hm[3];

        if (!sub) return html(res, 200, gatePage(g));

        if (sub === 'frame') {
          if (!g.frame) return text(res, 404, 'no frame');
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
          return res.end(g.frame);
        }
        if (sub === 'state') return json(res, 200, { state: g.state, mode: g.mode });

        if (sub === 'attach' && req.method === 'POST') {
          const b = await readJson(req);
          const device = ['phone', 'workstation'].includes(b.device) ? b.device : 'unknown';
          gates.attach(g.id, { operator: process.env.PRESENCE_OPERATOR || 'operator', device });
          return json(res, 200, { ok: true });
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
          gates.countInput(g.id, clean.kind); // counts only — contents are never recorded
          if (onInput) await onInput(g, clean);
          return json(res, 200, { ok: true });
        }

        if (sub === 'release' && req.method === 'POST') {
          const b = await readJson(req);
          const outcome = ['resumed', 'abandoned'].includes(b.outcome) ? b.outcome : 'resumed';
          gates.release(g.id, outcome);
          return json(res, 200, { ok: true });
        }
      }

      if (path === '/health') return json(res, 200, { ok: true, lan: lanAddress() });
      return text(res, 404, 'not found');
    } catch (e) {
      return text(res, 500, e.message);
    }
  });

  return { server, gates, ledger };
}
