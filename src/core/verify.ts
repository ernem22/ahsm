import fs from 'node:fs';
import { parse as parseJsonc } from 'jsonc-parser';
import { expandPath, type Ctx } from '../context.js';
import type { Data, HarnessDef, ItemDef, ProviderDef } from '../types.js';

export type Verified = 'present' | 'missing' | 'unknown';

function readJson(file: string): unknown {
  if (!fs.existsSync(file)) return undefined;
  try {
    return parseJsonc(fs.readFileSync(file, 'utf8'), [], { allowTrailingComma: true, disallowComments: false });
  } catch {
    return undefined;
  }
}

/** The lockfile is keyed by skill name; an item naming one skill must match that key, not just the repo. */
function lockHasSkill(file: string, item: ItemDef): Verified {
  if (!item.source) return 'unknown';
  const lock = readJson(file) as { skills?: Record<string, { source?: string }> } | undefined;
  if (!lock?.skills) return 'missing';
  const candidates = item.skill ? [lock.skills[item.skill]] : Object.values(lock.skills);
  return candidates.some((entry) => entry?.source === item.source) ? 'present' : 'missing';
}

function configHasKey(harness: HarnessDef, item: ItemDef, ctx: Ctx): Verified {
  const target = harness.mcp;
  if (!target) return 'unknown';
  const config = readJson(expandPath(target.path, ctx.home)) as Record<string, unknown> | undefined;
  const map = config?.[target.key];
  if (!map || typeof map !== 'object') return 'missing';
  return (item.serverName ?? item.id) in (map as Record<string, unknown>) ? 'present' : 'missing';
}

/**
 * Asks the thing that actually owns the install whether it is there. A record alone is not evidence:
 * the user may have deleted a skill by hand, and claiming "already installed" then hides the gap.
 */
export function verifyInstalled(
  harness: HarnessDef,
  item: ItemDef,
  provider: ProviderDef | undefined,
  ctx: Ctx,
): Verified {
  const verify = provider?.verify;
  if (!verify) return 'unknown';
  if (verify.strategy === 'skill-lock') return lockHasSkill(expandPath(verify.file, ctx.home), item);
  if (verify.strategy === 'json-key') return configHasKey(harness, item, ctx);
  return 'unknown';
}
