import fs from 'node:fs';
import path from 'node:path';
import type { Ctx } from '../context.js';
import { backupFile } from '../core/state.js';

/** The one way ahsm puts text into a config file: back up, ensure the directory, write. */
export function writeConfigFile(ctx: Ctx, file: string, text: string): void {
  backupFile(ctx, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}
