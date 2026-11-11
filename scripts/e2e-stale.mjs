#!/usr/bin/env node
/**
 * End-to-end check of `agentenv stale` — the read-only freshness surface.
 *
 * `stale` asks the provider's own update check (`skills check`) whether each recorded skill is still
 * what its source offers. Offline that check cannot reach a source, which is a legitimate `unknown`:
 * these scenarios therefore drive a fixture `check` (offline provider stand-in) and assert the three
 * verdicts, the guard against a false "up-to-date", and that the run writes nothing.
 *
 *   node scripts/e2e-stale.mjs      # offline: no network, no provider installs
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

/** A disposable HOME whose provider lockfile already records one installed skill. */
function sandbox(locked = {}, markers = []) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-e2e-stale-'));
  const file = path.join(home, '.fake', '.skill-lock.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 3, skills: locked }, null, 2), 'utf8');
  fs.mkdirSync(path.join(home, '.fake'), { recursive: true });
  fs.writeFileSync(path.join(home, '.fake', 'settings.json'), '{}\n', 'utf8');
  for (const marker of markers) {
    const full = path.join(home, '.fake', marker);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '', 'utf8');
  }
  return home;
}

function recorded(name, extra = {}) {
  return {
    source: 'fixture/skills',
    sourceType: 'github',
    sourceUrl: 'https://github.com/fixture/skills.git',
    skillPath: `skills/${name}/SKILL.md`,
    skillFolderHash: HASH,
    ...extra,
  };
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

console.log('agentenv stale');

check('stale: sağlayıcı güncelleme bildirirse stale yazar', () => {
  const home = sandbox({ alpha: recorded('alpha') }, [path.join('upstream', 'alpha')]);
  const { code, out } = run(home, ['stale']);
  assert(code === 0, `stale ${code} ile çıktı: ${out}`);
  assert(new RegExp(`^stale +alpha \\[fixture/skills\\] — ${t.staleNewer}$`, 'm').test(out), `stale satırı yok: ${out}`);
});

check('stale: kontrol tamamlandıysa up-to-date der ve hiçbir şey yazmaz', () => {
  const home = sandbox({ alpha: recorded('alpha') });
  const before = treeHash(home);
  const { code, out } = run(home, ['stale']);
  assert(code === 0, `stale ${code} ile çıktı: ${out}`);
  assert(new RegExp(`^up-to-date +alpha \\[fixture/skills\\]$`, 'm').test(out), `up-to-date satırı yok: ${out}`);
  assert(treeHash(home) === before, 'stale sandbox ağacını değiştirdi');
});

check('stale: envanteri (yavaş taramayı) hiç okumaz', () => {
  const home = sandbox({ alpha: recorded('alpha') });
  const { out } = run(home, ['stale']);
  assert(!out.includes(t.skillsTitle), `stale envanteri okudu: ${out}`);
});

check('stale: kaynağa ulaşılamazsa unknown — sağlayıcı "güncel" dese bile', () => {
  const home = sandbox({ alpha: recorded('alpha') }, ['check-unreachable']);
  const { code, out } = run(home, ['stale']);
  assert(code === 0, `stale ${code} ile çıktı: ${out}`);
  assert(new RegExp(`^unknown +alpha \\[fixture/skills\\] — ${t.staleUnreachable('fixture/skills')}$`, 'm').test(out), `unknown satırı yok: ${out}`);
  assert(!/^up-to-date/m.test(out), `yanlış "up-to-date" yazdı: ${out}`);
});

check('stale: kontrol hiç bitmezse unknown', () => {
  const home = sandbox({ alpha: recorded('alpha') }, ['check-broken']);
  const { out } = run(home, ['stale']);
  assert(new RegExp(`^unknown +alpha \\[fixture/skills\\] — ${t.staleNotRun}$`, 'm').test(out), `unknown satırı yok: ${out}`);
});

check('stale: kayıtlı hash yoksa karşılaştırma yapmaz', () => {
  const home = sandbox({ alpha: recorded('alpha', { skillFolderHash: '' }) });
  const { out } = run(home, ['stale']);
  assert(new RegExp(`^unknown +alpha \\[fixture/skills\\] — ${t.staleNoHash}$`, 'm').test(out), `unknown satırı yok: ${out}`);
});

check('stale: kaydı (state.json) okumaz, bozuk kayıt da sonucu değiştirmez', () => {
  const home = sandbox({ alpha: recorded('alpha') });
  const file = path.join(home, '.agentenv', 'state.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ bozuk', 'utf8');
  const { code, out } = run(home, ['stale']);
  assert(code === 0, `bozuk kayıtla stale ${code} ile çıktı: ${out}`);
  assert(/^up-to-date +alpha/m.test(out), `up-to-date satırı yok: ${out}`);
  assert(fs.readFileSync(file, 'utf8') === '{ bozuk', 'bozuk state.json değiştirildi');
});

if (failures > 0) {
  console.log(`\n${failures} senaryo başarısız`);
  process.exit(1);
}
console.log('\ntüm senaryolar geçti');
