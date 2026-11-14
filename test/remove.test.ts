import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createContext, RecordingRunner, type Ctx, type RunResult } from '../src/context.js';
import { applyRemovePlan, planRemoval, type RemoveSelection } from '../src/core/remove.js';
import { readStatus } from '../src/core/status.js';
import { readState, statePath, writeState, type StateEntry } from '../src/core/state.js';
import { removeOutcomeLines, removePlanLines } from '../src/render.js';
import { t } from '../src/i18n.js';
import type { InstalledSkill, SkillsAdapter } from '../src/providers/skills-api.js';
import type { Data, ItemDef, Kind } from '../src/types.js';

const FAKE = 'fake';
const OTHER = 'other';

/**
 * Two harnesses and one item per kind. The skill provider is added per test, because removal asks the
 * provider that can remove — the argv one and the in-process adapter answer out of different places.
 */
function fixture(): Data {
  return {
    items: new Map<string, ItemDef>([
      ['skill-a', { id: 'skill-a', kind: 'skill', source: 'fixture/skills', skill: 'alpha', targets: '*' }],
      ['skill-group', { id: 'skill-group', kind: 'skill', source: 'fixture/group', targets: '*' }],
      ['mcp-a', { id: 'mcp-a', kind: 'mcp', url: 'https://mcp.example.invalid/mcp', targets: '*' }],
    ]),
    packages: new Map([['base', { id: 'base', items: ['skill-a', 'mcp-a'] }]]),
    harnesses: [
      {
        id: FAKE,
        detect: ['~/.fake'],
        agentId: FAKE,
        config: { path: '~/.fake/settings.json', format: 'jsonc' },
        skills: { path: '~/.fake/skills' },
        mcp: { path: '~/.fake/mcp.json', key: 'mcpServers' },
      },
      {
        id: OTHER,
        detect: ['~/.other'],
        agentId: OTHER,
        config: { path: '~/.other/config.json', format: 'jsonc' },
        skills: { path: '~/.other/skills' },
      },
    ],
    providers: [
      {
        id: 'add-mcp',
        kind: 'mcp',
        supports: [FAKE, OTHER],
        verify: { strategy: 'json-key' },
        remove: ['npx', 'add-mcp', 'remove', '{serverName}'],
      },
    ],
    requires: [],
  };
}

/** The `npx skills` shape: one argv remove, no adapter — the provider's exit code is its own answer. */
function argvData(): Data {
  const data = fixture();
  data.providers.push({
    id: 'skills-cli',
    kind: 'skill',
    supports: [FAKE, OTHER],
    verify: { strategy: 'skill-lock', file: '~/.agents/.skill-lock.json' },
    remove: ['npx', 'skills', 'remove', '-g', '{skill}'],
  });
  return data;
}

/** The in-process adapter shape: removal goes through the skills package's own API. */
function adapterData(): Data {
  const data = fixture();
  data.providers.push({
    id: 'skills-api',
    kind: 'skill',
    supports: [FAKE, OTHER],
    priority: 5,
    adapter: 'skills-api',
    verify: { strategy: 'skill-lock', file: '~/.agents/.skill-lock.json' },
  });
  return data;
}

function tempHome(withHarness = true): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ahsm-remove-'));
  if (withHarness) fs.mkdirSync(path.join(home, '.fake'), { recursive: true });
  return home;
}

/** The record as ahsm leaves it, written straight so a test says only what it needs. */
function record(ctx: Ctx, entries: Array<{ itemId: string; harness: string; kind?: Kind }>): void {
  const stored: StateEntry[] = entries.map((entry, index) => ({
    itemId: entry.itemId,
    kind: entry.kind ?? 'skill',
    harness: entry.harness,
    providerId: 'skills-cli',
    at: `2020-01-01T00:00:0${index}Z`,
  }));
  writeState(ctx, { version: 1, entries: stored });
}

