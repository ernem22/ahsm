import type { Key } from 'ink';
import type { StaleValue } from '../core/stale.js';
import { t } from '../i18n.js';
import type { Tone } from '../render.js';
import { advance, moveCursor, stepBack, toggleFocused, toggleSection, type InstallForm } from './install.js';
import type { RowWindow } from './window.js';

/** The eight surfaces of the window; the seven commands of the rail plus the home surface. */
export type SurfaceId = 'install' | 'plan' | 'apply' | 'status' | 'list' | 'stale' | 'update' | 'remove';

/**
 * What the shell owns and every table may use: where the user is, what a key may change outside the
 * surface, and the one status line a key can write. Everything else a key touches belongs to the
 * surface that declares the key.
 */
export interface ChromeHost {
  readonly surface: SurfaceId;
  /** A write is in flight: its own keys are off until it finishes. */
  readonly applying: boolean;
  /** The write finished, so the apply surface shows the result rather than the plan. */
  readonly result: boolean;
  go(surface: SurfaceId): void;
  openHelp(): void;
  closeHelp(): void;
  quit(): void;
  say(message: string | undefined, tone?: Tone): void;
}

/** One window over rows, a page the size of the frame it shows, and the read that fills it. */
export interface RowsKeys {
  /** How many rows `PgUp`/`PgDn` move: one window of the frame the user is looking at. */
  readonly page: number;
  move(delta: number): void;
  pageBy(delta: number): void;
  edge(at: 'first' | 'last'): void;
  reload(): void;
}

/** A rows surface whose read is slow enough that `Esc` has a wait to stop. */
export interface SlowRowsKeys extends RowsKeys {
  /** The read is in flight, so `Esc` has a wait to stop. */
  readonly busy: boolean;
  stopWaiting(): void;
}

/** The typed filter one surface owns: `/` opens it, a letter is text, `Esc` clears it. */
export interface FilterKeys {
  readonly text: string;
  /** The text mode is open: a letter is text here, not a key. */
  readonly typing: boolean;
  start(): void;
  /** A character or a backspace while the mode is open: the text is what the user is typing. */
  edit(change: (text: string) => string): void;
  /** `Esc`: empty the filter — its text and its state filter both — and leave the mode. */
  clear(): void;
  /** `Enter`: keep the text and leave the mode. */
  keep(): void;
}

/** The install form's own state: the three sections and the choices that survive leaving. */
export interface InstallKeys {
  readonly form: InstallForm;
  set(form: InstallForm): void;
}

/** The plan's own state: the row window, the requirement focus and the marks. */
export interface PlanKeys {
  readonly window: RowWindow;
  readonly count: number;
  readonly page: number;
  readonly requirementFocus: number | undefined;
  /** The requirement ids the user marked; the apply passes exactly these to the core. */
  readonly updates: readonly string[];
  /** How many requirements offer an update: with none, `space` and `a` have nothing to mark. */
  readonly markable: number;
  move(delta: number): void;
  pageBy(delta: number): void;
  edge(at: 'first' | 'last'): void;
  rebuild(): void;
  toggleUpdate(): void;
  markAllUpdates(): void;
}

/** The confirm: the plan's keys plus the one that writes. */
export interface ApplyKeys extends PlanKeys {
  runApply(): void;
}

/** The list's own state beyond the window: the carrier toggle, the harnesses it asks about, its filter. */
export interface ListKeys extends SlowRowsKeys {
  /** `f`: keep only the skills the chosen harnesses carry. */
  readonly carriers: boolean;
  /** The harness ids chosen on the install surface: without one, `f` has nothing to ask about. */
  readonly harnessIds: readonly string[];
  toggleCarriers(): void;
  readonly filter: FilterKeys;
}

/** The stale surface's own state beyond the window: the verdict `f` cycles and its filter. */
export interface StaleKeys extends SlowRowsKeys {
  /** The state filter, or `undefined` when every recorded skill is listed. */
  readonly state: StaleValue | undefined;
  cycleState(): void;
  readonly filter: FilterKeys;
}

