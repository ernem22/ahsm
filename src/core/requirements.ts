import type { RunResult } from '../context.js';
import type { RequirementDef } from '../types.js';

function version(output: string): string | undefined {
  return output.match(/(\d+)\.(\d+)(?:\.(\d+))?/)?.[0];
}

function satisfies(found: string, min: string): boolean {
  const a = found.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

export interface RequirementCheck {
  /** The version the command printed, when one could be read out of it. */
  version?: string;
  /** True when the command succeeded and the printed version meets `check.min` (if declared). */
  meets: boolean;
}

/** One predicate for plan, status and apply, so a re-check can never be laxer than the first check. */
export function checkRequirement(def: RequirementDef, result: RunResult | undefined): RequirementCheck {
  if (!result || result.code !== 0) return { meets: false };
  const printed = version(`${result.stdout}${result.stderr}`);
  if (!def.check.min) return { version: printed, meets: true };
  return { version: printed, meets: printed !== undefined && satisfies(printed, def.check.min) };
}

export function meetsRequirement(def: RequirementDef, result: RunResult | undefined): boolean {
  return checkRequirement(def, result).meets;
}
