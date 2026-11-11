// Offline stand-in for `npx skills check -g`: it answers out of the sandbox's own lockfile and
// marker files, printing the same lines the real (v1.8.1) subcommand prints — including its habit of
// saying "all up to date" even when a source could not be checked at all.
//
//   ~/.fake/.skill-lock.json        the lockfile the scenario wrote (source, skillPath, skillFolderHash)
//   ~/.fake/upstream/<name>         marks a skill whose source now holds a newer copy
//   ~/.fake/check-unreachable       every recorded source fails to resolve
//   ~/.fake/check-broken            the run dies without printing its summary
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const fake = path.join(home, '.fake');
const lockPath = path.join(fake, '.skill-lock.json');
const mark = (name) => fs.existsSync(path.join(fake, name));

console.log('Checking for skill updates…');
console.log('');

const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : { skills: {} };
const entries = Object.entries(lock.skills ?? {}).filter(([, entry]) => entry && typeof entry === 'object');
const sources = [...new Set(entries.map(([, entry]) => entry.source).filter(Boolean))];

if (mark('check-broken')) {
  console.error('skills: something else went wrong');
  process.exit(1);
}

if (mark('check-unreachable')) {
  for (const source of sources) console.log(`Checking skills from source: ${source}`);
  for (const source of sources) console.log(`  ✗ Failed to check skills from ${source}`);
  console.log('✓ All global skills are up to date');
  process.exit(0);
}

const outdated = [];
const unchecked = [];
for (const [name, entry] of entries) {
  if (!entry.skillPath || !entry.skillFolderHash) unchecked.push(name);
  else if (mark(path.join('upstream', name))) outdated.push(name);
}

for (const source of sources) console.log(`Checking skills from source: ${source}`);
for (const name of outdated) console.log(`↑ ${name} has an update`);
if (unchecked.length > 0) {
  console.log('');
  console.log(`${unchecked.length} skill(s) cannot be checked automatically:`);
  for (const name of unchecked) console.log(`  • ${name} (Local path)`);
}
console.log('');
if (outdated.length > 0) {
  console.log(`${outdated.length} skill(s) can be updated; run npx skills update to install`);
  process.exit(1);
}
console.log('✓ All global skills are up to date');