/** The update surface's own state beyond the window: its slow read and the one write it can approve. */
export interface UpdateKeys extends SlowRowsKeys {
  /** The approved update is in flight: every key that would leave is off until it finishes. */
  readonly applying: boolean;
  /** The write finished, so the surface shows the result rather than the plan. */
  readonly result: boolean;
  /** `y`: run the plan through `applyPlan`, exactly as `agentenv update --yes` does. */
  runApply(): void;
}

/** Each surface's host is its own keys plus the chrome every table may use. */
export type InstallHost = ChromeHost & InstallKeys;
export type PlanHost = ChromeHost & PlanKeys;
export type ApplyHost = ChromeHost & ApplyKeys;
export type RowsHost = ChromeHost & RowsKeys;
export type StatusHost = ChromeHost & SlowRowsKeys;
export type ListHost = ChromeHost & ListKeys;
export type StaleHost = ChromeHost & StaleKeys;

/** The update host also owns where the plan declines to: the shell knows which surface opened it. */
export type UpdateHost = ChromeHost & UpdateKeys & {
  /** `n` and `Esc`: leave the plan without writing, back to the surface it was opened from. */
  decline(): void;
  /** `v` after a finished write: the stale surface again, to see what is true now. */
  staleAgain(): void;
};

/** Every surface's host, named once so a table is handed only the host it owns. */
export interface SurfaceHosts {
  install: InstallHost;
  plan: PlanHost;
  apply: ApplyHost;
  status: StatusHost;
  list: ListHost;
  stale: StaleHost;
  update: UpdateHost;
  remove: ChromeHost;
}

export interface KeyBinding {
  /** Input tokens that dispatch this binding; the first one names it on screen. */
  keys: string[];
  label: string;
  /** Absent from the keybar; the rail and the help overlay still print it, because it is a real key. */
  hidden?: boolean;
  /** Inactive and unlisted while it returns false. */
  when?(): boolean;
  /** Returns the reason it does not act; the key stays listed and pressing it says so. */
  refuses?(): string | undefined;
  run(): void;
}

export type KeyTable = readonly KeyBinding[];

/**
 * The rail letter each surface answers to; `apply` has none, because `Enter` on the plan is its way in.
 * This record is the guardrail: a new `SurfaceId` cannot compile until it has a row here.
 */
const RAIL_LETTERS: Record<SurfaceId, string | undefined> = {
  install: 'i',
  plan: 'p',
  apply: undefined,
  status: 's',
  list: 'l',
  stale: 'v',
  update: 'u',
  remove: 'x',
};

/**
 * Every surface, in the order the tables list them. The rail and the key-table guardrail test both walk
 * this list, so a surface is never added to one and silently left out of the other.
 */
export const SURFACES: SurfaceId[] = Object.keys(RAIL_LETTERS) as SurfaceId[];

/** The seven commands, in the order the rail prints them: the surfaces that have a letter. */
export const RAIL: readonly { key: string; surface: SurfaceId }[] = SURFACES.flatMap((surface) => {
  const key = RAIL_LETTERS[surface];
  return key === undefined ? [] : [{ key, surface }];
});

/**
 * A write is in flight. Every key that would leave the surface — or start a second write — says why it
 * does not, because writes cannot be cancelled and the result is the only honest thing to wait for.
 */
function refusesDuringWrite(host: ChromeHost): () => string | undefined {
  return () => (host.applying ? t.tui.applyRefusal : undefined);
}

/** The rail letters as bindings: the rail prints them in the header, so they are not keybar entries. */
function railBindings(host: ChromeHost): KeyTable {
  return RAIL.map(({ key, surface }) => ({
    keys: [key],
    label: t.tui.surfaces[surface],
    hidden: true,
    refuses: refusesDuringWrite(host),
    run: () => host.go(surface),
  }));
}

