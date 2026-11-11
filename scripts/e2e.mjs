#!/usr/bin/env node
/**
 * End-to-end check of the CLI against disposable HOMEs.
 *
 * Offline scenarios use `test/fixtures/offline` — fake harness, fake providers — so all three kinds
 * install without network and every assertion is deterministic. `--network` adds one scenario that
 * really runs `npx skills` / `npx add-mcp` against the real catalog in a temporary HOME.
 *
 *   node scripts/e2e.mjs             # offline only
 *   node scripts/e2e.mjs --network   # + real provider installs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'dist', 'cli.js');
const offlineRoot = path.join(repo, 'test', 'fixtures', 'offline');
const network = process.argv.includes('--network');

if (!fs.existsSync(cli)) {
  console.error('dist/cli.js yok — önce `npm run build`.');
  process.exit(1);
}

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

function sandbox(withHarness = true) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-e2e-'));
  if (withHarness) {
    fs.mkdirSync(path.join(home, '.fake'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.fake', 'settings.json'),
      '{\n  // kendi yorumum\n  "model": "opus",\n  "hooks": {},\n}\n',
      'utf8',
    );
  }
  return home;
}

function run(home, args, root, extraEnv = {}) {
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    AGENTENV_ROOT: root,
    ...extraEnv,
  };
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

function settingsOf(home) {
  return fs.readFileSync(path.join(home, '.fake', 'settings.json'), 'utf8');
}

/**
 * A root whose fake harness declares minimum 99 and reports whatever version the paired update script
 * wrote: the same CLI is too old at plan time and usable after its marked update, without new code.
 */
function versionedRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-e2e-root-'));
  fs.cpSync(offlineRoot, root, { recursive: true });
  const version = JSON.stringify(path.join(root, 'bin', 'fake-version.mjs'));
  const update = JSON.stringify(path.join(root, 'bin', 'fake-update.mjs'));
  fs.writeFileSync(
    path.join(root, 'requires', 'fake.yaml'),
    `id: fake
check:
  command: [node, ${version}]
  min: "99"
install:
  win32: [node, ${update}]
  darwin: [node, ${update}]
  linux: [node, ${update}]
`,
    'utf8',
  );
  return root;
}

/** A root whose requirement is absent until its install command writes the version the check reads. */
function missingRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-e2e-root-'));
  fs.cpSync(offlineRoot, root, { recursive: true });
  const check = JSON.stringify(path.join(root, 'bin', 'fake-missing-version.mjs'));
  const update = JSON.stringify(path.join(root, 'bin', 'fake-update.mjs'));
  fs.writeFileSync(
    path.join(root, 'requires', 'node.yaml'),
    `id: node
check:
  command: [node, ${check}]
  min: "20"
install:
  win32: [node, ${update}]
  darwin: [node, ${update}]
  linux: [node, ${update}]
`,
    'utf8',
  );
  return root;
}

function updatesRan(home) {
  const log = path.join(home, '.fake-updates.log');
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0;
}

/** The platform we are *not* running on, so a definition can have an install argv that is not ours. */
const otherPlatform = process.platform === 'win32' ? 'linux' : 'win32';

function copiedRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-e2e-root-'));
  fs.cpSync(offlineRoot, root, { recursive: true });
  return root;
}

/**
 * A harness whose requirement declares a minimum this CLI does not meet and an install argv only for
 * another platform: the default installation cannot happen here, and no second path may be invented.
 */
function noInstallerRoot() {
  const root = copiedRoot();
  fs.writeFileSync(
    path.join(root, 'requires', 'fake.yaml'),
    `id: fake
check:
  command: [node, --version]
  min: "99"
install:
  ${otherPlatform}: [npm, install, -g, "@fake/harness"]
`,
    'utf8',
  );
  return root;
}

/** Two harnesses: the fake one cannot be installed here, a second one is fine. Same items, both. */
function twoHarnessRoot() {
  const root = noInstallerRoot();
  fs.writeFileSync(
    path.join(root, 'harnesses', 'fake2.yaml'),
    `id: fake2
label: Second Harness
detect:
  - ~/.fake2
agentId: fake2
requires: [fake2]
config:
  path: ~/.fake2/settings.json
  format: jsonc
skills:
  path: ~/.fake2/skills
mcp:
  path: ~/.fake2/mcp.json
  key: mcpServers
`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'requires', 'fake2.yaml'),
    `id: fake2
check:
  command: [node, --version]
  min: "20"
install:
  ${otherPlatform}: [npm, install, -g, "@fake/second"]
`,
    'utf8',
  );
  for (const provider of ['fake-skills', 'fake-mcp']) {
    const file = path.join(root, 'providers', `${provider}.yaml`);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('supports: [fake]', 'supports: [fake, fake2]'), 'utf8');
  }
  return root;
}

