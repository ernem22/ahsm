import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createContext, RecordingRunner, type Ctx } from '../src/context.js';
import { INVENTORY_SCOPE, readSkillInventory } from '../src/core/list.js';
import { statePath } from '../src/core/state.js';
import { listLines } from '../src/render.js';
import { t } from '../src/i18n.js';
import type { SkillsAdapter, InstalledSkill } from '../src/providers/skills-api.js';
import type { Data } from '../src/types.js';

const CLAUDE = 'claude-code';
const CODEX = 'codex';

/** Two harnesses, each with the agent id the skills provider uses; no provider or item is needed here. */
function fixture(): Data {
  return {
    items: new Map(),
    packages: new Map(),
    harnesses: [
      {
        id: CLAUDE,
        detect: ['~/.claude'],
        agentId: CLAUDE,
        config: { path: '~/.claude/settings.json', format: 'jsonc' },
      },
      {
        id: CODEX,
        detect: ['~/.codex'],
        agentId: CODEX,
        config: { path: '~/.codex/config.toml', format: 'toml' },
      },
    ],
    providers: [],
    requires: [],
  };
}

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-list-'));
}

/** A context whose skills API is a stub (never the network) and whose runner records any command. */
function listingContext(home: string, installed: InstalledSkill[], list?: SkillsAdapter['list']) {
  const runner = new RecordingRunner();
  const ctx: Ctx = createContext({
    root: process.cwd(),
    home,
    runner,
    platform: 'linux',
    skills: {
      install: async () => ({ installed: [], failed: [] }),
      remove: async () => ({ removed: [], notFound: [], failed: [] }),
      list: list ?? (async () => installed),
    },
  });
  return { ctx, runner };
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

const installed: InstalledSkill[] = [
  { name: 'beta', source: 'owner/repo', agents: [CODEX] },
  { name: 'alpha', source: 'owner/repo', agents: [CLAUDE, CODEX] },
  { name: 'orphan', source: 'owner/other', agents: [] },
  { name: 'elsewhere', source: 'owner/third', agents: ['some-other-agent'] },
];

test('list: ad, kapsam ve harness\'lar sağlayıcı envanterinden gelir', async () => {
  const home = tempHome();
  const { ctx } = listingContext(home, installed);

  const report = await readSkillInventory(fixture(), ctx);
  const byName = new Map(report.rows.map((row) => [row.name, row]));

  // Sorted by name, so two runs read the same.
  assert.deepEqual(
    report.rows.map((row) => row.name),
    ['alpha', 'beta', 'elsewhere', 'orphan'],
  );
  assert.deepEqual(byName.get('alpha')?.harnesses, [CLAUDE, CODEX]);
  assert.equal(byName.get('alpha')?.scope, INVENTORY_SCOPE);
  assert.equal(byName.get('alpha')?.source, 'owner/repo');
  assert.deepEqual(byName.get('beta')?.harnesses, [CODEX]);
});

test('list: agentenv dışında kurulmuş skill de görünür, kimsenin taşımadığı skill de', async () => {
  const home = tempHome();
  const { ctx } = listingContext(home, installed);

  const report = await readSkillInventory(fixture(), ctx);
  const byName = new Map(report.rows.map((row) => [row.name, row]));

  // Nothing was ever recorded here; the provider inventory is the only source.
  assert.equal(fs.existsSync(statePath(ctx)), false);
  assert.deepEqual(byName.get('elsewhere')?.harnesses, []);
  assert.deepEqual(byName.get('elsewhere')?.otherAgents, ['some-other-agent']);
  assert.deepEqual(byName.get('orphan')?.harnesses, []);
  assert.deepEqual(byName.get('orphan')?.otherAgents, []);
  assert.equal(report.rows.length, 4);
});

test('list: bozuk kayıt listeyi değiştirmez ve kayda dokunmaz', async () => {
  const home = tempHome();
  const { ctx } = listingContext(home, installed);
  const file = statePath(ctx);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ this is not json', 'utf8');

  const before = fs.readFileSync(file, 'utf8');
  const report = await readSkillInventory(fixture(), ctx);

  assert.equal(report.rows.length, 4);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'bozuk state.json elle değiştirildi');
  // A damaged record is not backed up either: only `apply` does that.
  assert.deepEqual(fs.readdirSync(home).sort(), ['.agentenv']);
  assert.deepEqual(fs.readdirSync(path.join(home, '.agentenv')).sort(), ['state.json']);
});

test('list: hiçbir şey yazmaz ve hiçbir komut çalıştırmaz', async () => {
  const home = tempHome();
  // A harness directory and a lockfile that must come back untouched.
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{}', 'utf8');
  const { ctx, runner } = listingContext(home, installed);
  const before = snapshot(home);

  await readSkillInventory(fixture(), ctx);

  assert.equal(snapshot(home), before, 'liste sandbox ağacını değiştirdi');
  assert.deepEqual(runner.calls, [], 'liste komut çalıştırdı');
});

test('list: sağlayıcı envanteri okunamazsa boş liste değil hata', async () => {
  const home = tempHome();
  const { ctx } = listingContext(home, [], async () => {
    throw new Error('skills API yok');
  });

  await assert.rejects(() => readSkillInventory(fixture(), ctx), /skills API yok/);
});

test('list: biçimlendirici kapsamı ve harness\'ları yazar', async () => {
  const home = tempHome();
  const { ctx } = listingContext(home, installed);
  const report = await readSkillInventory(fixture(), ctx);
  const text = listLines(report).map((line) => line.text);

  assert.equal(text[0], t.skillsTitle);
  assert.ok(
    text.includes(`${t.scopeLabels[INVENTORY_SCOPE]}  alpha [owner/repo] → ${CLAUDE}, ${CODEX}`),
    `alpha satırı yok:\n${text.join('\n')}`,
  );
  // A skill no harness reports is still shown, with its scope, rather than dropped.
  assert.ok(
    text.includes(`${t.scopeLabels[INVENTORY_SCOPE]}  orphan [owner/other] → ${t.listNoHarness}`),
    `orphan satırı yok:\n${text.join('\n')}`,
  );
  assert.ok(text.includes(t.listCount(4)), `özet satırı yok:\n${text.join('\n')}`);
});

test('list: envanter boşsa bunu söyler, hata gibi görünmez', async () => {
  const home = tempHome();
  const { ctx } = listingContext(home, []);
  const text = listLines(await readSkillInventory(fixture(), ctx)).map((line) => line.text);

  assert.deepEqual(text, [t.skillsTitle, t.listEmpty]);
});
