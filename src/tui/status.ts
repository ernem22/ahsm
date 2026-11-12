import type { StatusReport } from '../core/status.js';
import { t } from '../i18n.js';
import { statusLines, type Line } from '../render.js';
import { padLines, rowsFrame, rowsView, wrapped, type BodyLine, type RowBlock } from './rows-frame.js';
import { goTo } from './window.js';

/** The surface prints one heading line above the body it hands to `statusFrame`. */
export const STATUS_HEADING = 1;

/** The formatter indents a row's continuation lines by four columns; nothing else it writes does. */
const CONTINUATION = '    ';

/**
 * The report as the formatter wrote it, in print order: the warnings, the two section headings and one
 * block per row. Nothing here builds a status sentence — `statusLines` owns every word, and this splits
 * its output into what a window can move over.
 */
export interface StatusBody {
  /** The report's warnings: pinned above the keybar, so a damaged record is never scrolled away. */
  warnings: Line[];
  blocks: RowBlock[];
  /** The block indexes the focus can land on, in print order: one per harness and one per recorded item. */
  focusable: number[];
}

const EMPTY: StatusBody = { warnings: [], blocks: [], focusable: [] };

export function statusBody(report: StatusReport | undefined): StatusBody {
  if (!report) return EMPTY;
  const lines = statusLines(report);
  const warnings = lines.slice(0, report.warnings.length);
  const blocks: RowBlock[] = [];
  const focusable: number[] = [];

  for (const line of lines.slice(warnings.length)) {
    const last = blocks[blocks.length - 1];
    // A `update:` line belongs to the row above it: it is that row's detail, not a row of its own.
    if (last?.focusable && line.text.startsWith(CONTINUATION)) {
      last.lines.push(line);
      continue;
    }
    const isHeading = line.text === t.harnesses || line.text === t.itemsTitle || line.text === t.statusEmpty;
    blocks.push({ lines: [line], focusable: !isHeading });
    if (!isHeading) focusable.push(blocks.length - 1);
  }

  return { warnings, blocks, focusable };
}

/** The block the focus is on; a report with no rows at all has no focus. */
export function focusBlock(body: StatusBody, focus: number): number {
  if (body.focusable.length === 0) return 0;
  return body.focusable[goTo(focus, body.focusable.length).index] ?? 0;
}

/** The warnings, wrapped, taking at most every line but one: the rows give way, the warning does not. */
function tailLines(body: StatusBody, width: number, height: number): BodyLine[] {
  const lines = body.warnings.flatMap((line) => wrapped(line.text, line.tone, width));
  const room = Math.max(0, Math.max(1, height) - 1);
  return lines.length > room ? lines.slice(lines.length - room) : lines;
}

/** The whole body as lines of cells, exactly `height` lines: the rows in their window, then the warnings. */
export function statusFrame(body: StatusBody, width: number, height: number, focus: number): BodyLine[] {
  const room = Math.max(1, height);
  const tail = tailLines(body, width, room);
  const rows =
    body.blocks.length === 0
      ? padLines([], Math.max(0, room - tail.length))
      : rowsFrame(body.blocks, width, Math.max(1, room - tail.length), { index: focusBlock(body, focus) });
  return [...rows, ...tail];
}

/** One page is one window of focusable rows, so `PgDn` never skips a row the user could see. */
export function statusPage(body: StatusBody, width: number, height: number, focus: number): number {
  const bodyHeight = Math.max(1, height - STATUS_HEADING);
  const tail = tailLines(body, width, bodyHeight);
  const view = rowsView(body.blocks, { index: focusBlock(body, focus) }, width, Math.max(1, bodyHeight - tail.length));
  let seen = 0;
  for (let at = view.start; at < view.end; at += 1) if (body.blocks[at]?.focusable) seen += 1;
  return Math.max(1, seen);
}
