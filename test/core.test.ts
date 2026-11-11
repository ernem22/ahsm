import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createContext, RecordingRunner } from '../src/context.js';
import { applyPlan, exitCodeFor, type ApplyOutcome } from '../src/core/apply.js';
import { detectHarnesses } from '../src/core/detect.js';
import { buildPlan } from '../src/core/plan.js';
import { readStatus } from '../src/core/status.js';
import { findEntry, readState, statePath, type State } from '../src/core/state.js';
import { verifyInstalled } from '../src/core/verify.js';
import { mergeHook, readText } from '../src/apply/hook-merger.js';
import { t } from '../src/i18n.js';
import type { Data } from '../src/types.js';

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

function setup(home: string, results: ConstructorParameters<typeof RecordingRunner>[0] = []) {
  const runner = new RecordingRunner([
    { code: 0, stdout: 'v22.1.0', stderr: '' },
    { code: 0, stdout: '', stderr: '' },
    { code: 0, stdout: '', stderr: '' },
    ...results,
  ]);
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });
  return { ctx, runner };
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
  assert.deepEqual(
    readStatus(data, ctx).rows.map((row) => row.value),
    ['missing', 'missing', 'up-to-date'],
  );

  // the owners of the install now report it: lockfile for skills, harness config for MCP
  fs.mkdirSync(path.join(home, '.agents'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.agents', '.skill-lock.json'),
    JSON.stringify({ skills: { any: { source: 'owner/repo' } } }),
    'utf8',
  );
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
  readStatus(data, ctx);
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

  // lock dosyası yok → gerçekte kurulu değil
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
  const { ctx } = setup(home);

  await applyPlan(data, ctx, await buildPlan(data, ctx, { harnessIds: [HARNESS], itemIds: ['sk', 'mc'] }));

  const before = readStatus(data, ctx).rows.map((row) => row.value);
  assert.equal(before[0], 'missing', 'lock yok → eksik');

  fs.mkdirSync(path.join(home, '.agents'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.agents', '.skill-lock.json'),
    JSON.stringify({ skills: { any: { source: 'owner/repo' } } }),
    'utf8',
  );
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { mc: {} } }), 'utf8');

  const after = readStatus(data, ctx).rows.map((row) => row.value);
  assert.deepEqual(after, ['up-to-date', 'up-to-date']);
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
  assert.equal(readStatus(data, ctx).rows[0]?.value, 'missing');
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
