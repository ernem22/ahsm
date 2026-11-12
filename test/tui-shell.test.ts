import assert from 'node:assert/strict';
import test from 'node:test';
import { t } from '../src/i18n.js';
import { expectFrame, fixture, startTui } from './tui-harness.js';

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
    assert.ok(header.startsWith('agentenv  install'), header);
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
    assert.equal(lines[0]?.startsWith('agentenv  install'), true);
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
    assert.equal(tui.lines()[0], 'agentenv  install');
    assert.equal(tui.frame().includes('v stale'), false);
  } finally {
    await tui.stop();
  }
});

test('every letter of the rail reaches its surface, and Esc returns to install', async () => {
  const tui = await startTui({ ...fixture(), width: 120 });
  try {
    const rail: [string, string][] = [
      ['p', 'plan'],
      ['s', 'status'],
      ['l', 'list'],
      ['v', 'stale'],
      ['u', 'update'],
      ['x', 'remove'],
    ];
    for (const [key, name] of rail) {
      await tui.press(key);
      assert.equal(tui.lines()[0]?.startsWith(`agentenv  ${name}`), true, `${key} did not reach ${name}`);
      assert.equal(tui.lines()[2], name, `${name} did not print its own name`);
      await tui.press('\u001B');
      assert.equal(tui.lines()[0]?.startsWith('agentenv  install'), true, `Esc did not leave ${name}`);
    }
    await tui.press('i');
    assert.equal(tui.lines()[0]?.startsWith('agentenv  install'), true);
  } finally {
    await tui.stop();
  }
});

test('? opens one key set: the keybar and the overlay agree on every key they both show', async () => {
  const tui = await startTui({ ...fixture(), width: 120 });
  try {
    await tui.press('p', '?');
    const lines = tui.lines();
    const rows = overlayRows(lines, 'plan');
    assert.notEqual(rows, undefined, 'the overlay did not open');
    const keybar = lines[lines.length - 1] as string;

    // While the overlay is open these are the keys that really dispatch, so the keybar says them.
    assert.equal(keybar, 'Esc close · q quit');
    for (const entry of keybar.split(t.tui.keybarSeparator)) {
      assert.ok(rows?.includes(entry), `${entry} is on the keybar but not in the overlay`);
    }

    // …and nothing in the frame claims what the mode does not do: `Esc` closes, `?` opens nothing.
    const frame = tui.frame();
    assert.equal(frame.includes('Esc back'), false, 'the frame still claims Esc back while the overlay is open');
    assert.equal(frame.includes('? keys'), false, 'the frame still claims ? keys while the overlay is open');
    assert.equal(lines[0]?.startsWith('agentenv  plan'), true, 'the overlay left the surface');

    await tui.press('\u001B');
    assert.equal(tui.lines().includes(t.tui.helpTitle('plan')), false, 'Esc did not close the overlay');
    assert.equal(tui.lines()[0]?.startsWith('agentenv  plan'), true, 'Esc closed the surface too');
    assert.equal(tui.lines()[2], 'plan');
    assert.equal(tui.lines()[tui.lines().length - 1], 'r rebuild · ? keys · Esc back · q quit');
  } finally {
    await tui.stop();
  }
});

test('the overlay lists the surface keys once, and Esc is called close while it is open', async () => {
  const tui = await startTui({ ...fixture(), width: 120 });
  try {
    await tui.press('p');
    const keybar = tui.lines()[tui.lines().length - 1] as string;
    assert.equal(keybar, 'r rebuild · ? keys · Esc back · q quit');

    await tui.press('?');
    const rows = overlayRows(tui.lines(), 'plan');
    assert.deepEqual(rows, [
      'Up move',
      'Down move',
      'PgUp move',
      'PgDn move',
      'g first',
      'G last',
      'r rebuild',
      'i install',
      'p plan',
      's status',
      'l list',
      'v stale',
      'u update',
      'x remove',
      'Esc close',
      'q quit',
    ]);
  } finally {
    await tui.stop();
  }
});

test('Esc on install stays on install', async () => {
  const tui = await startTui({ ...fixture(), width: 120 });
  try {
    await tui.press('\u001B');
    assert.equal(tui.lines()[0]?.startsWith('agentenv  install'), true);
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
      assert.equal(tui.lines()[0], `agentenv  ${name}`, `${key} did not reach ${name} at 40 columns`);
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
    assert.equal(tui.lines()[0], 'agentenv  install');
  } finally {
    await tui.stop();
  }
});
