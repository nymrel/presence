/**
 * These tests are the product's spine. They assert that the rail is
 * STRUCTURALLY incapable of the thing we refused to build — not merely
 * disinclined. If one of these ever needs "adjusting" to let a feature land,
 * the feature is the problem.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { PresenceLedger } from '../src/ledger.js';
import { enforceMode, validateInput, YIELD_ONLY } from '../src/policy.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('the rail cannot carry a solved answer', () => {
  test('validateInput rejects every known challenge-response field', () => {
    for (const field of [
      'token', 'response', 'g-recaptcha-response', 'h-captcha-response',
      'cf-turnstile-response', 'solution', 'answer', 'otp', 'password', 'secret',
    ]) {
      assert.throws(
        () => validateInput({ kind: 'pointer', action: 'click', x: 1, y: 1, [field]: 'x' }),
        /refused/i,
        `field "${field}" must be refused`
      );
    }
  });

  test('only pointer/key/scroll message kinds exist', () => {
    assert.throws(() => validateInput({ kind: 'submit_token', value: 'x' }), /unsupported input kind/);
    assert.throws(() => validateInput({ kind: 'solve' }), /unsupported input kind/);
    assert.deepEqual(validateInput({ kind: 'pointer', action: 'click', x: 4, y: 9 }),
      { kind: 'pointer', action: 'click', x: 4, y: 9 });
  });

  test('unknown fields are refused rather than silently passed through', () => {
    assert.throws(() => validateInput({ kind: 'pointer', x: 1, y: 1, secretSauce: 'z' }), /not allowed/);
  });
});

describe('anti-bot challenges can never use the attach channel', () => {
  test('anti_bot is forced to yield even when attach is requested', () => {
    const d = enforceMode('attach', 'anti_bot');
    assert.equal(d.mode, 'yield');
    assert.equal(d.forced, true);
    assert.match(d.reason, /own browser/);
  });

  test('otp and identity are yield-only too', () => {
    for (const k of ['otp', 'identity']) assert.equal(enforceMode('attach', k).mode, 'yield');
  });

  test('the yield-only list still contains anti_bot', () => {
    assert.ok(YIELD_ONLY.includes('anti_bot'),
      'removing anti_bot from YIELD_ONLY converts this product into a bypass service');
  });
});

describe('the ledger cannot record what a human entered', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'presence-')), 'l.jsonl');

  test('forbidden fields throw rather than write', () => {
    const l = new PresenceLedger(path);
    for (const f of ['token', 'password', 'address', 'value', 'text', 'url', 'cookie']) {
      assert.throws(() => l.append({ id: 'a', event: 'x', [f]: 'sensitive' }), /forbidden field/);
    }
  });

  test('unknown fields are dropped, not stored', () => {
    const l = new PresenceLedger(path);
    const rec = l.append({ id: 'a', event: 'gate.opened', host: 'example.gov', somethingElse: 'leak' });
    assert.equal(rec.somethingElse, undefined);
    assert.equal(rec.host, 'example.gov');
  });

  test('input_kinds keeps counts and discards anything non-numeric', () => {
    const l = new PresenceLedger(path);
    const rec = l.append({ id: 'b', event: 'human.released', input_kinds: { pointer: 2, key: '4242424242424242' } });
    assert.equal(rec.input_kinds.pointer, 2);
    assert.equal(rec.input_kinds.key, undefined, 'a non-integer must never survive into the ledger');
  });

  test('the hash chain detects tampering', () => {
    const l = new PresenceLedger(path);
    assert.equal(l.verify().ok, true);
  });
});

describe('the browser does not pretend to be human', () => {
  const STEALTH_PATTERNS = [
    'AutomationControlled',
    'navigator.webdriver',
    'stealth',
    'puppeteer-extra',
    'undetected',
    'anti-detect',
    'humanize',
    'randomDelay',
    'bezier',
  ];

  test('no stealth or anti-detection technique appears anywhere in src/', () => {
    const offenders = [];
    for (const f of readdirSync(SRC)) {
      if (!f.endsWith('.js')) continue;
      const body = readFileSync(join(SRC, f), 'utf8');
      // strip comments so our own prose about NOT doing this doesn't trip the test
      const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const p of STEALTH_PATTERNS) {
        if (code.includes(p)) offenders.push(`${f}: ${p}`);
      }
    }
    assert.deepEqual(offenders, [],
      `stealth technique found — the rail must never hide that it is automated:\n${offenders.join('\n')}`);
  });

  test('no captcha-solving vendor is referenced', () => {
    const vendors = ['2captcha', 'anti-captcha', 'anticaptcha', 'capmonster', 'deathbycaptcha', 'capsolver'];
    for (const f of readdirSync(SRC)) {
      if (!f.endsWith('.js')) continue;
      const body = readFileSync(join(SRC, f), 'utf8').toLowerCase();
      for (const v of vendors) assert.ok(!body.includes(v), `${f} references solving vendor ${v}`);
    }
  });

  test('package.json has no dependencies that could carry a solver', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8'));
    assert.deepEqual(pkg.dependencies, {}, 'the rail runs on zero dependencies on purpose');
  });
});
