/**
 * The agent's own browser, driven over the Chrome DevTools Protocol.
 * Zero dependencies — Node 22 ships a global WebSocket.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------
 * It launches a plainly-automated browser and makes no attempt to hide that.
 * There is no `--disable-blink-features=AutomationControlled`, no patched user
 * agent, no `navigator.webdriver` shim, no canvas/WebGL noise, no timing
 * jitter, no plugin spoofing. tests/no-stealth.test.js asserts their absence
 * and fails the build if any of them appear.
 *
 * If a site detects automation and declines to serve us, that is the site
 * exercising a choice we respect. The rail's answer to that is YIELD — give the
 * step to a human in their own ordinary browser — not to make this browser lie.
 *
 * The browser also runs on its own --user-data-dir, so it never inherits the
 * operator's cookies, logins, or saved cards. The agent's session is the
 * agent's session.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

export function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  return null;
}

export async function launchAgentBrowser({ port = 9333, userDataDir, startUrl = 'about:blank' }) {
  const bin = findChrome();
  if (!bin) throw new Error('no Chrome binary found');
  mkdirSync(userDataDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1180,860',
    startUrl,
  ];
  // NOTE: no stealth/anti-detection flags. See the header. Keep it that way.

  const proc = spawn(bin, args, { detached: false, stdio: 'ignore' });
  await waitForDevtools(port, 15000);
  return { proc, port };
}

async function waitForDevtools(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`devtools did not come up on ${port}`);
}

export class CdpPage {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }

  static async open(port, { match } = {}) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page' && (!match || (t.url || '').includes(match)))
      || targets.find((t) => t.type === 'page');
    if (!page) throw new Error('no page target');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const p = new CdpPage(ws);
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    return p;
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method} timed out`)); }
      }, 30000);
    });
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await this.settle();
  }

  async settle(ms = 1400) { await new Promise((r) => setTimeout(r, ms)); }

  async screenshotBase64() {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    return data;
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  }

  /**
   * Relay one real human click into the live page.
   * Coordinates originate from a finger on the operator's phone. Nothing in this
   * method can produce a click on its own — if no human taps, nothing happens.
   */
  async click(x, y, button = 'left') {
    const base = { x, y, button, clickCount: 1 };
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  }

  async key(key) {
    if (key === 'Backspace' || key === 'Enter' || key === 'Tab') {
      const map = { Backspace: 8, Enter: 13, Tab: 9 };
      await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: map[key], key });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: map[key], key });
    } else {
      await this.send('Input.insertText', { text: key });
    }
  }

  async typeInto(selector, value) {
    // Agent-side form fill (not human input). Kept separate from key() on purpose.
    await this.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});
      if(!el) return false; el.focus(); el.value=${JSON.stringify(value)};
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
  }

  close() { try { this.ws.close(); } catch { /* already gone */ } }
}
