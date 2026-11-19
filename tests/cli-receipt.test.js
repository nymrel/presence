import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PresenceLedger } from '../src/ledger.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const ID = 'receipt-fixture';

function receipt(t, records) {
  const root = mkdtempSync(join(tmpdir(), 'presence-receipt-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ledgerPath = join(root, 'ledger.jsonl');
  const ledger = new PresenceLedger(ledgerPath);
  ledger.append({
    id: ID, event: 'gate.opened', actor: 'agent', mode: 'attach',
    gate_kind: 'consent', host: 'console.example.test',
    task: 'Review a synthetic change', instruction: 'Review and approve',
  });
  for (const record of records) ledger.append({ id: ID, ...record });
  assert.equal(ledger.verify().ok, true);

  const result = spawnSync(process.execPath, [CLI, 'receipt', ID], {
    encoding: 'utf8',
    env: { ...process.env, PRESENCE_LEDGER: ledgerPath },
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

const consoleAssurance = {
  actor: 'rail', assurance: 'lan-unverified', user_verified: false, device: 'phone',
};
const humanAssurance = {
  actor: 'human', assurance: 'webauthn-verified', user_verified: true,
  device: 'phone', operator: 'test-operator', verifier: 'test-adapter',
  credential_sha256: 'a'.repeat(64), challenge_sha256: 'b'.repeat(64),
};

for (const outcome of ['resumed', 'abandoned']) {
  test(`CLI shows an unverified console ${outcome} receipt without claiming a verified human`, (t) => {
    const output = receipt(t, [
      { event: 'console.attached', ...consoleAssurance },
      { event: 'console.released', ...consoleAssurance, outcome, input_kinds: { pointer: 2, key: 6 } },
    ]);
    assert.match(output, /console arrived .*assurance=lan-unverified device=phone/);
    assert.match(output, /human attached  — never/);
    assert.match(output, new RegExp(`released .*actor=rail assurance=lan-unverified outcome=${outcome}`));
    assert.match(output, /console attention \d+s/);
    assert.match(output, /input relayed   2× pointer, 6× key/);
    assert.doesNotMatch(output, /still open|operator=|human attention/);
  });
}

test('CLI keeps an attached but unreleased console open', (t) => {
  const output = receipt(t, [{ event: 'console.attached', ...consoleAssurance }]);
  assert.match(output, /console arrived .*assurance=lan-unverified/);
  assert.match(output, /released        — still open/);
  assert.doesNotMatch(output, /console attention/);
});

test('CLI preserves verified-human assurance after a console attachment upgrade', (t) => {
  const output = receipt(t, [
    { event: 'console.attached', ...consoleAssurance },
    { event: 'human.attached', ...humanAssurance },
    { event: 'human.released', ...humanAssurance, outcome: 'resumed', input_kinds: { pointer: 1 } },
  ]);
  assert.match(output, /console arrived .*assurance=lan-unverified/);
  assert.match(output, /human attached .*assurance=webauthn-verified operator=test-operator/);
  assert.match(output, /released .*actor=human assurance=webauthn-verified outcome=resumed/);
  assert.match(output, /human attention \d+s/);
  assert.match(output, /input relayed   1× pointer/);
  assert.doesNotMatch(output, /still open/);
});

test('CLI reports an agent-retired gate as terminal without human participation', (t) => {
  const output = receipt(t, [{ event: 'gate.retired', actor: 'agent', outcome: 'retired' }]);
  assert.match(output, /released .*actor=agent outcome=retired/);
  assert.match(output, /human attached  — never/);
  assert.doesNotMatch(output, /still open|human attention|console attention/);
});

test('CLI preserves trusted tool-approval bypass labeling', (t) => {
  const output = receipt(t, [{
    event: 'rail.approval_bypassed', actor: 'rail', gate_kind: 'tool_approval',
    outcome: 'retired', invocation_id: 'test-invocation', tool_name: 'test-tool',
    action_sha256: 'c'.repeat(64), note: 'trusted synthetic invocation',
  }]);
  assert.match(output, /approval        retired by operator profile/);
  assert.match(output, /asked of human  — not paged/);
  assert.match(output, /released        — retired by rail/);
  assert.doesNotMatch(output, /still open|human attention|console attention/);
});
