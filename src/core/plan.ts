import { expandArgs, type Ctx } from '../context.js';
import { mergeHook, readText, type HookEntry } from '../apply/hook-merger.js';
import { hookTarget, type HookTarget } from '../apply/hook-target.js';
import { t } from '../i18n.js';
import type { Data, HarnessDef, ItemDef, Kind, ProviderDef, RequirementDef, Selection } from '../types.js';
import { requiredIds } from './entry.js';
import { pickProvider } from './providers.js';
import { checkRequirement } from './requirements.js';
import { verifyInstalled } from './verify.js';
import { findEntry, readState, sameCommand } from './state.js';
import type { HarnessStatus } from './status.js';

export type PlanAction = 'run' | 'already' | 'unsupported' | 'error';

/** The three values an adapter entry's description needs: source, the skill of it, and the agent. */
export interface AdapterVia {
  source: string;
  skill?: string;
  agent: string;
}

export interface PlanEntry {
  itemId: string;
  kind: Kind;
  harness: string;
  providerId?: string;
  action: PlanAction;
  command?: string[];
  /**
   * The item's skills this entry installs, when the plan was narrowed to some of them: `update` knows
   * which installed skills the provider marked stale, and a source-level item would otherwise reinstall
   * its whole source. Absent means the item's own scope (`skill`, or the entire source).
   */
  skills?: string[];
  /** Set when a built-in adapter performs the work instead of a shell command. */
  adapter?: 'skills-api';
  /**
   * What an adapter will do, as data: an adapter entry has no argv to show, and the renderer is what
   * turns these values into copy (the words live in i18n).
   */
  via?: AdapterVia;
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

export type RequirementState = HarnessStatus;

/**
 * The two unmet states apply must tell apart: `absent` (the check read no usable version, so bootstrap
 * it) and `too-old` (a version was read and it is below `check.min`, so only a marked update touches it).
 *
 * These are the same three words `status` uses for a harness — one vocabulary, one set of labels in
 * i18n (`harnessLabels`). There is no second name for either state.
 */
export function requirementState(requirement: PlanRequirement): RequirementState {
  if (requirement.present) return 'ready';
  return requirement.version !== undefined ? 'too-old' : 'absent';
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

/** The fingerprint the skills adapter records: the source and which skill of it (or the whole source). */
function adapterRecord(item: ItemDef, skill: string | undefined): string[] {
  return ['skills-api', item.source ?? item.id, skill ?? '*'];
}

/** What an adapter will do: the values, never the sentence (that is the renderer's job). */
function adapterVia(item: ItemDef, skill: string | undefined, harness: HarnessDef): AdapterVia {
  return {
    source: item.source ?? item.id,
    ...(skill ? { skill } : {}),
    agent: harness.agentId ?? harness.id,
  };
}

/** The values a provider's install template is expanded with; `{skill}` is the item's own by default. */
function installVars(item: ItemDef, harness: HarnessDef, ctx: Ctx): Record<string, string | undefined> {
  return {
    source: item.source,
    skill: item.skill,
    package: item.package ?? item.url,
    agentId: harness.agentId ?? harness.id,
    harness: harness.id,
    item: item.id,
    root: ctx.root,
  };
}

/** The argv the provider runs for this item; `{skill}` is the item's own skill unless one is named. */
function installArgv(provider: ProviderDef, item: ItemDef, harness: HarnessDef, ctx: Ctx, skill = item.skill): string[] {
  return expandArgs(provider.install ?? [], { ...installVars(item, harness, ctx), skill });
}

const SKILL_SLOT = '{skill}';

/**
 * One template word against one recorded token, carrying the skill value the record implies. `{skill}`
 * may sit anywhere inside a word (`--skill {skill}`, `{source}/{skill}`), so the token is split around it.
 */
function matchToken(
  word: string,
  token: string,
  skill: string | undefined,
  vars: Record<string, string | undefined>,
): { ok: boolean; skill?: string } {
  // Every other placeholder is known here: only `{skill}` is what the matcher has to recover.
  const pattern = word.replace(/\{(\w+)\}/g, (all, name: string) => (name === 'skill' ? all : (vars[name] ?? all)));
  const at = pattern.indexOf(SKILL_SLOT);
  if (at < 0) return { ok: pattern === token, skill };
  const prefix = pattern.slice(0, at);
  const suffix = pattern.slice(at + SKILL_SLOT.length);
  // A skill is never an empty string: expansion drops the whole element instead.
  if (token.length < prefix.length + suffix.length + 1) return { ok: false };
  if (!token.startsWith(prefix) || !token.endsWith(suffix)) return { ok: false };
  const value = token.slice(prefix.length, token.length - suffix.length);
  if (skill !== undefined && skill !== value) return { ok: false };
  return { ok: true, skill: value };
}

/**
 * Walks the template once: an element either vanishes (no skill value, like `expandArgs` does) or yields
 * its words with `{skill}` filled in. Backtracking, because only one skill value fits every occurrence.
 */
function matchElements(
  elements: string[],
  vars: Record<string, string | undefined>,
  candidate: string[],
  at: number,
  index: number,
  skill: string | undefined,
): boolean {
  if (at === elements.length) return index === candidate.length;
  const element = elements[at] ?? '';
  const names = [...element.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string);
  const hasSkill = names.includes('skill');
  // A placeholder this argv cannot fill drops the whole element, so it never shows up in a record.
  const producible = names.every((name) => name === 'skill' || Boolean(vars[name]));
  if (!hasSkill) {
    const expanded = expandArgs([element], vars);
    if (index + expanded.length > candidate.length) return false;
    if (!expanded.every((token, offset) => candidate[index + offset] === token)) return false;
    return matchElements(elements, vars, candidate, at + 1, index + expanded.length, skill);
  }
  // Without a skill value the element disappears: that is the item's own, unnarrowed scope.
  if (producible && matchElements(elements, vars, candidate, at + 1, index, skill)) return true;
  if (!producible) return false;
  let cursor = index;
  let captured = skill;
  for (const word of element.split(' ').filter(Boolean)) {
    const token = candidate[cursor];
    if (token === undefined) return false;
    const step = matchToken(word, token, captured, vars);
    if (!step.ok) return false;
    captured = step.skill;
    cursor += 1;
  }
  return matchElements(elements, vars, candidate, at + 1, cursor, captured);
}

/**
 * True when `candidate` is an argv this install template can produce — for some `{skill}` value, or for
 * none at all. `update` records the argv it really ran (the item narrowed to one stale skill), while plan
 * compares against the item's whole scope, so the two differ only where `{skill}` lands.
 */
function matchesInstallArgv(
  template: string[],
  vars: Record<string, string | undefined>,
  candidate: string[],
): boolean {
  return matchElements(template, vars, candidate, 0, 0, vars.skill);
}

/**
 * Does a recorded fingerprint describe this item's installation? A record says which item a row belongs
 * to; whether it is really there is `verifyInstalled`'s answer, never the record's (ADR-0002). Widening
 * the comparison keeps the record honest about what ran: `update` writes the narrowed argv it executed,
 * and an item-scope argv it never ran would be a claim about work that did not happen.
 */
function argvCovers(
  recorded: string[] | undefined,
  command: string[],
  provider: ProviderDef,
  item: ItemDef,
  harness: HarnessDef,
  ctx: Ctx,
): boolean {
  if (!recorded) return false;
  if (sameCommand(recorded, command)) return true;
  // Only a source-level item is ever narrowed: an item naming one skill has no narrower scope.
  if (item.skill !== undefined) return false;
  return matchesInstallArgv(provider.install ?? [], installVars(item, harness, ctx), recorded);
}

/** The adapter fingerprint, which may name the one skill `update` reinstalled instead of the whole source. */
function adapterCovers(recorded: string[] | undefined, expected: string[], item: ItemDef): boolean {
  if (!recorded) return false;
  if (sameCommand(recorded, expected)) return true;
  if (item.skill !== undefined) return false;
  return recorded.length === expected.length && recorded[0] === expected[0] && recorded[1] === expected[1];
}

/**
 * The install entry for one skill of an item. An item that already names one skill needs no narrowing —
 * its own scope is that skill. A source-level item would otherwise reinstall everything its source
 * holds, so the names ride on the entry itself (`skills`): the catalogue model stays as it is and
 * `apply` still runs the same provider argv, only with `{skill}` filled in.
 */
export function narrowToSkill(data: Data, ctx: Ctx, entry: PlanEntry, skill: string): PlanEntry {
  if (entry.kind !== 'skill') return entry;
  const item = data.items.get(entry.itemId);
  const harness = data.harnesses.find((candidate) => candidate.id === entry.harness);
  if (!item || !harness || item.skill) return entry;
  const provider = data.providers.find((candidate) => candidate.id === entry.providerId);
  const narrowed: PlanEntry = { ...entry, skills: [skill] };
  if (provider?.adapter === 'skills-api') {
    narrowed.record = adapterRecord(item, skill);
    narrowed.via = adapterVia(item, skill, harness);
  } else if (provider?.install?.length) {
    narrowed.command = installArgv(provider, item, harness, ctx, skill);
  }
  return narrowed;
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
        const record = adapterRecord(item, item.skill);
        const recordedEntry = findEntry(state, itemId, harnessId);
        const matchesRecord = adapterCovers(recordedEntry?.command, record, item);
        // The lockfile answers in milliseconds; listSkills() scans every skill dir (~7s for 103).
        const present = verifyInstalled(harness, item, provider, ctx) === 'present';
        entries.push({
          ...base,
          action: matchesRecord && present ? 'already' : 'run',
          adapter: 'skills-api',
          via: adapterVia(item, item.skill, harness),
          record,
          // A record is not evidence: only say "recorded" when our record is the one that matches too.
          // A skill installed outside ahsm is present and needs no install — but it is not ours.
          reason: matchesRecord && present ? t.recordedInstalled : undefined,
        });
        continue;
      }

      const command = installArgv(provider, item, harness, ctx);
      const recorded = findEntry(state, itemId, harnessId);
      const matchesRecord = argvCovers(recorded?.command, command, provider, item, harness, ctx);

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
