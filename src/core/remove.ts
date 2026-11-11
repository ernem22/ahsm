import path from 'node:path';
import { expandArgs, expandPath, type Ctx } from '../context.js';
import { hookTarget } from '../apply/hook-target.js';
import { writeConfigFile } from '../apply/config-writer.js';
import { HookConfigError, removeHook, readText } from '../apply/hook-merger.js';
import { failureLine } from './apply.js';
import { entryDefs } from './entry.js';
import { readSkillInventory, type SkillInventoryRow } from './list.js';
import { pickProvider, serverName } from './providers.js';
import { backupFile, readState, statePath, writeState, type State, type StateEntry } from './state.js';
import { readSkillLock } from './verify.js';
import { t } from '../i18n.js';
import type { Data, ItemDef, Kind, ProviderDef } from '../types.js';

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
  /** Set when a built-in adapter removes the item instead of a shell command. */
  adapter?: 'skills-api';
  command?: string[];
  reason?: string;
  /**
   * True when the user named the skill instead of it coming out of the record: agentenv did not have
   * to install it, so the name itself is what the provider is asked to remove.
   */
  named?: boolean;
}

export interface RemovePlan {
  entries: RemoveEntry[];
  /** Records that disappear once their item is gone. */
  records: StateEntry[];
  warnings: string[];
}

export interface RemoveResult {
  entry: RemoveEntry;
  /**
   * `absent`: the provider inventory does not hold it, so there was nothing to remove.
   * `manual`: the plan could not name what to remove by hand — never folded into `not-covered`, which
   * means no provider supports the item type at all (GLOSSARY).
   */
  status: 'removed' | 'not-covered' | 'manual' | 'error' | 'absent';
  message?: string;
}

/** What to remove: everything recorded, a set of item ids, and/or skill names the user typed. */
export interface RemoveSelection {
  /** Item ids to narrow the removal to; absent means every recorded item. */
  itemIds?: string[];
  /** Skill names to remove by name — a record is not needed, the inventory says where they landed. */
  skillNames?: string[];
  /** The inventory the names were looked up in; supplied by `planRemoval`, never read here. */
  inventory?: SkillInventoryRow[];
}

export interface RemoveOutcome {
  results: RemoveResult[];
  warnings: string[];
}

/** The shared skills store: the one `skill-lock` recipe a provider declares, wherever it sits in the list. */
function skillLock(data: Data): Extract<ProviderDef['verify'], { strategy: 'skill-lock' }> | undefined {
  const verify = data.providers.map((provider) => provider.verify).find((recipe) => recipe?.strategy === 'skill-lock');
  return verify?.strategy === 'skill-lock' ? verify : undefined;
}

/** The shared store the lockfile owns, plus each recorded harness's own skills directory. */
function skillPaths(data: Data, ctx: Ctx, harnesses: string[]): string[] {
  const shared = skillLock(data);
  const paths = new Set<string>();
  if (shared) {
    paths.add(path.dirname(expandPath(shared.file, ctx.home)));
    paths.add(path.join(path.dirname(expandPath(shared.file, ctx.home)), 'skills'));
  }
  for (const harness of data.harnesses) {
    if (!harnesses.includes(harness.id) || !harness.skills) continue;
    paths.add(expandPath(harness.skills.path, ctx.home));
  }
  return [...paths];
}

/** The skills the provider's own lockfile records for this source: what a source-level removal names. */
function lockedNames(data: Data, ctx: Ctx, item: ItemDef): string[] {
  const verify = skillLock(data);
  const lock = verify ? readSkillLock(expandPath(verify.file, ctx.home)) : undefined;
  return Object.entries(lock ?? {})
    .filter(([, entry]) => entry?.source === item.source)
    .map(([name]) => name);
}

/**
 * Plans a removal for every recorded item (or the given subset). Removal is deliberately all-harness:
 * the skill directories are shared, so a per-harness removal would claim something untrue.
 *
 * A skill the user names is planned the same way whether or not agentenv installed it: when a record
 * covers the name the recorded rules apply, otherwise the name alone is what the provider removes.
 */
