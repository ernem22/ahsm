import type { Plan, PlanAction, PlanEntry } from '../core/plan.js';
import { planLines, type Line } from '../render.js';
import type { Selection } from '../types.js';
import type { InstallForm } from './install.js';

/** What the install form asks the core for: the harnesses and the items the user chose, nothing else. */
export function planSelection(form: InstallForm): Selection {
  return { harnessIds: [...form.harnessIds], itemIds: [...form.itemIds] };
}

/**
 * The order the plan is read in: what happens to each entry, from the installs to the ones that cannot
 * run at all. Grouping costs no formatter — it reorders a copy and lets `planLines` write the words.
 */
const OUTCOME: Record<PlanAction, number> = { run: 0, already: 1, unsupported: 2, error: 3 };
const BLOCKED = 4;

export function outcomeRank(entry: PlanEntry): number {
  return entry.blockedBy === undefined ? OUTCOME[entry.action] : BLOCKED;
}

/** A copy with the entries grouped by outcome; `sort` is stable, so a rebuild keeps the order. */
export function orderedPlan(plan: Plan): Plan {
  return { ...plan, entries: [...plan.entries].sort((left, right) => outcomeRank(left) - outcomeRank(right)) };
}

/** One entry and the lines the formatter writes for it: the row, then its detail lines. */
export interface PlanBlock {
  entry: PlanEntry;
  lines: Line[];
}

export function planBlocks(plan: Plan): PlanBlock[] {
  return orderedPlan(plan).entries.map((entry) => {
    const lines = planLines({ ...plan, entries: [entry], requirements: [], warnings: [] });
    return { entry, lines: lines.slice(0, -1) };
  });
}

/** The rows below the entries: the requirements, the warnings, and the count line emitted last. */
export interface PlanTail {
  requirements: Line[];
  warnings: Line[];
  count: Line;
}

export function planTail(plan: Plan): PlanTail {
  const full = planLines(orderedPlan(plan));
  return {
    requirements: planLines({ ...plan, entries: [], warnings: [] }).slice(0, -1),
    warnings: planLines({ ...plan, entries: [], requirements: [] }).slice(0, -1),
    count: full[full.length - 1] as Line,
  };
}
