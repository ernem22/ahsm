import assert from 'node:assert/strict';
import test from 'node:test';
import { t } from '../src/i18n.js';
import { entryText, RAIL as RAIL_ROWS, SURFACES as SURFACE_IDS, type SurfaceId } from '../src/tui/keys.js';
import { expectFrame, fixture, startTui, type TuiHarness } from './tui-harness.js';

/**
 * One row per surface: how to reach it, when its own read has settled, the keys it names in its own
 * words, the keys its overlay lists but its keybar hides, and where its settled `Esc` goes.
 *
 * The table is the guardrail: a surface is only correct when its keybar, its overlay and its dispatch
 * tell the same story, so a new surface is a row here rather than another near-duplicate test.
 */
interface SurfaceCase {
  id: SurfaceId;
  open(tui: TuiHarness): Promise<void>;
  /** The frame the surface answers with once its own read has resolved. */
  /** Entries this surface prints in its own words: the part of the key set its table owns. */
  own: string[];
  /** Entries the overlay lists and the keybar hides: the movement keys are real, just not advertised. */
  hidden: string[];
  /** Where `Esc` in the settled surface sends the user; `install` staying put is its own answer. */
  back: SurfaceId | 'stay';
}

const MOVES = ['Up move', 'Down move', 'PgUp move', 'PgDn move', 'g first', 'G last'];
/**
 * The seven commands the CLI has, written out by hand: the rail is the contract, so the table the rail
 * is built from must equal this list rather than be compared with itself.
 */
const RAIL_COMMANDS: { key: string; surface: SurfaceId }[] = [
  { key: 'i', surface: 'install' },
  { key: 'p', surface: 'plan' },
  { key: 's', surface: 'status' },
  { key: 'l', surface: 'list' },
  { key: 'v', surface: 'stale' },
  { key: 'u', surface: 'update' },
  { key: 'x', surface: 'remove' },
];

/** Those commands as the frame prints them, from the same i18n names the rail and the overlay use. */
const RAIL = RAIL_COMMANDS.map((row) => `${row.key} ${t.tui.surfaces[row.surface]}`);

/** The frame the surface answers with: its read is not in flight and its body is not the placeholder. */
function settled(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 1500;
  return new Promise((resolve) => {
    const poll = (): void => {
      if (ready() || Date.now() > deadline) resolve();
      else setTimeout(poll, 5);
    };
    poll();
  });
}

async function opens(tui: TuiHarness, keys: string, surface: SurfaceId, ready: () => boolean): Promise<void> {
  if (keys !== '') await tui.press(...keys.split(''));
  await settled(() => tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces[surface]}`) === true && ready());
  assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces[surface]}`), true, `${keys || 'start'} did not reach ${surface}`);
}

/** Three `Enter`s walk the install form to the plan; a fourth opens the confirm. */
async function toApply(tui: TuiHarness): Promise<void> {
  await tui.press('\r', '\r', '\r');
  await settled(() => tui.frame() !== '' && !tui.frame().includes(t.planBuilding));
  await tui.press('\r');
}

/**
 * One row per surface, keyed by the surface itself: the record makes a new `SurfaceId` a compile error
 * until it has a row here, so the guardrail cannot be skipped by adding a surface in a hurry.
 */
