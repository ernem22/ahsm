import { useEffect, useState } from 'react';
import { readStaleSkills, type StaleReport, type StaleValue } from '../core/stale.js';
import type { Ctx } from '../context.js';
import type { Data } from '../types.js';
import type { StaleKeys } from './keys.js';
import { useRead, type ReadState } from './read.js';
import { nextState, staleBody, stalePage, type StaleBody, type StaleFilter } from './stale.js';
import { emptyWindow, goTo, moveBy, type RowWindow } from './window.js';

/** Everything the stale surface owns: the check's answer, the two filters, and the window. */
export interface StaleState {
  read: ReadState<StaleReport>;
  body: StaleBody;
  filter: StaleFilter;
  window: RowWindow;
  keys: StaleKeys;
}

export interface StaleOptions {
  data: Data;
  ctx: Ctx;
  width: number;
  height: number;
  active: boolean;
}

/**
 * `stale` as a surface: the provider's own update check, the verdict filter `f` cycles, the name filter
 * `/` types and the window over the rows they keep. The check is the slow read, so it is named, timed
 * and stoppable; no key here writes anything.
 */
export function useStaleSurface({ data, ctx, width, height, active }: StaleOptions): StaleState {
  // `stale` runs the provider's own update check: slow like the inventory, and just as read-only.
  const read = useRead(() => readStaleSkills(data, ctx));
  const [window, setWindow] = useState<RowWindow>(emptyWindow);
  const [text, setText] = useState('');
  const [state, setState] = useState<StaleValue | undefined>();
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (active) read.load();
  }, [active, read.load]);

  const filter: StaleFilter = { text, state };
  // One report, filtered once: the keys move a window over rows that exist.
  const body = staleBody(read.state.value, filter);
  const rows = body.blocks.length;

  return {
    read: read.state,
    body,
    filter,
    window,
    keys: {
      page: stalePage(body, filter, width, height, window),
      move: (delta) => setWindow((at) => moveBy(at, rows, delta)),
      pageBy: (delta) => setWindow((at) => moveBy(at, rows, delta)),
      edge: (at) => setWindow(goTo(at === 'first' ? 0 : rows - 1, rows)),
      reload: read.load,
      busy: read.state.status === 'busy',
      stopWaiting: read.stop,
      state,
      cycleState: () => setState((current) => nextState(current)),
      filter: {
        text,
        typing,
        start: () => setTyping(true),
        edit: (change) => setText((current) => change(current)),
        // One step takes the name and the state filter both, so `Esc` never asks twice.
        clear: () => {
          setText('');
          setState(undefined);
          setTyping(false);
        },
        keep: () => setTyping(false),
      },
    },
  };
}
