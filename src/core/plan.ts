import { expandArgs, type Ctx } from '../context.js';
import { HookConfigError, mergeHook, readText, type HookEntry } from '../apply/hook-merger.js';
import { hookTarget, type HookTarget } from '../apply/hook-target.js';
import { t } from '../i18n.js';
import type { Data, ItemDef, Kind, ProviderDef, Selection } from '../types.js';
import { meetsRequirement } from './requirements.js';
import { readState, sameCommand, stateKey } from './state.js';

export type PlanAction = 'run' | 'already' | 'unsupported' | 'error';

export interface PlanEntry {
  itemId: string;
  kind: Kind;
  harness: string;
  providerId?: string;
  action: PlanAction;
  command?: string[];
  /** Present when this entry writes a hook into a config file. */
  hook?: { target: HookTarget; entry: HookEntry };
  note?: string;
  reason?: string;
}

export interface PlanRequirement {
  id: string;
  present: boolean;
  installCommand?: string[];
}

export interface Plan {
  selection: Selection;
  entries: PlanEntry[];
  requirements: PlanRequirement[];
  warnings: string[];
}

export function itemTargets(item: ItemDef, harnessId: string): boolean {
  return item.targets === '*' || item.targets.includes(harnessId);
}

export function pickProvider(data: Data, kind: Kind, harnessId: string): ProviderDef | undefined {
  return data.providers
    .filter((provider) => provider.kind === kind && provider.supports.includes(harnessId))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))[0];
}

/**
 * Side-effect free: reads files and check commands, produces the exact work apply would do.
 * A missing provider is reported as `unsupported`, never silently skipped.
 */
export async function buildPlan(data: Data, ctx: Ctx, selection: Selection): Promise<Plan> {
  const warnings: string[] = [];
  const entries: PlanEntry[] = [];
  const state = readState(ctx);
  const usedProviders = new Map<string, ProviderDef>();

  for (const itemId of selection.itemIds) {
    const item = data.items.get(itemId);
    if (!item) {
      warnings.push(t.unknownItem(itemId));
      continue;
    }
    for (const harnessId of selection.harnessIds) {
      const harness = data.harnesses.find((candidate) => candidate.id === harnessId);
      if (!harness) {
        warnings.push(t.unknownHarness(harnessId));
        continue;
      }
      if (!itemTargets(item, harnessId)) continue;

      const provider = pickProvider(data, item.kind, harnessId);
      if (!provider) {
        entries.push({
          itemId,
          kind: item.kind,
          harness: harnessId,
          action: 'unsupported',
          note: item.note,
          reason: t.providerMissing,
        });
        continue;
      }
      usedProviders.set(provider.id, provider);

      const base = { itemId, kind: item.kind, harness: harnessId, providerId: provider.id, note: item.note };

      if (provider.writes) {
        const target = hookTarget(harness, provider, item, ctx);
        if (!target) {
          entries.push({ ...base, action: 'error', reason: t.hookTargetMissing });
          continue;
        }
        try {
          const merged = mergeHook(readText(target.file), target.path, target.spec);
          entries.push({
            ...base,
            action: merged.changed ? 'run' : 'already',
            hook: { target, entry: merged.entry },
            reason: merged.changed ? undefined : t.hookAlready,
          });
        } catch (error) {
          entries.push({
            ...base,
            action: 'error',
            reason: error instanceof HookConfigError ? t.hookTargetUnreadable : String(error),
          });
        }
        continue;
      }

      const command = expandArgs(provider.install, {
        source: item.source,
        skill: item.skill,
        package: item.package ?? item.url,
        agentId: harness.agentId ?? harness.id,
        harness: harness.id,
        item: item.id,
      });
      const recorded = state.entries.find((entry) => stateKey(entry.itemId, entry.harness) === stateKey(itemId, harnessId));
      const already = Boolean(recorded && sameCommand(recorded.command, command));
      entries.push({
        ...base,
        action: already ? 'already' : 'run',
        command,
        reason: already ? t.recordedInstalled : undefined,
      });
    }
  }

  const requirementIds = new Set<string>();
  for (const provider of usedProviders.values()) {
    for (const id of provider.requires ?? []) requirementIds.add(id);
  }

  const requirements: PlanRequirement[] = [];
  for (const id of requirementIds) {
    const def = data.requires.find((candidate) => candidate.id === id);
    if (!def) {
      warnings.push(t.unknownRequirement(id));
      continue;
    }
    const result = await ctx.runner.run(def.check.command);
    requirements.push({
      id,
      present: meetsRequirement(def, result),
      installCommand: def.install[ctx.platform] ?? def.install.linux,
    });
  }

  return { selection, entries, requirements, warnings };
}
