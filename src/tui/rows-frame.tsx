import React from 'react';
import { Text } from 'ink';
import { t } from '../i18n.js';
import { toneColor, toneDim, type Line, type Tone } from '../render.js';
import { truncate, wrap } from './format.js';
import { goTo, rowsInView, type RowWindow, type WindowView } from './window.js';

/** Two columns need 100 columns: a 50-column list, a 2-column gutter, and the rest for the detail. */
export const WIDE_WIDTH = 100;
/** Below 60 columns there is no room to wrap the focus: each continuation is cut to one `…` line. */
export const NARROW_WIDTH = 60;
export const ROW_COLUMN = 50;
export const DETAIL_COLUMN = 62;
export const GUTTER = 2;

/** One span of a body line: its text, its tone, and whether it carries the focus. */
export interface Cell {
  text: string;
  tone: Tone;
  inverse?: boolean;
}

export type BodyLine = Cell[];

/**
 * One row of a rows surface: the lines the formatter wrote for it, in its own words. A heading or a
 * note is printed like any other line but never marked, because there is nothing to land on.
 */
export interface RowBlock {
  lines: Line[];
  focusable?: boolean;
  /** Keep the focus column on every row, for a surface whose rows align with it (the plan's boxes). */
  indent?: boolean;
}

/** The two-column split, or nothing when the frame is too narrow for a detail column to be worth it. */
function columns(width: number): { rows: number; detail: number } | undefined {
  if (width < WIDE_WIDTH) return undefined;
  const rows = Math.min(ROW_COLUMN, width - GUTTER - 1);
  return { rows, detail: Math.min(DETAIL_COLUMN, width - rows - GUTTER) };
}

/** A row as the list prints it: the focus mark, then as much of the formatter's line as fits. */
function head(block: RowBlock, focused: boolean, width: number): Cell[] {
  const line = block.lines[0];
  if (!line) return [];
  const mark = focused ? t.tui.marks.focused : block.indent ? t.tui.marks.blank : '';
  return [
    { text: mark, tone: line.tone, inverse: focused },
    { text: truncate(line.text, Math.max(0, width - mark.length)), tone: line.tone, inverse: focused },
  ];
}

/** One formatter line on its own, wrapped: only the lines a user must read whole go through here. */
export function wrapped(text: string, tone: Tone, width: number): BodyLine[] {
  return wrap(text, width).map((piece) => [{ text: piece, tone }]);
}

/**
 * The focused row in one column. Between 60 and 99 columns its own line wraps under itself behind the
 * focus mark, and its continuation lines follow. At 59 and below wrapping would spend the window on one
 * row, so the focus and each continuation are suppressed to one line and cut with `…`.
 */
function focusedRow(block: RowBlock, width: number): BodyLine[] {
  const [first, ...rest] = block.lines;
  const lines: BodyLine[] = [];
  const narrow = width < NARROW_WIDTH;
  if (first) {
    const marked = `${t.tui.marks.focused}${first.text}`;
    if (narrow) lines.push([{ text: truncate(marked, width), tone: first.tone, inverse: true }]);
    else for (const piece of wrap(marked, width)) lines.push([{ text: piece, tone: first.tone, inverse: true }]);
  }
  for (const line of rest) {
    if (narrow) lines.push([{ text: truncate(line.text, width), tone: line.tone }]);
    else lines.push(...wrapped(line.text, line.tone, width));
  }
  return lines;
}

/** A row's height in the list: one line, plus everything the focused row wraps to under itself. */
function entryHeight(block: RowBlock, focused: boolean, width: number): number {
  if (!focused) return 1;
  return Math.max(1, focusedRow(block, width).length);
}

function cellsWidth(cells: Cell[]): number {
  return cells.reduce((total, cell) => total + cell.text.length, 0);
}

/** The focused row in full: its own line and every continuation line, wrapped rather than cut. */
function detailCell(block: RowBlock, width: number, height: number): BodyLine[] {
  const lines = block.lines.flatMap((line) => wrapped(line.text, line.tone, width));
  return lines.slice(0, height);
}

/**
 * The rows in view at this window: at two columns each row is one line, and at one column the focused
 * row's wrapped lines consume the window like any other line.
 */
export function rowsView(blocks: RowBlock[], window: RowWindow, width: number, height: number): WindowView {
  const index = goTo(window.index, blocks.length).index;
  return rowsInView({ index }, blocksHeight(blocks, index, width), height);
}

