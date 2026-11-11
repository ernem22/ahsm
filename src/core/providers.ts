import type { Data, ItemDef, Kind, ProviderDef } from '../types.js';

export type Capability = 'install' | 'remove' | 'writes';

/** One lookup for every caller, so plan and remove can never pick a different provider. */
export function pickProvider(
  data: Data,
  kind: Kind,
  options: { harnessId?: string; capability?: Capability } = {},
): ProviderDef | undefined {
  const { harnessId, capability = 'install' } = options;
  return data.providers
    .filter((provider) => provider.kind === kind)
    .filter((provider) => (harnessId ? provider.supports.includes(harnessId) : true))
    .filter((provider) => {
      if (capability === 'remove') return Boolean(provider.remove);
      if (capability === 'writes') return Boolean(provider.writes);
      return Boolean((provider.install?.length ?? 0) > 0 || provider.writes);
    })
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))[0];
}

export function serverName(item: ItemDef): string {
  return item.serverName ?? item.id;
}
