import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createContext, type Ctx, type RunResult, type Runner } from '../src/context.js';
import { applyPlan, exitCodeFor } from '../src/core/apply.js';
import { readState, recordEntry, type State } from '../src/core/state.js';
import { readStatus } from '../src/core/status.js';
import { buildUpdatePlan, type UpdatePlan } from '../src/core/update.js';
import { updateLines, updateOutcomeLines } from '../src/render.js';
import { t } from '../src/i18n.js';
import type { SkillsAdapter } from '../src/providers/skills-api.js';
import type { Data, ProviderDef } from '../src/types.js';

const CLAUDE = 'claude-code';
const CODEX = 'codex';
const HASH = '0123456789abcdef0123456789abcdef01234567';
const CHECK = ['npx', 'skills', 'check', '-g'];
const T0 = '2024-01-01T00:00:00.000Z';
const T1 = '2024-01-02T00:00:00.000Z';

/** The two real skill providers: the API one installs, the CLI one is the only one that can check. */
function fixture(overrides: Partial<ProviderDef> = {}): Data {
  return {
    items: new Map([
      ['skill-a', { id: 'skill-a', kind: 'skill' as const, source: 'fixture/skills', skill: 'alpha', targets: '*' as const }],
      ['skill-b', { id: 'skill-b', kind: 'skill' as const, source: 'fixture/skills', skill: 'beta', targets: '*' as const }],
    ]),
    packages: new Map(),
    harnesses: [
      { id: CLAUDE, detect: ['~/.claude'], agentId: CLAUDE, config: { path: '~/.claude/settings.json', format: 'jsonc' as const } },
      { id: CODEX, detect: ['~/.codex'], agentId: CODEX, config: { path: '~/.codex/config.json', format: 'jsonc' as const } },
    ],
    providers: [
      {
        id: 'skills-cli',
        kind: 'skill',
        supports: [CLAUDE, CODEX],
        requires: ['node'],
        priority: 10,
        verify: { strategy: 'skill-lock' as const, file: '~/.agents/.skill-lock.json' },
        install: ['npx', 'skills', 'add', '{source}', '-g', '-a', '{agentId}', '--skill {skill}'],
        remove: ['npx', 'skills', 'remove', '-g', '{skill}'],
        check: CHECK,
        ...overrides,
      },
    ],
    requires: [
      {
        id: 'node',
        check: { command: ['node', '--version'], min: '20' },
        install: { win32: ['install-node'], darwin: ['install-node'], linux: ['install-node'] },
      },
    ],
  };
}

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-update-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  return home;
}

function lockEntry(source: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { source, sourceType: 'github', skillPath: 'skills/x/SKILL.md', skillFolderHash: HASH, ...extra };
}