console.log('offline (ağ yok, sahte harness)');

const home = sandbox();
const PASS = ['apply', '--yes'];

check('plan üç öğeyi de yapılacak olarak gösterir', () => {
  const { out, code } = run(home, ['plan'], offlineRoot);
  assert(code === 0, `çıkış kodu ${code}: ${out}`);
  assert(/\+ skill-a → fake/.test(out), 'skill satırı yok');
  assert(/\+ mcp-a → fake/.test(out), 'mcp satırı yok');
  assert(/\+ hook-a → fake/.test(out), 'hook satırı yok');
});

check('plan ve status hiçbir şey yazmaz', () => {
  const before = treeHash(home);
  run(home, ['plan'], offlineRoot);
  run(home, ['status'], offlineRoot);
  assert(treeHash(home) === before, 'plan/status sandboxı değiştirdi');
});

check('apply üç türü de kurar', () => {
  const { out, code } = run(home, PASS, offlineRoot);
  assert(code === 0, `çıkış kodu ${code}: ${out}`);
  assert(/installed {2}skill-a/.test(out), 'skill kurulmadı');
  assert(/installed {2}mcp-a/.test(out), 'mcp kurulmadı');
  assert(/installed {2}hook-a/.test(out), 'hook kurulmadı');
  assert(fs.existsSync(path.join(home, '.fake', 'skills', 'alpha.md')), 'skill dosyası yok');
  assert(JSON.parse(fs.readFileSync(path.join(home, '.fake', 'mcp.json'), 'utf8')).mcpServers['mcp-a'], 'mcp girdisi yok');
});

check('hook yorumları ve diğer ayarları korur', () => {
  const text = settingsOf(home);
  assert(text.includes('// kendi yorumum'), 'yorum kayboldu');
  assert(text.includes('"model": "opus"'), 'mevcut ayar kayboldu');
  assert(text.includes('PreToolUse'), 'hook eklenmedi');
});

check('status üçünü de güncel gösterir', () => {
  const { out } = run(home, ['status'], offlineRoot);
  const upToDate = out.split('\n').filter((line) => line.startsWith('up-to-date')).length;
  assert(upToDate === 3, `güncel satır sayısı ${upToDate}: ${out}`);
});

check('status harness bölümünde sürümü ve asgari sürümü gösterir', () => {
  const { out, code } = run(home, ['status'], offlineRoot);
  assert(code === 0, `çıkış kodu ${code}: ${out}`);
  assert(/^harnesses$/m.test(out), `harness başlığı yok: ${out}`);
  assert(/^ready {2}fake {2}\d+\.\d+\.\d+ · min 20$/m.test(out), `hazır harness satırı yok: ${out}`);
});

check('status asgari sürümün altındaki harness için güncelleme komutunu gösterir', () => {
  // Same fixture, one number raised: the declared minimum is now above the version the CLI prints.
  const strictRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-e2e-root-'));
  fs.cpSync(offlineRoot, strictRoot, { recursive: true });
  fs.writeFileSync(
    path.join(strictRoot, 'requires', 'fake.yaml'),
    `id: fake
check:
  command: [node, --version]
  min: "99"
install:
  win32: [npm, install, -g, "@fake/harness"]
  darwin: [npm, install, -g, "@fake/harness"]
  linux: [npm, install, -g, "@fake/harness"]
`,
    'utf8',
  );
  const { out, code } = run(home, ['status'], strictRoot);
  assert(code === 0, `çıkış kodu ${code}: ${out}`);
  assert(/^too old {2}fake {2}\d+\.\d+\.\d+ · min 99$/m.test(out), `eski harness satırı yok: ${out}`);
  assert(/update: npm install -g @fake\/harness/.test(out), `güncelleme komutu yok: ${out}`);
});

check('status bulunmayan harness için absent der, hata vermez', () => {
  const empty = sandbox(false);
  const { out, code } = run(empty, ['status'], offlineRoot);
  assert(code === 0, `çıkış kodu ${code}: ${out}`);
  assert(/^absent {2}fake$/m.test(out), `absent satırı yok: ${out}`);
});

