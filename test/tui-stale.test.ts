import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createContext, RecordingRunner, type Ctx, type Runner } from '../src/context.js';
import { loadData } from '../src/data.js';
import { t } from '../src/i18n.js';
import type { Data } from '../src/types.js';
import { expectFrame, expectFrameText, fixtureHome, OFFLINE_ROOT, startTui, waitIdle, type TuiHarness } from './tui-harness.js';

const HASH = '0123456789abcdef0123456789abcdef01234567';
/** The rows of the body start below the header's two lines and the surface's own name. */
const ROWS_AT = 4;
/** Where the detail column starts at 120 columns: the 50-column row column, then the 2-column gutter. */
const DETAIL_AT = 52;

interface Setup {
  data: Data;
  ctx: Ctx;
  home: string;
  /** Every command the surface ran: the provider's check is the only one it may run. */
  calls: readonly string[][];
}

interface Options {
  /** The provider lockfile's `skills` map: what agentenv believes it installed, and from where. */
  locked?: Record<string, unknown>;
  /** What the provider's own `check` prints. */
  stdout?: string;
  code?: number;
  /** False when no provider offers an update check at all. */
  covered?: boolean;
  /** A runner that does not answer, for the busy and cancelled states. */
  runner?: Runner;
}

function entry(source: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { source, sourceType: 'github', skillPath: 'skills/x/SKILL.md', skillFolderHash: HASH, ...extra };
}

/** The offline data root, a fake home holding the provider's lockfile, and a check that answers from memory. */
function setup(options: Options = {}): Setup {
  const home = fixtureHome();
  const file = path.join(home, '.fake', '.skill-lock.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 3, skills: options.locked ?? {} }, null, 2), 'utf8');

  const data = loadData(OFFLINE_ROOT);
  if (options.covered === false) data.providers = data.providers.map(({ check: _check, ...rest }) => rest);
  const recorder = new RecordingRunner([{ code: options.code ?? 0, stdout: options.stdout ?? '', stderr: '' }]);
  const runner = options.runner ?? recorder;
  const ctx = createContext({ home, root: OFFLINE_ROOT, runner, platform: 'linux' });
  return { data, ctx, home, calls: recorder.calls };
}

/** Two stale skills, one up-to-date, and one source the provider could not reach. */
function threeStates(): Setup {
  return setup({
    locked: {
      alpha: entry('owner/repo'),
      beta: entry('owner/repo'),
      fresh: entry('owner/repo'),
      gone: entry('owner/missing'),
    },
    stdout: [
      'Checking skills from source: owner/repo',
      '↑ alpha has an update',
      '↑ beta has an update',
      '  ✗ Failed to check skills from owner/missing',
      '✓ All global skills are up to date',
    ].join('\n'),
  });
}

/** A read is a promise: the frame that shows its result arrives a turn after the key that started it. */
async function settle(tui: TuiHarness, done: () => boolean, deadlineMs = 1500): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(done(), `the frame never said what it should:\n${tui.frame()}`);
}

/** `v`, then the report itself: the surface prints only its name until the read resolves. */
async function openStale(tui: TuiHarness): Promise<void> {
  await tui.press('v');
  await settle(
    tui,
    () => tui.frame().includes(t.staleTitle) || tui.frame().includes(t.staleNotCovered) || tui.frame().includes(t.staleEmpty),
  );
  // The report is on screen and the check is in: the next key is the surface's, not the wait's.
  await waitIdle(tui);
}

/** One frame line as a string: an absent line is empty, so it fails the assertion it feeds. */
function at(lines: string[], index: number): string {
  return lines[index] ?? '';
}

/** One string with every run of blanks collapsed: a wrap may move a space, never a word. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** The detail column read as one string: wrapping may move a word, never drop one. */
function detail(lines: string[]): string {
  return flat(lines.map((line) => line.slice(DETAIL_AT)).join(' '));
}

/** Every body row, focused or not: each one leads with the formatter's state word. */
function stateRows(lines: string[]): string[] {
  return lines.filter((line) => /^(> )?(stale|up-to-date|unknown)  /.test(line));
}

