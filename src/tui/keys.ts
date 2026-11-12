import type { Key } from 'ink';
import { t } from '../i18n.js';

/** The eight surfaces of the window; the seven commands of the rail plus the home surface. */
export type SurfaceId = 'install' | 'plan' | 'status' | 'list' | 'stale' | 'update' | 'remove';

/** What a key is allowed to do: the shell owns every piece of state the tables change. */
export interface KeyHost {
  readonly surface: SurfaceId;
  readonly help: boolean;
  go(surface: SurfaceId): void;
  openHelp(): void;
  closeHelp(): void;
  quit(): void;
  say(message: string): void;
}

export interface KeyBinding {
  /** Input tokens that dispatch this binding; the first one names it on screen. */
  keys: string[];
  label: string;
  /** Dispatchable but absent from the keybar and the help overlay; the rail has its own row. */
  hidden?: boolean;
  /** Inactive and unlisted while it returns false. */
  when?(host: KeyHost): boolean;
  run(host: KeyHost): void;
}

export type KeyTable = readonly KeyBinding[];

/** The seven commands, in the order the rail prints them. */
export const RAIL: readonly { key: string; surface: SurfaceId }[] = [
  { key: 'i', surface: 'install' },
  { key: 'p', surface: 'plan' },
  { key: 's', surface: 'status' },
  { key: 'l', surface: 'list' },
  { key: 'v', surface: 'stale' },
  { key: 'u', surface: 'update' },
  { key: 'x', surface: 'remove' },
];

const navigation: KeyTable = RAIL.map(({ key, surface }) => ({
  keys: [key],
  label: t.tui.surfaces[surface],
  hidden: true,
  run: (host: KeyHost) => host.go(surface),
}));

/** Keys that work on every surface; `?` and `q` also appear in every keybar. */
export const globalKeys: KeyTable = [
  ...navigation,
  { keys: ['?'], label: t.tui.keys.help, run: (host) => host.openHelp() },
  {
    keys: ['escape'],
    label: t.tui.keys.back,
    when: (host) => host.surface !== 'install',
    run: (host) => host.go('install'),
  },
  { keys: ['q'], label: t.tui.keys.quit, run: (host) => host.quit() },
];

/** One table per surface; its keys are dispatched before the global ones and listed in its keybar. */
export const surfaceKeys: Record<SurfaceId, KeyTable> = {
  install: [],
  plan: [],
  status: [],
  list: [],
  stale: [],
  update: [],
  remove: [],
};

/** The overlay is a mode: only closing it and quitting stay live while it is open. */
export const helpKeys: KeyTable = [
  { keys: ['escape'], label: t.tui.keys.close, run: (host) => host.closeHelp() },
  { keys: ['?'], label: t.tui.keys.close, hidden: true, run: (host) => host.closeHelp() },
  { keys: ['q'], label: t.tui.keys.quit, run: (host) => host.quit() },
];

/** A keypress as one token, so a table never has to know how Ink spells a key. */
export function tokenOf(input: string, key: Key): string {
  if (key.escape) return 'escape';
  if (key.return) return 'return';
  if (key.tab) return 'tab';
  if (key.upArrow) return 'up';
  if (key.downArrow) return 'down';
  if (key.leftArrow) return 'left';
  if (key.rightArrow) return 'right';
  if (key.pageUp) return 'pageup';
  if (key.pageDown) return 'pagedown';
  if (key.backspace || key.delete) return 'backspace';
  if (input === ' ') return 'space';
  return input;
}

/** The table the current mode dispatches: the surface's own keys, then the global ones. */
export function activeKeys(surface: SurfaceId, help: boolean): KeyTable {
  return help ? helpKeys : [...surfaceKeys[surface], ...globalKeys];
}

export function findBinding(table: KeyTable, host: KeyHost, token: string): KeyBinding | undefined {
  return table.find((binding) => binding.keys.includes(token) && (binding.when?.(host) ?? true));
}

/** What the keybar and the help overlay print, in table order. */
export function listedKeys(table: KeyTable, host: KeyHost): KeyBinding[] {
  return table.filter((binding) => !binding.hidden && (binding.when?.(host) ?? true));
}

/** The key's own name on screen, from the first token it dispatches. */
export function keyName(binding: KeyBinding): string {
  const token = binding.keys[0] ?? '';
  return t.tui.keyNames[token] ?? token;
}

/** `space choose` — one keybar entry, the name and the work. */
export function entryText(binding: KeyBinding): string {
  return `${keyName(binding)} ${binding.label}`;
}

/** Entries joined by the separator, dropped from the end until they fit the width. */
export function keybarText(bindings: KeyBinding[], width: number): string {
  const kept: string[] = [];
  for (const binding of bindings) {
    const entry = entryText(binding);
    const next = [...kept, entry].join(t.tui.keybarSeparator);
    if (kept.length > 0 && next.length > width) break;
    kept.push(entry);
  }
  return kept.join(t.tui.keybarSeparator);
}

/** `i install · p plan · …`, or nothing when the header has no room for it. */
export function railText(width: number, minWidth: number): string | undefined {
  if (width < minWidth) return undefined;
  return RAIL.map(({ key, surface }) => `${key} ${t.tui.surfaces[surface]}`).join(t.tui.keybarSeparator);
}
