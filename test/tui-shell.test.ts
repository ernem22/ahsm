import assert from 'node:assert/strict';
import test from 'node:test';
import { t } from '../src/i18n.js';
import { fixture, startTui } from './tui-harness.js';

const RAIL = 'i install · p plan · s status · l list · v stale · u update · x remove';

test('the shell opens on install with a header, a target and a keybar', async () => {
  const tui = await startTui({ ...fixture(true), width: 120 });
  try {
    const lines = tui.lines();
    const header = lines[0] as string;
    assert.ok(header.startsWith('agentenv  install'), header);
    assert.ok(header.endsWith(RAIL), header);
    assert.equal(header.length, 120);
    assert.equal(lines[1], 'target: Fake Harness');
    assert.equal(lines[lines.length - 1], '? keys · q quit');
  } finally {
    await tui.stop();
  }
});

test('the frame carries no stage of the old wizard', async () => {
  const tui = await startTui({ ...fixture(), width: 120 });
  try {
    const frame = tui.frame();
    for (const copy of [t.harnesses, t.packages, t.planBuilding, t.keysHarness[0] as string, t.keysItems[0] as string]) {
      assert.equal(frame.includes(copy), false, `frame still shows ${copy}`);
    }
  } finally {
    await tui.stop();
  }
});

test('no rendered line is wider than the frame', async () => {
  for (const width of [120, 40]) {
    const tui = await startTui({ ...fixture(), width });
    try {
      for (const line of tui.lines()) assert.ok(line.length <= width, `${line.length} > ${width}: ${line}`);
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

test('? opens a help overlay of exactly the keys the keybar shows, and Esc closes only that', async () => {
  const tui = await startTui({ ...fixture(), width: 120 });
  try {
    await tui.press('p');
    const keybar = tui.lines()[tui.lines().length - 1] as string;
    const entries = keybar.split(' · ');
    assert.equal(entries.length > 2, true, keybar);

    await tui.press('?');
    const lines = tui.lines();
    const heading = lines.indexOf('keys — plan');
    assert.equal(heading > 2, true, 'the overlay did not open');
    assert.deepEqual(lines.slice(heading + 1, heading + 1 + entries.length), entries);
    assert.equal(lines[0]?.startsWith('agentenv  plan'), true, 'the overlay left the surface');

    await tui.press('\u001B');
    assert.equal(tui.lines().includes('keys — plan'), false, 'Esc did not close the overlay');
    assert.equal(tui.lines()[0]?.startsWith('agentenv  plan'), true, 'Esc closed the surface too');
    assert.equal(tui.lines()[2], 'plan');
  } finally {
    await tui.stop();
  }
});

test('Esc on install stays on install', async () => {
  const tui = await startTui({ ...fixture(), width: 120 });
  try {
    await tui.press('\u001B');
    assert.equal(tui.lines()[0]?.startsWith('agentenv  install'), true);
    assert.equal(tui.lines().includes('keys — install'), false);
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
