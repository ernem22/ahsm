import React from 'react';
import { Text } from 'ink';
import { t } from '../i18n.js';
import { toneColor, type Line, type Tone } from '../render.js';
import { truncate, wrap } from './format.js';
import { goTo, rowsInView, type RowWindow, type WindowView } from './window.js';

/** Two columns need 100 columns: a 50-column list, a 2-column gutter, and the rest for the detail. */
export const WIDE_WIDTH = 100;
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

/** A row's height in the list: one line, plus the continuation lines when it wraps under itself. */
function entryHeight(block: RowBlock, focused: boolean, width: number): number {
  if (!focused) return 1;
  return 1 + block.lines.slice(1).reduce((total, line) => total + wrap(line.text, width).length, 0);
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
 * row's wrapped continuations consume the window like any other line.
 */
export function rowsView(blocks: RowBlock[], window: RowWindow, width: number, height: number): WindowView {
  const index = goTo(window.index, blocks.length).index;
  const heights = columns(width)
    ? blocks.map(() => 1)
    : blocks.map((block, at) => entryHeight(block, at === index, width));
  return rowsInView({ index }, heights, height);
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

/** One body line: each cell keeps its own tone, and focus is the inverse video the design asks for. */
export function Line({ cells }: { cells: BodyLine }): React.ReactElement {
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
