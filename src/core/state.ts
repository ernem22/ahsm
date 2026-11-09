import fs from 'node:fs';
import path from 'node:path';
import type { Ctx } from '../context.js';
import type { Kind } from '../types.js';

export interface StateEntry {
  itemId: string;
  kind: Kind;
  harness: string;
  providerId: string;
  /** The exact argv that was run, kept as-is so a space inside an argument cannot corrupt it. */
  command?: string[];
  at: string;
}

export interface State {
  version: 1;
  entries: StateEntry[];
}

export function sameCommand(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((part, index) => part === b[index]);
}

export function stateKey(itemId: string, harness: string): string {
  return `${itemId}|${harness}`;
}

export function stateDir(ctx: Ctx): string {
  return path.join(ctx.home, '.agentenv');
}

export function statePath(ctx: Ctx): string {
  return path.join(stateDir(ctx), 'state.json');
}

export function readState(ctx: Ctx): State {
  const file = statePath(ctx);
  if (!fs.existsSync(file)) return { version: 1, entries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as State;
    return { version: 1, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

/** Atomic write: tmp file + rename, so a crash never leaves half a state file. */
export function writeState(ctx: Ctx, state: State): void {
  const file = statePath(ctx);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

export function recordEntry(ctx: Ctx, state: State, entry: Omit<StateEntry, 'at'>): State {
  const at = ctx.now().toISOString();
  const key = stateKey(entry.itemId, entry.harness);
  const entries = state.entries.filter((existing) => stateKey(existing.itemId, existing.harness) !== key);
  entries.push({ ...entry, at });
  const next: State = { version: 1, entries };
  writeState(ctx, next);
  return next;
}

/** Copies the target file (if any) under `~/.agentenv/backups/<timestamp>/` before a write. */
export function backupFile(ctx: Ctx, file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const stamp = ctx.now().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(stateDir(ctx), 'backups', stamp, path.basename(file));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  return dest;
}
