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
import { OFFLINE_ROOT, expectFrame, fixture, fixtureHome, startTui, type TuiHarness } from './tui-harness.js';

/** One string with every run of blanks collapsed: a wrap may move a space, never a word. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** A second harness no provider lists, so a real outcome carries `not covered` rows beside the rest. */
const OTHER_HARNESS = [
  'id: other',
  'label: Other Harness',
  'detect:',
  '  - ~/.other',
  'config: { path: "~/.other/config.json", format: jsonc }',
  '',
].join('\n');

const MCP_B = [
  'id: mcp-b',
  'kind: mcp',
  'url: https://mcp.example.invalid/b',
  'targets: [other]',
  'note: "offline mcp for a harness no provider covers"',
  '',
].join('\n');

/** The offline root narrowed to one package, with a provider-less harness when the test needs one. */
function planRoot(items: string[], other = false): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-tui-write-'));
  fs.cpSync(OFFLINE_ROOT, root, { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'base.yaml'), `id: base\ndefault: true\nitems: [${items.join(', ')}]\n`, 'utf8');
  if (other) {
    fs.writeFileSync(path.join(root, 'harnesses', 'other.yaml'), OTHER_HARNESS, 'utf8');
    fs.writeFileSync(path.join(root, 'catalog', 'mcp-b.yaml'), MCP_B, 'utf8');
  }
  return root;
}

/**
 * A home with the given harnesses detected, the fixture hook already in place (so the plan says
 * `already`) and a lockfile entry (so a skill install can be verified instead of reported unverified).
 */
function preparedHome(root: string, dirs: string[], withHook = true): string {
  const home = fixtureHome();
  for (const dir of dirs) fs.mkdirSync(path.join(home, dir), { recursive: true });
  const hook = loadData(root).items.get('hook-a');
  const entry = { matcher: hook?.matcher, hooks: [{ type: 'command', command: hook?.hookCommand }] };
  fs.mkdirSync(path.join(home, '.fake'), { recursive: true });
  if (withHook) {
    fs.writeFileSync(path.join(home, '.fake', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [entry] } }), 'utf8');
  }
  fs.writeFileSync(path.join(home, '.fake', '.skill-lock.json'), JSON.stringify({ skills: { alpha: { source: 'fixture/skills' } } }), 'utf8');
  return home;
}

/** A write that is held open until the test lets it finish, so the in-flight screen can be read. */
class GatedRunner implements Runner {
  readonly calls: string[][] = [];
  private readonly gate: Promise<void>;
  private open!: () => void;

  constructor() {
    this.gate = new Promise<void>((resolve) => {
      this.open = resolve;
    });
  }

  async run(argv: string[]): Promise<RunResult> {
    this.calls.push(argv);
    if (argv.join(' ') === 'node --version') return { code: 0, stdout: 'v22.0.0\n', stderr: '' };
    if ((argv[1] ?? '').endsWith('install-skill.mjs')) await this.gate;
    return { code: 0, stdout: '', stderr: '' };
  }

  release(): void {
    this.open();
  }
}

/** One entry installs, one errors: a partial failure is what the result screen has to keep apart. */
class MixedRunner implements Runner {
  readonly calls: string[][] = [];

  async run(argv: string[]): Promise<RunResult> {
    this.calls.push(argv);
    if (argv.join(' ') === 'node --version') return { code: 0, stdout: 'v22.0.0\n', stderr: '' };
    if ((argv[1] ?? '').endsWith('install-mcp.mjs')) return { code: 1, stdout: '', stderr: 'mcp exploded' };
    return { code: 0, stdout: '', stderr: '' };
  }
}

/** Every requirement reads no version, so both are absent and both installers fail. */
class BrokenRunner implements Runner {
  readonly calls: string[][] = [];

  async run(argv: string[]): Promise<RunResult> {
    this.calls.push(argv);
    if (argv.join(' ') === 'node --version') return { code: 0, stdout: '', stderr: '' };
    if (argv[0] === 'npm') return { code: 1, stdout: '', stderr: 'npm ERR! EACCES' };
    return { code: 1, stdout: '', stderr: 'node ERR! denied' };
  }
}

