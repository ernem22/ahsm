import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createContext, type Ctx, type RunResult, type Runner } from '../src/context.js';
import { readState, recordEntry } from '../src/core/state.js';
import { buildUpdatePlan } from '../src/core/update.js';
import { loadData } from '../src/data.js';
import { t } from '../src/i18n.js';
import type { Data } from '../src/types.js';
import { expectFrame, fixtureHome, OFFLINE_ROOT, startTui, waitIdle, type TuiHarness } from './tui-harness.js';

const HASH = '0123456789abcdef0123456789abcdef01234567';
/** The provider's check as the in-memory runner answers it: what the surface's read depends on. */
const CHECK_AT = 1;

interface LockEntry {
  source: string;
  sourceType: string;
  skillPath: string;
  skillFolderHash: string;
}

function locked(source: string): LockEntry {
  return { source, sourceType: 'github', skillPath: 'skills/x/SKILL.md', skillFolderHash: HASH };
}

interface Options {
  /** The provider's own lockfile: the only thing the freshness check compares. */
  lock?: Record<string, LockEntry>;
  /** Skills the check prints as `has an update`. */
  stale?: string[];
  /** Sources the check prints as `Failed to check`. */
  unreachable?: string[];
  /** The collapsed state.json entries: which item was installed for which skill on `fake`. */
  records?: { itemId: string; skill: string }[];
  /** Installs the runner fails, so a partial failure reaches the result. */
  fail?: string[];
  /** A runner that holds its installs open, for the in-flight frame. */
  gate?: { promise: Promise<void> };
}

interface Setup {
  data: Data;
  ctx: Ctx;
  home: string;
  runner: FakeRunner;
}

/** The upstream markers the fixture check would read, stated as the output it prints. */
function checkOutput(options: Options): string {
  const stale = options.stale ?? [];
  const unreachable = options.unreachable ?? [];
  const lines = ['Checking for skill updates…', '', 'Checking skills from source: fixture/skills'];
  for (const name of stale) lines.push(`↑ ${name} has an update`);
  for (const source of unreachable) lines.push(`  ✗ Failed to check skills from ${source}`);
  lines.push('');
  if (stale.length > 0) lines.push(`${stale.length} skill(s) can be updated; run npx skills update to install`);
  else lines.push('✓ All global skills are up to date');
  return `${lines.join('\n')}\n`;
}

/** Answers the provider's check, the requirement probes and the install, and lands installs in the lockfile. */
class FakeRunner implements Runner {
  readonly calls: string[][] = [];
  readonly installs: string[][] = [];
  /** The check a test is holding open: until the release runs, the surface's busy line stays on screen. */
  private held: Promise<void> | undefined;

  constructor(
    private readonly home: string,
    private readonly options: Options,
  ) {}

  /**
   * Holds the provider's next check until the returned release, so the frame says `provider update
   * check` for as long as the test needs it to: an instant answer never renders a busy frame to wait on.
   */
  holdCheck(): () => void {
    let release = (): void => {};
    this.held = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.held = undefined;
      release();
    };
  }

  async run(argv: string[]): Promise<RunResult> {
    this.calls.push(argv);
    if (argv[CHECK_AT]?.endsWith('check-skills.mjs')) {
      if (this.held) await this.held;
      return { code: 0, stdout: checkOutput(this.options), stderr: '' };
    }
    if (argv.join(' ') === 'node --version') return { code: 0, stdout: 'v22.1.0', stderr: '' };
    if (argv[1]?.endsWith('install-skill.mjs')) {
      if (this.options.gate) await this.options.gate.promise;
      const source = argv[2] ?? '';
      const skill = argv[3] ?? '';
      this.installs.push(argv);
      if (this.options.fail?.includes(skill)) return { code: 1, stdout: '', stderr: `${skill}: install failed` };
      const lock = readLock(this.home);
      writeLock(this.home, { ...lock, [skill]: locked(source) });
      return { code: 0, stdout: `installed ${skill}`, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  }
}

function lockPath(home: string): string {
  return path.join(home, '.fake', '.skill-lock.json');
}

function readLock(home: string): Record<string, LockEntry> {
  const file = lockPath(home);
  if (!fs.existsSync(file)) return {};
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { skills?: Record<string, LockEntry> }).skills ?? {};
}

