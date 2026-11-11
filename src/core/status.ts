import type { Ctx } from '../context.js';
import { mergeHook, readText } from '../apply/hook-merger.js';
import { hookTarget } from '../apply/hook-target.js';
import type { Data, HarnessDef, Kind, RequirementDef } from '../types.js';
import { detectHarnesses } from './detect.js';
import { entryDefs } from './entry.js';
import { checkRequirement } from './requirements.js';
import { verifyInstalled } from './verify.js';
import { readState } from './state.js';
import { t } from '../i18n.js';

export type StatusValue = 'up-to-date' | 'missing' | 'unknown';

/** How a harness definition looks on this machine: usable, too old, or simply not here. */
export type HarnessStatus = 'ready' | 'too-old' | 'absent';

export interface StatusRow {
  itemId: string;
  harness: string;
  kind: Kind;
  value: StatusValue;
  detail?: string;
}

/** One harness definition as this machine sees it: present is not the same as usable. */
export interface HarnessStatusRow {
  id: string;
  /** A probe hit: the config directory or the CLI binary is there. */
  present: boolean;
  /** The version the harness's own CLI reports, when it printed one. */
  version?: string;
  /** The minimum the definition declares through its requirement (`check.min`). */
  minimum?: string;
  /** Present and above the declared minimum (or no minimum declared). */
  usable: boolean;
  /** The command we would run to update it, only when it is too old. */
  updateCommand?: string[];
}

/**
 * Compares our record with what we can actually verify. Skills and MCP installs belong to their
 * provider, so we report `unknown` rather than claiming a state we did not check.
 */
export interface StatusReport {
  harnesses: HarnessStatusRow[];
  rows: StatusRow[];
  warnings: string[];
}

/**
 * The harness's own CLI is the requirement that carries its minimum version. The first requirement
 * that declares a minimum wins; with none declared, the first one that resolves is asked for its version.
 */
function harnessRequirement(data: Data, harness: HarnessDef): RequirementDef | undefined {
  const defs = (harness.requires ?? [])
    .map((id) => data.requires.find((candidate) => candidate.id === id))
    .filter((def): def is RequirementDef => def !== undefined);
  return defs.find((def) => def.check.min !== undefined) ?? defs[0];
}

/**
 * Read-only: presence comes from the probes, usability from the harness's own version command.
 * Nothing is written, not even a state backup — asking the question must never change the answer.
 */
export async function readStatus(data: Data, ctx: Ctx): Promise<StatusReport> {
  const stored = readState(ctx);
  const warnings = stored.warning ? [stored.warning] : [];

  const harnesses: HarnessStatusRow[] = [];
  for (const { def, present } of detectHarnesses(data, ctx)) {
    const base = { id: def.id, present };
    if (!present) {
      harnesses.push({ ...base, usable: false });
      continue;
    }
    const requirement = harnessRequirement(data, def);
    if (!requirement) {
      // No requirement declared: there is no minimum this harness could fall short of.
      harnesses.push({ ...base, usable: true });
      continue;
    }
    const check = checkRequirement(requirement, await ctx.runner.run(requirement.check.command));
    harnesses.push({
      ...base,
      usable: check.meets,
      version: check.version,
      minimum: requirement.check.min,
      updateCommand: check.meets ? undefined : requirement.install[ctx.platform],
    });
  }

  const rows = stored.state.entries.map((entry) => {
    const row = { itemId: entry.itemId, harness: entry.harness, kind: entry.kind };
    const { harness, provider, item } = entryDefs(data, entry);

    if (!harness || !item) {
      return { ...row, value: 'unknown' as const, detail: t.definitionMissing };
    }

    // A delegated install is verifiable only when its provider says how to look; otherwise say we don't know.
    if (!provider?.writes) {
      const verified = verifyInstalled(harness, item, provider, ctx);
      if (verified === 'present') return { ...row, value: 'up-to-date' as const };
      if (verified === 'missing') return { ...row, value: 'missing' as const };
      return { ...row, value: 'unknown' as const, detail: t.providerOwns };
    }

    const target = hookTarget(harness, provider, item, ctx);
    if (!target) {
      return { ...row, value: 'unknown' as const, detail: t.definitionMissing };
    }
    try {
      const merged = mergeHook(readText(target.file), target.path, target.spec, entry.hookCommand);
      return { ...row, value: merged.changed ? ('missing' as const) : ('up-to-date' as const) };
    } catch {
      return { ...row, value: 'unknown' as const, detail: t.hookTargetUnreadable };
    }
  });

  return { harnesses, rows, warnings };
}
