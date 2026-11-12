import assert from 'node:assert/strict';
import test from 'node:test';
import { t } from '../src/i18n.js';
import { expectFrame, expectFrameText, fixture, startTui, type TuiHarness } from './tui-harness.js';

/** The widths the design names: the two layouts, their boundaries, and what sits either side. */
const WIDTHS = [20, 30, 40, 59, 60, 80, 99, 100, 120];

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
  if (!header.startsWith(`agentenv  ${surface}`)) return false;
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
  await tui.press('\u001B');
  await settle(tui, () => tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.install}`) === true);
}

/**
 * Every surface at one width: install, the plan, its confirm and the empty result, then the five rows
 * surfaces one at a time, and finally the overlay. Each answer is awaited before the frame is asserted,
 * so a width is never measured against a busy frame.
 */
async function sweep(width: number): Promise<void> {
  const tui = await startTui({ ...fixture(), width });
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

    const rows: [string, string][] = [
      ['s', t.tui.surfaces.status],
      ['l', t.tui.surfaces.list],
      ['v', t.tui.surfaces.stale],
      ['u', t.tui.surfaces.update],
      ['x', t.tui.surfaces.remove],
    ];
    for (const [key, surface] of rows) {
      await tui.press(key);
      await settle(tui, () => ready(tui, surface));
      expectFrame(tui.lines(), { width, rows: 30 });
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
