import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { buildPlan } from '../core/plan.js';
import { applyPlan } from '../core/apply.js';
import type { Ctx } from '../context.js';
import { t } from '../i18n.js';
import type { Data } from '../types.js';
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
import { allUpdates, focusedRequirement, markableUpdates, planSelection, toggleUpdate } from './plan.js';
import { useRead } from './read.js';
import { SurfaceBody } from './surfaces.js';
import { emptyWindow, goTo, moveBy } from './window.js';

/** The rail needs 100 columns; below it the letters still work, so width never changes what is reachable. */
export const RAIL_MIN_WIDTH = 100;

/** Header (two lines), status line when there is one, and the keybar: what the body may use. */
export function bodyHeight(rows: number, status: string | undefined): number {
  return Math.max(1, rows - 3 - (status === undefined ? 0 : 1));
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
  const [status, setStatus] = useState<string | undefined>();
  // The form lives here, not in the install component: leaving the surface keeps every choice.
  const [install, setInstall] = useState(() => initialForm(data, ctx));
  const [planWindow, setPlanWindow] = useState(emptyWindow);
  // `Down` past the last entry walks the requirement rows; `space` marks the one under that focus.
  const [requirementFocus, setRequirementFocus] = useState<number | undefined>();
  // The requirement ids the user marked; a rebuild keeps them until they no longer exist.
  const [updates, setUpdates] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  // The plan asks the core the same question `agentenv plan` does, for the selection on screen.
  const plan = useRead(() => buildPlan(data, ctx, planSelection(install)));

  const entryCount = plan.state.value?.entries.length ?? 0;
  const requirementCount = plan.state.value?.requirements.length ?? 0;
  const focus = requirementFocus !== undefined && requirementFocus < requirementCount ? requirementFocus : undefined;

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
    if (!value || applying) return;
    const marked = updates.filter((id) => markableUpdates(value).includes(id));
    setApplying(true);
    void applyPlan(data, ctx, value, marked.length > 0 ? { updates: marked } : undefined).finally(() =>
      setApplying(false),
    );
  };

  // Entering the plan reads it; `r` is the same call, so a second look costs one key.
  useEffect(() => {
    if (surface === 'plan') plan.load();
  }, [surface, plan.load]);

  const host: KeyHost = {
    surface,
    help,
    install,
    plan: planWindow,
    planCount: entryCount,
    page: planPage(plan.state.value, columns, bodyHeight(rows, status), planWindow),
    requirementFocus: focus,
    requirementCount,
    go: setSurface,
    openHelp: () => setHelp(true),
    closeHelp: () => setHelp(false),
    quit: () => exit(),
    say: setStatus,
    setInstall,
    movePlan,
    pagePlan,
    resetPlan,
    rebuildPlan: plan.load,
    updates,
    applying,
    toggleUpdate: toggleMark,
    markAllUpdates: markAll,
    runApply,
  };

  useInput((input, key) => {
    findBinding(activeKeys(surface, help), host, tokenOf(input, key))?.run(host);
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
  const listed = keybarKeys(help ? [...helpKeys] : live);

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
        ) : (
          <SurfaceBody
            surface={surface}
            data={data}
            install={install}
            width={columns}
            height={bodyHeight(rows, status)}
            plan={plan.state}
            planWindow={planWindow}
            marked={updates}
            requirementFocus={focus}
          />
        )}
      </Box>
      {status ? <Text dimColor>{status}</Text> : null}
      <Text dimColor>{keybarText(listed, columns)}</Text>
    </Box>
  );
}
