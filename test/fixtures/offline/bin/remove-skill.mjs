// Offline stand-in for `npx skills remove`: drops the skill file and its lockfile entry.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const name = process.argv[2] ?? '';
const home = os.homedir();
fs.rmSync(path.join(home, '.fake', 'skills', `${name}.md`), { force: true });
const lockPath = path.join(home, '.fake', '.skill-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  delete lock.skills[name];
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf8');
}
console.log(`removed ${name}`);
