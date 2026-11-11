import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createContext, RecordingRunner, type RunResult, type Runner } from '../src/context.js';
import { applyPlan, exitCodeFor, type ApplyOutcome } from '../src/core/apply.js';
import { detectHarnesses } from '../src/core/detect.js';
import { buildPlan } from '../src/core/plan.js';
import { applyRemovePlan, buildRemovePlan } from '../src/core/remove.js';
import { readStatus } from '../src/core/status.js';
import { findEntry, readState, recordEntry, statePath, type State } from '../src/core/state.js';
import { verifyInstalled } from '../src/core/verify.js';
import { mergeHook, readText } from '../src/apply/hook-merger.js';
import { outcomeLines, planLines } from '../src/render.js';
import { t } from '../src/i18n.js';
import type { Data } from '../src/types.js';
import type { SkillsAdapter } from '../src/providers/skills-api.js';

const HARNESS = 'claude-code';

function fixture(): Data {
  return {
    items: new Map([
      ['sk', { id: 'sk', kind: 'skill' as const, source: 'owner/repo', targets: '*' as const }],
      ['mc', { id: 'mc', kind: 'mcp' as const, url: 'https://mcp.example.com', targets: '*' as const }],
      [
        'hk',
        {
          id: 'hk',
          kind: 'hook' as const,
          event: 'PreToolUse',
          matcher: 'Bash',
          hookCommand: 'echo hi',
          targets: [HARNESS],
        },
      ],
    ]),
    packages: new Map([['base', { id: 'base', items: ['sk', 'mc', 'hk'] }]]),
    harnesses: [
      {
        id: HARNESS,
        detect: ['~/.claude'],
        agentId: HARNESS,
        config: { path: '~/.claude/settings.json', format: 'jsonc' },
        hooks: { path: '~/.claude/settings.json', section: 'hooks.{event}' },
        mcp: { path: '~/.claude.json', key: 'mcpServers' },
      },
    ],
    providers: [
      {
        id: 'skills-cli',
        kind: 'skill',
        supports: [HARNESS],
        requires: ['node'],
        verify: { strategy: 'skill-lock', file: '~/.agents/.skill-lock.json' },
        install: ['npx', 'skills', 'add', '{source}', '-g', '-a', '{agentId}', '--skill {skill}'],
        remove: ['npx', 'skills', 'remove', '-g', '{skill}'],
      },
      {
        id: 'add-mcp',
        kind: 'mcp',
        supports: [HARNESS],
        verify: { strategy: 'json-key' },
        install: ['npx', 'add-mcp', '{package}', '-a', '{agentId}'],
      },
      {
        id: 'builtin-hooks',
        kind: 'hook',
        supports: [HARNESS],
        install: [],
        writes: { path: '{harness.config}', section: 'hooks.{event}' },
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

/** The lockfile entry the skills provider keeps, i.e. the evidence apply and plan verify against. */
function writeSkillLock(home: string, name: string, source: string): void {
  const file = path.join(home, '.agents', '.skill-lock.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, 'utf8')) as { skills: Record<string, { source: string }> })
    : { skills: {} as Record<string, { source: string }> };
  lock.skills[name] = { source };
  fs.writeFileSync(file, JSON.stringify(lock), 'utf8');
}

/**
 * The fake `skills` provider really installs: a successful `skills add` writes the lockfile entry that
 * verification reads. Without it the install leaves no trace and apply must not claim one.
 */
function landSkills(argv: string[], home: string): void {
  if (argv[0] !== 'npx' || argv[1] !== 'skills' || argv[2] !== 'add') return;
  const source = argv[3] ?? 'unknown/source';
  const named = argv.indexOf('--skill');
  const name = named === -1 ? source.replace(/[^\w.-]+/g, '-') : argv[named + 1];
  if (!name) return;
  writeSkillLock(home, name, source);
}

/** A recording runner whose successful `skills add` also writes the lockfile the real provider keeps. */
class InstallingRunner extends RecordingRunner {
  constructor(
    private readonly home: string,
    results: RunResult[] = [],
  ) {
    super(results);
  }

  override async run(argv: string[]) {
    const result = await super.run(argv);
    if (result.code === 0) landSkills(argv, this.home);
    return result;
  }
}

/** The skills-API provider as `providers/skills-api.yaml` declares it: an adapter, no argv. */
function adapterData(): Data {
  const data = fixture();
  data.providers.unshift({
    id: 'skills-api',
    kind: 'skill',
    supports: [HARNESS],
    requires: ['node'],
    priority: 1,
    adapter: 'skills-api',
    install: [],
    verify: { strategy: 'skill-lock', file: '~/.agents/.skill-lock.json' },
  });
  data.items.get('sk')!.skill = 'alpha';
  return data;
}

/** A context whose skills API is a stub: the adapter surface is injected, never the network. */
function adapterContext(home: string, skills: Partial<SkillsAdapter>) {
  const runner: Runner = {
    async run(argv: string[]) {
      return argv.join(' ') === 'node --version'
        ? { code: 0, stdout: 'v22.1.0', stderr: '' }
        : { code: 0, stdout: '', stderr: '' };
    },
  };
  const ctx = createContext({
    root: process.cwd(),
    home,
    runner,
    platform: 'linux',
    skills: {
      install: async () => ({ installed: [], failed: [] }),
      remove: async () => ({ removed: [], notFound: [], failed: [] }),
      list: async () => [],
      ...skills,
    },
  });
  return ctx;
}

function setup(home: string, results: RunResult[] = []) {
  const runner = new InstallingRunner(home, [
    { code: 0, stdout: 'v22.1.0', stderr: '' },
    { code: 0, stdout: '', stderr: '' },
    { code: 0, stdout: '', stderr: '' },
    ...results,
  ]);
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });
  return { ctx, runner };
}

/** The harness definition declares its own minimum version, and that minimum is data (`check.min`). */
function withHarnessRequirement(): Data {
  const data = fixture();
  data.harnesses[0]!.requires = [HARNESS];
  data.requires.push({
    id: HARNESS,
    check: { command: ['claude', '--version'], min: '2.0' },
    install: {
      win32: ['npm', 'install', '-g', '@fake/harness'],
      darwin: ['npm', 'install', '-g', '@fake/harness'],
      linux: ['npm', 'install', '-g', '@fake/harness'],
    },
  });
  return data;
}

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-test-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  return home;
}

test('detect: config klasörü veya binary', () => {
  const home = tempHome();
  const { ctx } = setup(home);
  const data = fixture();
  assert.equal(detectHarnesses(data, ctx)[0]?.present, true);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-empty-'));
  assert.equal(detectHarnesses(data, setup(empty).ctx)[0]?.present, false);
});

test('plan: her öğe için sağlayıcı ve komut üretir, {skill} boşsa düşer', async () => {
  const home = tempHome();
  const { ctx } = setup(home);
  const plan = await buildPlan(fixture(), ctx, { harnessIds: [HARNESS], itemIds: ['sk', 'mc', 'hk'] });

  assert.equal(plan.entries.length, 3);
  assert.deepEqual(plan.entries[0]?.command, ['npx', 'skills', 'add', 'owner/repo', '-g', '-a', HARNESS]);
  assert.deepEqual(plan.entries[1]?.command, ['npx', 'add-mcp', 'https://mcp.example.com', '-a', HARNESS]);
  assert.equal(plan.entries[2]?.action, 'run');
  const added = JSON.stringify(plan.entries[2]?.hook?.entry ?? {});
  assert.match(added, /"matcher":"Bash"/);
  assert.match(added, /echo hi/);
  assert.equal(plan.requirements[0]?.present, true);
});

test('plan: sağlayıcı yoksa kapsanmıyor, sessizce atlanmıyor', async () => {
  const home = tempHome();
  const { ctx } = setup(home);
  const data = fixture();
  data.providers = data.providers.filter((provider) => provider.kind !== 'mcp');
  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['mc'] });
  assert.equal(plan.entries[0]?.action, 'unsupported');
});

