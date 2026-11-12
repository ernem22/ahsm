import { useCallback, useRef, useState } from 'react';

export type ReadStatus = 'idle' | 'busy' | 'done' | 'error';

/**
 * What a read is doing right now: nothing yet, waiting, finished with a value, or failed with the
 * message to print. A surface prints one line per state, so a slow read is named instead of silent.
 */
export interface ReadState<Value> {
  status: ReadStatus;
  value?: Value;
  message?: string;
}

export interface Read<Value> {
  state: ReadState<Value>;
  /** Runs the read again — the surface's `r` key and its first render both call this. */
  load(): void;
}

/**
 * One read hook for every surface that has to ask the core something. Reads are read-only by
 * contract, so running one again costs nothing but time, and only the newest run may report: a
 * rebuild that overtakes an older read discards the stale answer.
 */
export function useRead<Value>(read: () => Promise<Value>): Read<Value> {
  const [state, setState] = useState<ReadState<Value>>({ status: 'idle' });
  const latest = useRef(read);
  latest.current = read;
  const runs = useRef(0);

  const load = useCallback(() => {
    runs.current += 1;
    const token = runs.current;
    setState({ status: 'busy' });
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

  return { state, load };
}
