import { expandPath, type Ctx } from '../context.js';
import type { HarnessDef, ItemDef, ProviderDef } from '../types.js';
import type { HookSpec } from './hook-merger.js';

export interface HookTarget {
  file: string;
  section: string;
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
  const sectionTemplate = harness.hooks?.section ?? provider?.writes?.section;
  if (!sectionTemplate) return undefined;
  return {
    file: expandPath(harness.hooks?.path ?? harness.config.path, ctx.home),
    section: sectionTemplate.replace('{event}', item.event ?? ''),
    spec: {
      event: item.event ?? '',
      matcher: item.matcher ?? '',
      command: item.hookCommand ?? '',
    },
  };
}