function writeLock(home: string, skills: Record<string, LockEntry>): void {
  fs.mkdirSync(path.dirname(lockPath(home)), { recursive: true });
  fs.writeFileSync(lockPath(home), JSON.stringify({ version: 3, skills }, null, 2), 'utf8');
}

/** A copy of the offline root with the extra skill items the update scenarios map stale skills onto. */
function updateRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ahsm-tui-update-'));
  fs.cpSync(OFFLINE_ROOT, root, { recursive: true });
  for (const [id, skill] of [
    ['skill-b', 'beta'],
    ['skill-d', 'delta'],
  ] as [string, string][]) {
    fs.writeFileSync(
      path.join(root, 'catalog', `${id}.yaml`),
      `id: ${id}\nkind: skill\nsource: fixture/skills\nskill: ${skill}\ntargets: "*"\n`,
      'utf8',
    );
  }
  return root;
}

function setup(options: Options = {}): Setup {
  const home = fixtureHome();
  fs.mkdirSync(path.join(home, '.fake'), { recursive: true });
  const runner = new FakeRunner(home, options);
  writeLock(home, options.lock ?? {});
  const root = updateRoot();
  const data = loadData(root);
  const ctx = createContext({ home, root, runner, platform: 'linux' });
  for (const record of options.records ?? []) {
    recordEntry(ctx, readState(ctx).state, {
      ref: { itemId: record.itemId, harness: 'fake', providerId: 'fake-skills' },
      kind: 'skill',
      command: ['node', 'install-skill.mjs', 'fixture/skills', record.skill],
    });
  }
  return { data, ctx, home, runner };
}

/** One stale skill mapped to an item and a recorded harness, one up-to-date, one unreachable source. */
function mixed(extra: Partial<Options> = {}): Setup {
  return setup({
    lock: {
      alpha: locked('fixture/skills'),
      beta: locked('fixture/skills'),
      fresh: locked('fixture/skills'),
      gone: locked('owner/missing'),
      gamma: locked('fixture/skills'),
      delta: locked('fixture/skills'),
    },
    stale: ['alpha', 'beta', 'gamma', 'delta'],
    unreachable: ['owner/missing'],
    records: [
      { itemId: 'skill-a', skill: 'alpha' },
      { itemId: 'skill-b', skill: 'beta' },
    ],
    ...extra,
  });
}

/** A read is a promise: the frame that shows its answer arrives a turn after the key that started it. */
async function settle(tui: TuiHarness, done: () => boolean, deadlineMs = 1500): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(done(), `the frame never said what it should:\n${tui.frame()}`);
}

/**
 * A key that lands on a surface which reads on entry — `u`, `v`, `n`, `Esc` — and then that surface's
 * own answer. A surface entered again still holds the answer of its last visit, and that answer is
 * rendered for a frame before the read this visit started takes the frame, so the plan alone says
 * nothing about whether the read has run. The provider's check is held instead: the busy line proves
 * the read is the one on screen, and only then is the answer waited for. No key is pressed into a read
 * that is still running, whatever the machine's speed.
 */
async function readAgain(tui: TuiHarness, shared: Setup, key: string, done: () => boolean): Promise<void> {
  const release = shared.runner.holdCheck();
  try {
    // The key that lands on the next surface is only that surface's once this one has answered: a read
    // still in flight would spend an `Esc` on stopping itself instead of declining.
    await waitIdle(tui);
    await tui.press(key);
    await settle(tui, () => tui.frame().includes(t.tui.updateCheck));
  } finally {
    release();
  }
  await settle(tui, done);
}

/** The stale surface has answered: its heading or its one-sentence empty answer is on the frame. */
function staleReady(tui: TuiHarness): boolean {
  return tui.frame().includes(t.staleTitle) || tui.frame().includes(t.staleEmpty);
}

