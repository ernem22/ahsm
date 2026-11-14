import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createContext, RecordingRunner, type RunResult } from '../src/context.js';
import { buildPlan, type Plan, type PlanEntry } from '../src/core/plan.js';
import { loadData } from '../src/data.js';
import { t } from '../src/i18n.js';
import { planLines } from '../src/render.js';
import { orderedPlan } from '../src/tui/plan.js';
import type { Data } from '../src/types.js';
import { expectFrame, expectFrameText, OFFLINE_ROOT, fixture, fixtureHome, startTui, type TuiHarness } from './tui-harness.js';

const ITEMS = ['skill-a', 'mcp-a', 'hook-a'];
/** Where the detail column starts at 120 columns: the 50-column list, then the 2-column gutter. */
const DETAIL_AT = 52;

/** What the requirement check prints, as the CLI would receive it. */
function version(stdout: string): RunResult {
  return { code: 0, stdout, stderr: '' };
}

/** The plan's two requirement checks, node and the harness's own CLI, both satisfied. */
function ready(): RunResult[] {
  return [version('v22.0.0\n'), version('v22.0.0\n')];
}

function withRunner(results: RunResult[], root = OFFLINE_ROOT): { data: Data; ctx: Ctx } {
  return {
    data: loadData(root),
    ctx: createContext({ home: fixtureHome(true), root, runner: new RecordingRunner(results.map((result) => ({ ...result }))) }),
  };
}

type Ctx = ReturnType<typeof createContext>;

/** A read is a promise: the frame that shows its result arrives a turn after the key that started it. */
async function settle(done: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

/** `p`, then the plan itself: the surface prints `building plan…` until the read resolves. */
async function openPlan(tui: TuiHarness): Promise<void> {
  await tui.press('p');
  await settle(() => tui.frame() !== '' && !tui.frame().includes(t.planBuilding));
}

/** A root whose only item has an id longer than a narrow frame: its entry row has to wrap. */
const LONG_ID = `skill-${'a'.repeat(80)}`;
function longIdRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-tui-plan-'));
  fs.cpSync(OFFLINE_ROOT, root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'catalog', `${LONG_ID}.yaml`),
    `id: ${LONG_ID}\nkind: mcp\nurl: https://example.invalid/long\ntargets: "*"\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'packages', 'base.yaml'), `id: base\ndefault: true\nitems: [${LONG_ID}]\n`, 'utf8');
  return root;
}

/**
 * A hook command longer than an 80-column frame on its own: the entry's `adds hook:` line then has to
 * wrap under itself, whatever the home path it is installed into happens to be.
 */
const LONG_COMMAND = `node -e "require('fs').appendFileSync('hook.log', 'the focused hook entry wraps under itself at eighty columns')"`;
/** The line the plan prints for that hook, as the formatter writes it. */
const LONG_HOOK = `    ${t.hookEntry}: ${JSON.stringify({ matcher: 'Bash', hooks: [{ type: 'command', command: LONG_COMMAND }] })}`;

/** The offline root with that one long hook in place of the fixture's own. */
function longHookRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-tui-plan-'));
  fs.cpSync(OFFLINE_ROOT, root, { recursive: true });
  const file = path.join(root, 'catalog', 'hook-a.yaml');
  const text = fs.readFileSync(file, 'utf8').replace(/^hookCommand: .*$/m, `hookCommand: ${JSON.stringify(LONG_COMMAND)}`);
  fs.writeFileSync(file, text, 'utf8');
  return root;
}

/** A copy of the offline root with `items` in the default package, so a plan can outgrow the window. */
function longRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-tui-plan-'));
  fs.cpSync(OFFLINE_ROOT, root, { recursive: true });
  const items = Array.from({ length: 12 }, (_, at) => `extra-${at}`);
  for (const id of items) {
    fs.writeFileSync(
      path.join(root, 'catalog', `${id}.yaml`),
      `id: ${id}\nkind: mcp\nurl: https://example.invalid/${id}\ntargets: "*"\n`,
      'utf8',
    );
  }
  fs.writeFileSync(path.join(root, 'packages', 'base.yaml'), `id: base\ndefault: true\nitems: [${items.join(', ')}]\n`, 'utf8');
  return root;
}