/** The overlay is a mode: only closing it and quitting stay live while it is open. */
export function helpKeys(host: ChromeHost): KeyTable {
  return [
    { keys: ['escape'], label: t.tui.keys.close, run: () => host.closeHelp() },
    { keys: ['?'], label: t.tui.keys.close, hidden: true, run: () => host.closeHelp() },
    { keys: ['q'], label: t.tui.keys.quit, refuses: refusesDuringWrite(host), run: () => host.quit() },
  ];
}

/** Keys that work on every surface; `?` and `q` also appear in every keybar. */
export function globalKeys(host: ChromeHost): KeyTable {
  return [
    ...railBindings(host),
    { keys: ['?'], label: t.tui.keys.help, run: () => host.openHelp() },
    {
      keys: ['escape'],
      label: t.tui.keys.back,
      when: () => host.surface !== 'install',
      refuses: refusesDuringWrite(host),
      // The confirm declines back to the plan; a finished write has no plan left to decline to.
      run: () => host.go(host.surface === 'apply' && !host.result ? 'plan' : 'install'),
    },
    { keys: ['q'], label: t.tui.keys.quit, refuses: refusesDuringWrite(host), run: () => host.quit() },
  ];
}

/**
 * The install form: one focused section at a time. `space` and `a` change rows, `Up`/`Down` move the
 * cursor (hidden from the keybar, listed in the overlay), `Enter` goes forward and `Esc` back — and a
 * refused `Enter` says why instead of doing nothing.
 */
export function installKeys(host: InstallHost): KeyTable {
  return [
    {
      keys: ['space'],
      label: t.tui.keys.choose,
      run: () => {
        host.say(undefined);
        host.set(toggleFocused(host.form));
      },
    },
    {
      keys: ['a'],
      label: t.tui.keys.all,
      // The package section is a single choice, so "all" has nothing to mean there.
      when: () => host.form.stage !== 'package',
      run: () => {
        host.say(undefined);
        host.set(toggleSection(host.form));
      },
    },
    { keys: ['up'], label: t.tui.keys.move, hidden: true, run: () => host.set(moveCursor(host.form, -1)) },
    { keys: ['down'], label: t.tui.keys.move, hidden: true, run: () => host.set(moveCursor(host.form, 1)) },
    {
      keys: ['return'],
      label: t.tui.keys.next,
      run: () => {
        const next = advance(host.form);
        if (next.kind === 'refused') {
          host.say(next.message);
          return;
        }
        host.say(undefined);
        if (next.kind === 'plan') host.go('plan');
        else host.set(next.form);
      },
    },
    {
      keys: ['escape'],
      label: t.tui.keys.back,
      when: () => host.form.stage !== 'harnesses',
      run: () => {
        host.say(undefined);
        host.set(stepBack(host.form));
      },
    },
  ];
}

/**
 * The rows keys, shared by the plan and its confirm: the window moves through the entries, and `Down`
 * past the last entry walks the requirement rows, where `space` has something to mark.
 */
function planNavigation(host: PlanHost): KeyTable {
  return [
    { keys: ['up'], label: t.tui.keys.move, hidden: true, when: () => !host.applying, run: () => host.move(-1) },
    { keys: ['down'], label: t.tui.keys.move, hidden: true, when: () => !host.applying, run: () => host.move(1) },
    { keys: ['pageup'], label: t.tui.keys.move, hidden: true, when: () => !host.applying, run: () => host.pageBy(-host.page) },
    { keys: ['pagedown'], label: t.tui.keys.move, hidden: true, when: () => !host.applying, run: () => host.pageBy(host.page) },
    { keys: ['g'], label: t.tui.keys.first, hidden: true, when: () => !host.applying, run: () => host.edge('first') },
    { keys: ['G'], label: t.tui.keys.last, hidden: true, when: () => !host.applying, run: () => host.edge('last') },
  ];
}

/**
 * `space` and `a` act on the focused requirement row. A plan with no markable update has nothing for
 * them to change, so they are not offered at all rather than listed and inert.
 */