test('plan: hedef listesinde olmayan harness atlanır', async () => {
  const home = tempHome();
  const { ctx } = setup(home);
  const data = fixture();
  data.harnesses.push({
    ...data.harnesses[0]!,
    id: 'other',
    detect: ['~/.other'],
  });
  const plan = await buildPlan(data, ctx, { harnessIds: ['other'], itemIds: ['hk'] });
  assert.equal(plan.entries.length, 0);
});

test('apply: üç türü yazar, yedek alır, kaydı tutar; ikinci çalıştırma hiçbir şey yapmaz', async () => {
  const home = tempHome();
  const settings = path.join(home, '.claude', 'settings.json');
  fs.writeFileSync(settings, '{\n  // not\n  "model": "opus"\n}\n', 'utf8');

  const data = fixture();
  const { ctx, runner } = setup(home);
  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk', 'mc', 'hk'] });
  const outcome = await applyPlan(data, ctx, plan);

  assert.deepEqual(
    outcome.items.map((item) => item.status),
    ['ok', 'ok', 'ok'],
  );
  assert.deepEqual(runner.calls.slice(1), [
    ['npx', 'skills', 'add', 'owner/repo', '-g', '-a', HARNESS],
    ['npx', 'add-mcp', 'https://mcp.example.com', '-a', HARNESS],
  ]);

  const written = fs.readFileSync(settings, 'utf8');
  assert.match(written, /\/\/ not/);
  assert.match(written, /"PreToolUse"/);

  const backups = fs.readdirSync(path.join(home, '.agentenv', 'backups'));
  assert.equal(backups.length, 1);

  assert.equal(readState(ctx).state.entries.length, 3);
  assert.ok(fs.existsSync(statePath(ctx)));
  // The skill provider wrote its lockfile, so the skill really is up-to-date; MCP has not been told yet.
  assert.deepEqual(
    (await readStatus(data, ctx)).rows.map((row) => row.value),
    ['up-to-date', 'missing', 'up-to-date'],
  );

  // the harness config now carries the MCP server too
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { mc: {} } }), 'utf8');

  const replan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk', 'mc', 'hk'] });
  assert.deepEqual(
    replan.entries.map((entry) => entry.action),
    ['already', 'already', 'already'],
  );
  const second = await applyPlan(data, ctx, replan);
  assert.deepEqual(
    second.items.map((item) => item.status),
    ['already', 'already', 'already'],
  );
  assert.equal(fs.readFileSync(settings, 'utf8'), written);
});

test('apply: komut hata verirse o öğe hata, akış durmaz', async () => {
  const home = tempHome();
  const data = fixture();
  const runner = new RecordingRunner([
    { code: 0, stdout: 'v22.1.0', stderr: '' },
    { code: 1, stdout: '', stderr: 'kaynak bulunamadı' },
    { code: 0, stdout: '', stderr: '' },
  ]);
  const failing = createContext({ root: process.cwd(), home, runner, platform: 'linux' });

  const plan = await buildPlan(data, failing, { harnessIds: [HARNESS], itemIds: ['sk', 'mc', 'hk'] });
  const outcome = await applyPlan(data, failing, plan);

  assert.equal(outcome.items[0]?.status, 'error');
  assert.equal(outcome.items[0]?.message, 'kaynak bulunamadı');
  assert.equal(outcome.items[1]?.status, 'ok');
  assert.equal(outcome.items[2]?.status, 'ok');
  assert.equal(readState(failing).state.entries.length, 2);
});

test('apply: bozuk settings.json hiç yazılmaz', async () => {
  const home = tempHome();
  const settings = path.join(home, '.claude', 'settings.json');
  fs.writeFileSync(settings, '{ bozuk', 'utf8');
  const data = fixture();
  const { ctx } = setup(home);

  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['hk'] });
  assert.equal(plan.entries[0]?.action, 'error');
  assert.equal(plan.entries[0]?.reason, t.hookTargetUnreadable);

  const outcome = await applyPlan(data, ctx, plan);
  assert.equal(outcome.items[0]?.status, 'error');
  assert.equal(fs.readFileSync(settings, 'utf8'), '{ bozuk');
});

test('apply: hook appears between plan and apply -> already is recorded for later replacement', async () => {
  const home = tempHome();
  const settings = path.join(home, '.claude', 'settings.json');
  const data = fixture();
  const { ctx } = setup(home);

  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['hk'] });
  assert.equal(plan.entries[0]?.action, 'run');

  const target = plan.entries[0]!.hook!.target;
  fs.writeFileSync(settings, mergeHook(readText(target.file), target.path, target.spec).text, 'utf8');

  const outcome = await applyPlan(data, ctx, plan);
  assert.equal(outcome.items[0]?.status, 'already');
  assert.equal(findEntry(readState(ctx).state, 'hk', HARNESS)?.hookCommand, 'echo hi');
});

test('apply: a command that throws is reported as an error, not a rejected plan', async () => {
  const home = tempHome();
  const data = fixture();
  const { ctx } = setup(home);
  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk', 'hk'] });

  ctx.runner = {
    run: async () => {
      throw new Error('boom');
    },
  };
  const outcome = await applyPlan(data, ctx, plan);

  assert.equal(outcome.items[0]?.status, 'error');
  assert.equal(outcome.items[0]?.message, 'boom');
  assert.equal(outcome.items[1]?.status, 'ok');
  assert.equal(exitCodeFor(outcome), 1);
});

test('apply: an install command that throws blocks dependents instead of rejecting', async () => {
  const home = tempHome();
  const data = fixture();
  const runner = new RecordingRunner([{ code: 1, stdout: '', stderr: '' }]);
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });
  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk', 'hk'] });
  assert.equal(plan.requirements[0]?.present, false);

  ctx.runner = {
    run: async () => {
      throw new Error('install boom');
    },
  };
  const outcome = await applyPlan(data, ctx, plan);

  assert.equal(outcome.requirements[0]?.ok, false);
  assert.match(outcome.requirements[0]?.message ?? '', /install boom/);
  assert.equal(outcome.items[0]?.status, 'error');
  assert.equal(outcome.items[1]?.status, 'ok');
});

test('bootstrap: kurulumdan sonra hâlâ eksikse bağımlı öğe çalıştırılmaz', async () => {
  const home = tempHome();
  const data = fixture();
  const runner = new RecordingRunner([
    { code: 1, stdout: '', stderr: '' },
    { code: 0, stdout: '', stderr: '' },
    { code: 1, stdout: '', stderr: '' },
  ]);
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });

  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk', 'hk'] });
  assert.equal(plan.requirements[0]?.present, false);

  const outcome = await applyPlan(data, ctx, plan);

  assert.equal(outcome.requirements[0]?.ok, false);
  assert.equal(outcome.items[0]?.status, 'error');
  assert.match(outcome.items[0]?.message ?? '', /node/);
  assert.equal(outcome.items[1]?.status, 'ok');
  assert.deepEqual(runner.calls, [
    ['node', '--version'],
    ['install-node'],
    ['node', '--version'],
  ]);
});

