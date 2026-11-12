import { useCallback, useRef, useState } from 'react';

export type ReadStatus = 'idle' | 'busy' | 'done' | 'error' | 'stopped';

/**
 * What a read is doing right now: nothing yet, waiting, finished with a value, failed with the message
 * to print, or stopped waiting at the user's request. A surface prints one line per state, so a slow
 * read is named instead of silent, and `startedAt` lets it count real seconds.
 */
export interface ReadState<Value> {
  status: ReadStatus;
  value?: Value;
  message?: string;
  /** When the current run started; only a busy read has one. */
  startedAt?: number;
}

export interface Read<Value> {
  state: ReadState<Value>;
  /** Runs the read again — the surface's `r` key and its first render both call this. */
  load(): void;
  /** Stops waiting: the result is discarded when it arrives, because nothing here can kill a child. */
  stop(): void;
}

/**
 * One read hook for every surface that has to ask the core something. Reads are read-only by
 * contract, so running one again costs nothing but time, and only the newest run may report: a
 * rebuild that overtakes an older read discards the stale answer. Stopping is the same rule with a
 * different ending — the run that was stopped can never write a value.
 */
export function useRead<Value>(read: () => Promise<Value>): Read<Value> {
  const [state, setState] = useState<ReadState<Value>>({ status: 'idle' });
  const latest = useRef(read);
  latest.current = read;
  const runs = useRef(0);

  const load = useCallback(() => {
    runs.current += 1;
    const token = runs.current;
    // A second read keeps the count it already knew, so the busy line can name it.
    setState((previous) => ({
      status: 'busy',
      startedAt: Date.now(),
      ...(previous.value === undefined ? {} : { value: previous.value }),
    }));
    latest.current().then(
      (value) => {
        if (runs.current === token) setState({ status: 'done', value });
      },
      (error: unknown) => {
        if (runs.current === token) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      },
    );
  }, []);

  const stop = useCallback(() => {
    runs.current += 1;
    setState({ status: 'stopped' });
  }, []);

  return { state, load, stop };
}
