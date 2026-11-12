import type { Key } from 'ink';
import { t } from '../i18n.js';
import { advance, moveCursor, stepBack, toggleFocused, toggleSection, type InstallForm } from './install.js';
import { goTo, moveBy, type RowWindow } from './window.js';

/** The eight surfaces of the window; the seven commands of the rail plus the home surface. */
export type SurfaceId = 'install' | 'plan' | 'status' | 'list' | 'stale' | 'update' | 'remove';

/** What a key is allowed to do: the shell owns every piece of state the tables change. */
export interface KeyHost {
  readonly surface: SurfaceId;
  readonly help: boolean;
  readonly install: InstallForm;
  /** The plan's row window and how many rows it can focus; read from the surface's own read. */
  readonly plan: RowWindow;
  readonly planCount: number;
  /** How many rows `PgUp`/`PgDn` move: one window of the frame the user is looking at. */
  readonly page: number;
  go(surface: SurfaceId): void;
  openHelp(): void;
  closeHelp(): void;
  quit(): void;
  say(message: string | undefined): void;
  setInstall(form: InstallForm): void;
  setPlanWindow(window: RowWindow): void;
  rebuildPlan(): void;
}

export interface KeyBinding {
  /** Input tokens that dispatch this binding; the first one names it on screen. */
  keys: string[];
  label: string;
  /** Absent from the keybar; the rail and the help overlay still print it, because it is a real key. */
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

/** The rail letters as bindings: the rail prints them in the header, so they are not keybar entries. */
const navigation: KeyTable = RAIL.map(({ key, surface }) => ({
  keys: [key],
  label: t.tui.surfaces[surface],
  hidden: true,
  run: (host: KeyHost) => host.go(surface),
}));

/**
 * `Esc` while the overlay is open. The overlay and the keybar share this one binding, so a frame can
 * never say `Esc back` in one place and `Esc close` in the other.
 */
const closeBinding: KeyBinding = { keys: ['escape'], label: t.tui.keys.close, run: (host) => host.closeHelp() };

/** Quitting is the one key that stays live in every mode. */
const quitBinding: KeyBinding = { keys: ['q'], label: t.tui.keys.quit, run: (host) => host.quit() };

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
  quitBinding,
];

/**
 * The install form: one focused section at a time. `space` and `a` change rows, `Up`/`Down` move the
 * cursor (hidden from the keybar, listed in the overlay), `Enter` goes forward and `Esc` back — and a
 * refused `Enter` says why instead of doing nothing.
 */
const installTable: KeyTable = [
  {
    keys: ['space'],
    label: t.tui.keys.choose,
    run: (host) => {
      host.say(undefined);
      host.setInstall(toggleFocused(host.install));
    },
  },
  {
    keys: ['a'],
    label: t.tui.keys.all,
    // The package section is a single choice, so "all" has nothing to mean there.
    when: (host) => host.install.stage !== 'package',
    run: (host) => {
      host.say(undefined);
      host.setInstall(toggleSection(host.install));
    },
  },
  {
    keys: ['up'],
    label: t.tui.keys.move,
    hidden: true,
    run: (host) => host.setInstall(moveCursor(host.install, -1)),
  },
  {
    keys: ['down'],
    label: t.tui.keys.move,
    hidden: true,
    run: (host) => host.setInstall(moveCursor(host.install, 1)),
  },
  {
    keys: ['return'],
    label: t.tui.keys.next,
    run: (host) => {
      const next = advance(host.install);
      if (next.kind === 'refused') {
        host.say(next.message);
        return;
      }
      host.say(undefined);
      if (next.kind === 'plan') host.go('plan');
      else host.setInstall(next.form);
    },
  },
  {
    keys: ['escape'],
    label: t.tui.keys.back,
    // While the overlay is open `Esc` closes it, and the overlay shares this frame's key set.
    when: (host) => !host.help && host.install.stage !== 'harnesses',
    run: (host) => {
      host.say(undefined);
      host.setInstall(stepBack(host.install));
    },
  },
];

/**
 * The plan body, read-only: the window moves and `r` reads the plan again. No key here writes, and no
 * key here is missing from the table, so the keybar and the overlay always say what the body offers.
 */
const planTable: KeyTable = [
  {
    keys: ['up'],
    label: t.tui.keys.move,
    hidden: true,
    run: (host) => host.setPlanWindow(moveBy(host.plan, host.planCount, -1)),
  },
  {
    keys: ['down'],
    label: t.tui.keys.move,
    hidden: true,
    run: (host) => host.setPlanWindow(moveBy(host.plan, host.planCount, 1)),
  },
  {
    keys: ['pageup'],
    label: t.tui.keys.move,
    hidden: true,
    run: (host) => host.setPlanWindow(moveBy(host.plan, host.planCount, -host.page)),
  },
  {
    keys: ['pagedown'],
    label: t.tui.keys.move,
    hidden: true,
    run: (host) => host.setPlanWindow(moveBy(host.plan, host.planCount, host.page)),
  },
  {
    keys: ['g'],
    label: t.tui.keys.first,
    hidden: true,
    run: (host) => host.setPlanWindow(goTo(0, host.planCount)),
  },
  {
    keys: ['G'],
    label: t.tui.keys.last,
    hidden: true,
    run: (host) => host.setPlanWindow(goTo(host.planCount - 1, host.planCount)),
  },
  {
    keys: ['r'],
    label: t.tui.keys.rebuild,
    run: (host) => {
      host.say(undefined);
      host.rebuildPlan();
    },
  },
];

/** One table per surface; its keys are dispatched before the global ones and listed in its keybar. */
export const surfaceKeys: Record<SurfaceId, KeyTable> = {
  install: installTable,
  plan: planTable,
  status: [],
  list: [],
  stale: [],
  update: [],
  remove: [],
};

/** The overlay is a mode: only closing it and quitting stay live while it is open. */
export const helpKeys: KeyTable = [
  closeBinding,
  { keys: ['?'], label: t.tui.keys.close, hidden: true, run: (host) => host.closeHelp() },
  quitBinding,
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

/**
 * One key set per frame. The overlay prints all of it and the keybar prints the entries that are not
 * `hidden`, so the two can never disagree about what a key is called or whether it is there.
 *
 * While the overlay is open that set is the overlay's own table plus the rail letters: `Esc` really
 * closes and `?` really closes, so neither is called `back` or `keys`, and the surface's letters stay
 * listed even when the window is too narrow for the rail — width hides chrome, never knowledge.
 */
export function frameKeys(surface: SurfaceId, help: boolean, host: KeyHost): KeyBinding[] {
  const table: KeyTable = help ? [...surfaceKeys[surface], ...navigation, closeBinding, quitBinding] : activeKeys(surface, false);
  return table.filter((binding) => binding.when?.(host) ?? true);
}

/** The keybar's half of the frame's key set: everything the overlay lists except the `hidden` entries. */
export function keybarKeys(frame: KeyBinding[]): KeyBinding[] {
  return frame.filter((binding) => !binding.hidden);
}

export function findBinding(table: KeyTable, host: KeyHost, token: string): KeyBinding | undefined {
  return table.find((binding) => binding.keys.includes(token) && (binding.when?.(host) ?? true));
}

/** The key's own name on screen, from the first token it dispatches. */
export function keyName(binding: KeyBinding): string {
  const token = binding.keys[0] ?? '';
  return t.tui.keyNames[token] ?? token;
}

/** `space choose` — a binding's own words, the one renderer the keybar, the rail and the overlay use. */
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
  return navigation.map(entryText).join(t.tui.keybarSeparator);
}
