import { useCallback, useRef, useState } from 'react';
import type { ApplyOutcome } from '../core/apply.js';
import { t } from '../i18n.js';
import type { Tone } from '../render.js';
import { hasResult, isApplying, type ApplyShape, type WriteState } from './apply.js';

/** What the approved key runs, and the shape of the work it is about to attempt. */
export interface WriteOptions {
  /** The in-flight refusal is the one line the shell owns, so the write states it there. */
  say(message: string | undefined, tone?: Tone): void;
  /** The core call `y` makes; `undefined` until the surface has something to run. */
  run?: () => Promise<ApplyOutcome>;
  /** How many installs, hook writes and blocked entries the plan holds, counted from the plan. */
  shape: ApplyShape;
}

/** The write as a surface shows it: nothing yet, in flight, or the result the core reported. */
export interface Write {
  state: WriteState;
  /** A write is in flight: its keys are off until it finishes. */
  applying: boolean;
  /** The write finished, so this surface shows the result rather than the plan. */
  result: boolean;
  /** `y`: run the core once. Writes are not cancellable, so a second press is not offered. */
  write(): void;
  /** Back to nothing: entering the confirm and rebuilding the plan both start from here. */
  reset(): void;
}

/**
 * The write half every approving surface shares. The apply confirm and the update plan differ only in
 * the core call they hand this hook and the shape they count from their plan; the in-flight refusal,
 * the result and the reset are worded and sequenced here once.
 */
export function useWrite({ say, run, shape }: WriteOptions): Write {
  const [state, setState] = useState<WriteState>({ status: 'idle' });
  // The key handler runs one render behind: the latest answers are read at press time, never captured stale.
  const latest = useRef({ run, shape });
  latest.current = { run, shape };
  const reset = useCallback(() => setState({ status: 'idle' }), []);

  const write = (): void => {
    const current = latest.current;
    if (!current.run || state.status === 'applying') return;
    setState({ status: 'applying', startedAt: Date.now(), shape: current.shape });
    // Writes cannot be cancelled, so the refusal is on screen for as long as it is true.
    say(t.tui.applyRefusal, 'warning');
    void current.run().then(
      (outcome) => {
        setState({ status: 'done', outcome });
        say(undefined);
      },
      (error: unknown) => {
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        say(undefined);
      },
    );
  };

  return { state, applying: isApplying(state), result: hasResult(state), write, reset };
}
