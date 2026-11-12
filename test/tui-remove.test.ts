import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createContext, RecordingRunner, type Ctx } from '../src/context.js';
import { readState, statePath, writeState, type StateEntry } from '../src/core/state.js';
import { t } from '../src/i18n.js';
import type { InstalledSkill, SkillsAdapter } from '../src/providers/skills-api.js';
import type { Data, Kind } from '../src/types.js';
import { expectFrame, fixtureHome, startTui, type TuiHarness } from './tui-harness.js';

const HOOK_COMMAND = `node -e "require('fs').appendFileSync('hook.log','x')"`;

interface DataOptions {
  /** How the skill provider removes: the in-process adapter, an argv command, or nothing at all. */
  skills?: 'adapter' | 'argv' | 'none';
  /** Leave the MCP provider out, so a recorded MCP item has no provider to remove it. */
  mcp?: boolean;
}

/** One harness, one item per kind, and the providers the removal is planned against. */
function data(options: DataOptions = {}): Data {
  const providers: Data['providers'] = [];
  if (options.skills !== 'none') {
    providers.push(
      options.skills === 'argv'
        ? {
            id: 'skills-cli',
            kind: 'skill',
            supports: ['fake'],
            priority: 10,
            verify: { strategy: 'skill-lock', file: '~/.agents/.skill-lock.json' },
            remove: ['npx', 'skills', 'remove', '-g', '{skill}'],
          }
        : {
            id: 'skills-api',
            kind: 'skill',
            supports: ['fake'],
            priority: 5,
            adapter: 'skills-api',
            verify: { strategy: 'skill-lock', file: '~/.agents/.skill-lock.json' },
          },
    );
  }
  providers.push({
    id: 'builtin-hooks',
    kind: 'hook',
    supports: ['fake'],
    priority: 10,
    writes: { path: '{harness.config}', section: 'hooks.{event}' },
  });
  if (options.mcp !== false) {
    providers.push({
      id: 'fake-mcp',
      kind: 'mcp',
      supports: ['fake'],
      priority: 10,
      verify: { strategy: 'json-key' },
      remove: ['node', 'remove-mcp.mjs', '{serverName}'],
    });
  }
  return {
    items: new Map([
      ['skill-a', { id: 'skill-a', kind: 'skill', source: 'fixture/skills', skill: 'alpha', targets: '*' }],
      ['skill-b', { id: 'skill-b', kind: 'skill', source: 'fixture/skills', skill: 'gamma', targets: '*' }],
      ['skill-group', { id: 'skill-group', kind: 'skill', source: 'fixture/group', targets: '*' }],
      ['mcp-a', { id: 'mcp-a', kind: 'mcp', url: 'https://mcp.example.invalid/mcp', targets: '*' }],
      ['hook-a', { id: 'hook-a', kind: 'hook', event: 'PreToolUse', matcher: 'Bash', hookCommand: HOOK_COMMAND, targets: ['fake'] }],
    ]),
    packages: new Map(),
    harnesses: [
      {
        id: 'fake',
        label: 'Fake Harness',
        detect: ['~/.fake'],
        agentId: 'fake',
        config: { path: '~/.fake/settings.json', format: 'jsonc' },
        hooks: { path: '~/.fake/settings.json', section: 'hooks.{event}' },
        skills: { path: '~/.fake/skills' },
        mcp: { path: '~/.fake/mcp.json', key: 'mcpServers' },
      },
    ],
    providers,
    requires: [],
  };
}

/** The provider inventory as the surface's named path reads it: an in-memory stub, called count included. */
interface Stub {
  skills: SkillsAdapter;
  /** How many times the inventory was read: the named path reads it, the recorded path must not. */
  listCalls: number;
  /** Every set of names the provider was asked to remove. */
  removeCalls: string[][];
}

function stub(options: { installed?: InstalledSkill[]; fail?: string[]; gate?: Promise<void> } = {}): Stub {
  const stubState: Stub = {
    listCalls: 0,
    removeCalls: [],
    skills: {
      install: async () => ({ installed: [], failed: [] }),
      list: async () => {
        stubState.listCalls += 1;
        return options.installed ?? [];
      },
      remove: async ({ names }) => {
        stubState.removeCalls.push([...names]);
        if (options.gate) await options.gate;
        const fail = names.filter((name) => options.fail?.includes(name));
        return {
          removed: names.filter((name) => !fail.includes(name)),
          notFound: [],
          failed: fail.map((skill) => ({ skill, message: `${skill}: remove failed` })),
        };
      },
    },
  };
  return stubState;
}

