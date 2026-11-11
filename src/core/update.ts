import type { Ctx } from '../context.js';
import { t } from '../i18n.js';
import type { Data, ItemDef } from '../types.js';
import { requiredIds } from './entry.js';
import { buildPlan, type Plan } from './plan.js';
import { readState, type StateEntry } from './state.js';
import { readStaleSkills, type StaleRow } from './stale.js';

/** A stale skill the update cannot act on, with the reason in the glossary's words. */
export interface UpdateSkip {
  row: StaleRow;
  reason: string;
}

/**
 * What `agentenv update` would install: the stale rows the provider's own check found, turned into
 * the very entries `apply` installs from. Nothing here writes — only an approved run does.
 */
export interface UpdatePlan {
  /** The rows the provider marked stale: the only skills this plan may touch. */
  stale: StaleRow[];
  /** The install plan `applyPlan` runs: one entry per (item, harness), each forced to `run`. */
  plan: Plan;
  skips: UpdateSkip[];
  /** What the stale read could not do (no provider check, unreadable lockfile). */
  warnings: string[];
}

function pairKey(itemId: string, harness: string): string {
  return `${itemId}|${harness}`;
}

/**
 * The item that installs this skill. A row names one installed skill and the source it came from, so an
 * item matching on both is the same installation; an item naming no single skill owns its whole source.
 */
function skillItem(data: Data, row: StaleRow): ItemDef | undefined {
  const skills = [...data.items.values()].filter((item) => item.kind === 'skill' && item.source);
  const named = skills.filter((item) => item.skill === row.name);
  const pool = named.length > 0 ? named : skills.filter((item) => !item.skill);
  return pool.find((item) => !row.source || item.source === row.source);
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

  const stored = readState(ctx);
  const skips: UpdateSkip[] = [];
  const pairs = new Map<string, { row: StaleRow; harness: string }>();
  const itemIds = new Set<string>();
  const harnessIds = new Set<string>();

  for (const row of stale) {
    const item = skillItem(data, row);
    if (!item) {
      skips.push({ row, reason: t.updateNoItem(row.name) });
      continue;
    }
    const harnesses = recordedHarnesses(stored.state.entries, item.id);
    if (harnesses.length === 0) {
      skips.push({ row, reason: t.updateNoRecord(row.name) });
      continue;
    }
    itemIds.add(item.id);
    for (const harness of harnesses) {
      harnessIds.add(harness);
      pairs.set(pairKey(item.id, harness), { row, harness });
    }
  }

  if (pairs.size === 0) return { stale, plan: emptyPlan(), skips, warnings };

  const plan = await buildPlan(data, ctx, { itemIds: [...itemIds], harnessIds: [...harnessIds] });
  // A selection is a cross product, so buildPlan also pairs items with harnesses they never went to.
  plan.entries = plan.entries.filter((entry) => pairs.has(pairKey(entry.itemId, entry.harness)));

  const unmet = new Set(plan.requirements.filter((requirement) => !requirement.present).map((requirement) => requirement.id));
  const planned = new Set<string>();
  for (const entry of plan.entries) {
    const pair = pairs.get(pairKey(entry.itemId, entry.harness));
    if (!pair) continue;
    planned.add(pairKey(entry.itemId, entry.harness));
    if (entry.action === 'unsupported' || entry.action === 'error') continue;
    // "Already installed" is exactly what a stale skill looks like to the plan: install it anyway.
    entry.action = 'run';
    entry.reason = t.updateStaleCopy(pair.row.name);
    const blockedBy = requiredIds(data, entry).find((id) => unmet.has(id));
    if (blockedBy) entry.blockedBy = blockedBy;
    else delete entry.blockedBy;
  }

  // A recorded harness with no definition here cannot be planned: report it instead of dropping it.
  for (const [key, pair] of pairs) {
    if (!planned.has(key)) skips.push({ row: pair.row, reason: t.updateNoTarget(pair.row.name, pair.harness) });
  }

  return { stale, plan, skips, warnings };
}