/** A root whose only requirement cannot be installed on this platform: the plan must say so, not guess. */
function noInstallerRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-tui-plan-'));
  fs.cpSync(OFFLINE_ROOT, root, { recursive: true });
  const other = process.platform === 'win32' ? 'linux' : 'win32';
  fs.writeFileSync(
    path.join(root, 'requires', 'fake.yaml'),
    `id: fake\ncheck:\n  command: [node, --version]\n  min: "20"\ninstall:\n  ${other}: [npm, install, -g, "@fake/harness"]\n`,
    'utf8',
  );
  return root;
}

test('the plan body prints the formatter lines, and the count line sits above the keybar', async () => {
  const tui = await startTui({ ...withRunner(ready()), width: 120 });
  try {
    await openPlan(tui);
    const lines = tui.lines();
    assert.equal(lines[0]?.startsWith('agentenv  plan'), true);
    // Both requirements are satisfied, so there is nothing to mark and no mark key is offered.
    assert.equal(lines[lines.length - 1], 'Enter apply · r rebuild · ? keys · Esc back · q quit');
    assert.equal(lines[lines.length - 2], t.actions(3, 0, 0), 'the count line is not directly above the keybar');

    const frame = tui.frame();
    const rows = ['+ skill-a → fake [skill/fake-skills]', '+ mcp-a → fake [mcp/fake-mcp]', '+ hook-a → fake [hook/builtin-hooks]'];
    for (const row of rows) assert.ok(frame.includes(row), `the frame lost ${row}`);
    assert.ok(frame.includes('ready  requirement node 22.0.0 · min 20'), frame);
    assert.ok(frame.includes('ready  requirement Fake Harness 22.0.0 · min 20'), frame);
  } finally {
    await tui.stop();
  }
});

test('at 80 columns the focused entry wraps under itself, so its whole row arrives', async () => {
  const tui = await startTui({ ...withRunner(ready(), longIdRoot()), width: 80 });
  try {
    await openPlan(tui);
    const lines = tui.lines();
    expectFrame(lines, { width: 80, rows: 30 });
    assert.ok(lines.some((line) => line.trimStart().startsWith('> +')), lines.join('\n'));
    // One column: the focused entry wraps under itself with a 4-space indent, and nothing is dropped.
    const row = `${LONG_ID} → fake [mcp/fake-mcp]`;
    expectFrameText(lines, row);
  } finally {
    await tui.stop();
  }
});

test('rows are ordered by outcome, and the order is stable', () => {
  const entry = (itemId: string, action: PlanEntry['action'], blockedBy?: string): PlanEntry => ({
    itemId,
    kind: 'mcp',
    harness: 'fake',
    action,
    ...(blockedBy ? { blockedBy } : {}),
  });
  const plan: Plan = {
    selection: { harnessIds: ['fake'], itemIds: [] },
    entries: [
      entry('blocked', 'run', 'node'),
      entry('error', 'error'),
      entry('already', 'already'),
      entry('runs', 'run'),
      entry('unsupported', 'unsupported'),
    ],
    requirements: [],
    warnings: [],
  };

  const once = orderedPlan(plan).entries.map((item) => item.itemId);
  assert.deepEqual(once, ['runs', 'already', 'unsupported', 'error', 'blocked']);
  assert.deepEqual(orderedPlan(plan).entries.map((item) => item.itemId), once, 'a rebuild reordered the plan');
  assert.deepEqual(
    plan.entries.map((item) => item.itemId),
    ['blocked', 'error', 'already', 'runs', 'unsupported'],
    'the plan itself was reordered instead of a copy',
  );
});

