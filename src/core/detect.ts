import fs from 'node:fs';
import path from 'node:path';
import { expandPath, type Ctx } from '../context.js';
import type { Data, HarnessDef } from '../types.js';

export interface DetectedHarness {
  def: HarnessDef;
  present: boolean;
}

function onPath(binary: string, platform: NodeJS.Platform): boolean {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const exts = platform === 'win32' ? ['', '.cmd', '.exe', '.bat'] : [''];
  return dirs.some((dir) => exts.some((ext) => fs.existsSync(path.join(dir, `${binary}${ext}`))));
}

function probe(entry: string, ctx: Ctx): boolean {
  if (entry.startsWith('path:')) return onPath(entry.slice('path:'.length), ctx.platform);
  return fs.existsSync(expandPath(entry, ctx.home));
}

/** A harness is present when any of its probes hit (config dir or CLI binary). */
export function detectHarnesses(data: Data, ctx: Ctx): DetectedHarness[] {
  return data.harnesses.map((def) => ({ def, present: def.detect.some((entry) => probe(entry, ctx)) }));
}
