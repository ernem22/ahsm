import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createContext, RecordingRunner, type Ctx } from '../src/context.js';
import { readStaleSkills } from '../src/core/stale.js';
import { statePath } from '../src/core/state.js';
import { staleLines } from '../src/render.js';
import { t } from '../src/i18n.js';
import type { Data, ProviderDef } from '../src/types.js';

const CLAUDE = 'claude-code';
const HASH = '0123456789abcdef0123456789abcdef01234567';

/** The two real skill providers: the API one installs, the CLI one is the only one that can check. */
function fixture(overrides: Partial<ProviderDef> = {}): Data {
  return {
    items: new Map(),
    packages: new Map(),
    harnesses: [{ id: CLAUDE, detect: ['~/.claude'], agentId: CLAUDE, config: { path: '~/.claude/settings.json', format: 'jsonc' } }],
    providers: [
      {
        id: 'skills-api',
        kind: 'skill',
        supports: [CLAUDE],
        adapter: 'skills-api',
        priority: 5,
        verify: { strategy: 'skill-lock', file: '~/.agents/.skill-lock.json' },
      },
      {
        id: 'skills-cli',
        kind: 'skill',
        supports: [CLAUDE],
        priority: 10,
        verify: { strategy: 'skill-lock', file: '~/.agents/.skill-lock.json' },
        install: ['npx', 'skills', 'add'],
        check: ['npx', 'skills', 'check', '-g'],
        ...overrides,
      },
    ],
    requires: [],
  };
}

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ahsm-stale-'));
}

interface Locked {
  [name: string]: Record<string, unknown>;
}