test('the focused entry carries its continuation lines in full in the detail column', async () => {
  const shared = withRunner(ready());
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openPlan(tui);
    await tui.press('\u001B[B', '\u001B[B');
    const lines = tui.lines();
    assert.equal(lines[3]?.startsWith('  + skill-a'), true, String(lines[3]));
    assert.equal(lines[5]?.startsWith('> + hook-a'), true, `hook-a is not focused: ${lines[5]}`);

    // The detail column read as one string: wrapping may move a word, never drop one.
    const detail = lines.map((line) => line.slice(DETAIL_AT)).join('').replace(/\s+/g, '');
    // The same plan the surface holds: the hook's own home resolves to the same path.
    const again = createContext({ home: shared.ctx.home, root: OFFLINE_ROOT, runner: new RecordingRunner(ready()) });
    const plan = await buildPlan(shared.data, again, { harnessIds: ['fake'], itemIds: ITEMS });
    const hook = plan.entries.find((item) => item.itemId === 'hook-a');
    assert.notEqual(hook, undefined);
    const block = planLines({ ...plan, entries: [hook as PlanEntry], requirements: [], warnings: [] }).slice(0, -1);
    assert.equal(block.length, 3, block.map((line) => line.text).join('|'));
    for (const line of block) {
      assert.ok(detail.includes(line.text.replace(/\s+/g, '')), `the detail column lost ${line.text}`);
    }
    assert.ok(detail.includes(`${t.writePrefix}:`), 'the write: line is missing');
    assert.ok(detail.includes(t.hookEntry.replace(/\s+/g, '')), 'the adds hook: line is missing');
  } finally {
    await tui.stop();
  }
});

test('the requirement rows carry the too old verdict, its update command and a missing installer', async () => {
  const old = await startTui({ ...withRunner([version('v22.0.0\n'), version('1.0.0\n')]), width: 120 });
  try {
    await openPlan(old);
    const frame = old.frame();
    assert.ok(frame.includes('too old  requirement Fake Harness 1.0.0 · min 20 → npm install -g @fake/harness'), frame);
    assert.ok(frame.includes(`${t.blocked}: ${t.requirementUnmet('fake')}`), frame);
  } finally {
    await old.stop();
  }

  const bare = await startTui({
    ...withRunner([version('v22.0.0\n'), version('1.0.0\n')], noInstallerRoot()),
    width: 120,
  });
  try {
    await openPlan(bare);
    const frame = bare.frame();
    assert.ok(frame.includes(`too old  requirement Fake Harness 1.0.0 · min 20 — ${t.noInstallCommand}`), frame);
  } finally {
    await bare.stop();
  }
});

test('two columns at 120, one column at 80, and no line wider than the frame', async () => {
  for (const width of [120, 100, 80]) {
    const tui = await startTui({ ...withRunner(ready(), longHookRoot()), width });
    try {
      await openPlan(tui);
      await tui.press('\u001B[B', '\u001B[B');
      const lines = tui.lines();
      expectFrame(lines, { width, rows: 30 });

      const row = '+ hook-a → fake [hook/builtin-hooks]';
      const shown = lines.filter((line) => line.includes(row)).length;
      assert.equal(shown, width >= 100 ? 2 : 1, `${width}: the focused row appears ${shown} time(s)`);
      if (width >= 100) {
        assert.ok(lines.some((line) => line.slice(DETAIL_AT).startsWith(row)), 'the detail column does not open with the focused row');
      } else {
        // One column: the focused entry's own `adds hook:` line is wider than the frame, so it wraps
        // under itself two columns in from the formatter's indent. Nothing here asks how long the
        // home path is: the hook's own command is what does not fit.
        assert.ok(LONG_HOOK.length > width, 'the hook line fits the frame: the wrap is not what is under test');
        const tail = LONG_HOOK.slice(LONG_HOOK.lastIndexOf(' ') + 1);
        assert.ok(
          lines.some((line) => line.startsWith('      ') && line.endsWith(tail)),
          `the focused entry did not wrap under itself:\n${lines.join('\n')}`,
        );
        // The wrap carries the line over rather than cutting it: the whole hook still reaches the frame.
        expectFrameText(lines, LONG_HOOK.trimStart());
      }
    } finally {
      await tui.stop();
    }
  }
});