test('bootstrap: yeniden kontrol min sürümü de uygular', async () => {
  const home = tempHome();
  const data = fixture();
  const runner = new RecordingRunner([
    { code: 0, stdout: 'v18.4.0', stderr: '' },
    { code: 0, stdout: '', stderr: '' },
    { code: 0, stdout: 'v18.4.0', stderr: '' },
  ]);
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });

  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] });
  assert.equal(plan.requirements[0]?.present, false);

  const outcome = await applyPlan(data, ctx, plan);

  assert.equal(outcome.requirements[0]?.ok, false);
  assert.equal(outcome.items[0]?.status, 'error');
});

test('bozuk state.json: plan dosya yazmaz, apply ezmeden önce yedekler', async () => {
  const home = tempHome();
  const data = fixture();
  const { ctx } = setup(home);
  fs.mkdirSync(path.join(home, '.agentenv'), { recursive: true });
  fs.writeFileSync(path.join(home, '.agentenv', 'state.json'), '{ bozuk', 'utf8');
  const selection = { harnessIds: [HARNESS], itemIds: ['hk'] };

  const plan = await buildPlan(data, ctx, selection);
  await readStatus(data, ctx);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0] ?? '', /state\.json/);
  assert.equal(fs.existsSync(path.join(home, '.agentenv', 'backups')), false, 'plan/status yazmamalı');

  await applyPlan(data, ctx, plan);

  const backups = fs.readdirSync(path.join(home, '.agentenv', 'backups'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(home, '.agentenv', 'backups', backups[0]!, 'state.json'), 'utf8'), '{ bozuk');
  assert.equal(readState(ctx).state.entries.length, 1);
});

test('unreadable state.json warns without claiming a backup in plan, and backup path in apply', async () => {
  const home = tempHome();
  const data = fixture();
  const { ctx } = setup(home);
  fs.mkdirSync(path.dirname(statePath(ctx)), { recursive: true });
  fs.writeFileSync(statePath(ctx), '{ garbage', 'utf8');
  const selection = { harnessIds: [HARNESS], itemIds: ['hk'] };

  const plan = await buildPlan(data, ctx, selection);
  assert.ok(plan.warnings.includes(t.stateUnreadable(statePath(ctx))));
  assert.match(plan.warnings[0] ?? '', /will try to back it up/);
  assert.equal(fs.existsSync(path.join(home, '.agentenv', 'backups')), false);

  const outcome = await applyPlan(data, ctx, plan);

  const backups = path.join(home, '.agentenv', 'backups');
  const stamp = fs.readdirSync(backups)[0]!;
  const copy = path.join(backups, stamp, 'state.json');
  const stateWarnings = outcome.warnings.filter((warning) => warning.includes('state.json'));
  assert.deepEqual(stateWarnings, [t.stateBackedUp(statePath(ctx), copy)]);
  assert.equal(fs.readFileSync(copy, 'utf8'), '{ garbage');
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(statePath(ctx), 'utf8')));
});

test('unreadable (not corrupt) state.json: plan does not promise a backup', async () => {
  const home = tempHome();
  const data = fixture();
  const { ctx } = setup(home);
  fs.mkdirSync(statePath(ctx), { recursive: true });
  const selection = { harnessIds: [HARNESS], itemIds: ['hk'] };

  const plan = await buildPlan(data, ctx, selection);
  assert.ok(plan.warnings.length >= 1);
  assert.match(plan.warnings[0] ?? '', /state\.json/);
  assert.doesNotMatch(plan.warnings[0] ?? '', /back it up/);
});

test('state.json unreadable: apply still runs items, does not record, and warns', async () => {
  const home = tempHome();
  const data = fixture();
  const { ctx } = setup(home);
  fs.mkdirSync(statePath(ctx), { recursive: true });
  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['hk'] });

  const outcome = await applyPlan(data, ctx, plan);

  assert.equal(outcome.items[0]?.status, 'ok');
  assert.match(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), /echo hi/);
  assert.equal(fs.statSync(statePath(ctx)).isDirectory(), true);
  const stateWarnings = outcome.warnings.filter((warning) => warning.includes('state.json'));
  assert.equal(stateWarnings.length, 1);
  assert.ok(stateWarnings[0]?.startsWith(`state.json at ${statePath(ctx)} could not be backed up or read`));
  assert.equal(fs.existsSync(path.join(home, '.agentenv', 'backups')), false);
});

test('corrupt state.json whose backup fails: apply still runs, does not record', async () => {
  const home = tempHome();
  const data = fixture();
  const { ctx } = setup(home);
  fs.mkdirSync(path.dirname(statePath(ctx)), { recursive: true });
  fs.writeFileSync(statePath(ctx), '{ garbage', 'utf8');
  fs.writeFileSync(path.join(home, '.agentenv', 'backups'), 'not a directory', 'utf8');
  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['hk'] });

  const outcome = await applyPlan(data, ctx, plan);

  assert.equal(outcome.items[0]?.status, 'ok');
  assert.match(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), /echo hi/);
  assert.equal(fs.readFileSync(statePath(ctx), 'utf8'), '{ garbage');
  const stateWarnings = outcome.warnings.filter((warning) => warning.includes('state.json'));
  assert.equal(stateWarnings.length, 1);
  assert.ok(stateWarnings[0]?.startsWith(`state.json at ${statePath(ctx)} could not be backed up or read`));
  assert.equal(fs.statSync(path.join(home, '.agentenv', 'backups')).isFile(), true);
});

test('missing state.json yields no warning', async () => {
  const home = tempHome();
  const data = fixture();
  const { ctx } = setup(home);
  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['hk'] });
  assert.deepEqual(plan.warnings, []);
  const read = readState(ctx);
  assert.equal(read.warning, undefined);
  assert.equal(read.damaged, undefined);
});

test('verify: MCP serverName tanımlıysa gerçekten o anahtara bakar', () => {
  const home = tempHome();
  const data = fixture();
  const { ctx } = setup(home);
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { other: {} } }), 'utf8');
  const item = { ...data.items.get('mc')!, serverName: 'real-name' };
  assert.equal(verifyInstalled(data.harnesses[0]!, item, data.providers.find((p) => p.id === 'add-mcp'), ctx), 'missing');
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { 'real-name': {} } }), 'utf8');
  assert.equal(verifyInstalled(data.harnesses[0]!, item, data.providers.find((p) => p.id === 'add-mcp'), ctx), 'present');
});

test('verify: skill adı verilmişse aynı repodan başka skill kanıt değildir', () => {
  const home = tempHome();
  const data = fixture();
  const { ctx } = setup(home);
  fs.mkdirSync(path.join(home, '.agents'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.agents', '.skill-lock.json'),
    JSON.stringify({ skills: { other: { source: 'owner/repo' } } }),
    'utf8',
  );
  const item = { ...data.items.get('sk')!, skill: 'wanted' };
  assert.equal(verifyInstalled(data.harnesses[0]!, item, data.providers.find((p) => p.id === 'skills-cli'), ctx), 'missing');
});

test('plan: bilinmeyen platformda linux yükleyicisine düşmez', async () => {
  const home = tempHome();
  const data = fixture();
  const { ctx } = setup(home);
  const exotic = createContext({ root: process.cwd(), home, runner: ctx.runner, platform: 'aix' as NodeJS.Platform });

  const plan = await buildPlan(data, exotic, { harnessIds: [HARNESS], itemIds: ['sk'] });

  assert.equal(plan.requirements[0]?.installCommand, undefined);
});

test('already: kayıt var ama skill-lock hedefte yoksa yeniden kurar', async () => {
  const home = tempHome();
  const data = fixture();
  data.providers.find((p) => p.id === 'skills-cli')!.verify = { strategy: 'skill-lock', file: '~/.agents/.skill-lock.json' };
  const { ctx } = setup(home);

  const installed = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] });
  await applyPlan(data, ctx, installed);

  // the lockfile entry is gone (the user deleted the skill by hand) → really not installed
  fs.rmSync(path.join(home, '.agents', '.skill-lock.json'));
  const missing = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] });
  assert.equal(missing.entries[0]?.action, 'run');
  assert.match(missing.entries[0]?.reason ?? '', /not found/);

  // lock dosyası kaynağı gösteriyor → zaten kurulu
  fs.mkdirSync(path.join(home, '.agents'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.agents', '.skill-lock.json'),
    JSON.stringify({ skills: { other: { source: 'owner/repo' } } }),
    'utf8',
  );
  const present = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] });
  assert.equal(present.entries[0]?.action, 'already');
});

