import fs from 'node:fs';
import { expandArgs, expandPath, type Ctx, type RunResult } from '../context.js';
import { t } from '../i18n.js';
import type { Data, ProviderDef } from '../types.js';
import { pickProvider } from './providers.js';
import { readSkillLock, type SkillLockEntry } from './verify.js';

export type StaleValue = 'up-to-date' | 'stale' | 'unknown';

/** One recorded skill as the source sees it: still what was installed, different, or not comparable. */
export interface StaleRow {
  name: string;
  /** What the provider's lockfile says it came from; absent when it records none. */
  source?: string;
  value: StaleValue;
  /** Why, in the glossary's words. Always set for `stale` and `unknown`. */
  detail?: string;
}

export interface StaleReport {
  /** False when no provider offers an update check at all: then nothing was compared. */
  covered: boolean;
  rows: StaleRow[];
  warnings: string[];
}

/** What the provider's `check` run told us, as far as its plain-text output can be read. */
interface CheckRun {
  /** The provider printed its closing summary: silence then means "nothing newer upstream". */
  completed: boolean;
  outdated: Set<string>;
  deleted: Set<string>;
  failedSources: Set<string>;
  unchecked: Set<string>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The provider colours its output on a TTY; the parser must not see escape sequences. */
function plain(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
}

/**
 * Reads the output of the provider's own update check (`skills check -g`). That run compares the
 * folder hash it recorded at install time with what the source holds now — the one comparison the
 * package already computes — but the only way to reach it is this text: the subcommand has no
 * machine-readable output. Everything unreadable therefore falls back to silence, and silence is
 * never turned into "up-to-date" unless the run's closing summary was seen (see `readStaleSkills`).
 */
function parseCheckOutput(stdout: string): CheckRun {
  const run: CheckRun = {
    completed: false,
    outdated: new Set(),
    deleted: new Set(),
    failedSources: new Set(),
    unchecked: new Set(),
  };
  let section: 'deleted' | 'unchecked' | undefined;

  for (const raw of stdout.split('\n')) {
    const line = plain(raw).trim();
    if (!line) continue;

    if (/cannot be checked automatically/i.test(line)) {
      section = 'unchecked';
      continue;
    }
    if (/appear to have been deleted upstream/i.test(line)) {
      section = 'deleted';
      continue;
    }
    if (line.startsWith('•')) {
      const names = line.slice(1).trim().replace(/\s+\([^)]*\)$/, '');
      for (const name of names.split(',').map((entry) => entry.trim()).filter(Boolean)) {
        if (section === 'deleted') run.deleted.add(name);
        else if (section === 'unchecked') run.unchecked.add(name);
      }
      continue;
    }
    // The skipped block ends with a "To update: …" hint belonging to the bullet above it.
    if (/^To update:/i.test(line)) continue;

    section = undefined;
    const update = /^↑ (.+) has an update$/.exec(line);
    if (update?.[1]) {
      run.outdated.add(update[1].trim());
      continue;
    }
    const failed = /^✗ Failed to check skills from (.+?)(?::\s.*)?$/.exec(line);
    if (failed?.[1]) {
      run.failedSources.add(failed[1].trim());
      continue;
    }
    if (
      /All (global|project) skills are up to date/i.test(line) ||
      /^Found \d+ global update\(s\)/i.test(line) ||
      /skill\(s\) can be updated/i.test(line)
    ) {
      run.completed = true;
    }
  }
  return run;
}

/** A runner that throws must not cost the whole report: treat it like an exit-1 result. */
async function runSafe(ctx: Ctx, argv: string[]): Promise<RunResult> {
  try {
    return await ctx.runner.run(argv);
  } catch (error) {
    return { code: 1, stdout: '', stderr: errorText(error) };
  }
}

interface LockedSkill {
  name: string;
  entry: SkillLockEntry;
}

function lockEntries(lock: Record<string, SkillLockEntry | undefined> | undefined): LockedSkill[] {
  if (!lock) return [];
  return Object.entries(lock)
    .filter((pair): pair is [string, SkillLockEntry] => typeof pair[1] === 'object' && pair[1] !== null)
    .map(([name, entry]) => ({ name, entry }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Read-only: asks the provider whether every recorded skill is still what its source offers, and
 * writes nothing — no installation, no lockfile touch, no record read (`state.json` says what we did,
 * not what is true — ADR-0002). The provider's own lockfile is the cheap source (~1 ms), so the slow
 * inventory scan `list` performs is never reached from here.
 *
 * The verdicts are deliberately conservative: `up-to-date` is only said when the provider completed
 * its check for that skill's source and did not report it, so an unreachable source, a run that never
 * finished, and an entry without a recorded folder hash are all `unknown` rather than a guess. That
 * includes the provider's own blind spot: when a source fails it still prints "all up to date".
 */
export async function readStaleSkills(data: Data, ctx: Ctx): Promise<StaleReport> {
  const warnings: string[] = [];
  const provider: ProviderDef | undefined = pickProvider(data, 'skill', { capability: 'check' });
  if (!provider?.check?.length) return { covered: false, rows: [], warnings };

  const verify = provider.verify;
  if (verify?.strategy !== 'skill-lock') {
    warnings.push(t.staleNoLock);
    return { covered: true, rows: [], warnings };
  }

  const lockPath = expandPath(verify.file, ctx.home);
  const lock = readSkillLock(lockPath);
  if (!lock && fs.existsSync(lockPath)) warnings.push(t.staleLockUnreadable(lockPath));
  const locked = lockEntries(lock);
  if (locked.length === 0) return { covered: true, rows: [], warnings };

  const argv = expandArgs(provider.check, { root: ctx.root, home: ctx.home });
  const check = parseCheckOutput((await runSafe(ctx, argv)).stdout);

  const rows = locked.map(({ name, entry }): StaleRow => {
    const source = entry.source ?? entry.sourceUrl;
    const base = { name, ...(source ? { source } : {}) };
    if (!source) return { ...base, value: 'unknown', detail: t.staleNoSource };
    if (!entry.skillPath || !entry.skillFolderHash) return { ...base, value: 'unknown', detail: t.staleNoHash };
    if (check.failedSources.has(entry.source ?? '') || check.failedSources.has(entry.sourceUrl ?? '')) {
      return { ...base, value: 'unknown', detail: t.staleUnreachable(source) };
    }
    // A named update or a deleted-upstream warning is evidence even if the run then fell over.
    if (check.outdated.has(name)) return { ...base, value: 'stale', detail: t.staleNewer };
    if (check.deleted.has(name)) return { ...base, value: 'stale', detail: t.staleGone };
    if (check.unchecked.has(name)) return { ...base, value: 'unknown', detail: t.staleNotComparable };
    if (!check.completed) return { ...base, value: 'unknown', detail: t.staleNotRun };
    return { ...base, value: 'up-to-date' };
  });

  return { covered: true, rows, warnings };
}
