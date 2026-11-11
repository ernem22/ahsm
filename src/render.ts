import { t } from './i18n.js';
import type { ApplyOutcome } from './core/apply.js';
import type { HarnessStatus, HarnessStatusRow, StatusReport } from './core/status.js';
import type { RemoveOutcome, RemovePlan } from './core/remove.js';
import type { Plan, PlanAction } from './core/plan.js';

export type Tone = 'normal' | 'dim' | 'error' | 'warning';

export interface Line {
  text: string;
  tone: Tone;
}

const ACTION_MARK: Record<PlanAction, string> = { run: '+', already: '=', unsupported: '!', error: '!' };

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
      text: `${blocked ? '!' : ACTION_MARK[entry.action]} ${entry.itemId} → ${entry.harness} [${entry.kind}/${entry.providerId ?? '-'}]`,
      tone: blocked ? 'warning' : entry.action === 'error' ? 'error' : 'normal',
    });
    if (entry.command) lines.push({ text: `    ${t.runPrefix}: ${entry.command.join(' ')}`, tone: 'dim' });
    else if (entry.via) lines.push({ text: `    ${t.runPrefix}: ${entry.via}`, tone: 'dim' });
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
    const offered =
      !requirement.present && requirement.installCommand ? ` → ${requirement.installCommand.join(' ')}` : '';
    // "too old" is the same word status uses: an unmet minimum is a requirement, not a detection failure.
    const state = requirement.present ? t.ready : requirement.version ? t.harnessLabels['too-old'] : t.missing;
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
      text: `${t.applyLabels[result.status]}  ${result.entry.itemId} → ${result.entry.harness}${suffix}`,
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

export function removeOutcomeLines(outcome: RemoveOutcome): Line[] {
  const lines: Line[] = outcome.warnings.map((warning) => ({ text: `! ${warning}`, tone: 'warning' as Tone }));
  for (const result of outcome.results) {
    const suffix = result.message ? ` (${result.message})` : '';
    lines.push({
      text: `${t.removeLabels[result.status]}  ${result.entry.itemId}${suffix}`,
      tone: result.status === 'error' ? 'error' : 'normal',
    });
  }
  return lines;
}

function harnessStatus(row: HarnessStatusRow): HarnessStatus {
  if (!row.present) return 'absent';
  return row.usable ? 'ready' : 'too-old';
}

/**
 * The one status formatter: the CLI prints these lines, the TUI colours them by tone. Harness presence,
 * the version its own CLI reports, the declared minimum, and the update we would run when it is too old.
 */
export function statusLines(report: StatusReport): Line[] {
  const lines: Line[] = report.warnings.map((warning) => ({ text: `! ${warning}`, tone: 'warning' as Tone }));

  lines.push({ text: t.harnesses, tone: 'dim' });
  for (const row of report.harnesses) {
    const status = harnessStatus(row);
    if (status === 'absent') {
      lines.push({ text: `${t.harnessLabels.absent}  ${row.id}`, tone: 'dim' });
      continue;
    }
    const version = row.version ?? t.versionUnknown;
    const minimum = row.minimum ? ` · ${t.minimum(row.minimum)}` : '';
    lines.push({
      text: `${t.harnessLabels[status]}  ${row.id}  ${version}${minimum}`,
      tone: status === 'too-old' ? 'warning' : 'normal',
    });
    if (row.updateCommand) lines.push({ text: `    ${t.harnessUpdate(row.updateCommand)}`, tone: 'dim' });
  }

  lines.push({ text: t.itemsTitle, tone: 'dim' });
  if (report.rows.length === 0) {
    lines.push({ text: t.statusEmpty, tone: 'dim' });
    return lines;
  }
  for (const row of report.rows) {
    const detail = row.detail ? ` — ${row.detail}` : '';
    lines.push({
      text: `${t.statusLabels[row.value]}  ${row.itemId} → ${row.harness} [${row.kind}]${detail}`,
      tone: 'normal',
    });
  }
  return lines;
}
