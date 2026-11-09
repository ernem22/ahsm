import fs from 'node:fs';
import path from 'node:path';
import type { Ctx } from '../context.js';
import { mergeHook, readText } from '../apply/hook-merger.js';
import type { Data } from '../types.js';
import type { Plan, PlanEntry } from './plan.js';
import { entryDefs } from './entry.js';
import { meetsRequirement } from './requirements.js';
import { backupFile, readState, recordEntry } from './state.js';
import { t } from '../i18n.js';

export type ApplyStatus = 'ok' | 'already' | 'unsupported' | 'error';

export interface ApplyResult {
  entry: PlanEntry;
  status: ApplyStatus;
  message?: string;
}

export interface RequirementResult {
  id: string;
  ok: boolean;
  message?: string;
}

export interface ApplyOutcome {
  requirements: RequirementResult[];
  items: ApplyResult[];
  warnings: string[];
}

function tailLine(stderr: string, fallback: string): string {
  return (
    stderr
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-1)[0] ?? fallback
  );
}

/** Runs the plan: bootstrap requirements, then each entry in order; a failure is reported, not fatal. */
export async function applyPlan(data: Data, ctx: Ctx, plan: Plan): Promise<ApplyOutcome> {
  const requirements: RequirementResult[] = [];
  const unmet = new Set<string>();

  for (const requirement of plan.requirements) {
    if (requirement.present) {
      requirements.push({ id: requirement.id, ok: true });
      continue;
    }
    if (!requirement.installCommand) {
      requirements.push({ id: requirement.id, ok: false, message: t.notDefined });
      unmet.add(requirement.id);
      continue;
    }

    const install = await ctx.runner.run(requirement.installCommand);
    if (install.code !== 0) {
      requirements.push({ id: requirement.id, ok: false, message: tailLine(install.stderr, t.missing) });
      unmet.add(requirement.id);
      continue;
    }

    // An installer (winget/brew/apt) does not touch this process's PATH: re-check before relying on it.
    const def = data.requires.find((candidate) => candidate.id === requirement.id);
    const recheck = def ? await ctx.runner.run(def.check.command) : undefined;
    const ok = def !== undefined && meetsRequirement(def, recheck);
    requirements.push({ id: requirement.id, ok, message: ok ? undefined : t.requirementUnmet(requirement.id) });
    if (!ok) unmet.add(requirement.id);
  }

  const items: ApplyResult[] = [];
  const stored = readState(ctx);
  const warnings = stored.warning ? [stored.warning] : [];
  let state = stored.state;

  for (const entry of plan.entries) {
    const blocked = entryDefs(data, entry).provider?.requires?.find((id) => unmet.has(id));

    if (entry.action === 'run' && blocked) {
      items.push({ entry, status: 'error', message: t.requirementUnmet(blocked) });
      continue;
    }
    if (entry.action === 'already') {
      items.push({ entry, status: 'already' });
      continue;
    }
    if (entry.action === 'unsupported') {
      items.push({ entry, status: 'unsupported', message: entry.reason });
      continue;
    }
    if (entry.action === 'error') {
      items.push({ entry, status: 'error', message: entry.reason });
      continue;
    }

    if (entry.hook) {
      const target = entry.hook.target;
      const previous = state.entries.find(
        (recorded) => recorded.itemId === entry.itemId && recorded.harness === entry.harness,
      )?.hookCommand;
      try {
        const merged = mergeHook(readText(target.file), target.path, target.spec, previous);
        if (!merged.changed) {
          items.push({ entry, status: 'already' });
          continue;
        }
        backupFile(ctx, target.file);
        fs.mkdirSync(path.dirname(target.file), { recursive: true });
        fs.writeFileSync(target.file, merged.text, 'utf8');
        state = recordEntry(ctx, state, {
          ref: { itemId: entry.itemId, harness: entry.harness, providerId: entry.providerId },
          kind: entry.kind,
          hookCommand: target.spec.command,
        });
        items.push({ entry, status: 'ok' });
      } catch (error) {
        items.push({
          entry,
          status: 'error',
          message: t.hookError(error),
        });
      }
      continue;
    }

    if (!entry.command) {
      items.push({ entry, status: 'error', message: t.commandMissing });
      continue;
    }

    const result = await ctx.runner.run(entry.command);
    if (result.code === 0) {
      state = recordEntry(ctx, state, {
        ref: { itemId: entry.itemId, harness: entry.harness, providerId: entry.providerId },
        kind: entry.kind,
        command: entry.command,
      });
      items.push({ entry, status: 'ok' });
    } else {
      items.push({ entry, status: 'error', message: tailLine(result.stderr, t.exitCode(result.code)) });
    }
  }

  return { requirements, items, warnings };
}
