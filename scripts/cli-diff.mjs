#!/usr/bin/env node
/**
 * Compares the CLI's observable output between a base revision and the working tree.
 *
 * The window grew a second surface, but `dist/cli.js` is still the thing every script and every user
 * runs, so a TUI change must leave it byte-identical. Rather than repeat that by hand, this builds the
 * base revision out of `git archive` into a scratch directory, runs the same commands against a
 * sandbox HOME from both builds, and diffs stdout, stderr and the exit code of each.
 *
 *   npm run cli:diff                      # base is HEAD
 *   npm run cli:diff -- --base 398f147    # base is a named revision
 *
 * A clean tree diffs HEAD against itself, so the script says so instead of claiming anything: the
 * comparison only proves something when the working tree has moved away from the base.
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
/** Both scratch directories carry the pid, so two runs at once cannot empty each other's build. */
const scratch = path.join(repo, 'node_modules', '.cache', `agentenv-cli-diff-${process.pid}`);

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
const home = path.join(os.tmpdir(), `agentenv-cli-diff-home-${process.pid}`);

/** The commands that have to answer on their own: two identical failures would prove nothing. */
const READ_ONLY = new Set(['plan', 'status']);

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

/** The base revision, unpacked and built in a scratch directory under `node_modules/` so it resolves. */
function buildBase(rev) {
  fs.rmSync(scratch, { recursive: true, force: true });
  const archive = path.join(scratch, 'base.tar');
  const tree = path.join(scratch, 'base');
  fs.mkdirSync(tree, { recursive: true });
  const packed = spawnSync('git', ['archive', '--format=tar', '--output', archive, rev], {
    cwd: repo,
    encoding: 'utf8',
  });
  if (packed.status !== 0) fail(`git archive ${rev} failed:\n${packed.stderr ?? ''}`);
  // Relative names on both sides: a Windows drive letter reads as a remote host to GNU tar.
  const unpacked = spawnSync('tar', ['-xf', path.basename(archive), '-C', path.basename(tree)], {
    cwd: scratch,
    encoding: 'utf8',
  });
  if (unpacked.status !== 0) fail(`unpacking ${rev} failed:\n${unpacked.stderr ?? ''}`);
  return build(tree, rev);
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

/** One option of the form `--name value`, or undefined when it is not on the command line. */
function option(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

/** `git rev-parse` of a revision, or a failure naming what was asked for. */
function resolve(rev) {
  const found = spawnSync('git', ['rev-parse', '--verify', `${rev}^{commit}`], { cwd: repo, encoding: 'utf8' });
  if (found.status !== 0) fail(`unknown revision: ${rev}
${found.stderr ?? ''}`);
  return (found.stdout ?? '').trim();
}

const baseArg = option('--base') ?? 'HEAD';
const base = resolve(baseArg);
const atHead = base === resolve('HEAD');
// Untracked files cannot change a build, so they are not a difference this script could prove.
const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: repo, encoding: 'utf8' });
const hasChanges = (dirty.stdout ?? '').trim() !== '';
const label = atHead ? 'HEAD' : baseArg;

if (!hasChanges && atHead) {
  console.log('clean tree — comparing HEAD with itself, nothing to prove');
}

const baseCli = buildBase(base);
const treeCli = build(repo, 'working tree');

let failures = 0;
const baseRuns = transcript(baseCli);
const treeRuns = transcript(treeCli);
for (let index = 0; index < COMMANDS.length; index += 1) {
  const argv = COMMANDS[index] ?? [];
  const name = `agentenv ${argv.join(' ')}`.trim();
  const left = baseRuns[index];
  const right = treeRuns[index];
  if (left === undefined || right === undefined) {
    failures += 1;
    console.log(`  MISSING    ${name}`);
    continue;
  }
  // A command that fails on both sides reads as IDENTICAL, so the read-only ones must answer first.
  if (READ_ONLY.has(argv[0])) {
    const refused = [
      [label, left],
      ['working tree', right],
    ].find(([, run]) => run.code !== 0);
    if (refused) {
      failures += 1;
      const [side, run] = refused;
      const reason = (run.err || run.out).trim().split('\n')[0] ?? '';
      console.log(`  NO ANSWER  ${name}\n      ${side} exited ${run.code}: ${reason}`);
      continue;
    }
  }
  const difference = diff(left, right);
  if (difference === undefined) {
    console.log(`  IDENTICAL  ${name}`);
    continue;
  }
  failures += 1;
  console.log(`  DIFF       ${name}
${difference}`);
}

fs.rmSync(scratch, { recursive: true, force: true });
fs.rmSync(home, { recursive: true, force: true });

if (failures > 0) {
  console.log(`
${failures} of ${COMMANDS.length} command(s) did not match ${label}`);
  process.exit(1);
}
console.log(`
all ${COMMANDS.length} command(s) identical to ${label}`);
