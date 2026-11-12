import type { Key } from 'ink';
import { t } from '../i18n.js';
import type { Tone } from '../render.js';
import { advance, moveCursor, stepBack, toggleFocused, toggleSection, type InstallForm } from './install.js';
import type { RowWindow } from './window.js';

/** The eight surfaces of the window; the seven commands of the rail plus the home surface. */
export type SurfaceId = 'install' | 'plan' | 'apply' | 'status' | 'list' | 'stale' | 'update' | 'remove';

/**
 * A rows surface with nothing else on it: one window, a page the size of the frame it shows, and the
 * read that fills it. `status` is the first one; a surface that only lists rows needs nothing more.
 */
export interface RowsHost {
  /** How many rows `PgUp`/`PgDn` move: one window of the frame the user is looking at. */
  readonly page: number;
  move(delta: number): void;
  pageBy(delta: number): void;
  edge(at: 'first' | 'last'): void;
  reload(): void;
}

/** What a key is allowed to do: the shell owns every piece of state the tables change. */
export interface KeyHost {
  readonly surface: SurfaceId;
  readonly help: boolean;
  /** The filter is being typed: its own mode, where a letter is text and not a key. */
  readonly filter: boolean;
  readonly install: InstallForm;
  /** The plan's row window and how many rows it can focus; read from the surface's own read. */
  readonly plan: RowWindow;
  readonly planCount: number;
  /** How many rows `PgUp`/`PgDn` move: one window of the frame the user is looking at. */
  readonly page: number;
  /** The requirement row the focus is on, when it is below the last entry; `space` marks it. */
  readonly requirementFocus: number | undefined;
  readonly requirementCount: number;
  /** The requirement ids the user marked; the apply passes exactly these to the core. */
  readonly updates: readonly string[];
  /** A write is in flight: its own keys are off until it finishes. */
  readonly applying: boolean;
  /** The write finished, so the apply surface shows the result rather than the plan. */
  readonly result: boolean;
  /** The status surface's own rows: its window, its page and its read. */
  readonly status: RowsHost;
  /** The list surface: the same window, plus its filter, its carrier toggle and its read. */
  readonly list: ListHost;
  go(surface: SurfaceId): void;
  openHelp(): void;
  closeHelp(): void;
  quit(): void;
  say(message: string | undefined, tone?: Tone): void;
  setInstall(form: InstallForm): void;
  movePlan(delta: number): void;
  pagePlan(delta: number): void;
  resetPlan(at: 'first' | 'last'): void;
  rebuildPlan(): void;
  toggleUpdate(): void;
  markAllUpdates(): void;
  runApply(): void;
}

/**
 * The list surface's own state beyond the window: the typed filter, the carrier toggle and the slow
 * read, which is the one read a user can stop waiting for.
 */
export interface ListHost {
  readonly page: number;
  /** The substring `/` has collected so far; empty means nothing is filtered. */
  readonly filterText: string;
  /** `f`: keep only the skills the chosen harnesses carry. */
  readonly carriers: boolean;
  /** The slow inventory read is in flight, so `Esc` has a wait to stop. */
  readonly busy: boolean;
  move(delta: number): void;
  pageBy(delta: number): void;
  edge(at: 'first' | 'last'): void;
  reload(): void;
  startFilter(): void;
  clearFilter(): void;
  keepFilter(): void;
  toggleCarriers(): void;
  stopWaiting(): void;
}