interface Recorded {
  itemId: string;
  kind: Kind;
  hookCommand?: string;
}

interface Setup {
  data: Data;
  ctx: Ctx;
  home: string;
  stub: Stub;
}

function setup(options: { data?: Data; records?: Recorded[]; installed?: InstalledSkill[]; fail?: string[]; gate?: Promise<void> } = {}): Setup {
  const home = fixtureHome();
  fs.mkdirSync(path.join(home, '.fake'), { recursive: true });
  const skills = stub({ installed: options.installed, fail: options.fail, gate: options.gate });
  const ctx = createContext({ home, root: process.cwd(), runner: new RecordingRunner(), platform: 'linux', skills: skills.skills });
  const entries: StateEntry[] = (options.records ?? []).map((record, at) => ({
    itemId: record.itemId,
    kind: record.kind,
    harness: 'fake',
    providerId: 'skills-api',
    ...(record.hookCommand ? { hookCommand: record.hookCommand } : {}),
    at: `2020-01-01T00:00:0${at}Z`,
  }));
  // No records means no state file at all: `a named removal wrote a record file` stays a real question.
  if (entries.length > 0) writeState(ctx, { version: 1, entries });
  // The hook the record points at is really in the config, so a removal has something to strip.
  fs.writeFileSync(
    path.join(home, '.fake', 'settings.json'),
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: HOOK_COMMAND }] }] } }, null, 2),
    'utf8',
  );
  return { data: options.data ?? data(), ctx, home, stub: skills };
}

/** The `~/.agents` paths the skill provider and the fixture harness share, expanded as the core does. */
function skillPaths(home: string): string[] {
  return [path.join(home, '.agents'), path.join(home, '.agents', 'skills'), path.join(home, '.fake', 'skills')];
}

/** A read is a promise: the frame that shows its answer arrives a turn after the key that started it. */
async function settle(tui: TuiHarness, done: () => boolean, deadlineMs = 1500): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(done(), `the frame never said what it should:\n${tui.frame()}`);
}

/** `x`, then the plan itself: the surface names the read until the plan resolves. */
async function openRemove(tui: TuiHarness): Promise<void> {
  await tui.press('x');
  await settle(
    tui,
    () =>
      tui.frame().includes(t.removePlanLabels.remove) ||
      tui.frame().includes(t.tui.removeEmpty) ||
      tui.frame().includes(t.tui.removeUnremovable),
  );
}

/** The frame with every run of whitespace removed: a path wrapped in the detail column is still one path. */
function squash(text: string): string {
  return text.replace(/\s+/g, '');
}

/** The rows in the row column, focused or not: each entry begins with the formatter's `- id [kind]`. */
function planRows(lines: string[]): string[] {
  return lines
    .map((line) => line.slice(0, 50).trimEnd())
    .map((line) => line.replace(/^[> ]+/, ''))
    .filter((line) => line.startsWith('- '));
}

async function result(tui: TuiHarness): Promise<string[]> {
  await settle(tui, () => tui.frame().includes(t.tui.resultTitle), 2500);
  return tui.lines();
}

test('x shows every affected harness and path before any key writes, and the record consequence', async () => {
  const shared = setup({
    records: [
      { itemId: 'skill-a', kind: 'skill' },
      { itemId: 'hook-a', kind: 'hook', hookCommand: HOOK_COMMAND },
    ],
    installed: [{ name: 'alpha', source: 'fixture/skills', agents: ['fake'] }],
  });
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openRemove(tui);
    const lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 30 });
    assert.equal(lines[0]?.startsWith(`agentenv  ${t.tui.surfaces.remove}`), true);
    assert.equal(lines[2], t.tui.surfaces.remove);

    // The rows are the formatter's, one per recorded item, before any key acts.
    assert.deepEqual(planRows(lines), ['- skill-a [skill] → will be removed', '- hook-a [hook] → will be removed']);
    // The focused skill entry names its harnesses, its shared directories and the provider's own words.
    const paths = `paths: ${skillPaths(shared.home).join(', ')}`;
    assert.ok(tui.frame().includes(t.removeAffects(['fake'])), tui.frame());
    assert.ok(squash(tui.frame()).includes(squash(paths)), tui.frame());
    assert.equal(lines.some((line) => line.startsWith(`> - skill-a [skill]`)), true, lines.join('\n'));
    // The confirm line states the one thing the destructive key does, and how many entries it acts on.
    assert.equal(lines.includes(t.tui.removeConfirm(2)), true, lines.join('\n'));

    // The next row is one Down away, and its own path is on screen too.
    await tui.press('\u001B[B');
    assert.equal(tui.lines().some((line) => line.startsWith('> - hook-a [hook]')), true, tui.frame());
    assert.ok(
      squash(tui.frame()).includes(squash(`paths: ${path.join(shared.home, '.fake', 'settings.json')}`)),
      tui.frame(),
    );

    // Nothing was read from the inventory and nothing was written or run: the plan is the record's.
    assert.equal(shared.stub.listCalls, 0, 'the recorded path read the provider inventory');
    assert.deepEqual(shared.stub.removeCalls, []);
    assert.equal(readState(shared.ctx).state.entries.length, 2, 'the plan changed the record');
  } finally {
    await tui.stop();
  }
});

