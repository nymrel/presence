/**
 * These tests are the product's spine. They assert that the rail is
 * STRUCTURALLY incapable of the thing we refused to build — not merely
 * disinclined. If one of these ever needs "adjusting" to let a feature land,
 * the feature is the problem.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { GateRegistry, GATE_KINDS } from '../src/gates.js';
import { PresenceLedger } from '../src/ledger.js';
import {
  APPROVAL_PROFILES,
  BYPASSABLE_GATE_KINDS,
  decideHumanRequirement,
  enforceMode,
  normalizeApprovalProfile,
  validateInput,
  YIELD_ONLY,
} from '../src/policy.js';
import { Presence } from '../src/client.js';
import { createRelay } from '../src/relay.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('the rail cannot carry a solved answer', () => {
  test('validateInput rejects every known challenge-response field', () => {
    for (const field of [
      'token', 'response', 'g-recaptcha-response', 'h-captcha-response',
      'cf-turnstile-response', 'solution', 'answer', 'otp', 'password', 'secret',
    ]) {
      assert.throws(
        () => validateInput({ kind: 'pointer', action: 'click', x: 1, y: 1, [field]: 'x' }),
        /refused/i,
        `field "${field}" must be refused`
      );
    }
  });

  test('only pointer/key/scroll message kinds exist', () => {
    assert.throws(() => validateInput({ kind: 'submit_token', value: 'x' }), /unsupported input kind/);
    assert.throws(() => validateInput({ kind: 'solve' }), /unsupported input kind/);
    assert.deepEqual(validateInput({ kind: 'pointer', action: 'click', x: 4, y: 9 }),
      { kind: 'pointer', action: 'click', x: 4, y: 9 });
  });

  test('unknown fields are refused rather than silently passed through', () => {
    assert.throws(() => validateInput({ kind: 'pointer', x: 1, y: 1, secretSauce: 'z' }), /not allowed/);
  });
});

describe('anti-bot challenges can never use the attach channel', () => {
  test('anti_bot is forced to yield even when attach is requested', () => {
    const d = enforceMode('attach', 'anti_bot');
    assert.equal(d.mode, 'yield');
    assert.equal(d.forced, true);
    assert.match(d.reason, /own browser/);
  });

  test('otp and identity are yield-only too', () => {
    for (const k of ['otp', 'identity']) assert.equal(enforceMode('attach', k).mode, 'yield');
  });

  test('the yield-only list still contains anti_bot', () => {
    assert.ok(YIELD_ONLY.includes('anti_bot'),
      'removing anti_bot from YIELD_ONLY converts this product into a bypass service');
  });
});

describe('the ledger cannot record what a human entered', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'presence-')), 'l.jsonl');

  test('forbidden fields throw rather than write', () => {
    const l = new PresenceLedger(path);
    for (const f of ['token', 'password', 'address', 'value', 'text', 'url', 'cookie']) {
      assert.throws(() => l.append({ id: 'a', event: 'x', [f]: 'sensitive' }), /forbidden field/);
    }
  });

  test('unknown fields are dropped, not stored', () => {
    const l = new PresenceLedger(path);
    const rec = l.append({ id: 'a', event: 'gate.opened', host: 'example.gov', somethingElse: 'leak' });
    assert.equal(rec.somethingElse, undefined);
    assert.equal(rec.host, 'example.gov');
  });

  test('input_kinds keeps counts and discards anything non-numeric', () => {
    const l = new PresenceLedger(path);
    const rec = l.append({ id: 'b', event: 'human.released', input_kinds: { pointer: 2, key: '4242424242424242' } });
    assert.equal(rec.input_kinds.pointer, 2);
    assert.equal(rec.input_kinds.key, undefined, 'a non-integer must never survive into the ledger');
  });

  test('the hash chain detects tampering', () => {
    const l = new PresenceLedger(path);
    assert.equal(l.verify().ok, true);
  });
});

describe('approval profiles fail closed', () => {
  test('the regular profile still prompts for local tool approvals', () => {
    const d = decideHumanRequirement('tool_approval', 'prompt');
    assert.equal(d.humanRequired, true);
    assert.equal(d.approvalProfile, 'prompt');
  });

  test('the permissive profile bypasses only local tool approvals', () => {
    assert.deepEqual(BYPASSABLE_GATE_KINDS, ['tool_approval']);
    assert.equal(
      decideHumanRequirement('tool_approval', 'bypass_tool_approvals').humanRequired,
      false
    );

    for (const kind of GATE_KINDS.filter((k) => k !== 'tool_approval')) {
      assert.equal(
        decideHumanRequirement(kind, 'bypass_tool_approvals').humanRequired,
        true,
        `${kind} must remain human-required`
      );
    }
  });

  test('unknown profiles normalize to prompt', () => {
    assert.deepEqual(APPROVAL_PROFILES, ['prompt', 'bypass_tool_approvals']);
    assert.equal(normalizeApprovalProfile('bypass_all'), 'prompt');
    assert.equal(decideHumanRequirement('tool_approval', 'bypass_all').humanRequired, true);
  });

  test('a bypass writes a durable terminal ticket without forging a human event', () => {
    const root = mkdtempSync(join(tmpdir(), 'presence-bypass-'));
    const ledger = new PresenceLedger(join(root, 'ledger.jsonl'));
    const gates = new GateRegistry({ ledger, ticketDir: join(root, 'tickets') });
    const id = '00000000-0000-4000-8000-000000000001';

    assert.throws(
      () => gates.bypass({
        id: '00000000-0000-4000-8000-000000000000',
        mode: 'yield',
        gate_kind: 'payment',
        host: 'example.com',
        task: 'Pay',
        instruction: 'Confirm payment',
        resumeHint: 'continue',
        reason: 'must not matter',
      }),
      /approval bypass refused/
    );

    const ticket = gates.bypass({
      id,
      mode: 'attach',
      gate_kind: 'tool_approval',
      host: 'localhost',
      task: 'Run approved test suite',
      instruction: 'Approve the local tool call',
      resumeHint: 'continue after approval',
      reason: 'operator profile pre-authorized local tool prompts',
    });

    assert.equal(ticket.state, 'retired');
    assert.equal(ticket.outcome, 'retired');
    assert.equal(gates.get(id), null);

    const rows = ledger.receipt(id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event, 'rail.approval_bypassed');
    assert.equal(rows[0].actor, 'rail');
    assert.equal(rows.some((r) => r.event.startsWith('human.')), false);
  });

  test('the client treats retired as terminal instead of timing out', async () => {
    const presence = new Presence('http://unused');
    presence.poll = async (id) => ({ id, state: 'retired' });
    const state = await presence.waitForHuman('gate', { timeoutMs: 25, intervalMs: 1 });
    assert.equal(state.state, 'retired');
  });

  test('an agent request cannot select the permissive profile', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'presence-relay-prompt-'));
    const { server } = createRelay({
      ledgerPath: join(root, 'ledger.jsonl'),
      ticketDir: join(root, 'tickets'),
      approvalProfile: 'prompt',
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const base = `http://127.0.0.1:${server.address().port}`;
    const opened = await fetch(`${base}/agent/gate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'attach',
        gate_kind: 'tool_approval',
        approval_profile: 'bypass_tool_approvals',
        host: 'localhost',
        task: 'Attempt self-promotion',
        instruction: 'Approve this local tool call',
      }),
    });

    assert.equal(opened.status, 201);
    const body = await opened.json();
    assert.equal(body.state, 'open');
    assert.equal(body.human_required, true);
    assert.equal(body.approval_profile, 'prompt');

    const pager = await (await fetch(`${base}/pager/gates`)).json();
    assert.equal(pager.length, 1);
    assert.equal(pager[0].id, body.id);
  });

  test('the relay returns a pollable retired gate without paging a human', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'presence-relay-'));
    const { server } = createRelay({
      ledgerPath: join(root, 'ledger.jsonl'),
      ticketDir: join(root, 'tickets'),
      approvalProfile: 'bypass_tool_approvals',
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const base = `http://127.0.0.1:${server.address().port}`;
    const opened = await fetch(`${base}/agent/gate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'attach',
        gate_kind: 'tool_approval',
        host: 'localhost',
        task: 'Run the approved local test command',
        instruction: 'Approve this local tool call',
      }),
    });

    assert.equal(opened.status, 201);
    const body = await opened.json();
    assert.equal(body.state, 'retired');
    assert.equal(body.human_required, false);
    assert.equal(body.approval_profile, 'bypass_tool_approvals');
    assert.equal(body.console_url, null);
    assert.equal(body.pager_url, null);

    const polled = await (await fetch(`${base}/agent/gate/${body.id}`)).json();
    assert.equal(polled.state, 'retired');
    assert.equal(polled.outcome, 'retired');

    const pager = await (await fetch(`${base}/pager/gates`)).json();
    assert.deepEqual(pager, []);
  });
});

describe('the browser does not pretend to be human', () => {
  const STEALTH_PATTERNS = [
    'AutomationControlled',
    'navigator.webdriver',
    'stealth',
    'puppeteer-extra',
    'undetected',
    'anti-detect',
    'humanize',
    'randomDelay',
    'bezier',
  ];

  test('no stealth or anti-detection technique appears anywhere in src/', () => {
    const offenders = [];
    for (const f of readdirSync(SRC)) {
      if (!f.endsWith('.js')) continue;
      const body = readFileSync(join(SRC, f), 'utf8');
      // strip comments so our own prose about NOT doing this doesn't trip the test
      const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const p of STEALTH_PATTERNS) {
        if (code.includes(p)) offenders.push(`${f}: ${p}`);
      }
    }
    assert.deepEqual(offenders, [],
      `stealth technique found — the rail must never hide that it is automated:\n${offenders.join('\n')}`);
  });

  test('no captcha-solving vendor is referenced', () => {
    const vendors = ['2captcha', 'anti-captcha', 'anticaptcha', 'capmonster', 'deathbycaptcha', 'capsolver'];
    for (const f of readdirSync(SRC)) {
      if (!f.endsWith('.js')) continue;
      const body = readFileSync(join(SRC, f), 'utf8').toLowerCase();
      for (const v of vendors) assert.ok(!body.includes(v), `${f} references solving vendor ${v}`);
    }
  });

  test('package.json has no dependencies that could carry a solver', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8'));
    assert.deepEqual(pkg.dependencies, {}, 'the rail runs on zero dependencies on purpose');
  });
});
