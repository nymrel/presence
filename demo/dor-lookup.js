#!/usr/bin/env node
/**
 * The case that produced the product.
 *
 * Task: look up a business name on the Washington State Department of Revenue
 * public business lookup. The lookup is free, public, unauthenticated, and
 * explicitly published for public use — but it is fronted by a bot challenge.
 *
 * What this demo proves:
 *   1. the agent gets all the way to the gate on its own;
 *   2. at the gate it PAUSES and pushes the exact step to the operator's phone;
 *   3. because the gate is `anti_bot`, policy forces YIELD — the rail refuses to
 *      relay input into the challenge, and asks the human to tick it themselves
 *      in the visible browser window;
 *   4. when the human says done, the agent re-reads the page and continues.
 *
 * What this demo will never do: tick the box. If no human ticks it, the gate
 * stays open forever and the agent never proceeds. That is the product working,
 * not the product failing.
 *
 *   node demo/dor-lookup.js --name Nymrel
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchAgentBrowser, CdpPage } from '../src/bridge-cdp.js';
import { Presence } from '../src/client.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = process.argv.includes('--name') ? process.argv[process.argv.indexOf('--name') + 1] : 'Nymrel';
const DOR = 'https://secure.dor.wa.gov/gteunauth/_/';

const log = (...a) => console.log('·', ...a);

const presence = new Presence(process.env.PRESENCE_URL || 'http://127.0.0.1:8787');

async function main() {
  await presence.health().catch(() => {
    console.error('relay not running — start it first:  node src/cli.js serve');
    process.exit(1);
  });
  log('relay reachable');

  const { port } = await launchAgentBrowser({
    port: Number(process.env.PRESENCE_CDP_PORT || 9333),
    userDataDir: join(ROOT, 'var', 'agent-profile'),
    startUrl: DOR,
  });
  log('agent browser up on CDP', port, '(own profile — no operator cookies)');

  const page = await CdpPage.open(port);
  await page.navigate(DOR);
  await page.settle(2500);

  log('page:', await page.evaluate('document.title'));

  // ---- the agent does the whole task on its own, right up to the gate ----
  const clickByText = (t) => page.evaluate(`(()=>{const e=[...document.querySelectorAll('a,button,[role=link],[role=button]')]
    .find(x=>(x.innerText||'').trim()===${JSON.stringify(t)}); if(!e)return false; e.click(); return true;})()`);

  log('step 1/4  open Business Lookup:', await clickByText('Business Lookup'));
  await page.settle(2400);

  log('step 2/4  search by Trade name:', await page.evaluate(`(()=>{const r=[...document.querySelectorAll('input[type=radio]')]
    .find(e=>e.labels&&e.labels[0]&&e.labels[0].innerText.trim()==='Trade name'); if(!r)return false; r.click(); return true;})()`));
  await page.settle(1200);

  log('step 3/4  fill business name:', await page.evaluate(`(()=>{const i=[...document.querySelectorAll('input[type=text]')]
    .find(e=>e.labels&&e.labels[0]&&/business name/i.test(e.labels[0].innerText));
    if(!i)return false; i.focus(); i.value=${JSON.stringify(NAME)};
    i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true}));
    return i.value;})()`));
  await page.settle(800);

  log('step 4/4  submit search:', await clickByText('Search'));
  await page.settle(3500);

  const surface = await page.evaluate(`(()=>({
    captcha:{recaptcha:!!document.querySelector('iframe[src*="recaptcha"],.g-recaptcha,#g-recaptcha'),
             turnstile:!!document.querySelector('iframe[src*="challenges.cloudflare"],.cf-turnstile'),
             hcaptcha:!!document.querySelector('iframe[src*="hcaptcha"],.h-captcha')},
    text:document.body.innerText.slice(0,400)
  }))()`);

  const gateKind = (surface.captcha.recaptcha || surface.captcha.turnstile || surface.captcha.hcaptcha)
    ? 'anti_bot' : 'other';
  log('gate detected:', gateKind, JSON.stringify(surface.captcha));
  if (gateKind !== 'anti_bot') log('no challenge this run — the agent would simply have finished.');

  const frame = await page.screenshotBase64();

  const gate = await presence.pause({
    mode: 'attach',                 // deliberately request attach, to show policy override
    gate_kind: gateKind,
    host: new URL(DOR).host,
    task: `Look up the business name "${NAME}" on the WA Dept of Revenue public business lookup.`,
    instruction: gateKind === 'anti_bot'
      ? `Tick the "I'm not a robot" box`
      : `Finish this step in the Presence browser window`,
    // The session cannot be recreated elsewhere — DOR rejects a duplicated tab
    // outright — so the human acts at the window that is already on this step.
    yield_target: 'agent_window',
    handoff_url: DOR,
    frame_base64: frame,
    resume_hint: `re-read the lookup results for "${NAME}" and report registration status`,
  });

  console.log('');
  log('GATE OPEN  ', gate.id);
  log('mode       ', gate.mode, gate.mode_forced ? '(FORCED by policy — attach was requested)' : '');
  if (gate.mode_reason) log('reason     ', gate.mode_reason);
  log('phone      ', gate.console_url);
  log('pager      ', gate.pager_url);
  console.log('');
  log('the agent is now waiting on a human. it will not tick the box itself.');

  // Keep the frame fresh so the operator sees the live page, not a stale picture.
  const refresher = setInterval(async () => {
    try { await presence.pushFrame(gate.id, await page.screenshotBase64()); } catch {}
  }, 2500);

  const result = await presence.waitForHuman(gate.id, { timeoutMs: 15 * 60 * 1000 });
  clearInterval(refresher);

  log('gate closed:', result.state, result.outcome ?? '');

  if (result.state !== 'released') {
    log('no human acted — stopping cleanly without proceeding.');
    page.close();
    return;
  }

  // The agent learns nothing from the rail except "a human acted".
  // It re-reads the live page itself to discover the new state.
  await page.settle(1200);
  const after = await page.evaluate(`(()=>({
    title:document.title,
    stillChallenged: !!document.querySelector('iframe[src*="recaptcha"],.g-recaptcha'),
    text:document.body.innerText.slice(0,900)
  }))()`);

  console.log('\n--- agent re-read the page after the human acted ---');
  console.log(JSON.stringify(after, null, 2).slice(0, 1800));
  page.close();
}

main().catch((e) => { console.error('demo failed:', e.message); process.exit(1); });
