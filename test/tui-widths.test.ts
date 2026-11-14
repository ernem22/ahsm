import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createContext, type Ctx, type RunResult, type Runner } from '../src/context.js';
import { recordEntry, readState } from '../src/core/state.js';
import { loadData } from '../src/data.js';
import { t } from '../src/i18n.js';
import type { Data } from '../src/types.js';
import { expectFrame, expectFrameText, fixture, fixtureHome, OFFLINE_ROOT, startTui, waitIdle, type TuiHarness } from './tui-harness.js';

/** The widths the design names: the two layouts, their boundaries, and what sits either side. */
const WIDTHS = [20, 30, 40, 59, 60, 80, 99, 100, 120];

/** The provider's own check, as the in-memory runner prints it: one installed copy is out of date. */
const CHECK_OUTPUT = [
  'Checking for skill updates…',
  '',
  'Checking skills from source: fixture/skills',
  '↑ alpha has an update',
  '',
  '1 skill(s) can be updated; run npx skills update to install',
].join('\n');

/** Answers the provider's check, the version probes and the install; a read, so it writes nothing. */
class SeededRunner implements Runner {
  async run(argv: string[]): Promise<RunResult> {
    const line = argv.join(' ');
    if (line.includes('check-skills.mjs')) return { code: 0, stdout: `${CHECK_OUTPUT}\n`, stderr: '' };
    if (line === 'node --version') return { code: 0, stdout: 'v22.1.0', stderr: '' };
    if (line.includes('--version')) return { code: 0, stdout: '1.0.0', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  }
}

/**
 * A home with one recorded skill whose provider's own check calls it stale: the sweep's `stale`,
 * `update` and `remove` frames carry a real row instead of an empty state, so the width rule is
 * measured against rows and not against an answer that has none.
 */
function seeded(): { data: Data; ctx: Ctx } {
  const home = fixtureHome();
  const data = loadData(OFFLINE_ROOT);
  const ctx = createContext({
    home,
    root: OFFLINE_ROOT,
    runner: new SeededRunner(),
    platform: 'linux',
    // The inventory is the one read that leaves the machine: tests answer it from memory.
    skills: {
      install: async () => ({ installed: [], failed: [] }),
      remove: async () => ({ removed: [], notFound: [], failed: [] }),
      list: async () => [{ name: 'alpha', source: 'fixture/skills', agents: ['fake'] }],
    },
  });
  // The lockfile the provider compares against, plus the record that says which item owns the skill.
  fs.mkdirSync(path.join(home, '.fake'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.fake', '.skill-lock.json'),
    JSON.stringify({
      version: 3,
      skills: {
        alpha: {
          source: 'fixture/skills',
          sourceType: 'github',
          skillPath: 'skills/x/SKILL.md',
          skillFolderHash: '0123456789abcdef0123456789abcdef01234567',
        },
      },
    }),
    'utf8',
  );
  recordEntry(ctx, readState(ctx).state, {
    ref: { itemId: 'skill-a', harness: 'fake', providerId: 'fake-skills' },
    kind: 'skill',
    command: ['node', 'install-skill.mjs', 'fixture/skills', 'alpha'],
  });
  return { data, ctx };
}

/** The frame as one string with every blank removed: a wrapped word is still the same word. */
function flat(text: string): string {
  return text.replace(/\s+/g, '');
}

function says(tui: TuiHarness, text: string): boolean {
  return flat(tui.frame()).includes(flat(text));
}

/** The surface's answer has arrived: its header is current and no read or write is still named. */
function ready(tui: TuiHarness, surface: string): boolean {
  const header = tui.lines()[0] ?? '';
  if (!header.startsWith(`ahsm  ${surface}`)) return false;
  const body = flat(tui.frame());
  return !body.includes(flat(t.planBuilding)) && !body.includes('readingthe') && !body.includes('applying…');
}

/** A read is a promise: the frame that shows its answer arrives a turn after the key that started it. */
async function settle(tui: TuiHarness, done: () => boolean, deadlineMs = 2000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(done(), `the frame never said what it should:\n${tui.frame()}`);
}

async function back(tui: TuiHarness): Promise<void> {
  // Every surface above is left by Esc only once its read is in: a busy frame would spend the key on
  // stopping the wait, whatever the width under test is.
  await waitIdle(tui);
  await tui.press('\u001B');
  await settle(tui, () => tui.lines()[0]?.startsWith(`ahsm  ${t.tui.surfaces.install}`) === true);
}

/**
 * Every surface at one width: install, the plan, its confirm and the empty result, then the five rows
 * surfaces one at a time, and finally the overlay. Each answer is awaited before the frame is asserted,
 * so a width is never measured against a busy frame.
 */
async function sweep(width: number): Promise<void> {
  const tui = await startTui({ ...seeded(), width });
  try {
    expectFrame(tui.lines(), { width, rows: 30 });

    await tui.press('p');
    await settle(tui, () => ready(tui, t.tui.surfaces.plan));
    expectFrame(tui.lines(), { width, rows: 30 });

    // Enter opens the confirm: the plan body until `y` runs it.
    await tui.press('\r');
    await settle(tui, () => ready(tui, t.tui.surfaces.apply));
    expectFrame(tui.lines(), { width, rows: 30 });
    await tui.press('y');
    await settle(tui, () => says(tui, t.tui.resultTitle) && ready(tui, t.tui.surfaces.apply));
    expectFrame(tui.lines(), { width, rows: 30 });
    await back(tui);

    // Each rows surface is measured against a row the seeded home really produces: `stale` and
    // `update` compare one installed copy, `list` holds it, `remove` has the record that owns it, and
    // `status` names the harness that carries it. An empty answer would pass the width rule silently.
    const rows: { key: string; surface: string; row: string }[] = [
      { key: 's', surface: t.tui.surfaces.status, row: t.harnesses },
      { key: 'l', surface: t.tui.surfaces.list, row: 'alpha' },
      { key: 'v', surface: t.tui.surfaces.stale, row: 'alpha' },
      { key: 'u', surface: t.tui.surfaces.update, row: 'skill-a' },
      { key: 'x', surface: t.tui.surfaces.remove, row: 'skill-a' },
    ];
    for (const { key, surface, row } of rows) {
      await tui.press(key);
      await settle(tui, () => ready(tui, surface) && says(tui, row));
      expectFrame(tui.lines(), { width, rows: 30 });
      expectFrameText(tui.lines(), row);
      await back(tui);
    }

    await tui.press('?');
    await settle(tui, () => says(tui, t.tui.helpTitle(t.tui.surfaces.install)));
    expectFrame(tui.lines(), { width, rows: 30 });
    expectFrameText(tui.lines(), t.tui.helpTitle(t.tui.surfaces.install));
  } finally {
    await tui.stop();
  }
}

test('every surface keeps the frame at every width, from 20 to 120 columns', async () => {
  for (const width of WIDTHS) await sweep(width);
});

test('at 59 columns the focus continuation is one … line; at 60 it wraps instead', async () => {
  for (const width of [59, 60]) {
    const tui = await startTui({ ...fixture(true), width });
    try {
      await tui.press('p');
      await settle(tui, () => ready(tui, t.tui.surfaces.plan));
      expectFrame(tui.lines(), { width, rows: 30 });
      const lines = tui.lines();
      const at = lines.findIndex((line) => line.trimStart().startsWith(`${t.runPrefix}:`));
      assert.notEqual(at, -1, `no continuation line in:\n${lines.join('\n')}`);
      const continuation = lines.slice(at + 1).find((line) => line.startsWith('      '));
      if (width === 59) {
        // The one 59-and-below rule: the focused row's continuation is cut, never carried over.
        assert.ok(lines[at]?.endsWith(t.tui.ellipsis), `the continuation was not cut: ${lines[at] ?? ''}`);
        assert.equal(continuation, undefined, `the continuation wrapped at 59:\n${lines.join('\n')}`);
      } else {
        // From 60 up the same continuation wraps under itself, so nothing is lost.
        assert.equal(lines[at]?.endsWith(t.tui.ellipsis), false, `the continuation was cut at 60: ${lines[at] ?? ''}`);
        assert.notEqual(continuation, undefined, `the continuation did not wrap at 60:\n${lines.join('\n')}`);
      }
    } finally {
      await tui.stop();
    }
  }
});

/** A colour foreground sequence: the tones are the only thing that should ever emit one. */
const COLOUR = /\u001B\[(3[0-9]|9[0-9]|38;5;|48;5;)/;

async function noColour(env: { NO_COLOR?: string; TERM?: string }, width: number): Promise<void> {
  const saved = { NO_COLOR: process.env.NO_COLOR, TERM: process.env.TERM };
  Object.assign(process.env, env);
  const tui = await startTui({ ...fixture(true), width });
  try {
    await tui.press('s');
    await settle(tui, () => says(tui, t.statusEmpty));
    expectFrame(tui.lines(), { width, rows: 30 });
    // The state word is the answer; the tone only repeats it. A detected harness with no readable
    // version is `too old`, and that word — not the yellow — is what survives with colour gone.
    expectFrameText(tui.lines(), t.harnessLabels['too-old']);
    expectFrameText(tui.lines(), t.statusEmpty);
    // Focus is a mark, not a colour, and no foreground colour sequence survived.
    assert.ok(tui.lines().some((line) => line.startsWith(t.tui.marks.focused)), tui.frame());
    assert.equal(COLOUR.test(tui.raw()), false, `a colour sequence survived:\n${JSON.stringify(tui.raw())}`);
  } finally {
    await tui.stop();
    if (saved.NO_COLOR === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = saved.NO_COLOR;
    if (saved.TERM === undefined) delete process.env.TERM;
    else process.env.TERM = saved.TERM;
  }
}

test('NO_COLOR and a dumb terminal drop the colour and keep the state words and the focus mark', async () => {
  for (const width of [40, 80]) {
    await noColour({ NO_COLOR: '1' }, width);
    await noColour({ TERM: 'dumb' }, width);
  }
});
