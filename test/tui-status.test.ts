import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createContext, RecordingRunner, type RunResult } from '../src/context.js';
import { loadData } from '../src/data.js';
import { readStatus } from '../src/core/status.js';
import { t } from '../src/i18n.js';
import { statusLines, type Line } from '../src/render.js';
import { expectFrame, expectFrameText, fixture, fixtureHome, OFFLINE_ROOT, startTui, type TuiHarness } from './tui-harness.js';

/** Where the detail column starts at 120 columns: the 50-column list, then the 2-column gutter. */
const DETAIL_AT = 52;

function version(stdout: string): RunResult {
  return { code: 0, stdout, stderr: '' };
}

const PROVIDER = { skill: 'fake-skills', mcp: 'fake-mcp', hook: 'builtin-hooks' } as const;

/** One recorded installation: only the fields `status` reads, with the provider that owns its kind. */
function entry(itemId: string, kind: 'skill' | 'mcp' | 'hook', harness = 'fake') {
  return { itemId, kind, harness, providerId: PROVIDER[kind], at: '2026-01-01T00:00:00.000Z' };
}

/** A home with the fake harness detected, the record the test needs and the files that verify it. */
function home(entries: ReturnType<typeof entry>[], files: Record<string, string> = {}): string {
  const home = fixtureHome(true);
  fs.mkdirSync(path.join(home, '.agentenv'), { recursive: true });
  fs.writeFileSync(path.join(home, '.agentenv', 'state.json'), JSON.stringify({ version: 1, entries }), 'utf8');
  for (const [name, text] of Object.entries({ '.fake/.skill-lock.json': '{"skills":{}}', ...files })) {
    fs.mkdirSync(path.dirname(path.join(home, name)), { recursive: true });
    fs.writeFileSync(path.join(home, name), text, 'utf8');
  }
  return home;
}

interface Setup extends ReturnType<typeof fixture> {
  home: string;
  runner: RecordingRunner;
}

/** The offline root, a home the report reads, and a runner that answers its version checks. */
function setup(results: RunResult[], entries = [entry('skill-a', 'skill'), entry('mcp-a', 'mcp')], root = OFFLINE_ROOT): Setup {
  const dir = home(entries, { '.fake/.skill-lock.json': '{"skills":{"alpha":{"source":"fixture/skills"}}}' });
  const runner = new RecordingRunner(results);
  return { data: loadData(root), ctx: createContext({ home: dir, root, runner, platform: 'linux' }), home: dir, runner };
}

/** A read is a promise: the frame that shows its result arrives a turn after the key that started it. */
async function settle(tui: TuiHarness, done: () => boolean, deadlineMs = 1000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(done(), `the frame never said what it should:\n${tui.frame()}`);
}

