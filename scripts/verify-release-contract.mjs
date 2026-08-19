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

function read(path) {
  return readFileSync(join(ROOT, path), 'utf8');
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
const cli = read('src/cli.js');

requireContract(pkg.name === 'presence-rail', 'package name must remain presence-rail');
requireContract(/^\d+\.\d+\.\d+$/.test(pkg.version), 'package version must be exact semver');
requireContract(pkg.private === true, 'package must remain private until publication is separately approved');
requireContract(pkg.type === 'module', 'package type must remain module');
requireContract(pkg.license === 'MIT', 'package metadata must match the root MIT license');
requireContract(pkg.engines?.node === '>=22', 'supported Node floor must remain explicit at >=22');
requireContract(pkg.bin?.presence === './src/cli.js', 'presence console entry point must remain src/cli.js');
requireContract(pkg.repository?.url === 'git+https://github.com/nymrel/presence.git', 'repository coordinate must remain canonical');
requireContract(Object.keys(pkg.dependencies ?? {}).length === 0, 'runtime dependencies must remain empty');
requireContract(Object.keys(pkg.devDependencies ?? {}).length === 0, 'development dependencies must remain empty');
requireContract(pkg.scripts?.test === 'node --test tests/guarantees.test.js', 'guarantee suite must remain the test command');
requireContract(pkg.scripts?.check?.includes('verify-release-contract.mjs'), 'check must execute the release contract');
requireContract(license.startsWith('MIT License\n'), 'root LICENSE must contain the MIT text');
requireContract(cli.startsWith('#!/usr/bin/env node\n'), 'console entry point must keep an executable Node shebang');
requireContract(readme.includes('It never transports an answer.'), 'README must preserve the product boundary');
requireContract(readme.includes('No message shape can carry a token or answer'), 'README must preserve the structural no-answer claim');
requireContract(
  compliance.includes('Opening the console page currently counts as a human arriving.'),
  'known attach-authentication weakness must remain visible until fixed',
);
requireContract(
  compliance.toLowerCase().includes('passkey'),
  'compliance documentation must retain the planned passkey boundary',
);
requireContract(
  compliance.includes('unmeasured — not built'),
  'passkey authentication must remain labeled unmeasured and not built',
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
  .map((file) => readFileSync(file, 'utf8'))
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
  `Presence release contract: PASS (${sourceFiles.length} JavaScript files; zero dependencies; passkey claim remains fail-closed)`,
);
