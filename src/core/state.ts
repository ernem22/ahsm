import fs from 'node:fs';
import path from 'node:path';
import type { Ctx } from '../context.js';
import { t } from '../i18n.js';
import type { EntryRef, Kind } from '../types.js';

export interface StateEntry {
  itemId: string;
  kind: Kind;
  harness: string;
  providerId: string;
  /** The exact argv that was run, kept as-is so a space inside an argument cannot corrupt it. */
  command?: string[];
  /** For hooks: the command string we wrote, so a later change replaces it instead of adding a twin. */
  hookCommand?: string;
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

function stateKey(itemId: string, harness: string): string {
  return `${itemId}|${harness}`;
}

export function findEntry(state: State, itemId: string, harness: string): StateEntry | undefined {
  const key = stateKey(itemId, harness);
  return state.entries.find((entry) => stateKey(entry.itemId, entry.harness) === key);
}

export function stateDir(ctx: Ctx): string {
  return path.join(ctx.home, '.agentenv');
}

export function statePath(ctx: Ctx): string {
  return path.join(stateDir(ctx), 'state.json');
}

export interface StateRead {
  state: State;
  /** Set when the stored state could not be read or parsed. The file itself is left untouched. */
  warning?: string;
  /**
   * Set when the file exists but is unusable, so a write would erase it.
   * 'read': the file could not be read (permission or I/O error). 'parse': it was read but is not valid state.
   */
  damaged?: 'read' | 'parse';
}

/** Read-only: plan and status call this, so it never writes. Apply backs up a `damaged` file before recording. */
export function readState(ctx: Ctx): StateRead {
  const file = statePath(ctx);
  const empty: State = { version: 1, entries: [] };

  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: empty };
    return { state: empty, warning: t.stateNotReadable(file), damaged: 'read' };
  }

  try {
    const parsed = JSON.parse(raw) as State;
    if (!Array.isArray(parsed.entries)) throw new Error('entries missing');
    return { state: { version: 1, entries: parsed.entries } };
  } catch {
    return { state: empty, warning: t.stateUnreadable(file), damaged: 'parse' };
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

export function recordEntry(
  ctx: Ctx,
  state: State,
  input: { ref: EntryRef; kind: Kind; command?: string[]; hookCommand?: string },
): State {
  const at = ctx.now().toISOString();
  const key = stateKey(input.ref.itemId, input.ref.harness);
  const entries = state.entries.filter((existing) => stateKey(existing.itemId, existing.harness) !== key);
  entries.push({
    itemId: input.ref.itemId,
    harness: input.ref.harness,
    providerId: input.ref.providerId ?? '',
    kind: input.kind,
    command: input.command,
    hookCommand: input.hookCommand,
    at,
  });
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
