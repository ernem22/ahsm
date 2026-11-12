import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createContext, type Runner, type RunResult } from '../src/context.js';
import type { Plan } from '../src/core/plan.js';
import { loadData } from '../src/data.js';
import { t } from '../src/i18n.js';
import { allUpdates, markableUpdates, toggleUpdate } from '../src/tui/plan.js';
import { OFFLINE_ROOT, expectFrame, fixtureHome, startTui, type TuiHarness } from './tui-harness.js';

/** The two offered updates, told apart by their command: a mark either runs one or it does not. */
const NODE_UPDATE = ['npm', 'install', '-g', 'node-update'];
const FAKE_UPDATE = ['npm', 'install', '-g', '@fake/harness'];

/** A version below both declared minima, so every requirement is `too old`. */
const TOO_OLD = 'v1.0.0\n';

/** Answers the plan's requirement checks and records every argv the app runs. */
class ScriptedRunner implements Runner {
  readonly calls: string[][] = [];

  async run(argv: string[]): Promise<RunResult> {
    this.calls.push(argv);
    if (argv.join(' ') === 'node --version') return { code: 0, stdout: TOO_OLD, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  }
}

/** The offline root narrowed to one entry and two too-old requirements with distinct updates. */
function marksRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-tui-apply-'));
  fs.cpSync(OFFLINE_ROOT, root, { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'base.yaml'), 'id: base\ndefault: true\nitems: [mcp-a]\n', 'utf8');
  fs.writeFileSync(
    path.join(root, 'requires', 'node.yaml'),
    'id: node\ncheck:\n  command: [node, --version]\n  min: "20"\ninstall:\n' +
      `  win32: [npm, install, -g, node-update]\n  darwin: [npm, install, -g, node-update]\n  linux: [npm, install, -g, node-update]\n`,
    'utf8',
  );
  return root;
}

function setup(): { data: ReturnType<typeof loadData>; ctx: ReturnType<typeof createContext>; runner: ScriptedRunner } {
  const root = marksRoot();
  const runner = new ScriptedRunner();
  return {
    data: loadData(root),
    ctx: createContext({ home: fixtureHome(true), root, runner, platform: 'linux' }),
    runner,
  };
}

async function settle(tui: TuiHarness, done: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

async function openPlan(tui: TuiHarness): Promise<void> {
  await tui.press('p');
  await settle(tui, () => tui.frame() !== '' && !tui.frame().includes(t.planBuilding));
}

/** The plan has one entry, then the node and the fake harness requirement rows in that order. */
async function openWithNodeFocused(tui: TuiHarness): Promise<void> {
  await openPlan(tui);
  await tui.press('down');
}

function ran(runner: ScriptedRunner, argv: string[]): boolean {
  return runner.calls.some((call) => call.join(' ') === argv.join(' '));
}

/** The row column's line for a requirement, never its detail-column copy. */
function requirementRow(lines: string[], name: string): string | undefined {
  return lines.find(
    (line) => line.includes(`${t.tui.marks.unchosen}too old  ${t.requirement} ${name}`) || line.includes(`${t.tui.marks.chosen}too old  ${t.requirement} ${name}`),
  );
}

test('space marks one requirement, and the row, the detail and the summary say so without colour', async () => {
  const shared = setup();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openWithNodeFocused(tui);
    const before = tui.lines();
    assert.equal(requirementRow(before, 'node')?.startsWith(`${t.tui.marks.focused}${t.tui.marks.unchosen}`), true, String(requirementRow(before, 'node')));
    assert.equal(requirementRow(before, 'Fake Harness')?.startsWith(`${t.tui.marks.blank}${t.tui.marks.unchosen}`), true, String(requirementRow(before, 'Fake Harness')));

    await tui.press(' ');
    const lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 30 });
    assert.equal(requirementRow(lines, 'node')?.startsWith(`${t.tui.marks.focused}${t.tui.marks.chosen}`), true, String(requirementRow(lines, 'node')));
    assert.equal(
      requirementRow(lines, 'Fake Harness')?.startsWith(`${t.tui.marks.blank}${t.tui.marks.unchosen}`),
      true,
      'the other requirement was marked too',
    );
    assert.ok(tui.frame().includes(t.updatesMarked), tui.frame());
    assert.equal(tui.frame().includes(t.updatesSkipped), false, 'the frame still says nothing is marked');

    await tui.press(' ');
    const cleared = tui.lines();
    assert.equal(requirementRow(cleared, 'node')?.startsWith(`${t.tui.marks.focused}${t.tui.marks.unchosen}`), true);
    assert.ok(tui.frame().includes(t.updatesSkipped), tui.frame());
  } finally {
    await tui.stop();
  }
});

