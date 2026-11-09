import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createContext, RecordingRunner } from '../src/context.js';
import { applyPlan } from '../src/core/apply.js';
import { detectHarnesses } from '../src/core/detect.js';
import { buildPlan } from '../src/core/plan.js';
import { readStatus } from '../src/core/status.js';
import { readState, statePath } from '../src/core/state.js';
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
      },
    ],
    providers: [
      {
        id: 'skills-cli',
        kind: 'skill',
        supports: [HARNESS],
        requires: ['node'],
        install: ['npx', 'skills', 'add', '{source}', '-g', '-a', '{agentId}', '--skill {skill}'],
      },
      { id: 'add-mcp', kind: 'mcp', supports: [HARNESS], install: ['npx', 'add-mcp', '{package}', '-a', '{agentId}'] },
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

function setup(home: string, results: Parameters<RecordingRunner['constructor']>[0] = []) {
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

  assert.equal(readState(ctx).entries.length, 3);
  assert.ok(fs.existsSync(statePath(ctx)));
  assert.deepEqual(
    readStatus(data, ctx).map((row) => row.value),
    ['unknown', 'unknown', 'up-to-date'],
  );

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
  assert.equal(readState(failing).entries.length, 2);
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