function markKeys(host: PlanHost): KeyTable {
  const offered = (): boolean => !host.applying && host.markable > 0;
  return [
    { keys: ['space'], label: t.tui.keys.mark, when: offered, run: () => host.toggleUpdate() },
    { keys: ['a'], label: t.tui.keys.markAll, when: offered, run: () => host.markAllUpdates() },
  ];
}

/**
 * The plan body, read-only: the window moves, requirements are marked and `r` reads the plan again.
 * No key here writes; `Enter` opens the confirm, where `y` is the only writer.
 */
export function planKeys(host: PlanHost): KeyTable {
  return [
    ...planNavigation(host),
    ...markKeys(host),
    { keys: ['return'], label: t.tui.keys.apply, run: () => host.go('apply') },
    {
      keys: ['r'],
      label: t.tui.keys.rebuild,
      run: () => {
        host.say(undefined);
        host.rebuild();
      },
    },
  ];
}

/**
 * The confirm: the plan body plus the one key that writes. `y` hands the core exactly the marks, `n`
 * and `Esc` decline without running anything and keep the selection.
 */
export function applyKeys(host: ApplyHost): KeyTable {
  return [
    { keys: ['y'], label: t.tui.keys.apply, refuses: refusesDuringWrite(host), run: () => host.runApply() },
    ...planNavigation(host),
    ...markKeys(host),
    { keys: ['n'], label: t.tui.keys.decline, refuses: refusesDuringWrite(host), run: () => host.go('plan') },
  ];
}

/**
 * The result: every key here leaves, and each names its own destination. `Enter` exits, `s` opens the
 * follow-up question, `Esc` goes back to the form with the selection, `n` returns to the plan, and `r`
 * reads the plan again after the write so the rows show what is now true.
 */
export function resultKeys(host: ApplyHost): KeyTable {
  return [
    { keys: ['return'], label: t.tui.keys.exit, run: () => host.quit() },
    { keys: ['s'], label: t.tui.surfaces.status, run: () => host.go('status') },
    { keys: ['n'], label: t.tui.surfaces.plan, run: () => host.go('plan') },
    {
      keys: ['r'],
      label: t.tui.keys.rebuild,
      run: () => {
        host.rebuild();
        host.go('plan');
      },
    },
  ];
}

/**
 * A read-only rows surface: the window moves through the rows and `Esc` first spends itself on a
 * running read, so the keybar names the step the press would take.
 */
function rowsNavigation(host: SlowRowsKeys): KeyTable {
  return [
    { keys: ['up'], label: t.tui.keys.move, hidden: true, run: () => host.move(-1) },
    { keys: ['down'], label: t.tui.keys.move, hidden: true, run: () => host.move(1) },
    { keys: ['pageup'], label: t.tui.keys.move, hidden: true, run: () => host.pageBy(-host.page) },
    { keys: ['pagedown'], label: t.tui.keys.move, hidden: true, run: () => host.pageBy(host.page) },
    { keys: ['g'], label: t.tui.keys.first, hidden: true, run: () => host.edge('first') },
    { keys: ['G'], label: t.tui.keys.last, hidden: true, run: () => host.edge('last') },
  ];
}

/** `Esc` while a read runs stops the wait; the copy says the provider may still be working. */
function stopWaitingKey(host: SlowRowsKeys): KeyBinding {
  return { keys: ['escape'], label: t.tui.keys.stopWaiting, when: () => host.busy, run: () => host.stopWaiting() };
}

/** `Esc` with a filter set clears it: one step takes the text and the state filter both. */
function clearFilterKey(filter: FilterKeys, extra: () => boolean): KeyBinding {
  return {
    keys: ['escape'],
    label: t.tui.keys.filterClear,
    when: () => filter.text !== '' || extra(),
    run: () => filter.clear(),
  };
}

