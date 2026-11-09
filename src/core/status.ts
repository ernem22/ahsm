import type { Ctx } from '../context.js';
import { mergeHook, readText } from '../apply/hook-merger.js';
import { hookTarget } from '../apply/hook-target.js';
import type { Data, Kind } from '../types.js';
import { entryDefs } from './entry.js';
import { verifyInstalled } from './verify.js';
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
export interface StatusReport {
  rows: StatusRow[];
  warnings: string[];
}

export function readStatus(data: Data, ctx: Ctx): StatusReport {
  const stored = readState(ctx);
  const warnings = stored.warning ? [stored.warning] : [];
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

  return { rows, warnings };
}
