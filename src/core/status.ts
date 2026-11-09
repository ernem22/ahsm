import type { Ctx } from '../context.js';
import { mergeHook, readText } from '../apply/hook-merger.js';
import { hookTarget } from '../apply/hook-target.js';
import type { Data, Kind } from '../types.js';
import { entryDefs } from './entry.js';
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
    const row = { itemId: entry.itemId, harness: entry.harness, kind: entry.kind };
    const { harness, provider, item } = entryDefs(data, entry);

    // A provider that writes config itself can be verified; a delegated one cannot, so we say so.
    if (!harness || !provider?.writes || !item) {
      return { ...row, value: 'unknown' as const, detail: provider ? t.providerOwns : t.definitionMissing };
    }

    const target = hookTarget(harness, provider, item, ctx);
    if (!target) {
      return { ...row, value: 'unknown' as const, detail: t.definitionMissing };
    }
    try {
      const merged = mergeHook(readText(target.file), target.path, target.spec);
      return { ...row, value: merged.changed ? ('missing' as const) : ('up-to-date' as const) };
    } catch {
      return { ...row, value: 'unknown' as const, detail: t.hookTargetUnreadable };
    }
  });
}
