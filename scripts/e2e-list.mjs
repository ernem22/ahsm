#!/usr/bin/env node
/**
 * End-to-end check of `agentenv list` — the read-only skill inventory surface.
 *
 * `list` asks the skills provider what is installed, so it is the one command whose answer is not
 * limited to what agentenv itself did. That also means its output includes whatever the machine's real
 * `~/.agents` store holds, so these scenarios assert the scan's *behaviour* (it runs, it names a
 * hand-installed skill, it writes nothing, it survives a damaged record) rather than an exact inventory.
 *
 *   node scripts/e2e-list.mjs      # offline: no network, no provider installs
 *
 * Requires `npm run build` first. Not wired into `npm run e2e` yet.
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

/** A disposable HOME holding one skill installed by hand, i.e. outside agentenv. */
function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-e2e-list-'));
  const skill = path.join(home, '.claude', 'skills', 'by-hand');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: by-hand\ndescription: installed by hand\n---\n', 'utf8');
  fs.mkdirSync(path.join(home, '.fake'), { recursive: true });
  fs.writeFileSync(path.join(home, '.fake', 'settings.json'), '{}\n', 'utf8');
  return home;
}

function run(home, args) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, AGENTENV_ROOT: offlineRoot };
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

console.log('agentenv list');

check('list elle kurulmuş skill\'i adıyla ve kapsamıyla gösterir', () => {
  const home = sandbox();
  const { code, out } = run(home, ['list']);
  assert(code === 0, `list ${code} ile çıktı: ${out}`);
  assert(out.includes(t.skillsTitle), `başlık yok: ${out}`);
  assert(new RegExp(`^${t.scopeLabels.user} +by-hand `, 'm').test(out), `by-hand satırı yok: ${out}`);
});

check('list hiçbir şey yazmaz', () => {
  const home = sandbox();
  const before = treeHash(home);
  run(home, ['list']);
  assert(treeHash(home) === before, 'list sandbox ağacını değiştirdi');
});

check('bozuk state.json listeyi bozmaz ve dosyaya dokunulmaz', () => {
  const home = sandbox();
  const file = path.join(home, '.agentenv', 'state.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ bozuk', 'utf8');
  const { code, out } = run(home, ['list']);
  assert(code === 0, `bozuk kayıtla list ${code} ile çıktı: ${out}`);
  assert(out.includes('by-hand'), `bozuk kayıtla by-hand satırı yok: ${out}`);
  assert(fs.readFileSync(file, 'utf8') === '{ bozuk', 'bozuk state.json değiştirildi');
});

check('plan ve status envanteri okumaz', () => {
  const home = sandbox();
  for (const command of ['plan', 'status']) {
    const { out } = run(home, [command]);
    assert(!out.includes(t.skillsTitle), `${command} envanteri okudu: ${out}`);
    assert(!/by-hand/.test(out), `${command} envanterdeki skill'i listeledi: ${out}`);
  }
});

if (failures > 0) {
  console.log(`\n${failures} senaryo başarısız`);
  process.exit(1);
}
console.log('\ntüm senaryolar geçti');