/** The rows the window shows, one column or two, padded to exactly `height` lines. */
function rowLines(blocks: RowBlock[], window: RowWindow, width: number, height: number): BodyLine[] {
  const index = goTo(window.index, blocks.length).index;
  const split = columns(width);
  const itself = blocks[index];
  const heads = blocks.map((block, at) => head(block, at === index, split?.rows ?? width));
  const view = rowsView(blocks, { index }, width, height);

  if (!split) {
    const lines: BodyLine[] = [];
    for (let at = view.start; at < view.end; at += 1) {
      const block = blocks[at];
      if (!block) continue;
      if (at === index) lines.push(...focusedRow(block, width));
      else lines.push(head(block, false, width));
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
export function padLines(lines: BodyLine[], height: number): BodyLine[] {
  const kept = lines.slice(0, height);
  while (kept.length < height) kept.push([{ text: ' ', tone: 'dim' }]);
  return kept;
}

/** The row window, exactly `height` lines: what the surface hands the shell above its tail and keybar. */
export function rowsFrame(blocks: RowBlock[], width: number, height: number, window: RowWindow): BodyLine[] {
  return rowLines(blocks, window, width, height);
}

/**
 * A surface's heading on the left and the window/filter that fits right-aligned, longest variant first,
 * or the heading cut when even the shortest variant would not fit beside it.
 */
export function headingLine(heading: Line, meta: string[], width: number): BodyLine {
  const chosen = meta.find((text) => heading.text.length + 1 + text.length <= width);
  if (!chosen) return [{ text: truncate(heading.text, width), tone: heading.tone }];
  return [
    { text: heading.text, tone: heading.tone },
    { text: ' '.repeat(width - heading.text.length - chosen.length), tone: 'dim' },
    { text: chosen, tone: 'dim' },
  ];
}

/**
 * A body's parts, in print order: the heading with the window and filter that fit beside it, the
 * sentence a surface states before its rows, the rows themselves, and the lines pinned below them.
 * Every rows surface composes this instead of re-deriving the shape.
 */
export interface RowsBodyParts {
  heading?: { line: Line; meta(view: WindowView): string[] };
  note?: BodyLine[];
  blocks: RowBlock[];
  tail: BodyLine[];
}

/** The lines the row window gets: the body it was given, minus the heading, the note and the tail. */
export function rowsRoom(parts: RowsBodyParts, height: number, least = 0): number {
  const fixed = (parts.heading ? 1 : 0) + (parts.note?.length ?? 0) + parts.tail.length;
  return Math.max(least, Math.max(1, height) - fixed);
}

/** The whole body as cells, exactly `height` lines: heading, note, the rows in their window, then the tail. */
export function rowsBody(parts: RowsBodyParts, width: number, height: number, window: RowWindow, least = 0): BodyLine[] {
  const room = rowsRoom(parts, height, least);
  const at = goTo(window.index, parts.blocks.length);
  const view = rowsInView({ index: at.index }, blocksHeight(parts.blocks, at.index, width), room);
  const kept = room > 0 && parts.blocks.length > 0 ? rowsFrame(parts.blocks, width, room, at) : padLines([], room);
  return [
    ...(parts.heading ? [headingLine(parts.heading.line, parts.heading.meta(view), width)] : []),
    ...(parts.note ?? []),
    ...kept,
    ...parts.tail,
  ];
}

/** One page is one window of rows, so `PgDn` never lands past a row the user could have seen. */
export function rowsPage(parts: RowsBodyParts, width: number, height: number, window: RowWindow, least = 0): number {
  const room = Math.max(1, rowsRoom(parts, height, least));
  const at = goTo(window.index, parts.blocks.length);
  const view = rowsInView({ index: at.index }, blocksHeight(parts.blocks, at.index, width), room);
  return Math.max(1, view.end - view.start);
}

/** The two-column split is one line per row; one column lets the focused row wrap under itself. */
function blocksHeight(blocks: RowBlock[], index: number, width: number): number[] {
  return columns(width) ? blocks.map(() => 1) : blocks.map((block, at) => entryHeight(block, at === index, width));
}

/** One body line: each cell keeps its own tone, and focus is the inverse video the design asks for. */
export function Line({ cells }: { cells: BodyLine }): React.ReactElement {
  return (
    <Text>
      {cells.map((cell, at) => (
        <Text key={at} color={toneColor(cell.tone)} dimColor={toneDim(cell.tone)} inverse={cell.inverse}>
          {cell.text}
        </Text>
      ))}
    </Text>
  );
}