test('a long plan is reachable: the window moves and the requirements stay above the keybar', async () => {
  const tui = await startTui({ ...withRunner(ready(), longRoot()), width: 120, rows: 16 });
  try {
    await openPlan(tui);
    let lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 16 });
    assert.equal(lines[3]?.startsWith('> + extra-0'), true, 'the first row is not focused');
    assert.equal(tui.frame().includes('extra-11'), false, 'the whole plan fit: the window is not what is under test');
    assert.equal(lines[lines.length - 2], t.actions(12, 0, 0));
    assert.ok(lines.some((line) => line.includes('ready  requirement node 22.0.0 · min 20')), 'the requirements are not pinned above the keybar');

    await tui.press('\u001B[6~');
    lines = tui.lines();
    assert.equal(lines.some((line) => line.includes('+ extra-11')), true, 'PgDn did not reach the last entry');
    assert.equal(lines[lines.length - 2], t.actions(12, 0, 0));

    await tui.press('g');
    assert.equal(tui.lines()[3]?.startsWith('> + extra-0'), true, 'g did not return to the first entry');

    await tui.press('G');
    assert.equal(tui.lines().some((line) => line.startsWith('> + extra-11')), true, 'G did not reach the last entry');
    assert.equal(tui.lines()[tui.lines().length - 2], t.actions(12, 0, 0), 'the count line left the bottom');
  } finally {
    await tui.stop();
  }
});

test('p opens the plan read-only, and Esc returns with the selection intact', async () => {
  const tui = await startTui({ ...withRunner(ready()), width: 120 });
  try {
    await openPlan(tui);
    const before = tui.frame();
    assert.equal(tui.lines()[0]?.startsWith('agentenv  plan'), true);

    // No write key is bound here: the keys that would approve or decline are not in this table.
    assert.equal(tui.lines()[tui.lines().length - 1], 'Enter apply · r rebuild · ? keys · Esc back · q quit');
    await tui.press('y', 'n');
    assert.equal(tui.frame(), before, 'a key wrote to or re-read the plan surface');

    await tui.press('\u001B');
    const lines = tui.lines();
    assert.equal(lines[0]?.startsWith('agentenv  install'), true);
    assert.equal(lines.includes(`  ${t.tui.chosenOf(3, 3)}`), true, 'the selection was lost on the way back');
  } finally {
    await tui.stop();
  }
});

test('a slow read says building plan…, a failed one prints its message, and r rebuilds', async () => {
  const slowCtx = createContext({ home: fixtureHome(true), root: OFFLINE_ROOT, runner: { run: () => new Promise(() => {}) } });
  const slow = await startTui({ data: loadData(OFFLINE_ROOT), ctx: slowCtx, width: 120 });
  try {
    await slow.press('p');
    await settle(() => slow.frame() !== '');
    assert.equal(slow.frame().includes(t.planBuilding), true, slow.frame());
  } finally {
    await slow.stop();
  }

  const brokenCtx = createContext({
    home: fixtureHome(true),
    root: OFFLINE_ROOT,
    runner: { run: () => Promise.reject(new Error('the check died')) },
  });
  const broken = await startTui({ data: loadData(OFFLINE_ROOT), ctx: brokenCtx, width: 120 });
  try {
    await broken.press('p');
    await settle(() => broken.frame().includes('the check died'));
    const lines = broken.lines();
    assert.equal(lines[0]?.startsWith('agentenv  plan'), true, 'the failure left the surface');
    assert.equal(lines.includes('the check died'), true, lines.join('|'));
  } finally {
    await broken.stop();
  }

  const rebuilt = await startTui({
    ...withRunner([version('v22.0.0\n'), version('1.0.0\n'), version('v22.0.0\n'), version('v22.0.0\n')]),
    width: 120,
  });
  try {
    await openPlan(rebuilt);
    assert.ok(rebuilt.frame().includes('too old  requirement Fake Harness 1.0.0'), rebuilt.frame());

    await rebuilt.press('r');
    await settle(() => rebuilt.frame().includes('ready  requirement Fake Harness'));
    assert.ok(rebuilt.frame().includes('ready  requirement Fake Harness 22.0.0'), rebuilt.frame());
    assert.equal(rebuilt.frame().includes('too old'), false, 'the rebuilt plan kept the old verdict');
  } finally {
    await rebuilt.stop();
  }
});