/** The update surface has answered: its plan or its one-sentence answer is on the frame. */
function updateReady(tui: TuiHarness): boolean {
  return tui.frame().includes(t.updateTitle) || tui.frame().includes(t.updateNone);
}

/** `u`, then the plan its own check answered, never the one the surface still holds from the last visit. */
async function openUpdate(tui: TuiHarness, shared: Setup, from: 'install' | 'stale' = 'install'): Promise<void> {
  if (from === 'stale') {
    await tui.press('v');
    await settle(tui, () => staleReady(tui));
  }
  await readAgain(tui, shared, 'u', () => updateReady(tui));
}

/** The plan rows in the row column, focused or not: each is a whole formatter line (detail excluded). */
function planRows(lines: string[]): string[] {
  return lines
    .map((line) => line.slice(0, 50).trimEnd())
    .filter((line) => line.replace(/^[> ]+/, '').startsWith('+ '))
    .map((line) => line.replace(/^[> ]+/, ''));
}

/** One line's index, or a failure that shows the whole frame rather than a number. */
function at(lines: string[], text: string): number {
  const index = lines.findIndex((line) => line.includes(text));
  assert.notEqual(index, -1, `${text} is not in:\n${lines.join('\n')}`);
  return index;
}

async function result(tui: TuiHarness): Promise<string[]> {
  await settle(tui, () => tui.frame().includes(t.tui.resultTitle), 2500);
  return tui.lines();
}

test('the update plan holds only the stale skills, one row per skill and harness, and never an unknown one', async () => {
  const shared = mixed();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openUpdate(tui, shared);
    const lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 30 });
    assert.equal(lines[0]?.startsWith(`ahsm  ${t.tui.surfaces.update}`), true);
    assert.equal(lines[2], t.tui.surfaces.update);
    assert.ok(at(lines, t.updateTitle) > 3, 'the UPDATE heading is not under the surface name');

    // Exactly the two stale skills that map to an item and a record are in the plan.
    assert.deepEqual(planRows(lines), ['+ skill-a → fake [skill/fake-skills]', '+ skill-b → fake [skill/fake-skills]']);
    assert.ok(tui.frame().includes(t.updateCount(4, 2)), tui.frame());

    // The up-to-date skill, the unreachable source and the two skipped skills are not plan rows.
    assert.equal(planRows(lines).some((row) => row.includes('fresh')), false, 'an up-to-date skill entered the plan');
    assert.equal(planRows(lines).some((row) => row.includes('gone')), false, 'an unknown skill entered the plan');
    assert.equal(tui.frame().includes(t.staleUnreachable('owner/missing')), false, 'the unknown source was planned');

    // The skipped skills are said before the heading, never dropped, and they still count as stale.
    const item = at(lines, t.updateNoItem('gamma'));
    const record = at(lines, t.updateNoRecord('delta'));
    assert.ok(item < at(lines, t.updateTitle), 'the no-item skip is not before the plan');
    assert.ok(record < at(lines, t.updateTitle), 'the no-record skip is not before the plan');
    assert.ok(lines[item]?.startsWith('! '), lines[item] ?? '');
    assert.ok(lines[record]?.startsWith('! '), lines[record] ?? '');
    // The install path and the record are the plan's own: one command per stale skill.
    assert.ok(tui.frame().includes('run: node'), tui.frame());
    assert.ok(tui.frame().includes('alpha is stale'), tui.frame());
  } finally {
    await tui.stop();
  }
});

