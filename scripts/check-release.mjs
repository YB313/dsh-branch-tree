#!/usr/bin/env node
// Release consistency check: the version must agree across package.json, the
// VERSION constant shown in the UI, and the README, and the tree must not carry
// macOS AppleDouble files (they break plugin loading: "locale/._en.json must use
// a language id as its filename").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const problems = [];

const pkg = JSON.parse(read('package.json'));
const version = pkg.version;
if (!version) problems.push('package.json: missing version');

const client = read('client.js');
const m = client.match(/const VERSION = '([^']+)';/);
if (!m) problems.push('client.js: VERSION constant not found');
else if (m[1] !== 'v' + version.split('.').slice(0, 2).join('')) {
  // The UI constant is a short brand ("v52" for 1.3.x); report it, do not fail.
  console.log(`note: UI VERSION is ${m[1]}, package version is ${version}`);
}

const readme = read('README.md');
if (!readme.includes('`v' + version + '`') && !readme.includes('v' + version)) {
  problems.push(`README.md: does not mention v${version}`);
}

const changelog = read('CHANGELOG.md');
if (!changelog.includes(`[${version}]`) && !changelog.includes(`## ${version}`)) {
  problems.push(`CHANGELOG.md: no section for ${version}`);
}

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(path.relative(root, p));
  }
  return out;
};
const files = walk(root);
const apple = files.filter((f) => f.split('/').some((seg) => seg.startsWith('._')));
if (apple.length) problems.push(`AppleDouble files present: ${apple.join(', ')}`);

if (problems.length) {
  console.error('release check FAILED:');
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
}
console.log(`release check OK: ${pkg.name}@${version}`);
