import { useEffect, useState } from 'react';
import { readSkillInventory, type SkillInventoryReport } from '../core/list.js';
import type { Ctx } from '../context.js';
import type { Data } from '../types.js';
import type { ListKeys } from './keys.js';
import { listBody, listPage, type ListBody, type ListFilter } from './list.js';
import { useRead, type ReadState } from './read.js';
import { emptyWindow, goTo, moveBy, type RowWindow } from './window.js';

/** Everything the list surface owns: its inventory, the filter that narrows it, and its window. */
export interface ListState {
  read: ReadState<SkillInventoryReport>;
  body: ListBody;
  filter: ListFilter;
  window: RowWindow;
  keys: ListKeys;
}

export interface ListOptions {
  data: Data;
  ctx: Ctx;
  /** The harness ids chosen on `install`: what the carrier filter asks about. */
  harnessIds: readonly string[];
  width: number;
  height: number;
  active: boolean;
}

/**
 * `list` as a surface: the provider inventory, the typed filter, the carrier toggle and the window over
 * the rows the two keep. The read is the slow one, so it is stoppable; nothing here writes.
 */
export function useListSurface({ data, ctx, harnessIds, width, height, active }: ListOptions): ListState {
  // `list` reads the provider's own inventory: the slow read, exactly as `agentenv list` does.
  const read = useRead(() => readSkillInventory(data, ctx));
  const [window, setWindow] = useState<RowWindow>(emptyWindow);
  const [text, setText] = useState('');
  const [carriers, setCarriers] = useState(false);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (active) read.load();
  }, [active, read.load]);

  const filter: ListFilter = { text, carriers, harnessIds };
  // One inventory, filtered once: the rows and the counts are made of the same blocks.
  const body = listBody(read.state.value, filter);
  const rows = body.blocks.length;

  return {
    read: read.state,
    body,
    filter,
    window,
    keys: {
      page: listPage(body, filter, width, height, window),
      move: (delta) => setWindow((at) => moveBy(at, rows, delta)),
      pageBy: (delta) => setWindow((at) => moveBy(at, rows, delta)),
      edge: (at) => setWindow(goTo(at === 'first' ? 0 : rows - 1, rows)),
      reload: read.load,
      busy: read.state.status === 'busy',
      stopWaiting: read.stop,
      carriers,
      harnessIds,
      toggleCarriers: () => setCarriers((on) => !on),
      filter: {
        text,
        typing,
        start: () => setTyping(true),
        edit: (change) => setText((current) => change(current)),
        // One step takes the text and the carrier toggle both, so `Esc` never asks twice.
        clear: () => {
          setText('');
          setCarriers(false);
          setTyping(false);
        },
        keep: () => setTyping(false),
      },
    },
  };
}
