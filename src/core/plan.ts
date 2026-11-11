import { expandArgs, type Ctx } from '../context.js';
import { mergeHook, readText, type HookEntry } from '../apply/hook-merger.js';
import { hookTarget, type HookTarget } from '../apply/hook-target.js';
import { t } from '../i18n.js';
import type { Data, ItemDef, Kind, ProviderDef, RequirementDef, Selection } from '../types.js';
import { requiredIds } from './entry.js';
import { pickProvider } from './providers.js';
import { checkRequirement } from './requirements.js';
import { verifyInstalled } from './verify.js';
import { findEntry, readState, sameCommand } from './state.js';

export type PlanAction = 'run' | 'already' | 'unsupported' | 'error';

export interface PlanEntry {
  itemId: string;
  kind: Kind;
  harness: string;
  providerId?: string;
  action: PlanAction;
  command?: string[];
  /** Set when a built-in adapter performs the work instead of a shell command. */
  adapter?: 'skills-api';
  /** Human description of what an adapter will do (no argv to show). */
  via?: string;
  /** What to store in the record for an adapter entry (a fingerprint, not an argv). */
  record?: string[];
  /** Present when this entry writes a hook into a config file. */
  hook?: { target: HookTarget; entry: HookEntry };
  note?: string;
  reason?: string;
  /** The requirement this entry cannot run without; set only when that requirement is unmet. */
  blockedBy?: string;
}

export interface PlanRequirement {
  id: string;
  /** Human name when the requirement belongs to a harness (the harness label, which is data). */
  label?: string;
  /** What the check command printed, when a version could be read out of it. */
  version?: string;
  /** The minimum the definition declares (`check.min`). */
  minimum?: string;
  present: boolean;
  installCommand?: string[];
}

export type RequirementState = 'ready' | 'missing' | 'outdated';

/**
 * The two unmet states apply must tell apart: `missing` (no usable version was read, so bootstrap it)
 * and `outdated` (a version was read and it is below `check.min`, so only a marked update touches it).
 */
export function requirementState(requirement: PlanRequirement): RequirementState {
  if (requirement.present) return 'ready';
  return requirement.version !== undefined ? 'outdated' : 'missing';
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

/**
 * Side-effect free: reads files and check commands, produces the exact work apply would do.
 * A missing provider is reported as `unsupported`, never silently skipped.
 */
export async function buildPlan(data: Data, ctx: Ctx, selection: Selection): Promise<Plan> {
  const warnings: string[] = [];
  const entries: PlanEntry[] = [];
  const stored = readState(ctx);
  if (stored.warning) warnings.push(stored.warning);
  const state = stored.state;
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

      const provider = pickProvider(data, item.kind, { harnessId });
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
          entries.push({ ...base, action: 'error', reason: t.hookItemIncomplete(itemId) });
          continue;
        }
        const previous = findEntry(state, itemId, harnessId)?.hookCommand;
        try {
          const merged = mergeHook(readText(target.file), target.path, target.spec, previous);
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
            reason: t.hookError(error),
          });
        }
        continue;
      }

      if (provider.adapter === 'skills-api') {
        const record = ['skills-api', item.source ?? item.id, item.skill ?? '*'];
        const recordedEntry = findEntry(state, itemId, harnessId);
        const matchesRecord = Boolean(recordedEntry && sameCommand(recordedEntry.command, record));
        // The lockfile answers in milliseconds; listSkills() scans every skill dir (~7s for 103).
        const present = verifyInstalled(harness, item, provider, ctx) === 'present';
        entries.push({
          ...base,
          action: matchesRecord && present ? 'already' : 'run',
          adapter: 'skills-api',
          via: `skills-api → ${item.source}${item.skill ? ` (${item.skill})` : ''} → ${harness.agentId ?? harness.id}`,
          record,
          reason: present ? t.recordedInstalled : undefined,
        });
        continue;
      }

      const command = expandArgs(provider.install ?? [], {
        source: item.source,
        skill: item.skill,
        package: item.package ?? item.url,
        agentId: harness.agentId ?? harness.id,
        harness: harness.id,
        item: item.id,
        root: ctx.root,
      });
      const recorded = findEntry(state, itemId, harnessId);
      const matchesRecord = Boolean(recorded && sameCommand(recorded.command, command));

      // A record is not evidence: if the owner says it is gone, install it again.
      let already = false;
      let reason: string | undefined;
      if (matchesRecord) {
        const verified = verifyInstalled(harness, item, provider, ctx);
        already = verified === 'present';
        if (verified === 'missing') reason = t.recordNotInTarget;
        if (verified === 'unknown') reason = t.recordUnverified;
        if (already) reason = t.recordedInstalled;
      }

      entries.push({ ...base, action: already ? 'already' : 'run', command, reason });
    }
  }

  const requirementIds = new Set<string>();
  for (const provider of usedProviders.values()) {
    for (const id of provider.requires ?? []) requirementIds.add(id);
  }
  // A missing harness CLI is a prerequisite too: the setup is useless without the thing it configures.
  for (const harness of data.harnesses) {
    if (!selection.harnessIds.includes(harness.id)) continue;
    for (const id of harness.requires ?? []) requirementIds.add(id);
  }

  const requirements: PlanRequirement[] = [];
  for (const id of requirementIds) {
    const def: RequirementDef | undefined = data.requires.find((candidate) => candidate.id === id);
    if (!def) {
      warnings.push(t.unknownRequirement(id));
      continue;
    }
    const check = checkRequirement(def, await ctx.runner.run(def.check.command));
    // A requirement a selected harness links through `requires` carries that harness's minimum.
    const owner = data.harnesses.find(
      (harness) => selection.harnessIds.includes(harness.id) && (harness.requires ?? []).includes(id),
    );
    requirements.push({
      id,
      label: owner?.label,
      version: check.version,
      minimum: def.check.min,
      present: check.meets,
      installCommand: def.install[ctx.platform],
    });
  }

  // The same unmet requirements apply would refuse to run: show the blockage here instead of at the end.
  const unmet = new Set(requirements.filter((requirement) => !requirement.present).map((requirement) => requirement.id));
  for (const entry of entries) {
    if (entry.action !== 'run') continue;
    const blockedBy = requiredIds(data, entry).find((id) => unmet.has(id));
    if (blockedBy) entry.blockedBy = blockedBy;
  }

  return { selection, entries, requirements, warnings };
}
