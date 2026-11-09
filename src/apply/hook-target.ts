import { expandPath, type Ctx } from '../context.js';
import type { HarnessDef, ItemDef, ProviderDef } from '../types.js';
import { sectionPath, type HookSpec } from './hook-merger.js';

export interface HookTarget {
  file: string;
  /** Edit path inside the file, e.g. `['hooks', 'PreToolUse']`. */
  path: string[];
  spec: HookSpec;
}

/**
 * The single place that answers "where does this hook go and what does it look like". Plan, apply and
 * status all resolve hooks through here, so they can never disagree about the target.
 */
export function hookTarget(
  harness: HarnessDef,
  provider: ProviderDef | undefined,
  item: ItemDef,
  ctx: Ctx,
): HookTarget | undefined {
  const template = harness.hooks?.section ?? provider?.writes?.section;
  if (!template) return undefined;
  // A hook with no event, matcher or command is a data defect: never write empty strings into config.
  if (!item.event || !item.matcher || !item.hookCommand) return undefined;
  return {
    file: expandPath(harness.hooks?.path ?? harness.config.path, ctx.home),
    path: sectionPath(template, item.event),
    spec: { event: item.event, matcher: item.matcher, command: item.hookCommand },
  };
}
