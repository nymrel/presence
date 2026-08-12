#!/usr/bin/env node
/**
 * presence serve    — run the relay (agent API on loopback, console on LAN)
 * presence pager    — print the URL/QR the operator opens on their phone
 * presence receipt  — print the full audit record for one gate
 * presence verify   — verify the ledger hash chain end to end
 * presence open     — list gates still waiting on a human
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelay, lanAddress } from './relay.js';
import { PresenceLedger } from './ledger.js';
import { CdpPage } from './bridge-cdp.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = process.env.PRESENCE_LEDGER || join(ROOT, 'var', 'presence-ledger.jsonl');
const TICKETS = process.env.PRESENCE_TICKETS || join(ROOT, 'var', 'tickets');
const PORT = Number(process.env.PRESENCE_PORT || 8787);

const [, , cmd, ...rest] = process.argv;

if (cmd === 'serve') {
  // Optional attach-mode injector: if a CDP browser is up, relay human input to it.
  let page = null;
  const cdpPort = Number(process.env.PRESENCE_CDP_PORT || 0);

  const onInput = async (gate, input) => {
    if (!cdpPort) return;
    if (!page) page = await CdpPage.open(cdpPort).catch(() => null);
    if (!page) return;
    if (input.kind === 'pointer') await page.click(input.x, input.y, input.button || 'left');
    else if (input.kind === 'key') await page.key(input.key);
  };

  const { server } = createRelay({ ledgerPath: LEDGER, ticketDir: TICKETS, onInput });
  server.listen(PORT, '0.0.0.0', () => {
    const lan = lanAddress();
    console.log(`presence relay up`);
    console.log(`  agent API   http://127.0.0.1:${PORT}/agent   (loopback only)`);
    console.log(`  pager       http://${lan}:${PORT}/pager      <- open this on the phone`);
    console.log(`  ledger      ${LEDGER}`);
    if (cdpPort) console.log(`  attach      relaying input to CDP :${cdpPort}`);
  });
}

else if (cmd === 'pager') {
  console.log(`http://${lanAddress()}:${PORT}/pager`);
}

else if (cmd === 'verify') {
  const l = new PresenceLedger(LEDGER);
  const v = l.verify();
  console.log(v.ok
    ? `ledger OK — ${v.length} records, chain intact`
    : `LEDGER BROKEN at seq ${v.brokenAt}: ${v.reason}`);
  process.exit(v.ok ? 0 : 1);
}

else if (cmd === 'receipt') {
  const id = rest[0];
  if (!id) { console.error('usage: presence receipt <gate-id>'); process.exit(2); }
  const rows = new PresenceLedger(LEDGER).receipt(id);
  if (!rows.length) { console.error('no such gate'); process.exit(1); }
  console.log(renderReceipt(rows));
}

else if (cmd === 'open') {
  const l = new PresenceLedger(LEDGER);
  const byId = new Map();
  for (const r of l.all()) byId.set(r.id, { ...(byId.get(r.id) || {}), ...r });
  const open = [...byId.values()].filter((g) => !g.outcome);
  if (!open.length) console.log('nothing waiting on a human');
  for (const g of open) console.log(`${g.id}  ${g.host}  ${g.instruction ?? ''}`);
}

else {
  console.log(`presence <serve|pager|open|receipt <id>|verify>`);
}

function renderReceipt(rows) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const attached = rows.find((r) => r.event === 'human.attached');
  const released = rows.find((r) => r.event === 'human.released');
  const forced = rows.find((r) => r.event === 'rail.mode_forced');

  const secs = attached && released
    ? Math.round((new Date(released.at) - new Date(attached.at)) / 1000) : null;

  const L = [];
  L.push(`PRESENCE RECEIPT  ${first.id}`);
  L.push(`${'='.repeat(56)}`);
  L.push(`gate            ${first.gate_kind} on ${first.host}`);
  L.push(`mode            ${last.mode ?? first.mode}${forced ? '  (forced by policy)' : ''}`);
  if (forced) L.push(`  reason        ${forced.note}`);
  L.push(`agent task      ${first.task ?? '—'}`);
  L.push(`asked of human  ${first.instruction ?? '—'}`);
  L.push(`frame shown     sha256:${(first.frame_sha256 || 'none').slice(0, 32)}…`);
  L.push(`                (the image itself was never stored)`);
  L.push('');
  L.push(`opened          ${first.at}`);
  L.push(`human attached  ${attached ? `${attached.at}  operator=${attached.operator} device=${attached.device}` : '— never'}`);
  L.push(`released        ${released ? `${released.at}  outcome=${released.outcome}` : '— still open'}`);
  if (secs !== null) L.push(`human attention ${secs}s`);
  if (released?.input_kinds && Object.keys(released.input_kinds).length) {
    L.push(`input relayed   ${Object.entries(released.input_kinds).map(([k, v]) => `${v}× ${k}`).join(', ')}`);
    L.push(`                (counts only — contents were never recorded)`);
  } else {
    L.push(`input relayed   none — the human acted in their own browser`);
  }
  L.push('');
  L.push(`chain           ${rows.length} records, ${first.prev_hash === 'GENESIS' ? 'from genesis' : `prev ${first.prev_hash.slice(0, 12)}…`}`);
  L.push(`seal            ${last.hash}`);
  return L.join('\n');
}
