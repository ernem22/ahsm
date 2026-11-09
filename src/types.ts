export type Kind = 'skill' | 'mcp' | 'hook';

export interface HarnessDef {
  id: string;
  label?: string;
  /** `~/path` (exists check) or `path:<binary>` (PATH check). */
  detect: string[];
  /** Value passed to providers as `-a` (npx skills / add-mcp agent id). */
  agentId?: string;
  config: { path: string; format: 'jsonc' };
  hooks?: { path?: string; section: string };
}

export interface ProviderDef {
  id: string;
  kind: Kind;
  supports: string[];
  requires?: string[];
  priority?: number;
  /** argv templates; `{placeholder}` values come from the item/harness. */
  check?: string[];
  install: string[];
  remove?: string[];
  update?: string[];
  /** Providers that write config themselves (hooks) instead of shelling out. */
  writes?: { path: string; section: string };
}

export interface RequirementDef {
  id: string;
  check: { command: string[]; min?: string };
  install: Record<string, string[]>;
}

export interface ItemDef {
  id: string;
  kind: Kind;
  targets: string[] | '*';
  note?: string;
  link?: string;
  // skill
  source?: string;
  skill?: string;
  // mcp (biri yeterli: npm paketi veya uzak URL)
  package?: string;
  url?: string;
  // hook
  event?: string;
  matcher?: string;
  hookCommand?: string;
}

export interface PackageDef {
  id: string;
  /** Marks the package installed when the user names none. */
  default?: boolean;
  note?: string;
  link?: string;
  items: string[];
}

export interface Data {
  items: Map<string, ItemDef>;
  packages: Map<string, PackageDef>;
  harnesses: HarnessDef[];
  providers: ProviderDef[];
  requires: RequirementDef[];
}

export interface Selection {
  harnessIds: string[];
  itemIds: string[];
}
