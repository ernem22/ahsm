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

/** One predicate for both plan and apply, so a re-check can never be laxer than the first check. */
export function meetsRequirement(def: RequirementDef, result: RunResult | undefined): boolean {
  if (!result || result.code !== 0) return false;
  if (!def.check.min) return true;
  const found = version(`${result.stdout}${result.stderr}`);
  return found !== undefined && satisfies(found, def.check.min);
}