/** `s`, then the report itself: the surface prints only its heading until the read resolves. */
async function openStatus(tui: TuiHarness, marker = t.harnesses): Promise<void> {
  await tui.press('s');
  await settle(
    tui,
    () => tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.status}`) === true && tui.frame().includes(marker),
  );
}

/** The detail column read as one string: wrapping may move a word, never drop one. */
function detail(lines: string[]): string {
  return lines.map((line) => line.slice(DETAIL_AT)).join(' ').replace(/\s+/g, ' ');
}

/** The rows the report itself is made of: a state word, then what it is about. */
function reportRows(report: Awaited<ReturnType<typeof readStatus>>): Line[] {
  const words = [...Object.values(t.harnessLabels), ...Object.values(t.statusLabels)];
  return statusLines(report).filter((line) => words.some((word) => line.text.startsWith(`${word}  `)));
}

/** Every file under a directory with its bytes: a visit that wrote anything would show here. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string): void => {
    for (const name of fs.readdirSync(at).sort()) {
      const full = path.join(at, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else out[path.relative(dir, full)] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return out;
}

test('the status surface prints both sections in the formatter words, ready and unknown included', async () => {
  const shared = setup([version('v20.0.0\n')], [entry('skill-a', 'skill'), entry('mcp-a', 'mcp'), entry('ghost', 'mcp')]);
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openStatus(tui);
    const lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 30 });
    assert.equal(lines[2], t.tui.surfaces.status);
    assert.equal(lines[lines.length - 1], 'r refresh · ? keys · Esc back · q quit');

    const frame = tui.frame();
    assert.ok(frame.includes(`${t.harnessLabels.ready}  fake  20.0.0 · min 20`), frame);
    assert.ok(frame.includes(`${t.statusLabels['up-to-date']}  skill-a → fake [skill]`), frame);
    assert.ok(frame.includes(`${t.statusLabels.missing}  mcp-a → fake [mcp]`), frame);

    const left = lines.map((line) => line.slice(0, DETAIL_AT).trimEnd());
    const harnessesAt = left.indexOf(t.harnesses);
    const itemsAt = left.indexOf(t.itemsTitle);
    assert.notEqual(harnessesAt, -1, 'the harnesses heading is missing');
    assert.ok(itemsAt > harnessesAt, 'the items heading does not follow the harnesses');
    assert.ok(lines[harnessesAt + 1]?.slice(0, DETAIL_AT).includes(`${t.harnessLabels.ready}  fake`), 'a harness row is not under its heading');

    for (const banned of ['outdated', 'up to date', 'not installed', 'uptodate']) {
      assert.equal(frame.includes(banned), false, `a renamed state appeared: ${banned}`);
    }
  } finally {
    await tui.stop();
  }
});

test('a too-old harness carries its minimum, and its update command in full in the detail column', async () => {
  const shared = setup([version('v1.2.0\n')], [entry('skill-a', 'skill')]);
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openStatus(tui);
    const lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 30 });

    // The too-old harness is the only one, so it holds the focus and its row says everything but the fix.
    const row = `${t.tui.marks.focused}${t.harnessLabels['too-old']}  fake  1.2.0 · min 20`;
    assert.ok(
      lines.some((line) => line.slice(0, DETAIL_AT).startsWith(row)),
      `no focused too-old row in:\n${lines.join('\n')}`,
    );
    assert.equal(detail(lines).includes(t.harnessUpdate(['npm', 'install', '-g', '@fake/harness'])), true, detail(lines));
    assert.equal(tui.frame().includes(t.tui.ellipsis), false, 'the update command was cut');
  } finally {
    await tui.stop();
  }
});

test('every row the report has is printed in full once the focus reaches it', async () => {
  const shared = setup([version('v1.2.0\n')], [entry('skill-a', 'skill'), entry('mcp-a', 'mcp'), entry('ghost', 'mcp')]);
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openStatus(tui);
    const rows = reportRows(await readStatus(shared.data, createContext({ home: shared.home, root: OFFLINE_ROOT, runner: new RecordingRunner([version('v1.2.0\n')]), platform: 'linux' })));
    assert.equal(rows.length, 4, rows.map((row) => row.text).join('|'));

    const seen: string[] = [];
    for (let at = 0; at < rows.length; at += 1) {
      if (at > 0) await tui.press('\u001B[B');
      seen.push(detail(tui.lines()));
    }
    const whole = seen.join(' ').replace(/\s+/g, ' ');
    for (const row of rows) {
      assert.ok(whole.includes(row.text.replace(/\s+/g, ' ')), `the detail column never showed ${row.text}`);
    }
    assert.ok(whole.includes(t.harnessUpdate(['npm', 'install', '-g', '@fake/harness'])), 'the update command is in no detail column');
  } finally {
    await tui.stop();
  }
});

test('at 80 columns the focused row wraps under itself: the whole item row arrives', async () => {
  const id = `skill-${'b'.repeat(80)}`;
  const shared = setup([version('v20.0.0\n')], [entry(id, 'skill')]);
  const tui = await startTui({ ...shared, width: 80 });
  try {
    await openStatus(tui);
    // Down past the harness row: the item row is the long one, and it is now the focus.
    await tui.press('\u001B[B');
    expectFrame(tui.lines(), { width: 80, rows: 30 });
    const row = `${t.statusLabels.unknown}  ${id} → fake [skill]`;
    expectFrameText(tui.lines(), row);
    assert.ok(tui.lines().some((line) => line.startsWith(`${t.tui.marks.focused}${t.statusLabels.unknown}`)), tui.frame());
  } finally {
    await tui.stop();
  }
});

test('r re-reads the report without leaving the surface', async () => {
  const shared = setup([version('v1.2.0\n'), version('v20.0.0\n')], [entry('skill-a', 'skill')]);
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openStatus(tui);
    assert.ok(tui.frame().includes(`${t.harnessLabels['too-old']}  fake  1.2.0 · min 20`), tui.frame());

    await tui.press('r');
    await settle(tui, () => tui.frame().includes(`${t.harnessLabels.ready}  fake  20.0.0 · min 20`));
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.status}`), true, 'r left the surface');
    assert.equal(tui.frame().includes(t.harnessLabels['too-old']), false, 'the frame kept the old verdict');
  } finally {
    await tui.stop();
  }
});