function argvContext(home: string, options: { results?: RunResult[]; installed?: InstalledSkill[] } = {}) {
  const runner = new RecordingRunner(options.results ?? []);
  // The skills API is stubbed here too: the argv provider never calls it, and the real package would
  // scan this machine's home.
  const ctx = createContext({
    root: process.cwd(),
    home,
    runner,
    platform: 'linux',
    skills: {
      install: async () => ({ installed: [], failed: [] }),
      remove: async ({ names }) => ({ removed: names, notFound: [], failed: [] }),
      list: async () => options.installed ?? [],
    },
  });
  return { ctx, runner };
}

/** A context whose skills API is a stub: the adapter surface is injected, never the network. */
function adapterContext(
  home: string,
  options: { installed?: InstalledSkill[]; list?: SkillsAdapter['list']; remove?: SkillsAdapter['remove'] } = {},
) {
  const removedCalls: Array<{ names: string[]; agents?: string[] }> = [];
  const ctx = createContext({
    root: process.cwd(),
    home,
    runner: new RecordingRunner(),
    platform: 'linux',
    skills: {
      install: async () => ({ installed: [], failed: [] }),
      remove:
        options.remove ??
        (async ({ names }) => {
          removedCalls.push({ names });
          return { removed: names, notFound: [], failed: [] };
        }),
      list: options.list ?? (async () => options.installed ?? []),
    },
  });
  return { ctx, removedCalls };
}

/** The provider's own lockfile: what a source-level removal asks for the names of its skills. */
function writeLock(home: string, sources: Record<string, string>): void {
  const file = path.join(home, '.agents', '.skill-lock.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const skills = Object.fromEntries(
    Object.entries(sources).map(([name, source]) => [name, { source, sourceType: 'github' }]),
  );
  fs.writeFileSync(file, JSON.stringify({ version: 3, skills }, null, 2), 'utf8');
}

async function plan(data: Data, ctx: Ctx, selection: RemoveSelection = {}) {
  return planRemoval(data, ctx, selection);
}

test('remove: kayıtlı öğelerin harness\'ları ve dizinleri onaydan önce gösterilir', async () => {
  const home = tempHome();
  const data = argvData();
  const { ctx, runner } = argvContext(home);
  record(ctx, [
    { itemId: 'skill-a', harness: FAKE },
    { itemId: 'mcp-a', harness: FAKE },
    { itemId: 'mcp-a', harness: OTHER, kind: 'mcp' },
  ]);
  const before = fs.readFileSync(statePath(ctx), 'utf8');

  const removal = await plan(data, ctx);

  // Both recorded items are in the plan, each with every harness it was recorded for.
  const byItem = new Map(removal.entries.map((entry) => [entry.itemId, entry]));
  assert.deepEqual(byItem.get('skill-a')?.harnesses, [FAKE]);
  assert.deepEqual(byItem.get('mcp-a')?.harnesses, [FAKE, OTHER]);
  assert.equal(byItem.get('skill-a')?.action, 'remove');

  // The directories come from the definitions, expanded, so the reviewer sees real paths.
  const paths = byItem.get('skill-a')?.paths ?? [];
  assert.ok(paths.includes(path.join(home, '.fake', 'skills')), `harness skill dir missing: ${paths.join(', ')}`);
  assert.ok(paths.includes(path.join(home, '.agents', 'skills')), `shared skill dir missing: ${paths.join(', ')}`);
  assert.deepEqual(byItem.get('mcp-a')?.paths, [path.join(home, '.fake', 'mcp.json')]);

  const text = removePlanLines(removal).map((line) => line.text);
  assert.ok(text.includes(`    ${t.removeAffects([FAKE, OTHER])}`), `affects line missing:\n${text.join('\n')}`);
  assert.ok(
    text.some((line) => line.startsWith('    paths: ') && line.includes(path.join(home, '.agents', 'skills'))),
    `paths line missing:\n${text.join('\n')}`,
  );

  // A plan is only a plan: no command ran and the record is byte for byte the same.
  assert.deepEqual(runner.calls, [], 'plan a command ran');
  assert.equal(fs.readFileSync(statePath(ctx), 'utf8'), before);
});