/** Every file under a directory with its bytes: a visit that wrote anything would show here. */
function snapshot(dir: string): string {
  const hash = crypto.createHash('sha256');
  const walk = (current: string): void => {
    for (const dirent of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, dirent.name);
      hash.update(`${path.relative(dir, full)}:${dirent.isDirectory() ? 'dir' : fs.readFileSync(full)}`);
      if (dirent.isDirectory()) walk(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return hash.digest('hex');
}

test('the stale surface leads every row with its own state word and the provider reason', async () => {
  const shared = threeStates();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openStale(tui);
    const lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 30 });
    assert.equal(lines[2], t.tui.surfaces.stale);
    assert.ok(at(lines, 3).startsWith(t.staleTitle), at(lines, 3));

    const frame = tui.frame();
    assert.ok(at(lines, ROWS_AT).startsWith('> stale  alpha [owner/repo]'), at(lines, ROWS_AT));
    assert.ok(at(lines, ROWS_AT + 2).startsWith('up-to-date  fresh [owner/repo]'), at(lines, ROWS_AT + 2));
    assert.ok(at(lines, ROWS_AT + 3).startsWith('unknown  gone [owner/missing]'), at(lines, ROWS_AT + 3));
    assert.equal(stateRows(lines).length, 4, lines.join('\n'));
    // The focused row is whole in the detail column, provider reason included.
    assert.ok(detail(lines).includes(flat(`stale  alpha [owner/repo] — ${t.staleNewer}`)), detail(lines));

    // The formatter's count line is the last thing the surface says, and it counts every recorded skill.
    const trailer = t.staleCount(4);
    assert.ok(frame.includes(trailer), frame);
    assert.ok(
      lines.findIndex((line) => line.includes(trailer)) > lines.findIndex((line) => line.includes('unknown  gone')),
      'the count line is not below the rows',
    );
    // Nothing was installed to answer the question, and the count line says so.
    assert.match(trailer, /verification only, nothing was installed/);
  } finally {
    await tui.stop();
  }
});

test('an unknown row is never printed as an up-to-date one', async () => {
  const shared = threeStates();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openStale(tui);
    const rows = stateRows(tui.lines());
    assert.equal(rows.length, 4, rows.join('\n'));
    assert.equal(tui.frame().includes('up-to-date  gone'), false, 'the unreachable row became good news');
    assert.equal(tui.frame().includes('up-to-date  alpha'), false, 'a stale row became good news');

    // The gap reads as a gap: the state word leads the row, and the provider's own reason follows it.
    await tui.press('G');
    const focused = tui.lines().find((line) => line.startsWith(`> unknown  gone`)) ?? '';
    assert.ok(focused !== '', tui.lines().join('\n'));
    assert.ok(
      detail(tui.lines()).includes(flat(`unknown  gone [owner/missing] — ${t.staleUnreachable('owner/missing')}`)),
      detail(tui.lines()),
    );
    assert.equal(tui.frame().includes(`${t.staleLabels['up-to-date']}  gone`), false, 'the gap was printed as a pass');
  } finally {
    await tui.stop();
  }
});

test('no provider offers an update check: the surface states it and lists no rows', async () => {
  const shared = setup({ covered: false, locked: { alpha: entry('owner/repo') } });
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openStale(tui);
    expectFrame(tui.lines(), { width: 120, rows: 30 });
    const frame = tui.frame();
    assert.ok(frame.includes(t.staleNotCovered), frame);
    // The heading and the sentence are the whole answer: nothing was compared, so nothing is a row.
    assert.equal(tui.lines().filter((line) => /^(> )?(stale|up-to-date|unknown)  /.test(line)).length, 0, frame);
    assert.equal(frame.includes(t.staleCount(1)), false, 'a not-covered report still counted skills');
    assert.deepEqual(shared.calls, [], 'the check ran although no provider offers one');
  } finally {
    await tui.stop();
  }
});

test('a lockfile with nothing recorded says so instead of claiming anything is fresh', async () => {
  const shared = setup({ stdout: '✓ All global skills are up to date' });
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openStale(tui);
    assert.ok(tui.frame().includes(t.staleEmpty), tui.frame());
    assert.equal(tui.frame().includes('up-to-date'), false, 'an empty report claimed a fresh skill');
  } finally {
    await tui.stop();
  }
});