/** Writes the provider's own lockfile: the only thing `stale` compares against. */
function writeLock(home: string, skills: Record<string, Record<string, unknown>>): void {
  const file = path.join(home, '.agents', '.skill-lock.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 3, skills }, null, 2), 'utf8');
}

/** The provider's `skills check` output when exactly these skills have a newer copy upstream. */
function checkOutput(stale: string[]): string {
  const lines = ['Checking for skill updates…', 'Checking skills from source: fixture/skills'];
  for (const name of stale) lines.push(`↑ ${name} has an update`);
  if (stale.length > 0) lines.push(`${stale.length} skill(s) can be updated; run npx skills update to install`);
  else lines.push('✓ All global skills are up to date');
  return `${lines.join('\n')}\n`;
}

/**
 * Answers the three commands the update path runs — the provider's check, the requirement check and
 * the install — and lands a successful install in the lockfile, so verification sees it.
 */
class UpdateRunner implements Runner {
  readonly calls: string[][] = [];
  readonly installs: string[][] = [];

  constructor(
    private readonly home: string,
    private readonly stale: string[],
    private readonly fails: string[] = [],
  ) {}

  async run(argv: string[]): Promise<RunResult> {
    this.calls.push(argv);
    if (argv.join(' ') === CHECK.join(' ')) return { code: 0, stdout: checkOutput(this.stale), stderr: '' };
    if (argv.join(' ') === 'node --version') return { code: 0, stdout: 'v22.1.0', stderr: '' };
    if (argv[0] === 'npx' && argv[1] === 'skills' && argv[2] === 'add') {
      this.installs.push(argv);
      const name = argv[argv.indexOf('--skill') + 1] ?? '';
      if (this.fails.includes(name)) return { code: 1, stdout: '', stderr: `${name}: install failed` };
      writeLock(this.home, { [name]: lockEntry(argv[3] ?? '') });
      return { code: 0, stdout: `installed ${name}`, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  }
}

/** A clock the test moves forward, so a refreshed record can be told from an untouched one. */
function context(home: string, runner: Runner, skills?: Partial<SkillsAdapter>): { ctx: Ctx; advance: () => void } {
  let now = T0;
  const ctx = createContext({
    root: process.cwd(),
    home,
    runner,
    platform: 'linux',
    now: () => new Date(now),
    ...(skills
      ? { skills: { install: async () => ({ installed: [], failed: [] }), remove: async () => ({ removed: [], notFound: [], failed: [] }), list: async () => [], ...skills } }
      : {}),
  });
  return { ctx, advance: () => { now = T1; } };
}

/** What agentenv remembers about one installation, so the update has a harness to install for. */
function recordInstall(ctx: Ctx, itemId: string, harness: string, skill: string): void {
  const state: State = readState(ctx).state;
  recordEntry(ctx, state, {
    ref: { itemId, harness, providerId: 'skills-cli' },
    kind: 'skill',
    command: ['npx', 'skills', 'add', 'fixture/skills', '-g', '-a', harness, '--skill', skill],
  });
}

function recordedAt(ctx: Ctx, itemId: string, harness: string): string | undefined {
  return readState(ctx).state.entries.find((entry) => entry.itemId === itemId && entry.harness === harness)?.at;
}

/** Every file and directory under `dir`, so "writes nothing" is checked against the whole tree. */
function snapshot(dir: string): string {
  const hash = crypto.createHash('sha256');
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      hash.update(`${path.relative(dir, full)}:${entry.isDirectory() ? 'dir' : fs.readFileSync(full)}`);
      if (entry.isDirectory()) walk(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return hash.digest('hex');
}

test('update: bayat skill aynı kurulum yolundan bir kez geçer, kayıt tazelenir ve status razı olur', async () => {
  const home = tempHome();
  const runner = new UpdateRunner(home, ['alpha']);
  const { ctx, advance } = context(home, runner);
  const data = fixture();
  recordInstall(ctx, 'skill-a', CLAUDE, 'alpha');
  writeLock(home, { alpha: lockEntry('fixture/skills') });

  const update = await buildUpdatePlan(data, ctx);

  assert.deepEqual(update.stale.map((row) => row.name), ['alpha']);
  assert.equal(update.plan.entries.length, 1);
  const [entry] = update.plan.entries;
  assert.equal(entry?.itemId, 'skill-a');
  assert.equal(entry?.harness, CLAUDE);
  // The plan alone would say "already installed": the update is the same install path, run on purpose.
  assert.equal(entry?.action, 'run');
  assert.match(entry?.reason ?? '', /alpha/);

  advance();
  const outcome = await applyPlan(data, ctx, update.plan);

  assert.equal(outcome.items[0]?.status, 'ok');
  assert.equal(runner.installs.length, 1, 'skill bir kez kurulmalı');
  assert.deepEqual(runner.installs[0], ['npx', 'skills', 'add', 'fixture/skills', '-g', '-a', CLAUDE, '--skill', 'alpha']);
  assert.equal(recordedAt(ctx, 'skill-a', CLAUDE), T1, 'kayıt tazelenmedi');
  // The record is not evidence: status re-reads the provider's inventory and agrees with it.
  const status = await readStatus(data, ctx);
  assert.equal(status.rows[0]?.value, 'up-to-date');
});

test('update: yalnız bayat işaretlenen skill kurulur, güncel olana dokunulmaz', async () => {
  const home = tempHome();
  const runner = new UpdateRunner(home, ['alpha']);
  const { ctx } = context(home, runner);
  const data = fixture();
  recordInstall(ctx, 'skill-a', CLAUDE, 'alpha');
  recordInstall(ctx, 'skill-b', CLAUDE, 'beta');
  writeLock(home, { alpha: lockEntry('fixture/skills'), beta: lockEntry('fixture/skills') });

  const update = await buildUpdatePlan(data, ctx);
  const outcome = await applyPlan(data, ctx, update.plan);

  assert.deepEqual(update.plan.entries.map((entry) => entry.itemId), ['skill-a']);
  assert.deepEqual(outcome.items.map((item) => item.entry.itemId), ['skill-a']);
  assert.equal(runner.installs.length, 1);
  assert.ok(runner.installs[0]?.includes('alpha'), 'yanlış skill kuruldu');
  assert.equal(recordedAt(ctx, 'skill-b', CLAUDE), T0, 'işaretlenmemiş skill yeniden kuruldu');
});

test('update: bir skill hata verse de diğerleri kurulur, yalnız kurulan kaydedilir', async () => {
  const home = tempHome();
  const runner = new UpdateRunner(home, ['alpha', 'beta'], ['alpha']);
  const { ctx, advance } = context(home, runner);
  const data = fixture();
  recordInstall(ctx, 'skill-a', CLAUDE, 'alpha');
  recordInstall(ctx, 'skill-b', CLAUDE, 'beta');
  writeLock(home, { alpha: lockEntry('fixture/skills'), beta: lockEntry('fixture/skills') });

  advance();
  const outcome = await applyPlan(data, ctx, await buildUpdatePlan(data, ctx).then((update) => update.plan));

  assert.deepEqual(
    outcome.items.map((item) => [item.entry.itemId, item.status]),
    [
      ['skill-a', 'error'],
      ['skill-b', 'ok'],
    ],
  );
  assert.match(outcome.items[0]?.message ?? '', /install failed/);
  assert.equal(runner.installs.length, 2, 'ikinci skill denenmedi');
  assert.equal(exitCodeFor(outcome), 1);
  assert.equal(recordedAt(ctx, 'skill-a', CLAUDE), T0, 'kurulmayan öğe kaydedildi');
  assert.equal(recordedAt(ctx, 'skill-b', CLAUDE), T1);
});

test('update: her harness için ayrı sonuç, her biri bir kez', async () => {
  const home = tempHome();
  const runner = new UpdateRunner(home, ['alpha']);
  const { ctx } = context(home, runner);
  const data = fixture();
  recordInstall(ctx, 'skill-a', CLAUDE, 'alpha');
  recordInstall(ctx, 'skill-a', CODEX, 'alpha');
  writeLock(home, { alpha: lockEntry('fixture/skills') });

  const update = await buildUpdatePlan(data, ctx);
  const outcome = await applyPlan(data, ctx, update.plan);

  assert.deepEqual(update.plan.entries.map((entry) => entry.harness), [CLAUDE, CODEX]);
  assert.deepEqual(
    outcome.items.map((item) => [item.entry.harness, item.status]),
    [
      [CLAUDE, 'ok'],
      [CODEX, 'ok'],
    ],
  );
  const agents = runner.installs.map((argv) => argv[argv.indexOf('-a') + 1]);
  assert.deepEqual(agents, [CLAUDE, CODEX], 'her harness için bir kurulum olmalı');
});

test('update: plan hiçbir şey yazmaz ve hiçbir kurulum çalıştırmaz', async () => {
  const home = tempHome();
  const runner = new UpdateRunner(home, ['alpha']);
  const { ctx } = context(home, runner);
  const data = fixture();
  recordInstall(ctx, 'skill-a', CLAUDE, 'alpha');
  writeLock(home, { alpha: lockEntry('fixture/skills') });
  const before = snapshot(home);

  const update = await buildUpdatePlan(data, ctx);

  assert.equal(update.plan.entries.length, 1);
  assert.equal(snapshot(home), before, 'update planı sandbox ağacını değiştirdi');
  assert.deepEqual(runner.installs, []);
});

test('update: katalogda öğesi olmayan ve kaydı bulunmayan bayat skill sessizce atlanmaz', async () => {
  const home = tempHome();
  const runner = new UpdateRunner(home, ['gamma', 'beta']);
  const { ctx } = context(home, runner);
  const data = fixture();
  writeLock(home, { gamma: lockEntry('other/repo'), beta: lockEntry('fixture/skills') });

  const update = await buildUpdatePlan(data, ctx);

  assert.deepEqual(update.plan.entries, []);
  assert.deepEqual(
    update.skips.map((skip) => skip.reason),
    // rows come back sorted by name: beta (no record) before gamma (no catalogue item)
    [t.updateNoRecord('beta'), t.updateNoItem('gamma')],
  );
  const text = updateLines(update).map((line) => line.text);
  assert.ok(text.includes(`! ${t.updateNoItem('gamma')}`), text.join('\n'));
  assert.ok(text.includes(t.updateNone), text.join('\n'));
});

test('update: sağlayıcı karşılaştırma sunmuyorsa not covered, hiçbir kurulum yok', async () => {
  const home = tempHome();
  const runner = new UpdateRunner(home, ['alpha']);
  const { ctx } = context(home, runner);
  const data = fixture({ check: [] });
  recordInstall(ctx, 'skill-a', CLAUDE, 'alpha');
  writeLock(home, { alpha: lockEntry('fixture/skills') });

  const update = await buildUpdatePlan(data, ctx);

  assert.deepEqual(update.stale, []);
  assert.deepEqual(update.plan.entries, []);
  assert.deepEqual(update.warnings, [t.staleNotCovered]);
  assert.ok(updateLines(update).map((line) => line.text).includes(`! ${t.staleNotCovered}`));
  assert.deepEqual(runner.installs, []);
});

test('update: skills API adaptörü üzerinden yürür ve kaydı yeniler', async () => {
  const home = tempHome();
  const runner = new UpdateRunner(home, ['alpha']);
  const data = fixture();
  data.providers.unshift({
    id: 'skills-api',
    kind: 'skill',
    supports: [CLAUDE, CODEX],
    requires: ['node'],
    priority: 1,
    adapter: 'skills-api',
    verify: { strategy: 'skill-lock', file: '~/.agents/.skill-lock.json' },
  });
  const installs: Array<{ source: string; skills?: string[]; agents: string[] }> = [];
  const { ctx, advance } = context(home, runner, {
    async install({ source, skills, agents }) {
      writeLock(home, { alpha: lockEntry(source) });
      installs.push({ source, skills, agents });
      return { installed: ['alpha'], failed: [] };
    },
  });
  recordInstall(ctx, 'skill-a', CLAUDE, 'alpha');
  writeLock(home, { alpha: lockEntry('fixture/skills') });

  advance();
  const update = await buildUpdatePlan(data, ctx);
  assert.equal(update.plan.entries[0]?.adapter, 'skills-api');
  const outcome = await applyPlan(data, ctx, update.plan);

  assert.equal(outcome.items[0]?.status, 'ok');
  assert.deepEqual(installs, [{ source: 'fixture/skills', skills: ['alpha'], agents: [CLAUDE] }]);
  assert.equal(recordedAt(ctx, 'skill-a', CLAUDE), T1, 'kayıt tazelenmedi');
});

test('update: biçimlendirici planı ve sonucu skill + harness olarak yazar', async () => {
  const home = tempHome();
  const runner = new UpdateRunner(home, ['alpha']);
  const { ctx } = context(home, runner);
  const data = fixture();
  recordInstall(ctx, 'skill-a', CLAUDE, 'alpha');
  writeLock(home, { alpha: lockEntry('fixture/skills') });

  const update: UpdatePlan = await buildUpdatePlan(data, ctx);
  const planText = updateLines(update).map((line) => line.text);
  assert.ok(planText.includes(t.updateTitle), planText.join('\n'));
  assert.ok(planText.some((line) => /skill-a → claude-code/.test(line)), planText.join('\n'));
  assert.ok(planText.includes(t.updateCount(1, 1)), planText.join('\n'));

  const done = updateOutcomeLines(update, await applyPlan(data, ctx, update.plan)).map((line) => line.text);
  assert.ok(done.includes(`${t.applyLabels.ok}  skill-a → claude-code`), done.join('\n'));
});

/** The same data plus a source-level item: it names no skill, so it owns every skill its source holds. */
function withSourceLevel(id = 'skill-all', source = 'fixture/all'): Data {
  const data = fixture();
  data.items.set(id, { id, kind: 'skill' as const, source, targets: '*' as const });
  return data;
}

test('update: kaynak seviyesindeki öğe bayat skill adıyla kurulur, taze olan yeniden kurulmaz', async () => {
  const home = tempHome();
  const runner = new UpdateRunner(home, ['alpha']);
  const { ctx, advance } = context(home, runner);
  const data = withSourceLevel();
  recordInstall(ctx, 'skill-all', CLAUDE, 'alpha');
  writeLock(home, { alpha: lockEntry('fixture/all'), beta: lockEntry('fixture/all') });

  const update = await buildUpdatePlan(data, ctx);

  assert.deepEqual(
    update.plan.entries.map((entry) => [entry.itemId, entry.skills, entry.harness]),
    [['skill-all', ['alpha'], CLAUDE]],
    'bayat skill kaynağındaki öğeye eşlenmedi',
  );
  // The entry carries the skill name, so the provider installs that one skill and not the whole source.
  assert.deepEqual(update.plan.entries[0]?.command, ['npx', 'skills', 'add', 'fixture/all', '-g', '-a', CLAUDE, '--skill', 'alpha']);

  advance();
  const outcome = await applyPlan(data, ctx, update.plan);

  assert.deepEqual(outcome.items.map((item) => item.status), ['ok']);
  assert.equal(runner.installs.length, 1, 'yalnız bayat skill kurulmalı');
  assert.ok(runner.installs[0]?.includes('alpha'), 'bayat skill kurulmadı');
  assert.ok(!runner.installs[0]?.includes('beta'), 'taze skill yeniden kuruldu');
  assert.equal(recordedAt(ctx, 'skill-all', CLAUDE), T1, 'kayıt tazelenmedi');
});

test('update: aynı kaynak seviyesindeki öğenin iki bayat skill i ayrı ayrı kurulur', async () => {
  const home = tempHome();
  const runner = new UpdateRunner(home, ['alpha', 'beta']);
  const { ctx } = context(home, runner);
  const data = withSourceLevel();
  recordInstall(ctx, 'skill-all', CLAUDE, 'alpha');
  writeLock(home, { alpha: lockEntry('fixture/all'), beta: lockEntry('fixture/all') });

  const update = await buildUpdatePlan(data, ctx);
  const outcome = await applyPlan(data, ctx, update.plan);

  assert.deepEqual(
    update.plan.entries.map((entry) => [entry.itemId, entry.skills]),
    [
      ['skill-all', ['alpha']],
      ['skill-all', ['beta']],
    ],
    'her bayat skill kendi girdisini almalı',
  );
  assert.deepEqual(outcome.items.map((item) => item.status), ['ok', 'ok'], 'sonuç skill başına olmalı');
  assert.deepEqual(
    runner.installs.map((argv) => argv[argv.indexOf('--skill') + 1]),
    ['alpha', 'beta'],
    'her bayat skill bir kez kurulmalı',
  );
});

test('update: tek skill adlandıran öğe yalnız o skill i eşler, kaynak seviyesindeki öğe gerisini alır', async () => {
  const home = tempHome();
  const runner = new UpdateRunner(home, ['alpha', 'beta']);
  const { ctx } = context(home, runner);
  const data = withSourceLevel('skill-all', 'fixture/skills');
  data.items.delete('skill-b');
  recordInstall(ctx, 'skill-a', CLAUDE, 'alpha');
  recordInstall(ctx, 'skill-all', CLAUDE, 'beta');
  writeLock(home, { alpha: lockEntry('fixture/skills'), beta: lockEntry('fixture/skills') });

  const update = await buildUpdatePlan(data, ctx);
  const outcome = await applyPlan(data, ctx, update.plan);

  assert.deepEqual(
    update.plan.entries.map((entry) => [entry.itemId, entry.skills]),
    [
      ['skill-a', undefined],
      ['skill-all', ['beta']],
    ],
    'adlandırılmış öğe adıyla, kaynak seviyesindeki öğe kaynağıyla eşleşmeli',
  );
  assert.deepEqual(
    runner.installs.map((argv) => argv[argv.indexOf('--skill') + 1]),
    ['alpha', 'beta'],
  );
  assert.deepEqual(outcome.items.map((item) => item.status), ['ok', 'ok']);
});
