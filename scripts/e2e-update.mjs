#!/usr/bin/env node
/**
 * End-to-end check of `agentenv update` — the write side of the stale check.
 *
 * The provider's own update check (ticket 06) says which installed skills are stale; `update` installs
 * exactly those again, through the same provider install path `apply` uses, and records them the same
 * way. Offline, the check is answered by the fixture program (`test/fixtures/offline/bin/check-skills.mjs`),
 * which reads `~/.fake/upstream/<name>` markers out of the sandbox.
 *
 *   node scripts/e2e-update.mjs      # offline: no network, no provider installs
 *
 * Requires `npm run build` first.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'dist', 'cli.js');
const offlineRoot = path.join(repo, 'test', 'fixtures', 'offline');

if (!fs.existsSync(cli)) {
  console.error('dist/cli.js yok — önce `npm run build`.');
  process.exit(1);
}

const { t } = await import(pathToFileURL(path.join(repo, 'dist', 'i18n.js')).href);

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✗ ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const HASH = '0123456789abcdef0123456789abcdef01234567';

/** A disposable HOME with the fixture harness present: `.fake/` is what its detect probe looks for. */
function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-e2e-update-'));
  fs.mkdirSync(path.join(home, '.fake'), { recursive: true });
  fs.writeFileSync(path.join(home, '.fake', 'settings.json'), '{}\n', 'utf8');
  return home;
}

/** The lockfile entry the real provider keeps: source plus the hash and path `stale` compares with. */
function recorded(name) {
  return {
    source: 'fixture/skills',
    sourceType: 'github',
    skillPath: `skills/${name}/SKILL.md`,
    skillFolderHash: HASH,
  };
}

function lockPath(home) {
  return path.join(home, '.fake', '.skill-lock.json');
}

function writeLock(home, skills) {
  fs.writeFileSync(lockPath(home), JSON.stringify({ version: 3, skills }, null, 2), 'utf8');
}

/** "The source holds a newer copy of this skill": the fixture `check` reads the marker file. */
function markUpstream(home, name) {
  const marker = path.join(home, '.fake', 'upstream', name);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, '', 'utf8');
}

function run(home, args) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, AGENTENV_ROOT: offlineRoot, DISABLE_TELEMETRY: '1' };
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: repo, env, encoding: 'utf8' });
  return { code: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function treeHash(dir) {
  const hash = crypto.createHash('sha256');
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else hash.update(`${path.relative(dir, full)}:${fs.readFileSync(full)}`);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return hash.digest('hex');
}

/**
 * The state after `agentenv apply --yes`: all three items installed and recorded. The lockfile is then
 * rewritten the way the real provider writes it (hash + path), so the check has something to compare.
 */
function applied(name) {
  const home = sandbox();
  const install = run(home, ['apply', '--yes']);
  assert(install.code === 0, `apply ${install.code} ile çıktı: ${install.out}`);
  writeLock(home, { [name]: recorded(name) });
  return home;
}

console.log('agentenv update');

check('update: bayat skill yoksa hiçbir şey yapmaz', () => {
  const home = applied('alpha');
  const before = treeHash(home);
  const planned = run(home, ['update']);
  assert(planned.code === 0, `update ${planned.code} ile çıktı: ${planned.out}`);
  assert(planned.out.includes(t.updateNone), `"${t.updateNone}" yok: ${planned.out}`);

  const appliedRun = run(home, ['update', '--yes']);
  assert(appliedRun.code === 0, `update --yes ${appliedRun.code} ile çıktı: ${appliedRun.out}`);
  assert(!appliedRun.out.includes(t.applyLabels.ok), `bayat skill yokken kurulum yapıldı: ${appliedRun.out}`);
  assert(treeHash(home) === before, 'bayat skill yokken update sandbox ağacını değiştirdi');
});

check('update: bayat skill kurulmadan önce plan olarak görünür ve hiçbir şey yazılmaz', () => {
  const home = applied('alpha');
  markUpstream(home, 'alpha');
  const before = treeHash(home);

  const { code, out } = run(home, ['update']);

  assert(code === 0, `update ${code} ile çıktı: ${out}`);
  assert(out.includes(t.updateTitle), `plan başlığı yok: ${out}`);
  assert(new RegExp(`^\\+ skill-a → fake`, 'm').test(out), `plan satırı yok: ${out}`);
  assert(out.includes(t.updateStaleCopy('alpha')), `bayat gerekçesi yok: ${out}`);
  assert(out.includes(t.updateCount(1, 1)), `özet satırı yok: ${out}`);
  assert(out.includes(t.updateHint), `onay ipucu yok: ${out}`);
  assert(treeHash(home) === before, 'plan hiçbir şey yazmamalıydı');
});

check('update --yes: bayat skill aynı kurulum yolundan bir kez kurulur, işaretsizler dokunulmaz', () => {
  const home = applied('alpha');
  markUpstream(home, 'alpha');
  // The installer leaves this file behind, so its return is proof that the install path really ran.
  const skillFile = path.join(home, '.fake', 'skills', 'alpha.md');
  fs.rmSync(skillFile, { force: true });
  const mcpBefore = fs.readFileSync(path.join(home, '.fake', 'mcp.json'), 'utf8');

  const { code, out } = run(home, ['update', '--yes']);

  assert(code === 0, `update --yes ${code} ile çıktı: ${out}`);
  assert(new RegExp(`^${t.applyLabels.ok}  skill-a → fake$`, 'm').test(out), `kurulum satırı yok: ${out}`);
  assert((out.match(new RegExp(`^${t.applyLabels.ok}`, 'gm')) ?? []).length === 1, `tek kurulum değil: ${out}`);
  assert(fs.existsSync(skillFile), 'skill dosyası geri yazılmadı — kurulum yolu çalışmadı');
  assert(fs.readFileSync(path.join(home, '.fake', 'mcp.json'), 'utf8') === mcpBefore, 'işaretsiz MCP öğesine dokunuldu');
  assert(!out.includes('mcp-a'), `işaretsiz öğe raporlandı: ${out}`);
});

check('update --yes sonrası status gerçekle aynı fikirde', () => {
  const home = applied('alpha');
  markUpstream(home, 'alpha');
  const { code, out } = run(home, ['update', '--yes']);
  assert(code === 0, `update --yes ${code} ile çıktı: ${out}`);

  const status = run(home, ['status']);
  const skillRows = status.out.split('\n').filter((line) => line.includes('skill-a'));
  assert(skillRows.length === 1, `skill satırı sayısı ${skillRows.length}: ${status.out}`);
  assert(skillRows[0].startsWith(t.statusLabels['up-to-date']), `status güncel demiyor: ${skillRows[0]}`);
  const record = JSON.parse(fs.readFileSync(path.join(home, '.agentenv', 'state.json'), 'utf8'));
  assert(record.entries.filter((entry) => entry.itemId === 'skill-a').length === 1, 'kayıt tazelenmedi/çoğaldı');
});

if (failures > 0) {
  console.log(`\n${failures} senaryo başarısız`);
  process.exit(1);
}
console.log('\ntüm senaryolar geçti');
