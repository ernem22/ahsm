import { useEffect, useState } from 'react';
import { readStatus, type StatusReport } from '../core/status.js';
import type { Ctx } from '../context.js';
import type { Data } from '../types.js';
import type { SlowRowsKeys } from './keys.js';
import { useRead, type ReadState } from './read.js';
import { statusBody, statusPage, type StatusBody } from './status.js';
import { emptyWindow, goTo, moveBy, type RowWindow } from './window.js';

/** Everything the status surface owns: its report, the rows its window moves over, and the read. */
export interface StatusState {
  read: ReadState<StatusReport>;
  body: StatusBody;
  window: RowWindow;
  keys: SlowRowsKeys;
}

export interface StatusOptions {
  data: Data;
  ctx: Ctx;
  width: number;
  height: number;
  active: boolean;
}

/**
 * `status` as a surface: the report the core answers, the rows the focus moves through, and the read
 * that fills them. The read spawns a version check per harness, so it is slow enough to be named,
 * timed and stopped; `r` asks again and no key here writes.
 */
export function useStatusSurface({ data, ctx, width, height, active }: StatusOptions): StatusState {
  // `status` asks the core the same question `ahsm status` does, and writes nothing to answer it.
  const read = useRead(() => readStatus(data, ctx));
  const [window, setWindow] = useState<RowWindow>(emptyWindow);

  useEffect(() => {
    if (active) read.load();
  }, [active, read.load]);

  const body = statusBody(read.state.value);
  const rows = body.focusable.length;

  return {
    read: read.state,
    body,
    window,
    keys: {
      page: statusPage(body, width, height, window.index),
      move: (delta) => setWindow((at) => moveBy(at, rows, delta)),
      pageBy: (delta) => setWindow((at) => moveBy(at, rows, delta)),
      edge: (at) => setWindow(goTo(at === 'first' ? 0 : rows - 1, rows)),
      reload: read.load,
      busy: read.state.status === 'busy',
      stopWaiting: read.stop,
    },
  };
}
