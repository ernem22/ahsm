import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { t } from '../src/i18n.js';
import { expectFrame, OFFLINE_ROOT, fixture, startTui } from './tui-harness.js';

/** The rows under one section heading, up to the blank line that separates it from the next section. */
function section(lines: string[], heading: string): string[] {
  const start = lines.indexOf(heading);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.indexOf('');
  const rows = end === -1 ? rest.slice(0, -1) : rest.slice(0, end);
  return rows.filter((line) => line !== '');
}

function target(lines: string[]): string | undefined {
  return lines.find((line) => line.startsWith(`${t.target}: `));
}

/** A copy of the offline root with `count` extra one-detail-line items in the default package. */
function itemRoot(count: number): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-tui-install-'));
  fs.cpSync(OFFLINE_ROOT, root, { recursive: true });
  const items = Array.from({ length: count }, (_, at) => `extra-${at}`);
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

test('the install surface has three sections and folds the two it is not on', async () => {
  const tui = await startTui({ ...fixture(true), width: 120 });
  try {
    const lines = tui.lines();
    assert.equal(lines[0]?.startsWith('agentenv  install'), true);
    assert.equal(target(lines), 'target: Fake Harness');
    assert.deepEqual(section(lines, t.tui.sections.harnesses), ['> [x] Fake Harness']);
    assert.deepEqual(section(lines, t.tui.sections.package), [`  ${t.tui.packageSummary('base', 3)}`]);
    assert.deepEqual(section(lines, t.tui.sections.items), [`  ${t.tui.chosenOf(3, 3)}`]);
  } finally {
    await tui.stop();
  }
});

test('space toggles the focused row and the target line follows it', async () => {
  const tui = await startTui({ ...fixture(true), width: 120 });
  try {
    await tui.press(' ');
    let lines = tui.lines();
    assert.deepEqual(section(lines, t.tui.sections.harnesses), ['> [ ] Fake Harness']);
    assert.equal(target(lines), `target: ${t.noHarness}`);

    await tui.press(' ');
    lines = tui.lines();
    assert.deepEqual(section(lines, t.tui.sections.harnesses), ['> [x] Fake Harness']);
    assert.equal(target(lines), 'target: Fake Harness');
  } finally {
    await tui.stop();
  }
});

test('a toggles every row of the focused section', async () => {
  const tui = await startTui({ ...fixture(true), width: 120 });
  try {
    await tui.press('a');
    assert.deepEqual(section(tui.lines(), t.tui.sections.harnesses), ['> [ ] Fake Harness']);
    await tui.press('a');
    assert.deepEqual(section(tui.lines(), t.tui.sections.harnesses), ['> [x] Fake Harness']);
  } finally {
    await tui.stop();
  }
});

test('Enter walks the sections forward and its last step opens the plan', async () => {
  const tui = await startTui({ ...fixture(true), width: 120 });
  try {
    await tui.press('\r');
    let lines = tui.lines();
    assert.deepEqual(section(lines, t.tui.sections.harnesses), [`  ${t.tui.chosenOf(1, 1)}`]);
    assert.equal(section(lines, t.tui.sections.package)[0]?.startsWith('> [x] base'), true);

    await tui.press('\r');
    lines = tui.lines();
    assert.deepEqual(section(lines, t.tui.sections.package), [`  ${t.tui.packageSummary('base', 3)}`]);
    assert.equal(section(lines, t.tui.sections.items)[0]?.startsWith('> [x] skill-a'), true);

    await tui.press('\r');
    assert.equal(tui.lines()[0]?.startsWith('agentenv  plan'), true);
  } finally {
    await tui.stop();
  }
});

test('the focused item row carries its kind and its source, url or hook event', async () => {
  const tui = await startTui({ ...fixture(true), width: 120 });
  try {
    await tui.press('\r', '\r');
    const rows = section(tui.lines(), t.tui.sections.items);
    assert.equal(rows.length, 3, rows.join('|'));
    assert.equal(rows[0]?.startsWith('> [x] skill-a'), true, String(rows[0]));
    assert.equal(rows[0]?.includes('skill'), true, String(rows[0]));
    assert.equal(rows[0]?.includes(`${t.tui.sourcePrefix} fixture/skills`), true, String(rows[0]));
    assert.equal(rows[0]?.includes(`${t.notePrefix}: offline skill`), true, String(rows[0]));
    assert.equal(rows[1]?.includes(`${t.tui.urlPrefix} https://mcp.example.invalid/mcp`), true, String(rows[1]));
    assert.equal(rows[2]?.includes('PreToolUse · Bash'), true, String(rows[2]));
  } finally {
    await tui.stop();
  }
});

