import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  AttachmentAssuranceError,
  sha256Text,
  verifiedAttachmentDecision,
} from '../src/attachment-assurance.js';
import { GateRegistry } from '../src/gates.js';
import { PresenceLedger } from '../src/ledger.js';

function fixture({ requireVerifiedAttachment = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'presence-auth-'));
  const ledger = new PresenceLedger(join(root, 'ledger.jsonl'));
  const gates = new GateRegistry({
    ledger,
    ticketDir: join(root, 'tickets'),
    requireVerifiedAttachment,
  });
  const id = 'gate-auth-test';
  gates.open({
    id,
    mode: 'attach',
    gate_kind: 'consent',
    host: 'console.example.test',
    task: 'Approve a bounded change',
    instruction: 'Review and approve',
    resumeHint: 'resume after approval',
    frameSha: null,
    handoffUrl: null,
    yieldTarget: 'agent_window',
  });
  return { gates, id, ledger };
}

function verifiedDecision(gates, id, overrides = {}) {
  const challenge = gates.getAttachmentChallenge(id);
  assert.equal(typeof challenge, 'string');
  return {
    assurance: 'webauthn-verified',
    challenge_sha256: sha256Text(challenge),
    credential_sha256: 'a'.repeat(64),
    device: 'phone',
    gate_id: id,
    operator: 'jalen',
    user_verified: true,
    verified: true,
    verifier: 'test-webauthn-adapter',
    ...overrides,
  };
}

describe('attachment assurance is honest by construction', () => {
  test('LAN arrival emits console events, never verified-human events', () => {
    const { gates, id, ledger } = fixture();
    const gate = gates.attach(id, { operator: 'claimed-name', device: 'phone' });

    assert.equal(gate.attachment.assurance, 'lan-unverified');
    assert.equal(gate.operator, null, 'an unverified caller cannot select an operator identity');
    gates.release(id, 'resumed');

    const events = ledger.receipt(id);
    assert.ok(events.some((row) => row.event === 'console.attached'));
    assert.ok(events.some((row) => row.event === 'console.released'));
    assert.ok(!events.some((row) => row.event === 'human.attached'));
    assert.ok(!events.some((row) => row.event === 'human.released'));
    assert.ok(events.every((row) => row.operator === undefined));
    assert.equal(ledger.verify().ok, true);
  });

  test('strict mode refuses unverified attach, input, and release', () => {
    const { gates, id, ledger } = fixture({ requireVerifiedAttachment: true });

    assert.throws(
      () => gates.attach(id, { device: 'phone' }),
      AttachmentAssuranceError,
    );
    assert.equal(gates.get(id).state, 'open');
    assert.throws(() => gates.countInput(id, 'pointer'), AttachmentAssuranceError);
    assert.throws(() => gates.release(id, 'resumed'), AttachmentAssuranceError);

    const events = ledger.receipt(id);
    assert.deepEqual(events.map((row) => row.event), ['gate.opened']);
  });

  test('a gate-bound verified decision may emit human events', () => {
    const { gates, id, ledger } = fixture({ requireVerifiedAttachment: true });
    const decision = verifiedDecision(gates, id);

    const gate = gates.attach(id, { device: 'unknown', verification: decision });
    assert.equal(gate.attachment.assurance, 'webauthn-verified');
    assert.equal(gate.operator, 'jalen');
    assert.equal(gates.getAttachmentChallenge(id), null, 'verified challenge is consumed');

    gates.countInput(id, 'pointer');
    gates.release(id, 'resumed');

    const attached = ledger.receipt(id).find((row) => row.event === 'human.attached');
    const released = ledger.receipt(id).find((row) => row.event === 'human.released');
    assert.equal(attached.actor, 'human');
    assert.equal(attached.assurance, 'webauthn-verified');
    assert.equal(attached.operator, 'jalen');
    assert.equal(attached.credential_sha256, 'a'.repeat(64));
    assert.equal(attached.challenge_sha256, decision.challenge_sha256);
    assert.equal(attached.user_verified, true);
    assert.equal(released.assurance, 'webauthn-verified');
    assert.equal(ledger.verify().ok, true);
  });

  test('gate, challenge, UV, and exact-field bindings fail closed', () => {
    const { gates, id } = fixture();
    const challenge = gates.getAttachmentChallenge(id);

    assert.throws(
      () => verifiedAttachmentDecision(
        verifiedDecision(gates, id, { gate_id: 'another-gate' }),
        { gateId: id, challenge },
      ),
      /different gate/,
    );
    assert.throws(
      () => gates.attach(id, {
        verification: verifiedDecision(gates, id, { challenge_sha256: 'b'.repeat(64) }),
      }),
      /active challenge/,
    );
    assert.throws(
      () => gates.attach(id, {
        verification: verifiedDecision(gates, id, { user_verified: false }),
      }),
      /user verification is required/,
    );
    assert.throws(
      () => gates.attach(id, {
        verification: { ...verifiedDecision(gates, id), raw_assertion: 'forbidden' },
      }),
      /fields are not exact/,
    );
  });

  test('raw authentication material has no ledger field', () => {
    const { ledger } = fixture();
    for (const field of [
      'assertion',
      'challenge',
      'credential_id',
      'signature',
      'authenticator_data',
      'client_data_json',
      'user_handle',
      'public_key',
    ]) {
      assert.throws(
        () => ledger.append({ id: 'raw-proof', event: 'x', [field]: 'secret' }),
        /forbidden field/,
        `${field} must never enter the ledger`,
      );
    }
  });
});
