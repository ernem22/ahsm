#!/usr/bin/env node
/**
 * Syntax guardrail for the JavaScript the repo runs but never imports: `scripts/*.mjs` and the offline
 * fixture programs under `test/fixtures/offline/bin/`. The e2e suites reach them with `spawn`, so the
 * type checker never sees them — a syntax error there used to surface at the end of `npm run check`
 * rather than at the commit that introduced it.
 *
 * The file list is globbed, not written out: a new script or fixture program is checked the day it
 * lands. Only `node --check` runs, so nothing is executed and no network or HOME is touched.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['scripts', path.join('test', 'fixtures', 'offline', 'bin')];

const files = dirs
  .flatMap((dir) => {
    const full = path.join(repo, dir);
    if (!fs.existsSync(full)) return [];
    return fs
      .readdirSync(full)
      .filter((name) => name.endsWith('.mjs'))
      .sort()
      .map((name) => path.join(full, name));
  })
  .filter((file) => fs.statSync(file).isFile());

const failed = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed.push({ file, message: (result.stderr ?? '').trim() || `exit ${result.status ?? 'unknown'}` });
  }
}

if (failed.length === 0) {
  console.log(`script syntax: ${files.length} file(s) parse`);
  process.exit(0);
}

console.error(`script syntax: ${failed.length} of ${files.length} file(s) do not parse:`);
for (const { file, message } of failed) {
  console.error(`  ${path.relative(repo, file)}`);
  for (const line of message.split('\n')) console.error(`      ${line}`);
}
process.exit(1);