test('y removes the planned items through the core and clears exactly their records', async () => {
  const shared = setup({
    records: [
      { itemId: 'skill-a', kind: 'skill' },
      { itemId: 'hook-a', kind: 'hook', hookCommand: HOOK_COMMAND },
    ],
    installed: [{ name: 'alpha', source: 'fixture/skills', agents: ['fake'] }],
  });
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openRemove(tui);
    await tui.press('y');
    const lines = await result(tui);
    expectFrame(lines, { width: 120, rows: 30 });

    // One row per entry, in the formatter's own words; the hook is stripped, the skill goes through the adapter.
    assert.ok(lines.includes(`${t.removeLabels.removed}  skill-a`), lines.join('\n'));
    assert.ok(lines.includes(`${t.removeLabels.removed}  hook-a`), lines.join('\n'));
    assert.deepEqual(shared.stub.removeCalls, [['alpha']]);
    assert.deepEqual(readState(shared.ctx).state, { version: 1, entries: [] }, 'the record was not cleared');
    // The hook really left the config file.
    assert.equal(fs.readFileSync(path.join(shared.home, '.fake', 'settings.json'), 'utf8').includes(HOOK_COMMAND), false);

    // The result offers the next steps: s opens status, Enter exits.
    const keybar = lines.at(-1) ?? '';
    assert.ok(keybar.includes(`${t.tui.keyNames.return} ${t.tui.keys.exit}`), keybar);
    assert.ok(keybar.includes(`s ${t.tui.surfaces.status}`), keybar);
    await tui.press('s');
    await settle(tui, () => tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.status}`) === true);
  } finally {
    await tui.stop();
  }
});

test('a name agentenv never installed is planned, removed, and writes no record', async () => {
  const shared = setup({ installed: [{ name: 'alpha', source: 'fixture/skills', agents: ['fake'] }] });
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openRemove(tui);
    assert.ok(tui.frame().includes(t.tui.removeEmpty), tui.frame());
    // With nothing to remove, the destructive key is not advertised at all.
    assert.equal((tui.lines().at(-1) ?? '').includes(`${t.tui.keyNames.return} `) && tui.frame().includes('y remove'), false);

    // `a` opens the one text mode outside the filter.
    await tui.press('a');
    expectFrame(tui.lines(), { width: 120, rows: 30 });
    assert.ok(tui.frame().includes(t.tui.removeNameTitle), tui.frame());
    assert.ok(tui.frame().includes(t.tui.removeNamePrompt), tui.frame());
    assert.ok(tui.frame().includes(t.tui.removeNameHint), tui.frame());
    assert.equal(
      tui.lines().at(-1),
      [`${t.tui.keyNames.escape} ${t.tui.keys.nameCancel}`, `${t.tui.keyNames.return} ${t.tui.keys.nameRemove}`].join(
        t.tui.keybarSeparator,
      ),
    );

    for (const char of 'ghost') await tui.press(char);
    assert.ok(tui.frame().includes(`${t.tui.removeNamePrompt} ghost`), tui.frame());

    // Enter plans the name through the same `planRemoval` call, reading the inventory for a new name.
    await tui.press('\r');
    await settle(tui, () => tui.frame().includes('- ghost [skill] → will be removed'));
    assert.equal(shared.stub.listCalls, 1, 'the named plan did not read the inventory exactly once');
    assert.ok(squash(tui.frame()).includes(squash(`note: ${t.removeNotInInventory('ghost')}`)), tui.frame());
    // A name with no record behind it says so, rather than claiming a record was cleared.
    assert.ok(tui.frame().includes(t.tui.removeNamedConfirm(1)), tui.frame());
    assert.equal(tui.frame().includes(t.tui.removeConfirm(1)), false, 'the named-only plan claimed a record was cleared');
    assert.ok(squash(tui.frame()).includes(squash(`paths: ${path.join(shared.home, '.agents')}`)), tui.frame());

    // The same name typed again is not planned twice and does not read the inventory again.
    await tui.press('a');
    for (const char of 'ghost') await tui.press(char);
    await tui.press('\r');
    await settle(tui, () => tui.frame().includes('- ghost [skill] → will be removed'));
    assert.equal(shared.stub.listCalls, 1, 'a duplicate name re-read the inventory');

    // The provider's own remove has the last word, and the honest answer is `not installed`.
    await tui.press('y');
    const lines = await result(tui);
    expectFrame(lines, { width: 120, rows: 30 });
    assert.ok(lines.includes(`${t.removeLabels.absent}  ghost (${t.removeSkillMissing('ghost')})`), lines.join('\n'));
    assert.deepEqual(shared.stub.removeCalls, [], 'the provider was asked to remove a skill it does not list');
    assert.equal(fs.existsSync(statePath(shared.ctx)), false, 'a named removal wrote a record file');
  } finally {
    await tui.stop();
  }
});

test('n and Esc decline without writing, and Esc in the name mode cancels the mode first', async () => {
  const shared = setup({
    records: [{ itemId: 'skill-a', kind: 'skill' }],
    installed: [{ name: 'alpha', source: 'fixture/skills', agents: ['fake'] }],
  });
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openRemove(tui);
    await tui.press('a');
    for (const char of 'ghost') await tui.press(char);
    // Esc is the mode's: it empties the name and leaves the plan where it was.
    await tui.press('\u001B');
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.remove}`), true, tui.frame());
    assert.equal(tui.frame().includes(t.tui.removeNameTitle), false, 'the name mode outlived Esc');
    assert.equal(tui.frame().includes(`${t.tui.removeNamePrompt} ghost`), false, 'the cancelled name is still there');

    // In the settled plan, Esc leaves the surface without writing.
    await tui.press('\u001B');
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.install}`), true, tui.lines()[0] ?? '');

    // `n` is the same decline.
    await openRemove(tui);
    await tui.press('n');
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.install}`), true, tui.lines()[0] ?? '');
    assert.deepEqual(shared.stub.removeCalls, [], 'a declined plan wrote something');
    assert.equal(readState(shared.ctx).state.entries.length, 1, 'a declined plan changed the record');
  } finally {
    await tui.stop();
  }
});

