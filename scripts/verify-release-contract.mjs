#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];

function requireContract(condition, message) {
  if (!condition) failures.push(message);
}

function normalizeText(text) {
  return text.replace(/\r\n/g, '\n');
}

function read(path) {
  return normalizeText(readFileSync(join(ROOT, path), 'utf8'));
}

function walkJavaScript(path) {
  const absolute = join(ROOT, path);
  const files = [];
  for (const entry of readdirSync(absolute)) {
    const child = join(absolute, entry);
    if (statSync(child).isDirectory()) {
      files.push(...walkJavaScript(relative(ROOT, child)));
    } else if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
      files.push(child);
    }
  }
  return files;
}

const pkg = JSON.parse(read('package.json'));
const license = read('LICENSE');
const readme = read('README.md');
const compliance = read('docs/COMPLIANCE.md');
const assurance = read('docs/ATTACHMENT_ASSURANCE.md');
const threatModel = read('docs/PASSKEY_THREAT_MODEL.md');
const security = read('SECURITY.md');
const cli = read('src/cli.js');

requireContract(pkg.name === 'presence-rail', 'package name must remain presence-rail');
requireContract(/^\d+\.\d+\.\d+$/.test(pkg.version), 'package version must be exact semver');
requireContract(pkg.private === true, 'package must remain private until publication is separately approved');
requireContract(pkg.type === 'module', 'package type must remain module');
requireContract(pkg.license === 'MIT', 'package metadata must match the root MIT license');
requireContract(pkg.engines?.node === '>=22.12.0 <25', 'supported Node line must remain Node 22.12 through 24.x');
requireContract(pkg.bin?.presence === './src/cli.js', 'presence console entry point must remain src/cli.js');
requireContract(
  JSON.stringify(pkg.files) === JSON.stringify(['src/']),
  'package files must remain an explicit src-only allowlist',
);
requireContract(pkg.repository?.url === 'git+https://github.com/nymrel/presence.git', 'repository coordinate must remain canonical');
requireContract(Object.keys(pkg.dependencies ?? {}).length === 0, 'runtime dependencies must remain empty');
requireContract(Object.keys(pkg.devDependencies ?? {}).length === 0, 'development dependencies must remain empty');
requireContract(pkg.scripts?.test === 'node --test', 'test discovery must cover every Node test file');
requireContract(pkg.scripts?.check?.includes('verify-release-contract.mjs'), 'check must execute the release contract');
requireContract(pkg.scripts?.check?.endsWith('node --test'), 'check must execute the complete test suite');
requireContract(license.startsWith('MIT License\n'), 'root LICENSE must contain the MIT text');
requireContract(cli.startsWith('#!/usr/bin/env node\n'), 'console entry point must keep an executable Node shebang');
requireContract(readme.includes('It never transports an answer.'), 'README must preserve the product boundary');
requireContract(readme.includes('No message shape can carry a token or answer'), 'README must preserve the structural no-answer claim');
for (const text of [readme, compliance, assurance, security]) {
  requireContract(text.includes('lan-unverified'), 'LAN assurance limitation disappeared from public security documentation');
  requireContract(text.includes('webauthn-verified'), 'verified assurance boundary disappeared from public security documentation');
}
requireContract(
  readme.includes('does **not** implement WebAuthn verification from scratch'),
  'README must retain the verifier non-goal',
);
requireContract(
  compliance.includes('unmeasured') && compliance.includes('unbuilt'),
  'passkey authentication must remain labeled unmeasured and unbuilt',
);
requireContract(
  threatModel.includes('There must be no silent fallback'),
  'passkey threat model must preserve fail-closed fallback semantics',
);
requireContract(
  security.includes('cannot emit `human.attached` or `human.released`'),
  'security policy must distinguish console transport from verified human events',
);

const sourceFiles = [
  ...walkJavaScript('src'),
  ...walkJavaScript('tests'),
  ...walkJavaScript('scripts'),
];
for (const file of sourceFiles) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    windowsHide: true,
  });
  requireContract(
    result.status === 0,
    `syntax check failed for ${relative(ROOT, file)}: ${(result.stderr || result.stdout || '').trim()}`,
  );
}

const sourcePrefix = `src${process.platform === 'win32' ? '\\' : '/'}`;
const combinedSource = sourceFiles
  .filter((file) => relative(ROOT, file).startsWith(sourcePrefix))
  .map((file) => normalizeText(readFileSync(file, 'utf8')))
  .join('\n');
const passkeyImplementationTokens = [
  'navigator.credentials.create',
  'navigator.credentials.get',
  'PublicKeyCredential',
];
for (const token of passkeyImplementationTokens) {
  requireContract(
    !combinedSource.includes(token),
    `source contains ${token} while the public contract still says passkey authentication is not built`,
  );
}

if (failures.length) {
  console.error('Presence release contract: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Presence release contract: PASS (${sourceFiles.length} JavaScript files; zero dependencies; assurance and passkey claims remain fail-closed)`,
);
