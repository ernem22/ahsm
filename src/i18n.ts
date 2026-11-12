import { HookConfigError } from './apply/hook-merger.js';
import type { ApplyStatus } from './core/apply.js';
import type { RemoveAction, RemoveResult } from './core/remove.js';
import type { AdapterVia } from './core/plan.js';
import type { HarnessStatus, StatusValue } from './core/status.js';
import type { InventoryScope } from './core/list.js';
import type { StaleValue } from './core/stale.js';
import type { Stage } from './tui/install.js';
import type { SurfaceId } from './tui/keys.js';

/**
 * All user-facing strings live here, in English. Swapping in another locale means adding a second
 * table and picking one at startup — nothing else in the UI should hold literal copy.
 */
export const t = {
  title: 'agentenv',
  target: 'target',
  noHarness: 'no installed harness found',
  packages: 'packages',
  planBuilding: 'building plan…',
  harnesses: 'harnesses',
  /** No install argv for the running platform: reported, never guessed or silently skipped. */
  noInstallCommand: 'no install command for this platform',
  plan: 'PLAN',
  providerMissing: 'no provider for this harness',
  writePrefix: 'write',
  runPrefix: 'run',
  notePrefix: 'note',
  /** What an adapter will do, in words: an adapter entry has no argv to show. */
  adapterVia: (via: AdapterVia) =>
    `skills-api → ${via.source}${via.skill ? ` (${via.skill})` : ''} → ${via.agent}`,
  requirement: 'requirement',
  missing: 'missing',
  blocked: 'blocked',
  actions: (runs: number, skipped: number, blocked: number) =>
    `${runs} action(s), ${skipped} skipped, ${blocked} blocked`,
  applyHint: 'to run it: agentenv apply --yes (add --update <ids|all> to mark too-old prerequisites; default: none)',
  statusEmpty: 'record is empty — nothing installed yet',
  itemsTitle: 'items',
  skillsTitle: 'skills (provider inventory)',
  /** Scope is asked for one level at a time; the row says which one it answers. */
  scopeLabels: { user: 'user' } as Record<InventoryScope, string>,
  listEmpty: 'the provider inventory reports no installed skill',
  listNoHarness: 'no harness reports it',
  listCount: (count: number) => `${count} skill(s) — inventory read only, nothing written`,
  staleTitle: 'skills (provider update check)',
  staleLabels: {
    'up-to-date': 'up-to-date',
    stale: 'stale',
    unknown: 'unknown',
  } as Record<StaleValue, string>,
  staleEmpty: 'the provider lockfile records no installation to compare',
  staleCount: (count: number) => `${count} skill(s) — verification only, nothing was installed`,
  staleNotCovered: 'not covered — no provider offers an update check',
  staleNoLock: 'the provider records no skill lockfile — nothing to compare',
  staleLockUnreadable: (where: string) => `the skill lockfile at ${where} could not be read — nothing was compared`,
  staleNoSource: 'the lockfile records no source for it — nothing to compare',
  staleNoHash: 'the lockfile records no folder hash for it — nothing to compare',
  staleNotComparable: 'the provider cannot check this one automatically — verification unknown',
  staleUnreachable: (source: string) => `${source} could not be reached — verification unknown`,
  staleNotRun: 'the provider update check did not finish — verification unknown',
  staleNewer: 'the source has a newer copy — an installation would replace it',
  staleGone: 'the source no longer offers it — an installation would not restore it',
  updateTitle: 'UPDATE',
  updateHint: 'to run it: agentenv update --yes',
  updateNone: 'no stale skill — nothing to update',
  /** The note an update entry carries: why an install is planned for something already installed. */
  updateStaleCopy: (name: string) => `${name} is stale — the same installation replaces it`,
  updateNoItem: (name: string) => `${name} matches no item in the catalogue — nothing to update`,
  updateNoRecord: (name: string) => `${name} is not recorded for any harness — nothing to update`,
  updateNoTarget: (name: string, harness: string) =>
    `${name} → ${harness}: that harness is not defined here — nothing to update`,
  updateCount: (stale: number, planned: number) => `${stale} stale skill(s) — ${planned} installation(s) planned`,
  harnessLabels: {
    ready: 'ready',
    'too-old': 'too old',
    absent: 'absent',
  } as Record<HarnessStatus, string>,
  minimum: (min: string) => `min ${min}`,
  versionUnknown: 'version unknown',
  harnessUpdate: (command: string[]) => `update: ${command.join(' ')}`,
  hookError: (error: unknown) => (error instanceof HookConfigError ? t.hookTargetUnreadable : String(error)),
  statusLabels: {
    'up-to-date': 'up-to-date',
    missing: 'missing',
    unknown: 'unknown',
  } as Record<StatusValue, string>,
  applyLabels: {
    ok: 'installed',
    already: 'already installed',
    unsupported: 'not covered',
    error: 'error',
  } as Record<ApplyStatus, string>,
  hookAlready: 'hook already installed',
  hookEntry: 'adds hook',
  noPackages: 'no package defined in packages/*.yaml',
  packageNotFound: (id: string) => `package not found: ${id}`,
  unknownItem: (id: string) => `unknown item: ${id}`,
  unknownHarness: (id: string) => `unknown harness: ${id}`,
  unknownRequirement: (id: string) => `unknown requirement: ${id}`,
  requirementFailed: (id: string, message: string) => `requirement ${id}: ${message}`,
  requirementUnmet: (id: string) => `requirement not met: ${id}`,
  updateNotMarked: (id: string) => `the ${id} update was not marked, so it was not run`,
  exitCode: (code: number) => `exit code ${code}`,
  removeTitle: 'remove',
  removeAffects: (harnesses: string[]) => `affects: ${harnesses.join(', ')} (all harnesses — the skill dirs are shared)`,
  removePaths: (paths: string[]) => `paths: ${paths.join(', ')}`,
  removeNotCovered: (kind: string) => `no provider can remove a ${kind} yet`,
  removeNoSkills: (source: string) => `the skills lockfile lists no skill from ${source}`,
  /** A named skill the inventory does not list: the provider's own remove is what has the last word. */
  removeNotInInventory: (name: string) => `the provider inventory does not list ${name} — the provider's own remove has the final word`,
  removeSkillMissing: (name: string) => `${name} is not in the provider inventory — nothing to remove`,
  removeInventoryUnreadable: (reason: string) =>
    `the provider inventory could not be read (${reason}); the skills you named are still planned`,
  removeNoRecord: 'no recorded command for this hook, nothing to delete safely',
  removeHookMissing: (item: string, file: string) => `${item}: the recorded hook was not in ${file}`,
  removePlanLabels: {
    remove: 'will be removed',
    'not-covered': 'not covered',
    manual: 'needs a name — remove by hand',
    error: 'error',
  } as Record<RemoveAction, string>,
  removeLabels: {
    removed: 'removed',
    'not-covered': 'not covered',
    // Says what the user has to do instead of claiming no provider covers the type (GLOSSARY).
    manual: 'needs a name — remove by hand',
    error: 'error',
    absent: 'not installed',
  } as Record<RemoveResult['status'], string>,
  removeHint: 'to run it: agentenv remove --yes',
  stateUnreadable: (where: string) =>
    `state.json at ${where} could not be read; it was left untouched and treated as empty. 'apply' will try to back it up before recording.`,
  stateNotReadable: (where: string) =>
    `state.json at ${where} could not be read (permission or I/O error); it was left untouched and treated as empty`,
  stateBackedUp: (from: string, to: string) =>
    `state.json at ${from} could not be read; a copy was saved to ${to} and the record starts empty`,
  stateFileUnreadable: 'the file could not be read',
  stateNotRecorded: (where: string, reason: string) =>
    `state.json at ${where} could not be backed up or read (${reason}); it was left untouched and this run's installs were not recorded`,
  emptyCommand: 'empty command name',
  hookTargetMissing: 'hook target could not be resolved',
  hookItemIncomplete: (id: string) => `hook ${id} is missing event, matcher or command`,
  hookTargetUnreadable: 'target file is not readable JSONC — nothing was written',
  commandMissing: 'command could not be built',
  skillsApiNoSource: 'this skill item has no source for the skills API',
  installNotVerified: 'the install reported success, but the provider inventory does not show it — nothing was recorded',
  nothingToInstall: 'the provider reported nothing to install, and the provider inventory does not show it',
  definitionMissing: 'definition not found',
  recordedInstalled: 'recorded as installed',
  recordNotInTarget: 'recorded but not found in the target — installing again',
  recordUnverified: 'recorded, but this provider cannot be checked — installing again',
  providerOwns: 'provider owns this',
  /**
   * Chrome the TUI adds that the CLI never prints: surface names, key names, keybar labels, the rail.
   * The domain sentences stay in `render.ts`; nothing here builds a plan, status or inventory line.
   */
  tui: {
    surfaces: {
      install: 'install',
      plan: 'plan',
      status: 'status',
      list: 'list',
      stale: 'stale',
      update: 'update',
      remove: 'remove',
    } as Record<SurfaceId, string>,
    keyNames: {
      escape: 'Esc',
      return: 'Enter',
      space: 'space',
      up: 'Up',
      down: 'Down',
      pageup: 'PgUp',
      pagedown: 'PgDn',
      backspace: 'Backspace',
    } as Record<string, string>,
    keys: {
      help: 'keys',
      quit: 'quit',
      back: 'back',
      close: 'close',
      choose: 'choose',
      all: 'all',
      next: 'next',
      move: 'move',
      rebuild: 'rebuild',
      first: 'first',
      last: 'last',
    },
    helpTitle: (surface: string) => `keys — ${surface}`,
    keybarSeparator: ' · ',
    /** The install surface's three sections, in the order it prints them. */
    sections: { harnesses: 'harnesses', package: 'package', items: 'items' } as Record<Stage, string>,
    chosenOf: (chosen: number, total: number) => `${chosen} of ${total} chosen`,
    packageSummary: (id: string, count: number) => `${id} · ${count} item${count === 1 ? '' : 's'}`,
    /** A harness the detection probe did not find: still listed, still chooseable. */
    notDetected: 'not detected',
    nothingChosenHarness: 'nothing chosen — space to choose a harness',
    nothingChosenItem: 'nothing chosen — space to choose an item',
    sourcePrefix: 'source:',
    urlPrefix: 'url:',
    packagePrefix: 'package:',
    linkPrefix: 'link:',
    /** Between the parts of one row's detail, and in front of an indented detail line. */
    detailSeparator: '    ',
    ellipsis: '…',
  },
  help: [
    'agentenv                              TUI (pick harnesses and a package, review, install)',
    'agentenv plan [--package id]          print the plan only',
    'agentenv apply --yes [--package id]   apply the plan (--update <ids|all> marks too-old prerequisites; default: none)',
    'agentenv status                       show what is installed',
    'agentenv list                         list every skill the provider inventory reports (read-only)',
    'agentenv stale                        mark each installed skill up-to-date / stale / unknown (read-only)',
    'agentenv update [--yes]               install every stale skill again (same install path and record)',
    'agentenv remove [--package id]        remove recorded items (add --skill <name,name> for named skills)',
    '',
    'flags: --package <id> (default: the package marked default) · --harness <id,id>',
    '       --update <ids|all|none> marks too-old prerequisite updates (default: none — they stay blocked)',
  ],
};