test('remove: adı verilen skill kayıtlı öğeyle aynı kurallarla planlanır', async () => {
  const home = tempHome();
  const data = argvData();
  const { ctx, runner } = argvContext(home);
  record(ctx, [
    { itemId: 'skill-a', harness: FAKE },
    { itemId: 'mcp-a', harness: FAKE, kind: 'mcp' },
  ]);

  const removal = await plan(data, ctx, { skillNames: ['alpha'] });

  // One entry, not two: the name and the item that installs it are the same removal.
  assert.equal(removal.entries.length, 1);
  const [entry] = removal.entries;
  assert.equal(entry?.itemId, 'skill-a');
  assert.deepEqual(entry?.harnesses, [FAKE]);
  assert.deepEqual(entry?.command, ['npx', 'skills', 'remove', '-g', 'alpha']);
  assert.equal(entry?.named, undefined, 'a recorded item is not a named one');

  const outcome = await applyRemovePlan(data, ctx, removal);
  assert.deepEqual(
    outcome.results.map((result) => result.status),
    ['removed'],
  );
  assert.deepEqual(runner.calls, [['npx', 'skills', 'remove', '-g', 'alpha']]);
  // The untouched item keeps its record; the removed one leaves no ghost behind.
  assert.deepEqual(
    readState(ctx).state.entries.map((stored) => stored.itemId),
    ['mcp-a'],
  );
  assert.deepEqual(
    (await readStatus(data, ctx)).rows.map((row) => row.itemId),
    ['mcp-a'],
  );
});

test('remove: ahsm\'in kurmadığı skill adıyla kaldırılır', async () => {
  const home = tempHome();
  const data = adapterData();
  const { ctx, removedCalls } = adapterContext(home, {
    installed: [{ name: 'by-hand', source: 'owner/repo', agents: [FAKE] }],
  });

  const removal = await plan(data, ctx, { skillNames: ['by-hand'] });

  assert.equal(removal.entries.length, 1);
  const [entry] = removal.entries;
  // Nothing was ever recorded: the inventory is what says where it landed.
  assert.equal(entry?.itemId, 'by-hand');
  assert.equal(entry?.named, true);
  assert.equal(entry?.adapter, 'skills-api');
  assert.deepEqual(entry?.harnesses, [FAKE]);
  assert.ok((entry?.paths ?? []).includes(path.join(home, '.fake', 'skills')), 'harness skill dir missing');
  assert.equal(entry?.reason, undefined, 'the inventory lists it, so there is nothing to warn about');

  const outcome = await applyRemovePlan(data, ctx, removal);

  assert.equal(outcome.results[0]?.status, 'removed');
  assert.deepEqual(removedCalls, [{ names: ['by-hand'] }], 'removal must not narrow to one agent');
  // No record existed, so none was written: status has nothing to disagree with.
  assert.equal(fs.existsSync(statePath(ctx)), false, 'adlandırılmış kaldırma bir kayıt yarattı');
  assert.deepEqual((await readStatus(data, ctx)).rows, []);
});

test('remove: envanterde olmayan ad "not installed" der ve gerisini durdurmaz', async () => {
  const home = tempHome();
  const data = adapterData();
  const { ctx, removedCalls } = adapterContext(home, {
    installed: [{ name: 'by-hand', source: 'owner/repo', agents: [FAKE] }],
  });

  const outcome = await applyRemovePlan(data, ctx, await plan(data, ctx, { skillNames: ['gone', 'by-hand'] }));

  assert.deepEqual(
    outcome.results.map((result) => [result.entry.itemId, result.status]),
    [
      ['gone', 'absent'],
      ['by-hand', 'removed'],
    ],
  );
  assert.equal(outcome.results[0]?.message, t.removeSkillMissing('gone'));
  assert.deepEqual(removedCalls, [{ names: ['by-hand'] }], 'olmayan ad için sağlayıcı çağrıldı');
  assert.ok(
    removeOutcomeLines(outcome).some((line) => line.text === `${t.removeLabels.absent}  gone (${t.removeSkillMissing('gone')})`),
    'not installed satırı yok',
  );
});