test('not covered and needs a name — remove by hand stay separate words in the plan and the result', async () => {
  const shared = setup({
    data: data({ skills: 'argv', mcp: false }),
    records: [
      { itemId: 'skill-group', kind: 'skill' },
      { itemId: 'mcp-a', kind: 'mcp' },
    ],
  });
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openRemove(tui);
    const lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 30 });
    assert.notEqual(t.removePlanLabels.manual, t.removePlanLabels['not-covered']);
    assert.ok(lines.some((line) => line.startsWith('> - skill-group [skill]')), lines.join('\n'));
    assert.ok(lines.some((line) => line.startsWith('  - mcp-a [mcp] → not covered')), lines.join('\n'));
    // The focused row carries the core's reason in full, so `manual` is never the whole story.
    assert.ok(tui.frame().includes('- skill-group [skill] → needs a name — remove by hand'), tui.frame());
    assert.ok(squash(tui.frame()).includes(squash(t.removeNoSkills('fixture/group'))), tui.frame());
    // The other row is one Down away, and its own word and reason are just as distinct.
    await tui.press('\u001B[B');
    assert.ok(tui.frame().includes('- mcp-a [mcp] → not covered'), tui.frame());
    assert.ok(squash(tui.frame()).includes(squash(t.removeNotCovered('mcp'))), tui.frame());
  } finally {
    await tui.stop();
  }
});

