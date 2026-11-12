import { t } from './i18n.js';
import type { ApplyOutcome } from './core/apply.js';
import type { HarnessStatus, HarnessStatusRow, StatusReport } from './core/status.js';
import type { RemoveOutcome, RemovePlan, RemoveResult } from './core/remove.js';
import type { SkillInventoryReport } from './core/list.js';
import type { StaleReport } from './core/stale.js';
import type { UpdatePlan } from './core/update.js';
import { requirementState, type Plan, type PlanAction, type PlanEntry, type PlanRequirement } from './core/plan.js';

export type Tone = 'normal' | 'dim' | 'error' | 'warning';

/**
 * What a line is in its formatter's own output, so a surface can split it into a heading, a row and a
 * row's continuation without reading the text back and guessing.
 */
export type LineKind = 'heading' | 'row' | 'continuation' | 'note' | 'count';

export interface Line {
  text: string;
  tone: Tone;
  kind?: LineKind;
}

const ACTION_MARK: Record<PlanAction, string> = { run: '+', already: '=', unsupported: '!', error: '!' };

/**
 * What an entry installs, in one word: an entry narrowed to some of an item's skills names them, so two
 * rows for one source-level item stay apart and a per-skill result says which skill it is about.
 */
function entryName(entry: PlanEntry): string {
  return entry.skills?.length ? `${entry.itemId}/${entry.skills.join(',')}` : entry.itemId;
}

/** An unmet requirement either names the command we would run or says there is none on this platform. */
function requirementOffer(requirement: PlanRequirement): string {
  if (requirement.present) return '';
  if (!requirement.installCommand) return ` — ${t.noInstallCommand}`;
  return ` → ${requirement.installCommand.join(' ')}`;
}

/**
 * One renderer for both surfaces: the CLI prints `line.text`, the TUI maps `line.tone` to a colour.
 * Keeping the wording here is what stops the two from drifting apart.
 */
export function planLines(plan: Plan): Line[] {
  const lines: Line[] = [];

  for (const entry of plan.entries) {
    // A blocked entry keeps its action but is reported as blocked: apply still has the final word.
    const blocked = entry.blockedBy !== undefined;
    lines.push({
      text: `${blocked ? '!' : ACTION_MARK[entry.action]} ${entryName(entry)} → ${entry.harness} [${entry.kind}/${entry.providerId ?? '-'}]`,
      tone: blocked ? 'warning' : entry.action === 'error' ? 'error' : 'normal',
    });
    if (entry.command) lines.push({ text: `    ${t.runPrefix}: ${entry.command.join(' ')}`, tone: 'dim' });
    else if (entry.via) lines.push({ text: `    ${t.runPrefix}: ${t.adapterVia(entry.via)}`, tone: 'dim' });
    if (entry.hook) {
      const where = `${entry.hook.target.file} → ${entry.hook.target.path.join('.')}`;
      lines.push({ text: `    ${t.writePrefix}: ${where}`, tone: 'dim' });
      lines.push({ text: `    ${t.hookEntry}: ${JSON.stringify(entry.hook.entry)}`, tone: 'dim' });
    }
    if (entry.blockedBy) {
      lines.push({ text: `    ${t.blocked}: ${t.requirementUnmet(entry.blockedBy)}`, tone: 'warning' });
    }
    if (entry.reason) lines.push({ text: `    ${t.notePrefix}: ${entry.reason}`, tone: 'dim' });
  }

  for (const requirement of plan.requirements) {
    const name = requirement.label ?? requirement.id;
    const version = requirement.version ? ` ${requirement.version}` : '';
    const minimum = requirement.minimum ? ` · ${t.minimum(requirement.minimum)}` : '';
    const offered = requirementOffer(requirement);
    // The same three words and the same labels status uses for a harness: one vocabulary, not two.
    const state = t.harnessLabels[requirementState(requirement)];
    lines.push({
      text: `${state}  ${t.requirement} ${name}${version}${minimum}${offered}`,
      tone: requirement.present ? 'normal' : 'warning',
    });
  }

  for (const warning of plan.warnings) lines.push({ text: warning, tone: 'warning' });

  const blocked = plan.entries.filter((entry) => entry.blockedBy !== undefined).length;
  // Blocked entries are offered only if their requirement's update gets marked, so they are not "actions" yet.
  const runs = plan.entries.filter((entry) => entry.action === 'run' && entry.blockedBy === undefined).length;
  lines.push({ text: t.actions(runs, plan.entries.length - runs - blocked, blocked), tone: 'dim' });
  return lines;
}