test('y hands the core exactly the marked requirement: only its update runs', async () => {
  const shared = setup();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openWithNodeFocused(tui);
    await tui.press(' ', '\r');
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.apply}`), true, tui.lines()[0] ?? '');
    assert.ok((tui.lines().at(-1) ?? '').includes('y apply'), tui.lines().at(-1) ?? '');

    await tui.press('y');
    await settle(tui, () => ran(shared.runner, NODE_UPDATE));
    assert.equal(ran(shared.runner, NODE_UPDATE), true, 'the marked update did not run');
    assert.equal(ran(shared.runner, FAKE_UPDATE), false, 'an unmarked requirement update ran');
  } finally {
    await tui.stop();
  }
});

test('a marks every offered update, and y runs each once', async () => {
  const shared = setup();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openPlan(tui);
    await tui.press('a');
    const lines = tui.lines();
    assert.equal(requirementRow(lines, 'node')?.includes(t.tui.marks.chosen), true, String(requirementRow(lines, 'node')));
    assert.equal(requirementRow(lines, 'Fake Harness')?.includes(t.tui.marks.chosen), true, String(requirementRow(lines, 'Fake Harness')));
    assert.ok(tui.frame().includes(t.updatesMarked), tui.frame());

    await tui.press('\r', 'y');
    await settle(tui, () => ran(shared.runner, NODE_UPDATE) && ran(shared.runner, FAKE_UPDATE));
    assert.equal(ran(shared.runner, NODE_UPDATE), true, 'the node update did not run');
    assert.equal(ran(shared.runner, FAKE_UPDATE), true, 'the harness update did not run');
    assert.equal(
      shared.runner.calls.filter((call) => call.join(' ') === NODE_UPDATE.join(' ')).length,
      1,
      'the node update ran more than once',
    );
  } finally {
    await tui.stop();
  }
});

test('with nothing marked, y hands the core no updates and no update runs', async () => {
  const shared = setup();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openPlan(tui);
    await tui.press('\r');
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.apply}`), true, tui.lines()[0] ?? '');
    const before = shared.runner.calls.length;

    await tui.press('y');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(ran(shared.runner, NODE_UPDATE), false, 'an unmarked node update ran');
    assert.equal(ran(shared.runner, FAKE_UPDATE), false, 'an unmarked harness update ran');
    assert.ok(shared.runner.calls.length >= before, 'the apply did not even re-check');
  } finally {
    await tui.stop();
  }
});

test('the confirm screen offers y and n next to the statement of what is and is not marked', async () => {
  const shared = setup();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openPlan(tui);
    await tui.press('\r');
    const lines = tui.lines();
    const keybar = lines[lines.length - 1] as string;
    assert.ok(keybar.includes('y apply'), keybar);
    assert.ok(keybar.includes('n decline'), keybar);
    assert.equal(keybar.includes('r rebuild'), false, 'the apply screen still offers a rebuild key');
    assert.ok(lines.includes(t.updatesSkipped), 'the confirm screen does not state that nothing is marked');
    assert.equal(lines[lines.length - 2], t.actions(0, 0, 1), 'the count line left the key');
  } finally {
    await tui.stop();
  }
});

test('n and Esc decline without writing, and the install selection is still there', async () => {
  const shared = setup();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await tui.press('\r', '\r', '\r');
    await settle(tui, () => tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.plan}`) ?? false);
    await tui.press('a');

    await tui.press('\r');
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.apply}`), true);
    await tui.press('n');
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.plan}`), true, 'n did not decline back to the plan');
    assert.equal(ran(shared.runner, NODE_UPDATE), false, 'declining ran the marked update');
    assert.equal(ran(shared.runner, FAKE_UPDATE), false, 'declining ran an unmarked update');
    assert.ok(tui.frame().includes(t.updatesMarked), 'declining lost the marks');

    await tui.press('\r', '\u001B');
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.plan}`), true, 'Esc did not decline back to the plan');
    assert.equal(ran(shared.runner, NODE_UPDATE), false, 'Esc ran the marked update');
    assert.equal(ran(shared.runner, FAKE_UPDATE), false, 'Esc ran an unmarked update');

    await tui.press('\u001B');
    const lines = tui.lines();
    assert.equal(lines[0]?.startsWith(`agentenv  ${t.tui.surfaces.install}`), true);
    assert.equal(lines.includes(`  ${t.tui.chosenOf(1, 1)}`), true, 'the selection was lost on the way back');
  } finally {
    await tui.stop();
  }
});

test('the marks are exactly the requirement ids the core receives, for one, for all and for none', () => {
  const plan: Plan = {
    selection: { harnessIds: ['fake'], itemIds: ['mcp-a'] },
    entries: [],
    requirements: [
      { id: 'node', version: '1.0.0', minimum: '20', present: false, installCommand: NODE_UPDATE },
      { id: 'fake', label: 'Fake Harness', version: '1.0.0', minimum: '20', present: false, installCommand: FAKE_UPDATE },
      { id: 'ready', version: '22.0.0', minimum: '20', present: true },
    ],
    warnings: [],
  };

  assert.deepEqual(markableUpdates(plan), ['node', 'fake']);
  assert.deepEqual(toggleUpdate([], 'node'), ['node']);
  assert.deepEqual(toggleUpdate(['node'], 'node'), []);
  assert.deepEqual(allUpdates(plan, []), ['node', 'fake']);
  assert.deepEqual(allUpdates(plan, ['node', 'fake']), []);
});

test('a mark survives the narrow layout: it is the box and the words, never a colour', async () => {
  const shared = setup();
  const tui = await startTui({ ...shared, width: 40 });
  try {
    await openWithNodeFocused(tui);
    await tui.press(' ');
    const lines = tui.lines();
    expectFrame(lines, { width: 40, rows: 30 });
    assert.ok(tui.frame().includes(t.tui.marks.chosen), tui.frame());
    assert.ok(tui.frame().includes(t.updatesMarked), tui.frame());
  } finally {
    await tui.stop();
  }
});
