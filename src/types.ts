export type Kind = 'skill' | 'mcp' | 'hook';

export type ConfigFormat = 'jsonc' | 'toml';

/** Identifies one installed thing: the item, the harness it went to, and who installed it. */
export interface EntryRef {
  itemId: string;
  harness: string;
  providerId?: string;
}

export interface HarnessDef {
  id: string;
  label?: string;
  /** `~/path` (exists check) or `path:<binary>` (PATH check). */
  detect: string[];
  /** Value passed to providers as `-a` (npx skills / add-mcp agent id). */
  agentId?: string;
  /** Requirements of the harness itself (its CLI), installed like any other prerequisite. */
  requires?: string[];
  config: { path: string; format: ConfigFormat };
  hooks?: { path?: string; section: string };
  /** Where this harness keeps its own skills (the shared store is the provider's lockfile dir). */
  skills?: { path: string };
  /** Where this harness keeps MCP servers, so a delegated install can still be verified. */
  mcp?: { path: string; key: string; format?: ConfigFormat };
}

export interface ProviderDef {
  id: string;
  kind: Kind;
  supports: string[];
  requires?: string[];
  priority?: number;
  /** argv templates; `{placeholder}` values come from the item/harness. Absent for write-only providers. */
  install?: string[];
  remove?: string[];
  update?: string[];
  /** Built-in in-process implementation, used instead of argv templates (currently `skills-api`). */
  adapter?: 'skills-api';
  /** How to ask the owner whether the install is really there (skill lockfile, harness config). */
  verify?: { strategy: 'skill-lock'; file: string } | { strategy: 'json-key' };
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
  /** Server name in the harness config when it differs from the item id. */
  serverName?: string;
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