test('y installs exactly the stale skills through the install path and records them', async () => {
  const shared = mixed();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openUpdate(tui, shared);
    await tui.press('y');
    const lines = await result(tui);
    expectFrame(lines, { width: 120, rows: 30 });

    assert.deepEqual(
      shared.runner.installs.map((argv) => [argv[2], argv[3]]),
      [
        ['fixture/skills', 'alpha'],
        ['fixture/skills', 'beta'],
      ],
      'the update installed something other than the two stale skills',
    );
    // The result is one row per skill, in the formatter's own words, then the plan's record is refreshed.
    const installed = at(lines, `${t.applyLabels.ok}  skill-a → fake`);
    assert.ok(at(lines, `${t.applyLabels.ok}  skill-b → fake`) > installed, 'the second skill has no result row');
    const state = readState(shared.ctx).state;
    assert.deepEqual(
      state.entries.map((entry) => entry.itemId).sort(),
      ['skill-a', 'skill-b'],
      'the record was not written for both updated skills',
    );

    // The skip survives into the result and stays above the installs.
    const skip = at(lines, t.updateNoItem('gamma'));
    assert.ok(skip < installed, 'the skip is not before the installs in the result');
    assert.ok(lines.includes(`! ${t.staleUnreachable('owner/missing')}`) === false, 'an unknown source was reported as updated');
  } finally {
    await tui.stop();
  }
});

test('a partial failure is one row per skill: one installed, one error, and the rest still attempted', async () => {
  const shared = mixed({ fail: ['beta'] });
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openUpdate(tui, shared);
    await tui.press('y');
    const lines = await result(tui);

    assert.equal(lines.includes(`${t.applyLabels.ok}  skill-a → fake`), true, lines.join('\n'));
    const failure = lines.find((line) => line.startsWith(`${t.applyLabels.error}  skill-b → fake`));
    assert.ok(failure?.includes('install failed'), String(failure));
    assert.equal(failure?.includes('beta'), true, 'the error row does not say which skill failed');
    // The failure did not stop the plan or hide the skip line.
    assert.equal(shared.runner.installs.length, 2, 'the second skill was not attempted');
    assert.ok(at(lines, t.updateNoItem('gamma')) < at(lines, `${t.applyLabels.ok}  skill-a → fake`));
  } finally {
    await tui.stop();
  }
});

test('n and Esc decline without writing, back to the surface u was opened from', async () => {
  const shared = mixed();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openUpdate(tui, shared, 'stale');
    // `n` lands on stale, which reads again: its own answer has to arrive before the next key.
    await readAgain(tui, shared, 'n', () => staleReady(tui));
    assert.equal(tui.lines()[0]?.startsWith(`ahsm  ${t.tui.surfaces.stale}`), true, tui.lines()[0] ?? '');
    assert.deepEqual(shared.runner.installs, [], 'n wrote something');

    await openUpdate(tui, shared, 'stale');
    await readAgain(tui, shared, '\u001B', () => staleReady(tui));
    assert.equal(tui.lines()[0]?.startsWith(`ahsm  ${t.tui.surfaces.stale}`), true, tui.lines()[0] ?? '');
    assert.deepEqual(shared.runner.installs, [], 'Esc wrote something');

    // Opened from the rail, the same key goes back to install instead. Stale has answered above, so
    // this Esc is the surface's back, not the stop-waiting key a read in flight would claim.
    await waitIdle(tui);
    await tui.press('\u001B');
    assert.equal(tui.lines()[0]?.startsWith(`ahsm  ${t.tui.surfaces.install}`), true, tui.lines()[0] ?? '');
    await openUpdate(tui, shared);
    await waitIdle(tui);
    await tui.press('\u001B');
    assert.equal(tui.lines()[0]?.startsWith(`ahsm  ${t.tui.surfaces.install}`), true, tui.lines()[0] ?? '');
    assert.deepEqual(shared.runner.installs, [], 'declining from the rail wrote something');
  } finally {
    await tui.stop();
  }
});

