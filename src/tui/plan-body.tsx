import React from 'react';
import { Box, Text } from 'ink';
import type { Plan } from '../core/plan.js';
import { t } from '../i18n.js';
import { toneColor } from '../render.js';
import { Line, rowsFrame, rowsView, wrapped, type BodyLine, type RowBlock } from './rows-frame.js';
import { planBlocks, planTail } from './plan.js';
import type { ReadState } from './read.js';
import { goTo, type RowWindow } from './window.js';

/** The surface prints one heading line above the body it hands to `planFrame`. */
export const PLAN_HEADING = 1;

/**
 * The whole body as lines of cells: the row window, then the requirement rows, the warnings and the
 * count line — exactly `height` lines, so the count the formatter emits last lands directly above the
 * keybar however long the plan is. Nothing here writes a plan sentence: every word comes from
 * `planLines`, and this only windows, pads and tones it.
 */
export function planFrame(
  plan: Plan,
  width: number,
  height: number,
  window: RowWindow,
  marked: readonly string[],
  requirementFocus: number | undefined,
): BodyLine[] {
  const blocks: RowBlock[] = planBlocks(plan).map((block) => ({ lines: block.lines, indent: true }));
  const rows = rowsFrame(
    blocks,
    width,
    rowHeight(plan, width, height, marked, requirementFocus),
    goTo(window.index, blocks.length),
  );
  return [...rows, ...tailLines(plan, width, height, marked, requirementFocus)];
}

/** The lines the body pins above the keybar: requirements, warnings, the mark statement and the count. */
function tailLines(
  plan: Plan,
  width: number,
  height: number,
  marked: readonly string[],
  requirementFocus: number | undefined,
): BodyLine[] {
  const tail = planTail(plan, marked, requirementFocus);
  const pinned = [...tail.requirements, ...tail.warnings, ...(tail.summary ? [tail.summary] : []), tail.count];
  const lines = pinned.flatMap((line) => wrapped(line.text, line.tone, width));
  // A body shorter than the rows below it gives up row lines, never the count line.
  const room = Math.max(0, Math.max(1, height) - 1);
  return lines.length > room ? lines.slice(lines.length - room) : lines;
}

/** The lines the row window gets: the body it was given, minus what the tail pins. */
function rowHeight(
  plan: Plan,
  width: number,
  height: number,
  marked: readonly string[],
  requirementFocus: number | undefined,
): number {
  return Math.max(1, Math.max(1, height) - tailLines(plan, width, height, marked, requirementFocus).length);
}

/**
 * One page is one window of rows — exactly the rows this frame shows — so `PgDn` never leaves a row
 * unread between the view it left and the view it lands on.
 */
export function planPage(plan: Plan | undefined, width: number, height: number, window: RowWindow): number {
  const body = Math.max(1, height - PLAN_HEADING);
  if (!plan) return body;
  const blocks = planBlocks(plan);
  const view = rowsView(
    blocks,
    goTo(window.index, blocks.length),
    width,
    rowHeight(plan, width, body, [], undefined),
  );
  return Math.max(1, view.end - view.start);
}

export interface PlanSurfaceProps {
  read: ReadState<Plan>;
  width: number;
  height: number;
  window: RowWindow;
  /** The requirement ids the user marked: their update runs with the apply. */
  marked: readonly string[];
  /** The requirement row the focus is on, when it is on one. */
  requirementFocus: number | undefined;
}

/**
 * The plan, read-only: the rows that would run in the order they happen, the requirements they need,
 * and the count of both. `building plan…` while the read runs, the failure's own message if it throws.
 */
export function PlanSurface({
  read,
  width,
  height,
  window,
  marked,
  requirementFocus,
}: PlanSurfaceProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text dimColor>{t.tui.surfaces.plan}</Text>
      {read.status === 'done' && read.value ? (
        planFrame(
          read.value,
          width,
          Math.max(1, height - PLAN_HEADING),
          window,
          marked,
          requirementFocus,
        ).map((cells, at) => (
          <Line key={at} cells={cells} />
        ))
      ) : read.status === 'error' ? (
        <Text color={toneColor('error')}>{read.message}</Text>
      ) : (
        <Text dimColor>{t.planBuilding}</Text>
      )}
    </Box>
  );
}