test('an empty record renders the sentence the formatter already has', async () => {
  const tui = await startTui({ ...fixture(), width: 120 });
  try {
    await openStatus(tui, t.statusEmpty);
    const lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 30 });
    assert.equal(lines.filter((line) => line === t.statusEmpty).length, 1, lines.join('\n'));
    assert.ok(lines.indexOf(t.itemsTitle) < lines.indexOf(t.statusEmpty), 'the sentence is not under the items heading');
    assert.equal(tui.frame().includes(t.statusLabels.unknown), false, 'an empty record claims an item state');
  } finally {
    await tui.stop();
  }
});

test('no key on the status surface writes: the record and the tree are untouched after a visit', async () => {
  const shared = setup([version('v1.2.0\n')]);
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openStatus(tui);
    const before = snapshot(shared.home);
    const calls = shared.runner.calls.length;

    for (const key of ['\u001B[B', '\u001B[A', '\u001B[6~', '\u001B[5~', 'g', 'G', 'r', 'y', 'n', 'a', ' ', '?']) {
      await tui.press(key);
    }
    await tui.press('\u001B');
    await settle(tui, () => tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.status}`) === true);

    assert.deepEqual(snapshot(shared.home), before, 'a visit to status changed a file');
    for (const argv of shared.runner.calls.slice(calls)) {
      assert.deepEqual(argv, ['node', '--version'], `status ran ${argv.join(' ')}`);
    }
    assert.ok(tui.lines().at(-1)?.includes('Esc back'), 'Esc left the status surface');
  } finally {
    await tui.stop();
  }
});

test('the slow read is named and timed, and Esc stops waiting without leaving', async () => {
  const dir = home([entry('skill-a', 'skill')], { '.fake/.skill-lock.json': '{"skills":{}}' });
  // The read is held open until the test releases it, so the busy frame cannot lose a race with it.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const pending = createContext({
    home: dir,
    root: OFFLINE_ROOT,
    runner: { run: () => gate.then(() => version('v20.0.0\n')) },
    platform: 'linux',
  });
  const tui = await startTui({ data: loadData(OFFLINE_ROOT), ctx: pending, width: 120 });
  try {
    await tui.press('s');
    await settle(tui, () => tui.frame().includes('reading the status…'));
    assert.match(tui.frame(), /reading the status… \d+s/, tui.frame());
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.status}`), true);
    assert.ok((tui.lines().at(-1) ?? '').startsWith('Esc stop waiting'), tui.lines().at(-1) ?? '');

    await tui.press('\u001B');
    assert.ok(tui.frame().includes(t.tui.stoppedWaiting), `no cancelled copy in:\n${tui.frame()}`);
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.status}`), true, 'Esc left the surface instead of stopping');

    await tui.press('\u001B');
    assert.equal(tui.lines()[0]?.startsWith('agentenv  install'), true, 'the previous surface is not reachable');
    expectFrame(tui.lines(), { width: 120, rows: 30 });
  } finally {
    release();
    await tui.stop();
  }
});

test('a read that fails shows its message instead of a blank surface', async () => {
  const ctx = createContext({
    home: fixtureHome(true),
    root: OFFLINE_ROOT,
    runner: { run: () => Promise.reject(new Error('the check died')) },
    platform: 'linux',
  });
  const tui = await startTui({ data: loadData(OFFLINE_ROOT), ctx, width: 120 });
  try {
    await tui.press('s');
    await settle(tui, () => tui.frame().includes('the check died'));
    const lines = tui.lines();
    assert.equal(lines[0]?.startsWith(`agentenv  ${t.tui.surfaces.status}`), true, 'the failure left the surface');
    assert.equal(lines.includes('the check died'), true, lines.join('\n'));
    assert.ok(lines[lines.length - 1]?.includes('r refresh'), 'the keybar went with the failure');
  } finally {
    await tui.stop();
  }
});

/** A root with twelve more harnesses than the fixture has, none of them requiring a version check. */
function manyHarnesses(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-tui-status-'));
  fs.cpSync(OFFLINE_ROOT, root, { recursive: true });
  for (let at = 1; at <= 12; at += 1) {
    const id = `h-${String(at).padStart(2, '0')}`;
    fs.writeFileSync(
      path.join(root, 'harnesses', `${id}.yaml`),
      `id: ${id}\nlabel: Harness ${id}\ndetect: [~/.${id}]\nagentId: ${id}\n`,
      'utf8',
    );
  }
  return root;
}

test('a body taller than the frame windows, and the report warning stays above the keybar', async () => {
  const root = manyHarnesses();
  const shared = setup([version('v20.0.0\n')], [], root);
  // A record that cannot be parsed: `status` warns about it instead of crashing, and the warning is pinned.
  fs.writeFileSync(path.join(shared.home, '.agentenv', 'state.json'), '{ not json', 'utf8');
  const tui = await startTui({ ...shared, width: 120, rows: 16 });
  try {
    await openStatus(tui);
    let lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 16 });
    const warning = t.stateUnreadable(path.join(shared.home, '.agentenv', 'state.json'));
    assert.ok(tui.frame().includes(warning.slice(0, 40)), tui.frame());
    assert.equal(
      lines[lines.length - 2]?.trimEnd().endsWith('recording.'),
      true,
      `the warning is not pinned: ${lines.join('|')}`,
    );
    assert.equal(tui.frame().includes('h-12'), false, 'the whole report fit: the window is not what is under test');

    await tui.press('G');
    lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 16 });
    assert.equal(lines.some((line) => line.includes(`${t.harnessLabels.absent}  h-12`)), true, lines.join('\n'));
    assert.equal(
      lines[lines.length - 2]?.trimEnd().endsWith('recording.'),
      true,
      'the warning scrolled away with the rows',
    );
  } finally {
    await tui.stop();
  }
});

test('a long item list windows: the focus moves, and only the visible slice is mounted', async () => {
  const entries = Array.from({ length: 30 }, (_, at) => entry(`ghost-${at}`, 'mcp'));
  const shared = setup([version('v20.0.0\n')], entries);
  const tui = await startTui({ ...shared, width: 120, rows: 16 });
  try {
    await openStatus(tui);
    let lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 16 });
    assert.equal(
      lines.some((line) => line.startsWith(`${t.statusLabels.unknown}  ghost-0 `)),
      true,
      lines.join('|'),
    );
    assert.equal(tui.frame().includes('ghost-29'), false, 'the whole list fit: the window is not what is under test');

    await tui.press('G');
    lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 16 });
    assert.equal(
      lines.some((line) => line.startsWith(`${t.tui.marks.focused}${t.statusLabels.unknown}  ghost-29 `)),
      true,
      lines.join('\n'),
    );
    assert.equal(tui.frame().includes('ghost-0 →'), false, 'G did not scroll the list');
  } finally {
    await tui.stop();
  }
});

test('at 40 columns every row still leads with its state word and no line leaves the frame', async () => {
  const shared = setup([version('v1.2.0\n')], [entry('skill-a', 'skill'), entry('mcp-a', 'mcp')]);
  const tui = await startTui({ ...shared, width: 40 });
  try {
    await openStatus(tui);
    const lines = tui.lines();
    expectFrame(lines, { width: 40, rows: 30 });
    assert.equal(lines[0], `agentenv  ${t.tui.surfaces.status}`);
    assert.ok(
      lines.some((line) => line.startsWith(`${t.tui.marks.focused}${t.harnessLabels['too-old']}  fake  1.2.0 · min 20`)),
      lines.join('\n'),
    );
    assert.ok(lines.some((line) => line.trimStart().startsWith(t.harnessUpdate(['npm', 'install', '-g', '@fake/harness']))), 'the update command is not under its row');
    assert.ok(lines.some((line) => line.startsWith(`${t.statusLabels['up-to-date']}  skill-a`)), lines.join('\n'));
  } finally {
    await tui.stop();
  }
});
