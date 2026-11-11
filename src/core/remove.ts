import fs from 'node:fs';
import path from 'node:path';
import { expandArgs, expandPath, type Ctx } from '../context.js';
import { hookTarget } from '../apply/hook-target.js';
import { writeConfigFile } from '../apply/config-writer.js';
import { HookConfigError, removeHook, readText } from '../apply/hook-merger.js';
import { failureLine } from './apply.js';
import { entryDefs } from './entry.js';
import { pickProvider, serverName } from './providers.js';
import { backupFile, readState, statePath, writeState, type State, type StateEntry } from './state.js';
import { t } from '../i18n.js';
import type { Data, Kind, ProviderDef } from '../types.js';

export type RemoveAction = 'remove' | 'not-covered' | 'manual' | 'error';

export interface RemoveEntry {
  itemId: string;
  kind: Kind;
  /** Every harness this item was recorded for — removal always covers all of them. */
  harnesses: string[];
  /** Files and directories the removal touches, so approval is informed. */
  paths: string[];
  providerId?: string;
  action: RemoveAction;
  command?: string[];
  reason?: string;
}

export interface RemovePlan {
  entries: RemoveEntry[];
  /** Records that disappear once their item is gone. */
  records: StateEntry[];
  warnings: string[];
}

export interface RemoveResult {
  entry: RemoveEntry;
  status: 'removed' | 'not-covered' | 'error';
  message?: string;
}

export interface RemoveOutcome {
  results: RemoveResult[];
  warnings: string[];
}

/** The shared store the lockfile owns, plus each recorded harness's own skills directory. */
function skillPaths(data: Data, ctx: Ctx, harnesses: string[]): string[] {
  const shared = data.providers
    .map((provider) => provider.verify)
    .find((verify) => verify?.strategy === 'skill-lock');
  const paths = new Set<string>();
  if (shared && shared.strategy === 'skill-lock') {
    paths.add(path.dirname(expandPath(shared.file, ctx.home)));
    paths.add(path.join(path.dirname(expandPath(shared.file, ctx.home)), 'skills'));
  }
  for (const harness of data.harnesses) {
    if (!harnesses.includes(harness.id) || !harness.skills) continue;
    paths.add(expandPath(harness.skills.path, ctx.home));
  }
  return [...paths];
}

function lockSources(file: string): Record<string, { source?: string }> | undefined {
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { skills?: Record<string, { source?: string }> };
    return parsed.skills;
  } catch {
    return undefined;
  }
}

/**
 * Plans a removal for every recorded item (or the given subset). Removal is deliberately all-harness:
 * the skill directories are shared, so a per-harness removal would claim something untrue.
 */
export function buildRemovePlan(data: Data, ctx: Ctx, itemIds?: string[]): RemovePlan {
  const stored = readState(ctx);
  const warnings = stored.warning ? [stored.warning] : [];
  const records = stored.state.entries.filter((entry) => !itemIds || itemIds.includes(entry.itemId));
  const byItem = new Map<string, StateEntry[]>();
  for (const record of records) {
    const group = byItem.get(record.itemId) ?? [];
    group.push(record);
    byItem.set(record.itemId, group);
  }

  const entries: RemoveEntry[] = [];
  for (const [itemId, group] of byItem) {
    const item = data.items.get(itemId);
    const harnesses = [...new Set(group.map((record) => record.harness))];
    if (!item) {
      warnings.push(t.unknownItem(itemId));
      continue;
    }

    const base = { itemId, kind: item.kind, harnesses };

    // Hooks are our own writes: no external command removes them, the merger does.
    if (item.kind === 'hook') {
      const provider = pickProvider(data, 'hook', { capability: 'writes' });
      if (!provider) {
        entries.push({ ...base, paths: [], action: 'not-covered', reason: t.removeNotCovered(item.kind) });
        continue;
      }
      const paths = group
        .map((record) => {
          const defs = entryDefs(data, record);
          const target = defs.harness && defs.item ? hookTarget(defs.harness, defs.provider, defs.item, ctx) : undefined;
          return target?.file;
        })
        .filter((file): file is string => Boolean(file));
      if (group.every((record) => !record.hookCommand)) {
        entries.push({ ...base, providerId: provider.id, paths, action: 'error', reason: t.removeNoRecord });
        continue;
      }
      entries.push({ ...base, providerId: provider.id, paths, action: 'remove' });
      continue;
    }

    const provider = pickProvider(data, item.kind, { capability: 'remove' });
    if (!provider) {
      entries.push({ ...base, paths: [], action: 'not-covered', reason: t.removeNotCovered(item.kind) });
      continue;
    }

    const vars = {
      skill: item.skill,
      serverName: serverName(item),
      package: item.package ?? item.url,
      source: item.source,
      root: ctx.root,
    };
    const command = expandArgs(provider.remove!, vars);

    if (item.kind === 'skill' && !item.skill) {
      // A source-level item names no single skill: ask the lockfile which skills it installed.
      const lockFile = data.providers.find((candidate) => candidate.kind === 'skill')?.verify;
      const skills =
        lockFile && lockFile.strategy === 'skill-lock'
          ? lockSources(expandPath(lockFile.file, ctx.home))
          : undefined;
      const names = Object.entries(skills ?? {})
        .filter(([, value]) => value.source === item.source)
        .map(([name]) => name);
      if (names.length === 0) {
        entries.push({ ...base, providerId: provider.id, paths: [], action: 'manual', reason: t.removeNoSkills(item.source ?? item.id) });
        continue;
      }
      entries.push({ ...base, providerId: provider.id, paths: skillPaths(data, ctx, harnesses), action: 'remove', command: [...command, ...names] });
      continue;
    }

    const paths =
      item.kind === 'mcp'
        ? data.harnesses
            .filter((harness) => harnesses.includes(harness.id) && harness.mcp)
            .map((harness) => expandPath(harness.mcp!.path, ctx.home))
        : skillPaths(data, ctx, harnesses);

    entries.push({ ...base, providerId: provider.id, paths, action: 'remove', command });
  }

  return { entries, records, warnings };
}