test('a rebuild keeps the plan rows in their order', async () => {
  const tui = await startTui({ ...fixture(true), width: 120 });
  try {
    await openPlan(tui);
    assert.ok(tui.frame().includes('blocked:'), tui.frame());
    const first = tui.lines();
    await tui.press('r');
    await settle(() => tui.frame().includes('blocked:'));
    assert.deepEqual(tui.lines(), first, 'the same plan rendered differently after r');
  } finally {
    await tui.stop();
  }
});

/** The `extra-N` row heads a frame prints, in the order it prints them; a continuation line is not a head. */
function extraIndices(lines: string[]): number[] {
  const found = lines.map((line) => /^[> ]{2}\+ extra-(\d+)/.exec(line)?.[1]);
  return found.filter((at): at is string => at !== undefined).map(Number);
}

/** The `extra-N` row the focus mark is on. */
function focusedExtra(lines: string[]): number | undefined {
  const line = lines.find((row) => row.startsWith(t.tui.marks.focused) && row.includes('extra-'));
  const at = line === undefined ? undefined : /extra-(\d+)/.exec(line)?.[1];
  return at === undefined ? undefined : Number(at);
}

test('PgDn moves by exactly the rows the window shows, so no row is skipped', async () => {
  const tui = await startTui({ ...withRunner(ready(), longRoot()), width: 80, rows: 16 });
  try {
    await openPlan(tui);
    const before = extraIndices(tui.lines());
    assert.equal(focusedExtra(tui.lines()), 0, 'the first row is not focused');
    assert.ok(before.length > 1, before.join(','));
    assert.deepEqual(
      before,
      before.map((_, at) => at),
      'the first window is not the top of the list',
    );

    await tui.press('\u001B[6~');
    const after = extraIndices(tui.lines());
    assert.equal(
      focusedExtra(tui.lines()),
      before.length,
      `PgDn moved past a row: ${before.length} rows were on screen and the focus went to ${focusedExtra(tui.lines())}`,
    );
    assert.ok(Math.min(...after) <= Math.max(...before) + 1, `a row was skipped: ${before.join(',')} then ${after.join(',')}`);
  } finally {
    await tui.stop();
  }
});

/** At exactly 100 columns the detail pane is `width − 52`, not the 62 it is from 114 columns up. */
const DETAIL_MAX_AT_100 = 48;

test('at exactly 100 columns the detail column is 48 wide, and no line leaves the frame', async () => {
  const tui = await startTui({ ...withRunner(ready()), width: 100 });
  try {
    await openPlan(tui);
    await tui.press('\u001B[B', '\u001B[B');
    const lines = tui.lines();

    // 50 columns of rows, a 2-column gutter, and what is left for the detail: 48 here, 62 from 114 up.
    assert.equal(DETAIL_AT + DETAIL_MAX_AT_100, 100);
    assert.equal(lines[5]?.startsWith(`${t.tui.marks.focused}+ hook-a`), true, String(lines[5]));
    assert.equal(
      lines.some((line) => line.slice(DETAIL_AT).startsWith('+ hook-a → fake')),
      true,
      'the detail column does not open at 52',
    );
    for (const line of lines) {
      assert.ok(line.length <= 100, `${line.length} > 100: ${line}`);
      assert.ok(line.length - DETAIL_AT <= DETAIL_MAX_AT_100, `the detail pane is wider than 48: ${line}`);
    }
  } finally {
    await tui.stop();
  }
});
