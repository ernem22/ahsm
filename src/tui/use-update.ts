import { useEffect, useState } from 'react';
import { applyPlan } from '../core/apply.js';
import { buildUpdatePlan, type UpdatePlan } from '../core/update.js';
import type { Ctx } from '../context.js';
import { t } from '../i18n.js';
import type { Tone } from '../render.js';
import type { Data } from '../types.js';
import { applyShape, type ApplyShape, type WriteState } from './apply.js';
import type { UpdateKeys } from './keys.js';
import { useRead, type ReadState } from './read.js';
import { updatePage } from './update.js';
import { useWrite } from './use-write.js';
import { emptyWindow, goTo, moveBy, type RowWindow } from './window.js';

/** Everything the update surface owns: the plan read, its window, and the one write it can approve. */
export interface UpdateState {
  read: ReadState<UpdatePlan>;
  value: UpdatePlan | undefined;
  window: RowWindow;
  write: WriteState;
  /** Entering the surface starts its write from nothing, so an old result is never shown as this plan's. */
  reset(): void;
  keys: UpdateKeys;
}

export interface UpdateOptions {
  data: Data;
  ctx: Ctx;
  width: number;
  height: number;
  active: boolean;
  /** The in-flight refusal is the one line the shell owns, so the write states it there. */
  say(message: string | undefined, tone?: Tone): void;
}

/**
 * `u` as a surface: the plan the update would install, the window over its per-skill rows, and `y`
 * running exactly that plan through the core. The read is the provider's update check, so it is slow
 * and stoppable; the write is not cancellable and its refusal is the shared one.
 */
export function useUpdateSurface({ data, ctx, width, height, active, say }: UpdateOptions): UpdateState {
  const read = useRead(() => buildUpdatePlan(data, ctx));
  const [window, setWindow] = useState<RowWindow>(emptyWindow);
  const update = read.state.value;

  useEffect(() => {
    if (active) read.load();
  }, [active, read.load]);

  const shape: ApplyShape = update ? applyShape(update.plan) : { installs: 0, hooks: 0, blocked: 0 };
  const write = useWrite({
    say,
    run: update ? () => applyPlan(data, ctx, update.plan) : undefined,
    shape: t.tui.applyShape(shape.installs, shape.hooks, shape.blocked),
  });

  const rows = update?.plan.entries.length ?? 0;

  return {
    read: read.state,
    value: update,
    window,
    write: write.state,
    reset: write.reset,
    keys: {
      page: updatePage(update, width, height, window),
      move: (delta) => setWindow((at) => moveBy(at, rows, delta)),
      pageBy: (delta) => setWindow((at) => moveBy(at, rows, delta)),
      edge: (at) => setWindow(goTo(at === 'first' ? 0 : rows - 1, rows)),
      reload: read.load,
      busy: read.state.status === 'busy',
      stopWaiting: read.stop,
      applying: write.applying,
      result: write.result,
      runApply: write.write,
    },
  };
}