/** Waits up to `deadlineMs` for a frame that makes `done` true; the deadline bounds a key that did nothing. */
async function until(tui: TuiHarness, done: () => boolean, deadlineMs = 1000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

/** `agentenv`, three `Enter`s and the confirm screen: the form, the plan and the apply in one path. */
async function journey(tui: TuiHarness): Promise<void> {
  await tui.press('\r', '\r', '\r');
  await until(tui, () => tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.plan}`) ?? false);
  await until(tui, () => tui.frame() !== '' && !tui.frame().includes(t.planBuilding));
  await tui.press('\r');
  assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.apply}`), true, tui.lines()[0] ?? '');
}

/** Waits for the result screen, which is the only body that prints the result heading. */
async function result(tui: TuiHarness): Promise<string[]> {
  await until(tui, () => tui.frame().includes(t.tui.resultTitle), 2500);
  assert.ok(tui.frame().includes(t.tui.resultTitle), `no result screen:\n${tui.frame()}`);
  return tui.lines();
}

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

test('while the write runs the body names the work, counts real seconds and refuses to leave', async () => {
  const root = planRoot(['skill-a', 'hook-a']);
  const runner = new GatedRunner();
  const ctx = createContext({ home: preparedHome(root, ['.fake'], false), root, runner, platform: 'linux' });
  const tui = await startTui({ data: loadData(root), ctx, width: 120 });
  try {
    await journey(tui);
    await tui.press('y');
    const busy = tui.frame();
    assert.match(busy, /applying… \d+s/, busy);
    assert.ok(busy.includes(t.tui.applyShape(2, 1, 0)), busy);
    assert.ok(busy.includes(t.tui.applyNothingElse), busy);
    assert.ok(busy.includes(t.tui.applyRefusal), busy);
    assert.equal(/[%█░▒▓⠁-⣿]/.test(busy), false, 'a spinner, bar or percentage appeared');
    expectFrame(tui.lines(), { width: 120, rows: 30 });

    for (const key of ['q', '\u001B']) {
      await tui.press(key);
      const lines = tui.lines();
      assert.equal(lines[0]?.startsWith(`agentenv  ${t.tui.surfaces.apply}`), true, `${key} left the write: ${lines[0] ?? ''}`);
      assert.ok(tui.frame().includes(t.tui.applyRefusal), tui.frame());
    }

    // The count comes from the clock, so wait for the tick instead of guessing a duration.
    await until(tui, () => /applying… [1-9]/.test(tui.frame()), 2500);
    assert.match(tui.frame(), /applying… [1-9]\d*s/, 'the busy line never counted a second');
    assert.equal(tui.frame().includes('%'), false, 'a percentage appeared');

    runner.release();
    const lines = await result(tui);
    assert.ok(lines.includes(`${t.applyLabels.ok}  skill-a → fake`), lines.join('\n'));
    assert.ok(lines.includes(`${t.applyLabels.ok}  hook-a → fake`), lines.join('\n'));
    assert.equal(tui.frame().includes(t.tui.applyRefusal), false, 'the refusal outlived the write');
  } finally {
    await tui.stop();
  }

  // At 40 columns the refusal is exactly the frame's width, so it must arrive whole, not cut.
  const narrowCtx = createContext({ home: preparedHome(root, ['.fake'], false), root, runner: new GatedRunner(), platform: 'linux' });
  const narrow = await startTui({ data: loadData(root), ctx: narrowCtx, width: 40 });
  try {
    await journey(narrow);
    await narrow.press('y');
    const lines = narrow.lines();
    expectFrame(lines, { width: 40, rows: 30 });
    assert.match(narrow.frame(), /applying… \d+s/, narrow.frame());
    assert.ok(lines.includes(t.tui.applyRefusal), 'the refusal was cut on the narrow frame');
  } finally {
    await narrow.stop();
  }
});