test('the slow read is named and timed, and Esc stops waiting without leaving', async () => {
  const pending: Runner = { run: () => new Promise(() => {}) };
  const shared = setup({ locked: { alpha: entry('owner/repo') }, runner: pending });
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await tui.press('v');
    await settle(tui, () => tui.frame().includes('reading the provider update check…'));
    assert.match(tui.frame(), /reading the provider update check… \d+s/, tui.frame());
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.stale}`), true);

    await tui.press('\u001B');
    assert.ok(tui.frame().includes(t.tui.stoppedWaiting), `no cancelled copy in:\n${tui.frame()}`);
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.stale}`), true, 'Esc left the surface instead of stopping');

    // The stopped check is a settled one: this Esc is the surface's, and it leaves.
    await waitIdle(tui);
    await tui.press('\u001B');
    assert.equal(tui.lines()[0]?.startsWith('agentenv  install'), true, 'the previous surface is not reachable');
    expectFrame(tui.lines(), { width: 120, rows: 30 });
  } finally {
    await tui.stop();
  }
});

test('f cycles the state filter, and the heading states it and the window', async () => {
  const shared = threeStates();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openStale(tui);
    await tui.press('f');
    let lines = tui.lines();
    assert.ok(at(lines, 3).includes(`state: stale`), at(lines, 3));
    assert.equal(tui.frame().includes('up-to-date  fresh'), false, 'the state filter kept an up-to-date row');
    assert.equal(tui.frame().includes('unknown  gone'), false, 'the state filter kept an unknown row');
    assert.ok(tui.frame().includes('stale  alpha'), 'the state filter dropped a stale row');
    assert.ok(tui.frame().includes(t.tui.matchCount(2, 4)), tui.frame());

    await tui.press('f');
    lines = tui.lines();
    assert.ok(at(lines, 3).includes(`state: up-to-date`), at(lines, 3));
    assert.equal(tui.frame().includes('stale  alpha'), false, 'the state filter kept a stale row');
    assert.ok(tui.frame().includes('up-to-date  fresh'), tui.frame());

    await tui.press('f');
    assert.ok(at(tui.lines(), 3).includes(`state: unknown`), at(tui.lines(), 3));
    assert.ok(tui.frame().includes('unknown  gone'), tui.frame());
    assert.equal(tui.frame().includes('up-to-date  fresh'), false, 'the state filter kept an up-to-date row');

    // The fourth press is the way back to the whole report.
    await tui.press('f');
    assert.equal((tui.lines()[3] ?? '').includes('state:'), false, at(tui.lines(), 3));
    assert.ok(tui.frame().includes('up-to-date  fresh'), 'the filter was not cleared');
    expectFrame(tui.lines(), { width: 120, rows: 30 });
  } finally {
    await tui.stop();
  }
});

test('slash narrows by name, states the matched count, and Esc clears before it leaves', async () => {
  const shared = threeStates();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openStale(tui);
    await tui.press('/');
    const keybar = tui.lines();
    assert.ok(at(keybar, keybar.length - 1).startsWith('Esc clear filter'), at(keybar, keybar.length - 1));
    for (const key of ['b', 'e', 't']) await tui.press(key);

    assert.ok((tui.lines()[3] ?? '').includes('filter: bet'), at(tui.lines(), 3));
    assert.ok(tui.frame().includes(t.tui.matchCount(1, 4)), tui.frame());
    assert.ok(tui.frame().includes('stale  beta'), 'the matching row was filtered out');
    assert.equal(tui.frame().includes('stale  alpha'), false, 'the filter did not narrow');

    // Esc spends itself on the filter first, and the surface stays.
    await waitIdle(tui);
    await tui.press('\u001B');
    assert.equal((tui.lines()[3] ?? '').includes('filter: none'), true, at(tui.lines(), 3));
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.stale}`), true, 'Esc cleared the surface, not the filter');
    await waitIdle(tui);
    await tui.press('\u001B');
    assert.equal(tui.lines()[0]?.startsWith('agentenv  install'), true, 'Esc did not leave the surface');
  } finally {
    await tui.stop();
  }
});

test('u opens the update surface from a stale row, and the keybar names the key', async () => {
  const shared = threeStates();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openStale(tui);
    assert.ok((tui.lines()[tui.lines().length - 1] ?? '').includes('u update'), at(tui.lines(), tui.lines().length - 1));
    await tui.press('u');
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.update}`), true, at(tui.lines(), 0));
    assert.equal(tui.lines()[2], t.tui.surfaces.update);
  } finally {
    await tui.stop();
  }
});

