#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/verify-pack-contract.mjs <npm-pack-json|->');
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(path === '-' ? 0 : path, 'utf8'));
} catch (error) {
  console.error(`cannot parse npm pack report: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(report) || report.length !== 1 || !Array.isArray(report[0]?.files)) {
  console.error('npm pack report must describe exactly one package');
  process.exit(1);
}

const files = new Set(report[0].files.map((entry) => entry.path));
const required = [
  'LICENSE',
  'README.md',
  'package.json',
  'src/cli.js',
  'src/ledger.js',
  'src/policy.js',
];
const missing = required.filter((entry) => !files.has(entry));
const forbidden = [...files].filter((entry) => (
  !['LICENSE', 'README.md', 'package.json'].includes(entry)
  && !entry.startsWith('src/')
));

if (missing.length || forbidden.length) {
  console.error('Presence package contract: FAIL');
  if (missing.length) console.error(`missing required files: ${missing.join(', ')}`);
  if (forbidden.length) console.error(`non-product files would be packed: ${forbidden.join(', ')}`);
  process.exit(1);
}

console.log(`Presence package contract: PASS (${files.size} files; no runtime ledger/ticket state)`);