check('plan eski harness\'ı sürüm, asgari ve güncelleme komutuyla gösterir, öğeleri bloklar', () => {
  const old = sandbox();
  const root = versionedRoot();
  const before = treeHash(old);
  const { out, code } = run(old, ['plan'], root);
  assert(code === 0, `çıkış kodu ${code}: ${out}`);
  assert(
    /^too old {2}requirement Fake Harness 1\.0\.0 · min 99 → node .*fake-update\.mjs$/m.test(out),
    `gereksinim satırı yok: ${out}`,
  );
  const blocked = (out.match(/blocked: requirement not met: fake/g) ?? []).length;
  assert(blocked === 3, `bloklu öğe sayısı ${blocked}: ${out}`);
  assert(treeHash(old) === before, 'plan sandboxı değiştirdi');
  assert(updatesRan(old) === 0, 'güncelleme plan sırasında çalıştı');
});

check('--update yok: eski harness güncellenmez, öğeler bloklu kalır, hiçbiri kurulmaz', () => {
  const blocked = sandbox();
  const root = versionedRoot();
  const before = treeHash(blocked);
  const { out, code } = run(blocked, PASS, root);
  assert(code === 1, `çıkış kodu 1 değil: ${code}: ${out}`);
  assert(/the fake update was not marked, so it was not run/.test(out), `sebep yok: ${out}`);
  const reasons = (out.match(/requirement not met: fake/g) ?? []).length;
  assert(reasons === 3, `bloklu öğe sayısı ${reasons}: ${out}`);
  assert(updatesRan(blocked) === 0, 'markalanmayan güncelleme çalıştı');
  assert(!fs.existsSync(path.join(blocked, '.fake-updates.log')), 'güncelleme günlüğü oluşturuldu');
  assert(!fs.existsSync(path.join(blocked, '.fake', 'skills', 'alpha.md')), 'bloklu skill kuruldu');
  assert(treeHash(blocked) === before, 'hiçbir şey kurulmamalı');
});

check('eksik ön koşul işaretsiz apply --yes ile kurulur, öğeler devam eder', () => {
  const bootstrapped = sandbox();
  const root = missingRoot();
  const { out, code } = run(bootstrapped, PASS, root);
  assert(code === 0, `çıkış kodu ${code}: ${out}`);
  assert(updatesRan(bootstrapped) === 1, `kurulum ${updatesRan(bootstrapped)} kez çalıştı`);
  assert(fs.readFileSync(path.join(bootstrapped, '.fake-version'), 'utf8').trim() === '99.0.0', 'kurulum sürümü yazmadı');
  assert((out.match(/^installed {2}/gm) ?? []).length === 3, `üç kurulum yok: ${out}`);
});

check('--update all işaretlenen güncellemeyi bir kez çalıştırır, sürüm yeniden okunur, öğeler kurulur', () => {
  const fixed = sandbox();
  const root = versionedRoot();
  const { out, code } = run(fixed, ['apply', '--yes', '--update', 'all'], root);
  assert(code === 0, `çıkış kodu ${code}: ${out}`);
  assert((out.match(/^installed {2}/gm) ?? []).length === 3, `üç kurulum yok: ${out}`);
  assert(updatesRan(fixed) === 1, `güncelleme ${updatesRan(fixed)} kez çalıştı`);
  assert(fs.readFileSync(path.join(fixed, '.fake-version'), 'utf8').trim() === '99.0.0', 'güncelleme sürümü yazmadı');
  const status = run(fixed, ['status'], root).out;
  assert((status.match(/^up-to-date/gm) ?? []).length === 3, `status üçünü güncel göstermedi: ${status}`);
});

check('plan: bu platformda kurulum komutu olmayan harness için "no install command" der', () => {
  const home = sandbox();
  const root = noInstallerRoot();
  const { out, code } = run(home, ['plan'], root);
  assert(code === 0, `çıkış kodu ${code}: ${out}`);
  assert(
    /^too old {2}requirement Fake Harness \d+\.\d+\.\d+ · min 99 — no install command for this platform$/m.test(out),
    `gereksinim satırı yok: ${out}`,
  );
  assert(!new RegExp(`${otherPlatform} install -g`).test(out), `başka platformun komutu önerildi: ${out}`);
});