test('the stale surface is read-only: r reads again, and no visit writes anything', async () => {
  const shared = threeStates();
  const before = snapshot(shared.home);
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openStale(tui);
    // One key for each thing that is live: the window, the state filter, the name filter, the clear.
    for (const key of ['\u001B[B', '\u001B[6~', 'G', 'f', '/', 'a', '\u001B']) await tui.press(key);
    assert.equal((tui.lines()[3] ?? '').includes('filter: none'), true, at(tui.lines(), 3));
    assert.equal((tui.lines()[3] ?? '').includes('state:'), false, 'one Esc did not clear both filters');
    await tui.press('r');
    await settle(tui, () => tui.frame().includes(t.staleCount(4)));
    assert.equal(snapshot(shared.home), before, 'the stale surface wrote to the home');
    // One read on entry, one on `r`: the provider's check, and nothing else.
    assert.equal(shared.calls.length, 2, JSON.stringify(shared.calls));
    assert.equal(shared.calls[0]?.[0], 'node');
  } finally {
    await tui.stop();
  }
});

test('at 40 columns the state word, the window and the keys still fit the frame', async () => {
  const shared = threeStates();
  const tui = await startTui({ ...shared, width: 40 });
  try {
    await openStale(tui);
    expectFrame(tui.lines(), { width: 40, rows: 30 });
    assert.ok((tui.lines()[3] ?? '').includes('of 4'), at(tui.lines(), 3));
    // The focused row is printed whole, so its reason survives the narrow frame.
    assert.ok(tui.frame().includes('unknown'), tui.frame());
    const rows = tui.lines().slice(ROWS_AT);
    assert.ok(rows.some((row) => row.startsWith('up-to-date  fresh')), rows.join('|'));
    await tui.press('f');
    expectFrame(tui.lines(), { width: 40, rows: 30 });
  } finally {
    await tui.stop();
  }
});

test('at 80 columns the focused row wraps under itself: the provider reason arrives whole', async () => {
  const shared = threeStates();
  const tui = await startTui({ ...shared, width: 80 });
  try {
    await openStale(tui);
    const lines = tui.lines();
    expectFrame(lines, { width: 80, rows: 30 });
    // One column: the focus is on the first row, and its whole line is on screen, wrapped.
    assert.ok(at(lines, ROWS_AT).startsWith(`${t.tui.marks.focused}stale  alpha`), at(lines, ROWS_AT));
    const row = `stale  alpha [owner/repo] — ${t.staleNewer}`;
    expectFrameText(lines, row);
    // Nothing of the focused row ends in an ellipsis: it wraps, it is not truncated.
    assert.equal(lines[ROWS_AT]?.includes(t.tui.ellipsis), false, at(lines, ROWS_AT));
  } finally {
    await tui.stop();
  }
});

test('one Esc clears the name filter and the state filter together', async () => {
  const shared = threeStates();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openStale(tui);
    await tui.press('f');
    await tui.press('/');
    for (const key of ['b', 'e', 't']) await tui.press(key);
    let lines = tui.lines();
    assert.ok(at(lines, 3).includes('filter: bet'), at(lines, 3));
    assert.ok(at(lines, 3).includes('state: stale'), at(lines, 3));
    assert.equal(stateRows(lines).length, 1, lines.join('\n'));

    // One step takes both filters: the spec's `Esc` clears the text and the state, not one of them.
    await waitIdle(tui);
    await tui.press('\u001B');
    lines = tui.lines();
    assert.ok(at(lines, 3).includes('filter: none'), at(lines, 3));
    assert.equal(at(lines, 3).includes('state:'), false, 'Esc left the state filter on');
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.stale}`), true, 'Esc left the surface');
    assert.equal(stateRows(lines).length, 4, lines.join('\n'));
  } finally {
    await tui.stop();
  }
});
