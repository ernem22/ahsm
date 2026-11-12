import { useEffect, useState } from 'react';
import { applyRemovePlan, planRemoval, type RemoveOutcome, type RemovePlan } from '../core/remove.js';
import type { Ctx } from '../context.js';
import { t } from '../i18n.js';
import type { Tone } from '../render.js';
import type { Data } from '../types.js';
import type { WriteState } from './apply.js';
import type { FilterKeys, RemoveKeys } from './keys.js';
import { useRead, type ReadState } from './read.js';
import { removeCount, removePage } from './remove.js';
import { useWrite } from './use-write.js';
import { emptyWindow, goTo, moveBy, type RowWindow } from './window.js';

/** Everything the removal surface owns: the plan read, its window, the name mode and the one write. */
export interface RemoveState {
  read: ReadState<RemovePlan>;
  plan: RemovePlan | undefined;
  window: RowWindow;
  /** The skill-name text mode: the only text input outside the filter. */
  name: FilterKeys;
  write: WriteState<RemoveOutcome>;
  /** Entering the surface starts its write from nothing, so an old result is never this plan's answer. */
  reset(): void;
  keys: RemoveKeys;
}

export interface RemoveOptions {
  data: Data;
  ctx: Ctx;
  width: number;
  height: number;
  active: boolean;
  /** The in-flight refusal is the one line the shell owns, so the write states it there. */
  say(message: string | undefined, tone?: Tone): void;
}

/**
 * `x` as a surface: the removal plan the record (and the names typed into the one text mode) produces,
 * the window over its per-entry rows, and `y` running exactly that plan through the core. The plan is
 * read once per visit and again only when a new name joins it, because `planRemoval` reads the provider
 * inventory only for a name no record covers.
 */
export function useRemoveSurface({ data, ctx, width, height, active, say }: RemoveOptions): RemoveState {
  const [names, setNames] = useState<string[]>([]);
  const read = useRead(() => planRemoval(data, ctx, { skillNames: names }));
  const [window, setWindow] = useState<RowWindow>(emptyWindow);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');

  // A submitted name is a different plan; without one, the recorded plan is read once on entering.
  const submitted = names.join('\n');
  useEffect(() => {
    if (active) read.load();
  }, [active, read.load, submitted]);

  const plan = read.state.value;
  const planned = plan?.entries.length ?? 0;
  const entries = plan ? removeCount(plan) : 0;

  const name: FilterKeys = {
    text,
    typing,
    labels: { clear: t.tui.keys.nameCancel, keep: t.tui.keys.nameRemove },
    start: () => setTyping(true),
    edit: (change) => setText((current) => change(current)),
    // `Esc` is the mode's: the name goes away and the plan stays exactly as it was.
    clear: () => {
      setText('');
      setTyping(false);
    },
    // `Enter` hands the name to the same `planRemoval` call `remove --skill` makes.
    keep: () => {
      const next = text.trim();
      setTyping(false);
      setText('');
      if (next === '') return;
      setNames((current) => (current.includes(next) ? current : [...current, next]));
    },
  };

  const write = useWrite<RemoveOutcome>({
    say,
    run: plan ? () => applyRemovePlan(data, ctx, plan) : undefined,
    shape: t.tui.removeShape(entries),
  });

  return {
    read: read.state,
    plan,
    window,
    name,
    write: write.state,
    reset: write.reset,
    keys: {
      page: removePage(plan, name, width, height, window),
      move: (delta) => setWindow((at) => moveBy(at, planned, delta)),
      pageBy: (delta) => setWindow((at) => moveBy(at, planned, delta)),
      edge: (at) => setWindow(goTo(at === 'first' ? 0 : planned - 1, planned)),
      reload: read.load,
      busy: read.state.status === 'busy',
      stopWaiting: read.stop,
      applying: write.applying,
      result: write.result,
      planReady: plan !== undefined,
      entries,
      planned,
      runApply: write.write,
      name,
    },
  };
}