test('the honest answers: nothing stale, nothing mapped, nothing recorded, and a source that could not be read', async () => {
  const cases: { name: string; options: Options; expected: string[]; absent?: string[] }[] = [
    {
      name: 'no stale skill',
      options: { lock: { fresh: locked('fixture/skills') } },
      expected: [t.updateNone],
      absent: ['UPDATE'],
    },
    {
      name: 'a stale skill with no catalogue item',
      options: { lock: { gamma: locked('fixture/skills') }, stale: ['gamma'] },
      expected: [`! ${t.updateNoItem('gamma')}`, t.updateNone],
    },
    {
      name: 'a stale skill with no record',
      options: { lock: { delta: locked('fixture/skills') }, stale: ['delta'] },
      expected: [`! ${t.updateNoRecord('delta')}`, t.updateNone],
    },
    {
      name: 'a source that could not be read',
      options: {
        lock: { delta: locked('owner/missing') },
        unreachable: ['owner/missing'],
        records: [{ itemId: 'skill-d', skill: 'delta' }],
      },
      // The unknown row is stale's answer, not the plan's: the update never guesses it is stale.
      expected: [t.updateNone],
      absent: ['delta', t.staleUnreachable('owner/missing'), '+ '],
    },
    {
      name: 'more skips than the frame can hold',
      options: {
        lock: Object.fromEntries(Array.from({ length: 30 }, (_, at) => [`unmapped-${at}`, locked('fixture/skills')])),
        stale: Array.from({ length: 30 }, (_, at) => `unmapped-${at}`),
      },
      // The answer is the formatter's last line, so it stays above the keybar however many skips precede it.
      expected: [t.updateNone],
    },
  ];

  for (const scenario of cases) {
    const shared = setup(scenario.options);
    const tui = await startTui({ ...shared, width: 120 });
    try {
      await openUpdate(tui, shared);
      expectFrame(tui.lines(), { width: 120, rows: 30 });
      const frame = tui.frame();
      for (const text of scenario.expected) assert.ok(frame.includes(text), `${scenario.name}: missing ${text}\n${frame}`);
      for (const text of scenario.absent ?? []) {
        assert.equal(frame.includes(text), false, `${scenario.name}: ${text} should not be there\n${frame}`);
      }
      assert.deepEqual(shared.runner.installs, [], `${scenario.name}: the plan installed something`);
    } finally {
      await tui.stop();
    }
  }
});

test('the in-flight screen is the apply surface\'s: named, shaped, timed and refusing to leave', async () => {
  let release!: () => void;
  const gate = { promise: new Promise<void>((resolve) => (release = resolve)) };
  const shared = setup({
    lock: { alpha: locked('fixture/skills'), gamma: locked('fixture/skills') },
    stale: ['alpha', 'gamma'],
    records: [{ itemId: 'skill-a', skill: 'alpha' }],
    gate,
  });
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openUpdate(tui, shared);
    await tui.press('y');
    await settle(tui, () => /applying… \d+s/.test(tui.frame()));
    const busy = tui.frame();
    assert.ok(busy.includes(t.tui.applyShape(1, 0, 0)), busy);
    assert.ok(busy.includes(t.tui.applyNothingElse), busy);
    assert.ok(busy.includes(t.tui.applyRefusal), busy);
    // The skip line is printed before the installs, in flight as well as after.
    assert.ok(at(tui.lines(), t.updateNoItem('gamma')) < at(tui.lines(), 'applying…'), busy);
    for (const key of ['q', '\u001B', 'n']) {
      await tui.press(key);
      assert.equal(tui.lines()[0]?.startsWith(`ahsm  ${t.tui.surfaces.update}`), true, `${key} left the write`);
      assert.ok(tui.frame().includes(t.tui.applyRefusal), tui.frame());
    }

    release();
    const lines = await result(tui);
    assert.ok(lines.includes(`${t.applyLabels.ok}  skill-a → fake`), lines.join('\n'));
    assert.equal(tui.frame().includes(t.tui.applyRefusal), false, 'the refusal outlived the write');
    // `v` goes back to the freshness check the result changes the answer to.
    const keybar = lines.at(-1) ?? '';
    assert.ok(keybar.includes(`${t.tui.keyNames.return} ${t.tui.keys.exit}`), keybar);
    assert.ok(keybar.includes(`v ${t.tui.keys.staleAgain}`), keybar);
    await tui.press('v');
    assert.equal(tui.lines()[0]?.startsWith(`ahsm  ${t.tui.surfaces.stale}`), true, tui.lines()[0] ?? '');
  } finally {
    await tui.stop();
  }
});