test('a package row carries its note and link, and space chooses the focused one', async () => {
  const tui = await startTui({ ...fixture(true), width: 120 });
  try {
    await tui.press('\r');
    let rows = section(tui.lines(), t.tui.sections.package);
    assert.equal(rows[0]?.startsWith('> [x] base'), true, String(rows[0]));
    assert.equal(rows[0]?.includes(`${t.notePrefix}: offline package`), true, String(rows[0]));
    assert.equal(rows[1]?.startsWith('  [ ] group'), true, String(rows[1]));

    await tui.press('down', ' ');
    rows = section(tui.lines(), t.tui.sections.package);
    assert.equal(rows[1]?.startsWith('> [x] group'), true, String(rows[1]));
    assert.equal(rows[0]?.startsWith('  [ ] base'), true, String(rows[0]));

    await tui.press('\u001B');
    assert.deepEqual(section(tui.lines(), t.tui.sections.package), [`  ${t.tui.packageSummary('group', 1)}`]);
    assert.deepEqual(section(tui.lines(), t.tui.sections.items), [`  ${t.tui.chosenOf(1, 1)}`]);
  } finally {
    await tui.stop();
  }
});

test('a shorter package clamps the items cursor, so a row is always focused', async () => {
  const tui = await startTui({ ...fixture(true), width: 120 });
  try {
    // `base` has three items: walk the items cursor to the last one, then go back to the package.
    await tui.press('\r', '\r', '\u001B[B', '\u001B[B');
    assert.equal(section(tui.lines(), t.tui.sections.items).at(-1)?.startsWith('> '), true);
    await tui.press('\u001B');

    // `group` has one item, so the items cursor no longer points at a row of the chosen package.
    await tui.press('\u001B[B', ' ');
    assert.deepEqual(section(tui.lines(), t.tui.sections.items), [`  ${t.tui.chosenOf(1, 1)}`]);

    await tui.press('\r');
    const rows = section(tui.lines(), t.tui.sections.items);
    assert.equal(rows.length, 1, rows.join('|'));
    assert.equal(rows[0]?.startsWith('> [x] skill-group'), true, `no item row is focused: ${rows.join('|')}`);

    // `space` acts on that focused row, so the key is never dead.
    await tui.press(' ');
    assert.equal(section(tui.lines(), t.tui.sections.items)[0]?.startsWith('> [ ] skill-group'), true);
  } finally {
    await tui.stop();
  }
});

test('Esc walks back one section at a time and keeps every choice', async () => {
  const tui = await startTui({ ...fixture(true), width: 120 });
  try {
    await tui.press('\r', '\r');
    assert.equal(section(tui.lines(), t.tui.sections.items).length, 3);

    // The focused item is the first one: drop it, then walk back with the change intact.
    await tui.press(' ');
    assert.equal(section(tui.lines(), t.tui.sections.items)[0]?.startsWith('> [ ] skill-a'), true);

    await tui.press('\u001B');
    let lines = tui.lines();
    assert.equal(section(lines, t.tui.sections.package)[0]?.startsWith('> [x] base'), true);
    assert.deepEqual(section(lines, t.tui.sections.items), [`  ${t.tui.chosenOf(2, 3)}`]);

    await tui.press('\u001B');
    lines = tui.lines();
    assert.deepEqual(section(lines, t.tui.sections.harnesses), ['> [x] Fake Harness']);
    assert.equal(target(lines), 'target: Fake Harness');
    assert.deepEqual(section(lines, t.tui.sections.items), [`  ${t.tui.chosenOf(2, 3)}`]);
  } finally {
    await tui.stop();
  }
});

test('Enter with nothing chosen keeps the stage and says why on the status line', async () => {
  const tui = await startTui({ ...fixture(), width: 120 });
  try {
    const before = tui.lines();
    assert.deepEqual(section(before, t.tui.sections.harnesses), [`> [ ] Fake Harness${t.tui.detailSeparator}${t.tui.notDetected}`]);

    await tui.press('\r');
    const lines = tui.lines();
    assert.deepEqual(section(lines, t.tui.sections.harnesses), [`> [ ] Fake Harness${t.tui.detailSeparator}${t.tui.notDetected}`]);
    assert.equal(lines[lines.length - 1], 'space choose · a all · Enter next · ? keys · q quit');
    assert.equal(lines[lines.length - 2], t.tui.nothingChosenHarness);

    await tui.press(' ');
    const chosen = tui.lines();
    assert.equal(chosen.includes(t.tui.nothingChosenHarness), false, 'the hint outlived the choice');
    assert.equal(target(chosen), 'target: Fake Harness');
  } finally {
    await tui.stop();
  }
});

test('Enter with no item chosen keeps the stage and says why', async () => {
  const tui = await startTui({ ...fixture(true), width: 120 });
  try {
    await tui.press('\r', '\r', 'a', '\r');
    const lines = tui.lines();
    assert.equal(lines[0]?.startsWith('agentenv  install'), true);
    assert.equal(lines[lines.length - 2], t.tui.nothingChosenItem);
  } finally {
    await tui.stop();
  }
});