export function outcomeLines(outcome: ApplyOutcome): Line[] {
  const lines: Line[] = [];

  for (const warning of outcome.warnings) lines.push({ text: `! ${warning}`, tone: 'warning' });

  for (const requirement of outcome.requirements) {
    if (!requirement.ok) {
      lines.push({ text: t.requirementFailed(requirement.id, requirement.message ?? t.missing), tone: 'error' });
    }
  }

  for (const result of outcome.items) {
    const suffix = result.message ? ` (${result.message})` : '';
    lines.push({
      text: `${t.applyLabels[result.status]}  ${entryName(result.entry)} → ${result.entry.harness}${suffix}`,
      tone: result.status === 'error' ? 'error' : 'normal',
    });
  }

  return lines;
}

/** Ink colour for a line; the CLI ignores it. */
export function toneColor(tone: Tone): string | undefined {
  if (tone === 'error') return 'red';
  if (tone === 'warning') return 'yellow';
  if (tone === 'dim') return undefined;
  return undefined;
}

export function removePlanLines(plan: RemovePlan): Line[] {
  const lines: Line[] = [];
  for (const entry of plan.entries) {
    lines.push({
      text: `- ${entry.itemId} [${entry.kind}] → ${t.removePlanLabels[entry.action]}`,
      tone: entry.action === 'error' ? 'error' : 'normal',
    });
    if (entry.harnesses.length > 0) lines.push({ text: `    ${t.removeAffects(entry.harnesses)}`, tone: 'dim' });
    if (entry.paths.length > 0) lines.push({ text: `    ${t.removePaths(entry.paths)}`, tone: 'dim' });
    if (entry.command) lines.push({ text: `    ${t.runPrefix}: ${entry.command.join(' ')}`, tone: 'dim' });
    if (entry.reason) lines.push({ text: `    ${t.notePrefix}: ${entry.reason}`, tone: 'dim' });
  }
  for (const warning of plan.warnings) lines.push({ text: warning, tone: 'warning' });
  return lines;
}

/** What each outcome status is worth on screen: `manual` asks for work too, so it is not dim. */
const REMOVE_TONE: Record<RemoveResult['status'], Tone> = {
  removed: 'normal',
  absent: 'dim',
  manual: 'warning',
  'not-covered': 'warning',
  error: 'error',
};

export function removeOutcomeLines(outcome: RemoveOutcome): Line[] {
  const lines: Line[] = outcome.warnings.map((warning) => ({ text: `! ${warning}`, tone: 'warning' as Tone }));
  for (const result of outcome.results) {
    const suffix = result.message ? ` (${result.message})` : '';
    lines.push({
      text: `${t.removeLabels[result.status]}  ${result.entry.itemId}${suffix}`,
      tone: REMOVE_TONE[result.status],
    });
  }
  return lines;
}

/**
 * The one listing formatter: name, scope, and the harnesses the provider says carry each skill,
 * including skills agentenv never installed. A skill no harness reports is still listed.
 */
export function listLines(report: SkillInventoryReport): Line[] {
  const lines: Line[] = [{ text: t.skillsTitle, tone: 'dim' }];
  if (report.rows.length === 0) {
    lines.push({ text: t.listEmpty, tone: 'dim' });
    return lines;
  }
  for (const row of report.rows) {
    const carriers = [...row.harnesses, ...row.otherAgents];
    const source = row.source ? ` [${row.source}]` : '';
    lines.push({
      text: `${t.scopeLabels[row.scope]}  ${row.name}${source} → ${carriers.length > 0 ? carriers.join(', ') : t.listNoHarness}`,
      tone: 'normal',
    });
  }
  lines.push({ text: t.listCount(report.rows.length), tone: 'dim' });
  return lines;
}

function harnessStatus(row: HarnessStatusRow): HarnessStatus {  if (!row.present) return 'absent';
  return row.usable ? 'ready' : 'too-old';
}

