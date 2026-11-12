import type { ApplyOutcome } from '../core/apply.js';
import type { Plan } from '../core/plan.js';

/** What the plan says the apply will attempt, counted from the plan and nothing else. */
export interface ApplyShape {
  /** Entries whose action is `run` and whose requirements are met: the installs that will happen. */
  installs: number;
  /** Of those, the ones that write a hook into a config file. */
  hooks: number;
  /** Entries a requirement keeps from running; apply reports them, it does not attempt them. */
  blocked: number;
}

export function applyShape(plan: Plan): ApplyShape {
  const runnable = plan.entries.filter((entry) => entry.action === 'run' && entry.blockedBy === undefined);
  return {
    installs: runnable.length,
    hooks: runnable.filter((entry) => entry.hook !== undefined).length,
    blocked: plan.entries.filter((entry) => entry.blockedBy !== undefined).length,
  };
}

/**
 * The write, as the surface shows it: nothing yet, in flight with the second it started and the line
 * counting the work, or finished with the outcome the core reported. Writes are not cancellable, so
 * there is no `stopped` state here — only the result. The shape is the surface's own i18n sentence, so
 * the install confirm and the removal plan count different work with the same state.
 */
export type WriteState<Outcome = ApplyOutcome> =
  | { status: 'idle' }
  | { status: 'applying'; startedAt: number; shape: string }
  | { status: 'done'; outcome: Outcome }
  | { status: 'error'; message: string };

export function isApplying<Outcome>(write: WriteState<Outcome>): boolean {
  return write.status === 'applying';
}

/** A finished write has something to answer for; the keys that leave differ there, so this is its own name. */
export function hasResult<Outcome>(write: WriteState<Outcome>): boolean {
  return write.status === 'done' || write.status === 'error';
}
