import { useEffect, useState } from 'react';
import { buildPlan, type Plan } from '../core/plan.js';
import type { Ctx } from '../context.js';
import type { Data, Selection } from '../types.js';
import type { PlanKeys } from './keys.js';
import { allUpdates, focusedRequirement, markableUpdates, toggleUpdate } from './plan.js';
import { planPage } from './plan-body.js';
import { useRead, type ReadState } from './read.js';
import { emptyWindow, goTo, moveBy, type RowWindow } from './window.js';

/** Everything the plan surface owns: its read, its window, the requirement focus and the marks. */
export interface PlanState {
  read: ReadState<Plan>;
  value: Plan | undefined;
  window: RowWindow;
  requirementFocus: number | undefined;
  updates: readonly string[];
  keys: PlanKeys;
}

export interface PlanOptions {
  data: Data;
  ctx: Ctx;
  /** What the install form asks the core for; the plan is rebuilt from it, never from the screen. */
  selection: Selection;
  width: number;
  height: number;
  /** The surface is in front of the user, so its read runs. */
  active: boolean;
}

/**
 * The plan as a surface: the read the shell triggers, the row window, the focus that walks down into the
 * requirement rows, and the ids the user marked for the next apply. Nothing here writes.
 */
export function usePlanSurface({ data, ctx, selection, width, height, active }: PlanOptions): PlanState {
  // The plan asks the core the same question `agentenv plan` does, for the selection on screen.
  const read = useRead(() => buildPlan(data, ctx, selection));
  const [window, setWindow] = useState<RowWindow>(emptyWindow);
  // `Down` past the last entry walks the requirement rows; `space` marks the one under that focus.
  const [focus, setFocus] = useState<number | undefined>();
  // The requirement ids the user marked; a rebuild keeps them until they no longer exist.
  const [updates, setUpdates] = useState<string[]>([]);

  const value = read.state.value;
  const count = value?.entries.length ?? 0;
  const requirementCount = value?.requirements.length ?? 0;
  // A rebuilt plan can be shorter than the one that set the focus: a focus past its end is no focus.
  const requirementFocus = focus !== undefined && focus < requirementCount ? focus : undefined;

  // Entering the surface reads it; `r` is the same call, so a second look costs one key.
  useEffect(() => {
    if (active) read.load();
  }, [active, read.load]);

  /** `Down`/`Up` cross from the last entry into the requirement rows and back. */
  const move = (delta: number): void => {
    let next = window;
    let at = requirementFocus;
    if (delta > 0) {
      if (at === undefined) {
        if (next.index < count - 1) next = moveBy(next, count, 1);
        else if (requirementCount > 0) at = 0;
      } else if (at < requirementCount - 1) at += 1;
    } else if (at === undefined) {
      if (count > 0) next = moveBy(next, count, -1);
    } else if (at > 0) {
      at -= 1;
    } else {
      at = undefined;
      next = goTo(count - 1, count);
    }
    setWindow(next);
    setFocus(at);
  };

  /** A page moves the entry window and leaves the requirement rows to `Down`. */
  const pageBy = (delta: number): void => {
    setFocus(undefined);
    setWindow(moveBy(window, count, delta));
  };

  const edge = (at: 'first' | 'last'): void => {
    setFocus(undefined);
    setWindow(goTo(at === 'first' ? 0 : count - 1, count));
  };

  /** The focused requirement, when the focus is on one that offers a markable update. */
  const toggleMark = (): void => {
    if (!value) return;
    const id = focusedRequirement(value, requirementFocus);
    if (id) setUpdates((marked) => toggleUpdate(marked, id));
  };

  const markAll = (): void => {
    if (!value) return;
    setUpdates((marked) => allUpdates(value, marked));
  };

  return {
    read: read.state,
    value,
    window,
    requirementFocus,
    updates,
    keys: {
      window,
      count,
      page: planPage(value, width, height, window),
      requirementFocus,
      updates,
      markable: value ? markableUpdates(value).length : 0,
      move,
      pageBy,
      edge,
      rebuild: read.load,
      toggleUpdate: toggleMark,
      markAllUpdates: markAll,
    },
  };
}