test('the result is one row per entry: installed, already installed, not covered and error', async () => {
  const root = planRoot(['skill-a', 'mcp-a', 'hook-a', 'mcp-b'], true);
  const runner = new MixedRunner();
  const ctx = createContext({ home: preparedHome(root, ['.fake', '.other']), root, runner, platform: 'linux' });
  const tui = await startTui({ data: loadData(root), ctx, width: 120 });
  try {
    await journey(tui);
    await tui.press('y');
    const lines = await result(tui);
    expectFrame(lines, { width: 120, rows: 30 });

    const rows = [
      `${t.applyLabels.ok}  skill-a → fake`,
      `${t.applyLabels.unsupported}  skill-a → other (${t.providerMissing})`,
      `${t.applyLabels.error}  mcp-a → fake (mcp exploded)`,
      `${t.applyLabels.unsupported}  mcp-a → other (${t.providerMissing})`,
      `${t.applyLabels.already}  hook-a → fake`,
      `${t.applyLabels.unsupported}  mcp-b → other (${t.providerMissing})`,
    ];
    const at = lines.indexOf(t.tui.resultTitle);
    assert.deepEqual(lines.slice(at + 1, at + 1 + rows.length), rows, 'the result is not the formatter rows');
    for (const verdict of ['success', 'complete', 'done', 'failed']) {
      assert.equal(tui.frame().includes(verdict), false, `the result claims a verdict: ${verdict}`);
    }

    const keybar = lines[lines.length - 1] as string;
    assert.ok(keybar.includes(`${t.tui.keyNames.return} ${t.tui.keys.exit}`), keybar);
    assert.ok(keybar.includes(`s ${t.tui.surfaces.status}`), keybar);
  } finally {
    await tui.stop();
  }
});

test('a requirement failure is its own row, and the items it blocked are rows too', async () => {
  const root = planRoot(['skill-a']);
  const runner = new BrokenRunner();
  const ctx = createContext({ home: preparedHome(root, ['.fake']), root, runner, platform: 'linux' });
  const tui = await startTui({ data: loadData(root), ctx, width: 120 });
  try {
    await journey(tui);
    await tui.press('y');
    const lines = await result(tui);
    assert.ok(lines.includes(t.requirementFailed('node', 'node ERR! denied')), lines.join('\n'));
    assert.ok(lines.includes(t.requirementFailed('fake', 'npm ERR! EACCES')), lines.join('\n'));
    const blocked = lines.find((line) => line.startsWith(`${t.applyLabels.error}  skill-a → fake`));
    assert.ok(blocked?.includes(t.requirementUnmet('node')), String(blocked));
    assert.equal(tui.frame().includes(t.applyLabels.ok), false, 'a blocked item was reported as installed');
  } finally {
    await tui.stop();
  }
});

test('the result offers its ways out: s opens status, Esc returns to the form, Enter exits', async () => {
  const root = planRoot(['skill-a', 'mcp-a', 'hook-a', 'mcp-b'], true);
  const open = async (): Promise<TuiHarness> => {
    const ctx = createContext({ home: preparedHome(root, ['.fake', '.other']), root, runner: new MixedRunner(), platform: 'linux' });
    const tui = await startTui({ data: loadData(root), ctx, width: 120 });
    await journey(tui);
    await tui.press('y');
    await result(tui);
    return tui;
  };

  const toStatus = await open();
  try {
    await toStatus.press('s');
    assert.equal(toStatus.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.status}`), true, toStatus.lines()[0] ?? '');
  } finally {
    await toStatus.stop();
  }

  const toForm = await open();
  try {
    await toForm.press('\u001B');
    const lines = toForm.lines();
    assert.equal(lines[0]?.startsWith(`agentenv  ${t.tui.surfaces.install}`), true, lines[0] ?? '');
    assert.ok(lines.includes(`  ${t.tui.chosenOf(2, 2)}`), 'the selection was lost on the way back');
  } finally {
    await toForm.stop();
  }

  const toExit = await open();
  const exited = toExit.waitUntilExit().then(() => true);
  await toExit.press('\r');
  const left = await Promise.race([exited, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000))]);
  assert.equal(left, true, 'Enter did not exit');
});

test('at 40 columns the result wraps and no line leaves the frame', async () => {
  const root = planRoot(['skill-a', 'mcp-a', 'hook-a', 'mcp-b'], true);
  const ctx = createContext({ home: preparedHome(root, ['.fake', '.other']), root, runner: new MixedRunner(), platform: 'linux' });
  const tui = await startTui({ data: loadData(root), ctx, width: 40 });
  try {
    await journey(tui);
    await tui.press('y');
    const lines = await result(tui);
    expectFrame(lines, { width: 40, rows: 30 });
    assert.ok(lines.some((line) => line.startsWith(`${t.applyLabels.ok}  skill-a →`)), lines.join('\n'));
    assert.ok(lines.some((line) => line.startsWith(t.applyLabels.unsupported)), lines.join('\n'));
  } finally {
    await tui.stop();
  }
});

test('a status line wider than the frame takes lines from the body, not from the keybar', async () => {
  // Nothing chosen on `install`, so `f` on `list` refuses: the refusal is wider than 20 columns.
  const tui = await startTui({ ...fixture(), width: 20 });
  try {
    await tui.press('l');
    await settle(tui, () => tui.frame().includes(t.skillsTitle));
    await tui.press('f');
    const lines = tui.lines();
    expectFrame(lines, { width: 20, rows: 30 });
    // The refusal arrives whole, above the keybar, and the keybar is still the frame's last line.
    assert.ok(flat(tui.frame()).includes(flat(t.tui.listNoCarriers)), tui.frame());
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.list}`), true);
    assert.ok((lines[lines.length - 1] ?? '').length > 0, 'the keybar left the frame');
    assert.equal(lines[lines.length - 1]?.includes(t.tui.listNoCarriers), false, 'the refusal took the keybar');
  } finally {
    await tui.stop();
  }
});

