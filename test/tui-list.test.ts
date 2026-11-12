import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createContext, RecordingRunner, type Ctx } from '../src/context.js';
import { loadData } from '../src/data.js';
import { t } from '../src/i18n.js';
import type { InstalledSkill, SkillsAdapter } from '../src/providers/skills-api.js';
import type { Data } from '../src/types.js';
import { expectFrame, fixtureHome, OFFLINE_ROOT, startTui, type TuiHarness } from './tui-harness.js';

/** Where the detail column starts at 120 columns: the 50-column list, then the 2-column gutter. */
const DETAIL_AT = 52;
/** Where the rows of the body start: the header's two lines and the surface's own name. */
const ROWS_AT = 4;

interface Setup {
  data: Data;
  ctx: Ctx;
  home: string;
  runner: RecordingRunner;
}

/** The offline data root, a fake home, and a skills API that answers from memory — never the network. */
function setup(installed: InstalledSkill[], list?: SkillsAdapter['list'], detected = true): Setup {
  const home = fixtureHome(detected);
  const runner = new RecordingRunner();
  const skills: SkillsAdapter = {
    install: async () => ({ installed: [], failed: [] }),
    remove: async () => ({ removed: [], notFound: [], failed: [] }),
    list: list ?? (async () => installed),
  };
  return { data: loadData(OFFLINE_ROOT), ctx: createContext({ home, root: OFFLINE_ROOT, runner, platform: 'linux', skills }), home, runner };
}

/** A read is a promise: the frame that shows its result arrives a turn after the key that started it. */
async function settle(tui: TuiHarness, done: () => boolean, deadlineMs = 1500): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(done(), `the frame never said what it should:\n${tui.frame()}`);
}

/** `l`, then the inventory itself: the surface prints only its name until the read resolves. */
async function openList(tui: TuiHarness): Promise<void> {
  await tui.press('l');
  await settle(tui, () => tui.frame().includes(t.skillsTitle) || tui.frame().includes(t.listEmpty));
}

/** 103 skills, the first one a 177-column row, so a window and a detail column both have work to do. */
function many(largest = 128): InstalledSkill[] {
  const skills: InstalledSkill[] = [
    { name: 'ask-sonner', source: `owner/${'s'.repeat(largest)}`, agents: ['fake'] },
    { name: 'sonner', source: 'emilkowalski/skills', agents: ['fake'] },
    { name: 'toast-placement', source: 'emilkowalski/skills', agents: ['fake'] },
  ];
  for (let at = skills.length; at < 103; at += 1) {
    skills.push({ name: `z-${String(at).padStart(3, '0')}`, source: 'owner/repo', agents: [] });
  }
  return skills;
}

/** The detail column read as one string: wrapping may move a word, never drop one. */
function detail(lines: string[]): string {
  return lines.map((line) => line.slice(DETAIL_AT)).join(' ').replace(/\s+/g, ' ');
}

/** One frame line as a string: an absent line is empty, so it fails the assertion it feeds. */
function at(lines: string[], index: number): string {
  return lines[index] ?? '';
}

/** Every file under a directory with its bytes: a visit that wrote anything would show here. */
function snapshot(dir: string): string {
  const hash = crypto.createHash('sha256');
  const walk = (at: string): void => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(at, entry.name);
      hash.update(`${path.relative(dir, full)}:${entry.isDirectory() ? 'dir' : fs.readFileSync(full)}`);
      if (entry.isDirectory()) walk(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return hash.digest('hex');
}

test('the list surface prints one row per skill, the window in the heading and only the slice mounted', async () => {
  const shared = setup(many());
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openList(tui);
    const lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 30 });
    assert.equal(lines[2], t.tui.surfaces.list);
    assert.ok(lines[3]?.startsWith(t.skillsTitle), at(lines, 3));
    assert.match(at(lines, 3), /1[–-]\d+ of 103/);

    // The formatter's trailer is the last full-width line of the body.
    const trailer = t.listCount(103);
    assert.ok(tui.frame().includes(trailer), `no trailer in:\n${tui.frame()}`);

    // Only the visible slice is mounted: the last skill of 103 is not on the first page.
    assert.equal(tui.frame().includes('z-102'), false, 'the whole inventory was mounted at once');

    // Every body row is one line: nothing wrapped.
    const rows = lines.slice(ROWS_AT, lines.findIndex((line) => line.includes(trailer)));
    assert.equal(rows.length, Number(/1[–-](\d+) of 103/.exec(lines[3] ?? '')?.[1] ?? 0), 'the window count is not the rows shown');
    for (const row of rows) assert.ok(row.length <= 120, `a row wrapped: ${row}`);
  } finally {
    await tui.stop();
  }
});

