import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { gatePage } from '../src/console-ui.js';

function page(mode = 'attach') {
  return gatePage({
    id: '00000000-0000-4000-8000-000000000000',
    mode,
    gate_kind: 'consent',
    host: 'console.example.test',
    task: 'Approve bounded work',
    instruction: 'Review and approve',
    frameSha: null,
    handoffUrl: 'https://example.test/handoff',
    yieldTarget: 'own_browser',
  });
}

describe('console UI fails closed with the relay', () => {
  test('actions remain locked until attach succeeds', () => {
    const html = page();
    assert.match(html, /lockActions\(true\)/);
    assert.match(html, /const attachPromise=post\('\/attach'/);
    assert.match(html, /if\(!result\)\{lockActions\(true\);return false;\}/);
  });

  test('release success is rendered only after a successful response', () => {
    const html = page();
    assert.match(html, /const released=await post\('\/release'/);
    assert.match(html, /if\(!released\)return;/);
    assert.ok(
      html.indexOf('if(!released)return;') < html.indexOf("finish('Handed back'"),
      'success rendering must follow the refusal check',
    );
    assert.doesNotMatch(
      html,
      /await post\('\/release',[^;]+\);\s*finish\(/,
      'the old optimistic release pattern must never return',
    );
  });

  test('the stock page describes unverified assurance honestly', () => {
    const html = page();
    assert.match(html, /LAN console attached · identity not verified/);
    assert.match(html, /No success is assumed/);
    assert.doesNotMatch(html, /verification\s*:/,
      'the stock LAN page must not submit a browser-authored verification decision');
  });

  test('yield handoff link starts locked too', () => {
    const html = page('yield');
    assert.match(html, /id="open"[^>]+class="btn go locked"|class="btn go locked"[^>]+id="open"/);
    assert.match(html, /aria-disabled="true"/);
  });
});