const CASES: Record<SurfaceId, Omit<SurfaceCase, 'id'>> = {
  install: {
    open: () => Promise.resolve(),
    own: ['space choose', 'a all', 'Enter next'],
    hidden: ['Up move', 'Down move'],
    back: 'stay',
  },
  plan: {
    open: async (tui) => opens(tui, 'p', 'plan', () => !tui.frame().includes(t.planBuilding)),
    own: ['Enter apply', 'r rebuild'],
    hidden: MOVES,
    back: 'install',
  },
  apply: {
    open: async (tui) => {
      await toApply(tui);
      await settled(() => tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces.apply}`) === true);
    },
    own: ['y apply', 'n decline'],
    hidden: MOVES,
    back: 'plan',
  },
  status: {
    open: async (tui) => opens(tui, 's', 'status', () => tui.frame().includes(t.harnesses)),
    own: ['r refresh'],
    hidden: MOVES,
    back: 'install',
  },
  list: {
    open: async (tui) => opens(tui, 'l', 'list', () => tui.frame().includes(t.skillsTitle)),
    own: ['/ filter', 'f carriers', 'r refresh'],
    hidden: MOVES,
    back: 'install',
  },
  stale: {
    open: async (tui) => opens(tui, 'v', 'stale', () => tui.frame().includes(t.staleEmpty)),
    own: ['/ search', 'f filter', 'u update', 'r refresh'],
    hidden: MOVES,
    back: 'install',
  },
  update: {
    open: async (tui) => opens(tui, 'u', 'update', () => tui.frame().includes(t.updateNone)),
    own: ['r refresh', 'n decline', 'Esc back'],
    // An empty plan offers no `y`: the key is real, but a bar never advertises a key that refuses.
    hidden: [...MOVES, 'y apply'],
    back: 'install',
  },
  remove: {
    open: async (tui) => opens(tui, 'x', 'remove', () => tui.frame().includes(t.tui.removeEmpty)),
    own: ['a name a skill', 'n decline', 'Esc back'],
    // An empty record offers no `y`: the key is real, but a bar never advertises a key that refuses.
    hidden: [...MOVES, 'y remove'],
    back: 'install',
  },
};

/** The cases in the surface table's own order, so the test and the rail never keep two lists. */
const SURFACES: SurfaceCase[] = SURFACE_IDS.map((id) => ({ id, ...CASES[id] }));

/** A keybar entry's token: its key name, which is the first word `entryText` writes. */
function token(entry: string): string {
  return entry.split(' ')[0] ?? '';
}

/** The entries of one keybar line, in the order the frame prints them. */
function entries(line: string): string[] {
  return line === '' ? [] : line.split(t.tui.keybarSeparator);
}

/** The overlay's rows: from its heading to the keybar on the frame's last line. */
function overlayRows(lines: string[], surface: SurfaceId): string[] {
  const heading = lines.indexOf(t.tui.helpTitle(t.tui.surfaces[surface]));
  assert.notEqual(heading, -1, `the overlay did not open on ${surface}`);
  return lines.slice(heading + 1, lines.length - 1).filter((line) => line !== '');
}

/** The keys that belong to the mode, not to the surface: the overlay replaces all three while it is open. */
const MODE = new Set(['Esc', '?', 'q']);

test('the rail holds the seven commands with their CLI letters and surface names', () => {
  // The literal list is the contract: a table that drifted from it would still pass a self-comparison.
  assert.deepEqual(
    RAIL_ROWS.map((row) => ({ key: row.key, surface: row.surface })),
    RAIL_COMMANDS,
  );
  assert.deepEqual([...SURFACE_IDS].sort(), ['apply', 'install', 'list', 'plan', 'remove', 'stale', 'status', 'update']);
  // The rail holds the surfaces that have a letter, and `apply` reaches the user by `Enter` instead.
  assert.equal(RAIL_ROWS.some((row) => row.surface === 'apply'), false);
  assert.deepEqual(
    RAIL_ROWS.map((row) => entryText({ keys: [row.key], label: t.tui.surfaces[row.surface], run: () => {} })),
    RAIL,
  );
});

test('every surface lists its key once, in the overlay, and dispatches the entry it lists', async () => {
  for (const surface of SURFACES) {
    const tui = await startTui({ ...fixture(true), width: 120 });
    try {
      await surface.open(tui);
      expectFrame(tui.lines(), { width: 120, rows: 30 });

      const keybar = entries(tui.lines().at(-1) ?? '');
      assert.ok(keybar.length > 0, `${surface.id} has no keybar`);
      // No key appears twice: two bindings for one token are precedence, not two entries.
      assert.equal(new Set(keybar.map(token)).size, keybar.length, `${surface.id}: ${keybar.join('|')}`);

      // The surface's own keys are the ones it advertises in its own words.
      for (const entry of surface.own) assert.ok(keybar.includes(entry), `${surface.id} does not list ${entry}: ${keybar.join('|')}`);
      for (const entry of surface.hidden) assert.equal(keybar.includes(entry), false, `${surface.id} advertises ${entry}`);

      await tui.press('?');
      const lines = tui.lines();
      const rows = overlayRows(lines, surface.id);
      expectFrame(lines, { width: 120, rows: 30 });

      // The overlay is a mode: its own keys come first, and each key appears once there too.
      assert.deepEqual(rows.slice(0, 3), ['Esc close', '? close', 'q quit'], rows.join('|'));
      assert.equal(new Set(rows.map(token)).size, rows.length, `${surface.id} overlay repeats a key: ${rows.join('|')}`);
      // Every hidden key is real and reachable, even though a keybar never advertises it.
      for (const entry of surface.hidden) assert.ok(rows.includes(entry), `${surface.id} overlay hides ${entry}: ${rows.join('|')}`);
      // The surface's keys come before the rail, so the frame reads as `this surface`, then `the others`.
      const ownAt = surface.own.map((entry) => rows.indexOf(entry)).filter((at) => at >= 0);
      const railAt = RAIL.filter((entry) => !surface.own.includes(entry)).map((entry) => rows.indexOf(entry));
      for (const entry of railAt) assert.ok(entry !== -1, `${surface.id} overlay lost a rail key: ${rows.join('|')}`);
      const lastOwn = ownAt.length > 0 ? Math.max(...ownAt) : 2;
      for (const at of railAt) assert.ok(at > lastOwn, `${surface.id} rail entry is listed before the surface's own keys`);

      // While the overlay is open its key set is what really dispatches, so the keybar says exactly that…
      const overlayKeybar = lines.at(-1) ?? '';
      assert.equal(overlayKeybar, 'Esc close · q quit', `${surface.id}: ${overlayKeybar}`);
      for (const entry of entries(overlayKeybar)) assert.ok(rows.includes(entry), `${surface.id} keybar has ${entry} outside the overlay`);

      // …and the entry it lists is the binding the key takes: Esc closes the overlay, not the surface.
      await tui.press('\u001B');
      assert.equal(tui.lines().includes(t.tui.helpTitle(t.tui.surfaces[surface.id])), false, `${surface.id}: Esc did not close the overlay`);
      assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${t.tui.surfaces[surface.id]}`), true, `${surface.id}: Esc closed the surface too`);

      // Back in the surface, each listed key is the first binding for that token, and Esc does what it says.
      const settledKeybar = entries(tui.lines().at(-1) ?? '');
      for (const entry of settledKeybar) {
        if (MODE.has(token(entry))) continue;
        assert.equal(rows.find((row) => token(row) === token(entry)), entry, `${surface.id} lists ${entry}, not the binding dispatch takes`);
      }
      await tui.press('\u001B');
      const destination = surface.back === 'stay' ? t.tui.surfaces.install : t.tui.surfaces[surface.back];
      assert.equal(
        tui.lines()[0]?.startsWith(`agentenv  ${destination}`),
        true,
        `${surface.id}: Esc went to ${tui.lines()[0] ?? ''}, not ${destination}`,
      );
    } finally {
      await tui.stop();
    }
  }
});
