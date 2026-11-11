import type { Ctx } from '../context.js';
import { t } from '../i18n.js';
import type { Data, ItemDef } from '../types.js';
import { requiredIds } from './entry.js';
import { buildPlan, narrowToSkill, type Plan, type PlanEntry } from './plan.js';
import { readState, type StateEntry } from './state.js';
import { readStaleSkills, type StaleRow } from './stale.js';

/** A stale skill the update cannot act on, with the reason in the glossary's words. */
export interface UpdateSkip {
  name: string;
  reason: string;
}

/**
 * What `agentenv update` would install: the stale rows the provider's own check found, turned into
 * the very entries `apply` installs from. Nothing here writes — only an approved run does.
 */
export interface UpdatePlan {
  /** The rows the provider marked stale: the only skills this plan may touch. */
  stale: StaleRow[];
  /**
   * The install plan `applyPlan` runs: one entry per (stale skill, harness), each forced to `run` and
   * narrowed to that skill, so a source-level item installs the stale skills and nothing else.
   */
  plan: Plan;
  skips: UpdateSkip[];
  /** What the stale read could not do (no provider check, unreadable lockfile). */
  warnings: string[];
}

/** One `(item, harness)` pair the plan is built for; the slot's row says which skill it narrows to. */
interface Slot {
  row: StaleRow;
  itemId: string;
  harness: string;
}

function pairKey(itemId: string, harness: string): string {
  return `${itemId}|${harness}`;
}

/**
 * The item that installs this skill: the one whose own scope holds it. An item naming one skill owns
 * only that skill; an item naming none (a source-level item) owns every skill its source holds, so it is
 * matched on the source the provider recorded. A named item wins over a source-level one for the name.
 */
function skillItem(data: Data, row: StaleRow): ItemDef | undefined {
  const skills = [...data.items.values()].filter((item) => item.kind === 'skill' && item.source);
  const sameSource = row.source ? skills.filter((item) => item.source === row.source) : skills;
  return sameSource.find((item) => item.skill === row.name) ?? sameSource.find((item) => !item.skill);
}

/** The harnesses agentenv installed this item for: the record says where to install it again. */
function recordedHarnesses(entries: StateEntry[], itemId: string): string[] {
  return [...new Set(entries.filter((entry) => entry.itemId === itemId).map((entry) => entry.harness))].sort();
}

function emptyPlan(): Plan {
  return { selection: { itemIds: [], harnessIds: [] }, entries: [], requirements: [], warnings: [] };
}

/**
 * Side-effect free, like `plan` and `stale`: it asks the provider which installed skills are stale,
 * then builds the install plan for exactly those, so the update is the install path and nothing else.
 *
 * Only what the provider marked stale is in scope. A stale skill with no catalogue item or no record
 * of a harness is reported rather than guessed at — the record is not evidence (ADR-0002), but it is
 * the only thing that says which harness an installation was made for.
 */
export async function buildUpdatePlan(data: Data, ctx: Ctx): Promise<UpdatePlan> {
  const report = await readStaleSkills(data, ctx);
  const warnings = [...report.warnings];
  if (!report.covered) warnings.push(t.staleNotCovered);
  const stale = report.rows.filter((row) => row.value === 'stale');
  if (stale.length === 0) return { stale, plan: emptyPlan(), skips: [], warnings };

  // Read-only, like the rest: buildPlan warns about a damaged record, so this read does not repeat it.
  const stored = readState(ctx);
  const skips: UpdateSkip[] = [];
  const slots: Slot[] = [];
  const itemIds = new Set<string>();
  const harnessIds = new Set<string>();

  for (const row of stale) {
    const item = skillItem(data, row);
    if (!item) {
      skips.push({ name: row.name, reason: t.updateNoItem(row.name) });
      continue;
    }
    const harnesses = recordedHarnesses(stored.state.entries, item.id);
    if (harnesses.length === 0) {
      skips.push({ name: row.name, reason: t.updateNoRecord(row.name) });
      continue;
    }
    itemIds.add(item.id);
    for (const harness of harnesses) {
      harnessIds.add(harness);
      slots.push({ row, itemId: item.id, harness });
    }
  }

  if (slots.length === 0) return { stale, plan: emptyPlan(), skips, warnings };

  const plan = await buildPlan(data, ctx, { itemIds: [...itemIds], harnessIds: [...harnessIds] });
  // A selection is a cross product, so buildPlan also pairs items with harnesses they never went to,
  // and it yields one entry per (item, harness). Each slot turns its pair's entry into the install for
  // the one skill the provider marked, so two stale skills of one source install one each.
  const templates = new Map(plan.entries.map((entry) => [pairKey(entry.itemId, entry.harness), entry]));

  const unmet = new Set(plan.requirements.filter((requirement) => !requirement.present).map((requirement) => requirement.id));
  const entries: PlanEntry[] = [];
  const planned = new Set<string>();
  for (const slot of slots) {
    const template = templates.get(pairKey(slot.itemId, slot.harness));
    // A recorded harness with no definition here cannot be planned: the second loop reports it.
    if (!template) continue;
    planned.add(pairKey(slot.itemId, slot.harness));
    if (template.action === 'unsupported' || template.action === 'error') {
      entries.push(narrowToSkill(data, ctx, template, slot.row.name));
      continue;
    }
    // "Already installed" is exactly what a stale skill looks like to the plan: install it anyway.
    const entry = narrowToSkill(data, ctx, template, slot.row.name);
    entry.action = 'run';
    entry.reason = t.updateStaleCopy(slot.row.name);
    const blockedBy = requiredIds(data, entry).find((id) => unmet.has(id));
    if (blockedBy) entry.blockedBy = blockedBy;
    else delete entry.blockedBy;
    entries.push(entry);
  }
  plan.entries = entries;

  // A recorded harness with no definition here cannot be planned: report it instead of dropping it.
  for (const slot of slots) {
    if (!planned.has(pairKey(slot.itemId, slot.harness))) {
      skips.push({ name: slot.row.name, reason: t.updateNoTarget(slot.row.name, slot.harness) });
    }
  }

  return { stale, plan, skips, warnings };
}
