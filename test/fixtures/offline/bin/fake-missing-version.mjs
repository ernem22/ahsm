// Offline stand-in for a CLI that is not installed at all: exits 1 (no usable version) until the
// bootstrap install writes a version, so a test can tell a missing requirement from an outdated one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const file = path.join(os.homedir(), '.fake-version');
if (!fs.existsSync(file)) process.exit(1);
console.log(fs.readFileSync(file, 'utf8').trim());