test('hook: komut değişince eski girdi yerinde değişir, ikinci girdi kalmaz', async () => {
  const home = tempHome();
  const data = fixture();
  const settings = path.join(home, '.claude', 'settings.json');
  const { ctx } = setup(home);

  await applyPlan(data, ctx, await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['hk'] }));

  const hook = data.items.get('hk')!;
  hook.hookCommand = 'echo bye';

  const replan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['hk'] });
  assert.equal(replan.entries[0]?.action, 'run');
  await applyPlan(data, ctx, replan);

  const parsed = JSON.parse(fs.readFileSync(settings, 'utf8')) as {
    hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> };
  };
  assert.equal(parsed.hooks.PreToolUse.length, 1);
  assert.equal(parsed.hooks.PreToolUse[0]?.hooks[0]?.command, 'echo bye');
});

test('hook: eksik alan (matcher) sessizce boş yazılmaz, hata olur', async () => {
  const home = tempHome();
  const data = fixture();
  const hook = data.items.get('hk')!;
  hook.matcher = '';

  const plan = await buildPlan(data, setup(home).ctx, { harnessIds: [HARNESS], itemIds: ['hk'] });

  assert.equal(plan.entries[0]?.action, 'error');
  assert.match(plan.entries[0]?.reason ?? '', /hk/);
});

test('status: doğrulanabilen sağlayıcı için gerçeği söyler', async () => {
  const home = tempHome();
  const data = fixture();
  data.providers.find((p) => p.id === 'skills-cli')!.verify = { strategy: 'skill-lock', file: '~/.agents/.skill-lock.json' };
  const { ctx } = setup(home, [{ code: 0, stdout: 'v22.1.0', stderr: '' }, { code: 0, stdout: 'v22.1.0', stderr: '' }]);

  await applyPlan(data, ctx, await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk', 'mc'] }));

  // the skill file was deleted by hand: the record still lists it, the lockfile no longer does
  fs.rmSync(path.join(home, '.agents', '.skill-lock.json'));
  const before = (await readStatus(data, ctx)).rows.map((row) => row.value);
  assert.equal(before[0], 'missing', 'lock yok → eksik');

  await applyPlan(data, ctx, await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] }));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { mc: {} } }), 'utf8');

  const after = (await readStatus(data, ctx)).rows.map((row) => row.value);
  assert.deepEqual(after, ['up-to-date', 'up-to-date']);
});

test('status: harness bölümü sürümü ve asgari sürümü gösterir', async () => {
  const home = tempHome();
  const runner = new RecordingRunner([{ code: 0, stdout: '2.5.0 (Claude Code)', stderr: '' }]);
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });

  const report = await readStatus(withHarnessRequirement(), ctx);
  const harness = report.harnesses[0];

  assert.equal(harness?.present, true, 'kurulu harness yok sayıldı');
  assert.equal(harness?.version, '2.5.0', 'sürüm CLI çıktısından okunmadı');
  assert.equal(harness?.minimum, '2.0');
  assert.equal(harness?.usable, true);
  assert.equal(harness?.updateCommand, undefined, 'güncel harness için güncelleme önerilmemeli');
  assert.deepEqual(runner.calls, [['claude', '--version']]);
});

test('status: asgari sürümün altındaki harness güncelleme komutunu önerir', async () => {
  const home = tempHome();
  const runner = new RecordingRunner([{ code: 0, stdout: '1.4.0', stderr: '' }]);
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });

  const harness = (await readStatus(withHarnessRequirement(), ctx)).harnesses[0];

  assert.equal(harness?.present, true);
  assert.equal(harness?.version, '1.4.0');
  assert.equal(harness?.usable, false, 'asgari sürümün altı kullanılabilir sayıldı');
  assert.deepEqual(harness?.updateCommand, ['npm', 'install', '-g', '@fake/harness']);
});

test('status: bulunmayan harness yok olarak görünür, sürüm komutu çalıştırılmaz', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-empty-'));
  const runner = new RecordingRunner([{ code: 0, stdout: '2.5.0', stderr: '' }]);
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });

  const harness = (await readStatus(withHarnessRequirement(), ctx)).harnesses[0];

  assert.equal(harness?.present, false);
  assert.equal(harness?.version, undefined);
  assert.deepEqual(runner.calls, [], 'bulunmayan harness için sürüm komutu çalıştırıldı');
});

test('status: hiçbir şey yazmaz — geçici ev ve kayıt değişmeden kalır', async () => {
  const home = tempHome();
  const settings = path.join(home, '.claude', 'settings.json');
  fs.writeFileSync(settings, '{\n  // not\n  "model": "opus"\n}\n', 'utf8');
  const runner = new RecordingRunner([
    { code: 0, stdout: '1.4.0', stderr: '' },
    { code: 0, stdout: '1.4.0', stderr: '' },
  ]);
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });
  const before = fs.readdirSync(home, { recursive: true }).sort();

  await readStatus(withHarnessRequirement(), ctx);

  assert.deepEqual(fs.readdirSync(home, { recursive: true }).sort(), before);
  assert.equal(fs.readFileSync(settings, 'utf8'), '{\n  // not\n  "model": "opus"\n}\n');
  assert.equal(fs.existsSync(path.join(home, '.agentenv')), false, 'status kayıt dizini oluşturdu');
});

test('hook elle yazılmışsa apply komutunu kaydeder; sonraki değişiklik eskisini yerinde değiştirir', async () => {
  const home = tempHome();
  const data = fixture();
  const { ctx } = setup(home);
  const settings = path.join(home, '.claude', 'settings.json');
  fs.writeFileSync(
    settings,
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] } }),
    'utf8',
  );
  const selection = { harnessIds: [HARNESS], itemIds: ['hk'] };

  const first = await buildPlan(data, ctx, selection);
  assert.equal(first.entries[0]?.action, 'already');
  await applyPlan(data, ctx, first);
  assert.equal(readState(ctx).state.entries[0]?.hookCommand, 'echo hi');

  data.items.set('hk', { ...data.items.get('hk')!, hookCommand: 'echo new' });
  assert.equal((await readStatus(data, ctx)).rows[0]?.value, 'missing');
  await applyPlan(data, ctx, await buildPlan(data, ctx, selection));
  const written = JSON.parse(fs.readFileSync(settings, 'utf8')) as {
    hooks: { PreToolUse: { hooks: { command: string }[] }[] };
  };
  assert.deepEqual(written.hooks.PreToolUse.map((group) => group.hooks[0]?.command), ['echo new']);
});