test('remove: sağlayıcı hata verirse o öğe raporlanır, kalanı kaldırılır', async () => {
  const home = tempHome();
  const data = adapterData();
  const { ctx } = adapterContext(home, {
    installed: [
      { name: 'boom', source: 'owner/repo', agents: [FAKE] },
      { name: 'by-hand', source: 'owner/repo', agents: [FAKE] },
    ],
    remove: async ({ names }) =>
      names.includes('boom')
        ? { removed: [], notFound: [], failed: [{ skill: 'boom', message: 'boom cannot remove' }] }
        : { removed: names, notFound: [], failed: [] },
  });

  const outcome = await applyRemovePlan(data, ctx, await plan(data, ctx, { skillNames: ['boom', 'by-hand'] }));

  assert.deepEqual(
    outcome.results.map((result) => [result.entry.itemId, result.status, result.message]),
    [
      ['boom', 'error', 'boom cannot remove'],
      ['by-hand', 'removed', undefined],
    ],
  );
});

test('remove: argv sağlayıcıya ad doğrudan gider, kayıt gerekmez', async () => {
  const home = tempHome();
  const data = argvData();
  const { ctx, runner } = argvContext(home);

  const removal = await plan(data, ctx, { skillNames: ['by-hand'] });

  const [entry] = removal.entries;
  assert.equal(entry?.action, 'remove');
  assert.deepEqual(entry?.command, ['npx', 'skills', 'remove', '-g', 'by-hand']);
  // The inventory does not know it; the plan says so instead of silently dropping the name.
  assert.equal(entry?.reason, t.removeNotInInventory('by-hand'));

  const outcome = await applyRemovePlan(data, ctx, removal);

  assert.equal(outcome.results[0]?.status, 'removed');
  assert.deepEqual(runner.calls, [['npx', 'skills', 'remove', '-g', 'by-hand']]);
  assert.equal(fs.existsSync(statePath(ctx)), false, 'kayıtsız kaldırma bir kayıt yarattı');
});

test('remove: envanter okunamazsa ad yine planlanır ve sebep söylenir', async () => {
  const home = tempHome();
  const data = adapterData();
  const { ctx } = adapterContext(home, {
    list: async () => {
      throw new Error('skills API yok');
    },
  });

  const removal = await plan(data, ctx, { skillNames: ['by-hand'] });

  // A read that fails must not block a removal the user asked for.
  assert.equal(removal.entries.length, 1);
  assert.equal(removal.entries[0]?.action, 'remove');
  assert.deepEqual(removal.entries[0]?.harnesses, []);
  assert.equal(removal.warnings[0], t.removeInventoryUnreadable('skills API yok'));
});

test('remove: kaldıracak sağlayıcı yoksa ad "not covered" olarak raporlanır', async () => {
  const home = tempHome();
  const data = fixture();
  const { ctx } = argvContext(home);

  const removal = await plan(data, ctx, { skillNames: ['by-hand'] });

  assert.deepEqual(removal.entries, [
    { itemId: 'by-hand', kind: 'skill', harnesses: [], named: true, paths: [], action: 'not-covered', reason: t.removeNotCovered('skill') },
  ]);

  const outcome = await applyRemovePlan(data, ctx, removal);
  assert.equal(outcome.results[0]?.status, 'not-covered');
  assert.equal(outcome.results[0]?.message, t.removeNotCovered('skill'));
});

test('remove: paket seçimi kaydın kalanına dokunmaz', async () => {
  const home = tempHome();
  const data = argvData();
  const { ctx } = argvContext(home);
  record(ctx, [
    { itemId: 'skill-a', harness: FAKE },
    { itemId: 'mcp-a', harness: FAKE, kind: 'mcp' },
  ]);

  const removal = await plan(data, ctx, { itemIds: data.packages.get('base')?.items });

  assert.deepEqual(
    removal.entries.map((entry) => entry.itemId),
    ['skill-a', 'mcp-a'],
  );
  await applyRemovePlan(data, ctx, removal);
  assert.deepEqual(readState(ctx).state.entries, []);
});

