import { t } from './i18n.js';
import type { ApplyOutcome } from './core/apply.js';
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
    lines.push({
      text: `${ACTION_MARK[entry.action]} ${entry.itemId} → ${entry.harness} [${entry.kind}/${entry.providerId ?? '-'}]`,
      tone: entry.action === 'error' ? 'error' : 'normal',
    });
    if (entry.command) lines.push({ text: `    ${t.runPrefix}: ${entry.command.join(' ')}`, tone: 'dim' });
    if (entry.hook) {
      const where = `${entry.hook.target.file} → ${entry.hook.target.path.join('.')}`;
      lines.push({ text: `    ${t.writePrefix}: ${where}`, tone: 'dim' });
      lines.push({ text: `    ${t.hookEntry}: ${JSON.stringify(entry.hook.entry)}`, tone: 'dim' });
    }
    if (entry.reason) lines.push({ text: `    ${t.notePrefix}: ${entry.reason}`, tone: 'dim' });
  }

  for (const requirement of plan.requirements) {
    const install =
      !requirement.present && requirement.installCommand ? ` → ${requirement.installCommand.join(' ')}` : '';
    lines.push({
      text: `${requirement.present ? t.ready : t.missing}  ${t.requirement} ${requirement.id}${install}`,
      tone: requirement.present ? 'normal' : 'warning',
    });
  }

  for (const warning of plan.warnings) lines.push({ text: warning, tone: 'warning' });

  const runs = plan.entries.filter((entry) => entry.action === 'run').length;
  lines.push({ text: t.actions(runs, plan.entries.length - runs), tone: 'dim' });
  return lines;
}

export function outcomeLines(outcome: ApplyOutcome): Line[] {
  const lines: Line[] = [];

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