test('a partial failure is one row per item, and the rest of the plan still runs', async () => {
  const shared = setup({
    records: [
      { itemId: 'skill-a', kind: 'skill' },
      { itemId: 'skill-b', kind: 'skill' },
    ],
    installed: [
      { name: 'alpha', source: 'fixture/skills', agents: ['fake'] },
      { name: 'gamma', source: 'fixture/skills', agents: ['fake'] },
    ],
    fail: ['gamma'],
  });
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openRemove(tui);
    await tui.press('y');
    const lines = await result(tui);
    expectFrame(lines, { width: 120, rows: 30 });
    assert.ok(lines.includes(`${t.removeLabels.removed}  skill-a`), lines.join('\n'));
    const failure = lines.find((line) => line.startsWith(`${t.removeLabels.error}  skill-b`));
    assert.ok(failure?.includes('gamma: remove failed'), String(failure));
    // Both entries were attempted, and only the one that went took its record with it.
    assert.deepEqual(shared.stub.removeCalls, [['alpha'], ['gamma']]);
    assert.deepEqual(readState(shared.ctx).state.entries.map((entry) => entry.itemId), ['skill-b']);
  } finally {
    await tui.stop();
  }
});

test('while the removal runs the body names the work and refuses every key that would leave', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const shared = setup({
    records: [
      { itemId: 'skill-a', kind: 'skill' },
      { itemId: 'hook-a', kind: 'hook', hookCommand: HOOK_COMMAND },
    ],
    installed: [{ name: 'alpha', source: 'fixture/skills', agents: ['fake'] }],
    gate,
  });
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openRemove(tui);
    await tui.press('y');
    await settle(tui, () => /applying… \d+s/.test(tui.frame()));
    const busy = tui.frame();
    assert.ok(busy.includes(t.tui.removeShape(2)), busy);
    assert.ok(busy.includes(t.tui.applyNothingElse), busy);
    assert.ok(busy.includes(t.tui.applyRefusal), busy);
    for (const key of ['q', '\u001B', 'n', 'x']) {
      await tui.press(key);
      assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.remove}`), true, `${key} left the write`);
      assert.ok(tui.frame().includes(t.tui.applyRefusal), tui.frame());
    }
    release();
    const lines = await result(tui);
    assert.ok(lines.includes(`${t.removeLabels.removed}  skill-a`), lines.join('\n'));
    assert.equal(tui.frame().includes(t.tui.applyRefusal), false, 'the refusal outlived the write');
  } finally {
    await tui.stop();
  }
});

test('the empty record is stated, and y has nothing to promise or to clear', async () => {
  const shared = setup({ data: data({ skills: 'none' }) });
  const tui = await startTui({ ...shared, width: 120 });
  try {
    await openRemove(tui);
    expectFrame(tui.lines(), { width: 120, rows: 30 });
    assert.ok(tui.frame().includes(t.tui.removeEmpty), tui.frame());
    assert.equal(planRows(tui.lines()).length, 0, tui.frame());
    // The keybar never advertises a key that can do nothing; pressing it says why.
    assert.equal((tui.lines().at(-1) ?? '').includes('y remove'), false, tui.lines().at(-1) ?? '');
    await tui.press('y');
    assert.ok(tui.frame().includes(t.tui.removeEmpty), tui.frame());
    assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.remove}`), true);
  } finally {
    await tui.stop();
  }
});

test('at 40 columns the plan wraps, the confirm still fits above the keybar and no line leaves the frame', async () => {
  const shared = setup({
    records: [
      { itemId: 'skill-a', kind: 'skill' },
      { itemId: 'hook-a', kind: 'hook', hookCommand: HOOK_COMMAND },
    ],
    installed: [{ name: 'alpha', source: 'fixture/skills', agents: ['fake'] }],
  });
  const tui = await startTui({ ...shared, width: 40 });
  try {
    await openRemove(tui);
    const lines = tui.lines();
    expectFrame(lines, { width: 40, rows: 30 });
    const flat = lines.join(' ').replace(/\s+/g, ' ');
    assert.ok(flat.includes('paths:'), lines.join('\n'));
    assert.ok(flat.includes(t.tui.removeConfirm(2)), lines.join('\n'));
    assert.ok((lines.at(-1) ?? '').includes('y remove'), lines.at(-1) ?? '');

    // The name mode fits the same frame.
    await tui.press('a');
    for (const char of 'ghost') await tui.press(char);
    const named = tui.lines();
    expectFrame(named, { width: 40, rows: 30 });
    assert.ok(named.join(' ').includes(`${t.tui.removeNamePrompt} ghost`), named.join('\n'));
  } finally {
    await tui.stop();
  }
});
