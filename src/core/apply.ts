import fs from 'node:fs';
import path from 'node:path';
import type { Ctx, RunResult } from '../context.js';
import { mergeHook, readText } from '../apply/hook-merger.js';
import { writeConfigFile } from '../apply/config-writer.js';
import type { Data } from '../types.js';
import type { Plan, PlanEntry } from './plan.js';
import { requiredIds } from './entry.js';
import { meetsRequirement } from './requirements.js';
import { backupFile, findEntry, readState, recordEntry, statePath } from './state.js';
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

export interface ApplyOptions {
  /**
   * The requirement ids the user marked in the plan. Omitted means the whole plan was approved (today's
   * `apply --yes`), so every offered update runs. An id left out is not installed: the requirement stays
   * unmet and the items that need it are reported blocked — the rest of the run is untouched.
   */
  updates?: string[];
}

/** Process exit code for an outcome: 1 if anything failed, 0 otherwise (warnings alone do not fail). */
export function exitCodeFor(outcome: ApplyOutcome): number {
  const failed = outcome.items.some((item) => item.status === 'error') || outcome.requirements.some((r) => !r.ok);
  return failed ? 1 : 0;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A runner that throws must not cost the whole report: treat it like an exit-1 result. */
async function runSafe(ctx: Ctx, argv: string[]): Promise<RunResult> {
  try {
    return await ctx.runner.run(argv);
  } catch (error) {
    return { code: 1, stdout: '', stderr: errorText(error) };
  }
}

/** Picks the line a human needs from a failed command: an error line beats a trailing banner. */
export function failureLine(stderr: string, fallback: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const interesting = lines.find((line) => /error|not found|cannot|denied|invalid/i.test(line));
  return (interesting ?? lines[0] ?? fallback).slice(0, 160);
}

export async function applyPlan(data: Data, ctx: Ctx, plan: Plan, options: ApplyOptions = {}): Promise<ApplyOutcome> {
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
    if (options.updates && !options.updates.includes(requirement.id)) {
      requirements.push({ id: requirement.id, ok: false, message: t.updateNotMarked(requirement.id) });
      unmet.add(requirement.id);
      continue;
    }

    const install = await runSafe(ctx, requirement.installCommand);
    if (install.code !== 0) {
      requirements.push({ id: requirement.id, ok: false, message: failureLine(install.stderr, t.missing) });
      unmet.add(requirement.id);
      continue;
    }

    // An installer (winget/brew/apt) does not touch this process's PATH: re-check before relying on it.
    const def = data.requires.find((candidate) => candidate.id === requirement.id);
    const recheck = def ? await runSafe(ctx, def.check.command) : undefined;
    const ok = def !== undefined && meetsRequirement(def, recheck);
    requirements.push({ id: requirement.id, ok, message: ok ? undefined : t.requirementUnmet(requirement.id) });
    if (!ok) unmet.add(requirement.id);
  }

  const items: ApplyResult[] = [];
  const stored = readState(ctx);
  const warnings: string[] = [];
  let recordingDisabled = false;
  // Never abort the installs over state.json: warn, leave the file alone and skip recording.
  const disableRecording = (reason: string): void => {
    recordingDisabled = true;
    warnings.push(t.stateNotRecorded(statePath(ctx), reason));
  };
  // Recording over a damaged state.json would erase the user's history: keep a copy first.
  // readState sets `warning` only together with `damaged`, so a non-damaged warning cannot reach here:
  // a damaged state has exactly one warning (backed up or not recorded), never stored.warning as well.
  if (stored.damaged === 'read') {
    disableRecording(t.stateFileUnreadable);
  } else if (stored.damaged === 'parse') {
    try {
      const dest = backupFile(ctx, statePath(ctx));
      // No file left to back up: keep the unreadable-state warning.
      const warning = dest ? t.stateBackedUp(statePath(ctx), dest) : stored.warning;
      if (warning) warnings.push(warning);
    } catch (error) {
      disableRecording(errorText(error));
    }
  }
  let state = stored.state;
  // A failed state write must never turn a finished install into an error or lose the report: warn once, stop recording.
  const record = (input: Parameters<typeof recordEntry>[2]): void => {
    if (recordingDisabled) return;
    try {
      state = recordEntry(ctx, state, input);
    } catch (error) {
      disableRecording(errorText(error));
    }
  };
  // A hook already in place still needs its command recorded, so a later change can find and replace it.
  const recordHook = (entry: PlanEntry): void => {
    const hookCommand = entry.hook?.target.spec.command;
    const recorded = findEntry(state, entry.itemId, entry.harness);
    if (hookCommand && recorded?.hookCommand !== hookCommand) {
      record({ ref: entry, kind: entry.kind, hookCommand });
    }
  };

  for (const entry of plan.entries) {
    const blocked = requiredIds(data, entry).find((id) => unmet.has(id));

    if (entry.action === 'run' && blocked) {
      items.push({ entry, status: 'error', message: t.requirementUnmet(blocked) });
      continue;
    }
    if (entry.action === 'already') {
      recordHook(entry);
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

    if (entry.adapter === 'skills-api') {
      const item = data.items.get(entry.itemId);
      const harness = data.harnesses.find((candidate) => candidate.id === entry.harness);
      if (!item?.source || !harness) {
        items.push({ entry, status: 'error', message: t.skillsApiNoSource });
        continue;
      }
      try {
        const outcome = await ctx.skills.install({
          source: item.source,
          skills: item.skill ? [item.skill] : undefined,
          agents: [harness.agentId ?? harness.id],
        });
        if (outcome.failed.length > 0) {
          items.push({ entry, status: 'error', message: outcome.failed[0]?.message ?? t.commandMissing });
          continue;
        }
        if (outcome.installed.length > 0) {
          record({ ref: { itemId: entry.itemId, harness: entry.harness, providerId: entry.providerId }, kind: entry.kind, command: entry.record });
        }
        items.push({ entry, status: outcome.installed.length > 0 ? 'ok' : 'already' });
      } catch (error) {
        items.push({ entry, status: 'error', message: t.hookError(error) });
      }
      continue;
    }

    if (entry.hook) {
      const target = entry.hook.target;
      const previous = findEntry(state, entry.itemId, entry.harness)?.hookCommand;
      try {
        const merged = mergeHook(readText(target.file), target.path, target.spec, previous);
        if (!merged.changed) {
          recordHook(entry);
          items.push({ entry, status: 'already' });
          continue;
        }
        writeConfigFile(ctx, target.file, merged.text);
        record({
          ref: entry,
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

    const result = await runSafe(ctx, entry.command);
    if (result.code === 0) {
      record({
        ref: entry,
        kind: entry.kind,
        command: entry.command,
      });
      items.push({ entry, status: 'ok' });
    } else {
      items.push({ entry, status: 'error', message: failureLine(result.stderr, t.exitCode(result.code)) });
    }
  }

  return { requirements, items, warnings };
}
