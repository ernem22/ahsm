import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { buildPlan } from '../core/plan.js';
import { applyPlan } from '../core/apply.js';
import { readSkillInventory } from '../core/list.js';
import { readStatus } from '../core/status.js';
import type { Ctx } from '../context.js';
import { t } from '../i18n.js';
import { toneColor, type Tone } from '../render.js';
import type { Data } from '../types.js';
import { applyShape, hasResult, isApplying, type WriteState } from './apply.js';
import { ApplyBody } from './apply-body.js';
import { wrap } from './format.js';
import { HelpOverlay } from './help.js';
import { initialForm } from './install.js';
import {
  activeKeys,
  findBinding,
  frameKeys,
  helpKeys,
  keybarKeys,
  keybarText,
  railText,
  tokenOf,
  type KeyHost,
  type SurfaceId,
} from './keys.js';
import { planPage } from './plan-body.js';
import { listBody, listPage, type ListFilter } from './list.js';
import { allUpdates, focusedRequirement, markableUpdates, planSelection, toggleUpdate } from './plan.js';
import { useRead } from './read.js';
import { statusBody, statusPage } from './status.js';
import { SurfaceBody } from './surfaces.js';
import { emptyWindow, goTo, moveBy } from './window.js';

/** The rail needs 100 columns; below it the letters still work, so width never changes what is reachable. */
export const RAIL_MIN_WIDTH = 100;

/** One line of the status strip: what happened, in the tone that says how much it matters. */
export interface StatusLine {
  text: string;
  tone: Tone;
}

/** The status line wraps like any other text, so a long refusal cannot push the keybar off the frame. */
export function statusLines(status: StatusLine | undefined, width: number): string[] {
  return status === undefined ? [] : wrap(status.text, width);
}

/** Header (two lines), the status strip when there is one, and the keybar: what the body may use. */
export function bodyHeight(rows: number, status: StatusLine | undefined, width: number): number {
  return Math.max(1, rows - 3 - statusLines(status, width).length);
}

export interface ShellProps {
  data: Data;
  ctx: Ctx;
}