test('a second apply starts from nothing: the previous result is not the new confirm', async () => {
  const shared = setup();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openWithNodeFocused(tui);
    await tui.press(' ', '\r');
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.apply}`), true, tui.lines()[0] ?? '');
    await tui.press('y');
    await result(tui);
    assert.equal(tui.lines().includes(t.tui.resultTitle), true, 'the write never reported a result');

    // Back to the plan, then the confirm again: this plan's answer is the confirm, not the old result.
    await tui.press('n');
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.plan}`), true, tui.lines()[0] ?? '');
    await settle(tui, () => tui.frame() !== '' && !tui.frame().includes(t.planBuilding));
    await tui.press('\r');
    const lines = tui.lines();
    assert.equal(lines[0]?.startsWith(`agentenv  ${t.tui.surfaces.apply}`), true, lines[0] ?? '');
    assert.equal(lines.includes(t.tui.resultTitle), false, 'the previous result was shown as this confirm');
    expectFrame(lines, { width: 120, rows: 30 });
    const keybar = lines[lines.length - 1] ?? '';
    assert.ok(keybar.includes('y apply'), keybar);
    assert.ok(keybar.includes('n decline'), keybar);
    assert.equal(lines[lines.length - 2], t.actions(0, 0, 1), 'the count line left the key');

    // And the key works: a second write runs, it is not refused by a stale write state.
    const before = shared.runner.calls.length;
    await tui.press('y');
    await settle(tui, () => shared.runner.calls.length > before);
    assert.ok(shared.runner.calls.length > before, 'the second apply ran nothing');
    assert.match(tui.frame(), /applying… \d+s/, tui.frame());
  } finally {
    await tui.stop();
  }
});

test('a plan with an update to mark offers the mark keys, and one without offers none', async () => {
  const shared = setup();
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openPlan(tui);
    const keybar = tui.lines()[tui.lines().length - 1] ?? '';
    assert.ok(keybar.includes('space mark'), keybar);
    assert.ok(keybar.includes('a mark all'), keybar);
  } finally {
    await tui.stop();
  }

  // The fixture's two requirements are satisfied, so there is nothing to mark and no key to press.
  const satisfied = await startTui({ ...fixture(), width: 120 });
  try {
    await satisfied.press('p');
    await settle(satisfied, () => satisfied.frame() !== '' && !satisfied.frame().includes(t.planBuilding));
    const keybar = satisfied.lines()[satisfied.lines().length - 1] ?? '';
    assert.equal(keybar.includes('space mark'), false, keybar);
    assert.equal(keybar.includes('a mark all'), false, keybar);

    await satisfied.press('?');
    const lines = satisfied.lines();
    const heading = lines.indexOf(t.tui.helpTitle(t.tui.surfaces.plan));
    const rows = lines.slice(heading + 1, lines.length - 1).filter((line) => line !== '');
    assert.equal(rows.includes('space mark'), false, rows.join('|'));
    assert.equal(rows.includes('a mark all'), false, rows.join('|'));
  } finally {
    await satisfied.stop();
  }
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