export function buildRemovePlan(data: Data, ctx: Ctx, selection: RemoveSelection = {}): RemovePlan {
  const stored = readState(ctx);
  const warnings = stored.warning ? [stored.warning] : [];
  const names = selection.skillNames ?? [];
  const narrowed = Boolean(selection.itemIds) || names.length > 0;
  const records = narrowed
    ? stored.state.entries.filter((entry) => selectedRecord(data, entry, selection))
    : stored.state.entries;
  const byItem = new Map<string, StateEntry[]>();
  for (const record of records) {
    const group = byItem.get(record.itemId) ?? [];
    group.push(record);
    byItem.set(record.itemId, group);
  }

  /** Names the selected records already account for, so no name is planned twice. */
  const covered = new Set<string>();
  const entries: RemoveEntry[] = [];
  for (const [itemId, group] of byItem) {
    const item = data.items.get(itemId);
    const harnesses = [...new Set(group.map((record) => record.harness))];
    if (!item) {
      warnings.push(t.unknownItem(itemId));
      continue;
    }
    // The item the record names installs the skill the user named: one entry, the recorded rules.
    if (item.kind === 'skill' && item.skill && names.includes(item.skill)) covered.add(item.skill);

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

    if (provider.adapter === 'skills-api') {
      // The adapter resolves names from its own inventory at apply time.
      entries.push({
        ...base,
        providerId: provider.id,
        paths: skillPaths(data, ctx, harnesses),
        action: 'remove',
        adapter: 'skills-api',
      });
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
      // A source-level item names no single skill: ask the provider's lockfile which skills it installed.
      const names = lockedNames(data, ctx, item);
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

  entries.push(...namedEntries(data, ctx, names.filter((name) => !covered.has(name)), selection.inventory));

  return { entries, records, warnings };
}

/** A record belongs to a removal when its item was picked, or when the user named the skill it installs. */
function selectedRecord(data: Data, record: StateEntry, selection: RemoveSelection): boolean {
  if (selection.itemIds?.includes(record.itemId)) return true;
  const item = data.items.get(record.itemId);
  return item?.kind === 'skill' && item.skill !== undefined && (selection.skillNames ?? []).includes(item.skill);
}

/**
 * The skills the user named that no record covers. The inventory only says where each one landed (and
 * which harnesses carry it); the provider's own remove decides whether it was there. A name the
 * inventory does not list is still planned, with a note, rather than silently dropped.
 */
function namedEntries(
  data: Data,
  ctx: Ctx,
  names: string[],
  inventory: SkillInventoryRow[] | undefined,
): RemoveEntry[] {
  if (names.length === 0) return [];
  const provider = pickProvider(data, 'skill', { capability: 'remove' });

  return [...new Set(names)].map((name) => {
    const row = inventory?.find((candidate) => candidate.name === name);
    // A skill nobody reports has no harnesses to name, but its directories are still shown.
    const harnesses = row?.harnesses ?? [];
    const base = { itemId: name, kind: 'skill' as const, harnesses, named: true };
    if (!provider) {
      return { ...base, paths: [], action: 'not-covered' as const, reason: t.removeNotCovered('skill') };
    }
    const paths = skillPaths(data, ctx, harnesses);
    const note = row ? {} : { reason: t.removeNotInInventory(name) };

    if (provider.adapter === 'skills-api') {
      // The adapter resolves the name from its own inventory at apply time.
      return {
        ...base,
        providerId: provider.id,
        paths,
        action: 'remove' as const,
        adapter: 'skills-api' as const,
        ...note,
      };
    }
    if (!provider.remove) {
      return {
        ...base,
        providerId: provider.id,
        paths,
        action: 'not-covered' as const,
        reason: t.removeNotCovered('skill'),
      };
    }
    const command = expandArgs(provider.remove, { skill: name, source: row?.source, root: ctx.root });
    return { ...base, providerId: provider.id, paths, action: 'remove' as const, command, ...note };
  });
}

/**
 * Read-only: plans the removal the user asked for — everything recorded, a package's items, and/or the
 * skills they named. Removal and `list` share the inventory read, which is why this is async: the plan
 * can then show the harnesses and directories of a skill agentenv never installed, before approval.
 * Reading the inventory is the only thing that can fail here, and it does not block the removal.
 */
export async function planRemoval(data: Data, ctx: Ctx, selection: RemoveSelection = {}): Promise<RemovePlan> {
  const first = buildRemovePlan(data, ctx, selection);
  // Every name the user gave is already covered by the record: the inventory would add nothing, and
  // reading it is the expensive part (~7 s per hundred skills), so it is not read.
  if (!first.entries.some((entry) => entry.named)) return first;

  const warnings: string[] = [];
  let inventory: SkillInventoryRow[] = [];
  try {
    inventory = (await readSkillInventory(data, ctx)).rows;
  } catch (error) {
    warnings.push(t.removeInventoryUnreadable(error instanceof Error ? error.message : String(error)));
  }

  const plan = buildRemovePlan(data, ctx, { ...selection, inventory });
  return { ...plan, warnings: [...plan.warnings, ...warnings] };
}

/** Applies a removal plan: commands first, then the hook entries we wrote, then the records. */
export async function applyRemovePlan(data: Data, ctx: Ctx, plan: RemovePlan): Promise<RemoveOutcome> {
  const results: RemoveResult[] = [];
  const warnings = [...plan.warnings];
  const removedItems = new Set<string>();

  for (const entry of plan.entries) {
    if (entry.action === 'not-covered') {
      results.push({ entry, status: 'not-covered', message: entry.reason });
      continue;
    }
    // The plan says "needs a name — remove by hand": that is not "no provider covers this type".
    if (entry.action === 'manual') {
      results.push({ entry, status: 'manual', message: entry.reason });
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

    if (entry.adapter === 'skills-api') {
      try {
        // A named entry has no item behind it: the name the user gave is what the provider removes.
        const item = entry.named ? undefined : data.items.get(entry.itemId);
        const installed = await ctx.skills.list();
        const names = installed
          .filter((skill) =>
            item
              ? skill.source === item.source && (!item.skill || skill.name === item.skill)
              : skill.name === entry.itemId,
          )
          .map((skill) => skill.name);
        if (names.length === 0) {
          // Nothing to remove is reported, not treated as a failure of the run: the rest goes on.
          results.push(
            entry.named
              ? { entry, status: 'absent', message: t.removeSkillMissing(entry.itemId) }
              // The provider covers it and found nothing: "not installed", never "not covered".
              : { entry, status: 'absent', message: t.removeNoSkills(item?.source ?? entry.itemId) },
          );
          continue;
        }
        // No agent filter: "remove" means everywhere, and the API still keeps a shared copy while
        // another installed agent uses it.
        const outcome = await ctx.skills.remove({ names });
        if (outcome.failed.length > 0) {
          results.push({ entry, status: 'error', message: outcome.failed[0]?.message ?? t.commandMissing });
          continue;
        }
        removedItems.add(entry.itemId);
        results.push({ entry, status: 'removed' });
      } catch (error) {
        results.push({ entry, status: 'error', message: t.hookError(error) });
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
  // Nothing recorded was removed (a named skill agentenv did not install, say): rewriting the file
  // would only churn it. A damaged record was still backed up above, so this cannot erase history.
  if (next.entries.length === stored.state.entries.length) return { results, warnings };

  writeState(ctx, next);

  return { results, warnings };
}
