import React from 'react';
import { Box, Text } from 'ink';
import type { Plan } from '../core/plan.js';
import { t } from '../i18n.js';
import { toneColor, type Tone } from '../render.js';
import { truncate, wrap } from './format.js';
import { planBlocks, planTail, type PlanBlock } from './plan.js';
import type { ReadState } from './read.js';
import { goTo, rowsInView, type RowWindow, type WindowView } from './window.js';

/** Two columns need 100 columns: a 50-column list, a 2-column gutter, and the rest for the detail. */
export const WIDE_WIDTH = 100;
export const ROW_COLUMN = 50;
export const DETAIL_COLUMN = 62;
export const GUTTER = 2;

/** The surface prints one heading line above the body it hands to `planFrame`. */
export const PLAN_HEADING = 1;

/** One span of a body line: its text, its tone, and whether it carries the focus. */
interface Cell {
  text: string;
  tone: Tone;
  inverse?: boolean;
}

type BodyLine = Cell[];

/** The two-column split, or nothing when the frame is too narrow for a detail column to be worth it. */
function columns(width: number): { rows: number; detail: number } | undefined {
  if (width < WIDE_WIDTH) return undefined;
  const rows = Math.min(ROW_COLUMN, width - GUTTER - 1);
  return { rows, detail: Math.min(DETAIL_COLUMN, width - rows - GUTTER) };
}

/** A row as the list prints it: the focus mark, then as much of the formatter's line as fits. */
function head(block: PlanBlock, focused: boolean, width: number): Cell[] {
  const line = block.lines[0];
  if (!line) return [];
  const mark = focused ? t.tui.marks.focused : t.tui.marks.blank;
  return [
    { text: mark, tone: line.tone, inverse: focused },
    { text: truncate(line.text, Math.max(0, width - mark.length)), tone: line.tone, inverse: focused },
  ];
}

/** One formatter line on its own, wrapped: only the lines a user must read whole go through here. */
function wrapped(text: string, tone: Tone, width: number): BodyLine[] {
  return wrap(text, width).map((piece) => [{ text: piece, tone }]);
}

/** A row's height in the list: one line, plus the continuation lines when it wraps under itself. */
function entryHeight(block: PlanBlock, focused: boolean, width: number): number {
  if (!focused) return 1;
  return 1 + block.lines.slice(1).reduce((total, line) => total + wrap(line.text, width).length, 0);
}

function cellsWidth(cells: Cell[]): number {
  return cells.reduce((total, cell) => total + cell.text.length, 0);
}

/** The focused entry in full: its own row and every continuation line, wrapped rather than cut. */
function detailCell(block: PlanBlock, width: number, height: number): BodyLine[] {
  const lines = block.lines.flatMap((line) => wrapped(line.text, line.tone, width));
  return lines.slice(0, height);
}

/** The rows in view at this index, in lines: the focused row's wrapped continuations consume the window. */
function rowView(blocks: PlanBlock[], index: number, width: number, height: number): WindowView {
  const focused = goTo(index, blocks.length).index;
  const heights = columns(width)
    ? blocks.map(() => 1)
    : blocks.map((block, at) => entryHeight(block, at === focused, width));
  return rowsInView({ index: focused }, heights, height);
}

/** The rows the window shows, one column or two, padded to exactly `height` lines. */
function rowLines(blocks: PlanBlock[], index: number, width: number, height: number): BodyLine[] {
  const itself = blocks[index];
  const heads = blocks.map((block, at) => head(block, at === index, columns(width)?.rows ?? width));
  const split = columns(width);
  const view = rowView(blocks, index, width, height);

  if (!split) {
    const lines: BodyLine[] = [];
    for (let at = view.start; at < view.end; at += 1) {
      lines.push(heads[at] ?? []);
      const block = blocks[at];
      if (!block || at !== index) continue;
      for (const line of block.lines.slice(1)) lines.push(...wrapped(line.text, line.tone, width));
    }
    return padLines(lines, height);
  }

  const detail = itself ? detailCell(itself, split.detail, height) : [];
  const lines: BodyLine[] = [];
  for (let offset = 0; offset < height; offset += 1) {
    const at = view.start + offset;
    const left = at < view.end ? (heads[at] ?? []) : [];
    const right = detail[offset] ?? [];
    lines.push([
      ...left,
      { text: ' '.repeat(Math.max(0, split.rows - cellsWidth(left))), tone: 'dim' },
      { text: ' '.repeat(GUTTER), tone: 'dim' },
      ...right,
    ]);
  }
  return lines;
}

/**
 * A body is always the height it was given, so the line below it is the keybar and nothing else. A
 * padded line holds one space rather than nothing: an empty `Text` measures zero rows.
 */
function padLines(lines: BodyLine[], height: number): BodyLine[] {
  const kept = lines.slice(0, height);
  while (kept.length < height) kept.push([{ text: ' ', tone: 'dim' }]);
  return kept;
}

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
  const blocks = planBlocks(plan);
  const rows = rowLines(
    blocks,
    goTo(window.index, blocks.length).index,
    width,
    rowHeight(plan, width, height, marked, requirementFocus),
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
  const view = rowView(blocks, goTo(window.index, blocks.length).index, width, rowHeight(plan, width, body, [], undefined));
  return Math.max(1, view.end - view.start);
}

/** One body line: each cell keeps its own tone, and focus is the inverse video the design asks for. */
function Line({ cells }: { cells: Cell[] }): React.ReactElement {
  return (
    <Text>
      {cells.map((cell, at) => (
        <Text key={at} color={toneColor(cell.tone)} dimColor={cell.tone === 'dim'} inverse={cell.inverse}>
          {cell.text}
        </Text>
      ))}
    </Text>
  );
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
