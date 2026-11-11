// Offline stand-in for `npx skills add`: writes a skill file and its lockfile entry.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const source = process.argv[2] ?? 'unknown/source';
const skill = process.argv[3];
const name = skill || source.replace(/[^\w.-]+/g, '-');
const home = os.homedir();
const dir = path.join(home, '.fake', 'skills');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${name}.md`), `installed from ${source}\n`, 'utf8');

const lockPath = path.join(home, '.fake', '.skill-lock.json');
const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : { skills: {} };
lock.skills[name] = { source };
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf8');
console.log(`installed ${name}`);