check('apply: kurulum komutu olmayan harness\'ı raporlar, öğelerini kurmaz, çıkış kodu 1', () => {
  const home = sandbox();
  const root = noInstallerRoot();
  const { out, code } = run(home, PASS, root);
  assert(code === 1, `çıkış kodu 1 değil: ${code}: ${out}`);
  assert(/requirement fake: no install command for this platform/.test(out), `sebep söylenmedi: ${out}`);
  assert(!fs.existsSync(path.join(home, '.fake', 'skills')), 'kurulamayan harness için skill kuruldu');
});

check('kurulamayan harness diğer harness\'ın öğelerini bırakmaz', () => {
  const home = sandbox();
  const root = twoHarnessRoot();
  const { out, code } = run(home, ['apply', '--yes', '--harness', 'fake,fake2'], root);
  assert(code === 1, `çıkış kodu 1 değil: ${code}: ${out}`);
  assert(/installed {2}skill-a → fake2/.test(out), `diğer harness kurulmadı: ${out}`);
  assert(/installed {2}mcp-a → fake2/.test(out), `diğer harness mcp kurulmadı: ${out}`);
  assert(/error {2}skill-a → fake \(requirement not met: fake\)/.test(out), `kurulamayan harness hata vermedi: ${out}`);
  assert(!/requirement fake2:/.test(out), `sağlıklı harness'ın ön koşulu hata verdi: ${out}`);
  assert(fs.existsSync(path.join(home, '.fake', 'skills', 'alpha.md')), 'diğer harness skill dosyası yok');
});

check('ikinci apply hiçbir şeyi değiştirmez', () => {
  const before = treeHash(home);
  const { out, code } = run(home, PASS, offlineRoot);
  assert(code === 0, `çıkış kodu ${code}: ${out}`);
  assert((out.match(/already installed/g) ?? []).length === 3, 'hepsi already değil');
  assert(treeHash(home) === before, 'tekrar çalıştırma dosya değiştirdi');
});

