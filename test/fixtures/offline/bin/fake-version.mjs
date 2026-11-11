// Offline stand-in for a harness CLI's version command: prints the version the update script wrote,
// so a fixture harness can be too old at plan time and usable after its marked update. Nothing else
// in the fixture pretends to be a real harness.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const file = path.join(os.homedir(), '.fake-version');
console.log(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '1.0.0');
