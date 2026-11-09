import type { Ctx } from '../context.js';
import { mergeHook, readText } from '../apply/hook-merger.js';
import { hookTarget } from '../apply/hook-target.js';
import type { Data, Kind } from '../types.js';
import { readState } from './state.js';
import { t } from '../i18n.js';

export type StatusValue = 'up-to-date' | 'missing' | 'unknown';

export interface StatusRow {
  itemId: string;
  harness: string;
  kind: Kind;
  value: StatusValue;
  detail?: string;
}

/**
 * Compares our record with what we can actually verify. Skills and MCP installs belong to their
 * provider, so we report `unknown` rather than claiming a state we did not check.
 */
export function readStatus(data: Data, ctx: Ctx): StatusRow[] {
  const state = readState(ctx);
  return state.entries.map((entry) => {
    if (entry.kind !== 'hook') {
      return { itemId: entry.itemId, harness: entry.harness, kind: entry.kind, value: 'unknown' as const, detail: t.providerOwns };
    }
    const harness = data.harnesses.find((candidate) => candidate.id === entry.harness);
    const provider = data.providers.find((candidate) => candidate.id === entry.providerId);
    const item = data.items.get(entry.itemId);
    if (!harness || !provider?.writes || !item) {
      return { itemId: entry.itemId, harness: entry.harness, kind: entry.kind, value: 'unknown' as const, detail: t.definitionMissing };
    }
    const target = hookTarget(harness, provider, item, ctx);
    if (!target) {
      return { itemId: entry.itemId, harness: entry.harness, kind: entry.kind, value: 'unknown' as const, detail: t.definitionMissing };
    }
    try {
      const merged = mergeHook(readText(target.file), target.section, target.spec);
      return {
        itemId: entry.itemId,
        harness: entry.harness,
        kind: entry.kind,
        value: merged.changed ? ('missing' as const) : ('up-to-date' as const),
      };
    } catch {
      return { itemId: entry.itemId, harness: entry.harness, kind: entry.kind, value: 'unknown' as const, detail: t.hookTargetUnreadable };
    }
  });
}
