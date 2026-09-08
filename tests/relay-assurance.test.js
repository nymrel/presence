import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createRelay } from '../src/relay.js';
import { newAttachmentCapability, sha256Text } from '../src/attachment-assurance.js';

async function startRelay({ requireVerifiedAttachment, onInput, ...options } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'presence-relay-auth-'));
  const relay = createRelay({
    ledgerPath: join(root, 'ledger.jsonl'),
    ticketDir: join(root, 'tickets'),
    onInput,
    requireVerifiedAttachment,
    ...options,
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

async function request(base, path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { response, text, json };
}

function verifiedAttach(relay, id) {
  const challenge = relay.gates.getAttachmentChallenge(id);
  const attachmentCapability = newAttachmentCapability();
  relay.gates.attach(id, {
    attachmentCapability,
    verification: {
      assurance: 'webauthn-verified',
      challenge_sha256: sha256Text(challenge),
      credential_sha256: 'a'.repeat(64),
      device: 'phone',
      gate_id: id,
      operator: 'jalen',
      user_verified: true,
      verified: true,
      verifier: 'test-webauthn-adapter',
    },
  });
  return attachmentCapability;
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
  test('HTML surfaces carry a nonce-bound restrictive CSP', async () => {
    const relay = await startRelay();
    try {
      const pager = await request(relay.base, '/pager');
      assert.equal(pager.response.status, 200);
      const policy = pager.response.headers.get('content-security-policy');
      assert.match(policy, /default-src 'self'/);
      assert.match(policy, /base-uri 'none'/);
      assert.match(policy, /frame-ancestors 'none'/);
      assert.match(policy, /object-src 'none'/);
      assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
      const nonce = policy.match(/script-src 'nonce-([^']+)'/)?.[1];
      assert.ok(nonce);
      assert.ok(pager.text.includes(`<script nonce="${nonce}">`));
      assert.equal(pager.response.headers.get('x-content-type-options'), 'nosniff');
    } finally {
      await stop(relay.server);
    }
  });

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

      const events = relay.ledger.receipt(id);
      assert.deepEqual(events.map((row) => row.event), ['gate.opened']);
    } finally {
      await stop(relay.server);
    }
  });

  test('non-strict relay still rejects input and release before console attach', async () => {
    let injected = 0;
    const relay = await startRelay({
      requireVerifiedAttachment: false,
      onInput: async () => { injected += 1; },
    });
    try {
      const id = await openGate(relay.base);
      const input = await request(relay.base, `/h/${id}/input`, {
        method: 'POST',
        body: { kind: 'pointer', action: 'click', x: 1, y: 1, button: 'left' },
      });
      assert.equal(input.response.status, 403);
      assert.match(input.text, /console attachment is required/);
      assert.equal(injected, 0, 'input injector must not run before attachment');

      const released = await request(relay.base, `/h/${id}/release`, {
        method: 'POST',
        body: { outcome: 'resumed' },
      });
      assert.equal(released.response.status, 403);
      assert.match(released.text, /console attachment is required/);
      assert.deepEqual(relay.ledger.receipt(id).map((row) => row.event), ['gate.opened']);
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

  test('verified input and release require the exact gate-bound capability', async () => {
    let injected = 0;
    const relay = await startRelay({
      requireVerifiedAttachment: true,
      onInput: async () => { injected += 1; },
    });
    try {
      const firstId = await openGate(relay.base);
      const secondId = await openGate(relay.base);
      const firstAttachChallenge = relay.gates.getAttachmentChallenge(firstId);
      const firstCapability = verifiedAttach(relay, firstId);
      const secondCapability = verifiedAttach(relay, secondId);

      const withoutCapability = await request(relay.base, `/h/${firstId}/release`, {
        method: 'POST',
        body: { outcome: 'resumed' },
      });
      assert.equal(withoutCapability.response.status, 403);
      assert.match(withoutCapability.text, /capability is required/);

      const reusedAttachProof = await request(relay.base, `/h/${firstId}/release`, {
        method: 'POST',
        headers: { 'x-presence-attachment-capability': firstAttachChallenge },
        body: { outcome: 'resumed' },
      });
      assert.equal(reusedAttachProof.response.status, 403);
      assert.match(reusedAttachProof.text, /capability is invalid/);

      const wrongCaller = await request(relay.base, `/h/${firstId}/input`, {
        method: 'POST',
        headers: { 'x-presence-attachment-capability': secondCapability },
        body: { kind: 'pointer', action: 'click', x: 1, y: 1, button: 'left' },
      });
      assert.equal(wrongCaller.response.status, 403);
      assert.match(wrongCaller.text, /capability is invalid/);
      assert.equal(injected, 0);

      const acceptedInput = await request(relay.base, `/h/${firstId}/input`, {
        method: 'POST',
        headers: { 'x-presence-attachment-capability': firstCapability },
        body: { kind: 'pointer', action: 'click', x: 1, y: 1, button: 'left' },
      });
      assert.equal(acceptedInput.response.status, 200);
      assert.equal(injected, 1);

      const acceptedRelease = await request(relay.base, `/h/${firstId}/release`, {
        method: 'POST',
        headers: { 'x-presence-attachment-capability': firstCapability },
        body: { outcome: 'resumed' },
      });
      assert.equal(acceptedRelease.response.status, 200);
      assert.equal(acceptedRelease.json.assurance, 'webauthn-verified');

      const publicState = await (await fetch(`${relay.base}/pager/gates`)).text();
      const durableState = JSON.stringify(relay.ledger.receipt(firstId))
        + JSON.stringify(relay.gates.readTicket(firstId));
      assert.ok(!publicState.includes(firstCapability), 'pager must not expose the capability');
      assert.ok(!durableState.includes(firstCapability), 'ledger and ticket must not retain it');
    } finally {
      await stop(relay.server);
    }
  });

  test('verified attachment capability expires before release', async () => {
    let now = 10_000;
    const relay = await startRelay({
      requireVerifiedAttachment: true,
      attachmentCapabilityTtlMs: 100,
      now: () => now,
    });
    try {
      const id = await openGate(relay.base);
      const capability = verifiedAttach(relay, id);
      now += 100;

      const released = await request(relay.base, `/h/${id}/release`, {
        method: 'POST',
        headers: { 'x-presence-attachment-capability': capability },
        body: { outcome: 'resumed' },
      });
      assert.equal(released.response.status, 403);
      assert.match(released.text, /capability expired/);
      assert.equal(relay.gates.get(id).state, 'attached');
      assert.equal(
        relay.ledger.receipt(id).filter((row) => row.event === 'human.released').length,
        0,
      );
    } finally {
      await stop(relay.server);
    }
  });

  test('concurrent and replayed releases append one verified event', async () => {
    const relay = await startRelay({ requireVerifiedAttachment: true });
    try {
      const id = await openGate(relay.base);
      const capability = verifiedAttach(relay, id);
      const release = () => request(relay.base, `/h/${id}/release`, {
        method: 'POST',
        headers: { 'x-presence-attachment-capability': capability },
        body: { outcome: 'resumed' },
      });

      const concurrent = await Promise.all([release(), release()]);
      assert.deepEqual(
        concurrent.map((result) => result.response.status).sort(),
        [200, 403],
      );
      assert.equal(
        relay.ledger.receipt(id).filter((row) => row.event === 'human.released').length,
        1,
      );
      assert.equal((await release()).response.status, 403, 'release capability cannot replay');
    } finally {
      await stop(relay.server);
    }
  });
});
