import type { Data, HarnessDef, ItemDef, ProviderDef } from '../types.js';

export interface EntryDefs {
  harness?: HarnessDef;
  provider?: ProviderDef;
  item?: ItemDef;
}

/**
 * Resolves a recorded entry back to the definitions it refers to. `apply` and `status` both need this,
 * and doing it twice is how they drift apart (one of them forgetting a provider that writes config).
 */
export function entryDefs(data: Data, entry: { itemId: string; harness: string; providerId?: string }): EntryDefs {
  return {
    harness: data.harnesses.find((candidate) => candidate.id === entry.harness),
    provider: data.providers.find((candidate) => candidate.id === entry.providerId),
    item: data.items.get(entry.itemId),
  };
}