test('apply: state write failure after a successful install does not lose the report', async () => {
  const home = tempHome();
  const data = fixture();
  const { ctx } = setup(home);
  fs.mkdirSync(`${statePath(ctx)}.tmp`, { recursive: true });
  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] });

  const outcome = await applyPlan(data, ctx, plan);

  assert.equal(outcome.items[0]?.status, 'ok');
  const stateWarnings = outcome.warnings.filter((warning) => warning.includes('state.json'));
  assert.equal(stateWarnings.length, 1);
  assert.ok(stateWarnings[0]?.includes(statePath(ctx)));
});

test('apply: hook written but state record fails stays ok', async () => {
  const home = tempHome();
  const data = fixture();
  const { ctx } = setup(home);
  fs.mkdirSync(`${statePath(ctx)}.tmp`, { recursive: true });
  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['hk'] });

  const outcome = await applyPlan(data, ctx, plan);

  assert.equal(outcome.items[0]?.status, 'ok');
  assert.match(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), /echo hi/);
  assert.equal(outcome.warnings.filter((warning) => warning.includes('state.json')).length, 1);
});

test('exitCodeFor: failed item gives 1, warnings alone give 0', async () => {
  const data = fixture();
  const { ctx } = setup(tempHome());
  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] });
  const entry = plan.entries[0]!;

  const clean: ApplyOutcome = {
    requirements: [{ id: 'node', ok: true }],
    items: [
      { entry, status: 'ok' },
      { entry, status: 'already' },
      { entry, status: 'unsupported' },
    ],
    warnings: ['something to note'],
  };
  assert.equal(exitCodeFor(clean), 0);
  assert.equal(exitCodeFor({ ...clean, items: [...clean.items, { entry, status: 'error', message: 'x' }] }), 1);
  assert.equal(exitCodeFor({ ...clean, requirements: [{ id: 'node', ok: false }] }), 1);
});

test('findEntry matches on itemId and harness together and exposes the recorded hookCommand', () => {
  const state: State = {
    version: 1,
    entries: [
      { itemId: 'hk', kind: 'hook', harness: HARNESS, providerId: 'p', hookCommand: 'echo hi', at: 'now' },
      { itemId: 'sk', kind: 'skill', harness: 'other', providerId: 'p', at: 'now' },
    ],
  };
  assert.equal(findEntry(state, 'hk', HARNESS)?.hookCommand, 'echo hi');
  assert.equal(findEntry(state, 'hk', 'other'), undefined);
  assert.equal(findEntry(state, 'sk', HARNESS), undefined);
  assert.equal(findEntry(state, 'nope', 'nope'), undefined);
});

test('harness bir ön koşulsa plan onu da listeler ve uygular', async () => {
  const home = tempHome();
  const data = fixture();
  data.harnesses[0]!.requires = ['fake-harness'];
  data.requires.push({
    id: 'fake-harness',
    check: { command: ['ghost-harness', '--version'] },
    install: { linux: ['node', '-e', 'process.exit(0)'], darwin: ['node', '-e', 'process.exit(0)'], win32: ['node', '-e', 'process.exit(0)'] },
  });
  const runner = new RecordingRunner([
    { code: 0, stdout: 'v22.1.0', stderr: '' },
    { code: 1, stdout: '', stderr: '' },
    { code: 0, stdout: '', stderr: '' },
    { code: 1, stdout: '', stderr: '' },
  ]);
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });

  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] });
  const harnessRequirement = plan.requirements.find((requirement) => requirement.id === 'fake-harness');
  assert.ok(harnessRequirement, 'harness ön koşulu planda yok');
  assert.equal(harnessRequirement.present, false);
  assert.deepEqual(harnessRequirement.installCommand, ['node', '-e', 'process.exit(0)']);

  const outcome = await applyPlan(data, ctx, plan);
  assert.equal(outcome.requirements.find((r) => r.id === 'fake-harness')?.ok, false);
  assert.equal(outcome.items[0]?.status, 'error');
});

test('verify: codex MCP girdisi TOML config içinde okunur', () => {
  const home = tempHome();
  const { ctx } = setup(home);
  const data = fixture();
  const codex = {
    id: 'codex',
    detect: ['~/.codex'],
    agentId: 'codex',
    config: { path: '~/.codex/config.toml', format: 'toml' as const },
    mcp: { path: '~/.codex/config.toml', key: 'mcp_servers', format: 'toml' as const },
  };
  const provider = { ...data.providers[1]!, supports: ['codex'] };
  const item = data.items.get('mc')!;

  assert.equal(verifyInstalled(codex, item, provider, ctx), 'missing', 'dosya yokken eksik olmalı');

  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), '[mcp_servers.mc]\ncommand = "x"\n', 'utf8');
  assert.equal(verifyInstalled(codex, item, provider, ctx), 'present');

  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), '[features]\nx = 1\n', 'utf8');
  assert.equal(verifyInstalled(codex, item, provider, ctx), 'missing');
});

test('remove: planlanmışken state bozulursa yedekleyip öyle yazar', async () => {
  const home = tempHome();
  const data = fixture();
  data.items.get('sk')!.skill = 'alpha';
  const { ctx } = setup(home);
  await applyPlan(data, ctx, await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] }));

  const plan = buildRemovePlan(data, ctx);
  assert.equal(plan.entries.length, 1);

  fs.writeFileSync(path.join(home, '.agentenv', 'state.json'), '{ bozuk', 'utf8');
  const outcome = await applyRemovePlan(data, ctx, plan);

  assert.equal(outcome.results[0]?.status, 'removed');
  const backups = fs.readdirSync(path.join(home, '.agentenv', 'backups')).filter((stamp) => stamp.includes('T'));
  const stateBackup = backups
    .map((stamp) => path.join(home, '.agentenv', 'backups', stamp, 'state.json'))
    .find((file) => fs.existsSync(file));
  assert.ok(stateBackup, 'bozuk state yedeklenmedi');
  assert.equal(fs.readFileSync(stateBackup, 'utf8'), '{ bozuk');
});

test('remove: etkilenen skill dizinleri harness tanımından gelir', async () => {
  const home = tempHome();
  const data = fixture();
  data.harnesses[0]!.skills = { path: '~/.fake/skills' };
  data.items.get('sk')!.skill = 'alpha';
  const { ctx } = setup(home);
  await applyPlan(data, ctx, await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] }));

  const plan = buildRemovePlan(data, ctx);
  const paths = plan.entries[0]?.paths ?? [];

  assert.ok(
    paths.some((entry) => entry.endsWith(path.join('.fake', 'skills'))),
    `harness skill dizini yok: ${paths.join(', ')}`,
  );
  assert.ok(paths.every((entry) => !entry.startsWith('~')), 'yol açılmamış');
});

