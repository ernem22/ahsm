import assert from 'node:assert/strict';
import test from 'node:test';
import { t } from '../src/i18n.js';
import { expectFrame, fixture, startTui, waitIdle } from './tui-harness.js';

const RAIL = 'i install · p plan · s status · l list · v stale · u update · x remove';

/** The overlay's own rows: from its heading down to the keybar on the last line of the window. */
function overlayRows(lines: string[], surface: string): string[] | undefined {
  const heading = lines.indexOf(t.tui.helpTitle(surface));
  if (heading === -1) return undefined;
  return lines.slice(heading + 1, lines.length - 1).filter((line) => line !== '');
}

test('the shell opens on install with a header, a target and a keybar', async () => {
  const tui = await startTui({ ...fixture(true), width: 120 });
  try {
    const lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 30 });
    const header = lines[0] as string;
    assert.ok(header.startsWith('ahsm  install'), header);
    assert.ok(header.endsWith(RAIL), header);
    assert.equal(header.length, 120);
    assert.equal(lines[1], 'target: Fake Harness');
    assert.equal(lines[lines.length - 1], 'space choose · a all · Enter next · ? keys · q quit');
  } finally {
    await tui.stop();
  }
});

test('the frame carries no stage of the old wizard', async () => {
  const tui = await startTui({ ...fixture(), width: 120 });
  try {
    const frame = tui.frame();
    const oldCopy = [
      t.packages,
      t.planBuilding,
      '↑/↓ move',
      'space toggle',
      'Enter open package',
      'Enter plan',
      '← back',
      'space mark updates',
      'y apply',
      'Enter to exit',
      'applying…',
      'updates marked — applying runs them',
    ];
    for (const copy of oldCopy) assert.equal(frame.includes(copy), false, `frame still shows ${copy}`);
  } finally {
    await tui.stop();
  }
});

test('the window is the height it was given, and the keybar is its last line', async () => {
  const tui = await startTui({ ...fixture(true), width: 120, rows: 16 });
  try {
    const lines = tui.lines();
    expectFrame(lines, { width: 120, rows: 16 });
    assert.equal(lines[15], 'space choose · a all · Enter next · ? keys · q quit');
    assert.equal(lines[0]?.startsWith('ahsm  install'), true);
  } finally {
    await tui.stop();
  }
});

test('no rendered line is wider than the frame', async () => {
  for (const width of [120, 40]) {
    const tui = await startTui({ ...fixture(), width });
    try {
      expectFrame(tui.lines(), { width, rows: 30 });
    } finally {
      await tui.stop();
    }
  }
});

test('the rail is gone at 40 columns', async () => {
  const tui = await startTui({ ...fixture(), width: 40 });
  try {
    assert.equal(tui.lines()[0], 'ahsm  install');
    assert.equal(tui.frame().includes('v stale'), false);
  } finally {
    await tui.stop();
  }
});

test('every letter of the rail reaches its surface, and Esc returns to install', async () => {
  const tui = await startTui({ ...fixture(), width: 120 });
  try {
    // The keys each surface answers with once its read resolved: Esc has nothing to stop by then.
    const rail: [string, string, string][] = [
      ['p', 'plan', t.actions(0, 0, 0)],
      ['s', 'status', t.harnesses],
      ['l', 'list', t.skillsTitle],
      ['v', 'stale', t.staleEmpty],
      ['u', 'update', t.updateNone],
      ['x', 'remove', t.tui.removeEmpty],
    ];
    for (const [key, name, marker] of rail) {
      await tui.press(key);
      // The surface is reached when its read is in, not when the header names it: a key pressed into
      // the wait is the wait's, so the answer is waited for before anything is asserted or pressed.
      await waitIdle(tui);
      assert.equal(tui.lines()[0]?.startsWith(`ahsm  ${name}`), true, `${key} did not reach ${name}`);
      assert.equal(tui.lines()[2], name, `${name} did not print its own name`);
      assert.ok(tui.frame().includes(marker), `${name} never answered:\n${tui.frame()}`);
      assert.ok((tui.lines().at(-1) ?? '').includes('Esc back'), `${name} does not offer Esc back:\n${tui.frame()}`);

      await tui.press('\u001B');
      assert.equal(tui.lines()[0]?.startsWith('ahsm  install'), true, `Esc did not leave ${name}: ${tui.lines()[0] ?? ''}`);
    }
    await tui.press('i');
    assert.equal(tui.lines()[0]?.startsWith('ahsm  install'), true);
  } finally {
    await tui.stop();
  }
});

test('Esc on install stays on install', async () => {
  const tui = await startTui({ ...fixture(), width: 120 });
  try {
    await tui.press('\u001B');
    assert.equal(tui.lines()[0]?.startsWith('ahsm  install'), true);
    assert.equal(tui.lines().includes(t.tui.helpTitle('install')), false);
  } finally {
    await tui.stop();
  }
});

test('q quits', async () => {
  const tui = await startTui({ ...fixture(), width: 120 });
  const exited = tui.waitUntilExit().then(() => 'exited' as const);
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 500));
  try {
    await tui.press('q');
    assert.equal(await Promise.race([exited, timeout]), 'exited');
  } finally {
    await tui.stop();
  }
});

test('at 40 columns the rail is gone and every letter still moves surfaces', async () => {
  const tui = await startTui({ ...fixture(), width: 40 });
  try {
    for (const [key, name] of [['l', 'list'], ['v', 'stale'], ['x', 'remove'], ['i', 'install']] as [string, string][]) {
      await tui.press(key);
      await waitIdle(tui);
      assert.equal(tui.lines()[0], `ahsm  ${name}`, `${key} did not reach ${name} at 40 columns`);
    }
  } finally {
    await tui.stop();
  }
});

test('at 40 columns the rail is hidden but the overlay still lists its seven letters', async () => {
  const tui = await startTui({ ...fixture(), width: 40 });
  try {
    await tui.press('?');
    const rows = overlayRows(tui.lines(), 'install') ?? [];
    for (const entry of RAIL.split(t.tui.keybarSeparator)) {
      assert.ok(rows.includes(entry), `${entry} exists but the narrow overlay does not list it`);
    }
    assert.ok(rows.includes('Esc close'), rows.join('|'));
    assert.equal(tui.lines()[0], 'ahsm  install');
  } finally {
    await tui.stop();
  }
});