test('a page moves the window and the heading counts up with it', async () => {
  const shared = setup(many());
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openList(tui);
    const first = tui.lines()[3] ?? '';
    await tui.press('\u001B[B');
    // One Down moves the focus, not the window: the 23-row page still starts at the first skill.
    assert.equal(tui.lines()[ROWS_AT + 1]?.startsWith(t.tui.marks.focused), true, at(tui.lines(), ROWS_AT + 1));
    await tui.press('\u001B[6~');
    const paged = tui.lines()[3] ?? '';
    assert.notEqual(paged, first, 'PgDn did not page the window');
    assert.match(paged, /of 103/);
    assert.equal(tui.frame().includes('z-102'), false, 'the window mounted the whole list');
    await tui.press('G');
    assert.ok(tui.frame().includes('z-102'), 'G did not reach the last skill');
    expectFrame(tui.lines(), { width: 120, rows: 30 });
  } finally {
    await tui.stop();
  }
});

test('slash filters as you type, states the matched count, and Esc clears before it leaves', async () => {
  const shared = setup(many());
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openList(tui);
    await tui.press('/');
    const keybar = tui.lines();
    assert.ok(at(keybar, keybar.length - 1).startsWith('Esc clear filter'), at(keybar, keybar.length - 1));
    for (const key of ['s', 'o', 'n', 'n', 'e', 'r']) await tui.press(key);

    const filtered = tui.lines();
    assert.ok(filtered[3]?.includes('filter: sonner'), at(filtered, 3));
    const match = t.tui.listMatch(2, 103);
    assert.ok(tui.frame().includes(match), `no matched count in:\n${tui.frame()}`);
    assert.equal(tui.frame().includes('z-001'), false, 'the filter did not narrow');
    assert.ok(tui.frame().includes('ask-sonner'), 'a matching row was filtered out');

    // Esc clears the filter and stays; a second Esc leaves the surface.
    await tui.press('\u001B');
    assert.ok((tui.lines()[3] ?? '').includes('filter: none'), at(tui.lines(), 3));
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.list}`), true, 'Esc cleared the surface, not the filter');
    assert.equal(tui.frame().includes(match), false, 'the cleared filter still counts matches');
    await tui.press('\u001B');
    assert.equal(tui.lines()[0]?.startsWith('agentenv  install'), true, 'Esc did not leave the surface');
  } finally {
    await tui.stop();
  }
});

test('f keeps only the skills the chosen selection carries, and says so in the heading', async () => {
  const installed: InstalledSkill[] = [
    { name: 'alpha', source: 'owner/repo', agents: ['fake'] },
    { name: 'beta', source: 'owner/repo', agents: [] },
    { name: 'gamma', source: 'owner/repo', agents: ['some-other-agent'] },
  ];
  const shared = setup(installed);
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openList(tui);
    await tui.press('f');
    const lines = tui.lines();
    assert.ok(lines[3]?.includes(`carriers: fake`), at(lines, 3));
    assert.ok(tui.frame().includes(t.tui.listMatch(1, 3)), tui.frame());
    assert.ok(tui.frame().includes('alpha'), 'the carried skill was filtered out');
    assert.equal(tui.frame().includes('beta'), false, 'an uncarried skill survived the toggle');
    assert.equal(tui.frame().includes(t.listNoHarness), false, 'a skill with no harness survived the toggle');

    // `f` again is the way back to the whole inventory.
    await tui.press('f');
    assert.equal((tui.lines()[3] ?? '').includes('carriers:'), false, at(tui.lines(), 3));
    assert.ok(tui.frame().includes('beta'), 'toggling carriers off did not restore the rows');
  } finally {
    await tui.stop();
  }
});

test('f with nothing chosen refuses and says why', async () => {
  const shared = setup(many(), undefined, false);
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openList(tui);
    await tui.press('f');
    assert.ok(tui.frame().includes(t.tui.listNoCarriers), tui.frame());
    assert.equal((tui.lines()[3] ?? '').includes('carriers:'), false, 'the refusal still toggled the filter');
  } finally {
    await tui.stop();
  }
});

test('a 177-column row truncates in the row column and appears whole in the detail column', async () => {
  // `user  ask-sonner [source] → fake` is exactly 177 columns at this source length.
  const row = `user  ask-sonner [owner/${'s'.repeat(145)}] → fake`;
  assert.equal(row.length, 177);
  const shared = setup([{ name: 'ask-sonner', source: `owner/${'s'.repeat(145)}`, agents: ['fake'] }]);
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openList(tui);
    const lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 30 });
    const head = (lines[ROWS_AT] ?? '').slice(0, 50);
    assert.ok(head.trimEnd().endsWith(t.tui.ellipsis), `the row column did not truncate: ${head}`);
    assert.equal(head.includes(row), false, 'the whole row was printed in the row column');
    // The detail column wraps, and a wrap may add or move a space — never drop a character.
    const flat = (text: string): string => text.replace(/\s+/g, '');
    assert.ok(flat(detail(lines)).includes(flat(row)), `the detail column lost the row:\n${detail(lines)}`);
  } finally {
    await tui.stop();
  }
});

test('the slow read is named and timed, and Esc stops waiting without leaving', async () => {
  const shared = setup([], () => new Promise<InstalledSkill[]>(() => {}));
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await tui.press('l');
    await settle(tui, () => tui.frame().includes('reading the provider inventory…'));
    assert.match(tui.frame(), /reading the provider inventory… \d+s/, tui.frame());
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.list}`), true);

    await tui.press('\u001B');
    assert.ok(tui.frame().includes(t.tui.listStopped), `no stopped copy in:\n${tui.frame()}`);
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.list}`), true, 'Esc left the surface instead of stopping');

    await tui.press('\u001B');
    assert.equal(tui.lines()[0]?.startsWith('agentenv  install'), true, 'the previous surface is not reachable');
    expectFrame(tui.lines(), { width: 120, rows: 30 });
  } finally {
    await tui.stop();
  }
});

test('r reads again, an empty inventory says so, and a failed read keeps the surface', async () => {
  let calls = 0;
  const empty = setup([], async () => {
    calls += 1;
    if (calls === 2) throw new Error('lockfile missing');
    return [];
  });
  const tui = await startTui({ ...empty, width: 120 });
  try {
    await openList(tui);
    assert.ok(tui.frame().includes(t.listEmpty), tui.frame());
    await tui.press('r');
    await settle(tui, () => tui.frame().includes('lockfile missing'));
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.list}`), true, 'the failure left the surface');
    expectFrame(tui.lines(), { width: 120, rows: 30 });
  } finally {
    await tui.stop();
  }
});

test('the list is read-only: a visit writes nothing and runs nothing', async () => {
  const shared = setup(many());
  const before = snapshot(shared.home);
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openList(tui);
    for (const key of ['\u001B[B', '\u001B[6~', 'G', '/', 's', '\u001B', '\u001B', 'l', 'f', 'f', 'r']) await tui.press(key);
    await settle(tui, () => tui.frame().includes(t.listCount(103)));
    assert.equal(snapshot(shared.home), before, 'the list surface wrote to the home');
    assert.deepEqual(shared.runner.calls, [], 'the list surface ran a command');
  } finally {
    await tui.stop();
  }
});

test('at 40 columns the window and the filter still fit, and no line leaves the frame', async () => {
  const shared = setup(many());
  const tui = await startTui({ ...shared, width: 40 });
  try {
    await openList(tui);
    expectFrame(tui.lines(), { width: 40, rows: 30 });
    assert.ok((tui.lines()[3] ?? '').includes('of 103'), at(tui.lines(), 3));
    await tui.press('/');
    for (const key of ['s', 'o', 'n']) await tui.press(key);
    expectFrame(tui.lines(), { width: 40, rows: 30 });
  } finally {
    await tui.stop();
  }
});