check('elle silinen skill "eksik" görünür ve yeniden kurulur', () => {
  const lockPath = path.join(home, '.fake', '.skill-lock.json');
  fs.rmSync(path.join(home, '.fake', 'skills', 'alpha.md'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  delete lock.skills.alpha;
  fs.writeFileSync(lockPath, JSON.stringify(lock), 'utf8');

  const status = run(home, ['status'], offlineRoot).out;
  assert(/^missing +skill-a/m.test(status), `status eksik demedi: ${status}`);

  const plan = run(home, ['plan'], offlineRoot).out;
  assert(/\+ skill-a → fake/.test(plan), 'plan yeniden kurmayı önermedi');

  run(home, PASS, offlineRoot);
  assert(fs.existsSync(path.join(home, '.fake', 'skills', 'alpha.md')), 'skill geri kurulmadı');
});

/** A root whose skill installer exits 0 without writing anything: the install left no trace. */
function lyingInstallerRoot() {
  const root = copiedRoot();
  fs.writeFileSync(path.join(root, 'bin', 'install-skill.mjs'), "console.log('pretend installed');", 'utf8');
  return root;
}

check('kurulum hiçbir şey yazmazsa "installed" denmez ve kaydedilmez', () => {
  const home = sandbox();
  const root = lyingInstallerRoot();
  const { out, code } = run(home, PASS, root);
  assert(code === 1, `çıkış kodu 1 değil: ${code}: ${out}`);
  assert(/error {2}skill-a → fake \(the install reported success, but the provider inventory does not show it/.test(out), `hata sebebi yok: ${out}`);
  assert(/installed {2}mcp-a/.test(out), 'diğer öğe kurulmadı');
  const state = JSON.parse(fs.readFileSync(path.join(home, '.agentenv', 'state.json'), 'utf8'));
  assert(!state.entries.some((entry) => entry.kind === 'skill'), 'kurulmayan skill kaydedildi');
  assert(
    state.entries.some((entry) => entry.itemId === 'mcp-a'),
    'kurulan mcp kaydedilmedi',
  );
});

check('bozuk settings.json: hata verir, dosyayı değiştirmez', () => {
  const broken = sandbox();
  fs.writeFileSync(path.join(broken, '.fake', 'settings.json'), '{ bozuk', 'utf8');
  const { out, code } = run(broken, ['apply', '--yes', '--harness', 'fake'], offlineRoot);
  assert(code === 1, `çıkış kodu 1 değil: ${code}`);
  assert(/not readable JSONC/.test(out), `hata mesajı yok: ${out}`);
  assert(settingsOf(broken) === '{ bozuk', 'bozuk dosya değişti');
  assert(!fs.existsSync(path.join(broken, '.agentenv', 'backups')), 'bozuk dosya için yedek alınmış');
});

check('bozuk state.json: plan yazmaz ve uyarır, apply yedekleyip kaydeder', () => {
  const damaged = sandbox();
  fs.mkdirSync(path.join(damaged, '.agentenv'), { recursive: true });
  fs.writeFileSync(path.join(damaged, '.agentenv', 'state.json'), '{ bozuk', 'utf8');

  const plan = run(damaged, ['plan'], offlineRoot);
  assert(/state\.json/.test(plan.out), `uyarı yok: ${plan.out}`);
  assert(!fs.existsSync(path.join(damaged, '.agentenv', 'backups')), 'plan yedek aldı');

  run(damaged, PASS, offlineRoot);
  const backups = fs.readdirSync(path.join(damaged, '.agentenv', 'backups'));
  assert(backups.length >= 1, 'yedek alınmadı');
  const saved = path.join(damaged, '.agentenv', 'backups', backups[0], 'state.json');
  assert(fs.readFileSync(saved, 'utf8') === '{ bozuk', 'bozuk state yedeklenmedi');
});

check('eksik ön koşul: öğeler kurulmaz, sebep söylenir', () => {
  const empty = sandbox();
  // Empty PATH hides `node` from the requirement check while the CLI itself runs by absolute path.
  const noTools = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-e2e-nopath-'));
  const { out, code } = run(empty, PASS, offlineRoot, { PATH: noTools });
  assert(code === 1, `çıkış kodu 1 değil: ${code}`);
  assert(/requirement/.test(out), `ön koşul mesajı yok: ${out}`);
  assert(!fs.existsSync(path.join(empty, '.fake', 'skills')), 'ön koşul yokken skill kuruldu');
});

check('remove hepsinden kaldırır ve kaydı boşaltır', () => {
  const { out, code } = run(home, ['remove', '--yes'], offlineRoot);
  assert(code === 0, `çıkış kodu ${code}: ${out}`);
  assert(!fs.existsSync(path.join(home, '.fake', 'skills', 'alpha.md')), 'skill dosyası kaldı');
  assert(!fs.existsSync(path.join(home, '.fake', 'mcp.json')) || !JSON.parse(fs.readFileSync(path.join(home, '.fake', 'mcp.json'), 'utf8')).mcpServers?.['mcp-a'], 'mcp girdisi kaldı');
  assert(!/PreToolUse/.test(settingsOf(home)), 'hook ayarı kaldı');
  assert(/record is empty/.test(run(home, ['status'], offlineRoot).out), 'kayıt boşalmadı');
});

if (network) {
  console.log('network (gerçek npx skills / add-mcp, geçici HOME)');
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-e2e-net-'));
  fs.mkdirSync(path.join(real, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(real, '.claude', 'settings.json'), '{\n  // yorum\n  "model": "opus"\n}\n', 'utf8');

  check('gerçek sağlayıcılarla kurulum', () => {
    const { out, code } = run(real, ['apply', '--yes'], repo);
    assert(code === 0, `çıkış kodu ${code}: ${out}`);
    assert((out.match(/installed/g) ?? []).length === 3, `üç kurulum yok: ${out}`);
    assert(/PreToolUse/.test(fs.readFileSync(path.join(real, '.claude', 'settings.json'), 'utf8')), 'hook yazılmadı');
  });

  check('gerçek kurulum sonrası status güncel der', () => {
    const { out } = run(real, ['status'], repo);
    const upToDate = out.split('\n').filter((line) => line.startsWith('up-to-date')).length;
    assert(upToDate === 3, `güncel satır sayısı ${upToDate}: ${out}`);
  });

  check('gerçek kurulum ikinci kez hiçbir şey yapmaz', () => {
    const { out } = run(real, ['apply', '--yes'], repo);
    assert((out.match(/already installed/g) ?? []).length === 3, `already sayısı yanlış: ${out}`);
  });
}

console.log(failures === 0 ? '\ntüm e2e senaryoları geçti' : `\n${failures} senaryo başarısız`);
process.exit(failures === 0 ? 0 : 1);