test('adapter: plan/apply/remove skills API üzerinden yürür', async () => {
  const home = tempHome();
  const data = adapterData();
  const installed: Array<{ name: string; source?: string; agents: string[] }> = [];
  const removedCalls: Array<{ names: string[]; agents?: string[] }> = [];
  const ctx = adapterContext(home, {
    async install({ source, agents }) {
      // The real package writes the lockfile; ours must too, or the install left no trace.
      writeSkillLock(home, 'alpha', source);
      installed.push({ name: 'alpha', source, agents });
      return { installed: ['alpha'], failed: [] };
    },
    async remove({ names, agents }) {
      removedCalls.push({ names, agents });
      return { removed: names, notFound: [], failed: [] };
    },
    async list() {
      return installed;
    },
  });

  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] });
  assert.equal(plan.entries[0]?.adapter, 'skills-api');
  // Core carries the values, i18n owns the sentence, the renderer prints it.
  const via = { source: 'owner/repo', skill: 'alpha', agent: HARNESS };
  assert.deepEqual(plan.entries[0]?.via, via);
  assert.ok(
    planLines(plan).some((line) => line.text === `    ${t.runPrefix}: ${t.adapterVia(via)}`),
    'plan satırı adaptörün ne yapacağını yazmıyor',
  );

  assert.equal((await applyPlan(data, ctx, plan)).items[0]?.status, 'ok');
  assert.equal(installed.length, 1);

  // the lockfile the provider just wrote is the plan-time evidence: nothing left to do
  const replan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] });
  assert.equal(replan.entries[0]?.action, 'already');
  const stateBefore = fs.readFileSync(statePath(ctx), 'utf8');
  assert.equal((await applyPlan(data, ctx, replan)).items[0]?.status, 'already');
  assert.equal(fs.readFileSync(statePath(ctx), 'utf8'), stateBefore, 'ikinci çalıştırma kaydı yeniden yazdı');

  const removal = buildRemovePlan(data, ctx);
  assert.equal(removal.entries[0]?.adapter, 'skills-api');
  assert.equal((await applyRemovePlan(data, ctx, removal)).results[0]?.status, 'removed');
  assert.deepEqual(removedCalls[0]?.names, ['alpha']);
  assert.equal(removedCalls[0]?.agents, undefined, 'kaldırma agent filtresi kullanmamalı');
});

test('apply: kurulum komutu 0 dönse de iz bırakmadıysa "installed" denmez ve kaydedilmez', async () => {
  const home = tempHome();
  const data = fixture();
  // Exits 0 without writing anything: the provider claims success, its inventory does not confirm it.
  const runner = new RecordingRunner([
    { code: 0, stdout: 'v22.1.0', stderr: '' },
    { code: 0, stdout: '', stderr: '' },
  ]);
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });

  const outcome = await applyPlan(data, ctx, await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] }));

  assert.equal(outcome.items[0]?.status, 'error');
  assert.equal(outcome.items[0]?.message, t.installNotVerified);
  assert.equal(exitCodeFor(outcome), 1);
  assert.equal(readState(ctx).state.entries.length, 0, 'kurulmayan öğe kaydedildi');
  assert.deepEqual((await readStatus(data, ctx)).rows, [], 'kayıt olmayan kurulumu bildirdi');
});

test('adapter: envanter göstermezse "installed" denmez ve kaydedilmez', async () => {
  const home = tempHome();
  const data = adapterData();
  const ctx = adapterContext(home, {
    install: async () => ({ installed: ['alpha'], failed: [] }),
  });

  const outcome = await applyPlan(data, ctx, await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] }));

  assert.equal(outcome.items[0]?.status, 'error');
  assert.equal(outcome.items[0]?.message, t.installNotVerified);
  assert.equal(readState(ctx).state.entries.length, 0, 'kurulmayan öğe kaydedildi');
  assert.equal(fs.existsSync(path.join(home, '.agents', '.skill-lock.json')), false);
});

test('adapter: "already installed" yalnız envanter doğruladığında söylenir', async () => {
  const home = tempHome();
  const data = adapterData();
  const ctx = adapterContext(home, {
    install: async () => ({ installed: [], failed: [] }),
  });
  const selection = { harnessIds: [HARNESS], itemIds: ['sk'] };

  // Nothing to install and no lockfile entry: the skill is not there, so nothing was "already".
  const nothing = await applyPlan(data, ctx, await buildPlan(data, ctx, selection));
  assert.equal(nothing.items[0]?.status, 'error');
  assert.equal(nothing.items[0]?.message, t.nothingToInstall);
  assert.equal(exitCodeFor(nothing), 1);

  // The lockfile now lists it: the inventory is the evidence, and the run does not invent a record.
  writeSkillLock(home, 'alpha', 'owner/repo');
  const already = await applyPlan(data, ctx, await buildPlan(data, ctx, selection));
  assert.equal(already.items[0]?.status, 'already');
  assert.equal(readState(ctx).state.entries.length, 0, 'zaten kurulu öğe bizim kurulumumuz gibi kaydedildi');
});

test('plan: agentenv dışında kurulmuş skill "recorded as installed" demez', async () => {
  const home = tempHome();
  const data = adapterData();
  const ctx = adapterContext(home, {});
  // Kurulu ama bizim kaydımız yok: envanter var, kayıt yok.
  writeSkillLock(home, 'alpha', 'owner/repo');

  const outside = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] });
  assert.equal(outside.entries[0]?.action, 'run');
  assert.equal(outside.entries[0]?.reason, undefined, 'kayıtsız kuruluma "recorded as installed" dendi');

  // Aynı envanter, bu kez kendi kaydımızla: not ancak şimdi doğru (ADR-0002).
  recordEntry(ctx, readState(ctx).state, {
    ref: { itemId: 'sk', harness: HARNESS, providerId: 'skills-api' },
    kind: 'skill',
    command: ['skills-api', 'owner/repo', 'alpha'],
  });
  const ours = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] });
  assert.equal(ours.entries[0]?.action, 'already');
  assert.equal(ours.entries[0]?.reason, t.recordedInstalled);
});

test('adapter: elle silinen skill yeniden kurulur', async () => {
  const home = tempHome();
  const data = adapterData();
  const installs: string[] = [];
  const ctx = adapterContext(home, {
    install: async ({ source }: { source: string }) => {
      installs.push(source);
      writeSkillLock(home, 'alpha', source);
      return { installed: ['alpha'], failed: [] };
    },
  });
  const selection = { harnessIds: [HARNESS], itemIds: ['sk'] };

  const first = await applyPlan(data, ctx, await buildPlan(data, ctx, selection));
  assert.equal(first.items[0]?.status, 'ok');
  assert.equal(readState(ctx).state.entries.length, 1);

  // Deleted by hand: the record still says installed, the inventory no longer does.
  fs.rmSync(path.join(home, '.agents', '.skill-lock.json'));
  const missing = await buildPlan(data, ctx, selection);
  assert.equal(missing.entries[0]?.action, 'run', 'elle silinen skill yeniden kurulmadı');

  const second = await applyPlan(data, ctx, missing);
  assert.equal(second.items[0]?.status, 'ok');
  assert.equal(installs.length, 2);
  assert.ok(fs.existsSync(path.join(home, '.agents', '.skill-lock.json')), 'skill geri gelmedi');
});

test('adapter: bir harness\'taki hata diğerini durdurmaz, yalnız kurulan kaydedilir', async () => {
  const home = tempHome();
  const data = adapterData();
  data.providers.find((provider) => provider.id === 'skills-api')!.supports = [HARNESS, 'other'];
  data.harnesses.push({ ...data.harnesses[0]!, id: 'other', label: 'Other', detect: ['~/.other'], agentId: 'other' });
  const ctx = adapterContext(home, {
    install: async ({ source, agents }: { source: string; agents: string[] }) => {
      if (agents[0] === 'other') return { installed: [], failed: [{ skill: 'alpha', message: 'source not found' }] };
      writeSkillLock(home, 'alpha', source);
      return { installed: ['alpha'], failed: [] };
    },
  });

  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS, 'other'], itemIds: ['sk'] });
  const outcome = await applyPlan(data, ctx, plan);

  const failed = outcome.items.find((item) => item.entry.harness === 'other');
  const installed = outcome.items.find((item) => item.entry.harness === HARNESS);
  assert.equal(failed?.status, 'error');
  assert.equal(failed?.message, 'source not found');
  assert.equal(installed?.status, 'ok', 'diğer harness devam etmedi');
  assert.equal(exitCodeFor(outcome), 1);
  assert.deepEqual(
    readState(ctx).state.entries.map((entry) => entry.harness),
    [HARNESS],
    "kayıt yalnız kurulan harness'ı tutmalı",
  );
});