/** `r` reads the surface again, and the status line the previous answer wrote goes with it. */
function reloadKey(host: ChromeHost & RowsKeys): KeyBinding {
  return {
    keys: ['r'],
    label: t.tui.keys.refresh,
    run: () => {
      host.say(undefined);
      host.reload();
    },
  };
}

/**
 * The status surface, read-only: the rows window moves and `r` reads the report again. Its read spawns
 * the harness version checks, so it is slow enough to be named, timed and stopped like the other slow
 * reads — one `Esc` rule, four rows surfaces.
 */
export function statusKeys(host: StatusHost): KeyTable {
  return [stopWaitingKey(host), ...rowsNavigation(host), reloadKey(host)];
}

/**
 * The list surface, read-only: `/` narrows as you type, `f` keeps only what the chosen harnesses carry,
 * the window moves, and `r` reads the slow inventory again. `Esc` spends itself on a running read, then
 * on the filter, before it leaves the surface.
 */
export function listKeys(host: ListHost): KeyTable {
  return [
    stopWaitingKey(host),
    clearFilterKey(host.filter, () => host.carriers),
    ...rowsNavigation(host),
    { keys: ['/'], label: host.filter.text === '' ? t.tui.keys.filter : t.tui.keys.edit, run: () => host.filter.start() },
    {
      keys: ['f'],
      label: t.tui.keys.carriers,
      // Nothing chosen on `install` carries nothing: the refusal says which surface to choose on.
      refuses: () => (host.harnessIds.length === 0 ? t.tui.listNoCarriers : undefined),
      run: () => {
        host.say(undefined);
        host.toggleCarriers();
      },
    },
    reloadKey(host),
  ];
}

/**
 * The stale surface, read-only: the verdicts the provider's own check produced, one row each. `f`
 * cycles the state filter, `/` narrows by name, `u` opens the update plan for these skills, and `r`
 * runs the check again. `Esc` spends itself on the wait, then on the filter, then on the surface.
 */
export function staleKeys(host: StaleHost): KeyTable {
  return [
    stopWaitingKey(host),
    clearFilterKey(host.filter, () => host.state !== undefined),
    ...rowsNavigation(host),
    { keys: ['/'], label: host.filter.text === '' ? t.tui.keys.search : t.tui.keys.edit, run: () => host.filter.start() },
    {
      keys: ['f'],
      label: t.tui.keys.filter,
      run: () => {
        host.say(undefined);
        host.cycleState();
      },
    },
    { keys: ['u'], label: t.tui.keys.update, refuses: refusesDuringWrite(host), run: () => host.go('update') },
    reloadKey(host),
  ];
}

/**
 * The update plan, read-only until `y`: the rows the update would install move like any other window,
 * and `y` is the only key here that writes. `n` and `Esc` decline back to where `u` was opened, so
 * declining costs nothing and nothing is installed beside it. `Esc` spends itself on a running check
 * first, exactly as on the other slow rows surfaces.
 */
export function updateKeys(host: UpdateHost): KeyTable {
  return [
    stopWaitingKey(host),
    { keys: ['y'], label: t.tui.keys.apply, refuses: refusesDuringWrite(host), run: () => host.runApply() },
    ...rowsNavigation(host),
    { keys: ['n'], label: t.tui.keys.decline, refuses: refusesDuringWrite(host), run: () => host.decline() },
    { keys: ['escape'], label: t.tui.keys.back, refuses: refusesDuringWrite(host), run: () => host.decline() },
  ];
}

/**
 * The result of an approved update: every key leaves, and `v` goes back to the stale surface for the
 * question the result changes the answer to. `Esc` falls through to the shell's own back.
 */
export function updateResultKeys(host: UpdateHost): KeyTable {
  return [
    { keys: ['return'], label: t.tui.keys.exit, run: () => host.quit() },
    { keys: ['v'], label: t.tui.keys.staleAgain, run: () => host.staleAgain() },
  ];
}

