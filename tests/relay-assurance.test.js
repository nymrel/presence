import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createRelay } from '../src/relay.js';

async function startRelay({ requireVerifiedAttachment, onInput } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'presence-relay-auth-'));
  const relay = createRelay({
    ledgerPath: join(root, 'ledger.jsonl'),
    ticketDir: join(root, 'tickets'),
    onInput,
    requireVerifiedAttachment,
  });
  await new Promise((resolve, reject) => {
    relay.server.once('error', reject);
    relay.server.listen(0, '127.0.0.1', resolve);
  });
  const address = relay.server.address();
  assert.ok(address && typeof address === 'object');
  return {
    ...relay,
    base: `http://127.0.0.1:${address.port}`,
  };
}

async function stop(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function request(base, path, { method = 'GET', body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { response, text, json };
}

async function openGate(base) {
  const opened = await request(base, '/agent/gate', {
    method: 'POST',
    body: {
      mode: 'attach',
      gate_kind: 'consent',
      host: 'console.example.test',
      task: 'Approve bounded work',
      instruction: 'Review and approve',
      resume_hint: 'resume',
    },
  });
  assert.equal(opened.response.status, 201);
  assert.equal(typeof opened.json.id, 'string');
  return opened.json.id;
}

describe('relay assurance boundary', () => {
  test('strict mode blocks stock LAN attach, input, and release before side effects', async () => {
    let injected = 0;
    const relay = await startRelay({
      requireVerifiedAttachment: true,
      onInput: async () => { injected += 1; },
    });
    try {
      const id = await openGate(relay.base);

      const attached = await request(relay.base, `/h/${id}/attach`, {
        method: 'POST',
        body: { device: 'phone' },
      });
      assert.equal(attached.response.status, 403);
      assert.match(attached.text, /verified attachment is required/);

      const input = await request(relay.base, `/h/${id}/input`, {
        method: 'POST',
        body: { kind: 'pointer', action: 'click', x: 1, y: 1, button: 'left' },
      });
      assert.equal(input.response.status, 403);
      assert.equal(injected, 0, 'strict refusal must happen before the input injector');

      const released = await request(relay.base, `/h/${id}/release`, {
        method: 'POST',
        body: { outcome: 'resumed' },
      });
      assert.equal(released.response.status, 403);

      const state = await request(relay.base, `/agent/gate/${id}`);
      assert.equal(state.response.status, 200);
      assert.equal(state.json.state, 'open');
      assert.equal(state.json.assurance, null);
      assert.equal(state.json.verified_attachment_required, undefined);

      const events = relay.ledger.receipt(id);
      assert.deepEqual(events.map((row) => row.event), ['gate.opened']);
    } finally {
      await stop(relay.server);
    }
  });

  test('stock LAN route cannot promote a browser self-claim to verified assurance', async () => {
    const relay = await startRelay({ requireVerifiedAttachment: false });
    try {
      const id = await openGate(relay.base);
      const attached = await request(relay.base, `/h/${id}/attach`, {
        method: 'POST',
        body: {
          device: 'phone',
          verification: {
            verified: true,
            assurance: 'webauthn-verified',
            operator: 'attacker-selected',
          },
        },
      });
      assert.equal(attached.response.status, 200);
      assert.equal(attached.json.assurance, 'lan-unverified');

      const state = await request(relay.base, `/agent/gate/${id}`);
      assert.equal(state.json.assurance, 'lan-unverified');

      const released = await request(relay.base, `/h/${id}/release`, {
        method: 'POST',
        body: { outcome: 'resumed' },
      });
      assert.equal(released.response.status, 200);
      assert.equal(released.json.assurance, 'lan-unverified');

      const events = relay.ledger.receipt(id);
      assert.ok(events.some((row) => row.event === 'console.attached'));
      assert.ok(events.some((row) => row.event === 'console.released'));
      assert.ok(!events.some((row) => row.event === 'human.attached'));
      assert.ok(!events.some((row) => row.operator === 'attacker-selected'));
      assert.equal(relay.ledger.verify().ok, true);
    } finally {
      await stop(relay.server);
    }
  });
});