test('a not detected harness stays listed, is marked and is chooseable', async () => {
  const tui = await startTui({ ...fixture(), width: 120 });
  try {
    assert.deepEqual(section(tui.lines(), t.tui.sections.harnesses), [`> [ ] Fake Harness${t.tui.detailSeparator}${t.tui.notDetected}`]);
    await tui.press(' ');
    const lines = tui.lines();
    assert.deepEqual(section(lines, t.tui.sections.harnesses), [`> [x] Fake Harness${t.tui.detailSeparator}${t.tui.notDetected}`]);
    assert.equal(target(lines), 'target: Fake Harness');
  } finally {
    await tui.stop();
  }
});

test('at 40 columns the detail moves under its row and nothing overflows', async () => {
  const tui = await startTui({ ...fixture(true), width: 40 });
  try {
    await tui.press('\r', '\r');
    const lines = tui.lines();
    for (const line of lines) assert.ok(line.length <= 40, `${line.length} > 40: ${line}`);
    assert.deepEqual(section(lines, t.tui.sections.items), [
      '> [x] skill-a  skill',
      '    source: fixture/skills',
      '    note: offline skill',
      '  [x] mcp-a  mcp',
      '    url: https://mcp.example.invalid/mcp',
      '    note: offline mcp',
      '  [x] hook-a  hook',
      '    PreToolUse · Bash',
      '    note: offline hook',
    ]);
  } finally {
    await tui.stop();
  }
});

test('a package taller than the window scrolls: the header and the focused row stay visible', async () => {
  for (const [width, rows] of [
    [80, 20],
    [40, 24],
  ] as [number, number][]) {
    const tui = await startTui({ ...fixture(true, itemRoot(12)), width, rows });
    try {
      // The items section is where the 12 rows are: the two Enter presses walk to it.
      await tui.press('\r', '\r');
      let lines = tui.lines();
      expectFrame(lines, { width, rows });
      assert.equal(lines[0]?.startsWith('agentenv  install'), true, 'the header scrolled away');
      assert.ok(lines.includes(t.tui.sections.items), 'the items heading is not on screen');
      assert.equal(tui.frame().includes('extra-11'), false, 'the whole package fit: the window is not under test');

      for (let at = 0; at < 11; at += 1) await tui.press('\u001B[B');
      lines = tui.lines();
      expectFrame(lines, { width, rows });
      assert.equal(lines[0]?.startsWith('agentenv  install'), true, 'the header scrolled away');
      assert.ok(lines.includes(t.tui.sections.items), 'the items heading scrolled away');

      const focused = lines.filter((line) => line.startsWith('> '));
      assert.equal(focused.length, 1, `the window shows ${focused.length} focused rows`);
      assert.ok(focused[0]?.includes('extra-11'), `the focused row is not the one scrolled to: ${focused[0]}`);
    } finally {
      await tui.stop();
    }
  }
});

test('the row marks and the part separator are the ones i18n holds', async () => {
  const tui = await startTui({ ...fixture(true), width: 120 });
  try {
    assert.equal(section(tui.lines(), t.tui.sections.harnesses)[0], `${t.tui.marks.focused}${t.tui.marks.chosen}Fake Harness`);
    await tui.press(' ');
    assert.equal(
      section(tui.lines(), t.tui.sections.harnesses)[0],
      `${t.tui.marks.focused}${t.tui.marks.unchosen}Fake Harness`,
    );
    await tui.press(' ');

    await tui.press('\r', '\r');
    const hook = section(tui.lines(), t.tui.sections.items).find((line) => line.includes('hook-a')) ?? '';
    assert.ok(hook.includes(`PreToolUse${t.tui.partSeparator}Bash`), hook);

    // The plan body leads every row with the same focus mark, from the same table.
    await tui.press('\r');
    assert.equal(tui.lines().some((line) => line.startsWith(t.tui.marks.focused)), true, tui.frame());
  } finally {
    await tui.stop();
  }
});

test('a is not listed on the package section, where a package is a single choice', async () => {
  const tui = await startTui({ ...fixture(true), width: 120 });
  try {
    await tui.press('\r');
    // The keybar advertises only what this section really offers.
    assert.equal(tui.lines().at(-1), 'space choose · Enter next · Esc back · ? keys · q quit');

    await tui.press('?');
    const overlay = tui.lines();
    assert.equal(overlay.includes('a all'), false, 'the overlay lists a key that does nothing here');
    assert.equal(overlay.includes('space choose'), true, 'the overlay lost the section keys');
    await tui.press('\u001B');

    // `a` is inactive here, so nothing about the package or its items moves.
    const before = tui.frame();
    await tui.press('a');
    assert.equal(tui.frame(), before, 'a acted on the package section');
  } finally {
    await tui.stop();
  }
});
