import { applyPlan } from '../core/apply.js';
import type { Plan } from '../core/plan.js';
import type { Ctx } from '../context.js';
import { t } from '../i18n.js';
import type { Tone } from '../render.js';
import type { Data } from '../types.js';
import { applyShape, type ApplyShape, type WriteState } from './apply.js';
import { markableUpdates } from './plan.js';
import { useWrite } from './use-write.js';

/** The write, as the apply surface shows it: nothing yet, in flight, or the result the core reported. */
export interface ApplyState {
  state: WriteState;
  /** A write is in flight: its keys are off until it finishes. */
  applying: boolean;
  /** The write finished, so this surface shows the result rather than the plan. */
  result: boolean;
  runApply(): void;
  /** Back to nothing: entering the confirm and rebuilding the plan both start from here. */
  reset(): void;
}

export interface ApplyOptions {
  data: Data;
  ctx: Ctx;
  /** The plan the confirm shows and the write runs; `undefined` until the plan has been read. */
  plan: Plan | undefined;
  /** The requirement ids the user marked; the core receives exactly these. */
  updates: readonly string[];
  /** The in-flight refusal is the one line the shell owns, so the write states it there. */
  say(message: string | undefined, tone?: Tone): void;
}

/**
 * The apply surface's own state. `y` runs the plan through the core and nothing else happens until it
 * answers: writes are not cancellable, so there is no stopped state and no second run while one is in
 * flight. `reset` starts the surface from nothing, so a result of another plan is never shown as this
 * one's answer.
 */
export function useApplySurface({ data, ctx, plan, updates, say }: ApplyOptions): ApplyState {
  const shape: ApplyShape = plan ? applyShape(plan) : { installs: 0, hooks: 0, blocked: 0 };
  const write = useWrite({
    say,
    run: plan
      ? () => {
          const marked = updates.filter((id) => markableUpdates(plan).includes(id));
          return applyPlan(data, ctx, plan, marked.length > 0 ? { updates: marked } : undefined);
        }
      : undefined,
    shape: t.tui.applyShape(shape.installs, shape.hooks, shape.blocked),
  });

  return { state: write.state, applying: write.applying, result: write.result, runApply: write.write, reset: write.reset };
}
