#!/usr/bin/env node
/**
 * Compares the CLI's observable output between the current HEAD and the working tree.
 *
 * The window grew a second surface, but `dist/cli.js` is still the thing every script and every user
 * runs, so a TUI change must leave it byte-identical. Rather than repeat that by hand, this builds
 * HEAD out of `git archive` into a scratch directory, runs the same commands against a fixed sandbox
 * HOME from both builds, and diffs stdout, stderr and the exit code of each.
 *
 *   npm run cli:diff
 *
 * Nothing outside the scratch directories is written except the working tree's own `dist/` (`npm run
 * build`), which this script runs so the comparison is against the sources on disk, not a stale build.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsc = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
const offlineRoot = path.join(repo, 'test', 'fixtures', 'offline');
const scratch = path.join(repo, 'node_modules', '.cache', 'agentenv-cli-diff');

/** The commands whose output must not move; `--help` and one package variant cover the flag paths. */
const COMMANDS = [
  ['plan'],
  ['plan', '--package', 'group'],
  ['apply', '--yes'],
  ['status'],
  ['list'],
  ['stale'],
  ['update'],
  ['remove', '--yes'],
  ['--help'],
];

/** A HOME both runs share, so no field of the output can differ only because the path did. */
const home = path.join(os.tmpdir(), 'agentenv-cli-diff-home');

/** What the sandbox HOME starts with: a detected harness and a hand-written config with a comment. */
const SETTINGS = '{\n  // hand-written\n  "model": "opus",\n  "hooks": {},\n}\n';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function resetHome() {
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(path.join(home, '.fake'), { recursive: true });
  fs.writeFileSync(path.join(home, '.fake', 'settings.json'), SETTINGS, 'utf8');
}

/** Compiles one tree with its own tsconfig, so each build is exactly what that commit ships. */
function build(where, label) {
  const result = spawnSync(process.execPath, [tsc, '-p', path.join(where, 'tsconfig.json')], {
    cwd: where,
    encoding: 'utf8',
  });
  if (result.status !== 0) fail(`${label} build failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  const cli = path.join(where, 'dist', 'cli.js');
  if (!fs.existsSync(cli)) fail(`${label} build produced no ${cli}`);
  return cli;
}

/** HEAD, unpacked and built in a scratch directory under `node_modules/` so its imports still resolve. */
function buildHead() {
  fs.rmSync(scratch, { recursive: true, force: true });
  const archive = path.join(scratch, 'head.tar');
  const tree = path.join(scratch, 'head');
  fs.mkdirSync(tree, { recursive: true });
  const packed = spawnSync('git', ['archive', '--format=tar', '--output', archive, 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
  });
  if (packed.status !== 0) fail(`git archive HEAD failed:\n${packed.stderr ?? ''}`);
  // Relative names on both sides: a Windows drive letter reads as a remote host to GNU tar.
  const unpacked = spawnSync('tar', ['-xf', path.basename(archive), '-C', path.basename(tree)], {
    cwd: scratch,
    encoding: 'utf8',
  });
  if (unpacked.status !== 0) fail(`unpacking HEAD failed:\n${unpacked.stderr ?? ''}`);
  return build(tree, 'HEAD');
}

function run(cli, argv) {
  const result = spawnSync(process.execPath, [cli, ...argv], {
    cwd: repo,
    env: { ...process.env, HOME: home, USERPROFILE: home, AGENTENV_ROOT: offlineRoot },
    encoding: 'utf8',
  });
  return { code: result.status ?? 1, out: result.stdout ?? '', err: result.stderr ?? '' };
}

/**
 * Both sides run the whole list against the same starting HOME, in the same order, so a command that
 * writes still compares like with like: `apply --yes` then `status` sees the same machine twice.
 */
function transcript(cli) {
  resetHome();
  return COMMANDS.map((argv) => ({ argv, ...run(cli, argv) }));
}

/** The first field that moved, so a difference is one line to read rather than two transcripts. */
function diff(left, right) {
  for (const field of ['out', 'err']) {
    const a = left[field].split('\n');
    const b = right[field].split('\n');
    const at = a.findIndex((line, index) => line !== b[index]);
    if (at !== -1 || a.length !== b.length) {
      return `      ${field} HEAD: ${JSON.stringify(a[at] ?? '<no line>')}\n      ${field} tree: ${JSON.stringify(b[at] ?? '<no line>')}`;
    }
  }
  if (left.code !== right.code) return `      exit HEAD: ${left.code}\n      exit tree: ${right.code}`;
  return undefined;
}

const headCli = buildHead();
const treeCli = build(repo, 'working tree');

let failures = 0;
const head = transcript(headCli);
const tree = transcript(treeCli);
for (let index = 0; index < COMMANDS.length; index += 1) {
  const label = `agentenv ${(COMMANDS[index] ?? []).join(' ')}`.trim();
  const difference = head[index] && tree[index] ? diff(head[index], tree[index]) : 'missing run';
  if (difference === undefined) {
    console.log(`  IDENTICAL  ${label}`);
    continue;
  }
  failures += 1;
  console.log(`  DIFF       ${label}\n${difference}`);
}

if (failures > 0) {
  console.log(`\n${failures} of ${COMMANDS.length} command(s) differ from HEAD`);
  process.exit(1);
}
console.log(`\nall ${COMMANDS.length} command(s) identical to HEAD`);