/** Writes the provider's lockfile into the sandbox and answers `readStaleSkills` from a fake runner. */
function staleContext(home: string, locked: Locked, stdout = '', code = 0) {
  const file = path.join(home, '.agents', '.skill-lock.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 3, skills: locked }, null, 2), 'utf8');

  const runner = new RecordingRunner([{ code, stdout, stderr: '' }]);
  const ctx: Ctx = createContext({
    root: process.cwd(),
    home,
    runner,
    platform: 'linux',
    skills: {
      install: async () => ({ installed: [], failed: [] }),
      remove: async () => ({ removed: [], notFound: [], failed: [] }),
      // The inventory scan is ~7 s per hundred skills: this surface must never reach it.
      list: async () => {
        throw new Error('envanter okunmamalı');
      },
    },
  });
  return { ctx, runner, file };
}

function entry(source: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { source, sourceType: 'github', skillPath: `skills/x/SKILL.md`, skillFolderHash: HASH, ...extra };
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

test('stale: sağlayıcının kendi çıktısı güncel diyorsa satır up-to-date olur', async () => {
  const home = tempHome();
  const { ctx, runner } = staleContext(home, { ask: entry('owner/repo') }, 'Checking for skill updates…\n✓ All global skills are up to date\n');

  const report = await readStaleSkills(fixture(), ctx);

  assert.equal(report.covered, true);
  assert.deepEqual(
    report.rows.map((row) => [row.name, row.value]),
    [['ask', 'up-to-date']],
  );
  // The provider's own check is the comparison; no other command is invented.
  assert.deepEqual(runner.calls, [['npx', 'skills', 'check', '-g']]);
});

test('stale: sağlayıcı güncelleme bildirirse satır stale olur', async () => {
  const home = tempHome();
  const stdout = [
    'Checking skills from source: owner/repo',
    '↑ ask has an update',
    '↑ other has an update',
    '1 skill(s) can be updated; run npx skills update to install',
  ].join('\n');
  const { ctx } = staleContext(home, { ask: entry('owner/repo'), other: entry('owner/repo'), fresh: entry('owner/repo') }, stdout);

  const report = await readStaleSkills(fixture(), ctx);
  const byName = new Map(report.rows.map((row) => [row.name, row]));

  assert.equal(byName.get('ask')?.value, 'stale');
  assert.equal(byName.get('ask')?.detail, t.staleNewer);
  assert.equal(byName.get('other')?.value, 'stale');
  // The run completed for this source, so a skill it did not name is up to date.
  assert.equal(byName.get('fresh')?.value, 'up-to-date');
  assert.deepEqual(
    report.rows.map((row) => row.name),
    ['ask', 'fresh', 'other'],
    'satırlar ada göre sıralı olmalı',
  );
});

test('stale: kaynak artık sunmuyorsa stale, asla güncel değil', async () => {
  const home = tempHome();
  const stdout = [
    'Checking skills from source: owner/repo',
    'Warning: The following skills from owner/repo appear to have been deleted upstream:',
    '  • gone',
    'Skipping deletion in non-interactive mode.',
    '✓ All global skills are up to date',
  ].join('\n');
  const { ctx } = staleContext(home, { gone: entry('owner/repo') }, stdout);

  const [row] = (await readStaleSkills(fixture(), ctx)).rows;

  assert.equal(row?.value, 'stale');
  assert.equal(row?.detail, t.staleGone);
});

test('stale: kaynağa ulaşılamazsa sağlayıcı "güncel" dese de unknown', async () => {
  const home = tempHome();
  // The provider prints its closing summary and exits 0 even when the only source failed.
  const stdout = [
    'Checking skills from source: owner/repo',
    '  ✗ Failed to check skills from owner/repo',
    '✓ All global skills are up to date',
  ].join('\n');
  const { ctx } = staleContext(home, { ask: entry('owner/repo'), other: entry('owner/missing') }, stdout, 0);

  const report = await readStaleSkills(fixture(), ctx);
  const byName = new Map(report.rows.map((row) => [row.name, row]));

  assert.equal(byName.get('ask')?.value, 'unknown');
  assert.equal(byName.get('ask')?.detail, t.staleUnreachable('owner/repo'));
  // A different source that was not reported failed stays honoured by the summary.
  assert.equal(byName.get('other')?.value, 'up-to-date');
});

test('stale: kontrol hiç bitmezse (komut yok, çöktü) hiçbir satır güncel olmaz', async () => {
  const home = tempHome();
  const { ctx } = staleContext(home, { ask: entry('owner/repo') }, '', 1);

  const [row] = (await readStaleSkills(fixture(), ctx)).rows;

  assert.equal(row?.value, 'unknown');
  assert.equal(row?.detail, t.staleNotRun);
});

test('stale: hash ya da kaynak kayıtlı değilse karşılaştırma yapılmaz', async () => {
  const home = tempHome();
  const { ctx } = staleContext(
    home,
    {
      nohash: entry('owner/repo', { skillFolderHash: '' }),
      nopath: entry('owner/repo', { skillPath: undefined }),
      nosource: { skillFolderHash: HASH, skillPath: 'skills/x/SKILL.md' },
    },
    '✓ All global skills are up to date',
  );

  const byName = new Map((await readStaleSkills(fixture(), ctx)).rows.map((row) => [row.name, row]));

  assert.equal(byName.get('nohash')?.value, 'unknown');
  assert.equal(byName.get('nohash')?.detail, t.staleNoHash);
  assert.equal(byName.get('nopath')?.value, 'unknown');
  assert.equal(byName.get('nosource')?.value, 'unknown');
  assert.equal(byName.get('nosource')?.detail, t.staleNoSource);
});

test('stale: sağlayıcı karşılaştıramadığını söylerse unknown', async () => {
  const home = tempHome();
  const stdout = [
    '1 skill(s) cannot be checked automatically:',
    '  • ask (Local path)',
    '    To update: npx skills add ~/src -g -y',
  ].join('\n');
  const { ctx } = staleContext(home, { ask: entry('owner/repo') }, stdout);

  const [row] = (await readStaleSkills(fixture(), ctx)).rows;

  assert.equal(row?.value, 'unknown');
  assert.equal(row?.detail, t.staleNotComparable);
});

test('stale: hiçbir sağlayıcı kontrol sunmuyorsa "not covered", komut da çalışmaz', async () => {
  const home = tempHome();
  const { ctx, runner } = staleContext(home, { ask: entry('owner/repo') }, '✓ All global skills are up to date');
  const data = fixture({ check: [] });

  const report = await readStaleSkills(data, ctx);

  assert.equal(report.covered, false);
  assert.deepEqual(report.rows, []);
  assert.deepEqual(runner.calls, []);
});

test('stale: hiçbir şey yazmaz ve kaydı okumaz', async () => {
  const home = tempHome();
  const { ctx } = staleContext(home, { ask: entry('owner/repo') }, '✓ All global skills are up to date');
  const file = statePath(ctx);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ bozuk', 'utf8');
  const before = snapshot(home);

  await readStaleSkills(fixture(), ctx);

  assert.equal(snapshot(home), before, 'stale sandbox ağacını değiştirdi');
  assert.equal(fs.readFileSync(file, 'utf8'), '{ bozuk', 'bozuk state.json elle değiştirildi');
});

test('stale: bozuk lockfile güncel demez, uyarır', async () => {
  const home = tempHome();
  const file = path.join(home, '.agents', '.skill-lock.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ bu json değil', 'utf8');
  const runner = new RecordingRunner([{ code: 0, stdout: '✓ All global skills are up to date', stderr: '' }]);
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });

  const report = await readStaleSkills(fixture(), ctx);

  assert.deepEqual(report.rows, []);
  assert.deepEqual(report.warnings, [t.staleLockUnreadable(file)]);
});

test('stale: biçimlendirici üç durumu da planın sözlüğüyle yazar', async () => {
  const home = tempHome();
  const stdout = ['↑ ask has an update', '1 skill(s) can be updated; run npx skills update to install'].join('\n');
  const { ctx } = staleContext(home, { ask: entry('owner/repo'), nohash: entry('owner/repo', { skillFolderHash: '' }) }, stdout);
  const text = staleLines(await readStaleSkills(fixture(), ctx)).map((line) => line.text);

  assert.equal(text[0], t.staleTitle);
  assert.ok(text.includes(`stale  ask [owner/repo] — ${t.staleNewer}`), text.join('\n'));
  assert.ok(text.includes(`unknown  nohash [owner/repo] — ${t.staleNoHash}`), text.join('\n'));
  assert.ok(text.includes(t.staleCount(2)), text.join('\n'));
  // The summary says what this run did not do: no installation happened.
  assert.match(t.staleCount(2), /verification only, nothing was installed/);
});

test('stale: lockfile yoksa boş rapor, güncel iddiası yok', async () => {
  const home = tempHome();
  const runner = new RecordingRunner([{ code: 0, stdout: '✓ All global skills are up to date', stderr: '' }]);
  const ctx = createContext({ root: process.cwd(), home, runner, platform: 'linux' });

  const report = await readStaleSkills(fixture(), ctx);

  assert.deepEqual(report, { covered: true, rows: [], warnings: [] });
  assert.deepEqual(staleLines(report).map((line) => line.text), [t.staleTitle, t.staleEmpty]);
});