/**
 * Answers by command and keeps a queue per command, so a re-check can answer differently from the first
 * read. `installsIn` makes its successful `skills add` really install, like `InstallingRunner` does.
 */
function scripted(answers: Record<string, RunResult[]>, options: { installsIn?: string } = {}) {
  const calls: string[][] = [];
  const runner: Runner = {
    async run(argv: string[]) {
      calls.push(argv);
      const result = answers[argv.join(' ')]?.shift() ?? { code: 0, stdout: '', stderr: '' };
      if (options.installsIn && result.code === 0) landSkills(argv, options.installsIn);
      return result;
    },
  };
  return { runner, calls };
}

/** Two harnesses: one below its declared minimum, one comfortably above it. */
function twoHarnesses(): Data {
  const data = withHarnessRequirement();
  data.harnesses[0]!.label = 'Claude Code';
  data.harnesses.push({
    ...data.harnesses[0]!,
    id: 'other',
    label: 'Other Harness',
    detect: ['~/.other'],
    requires: ['other-cli'],
  });
  data.requires.push({
    id: 'other-cli',
    check: { command: ['other', '--version'], min: '1.0' },
    install: { win32: ['install-other'], darwin: ['install-other'], linux: ['install-other'] },
  });
  data.providers = data.providers.map((provider) => ({ ...provider, supports: [...provider.supports, 'other'] }));
  return data;
}

const HARNESS_UPDATE = ['npm', 'install', '-g', '@fake/harness'];

test('plan: asgari sürümün altındaki harness sürüm, asgari ve güncelleme komutuyla görünür', async () => {
  const home = tempHome();
  const data = twoHarnesses();
  const { runner } = scripted({
    'node --version': [{ code: 0, stdout: 'v22.1.0', stderr: '' }],
    'claude --version': [{ code: 0, stdout: '1.4.0', stderr: '' }],
    'other --version': [{ code: 0, stdout: '1.5.0', stderr: '' }],
  });
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });

  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS, 'other'], itemIds: ['sk'] });

  const tooOld = plan.requirements.find((requirement) => requirement.id === HARNESS);
  assert.equal(tooOld?.present, false);
  assert.equal(tooOld?.version, '1.4.0');
  assert.equal(tooOld?.minimum, '2.0');
  assert.deepEqual(tooOld?.installCommand, HARNESS_UPDATE);

  const text = planLines(plan)
    .map((line) => line.text)
    .join('\n');
  assert.match(text, /too old {2}requirement Claude Code 1\.4\.0 · min 2\.0 → npm install -g @fake\/harness/);
  assert.equal(fs.existsSync(path.join(home, '.agentenv')), false, 'plan yazmamalı');
});

test('plan: eski harness\'a bağlı öğeler sebebiyle bloklanır, diğer harness devam eder', async () => {
  const home = tempHome();
  const data = twoHarnesses();
  const { runner } = scripted({
    'node --version': [{ code: 0, stdout: 'v22.1.0', stderr: '' }],
    'claude --version': [{ code: 0, stdout: '1.4.0', stderr: '' }],
    'other --version': [{ code: 0, stdout: '1.5.0', stderr: '' }],
  });
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });

  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS, 'other'], itemIds: ['sk'] });

  assert.deepEqual(
    plan.entries.filter((entry) => entry.blockedBy).map((entry) => [entry.harness, entry.blockedBy]),
    [[HARNESS, HARNESS]],
  );
  assert.equal(plan.entries.find((entry) => entry.harness === 'other')?.blockedBy, undefined);
  const text = planLines(plan)
    .map((line) => line.text)
    .join('\n');
  assert.match(text, /blocked: requirement not met: claude-code/);
});

test('apply: markalanan güncelleme bir kez çalışır, sürüm yeniden okunur, öğeler aynı çalıştırmada devam eder', async () => {
  const home = tempHome();
  const data = twoHarnesses();
  const { runner, calls } = scripted({
    'node --version': [{ code: 0, stdout: 'v22.1.0', stderr: '' }],
    'claude --version': [
      { code: 0, stdout: '1.4.0', stderr: '' },
      { code: 0, stdout: '2.5.0', stderr: '' },
    ],
    'other --version': [{ code: 0, stdout: '1.5.0', stderr: '' }],
    [HARNESS_UPDATE.join(' ')]: [{ code: 0, stdout: '', stderr: '' }],
  }, { installsIn: home });
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });
  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS, 'other'], itemIds: ['sk'] });

  const outcome = await applyPlan(data, ctx, plan, { updates: [HARNESS] });

  assert.equal(calls.filter((call) => call.join(' ') === HARNESS_UPDATE.join(' ')).length, 1, 'güncelleme bir kez çalışmadı');
  assert.equal(calls.filter((call) => call.join(' ') === 'claude --version').length, 2, 'sürüm yeniden okunmadı');
  assert.equal(outcome.requirements.find((requirement) => requirement.id === HARNESS)?.ok, true);
  assert.deepEqual(
    outcome.items.map((item) => item.status),
    ['ok', 'ok'],
  );
  assert.equal(readState(ctx).state.entries.length, 2);
  assert.equal(exitCodeFor(outcome), 0);
});

test('apply: markalanmayan güncelleme çalışmaz, bağımlı öğe bloklanır ve sebebi raporlanır', async () => {
  const home = tempHome();
  const data = twoHarnesses();
  const { runner, calls } = scripted({
    'node --version': [{ code: 0, stdout: 'v22.1.0', stderr: '' }],
    'claude --version': [{ code: 0, stdout: '1.4.0', stderr: '' }],
    'other --version': [{ code: 0, stdout: '1.5.0', stderr: '' }],
    [HARNESS_UPDATE.join(' ')]: [{ code: 0, stdout: '', stderr: '' }],
  }, { installsIn: home });
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });
  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS, 'other'], itemIds: ['sk'] });

  const outcome = await applyPlan(data, ctx, plan, { updates: [] });

  assert.equal(calls.some((call) => call.join(' ') === HARNESS_UPDATE.join(' ')), false, 'markalanmayan güncelleme çalıştı');
  const requirement = outcome.requirements.find((candidate) => candidate.id === HARNESS);
  assert.equal(requirement?.ok, false);
  assert.equal(requirement?.message, t.updateNotMarked(HARNESS));
  const blocked = outcome.items.find((item) => item.entry.harness === HARNESS);
  assert.equal(blocked?.status, 'error');
  assert.equal(blocked?.message, t.requirementUnmet(HARNESS));
  assert.equal(outcome.items.find((item) => item.entry.harness === 'other')?.status, 'ok', 'diğer harness devam etmedi');
  assert.equal(findEntry(readState(ctx).state, 'sk', HARNESS), undefined, 'bloklu öğe kaydedildi');
  assert.ok(findEntry(readState(ctx).state, 'sk', 'other'), 'diğer harness kaydedilmedi');
  assert.equal(exitCodeFor(outcome), 1);
});

