#!/usr/bin/env node
/**
 * End-to-end check of `agentenv remove` — the one surface that answers both removal cases with the same
 * rules: everything the record holds, and a skill the user names that agentenv may never have installed.
 *
 *   node scripts/e2e-remove.mjs      # offline: no network, no provider installs
 *
 * Every scenario runs the real CLI against a disposable HOME and the `test/fixtures/offline` root, so
 * the assertions are about what a reviewer sees: the plan's lines, the files left on disk, and the
 * record `status` reads afterwards. Requires `npm run build` first.
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
/** The fixture package: skill, MCP and hook, so every kind of recorded removal is exercised. */
const INSTALL = ['apply', '--yes', '--harness', 'fake'];

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

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-e2e-remove-'));
  fs.mkdirSync(path.join(home, '.fake'), { recursive: true });
  fs.writeFileSync(path.join(home, '.fake', 'settings.json'), '{}\n', 'utf8');
  return home;
}

/** A skill installed outside agentenv: a file and a lockfile entry, no record anywhere. */
function handInstall(home, name) {
  const dir = path.join(home, '.fake', 'skills');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.md`), `installed by hand\n`, 'utf8');
  const lockPath = path.join(home, '.fake', '.skill-lock.json');
  const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : { skills: {} };
  lock.skills[name] = { source: 'by/hand' };
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf8');
  return lockPath;
}

/** A copy of the fixture root with one file replaced, so a scenario can bend the fake provider. */
function copiedRoot(rewrite) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-e2e-remove-root-'));
  fs.cpSync(offlineRoot, root, { recursive: true });
  rewrite(root);
  return root;
}

function run(home, args, root = offlineRoot) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, AGENTENV_ROOT: root };
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

function stateOf(home) {
  const file = path.join(home, '.agentenv', 'state.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { entries: [] };
}

console.log('agentenv remove');

check('remove onaydan önce etkilenen harness\'ları ve dizinleri gösterir, hiçbir şey yazmaz', () => {
  const home = sandbox();
  const install = run(home, INSTALL);
  assert(install.code === 0, `kurulum ${install.code} ile çıktı: ${install.out}`);

  const before = treeHash(home);
  const { code, out } = run(home, ['remove']);
  assert(code === 0, `remove ${code} ile çıktı: ${out}`);
  // Every recorded item is offered, with the harnesses and the real directories it touches.
  for (const item of ['skill-a', 'mcp-a', 'hook-a']) {
    assert(out.includes(`- ${item} [`), `${item} planda yok: ${out}`);
  }
  assert(out.includes(t.removePlanLabels.remove), `kaldırma satırı yok: ${out}`);
  assert(out.includes(`    ${t.removeAffects(['fake'])}`), `etkilenen harness satırı yok: ${out}`);
  assert(out.includes(path.join(home, '.fake', 'skills')), `skill dizini gösterilmedi: ${out}`);
  assert(out.includes(path.join(home, '.fake', 'mcp.json')), `mcp dosyası gösterilmedi: ${out}`);
  assert(out.includes(path.join(home, '.fake', 'settings.json')), `hook dosyası gösterilmedi: ${out}`);
  assert(out.includes(t.removeHint), `onay ipucu yok: ${out}`);
  assert(treeHash(home) === before, 'onaysız remove sandbox ağacını değiştirdi');
  assert(stateOf(home).entries.length === 3, 'onaysız remove kaydı boşalttı');
});

check('remove --yes her kayıtlı öğeyi kaldırır ve kaydı boşaltır', () => {
  const home = sandbox();
  run(home, INSTALL);
  const { code, out } = run(home, ['remove', '--yes']);
  assert(code === 0, `remove --yes ${code} ile çıktı: ${out}`);
  assert((out.match(new RegExp(`^${t.removeLabels.removed} `, 'gm')) ?? []).length === 3, `üç kaldırma yok: ${out}`);
  assert(!fs.existsSync(path.join(home, '.fake', 'skills', 'alpha.md')), 'skill dosyası kaldı');
  const mcp = path.join(home, '.fake', 'mcp.json');
  assert(!fs.existsSync(mcp) || !JSON.parse(fs.readFileSync(mcp, 'utf8')).mcpServers?.['mcp-a'], 'mcp girdisi kaldı');
  assert(!/PreToolUse/.test(fs.readFileSync(path.join(home, '.fake', 'settings.json'), 'utf8')), 'hook ayarı kaldı');
  // No ghosts: the record and status agree with the disk.
  assert(stateOf(home).entries.length === 0, 'kayıt boşalmadı');
  assert(run(home, ['status']).out.includes(t.statusEmpty), 'status kaydı boş göstermiyor');
});

check('agentenv\'in kurmadığı skill adıyla kaldırılır', () => {
  const home = sandbox();
  const lockPath = handInstall(home, 'by-hand');

  const dry = run(home, ['remove', '--skill', 'by-hand']);
  assert(dry.code === 0, `remove --skill ${dry.code} ile çıktı: ${dry.out}`);
  assert(dry.out.includes(`- by-hand [skill] → ${t.removePlanLabels.remove}`), `ad satırı yok: ${dry.out}`);
  assert(dry.out.includes(`remove-skill.mjs by-hand`), `sağlayıcı komutu gösterilmedi: ${dry.out}`);
  assert(dry.out.includes(path.join(home, '.fake', 'skills')), `skill dizini gösterilmedi: ${dry.out}`);
  assert(!fs.existsSync(path.join(home, '.agentenv')), 'onaysız adlandırılmış remove kayıt yarattı');

  const { code, out } = run(home, ['remove', '--skill', 'by-hand', '--yes']);
  assert(code === 0, `remove --skill --yes ${code} ile çıktı: ${out}`);
  assert(out.includes(`${t.removeLabels.removed}  by-hand`), `kaldırma satırı yok: ${out}`);
  assert(!fs.existsSync(path.join(home, '.fake', 'skills', 'by-hand.md')), 'elle kurulan skill dosyası kaldı');
  assert(!JSON.parse(fs.readFileSync(lockPath, 'utf8')).skills['by-hand'], 'lockfile girdisi kaldı');
  assert(run(home, ['status']).out.includes(t.statusEmpty), 'status boş kayıt göstermiyor');
  assert(!fs.existsSync(path.join(home, '.agentenv', 'state.json')), 'kayıtsız kaldırma kayıt yarattı');
});

check('kaldırılamayan ad raporlanır, kalan adlar kaldırılır', () => {
  const home = sandbox();
  handInstall(home, 'boom');
  handInstall(home, 'by-hand');
  // A provider that fails for one name only: the run must report it and keep going.
  const root = copiedRoot((dir) => {
    fs.writeFileSync(
      path.join(dir, 'bin', 'remove-skill.mjs'),
      [
        "import fs from 'node:fs';",
        "import os from 'node:os';",
        "import path from 'node:path';",
        "const name = process.argv[2] ?? '';",
        "if (name === 'boom') { console.error('boom cannot remove'); process.exit(1); }",
        "fs.rmSync(path.join(os.homedir(), '.fake', 'skills', `${name}.md`), { force: true });",
        'console.log(`removed ${name}`);',
        '',
      ].join('\n'),
      'utf8',
    );
  });

  const { code, out } = run(home, ['remove', '--skill', 'boom,by-hand', '--yes'], root);

  assert(code === 1, `hata varken çıkış kodu ${code}: ${out}`);
  assert(out.includes(`${t.removeLabels.error}  boom (boom cannot remove)`), `hata satırı yok: ${out}`);
  assert(out.includes(`${t.removeLabels.removed}  by-hand`), `diğer ad kaldırılmadı: ${out}`);
  assert(!fs.existsSync(path.join(home, '.fake', 'skills', 'by-hand.md')), 'kaldırılan skill dosyası kaldı');
  assert(fs.existsSync(path.join(home, '.fake', 'skills', 'boom.md')), 'başarısız kaldırma dosyayı sildi');
});

check('kaldıracak sağlayıcı yoksa "not covered" denir ve çalıştırma durmaz', () => {
  const home = sandbox();
  handInstall(home, 'by-hand');
  // A skill provider with no remove argv: the plan must say so instead of inventing a command.
  const root = copiedRoot((dir) => {
    const file = path.join(dir, 'providers', 'fake-skills.yaml');
    const kept = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !line.startsWith('remove:'))
      .join('\n');
    fs.writeFileSync(file, kept, 'utf8');
  });

  const { code, out } = run(home, ['remove', '--skill', 'by-hand', '--yes'], root);

  assert(code === 0, `not covered çıkış kodu ${code}: ${out}`);
  assert(
    out.includes(`${t.removeLabels['not-covered']}  by-hand (${t.removeNotCovered('skill')})`),
    `not covered satırı yok: ${out}`,
  );
  assert(fs.existsSync(path.join(home, '.fake', 'skills', 'by-hand.md')), 'sağlayıcı yokken dosya silindi');
});

if (failures > 0) {
  console.log(`\n${failures} senaryo başarısız`);
  process.exit(1);
}
console.log('\ntüm senaryolar geçti');
