import { requirementState, type Plan, type PlanAction, type PlanEntry, type PlanRequirement } from '../core/plan.js';
import { t } from '../i18n.js';
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

/** A requirement the user may mark: its update is offered and only a mark runs it. */
export function markableRequirement(requirement: PlanRequirement): boolean {
  return requirementState(requirement) === 'too-old' && requirement.installCommand !== undefined;
}

/** The requirement ids a mark would offer the core: one per too-old requirement with an update. */
export function markableUpdates(plan: Plan): string[] {
  return plan.requirements.filter(markableRequirement).map((requirement) => requirement.id);
}

/** The ids `a` names; pressing it again clears them, so the key is never a one-way door. */
export function allUpdates(plan: Plan, marked: readonly string[]): string[] {
  const offered = markableUpdates(plan);
  return offered.length > 0 && offered.every((id) => marked.includes(id)) ? [] : offered;
}

export function toggleUpdate(marked: readonly string[], id: string): string[] {
  return marked.includes(id) ? marked.filter((candidate) => candidate !== id) : [...marked, id];
}

/** The requirement the focus is on, when that requirement's update can be marked. */
export function focusedRequirement(plan: Plan, focus: number | undefined): string | undefined {
  if (focus === undefined) return undefined;
  const requirement = plan.requirements[focus];
  return requirement && markableRequirement(requirement) ? requirement.id : undefined;
}

/**
 * The rows below the entries: the requirements (each with its focus mark and choice box), the mark
 * statement of the focused one, the warnings, the mark summary and the count line emitted last.
 */
export interface PlanTail {
  requirements: Line[];
  warnings: Line[];
  summary?: Line;
  count: Line;
}

export function planTail(plan: Plan, marked: readonly string[], focus: number | undefined): PlanTail {
  const full = planLines(orderedPlan(plan));
  const requirements: Line[] = [];
  plan.requirements.forEach((requirement, at) => {
    const [line] = planLines({ ...plan, entries: [], requirements: [requirement], warnings: [] });
    if (!line) return;
    const focused = at === focus;
    const markable = markableRequirement(requirement);
    const box = markable ? (marked.includes(requirement.id) ? t.tui.marks.chosen : t.tui.marks.unchosen) : '';
    requirements.push({
      text: `${focused ? t.tui.marks.focused : t.tui.marks.blank}${box}${line.text}`,
      tone: line.tone,
    });
    if (focused && markable) {
      const markedNow = marked.includes(requirement.id);
      requirements.push({ text: `    ${markedNow ? t.updatesMarked : t.updatesSkipped}`, tone: markedNow ? 'normal' : 'dim' });
    }
  });
  const offered = markableUpdates(plan);
  const anyMarked = offered.some((id) => marked.includes(id));
  return {
    requirements,
    warnings: planLines({ ...plan, entries: [], requirements: [] }).slice(0, -1),
    summary:
      offered.length === 0
        ? undefined
        : { text: anyMarked ? t.updatesMarked : t.updatesSkipped, tone: 'dim' as const },
    count: full[full.length - 1] as Line,
  };
}