test('apply: --update verilmezse eski harness güncellenmez; eksik ön koşul yine kurulur', async () => {
  const home = tempHome();
  const data = twoHarnesses();
  const { runner, calls } = scripted({
    'node --version': [{ code: 0, stdout: 'v22.1.0', stderr: '' }],
    'claude --version': [{ code: 0, stdout: '1.4.0', stderr: '' }],
    'other --version': [{ code: 0, stdout: '1.5.0', stderr: '' }],
    [HARNESS_UPDATE.join(' ')]: [{ code: 0, stdout: '', stderr: '' }],
  }, { installsIn: home });
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });
  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS, 'other'], itemIds: ['sk'] });

  const outcome = await applyPlan(data, ctx, plan);

  assert.equal(calls.some((call) => call.join(' ') === HARNESS_UPDATE.join(' ')), false, 'işaretsiz güncelleme çalıştı');
  const requirement = outcome.requirements.find((candidate) => candidate.id === HARNESS);
  assert.equal(requirement?.ok, false);
  assert.equal(requirement?.message, t.updateNotMarked(HARNESS));
  assert.equal(outcome.items.find((item) => item.entry.harness === HARNESS)?.status, 'error');
  assert.equal(outcome.items.find((item) => item.entry.harness === 'other')?.status, 'ok', 'diğer harness devam etmedi');
  assert.equal(exitCodeFor(outcome), 1);
});

test('apply: eksik ön koşul işaretsiz de kurulur (bootstrap yolu)', async () => {
  const home = tempHome();
  const data = fixture();
  const runner = new InstallingRunner(home, [
    { code: 1, stdout: '', stderr: '' },
    { code: 0, stdout: '', stderr: '' },
    { code: 0, stdout: 'v22.1.0', stderr: '' },
  ]);
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });
  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] });
  assert.equal(plan.requirements[0]?.present, false);
  assert.equal(plan.requirements[0]?.version, undefined, 'eksik ön koşul sürüm taşımamalı');

  const outcome = await applyPlan(data, ctx, plan);

  assert.deepEqual(runner.calls.slice(0, 3), [['node', '--version'], ['install-node'], ['node', '--version']]);
  assert.equal(outcome.requirements[0]?.ok, true);
  assert.equal(outcome.items[0]?.status, 'ok');
});

test('apply: tanımın bu platformdaki kurulum komutu olduğu gibi, tek sefer çalışır', async () => {
  const home = tempHome();
  const data = withHarnessRequirement();
  // Boşluk ve değişken içeren bir argv: komut genişletilmeden, parçalanmadan geçmeli.
  const INSTALL = ['fake-installer', 'install', '--prefix', '/opt/fake dir', '{item}'];
  data.requires.find((requirement) => requirement.id === HARNESS)!.install = { darwin: INSTALL };
  const { runner, calls } = scripted({
    'node --version': [{ code: 0, stdout: 'v22.1.0', stderr: '' }],
    'claude --version': [
      { code: 1, stdout: '', stderr: '' },
      { code: 0, stdout: '2.5.0', stderr: '' },
    ],
    [INSTALL.join(' ')]: [{ code: 0, stdout: '', stderr: '' }],
  });
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'darwin' });

  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] });
  assert.deepEqual(plan.requirements.find((requirement) => requirement.id === HARNESS)?.installCommand, INSTALL);

  await applyPlan(data, ctx, plan);

  assert.deepEqual(calls.filter((call) => call[0] === 'fake-installer'), [INSTALL], 'komut olduğu gibi çalışmadı');
});

test('plan: bu platformda kurulum komutu olmayan tanım "no install command" der', async () => {
  const home = tempHome();
  const data = withHarnessRequirement();
  data.requires.find((requirement) => requirement.id === HARNESS)!.install = { win32: ['install-on-windows'] };
  const { runner } = scripted({
    'node --version': [{ code: 0, stdout: 'v22.1.0', stderr: '' }],
    'claude --version': [{ code: 1, stdout: '', stderr: '' }],
  });
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });

  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] });

  const row = plan.requirements.find((requirement) => requirement.id === HARNESS);
  assert.equal(row?.installCommand, undefined, 'olmayan komut uydurulmamalı');
  const text = planLines(plan)
    .map((line) => line.text)
    .join('\n');
  assert.match(
    text,
    new RegExp(`^${t.harnessLabels.absent} {2}requirement ${HARNESS} · min 2\\.0 — ${t.noInstallCommand}$`, 'm'),
    `plan satırı yok:\n${text}`,
  );
});

test('apply: bu platformda kurulum komutu olmayan tanımı "no install command" olarak raporlar', async () => {
  const home = tempHome();
  const data = withHarnessRequirement();
  data.requires.find((requirement) => requirement.id === HARNESS)!.install = { win32: ['install-on-windows'] };
  const { runner, calls } = scripted({
    'node --version': [{ code: 0, stdout: 'v22.1.0', stderr: '' }],
    'claude --version': [{ code: 1, stdout: '', stderr: '' }],
    'install-on-windows': [{ code: 0, stdout: '', stderr: '' }],
  });
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });
  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk'] });

  const outcome = await applyPlan(data, ctx, plan);
  const text = outcomeLines(outcome)
    .map((line) => line.text)
    .join('\n');

  assert.equal(outcome.requirements.find((requirement) => requirement.id === HARNESS)?.message, t.noInstallCommand);
  assert.equal(calls.some((call) => call[0] === 'install-on-windows'), false, 'başka platformun komutu çalıştı');
  assert.equal(outcome.requirements.find((requirement) => requirement.id === HARNESS)?.ok, false);
  assert.equal(outcome.items[0]?.status, 'error');
  assert.equal(exitCodeFor(outcome), 1);
});

test('apply: kurulamayan harness diğer harness\'ın öğelerini ve diğer ön koşulları bırakmaz', async () => {
  const home = tempHome();
  const data = twoHarnesses();
  // "other" harness'ının CLI'ı bu platformda kurulamıyor: ne komut var ne de sürüm okunuyor.
  data.requires.find((requirement) => requirement.id === 'other-cli')!.install = { win32: ['install-other'] };
  const { runner, calls } = scripted({
    'node --version': [{ code: 0, stdout: 'v22.1.0', stderr: '' }],
    'claude --version': [{ code: 0, stdout: '2.5.0', stderr: '' }],
    'other --version': [{ code: 1, stdout: '', stderr: '' }],
    'install-other': [{ code: 0, stdout: '', stderr: '' }],
  }, { installsIn: home });
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });
  const plan = await buildPlan(data, ctx, { harnessIds: [HARNESS, 'other'], itemIds: ['sk'] });

  const outcome = await applyPlan(data, ctx, plan);
  const text = outcomeLines(outcome)
    .map((line) => line.text)
    .join('\n');

  const otherRequirement = outcome.requirements.find((requirement) => requirement.id === 'other-cli');
  assert.equal(otherRequirement?.ok, false);
  assert.equal(otherRequirement?.message, t.noInstallCommand);
  assert.equal(outcome.requirements.find((requirement) => requirement.id === 'node')?.ok, true, 'diğer ön koşul etkilendi');
  assert.equal(outcome.items.find((item) => item.entry.harness === HARNESS)?.status, 'ok', 'diğer harness kurulmadı');
  const blocked = outcome.items.find((item) => item.entry.harness === 'other');
  assert.equal(blocked?.status, 'error');
  assert.equal(blocked?.message, t.requirementUnmet('other-cli'));
  assert.ok(text.includes(t.requirementFailed('other-cli', t.noInstallCommand)), `uygulama sonucu söylemiyor:
${text}`);
  assert.equal(calls.some((call) => call[0] === 'install-other'), false, 'başka platformun komutu çalıştı');
  assert.equal(exitCodeFor(outcome), 1, 'başarısızlık kuralı dışında bir sebeple çıkış kodu değişti');
});