/** The window: a header naming the surface and the target, a body, a status line, the keybar last. */
export function Shell({ data, ctx }: ShellProps): React.ReactElement {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [surface, setSurface] = useState<SurfaceId>('install');
  const [help, setHelp] = useState(false);
  const [status, setStatus] = useState<StatusLine | undefined>();
  // The form lives here, not in the install component: leaving the surface keeps every choice.
  const [install, setInstall] = useState(() => initialForm(data, ctx));
  const [planWindow, setPlanWindow] = useState(emptyWindow);
  const [statusWindow, setStatusWindow] = useState(emptyWindow);
  const [listWindow, setListWindow] = useState(emptyWindow);
  // The filter is the only text mode here besides the remove name: `/` opens it, `Esc` empties it.
  const [filtering, setFiltering] = useState(false);
  const [listFilter, setListFilter] = useState<Omit<ListFilter, 'harnessIds'>>({ text: '', carriers: false });
  // `Down` past the last entry walks the requirement rows; `space` marks the one under that focus.
  const [requirementFocus, setRequirementFocus] = useState<number | undefined>();
  // The requirement ids the user marked; a rebuild keeps them until they no longer exist.
  const [updates, setUpdates] = useState<string[]>([]);
  const [write, setWrite] = useState<WriteState>({ status: 'idle' });
  // The plan asks the core the same question `agentenv plan` does, for the selection on screen.
  const plan = useRead(() => buildPlan(data, ctx, planSelection(install)));
  // `status` asks the core the same question `agentenv status` does, and writes nothing to answer it.
  const statusRead = useRead(() => readStatus(data, ctx));
  // `list` reads the provider's own inventory: the slow read, exactly as `agentenv list` does.
  const listRead = useRead(() => readSkillInventory(data, ctx));

  const applying = isApplying(write);
  const result = hasResult(write);
  const entryCount = plan.state.value?.entries.length ?? 0;
  const reportBody = statusBody(statusRead.state.value);
  const statusRows = reportBody.focusable.length;
  // One inventory, filtered once: the shell needs the row count to clamp the window it hands the keys.
  const inventory = listBody(listRead.state.value, { ...listFilter, harnessIds: install.harnessIds });
  const listFilterNow: ListFilter = { ...listFilter, harnessIds: install.harnessIds };
  const requirementCount = plan.state.value?.requirements.length ?? 0;
  const focus = requirementFocus !== undefined && requirementFocus < requirementCount ? requirementFocus : undefined;

  const say = (message: string | undefined, tone: Tone = 'dim'): void => {
    setStatus(message === undefined ? undefined : { text: message, tone });
  };

  /** The focused requirement, when the focus is on one that offers a markable update. */
  const toggleMark = (): void => {
    const value = plan.state.value;
    if (!value) return;
    const id = focusedRequirement(value, focus);
    if (id) setUpdates((marked) => toggleUpdate(marked, id));
  };

  /** `Down`/`Up` cross from the last entry into the requirement rows and back. */
  const movePlan = (delta: number): void => {
    let window = planWindow;
    let at = focus;
    if (delta > 0) {
      if (at === undefined) {
        if (window.index < entryCount - 1) window = moveBy(window, entryCount, 1);
        else if (requirementCount > 0) at = 0;
      } else if (at < requirementCount - 1) at += 1;
    } else if (at === undefined) {
      if (entryCount > 0) window = moveBy(window, entryCount, -1);
    } else if (at > 0) {
      at -= 1;
    } else {
      at = undefined;
      window = goTo(entryCount - 1, entryCount);
    }
    setPlanWindow(window);
    setRequirementFocus(at);
  };

  /** A page moves the entry window and leaves the requirement rows to `Down`. */
  const pagePlan = (delta: number): void => {
    setRequirementFocus(undefined);
    setPlanWindow(moveBy(planWindow, entryCount, delta));
  };

  const resetPlan = (at: 'first' | 'last'): void => {
    setRequirementFocus(undefined);
    setPlanWindow(goTo(at === 'first' ? 0 : entryCount - 1, entryCount));
  };

  const markAll = (): void => {
    const value = plan.state.value;
    if (!value) return;
    setUpdates((marked) => allUpdates(value, marked));
  };

  /** `y`: the core gets exactly the marks, and no options at all when nothing is marked. */
  const runApply = (): void => {
    const value = plan.state.value;
    if (!value || write.status === 'applying') return;
    const marked = updates.filter((id) => markableUpdates(value).includes(id));
    setWrite({ status: 'applying', startedAt: Date.now(), shape: applyShape(value) });
    // Writes cannot be cancelled, so the refusal is on screen for as long as it is true.
    say(t.tui.applyRefusal, 'warning');
    void applyPlan(data, ctx, value, marked.length > 0 ? { updates: marked } : undefined).then(
      (outcome) => {
        setWrite({ status: 'done', outcome });
        setStatus(undefined);
      },
      (error: unknown) => {
        setWrite({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        setStatus(undefined);
      },
    );
  };

  // Entering a surface reads it; `r` is the same call, so a second look costs one key.
  useEffect(() => {
    if (surface === 'plan') plan.load();
  }, [surface, plan.load]);
  useEffect(() => {
    if (surface === 'status') statusRead.load();
  }, [surface, statusRead.load]);
  useEffect(() => {
    if (surface === 'list') listRead.load();
  }, [surface, listRead.load]);

  const host: KeyHost = {
    surface,
    help,
    install,
    plan: planWindow,
    planCount: entryCount,
    page: planPage(plan.state.value, columns, bodyHeight(rows, status, columns), planWindow),
    requirementFocus: focus,
    requirementCount,
    go: setSurface,
    openHelp: () => setHelp(true),
    closeHelp: () => setHelp(false),
    quit: () => exit(),
    say,
    setInstall,
    movePlan,
    pagePlan,
    resetPlan,
    rebuildPlan: plan.load,
    status: {
      page: statusPage(reportBody, columns, bodyHeight(rows, status, columns), statusWindow.index),
      move: (delta) => setStatusWindow((window) => moveBy(window, statusRows, delta)),
      pageBy: (delta) => setStatusWindow((window) => moveBy(window, statusRows, delta)),
      edge: (at) => setStatusWindow(goTo(at === 'first' ? 0 : statusRows - 1, statusRows)),
      reload: statusRead.load,
    },
    filter: surface === 'list' && filtering,
    list: {
      page: listPage(inventory, listFilterNow, columns, bodyHeight(rows, status, columns), listWindow),
      filterText: listFilter.text,
      carriers: listFilter.carriers,
      busy: listRead.state.status === 'busy',
      move: (delta) => setListWindow((window) => moveBy(window, inventory.blocks.length, delta)),
      pageBy: (delta) => setListWindow((window) => moveBy(window, inventory.blocks.length, delta)),
      edge: (at) => setListWindow(goTo(at === 'first' ? 0 : inventory.blocks.length - 1, inventory.blocks.length)),
      reload: listRead.load,
      startFilter: () => setFiltering(true),
      clearFilter: () => {
        setFiltering(false);
        setListFilter((filter) => ({ ...filter, text: '' }));
      },
      keepFilter: () => setFiltering(false),
      toggleCarriers: () => setListFilter((filter) => ({ ...filter, carriers: !filter.carriers })),
      stopWaiting: listRead.stop,
    },
    updates,
    applying,
    result,
    toggleUpdate: toggleMark,
    markAllUpdates: markAll,
    runApply,
  };

  useInput((input, key) => {
    const token = tokenOf(input, key);
    const binding = findBinding(activeKeys(surface, help, host), host, token);
    if (!binding) {
      // The filter is a text mode: anything the table did not claim is a character it collects.
      if (!host.filter) return;
      if (token === 'backspace') setListFilter((filter) => ({ ...filter, text: filter.text.slice(0, -1) }));
      else if (input.length === 1 && !key.ctrl && !key.meta) setListFilter((filter) => ({ ...filter, text: filter.text + input }));
      return;
    }
    const refusal = binding.refuses?.(host);
    if (refusal !== undefined) {
      say(refusal, 'warning');
      return;
    }
    binding.run(host);
  });

  // The target is what the user chose, not what detection found: a not detected harness is a choice.
  const labels = install.harnesses.filter((row) => install.harnessIds.includes(row.id)).map((row) => row.label);
  const target = labels.length > 0 ? labels.join(', ') : t.noHarness;

  const surfaceLabel = t.tui.surfaces[surface];
  const rail = railText(columns, RAIL_MIN_WIDTH);
  // One key set for the frame: the overlay prints all of it, the keybar the entries it does not hide.
  // While the overlay is open the live keys are the overlay's own, so the keybar never lists a dead key.
  const live = frameKeys(surface, false, host);
  const keys = help ? frameKeys(surface, true, host) : live;
  const listed = keybarKeys(help ? [...helpKeys] : live, host);

  return (
    <Box flexDirection="column" height={rows}>
      <Box justifyContent="space-between">
        <Text bold>{`${t.title}  ${surfaceLabel}`}</Text>
        {rail ? <Text dimColor>{rail}</Text> : null}
      </Box>
      <Text dimColor>{`${t.target}: ${target}`}</Text>
      <Box flexDirection="column" flexGrow={1}>
        {help ? (
          <HelpOverlay title={t.tui.helpTitle(surfaceLabel)} keys={keys} />
        ) : surface === 'apply' && write.status !== 'idle' ? (
          <ApplyBody write={write} width={columns} height={bodyHeight(rows, status, columns)} />
        ) : (
          <SurfaceBody
            surface={surface}
            data={data}
            install={install}
            width={columns}
            height={bodyHeight(rows, status, columns)}
            plan={plan.state}
            planWindow={planWindow}
            status={statusRead.state}
            statusWindow={statusWindow}
            list={listRead.state}
            listBody={inventory}
            listFilter={listFilterNow}
            listWindow={listWindow}
            marked={updates}
            requirementFocus={focus}
            write={write}
          />
        )}
      </Box>
      {status
        ? statusLines(status, columns).map((line, at) => (
            <Text key={at} color={toneColor(status.tone)} dimColor={status.tone === 'dim'}>
              {line}
            </Text>
          ))
        : null}
      <Text dimColor>{keybarText(listed, columns)}</Text>
    </Box>
  );
}