test('the plan and its confirm name their keys: y apply, n decline, Esc back, r refresh', async () => {
  const shared = mixed();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openUpdate(tui, shared);
    const keybar = tui.lines().at(-1) ?? '';
    for (const entry of ['y apply', 'n decline', 'Esc back', '? keys', 'r refresh']) {
      assert.ok(keybar.includes(entry), keybar);
    }
  } finally {
    await tui.stop();
  }
});

/** How many times the provider's own check was spawned: the update surface's one slow read. */
function checkCalls(shared: Setup): number {
  return shared.runner.calls.filter((argv) => (argv[1] ?? '').endsWith('check-skills.mjs')).length;
}

test('r runs the provider check again and keeps the plan', async () => {
  const shared = mixed();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openUpdate(tui, shared);
    const before = checkCalls(shared);
    assert.ok(before >= 1, 'the surface never ran the check');

    await tui.press('r');
    await settle(tui, () => checkCalls(shared) > before && tui.frame().includes(t.updateTitle));
    assert.equal(checkCalls(shared), before + 1, 'r did not re-run the check exactly once');
    assert.deepEqual(planRows(tui.lines()), ['+ skill-a → fake [skill/fake-skills]', '+ skill-b → fake [skill/fake-skills]']);
    assert.equal(tui.lines()[0]?.startsWith(`ahsm  ${t.tui.surfaces.update}`), true, tui.lines()[0] ?? '');
  } finally {
    await tui.stop();
  }
});

test('y is not offered when the plan has no entries, and pressing it says why', async () => {
  const shared = setup({ lock: { fresh: locked('fixture/skills') } });
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openUpdate(tui, shared);
    assert.ok(tui.frame().includes(t.updateNone), tui.frame());
    // A bar never advertises a key that would run nothing.
    assert.equal((tui.lines().at(-1) ?? '').includes('y apply'), false, tui.lines().at(-1) ?? '');

    await tui.press('y');
    assert.equal(tui.lines()[0]?.startsWith(`ahsm  ${t.tui.surfaces.update}`), true, tui.lines()[0] ?? '');
    // The refusal is the status line's, right above the keybar.
    assert.equal(tui.lines().at(-2), t.updateNone, tui.frame());
    assert.equal(tui.frame().includes(t.tui.resultTitle), false, `an empty plan produced a result: ${tui.frame()}`);
    assert.deepEqual(shared.runner.installs, [], 'an empty plan installed something');
  } finally {
    await tui.stop();
  }
});

test('at 40 columns the skips wrap, the rows stay whole and no line leaves the frame', async () => {
  const shared = mixed();
  const tui = await startTui({ ...shared, width: 40 });
  try {
    await openUpdate(tui, shared);
    const lines = tui.lines();
    expectFrame(lines, { width: 40, rows: 30 });
    // The skip is a sentence the user must read: it wraps instead of being cut with an ellipsis.
    const flat = lines.join(' ').replace(/\s+/g, ' ');
    assert.ok(flat.includes(t.updateNoItem('gamma')), lines.join('\n'));
    assert.ok(flat.includes(t.updateNoRecord('delta')), lines.join('\n'));
    assert.ok(lines.some((line) => line.startsWith('> + skill-a → fake')), lines.join('\n'));
    assert.ok((lines.at(-1) ?? '').includes('y apply'), lines.at(-1) ?? '');
  } finally {
    await tui.stop();
  }
});

test('the plan is the core\'s: buildUpdatePlan and the surface name the same two entries', async () => {
  const shared = mixed();
  const update = await buildUpdatePlan(shared.data, shared.ctx);
  assert.deepEqual(
    update.plan.entries.map((entry) => [entry.itemId, entry.harness]),
    [
      ['skill-a', 'fake'],
      ['skill-b', 'fake'],
    ],
    'the fixture no longer holds two mappable stale skills',
  );
  assert.equal(update.skips.length, 2, update.skips.map((skip) => skip.reason).join('\n'));
});
