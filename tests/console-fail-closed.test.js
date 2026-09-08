import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import { gatePage, pagerPage } from '../src/console-ui.js';

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

  test('yield handoff links accept only HTTP and HTTPS URLs', () => {
    const html = gatePage({
      id: '00000000-0000-4000-8000-000000000000',
      mode: 'yield',
      gate_kind: 'consent',
      host: 'console.example.test',
      task: 'Approve bounded work',
      instruction: 'Review and approve',
      frameSha: null,
      handoffUrl: 'javascript:alert(1)',
      yieldTarget: 'own_browser',
    });
    assert.match(html, /id="open" href="#"/);
    assert.doesNotMatch(html, /javascript:/i);
  });

  test('pager renders adversarial agent text as text and validates gate hrefs', async () => {
    const html = pagerPage({ nonce: 'review-nonce' });
    assert.match(html, /<script nonce="review-nonce">/);
    assert.match(html, /host\.textContent=String\(g\.host\?\?''\)/);
    assert.match(html, /instruction\.textContent=String\(g\.instruction\?\?''\)/);
    assert.match(html, /task\.textContent=String\(g\.task\?\?''\)/);
    assert.match(html, /\^\[0-9a-f\]\{8\}/);
    assert.doesNotMatch(html, /innerHTML=gates|g\.host\+'<|g\.instruction\+'<|g\.task\+'</);

    class FakeNode {
      constructor(tag = '') {
        this.tag = tag;
        this.children = [];
        this.style = {};
        this.textContent = '';
      }
      append(...children) { this.children.push(...children); }
      replaceChildren(...children) { this.children = children; }
    }
    const list = new FakeNode('div');
    const status = new FakeNode('div');
    const hostile = {
      id: '00000000-0000-4000-8000-000000000000',
      mode: 'attach',
      host: '<svg onload="globalThis.pwned=true">',
      instruction: '</div><script>globalThis.pwned=true</script>',
      task: '\" onmouseover=\"globalThis.pwned=true',
    };
    const document = {
      body: new FakeNode('body'),
      createElement: (tag) => new FakeNode(tag),
      getElementById: (id) => (id === 'list' ? list : status),
    };
    const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1];
    const context = {
      document,
      fetch: async () => ({ json: async () => [hostile] }),
      navigator: {},
      setInterval: () => {},
      window: {},
    };
    await runInNewContext(`${script}\ntick()`, context);

    const card = list.children[0];
    assert.equal(card.href, `/h/${hostile.id}`);
    assert.equal(card.children[0].children[1].textContent, hostile.host);
    assert.equal(card.children[1].textContent, hostile.instruction);
    assert.equal(card.children[2].textContent, hostile.task);
    assert.equal(context.pwned, undefined);
  });
});