/**
 * The one freshness formatter: the verdict the provider's own update check supports, or `unknown`
 * with the reason the comparison could not be made. Nothing here is an installation.
 */
export function staleLines(report: StaleReport): Line[] {
  const lines: Line[] = report.warnings.map((warning) => ({ text: `! ${warning}`, tone: 'warning' as Tone }));
  lines.push({ text: t.staleTitle, tone: 'dim' });
  if (!report.covered) {
    lines.push({ text: t.staleNotCovered, tone: 'warning' });
    return lines;
  }
  if (report.rows.length === 0) {
    lines.push({ text: t.staleEmpty, tone: 'dim' });
    return lines;
  }
  for (const row of report.rows) {
    const source = row.source ? ` [${row.source}]` : '';
    const detail = row.detail ? ` — ${row.detail}` : '';
    lines.push({
      text: `${t.staleLabels[row.value]}  ${row.name}${source}${detail}`,
      tone: row.value === 'stale' ? 'warning' : 'normal',
    });
  }
  lines.push({ text: t.staleCount(report.rows.length), tone: 'dim' });
  return lines;
}

/**
 * The one update formatter: the stale rows the provider marked, then the plan apply would run — the same
 * installer, the same words. What the update could not act on is said before the plan, never dropped.
 */
export function updateLines(update: UpdatePlan): Line[] {
  const lines: Line[] = [
    ...update.warnings.map((warning) => ({ text: `! ${warning}`, tone: 'warning' as Tone })),
    ...update.skips.map((skip) => ({ text: `! ${skip.reason}`, tone: 'warning' as Tone })),
  ];
  if (update.plan.entries.length === 0) {
    lines.push({ text: t.updateNone, tone: 'dim' });
    return lines;
  }
  lines.push({ text: t.updateTitle, tone: 'dim' });
  lines.push(...planLines(update.plan));
  lines.push({ text: t.updateCount(update.stale.length, update.plan.entries.length), tone: 'dim' });
  return lines;
}

/** The results of an approved update, per skill and per harness: the skips still show, then the installs. */
export function updateOutcomeLines(update: UpdatePlan, outcome: ApplyOutcome): Line[] {
  const skipped: Line[] = update.skips.map((skip) => ({ text: `! ${skip.reason}`, tone: 'warning' as Tone }));
  return [...skipped, ...outcomeLines(outcome)];
}

/**
 * The one status formatter: the CLI prints these lines, the TUI colours them by tone. Harness presence,
 * the version its own CLI reports, the declared minimum, and the update we would run when it is too old.
 */
export function statusLines(report: StatusReport): Line[] {
  const lines: Line[] = report.warnings.map((warning) => ({ text: `! ${warning}`, tone: 'warning' as Tone, kind: 'note' as LineKind }));

  lines.push({ text: t.harnesses, tone: 'dim', kind: 'heading' });
  for (const row of report.harnesses) {
    const status = harnessStatus(row);
    if (status === 'absent') {
      lines.push({ text: `${t.harnessLabels.absent}  ${row.id}`, tone: 'dim', kind: 'row' });
      continue;
    }
    const version = row.version ?? t.versionUnknown;
    const minimum = row.minimum ? ` · ${t.minimum(row.minimum)}` : '';
    lines.push({
      text: `${t.harnessLabels[status]}  ${row.id}  ${version}${minimum}`,
      tone: status === 'too-old' ? 'warning' : 'normal',
      kind: 'row',
    });
    if (row.updateCommand) lines.push({ text: `    ${t.harnessUpdate(row.updateCommand)}`, tone: 'dim', kind: 'continuation' });
  }

  lines.push({ text: t.itemsTitle, tone: 'dim', kind: 'heading' });
  if (report.rows.length === 0) {
    lines.push({ text: t.statusEmpty, tone: 'dim', kind: 'note' });
    return lines;
  }
  for (const row of report.rows) {
    const detail = row.detail ? ` — ${row.detail}` : '';
    lines.push({
      text: `${t.statusLabels[row.value]}  ${row.itemId} → ${row.harness} [${row.kind}]${detail}`,
      tone: 'normal',
      kind: 'row',
    });
  }
  return lines;
}