export interface KeyBinding {
  /** Input tokens that dispatch this binding; the first one names it on screen. */
  keys: string[];
  label: string;
  /** Absent from the keybar; the rail and the help overlay still print it, because it is a real key. */
  hidden?: boolean;
  /** Inactive and unlisted while it returns false. */
  when?(host: KeyHost): boolean;
  /** Returns the reason it does not act; the key stays listed and pressing it says so. */
  refuses?(host: KeyHost): string | undefined;
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

/**
 * A write is in flight. Every key that would leave the surface — or start a second write — says why it
 * does not, because writes cannot be cancelled and the result is the only honest thing to wait for.
 */
function refusesDuringWrite(host: KeyHost): string | undefined {
  return host.applying ? t.tui.applyRefusal : undefined;
}

/** The rows keys act on a body that is on screen: during the write the body is the busy block. */
function notWhileWriting(host: KeyHost): boolean {
  return !host.applying;
}

/** The rail letters as bindings: the rail prints them in the header, so they are not keybar entries. */
const navigation: KeyTable = RAIL.map(({ key, surface }) => ({
  keys: [key],
  label: t.tui.surfaces[surface],
  hidden: true,
  refuses: refusesDuringWrite,
  run: (host: KeyHost) => host.go(surface),
}));

/**
 * `Esc` while the overlay is open. The overlay and the keybar share this one binding, so a frame can
 * never say `Esc back` in one place and `Esc close` in the other.
 */
const closeBinding: KeyBinding = { keys: ['escape'], label: t.tui.keys.close, run: (host) => host.closeHelp() };

/** Quitting is the one key that stays live in every mode; a write in flight is the one exception. */
const quitBinding: KeyBinding = { keys: ['q'], label: t.tui.keys.quit, refuses: refusesDuringWrite, run: (host) => host.quit() };

/** Keys that work on every surface; `?` and `q` also appear in every keybar. */
export const globalKeys: KeyTable = [
  ...navigation,
  { keys: ['?'], label: t.tui.keys.help, run: (host) => host.openHelp() },
  {
    keys: ['escape'],
    label: t.tui.keys.back,
    when: (host) => host.surface !== 'install',
    refuses: refusesDuringWrite,
    // The confirm declines back to the plan; a finished write has no plan left to decline to.
    run: (host) => host.go(host.surface === 'apply' && !host.result ? 'plan' : 'install'),
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

/** `space` and `a` act on the focused requirement row, the same on the plan and the confirm. */
const markBinding: KeyBinding = {
  keys: ['space'],
  label: t.tui.keys.mark,
  when: notWhileWriting,
  run: (host) => host.toggleUpdate(),
};

const markAllBinding: KeyBinding = {
  keys: ['a'],
  label: t.tui.keys.markAll,
  when: notWhileWriting,
  run: (host) => host.markAllUpdates(),
};

/** `Enter` opens the confirm: the same body and marks, with the one key that writes. */
const confirmBinding: KeyBinding = {
  keys: ['return'],
  label: t.tui.keys.apply,
  run: (host) => host.go('apply'),
};

/**
 * The rows keys, shared by the plan and its confirm: the window moves through the entries, and `Down`
 * past the last entry walks the requirement rows, where `space` has something to mark.
 */
const planNavigation: KeyTable = [
  {
    keys: ['up'],
    label: t.tui.keys.move,
    hidden: true,
    when: notWhileWriting,
    run: (host) => host.movePlan(-1),
  },
  {
    keys: ['down'],
    label: t.tui.keys.move,
    hidden: true,
    when: notWhileWriting,
    run: (host) => host.movePlan(1),
  },
  {
    keys: ['pageup'],
    label: t.tui.keys.move,
    hidden: true,
    when: notWhileWriting,
    run: (host) => host.pagePlan(-host.page),
  },
  {
    keys: ['pagedown'],
    label: t.tui.keys.move,
    hidden: true,
    when: notWhileWriting,
    run: (host) => host.pagePlan(host.page),
  },
  {
    keys: ['g'],
    label: t.tui.keys.first,
    hidden: true,
    when: notWhileWriting,
    run: (host) => host.resetPlan('first'),
  },
  {
    keys: ['G'],
    label: t.tui.keys.last,
    hidden: true,
    when: notWhileWriting,
    run: (host) => host.resetPlan('last'),
  },
];

/**
 * The plan body, read-only: the window moves, requirements are marked and `r` reads the plan again.
 * No key here writes; `Enter` opens the confirm, where `y` is the only writer.
 */
const planTable: KeyTable = [
  ...planNavigation,
  markBinding,
  markAllBinding,
  confirmBinding,
  {
    keys: ['r'],
    label: t.tui.keys.rebuild,
    run: (host) => {
      host.say(undefined);
      host.rebuildPlan();
    },
  },
];

/**
 * The confirm: the plan body plus the one key that writes. `y` hands the core exactly the marks, `n`
 * and `Esc` decline without running anything and keep the selection.
 */
const applyTable: KeyTable = [
  {
    keys: ['y'],
    label: t.tui.keys.apply,
    refuses: refusesDuringWrite,
    run: (host) => host.runApply(),
  },
  ...planNavigation,
  markBinding,
  markAllBinding,
  {
    keys: ['n'],
    label: t.tui.keys.decline,
    refuses: refusesDuringWrite,
    run: (host) => host.go('plan'),
  },
];

/**
 * The result: every key here leaves, and each names its own destination. `Enter` exits, `s` opens the
 * follow-up question, `Esc` goes back to the form with the selection, `n` returns to the plan, and `r`
 * reads the plan again after the write so the rows show what is now true.
 */
const resultTable: KeyTable = [
  { keys: ['return'], label: t.tui.keys.exit, run: (host) => host.quit() },
  { keys: ['s'], label: t.tui.surfaces.status, run: (host) => host.go('status') },
  { keys: ['n'], label: t.tui.surfaces.plan, run: (host) => host.go('plan') },
  {
    keys: ['r'],
    label: t.tui.keys.rebuild,
    run: (host) => {
      host.rebuildPlan();
      host.go('plan');
    },
  },
];

/**
 * The status surface, read-only: the rows window moves and `r` reads the report again. No key here
 * writes, so the surface binds nothing a visitor has to be careful with.
 */
const statusTable: KeyTable = [
  { keys: ['up'], label: t.tui.keys.move, hidden: true, run: (host) => host.status.move(-1) },
  { keys: ['down'], label: t.tui.keys.move, hidden: true, run: (host) => host.status.move(1) },
  { keys: ['pageup'], label: t.tui.keys.move, hidden: true, run: (host) => host.status.pageBy(-host.status.page) },
  { keys: ['pagedown'], label: t.tui.keys.move, hidden: true, run: (host) => host.status.pageBy(host.status.page) },
  { keys: ['g'], label: t.tui.keys.first, hidden: true, run: (host) => host.status.edge('first') },
  { keys: ['G'], label: t.tui.keys.last, hidden: true, run: (host) => host.status.edge('last') },
  {
    keys: ['r'],
    label: t.tui.keys.refresh,
    run: (host) => {
      host.say(undefined);
      host.status.reload();
    },
  },
];

/**
 * The list surface, read-only: `/` narrows as you type, `f` keeps only what the chosen harnesses carry,
 * the window moves, and `r` reads the slow inventory again. `Esc` spends itself on whatever is live —
 * a running read, then a set filter — before the global `back` leaves the surface.
 */
const listTable: KeyTable = [
  {
    keys: ['escape'],
    label: t.tui.keys.stopWaiting,
    when: (host) => host.list.busy,
    run: (host) => host.list.stopWaiting(),
  },
  {
    keys: ['escape'],
    label: t.tui.keys.filterClear,
    when: (host) => host.list.filterText !== '',
    run: (host) => host.list.clearFilter(),
  },
  { keys: ['up'], label: t.tui.keys.move, hidden: true, run: (host) => host.list.move(-1) },
  { keys: ['down'], label: t.tui.keys.move, hidden: true, run: (host) => host.list.move(1) },
  { keys: ['pageup'], label: t.tui.keys.move, hidden: true, run: (host) => host.list.pageBy(-host.list.page) },
  { keys: ['pagedown'], label: t.tui.keys.move, hidden: true, run: (host) => host.list.pageBy(host.list.page) },
  { keys: ['g'], label: t.tui.keys.first, hidden: true, run: (host) => host.list.edge('first') },
  { keys: ['G'], label: t.tui.keys.last, hidden: true, run: (host) => host.list.edge('last') },
  {
    keys: ['/'],
    label: t.tui.keys.filter,
    when: (host) => host.list.filterText === '',
    run: (host) => host.list.startFilter(),
  },
  {
    keys: ['/'],
    label: t.tui.keys.edit,
    when: (host) => host.list.filterText !== '',
    run: (host) => host.list.startFilter(),
  },
  {
    keys: ['f'],
    label: t.tui.keys.carriers,
    // Nothing chosen on `install` carries nothing: the refusal says which surface to choose on.
    refuses: (host) => (host.install.harnessIds.length === 0 ? t.tui.listNoCarriers : undefined),
    run: (host) => {
      host.say(undefined);
      host.list.toggleCarriers();
    },
  },
  {
    keys: ['r'],
    label: t.tui.keys.refresh,
    run: (host) => {
      host.say(undefined);
      host.list.reload();
    },
  },
];

/**
 * The filter's mode: the only single-line text mode besides the remove name. A letter is text here, so
 * the table binds just the two keys that end it — `Esc` clears and leaves, `Enter` keeps and leaves.
 */
export const filterKeys: KeyTable = [
  { keys: ['escape'], label: t.tui.keys.filterClear, run: (host) => host.list.clearFilter() },
  { keys: ['return'], label: t.tui.keys.filterKeep, run: (host) => host.list.keepFilter() },
];

/** One table per surface; its keys are dispatched before the global ones and listed in its keybar. */
export const surfaceKeys: Record<SurfaceId, KeyTable> = {
  install: installTable,
  plan: planTable,
  apply: applyTable,
  status: statusTable,
  list: listTable,
  stale: [],
  update: [],
  remove: [],
};

/** The apply surface's keys follow its state: confirming, then the result once the write resolved. */
export function surfaceKeyTable(surface: SurfaceId, host: KeyHost): KeyTable {
  if (surface === 'apply' && host.result) return resultTable;
  return surfaceKeys[surface];
}

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

/** The table the current mode dispatches: the filter's, else the surface's own, then the global ones. */
export function activeKeys(surface: SurfaceId, help: boolean, host: KeyHost): KeyTable {
  if (help) return helpKeys;
  if (host.filter) return filterKeys;
  return [...surfaceKeyTable(surface, host), ...globalKeys];
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
  const table: KeyTable = help
    ? [...surfaceKeyTable(surface, host), ...navigation, closeBinding, quitBinding]
    : activeKeys(surface, false, host);
  return table.filter((binding) => binding.when?.(host) ?? true);
}

/**
 * The keybar's half of the frame's key set: everything the overlay lists except the `hidden` entries
 * and the ones that would refuse this press — a bar never advertises a key that does nothing.
 */
export function keybarKeys(frame: KeyBinding[], host: KeyHost): KeyBinding[] {
  return frame.filter((binding) => !binding.hidden && binding.refuses?.(host) === undefined);
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