test('remove: kaldırmadan sonra kayıt ve status diskle anlaşır', async () => {
  const home = tempHome();
  const data = adapterData();
  fs.writeFileSync(path.join(home, '.fake', 'settings.json'), '{}\n', 'utf8');
  const { ctx } = adapterContext(home, {
    installed: [{ name: 'alpha', source: 'fixture/skills', agents: [FAKE] }],
  });
  record(ctx, [{ itemId: 'skill-a', harness: FAKE }]);

  const outcome = await applyRemovePlan(data, ctx, await plan(data, ctx));

  assert.equal(outcome.results[0]?.status, 'removed');
  assert.deepEqual(readState(ctx).state.entries, [], 'kayıt hayalet girdi tutuyor');
  assert.deepEqual((await readStatus(data, ctx)).rows, [], 'status hayalet girdi gösteriyor');
});

test('remove: kaynak seviyesindeki öğe adlarını sağlayıcının kendi lockfile ından alır', async () => {
  const home = tempHome();
  const data = argvData();
  const { ctx, runner } = argvContext(home);
  record(ctx, [{ itemId: 'skill-group', harness: FAKE }]);
  writeLock(home, { alpha: 'fixture/group', beta: 'fixture/group', other: 'fixture/other' });

  const removal = await plan(data, ctx);

  const [entry] = removal.entries;
  assert.equal(entry?.action, 'remove');
  // Yalnız aynı kaynağın skill adları; başka kaynağın adı karışmaz.
  assert.deepEqual(entry?.command, ['npx', 'skills', 'remove', '-g', 'alpha', 'beta']);

  const outcome = await applyRemovePlan(data, ctx, removal);
  assert.equal(outcome.results[0]?.status, 'removed');
  assert.deepEqual(runner.calls, [['npx', 'skills', 'remove', '-g', 'alpha', 'beta']]);
});

test('remove: adı bulunamayan kaynak seviyesindeki öğe "manual" olarak raporlanır', async () => {
  const home = tempHome();
  const data = argvData();
  const { ctx, runner } = argvContext(home);
  record(ctx, [{ itemId: 'skill-group', harness: FAKE }]);
  // Lockfile kaynağından hiç skill yazmıyor: kaldırılacak ad yok, kullanıcı elle kaldırmalı.
  writeLock(home, {});

  const removal = await plan(data, ctx);
  const [entry] = removal.entries;
  assert.equal(entry?.action, 'manual');
  assert.equal(entry?.reason, t.removeNoSkills('fixture/group'));
  assert.ok(
    removePlanLines(removal).some((line) => line.text.includes(t.removePlanLabels.manual)),
    removePlanLines(removal)
      .map((line) => line.text)
      .join(' | '),
  );

  const outcome = await applyRemovePlan(data, ctx, removal);

  // GLOSSARY: "not covered" = hiçbir sağlayıcı bu türü desteklemiyor. Burada sağlayıcı var, ad yok.
  assert.equal(outcome.results[0]?.status, 'manual');
  assert.equal(outcome.results[0]?.message, t.removeNoSkills('fixture/group'));
  assert.deepEqual(runner.calls, [], 'adı olmayan kaldırma yine komut çalıştırdı');
  assert.ok(
    removeOutcomeLines(outcome).some(
      (line) => line.text === `${t.removeLabels.manual}  skill-group (${t.removeNoSkills('fixture/group')})`,
    ),
    removeOutcomeLines(outcome)
      .map((line) => line.text)
      .join(' | '),
  );
  // Hiçbir şey kaldırılmadı: kayıt yerinde durur.
  assert.deepEqual(readState(ctx).state.entries.map((stored) => stored.itemId), ['skill-group']);
});

test('remove: envanterde skill i olmayan kayıtlı öğe "not installed" der, "not covered" değil', async () => {
  const home = tempHome();
  const data = adapterData();
  const { ctx, removedCalls } = adapterContext(home, { installed: [] });
  record(ctx, [{ itemId: 'skill-a', harness: FAKE }]);

  const outcome = await applyRemovePlan(data, ctx, await plan(data, ctx));

  assert.equal(outcome.results[0]?.status, 'absent');
  assert.equal(outcome.results[0]?.message, t.removeNoSkills('fixture/skills'));
  assert.deepEqual(removedCalls, [], 'envanterde olmayan skill için sağlayıcı çağrıldı');
});