/** Applies a removal plan: commands first, then the hook entries we wrote, then the records. */
export async function applyRemovePlan(data: Data, ctx: Ctx, plan: RemovePlan): Promise<RemoveOutcome> {
  const results: RemoveResult[] = [];
  const warnings = [...plan.warnings];
  const removedItems = new Set<string>();

  for (const entry of plan.entries) {
    if (entry.action === 'not-covered' || entry.action === 'manual') {
      results.push({ entry, status: 'not-covered', message: entry.reason });
      continue;
    }
    if (entry.action === 'error') {
      results.push({ entry, status: 'error', message: entry.reason });
      continue;
    }

    if (entry.kind === 'hook') {
      try {
        for (const record of plan.records.filter((candidate) => candidate.itemId === entry.itemId)) {
          const defs = entryDefs(data, record);
          const target =
            defs.harness && defs.item ? hookTarget(defs.harness, defs.provider, defs.item, ctx) : undefined;
          if (!target || !record.hookCommand) continue;
          const text = readText(target.file);
          const stripped = removeHook(text, target.path, {
            matcher: target.spec.matcher,
            command: record.hookCommand,
          });
          if (!stripped.changed) {
            warnings.push(t.removeHookMissing(entry.itemId, target.file));
            continue;
          }
          writeConfigFile(ctx, target.file, stripped.text);
        }
        removedItems.add(entry.itemId);
        results.push({ entry, status: 'removed' });
      } catch (error) {
        results.push({ entry, status: 'error', message: error instanceof HookConfigError ? t.hookTargetUnreadable : String(error) });
      }
      continue;
    }

    if (!entry.command) {
      results.push({ entry, status: 'error', message: t.commandMissing });
      continue;
    }
    const run = await ctx.runner.run(entry.command);
    if (run.code !== 0) {
      results.push({ entry, status: 'error', message: failureLine(run.stderr, t.exitCode(run.code)) });
      continue;
    }
    removedItems.add(entry.itemId);
    results.push({ entry, status: 'removed' });
  }

  if (removedItems.size === 0) return { results, warnings };

  const stored = readState(ctx);
  if (stored.damaged === 'read') {
    warnings.push(t.stateNotRecorded(t.stateFileUnreadable, ''));
    return { results, warnings };
  }
  if (stored.damaged === 'parse') {
    // Recording over a damaged state would erase the history: keep a copy before writing.
    try {
      const dest = backupFile(ctx, statePath(ctx));
      if (dest) warnings.push(t.stateBackedUp(statePath(ctx), dest));
    } catch (error) {
      warnings.push(t.stateNotRecorded(statePath(ctx), String(error)));
      return { results, warnings };
    }
  }

  const next: State = {
    version: 1,
    entries: stored.state.entries.filter((record) => !removedItems.has(record.itemId)),
  };
  writeState(ctx, next);

  return { results, warnings };
}
