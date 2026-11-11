// Offline stand-in for `npm install -g @fake/harness`: raises the version the harness reports and
// appends one line to a log, so a test can tell "ran once" from "ran twice" or "did not run".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
fs.writeFileSync(path.join(home, '.fake-version'), '99.0.0\n', 'utf8');
fs.appendFileSync(path.join(home, '.fake-updates.log'), 'update\n', 'utf8');
console.log('updated fake harness');