/** The filter's mode: a letter is text here, so the table binds just the two keys that end it. */
export function filterModeKeys(host: FilterKeys): KeyTable {
  return [
    { keys: ['escape'], label: t.tui.keys.filterClear, run: () => host.clear() },
    { keys: ['return'], label: t.tui.keys.filterKeep, run: () => host.keep() },
  ];
}

/** One table per surface: the table decides, and the shell only names the surface. */
const TABLES: Record<SurfaceId, (hosts: SurfaceHosts) => KeyTable> = {
  install: (hosts) => installKeys(hosts.install),
  plan: (hosts) => planKeys(hosts.plan),
  apply: (hosts) => (hosts.apply.result ? resultKeys(hosts.apply) : applyKeys(hosts.apply)),
  status: (hosts) => statusKeys(hosts.status),
  list: (hosts) => listKeys(hosts.list),
  stale: (hosts) => staleKeys(hosts.stale),
  update: (hosts) => (hosts.update.result ? updateResultKeys(hosts.update) : updateKeys(hosts.update)),
  remove: () => [],
};

/** The current surface's own keys, and nothing of any other surface's state. */
export function surfaceKeys(surface: SurfaceId, hosts: SurfaceHosts): KeyTable {
  return TABLES[surface](hosts);
}

/** The typed filter, when the current surface has one: `/` edits that one, never another's. */
const FILTERS: Partial<Record<SurfaceId, (hosts: SurfaceHosts) => FilterKeys>> = {
  list: (hosts) => hosts.list.filter,
  stale: (hosts) => hosts.stale.filter,
};

export function filterOf(surface: SurfaceId, hosts: SurfaceHosts): FilterKeys | undefined {
  return FILTERS[surface]?.(hosts);
}

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

/** The table the current mode dispatches: the overlay's, the filter's, else the surface's, then the global ones. */
export function activeKeys(hosts: SurfaceHosts, chrome: ChromeHost, help: boolean): KeyTable {
  // The overlay is a mode of its own: only closing it and quitting dispatch while it is open.
  if (help) return helpKeys(chrome);
  const typed = filterOf(chrome.surface, hosts);
  if (typed?.typing) return filterModeKeys(typed);
  return [...surfaceKeys(chrome.surface, hosts), ...globalKeys(chrome)];
}

/**
 * One key set per frame, and one entry per key: the overlay prints all of it and the keybar prints the
 * entries that are not `hidden`. The surface's own binding comes first, so a surface names a shared key
 * (`u`, `Esc`) in its own words and the entry shown is the one that dispatches. While the overlay is
 * open its own keys come first, because closing it and quitting are what really dispatch there.
 */
export function frameKeys(hosts: SurfaceHosts, chrome: ChromeHost, help: boolean): KeyBinding[] {
  const table: KeyTable = help
    ? [...helpKeys(chrome), ...surfaceKeys(chrome.surface, hosts), ...railBindings(chrome)]
    : activeKeys(hosts, chrome, false);
  const kept: KeyBinding[] = [];
  for (const binding of table) {
    if (!(binding.when?.() ?? true)) continue;
    // Two bindings for one key are precedence, not two keys: only the first that acts is listed.
    if (binding.keys.some((token) => kept.some((entry) => entry.keys.includes(token)))) continue;
    kept.push(binding);
  }
  return kept;
}

/**
 * The keybar's half of the frame's key set: everything the overlay lists except the `hidden` entries
 * and the ones that would refuse this press — a bar never advertises a key that does nothing.
 */
export function keybarKeys(frame: readonly KeyBinding[]): KeyBinding[] {
  return frame.filter((binding) => !binding.hidden && binding.refuses?.() === undefined);
}

export function findBinding(table: KeyTable, token: string): KeyBinding | undefined {
  return table.find((binding) => binding.keys.includes(token) && (binding.when?.() ?? true));
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
  return RAIL.map(({ key, surface }) => `${keyName({ keys: [key], label: '', run: () => {} })} ${t.tui.surfaces[surface]}`).join(
    t.tui.keybarSeparator,
  );
}
