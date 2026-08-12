/** Opens one synthetic gate on the self-test relay so the UI and the release
 *  path can be exercised without writing to the real ledger. */
import { Presence } from '../src/client.js';
import { CdpPage } from '../src/bridge-cdp.js';

const p = new Presence('http://127.0.0.1:8788');
let frame = null;
try {
  const page = await CdpPage.open(Number(process.env.PRESENCE_CDP_PORT || 9333));
  frame = await page.screenshotBase64();
  page.close();
} catch { /* frame optional */ }

const g = await p.pause({
  mode: 'attach',
  gate_kind: 'anti_bot',
  host: 'secure.dor.wa.gov',
  task: 'Rail self-test — exercising the console and release path. Not a real task.',
  instruction: 'Tick the "I\'m not a robot" box',
  yield_target: 'agent_window',
  frame_base64: frame,
  resume_hint: 'self-test only',
});
console.log(JSON.stringify(g, null, 1));
