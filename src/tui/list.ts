import type { SkillInventoryReport } from '../core/list.js';
import { t } from '../i18n.js';
import { listLines, type Line } from '../render.js';
import { truncate, wrap } from './format.js';
import { rowsBody, rowsPage, type BodyLine, type RowBlock, type RowsBodyParts } from './rows-frame.js';
import type { RowWindow, WindowView } from './window.js';

/** The surface prints its own name, then the heading line `listFrame` owns. */
export const LIST_HEADING = 2;

/** What narrows the inventory: the typed substring, the carrier toggle, and the harnesses it asks about. */
export interface ListFilter {
  text: string;
  /** `f`: keep only the skills one of the chosen harnesses reports. */
  carriers: boolean;
  /** The harness ids chosen on the install surface. */
  harnessIds: readonly string[];
}

export interface ListBody {
  /** The formatter's heading, `skills (provider inventory)`. */
  heading: Line;
  blocks: RowBlock[];
  /** The formatter's empty sentence, when the inventory itself is empty. */
  note?: Line;
  /** The formatter's count line, `103 skill(s) — inventory read only, nothing written`. */
  trailer?: Line;
  total: number;
  matched: number;
}

const HEADING: Line = listLines({ rows: [] })[0] ?? { text: t.skillsTitle, tone: 'dim' };
const EMPTY: ListBody = { heading: HEADING, blocks: [], total: 0, matched: 0 };

function narrowed(filter: ListFilter): boolean {
  return filter.text !== '' || filter.carriers;
}

/**
 * The inventory as the window can move over: the formatter's heading, one line per skill it keeps, and
 * the formatter's trailer. The filter is the only thing that decides which rows exist; nothing here
 * words a skill row.
 */
export function listBody(report: SkillInventoryReport | undefined, filter: ListFilter): ListBody {
  if (!report) return EMPTY;
  const all = listLines(report);
  const heading = all[0] ?? EMPTY.heading;
  if (report.rows.length === 0) return { ...EMPTY, heading, note: all[1] ?? { text: t.listEmpty, tone: 'dim' } };

  const wanted = filter.text.toLowerCase();
  const blocks: RowBlock[] = [];
  for (const row of report.rows) {
    if (filter.carriers && !row.harnesses.some((harness) => filter.harnessIds.includes(harness))) continue;
    // One row as the formatter writes it: `listLines` owns the words, this only windows them.
    const line = listLines({ rows: [row] })[1];
    if (!line) continue;
    if (wanted !== '' && !line.text.toLowerCase().includes(wanted)) continue;
    blocks.push({ lines: [line], focusable: true });
  }

  return { heading, blocks, trailer: all[all.length - 1], total: report.rows.length, matched: blocks.length };
}

/** How many lines the tail pins below the rows: the empty sentence, the match count, the trailer. */
function tailLines(body: ListBody, filter: ListFilter, width: number): BodyLine[] {
  const lines: BodyLine[] = [];
  if (body.note) lines.push(...wrap(body.note.text, width).map((text): BodyLine => [{ text, tone: body.note?.tone ?? 'dim' }]));
  if (body.total > 0 && narrowed(filter)) {
    lines.push([{ text: truncate(t.tui.matchCount(body.matched, body.total), width), tone: 'dim' }]);
  }
  if (body.trailer) lines.push([{ text: truncate(body.trailer.text, width), tone: body.trailer.tone }]);
  return lines;
}

/** The window and the filter, shortest last, so a narrow frame drops words rather than the count. */
function metaLines(body: ListBody, filter: ListFilter, view: WindowView): string[] {
  const window = body.total === 0 ? t.tui.windowEmpty : t.tui.windowCount(view.start + 1, view.end, body.total);
  const own = filter.text === '' ? t.tui.filterNone : t.tui.filterText(filter.text);
  const carriers = filter.carriers ? t.tui.listCarriers([...filter.harnessIds]) : undefined;
  return [
    [window, own, ...(carriers ? [carriers] : [])].join(t.tui.keybarSeparator),
    [window, own].join(t.tui.keybarSeparator),
    window,
  ];
}

/** The inventory as a body: the heading with its window and filter, the rows, then the counts. */
function parts(body: ListBody, filter: ListFilter, width: number): RowsBodyParts {
  return {
    heading: { line: body.heading, meta: (view) => metaLines(body, filter, view) },
    blocks: body.blocks,
    tail: tailLines(body, filter, width),
  };
}

/**
 * The whole body as cells, exactly `height` lines: the heading with its window and filter, the rows in
 * their window, then the match count and the formatter's trailer. Nothing here writes a skill row.
 */
export function listFrame(body: ListBody, filter: ListFilter, width: number, height: number, window: RowWindow): BodyLine[] {
  return rowsBody(parts(body, filter, width), width, height, window);
}

/** One page is one window of rows, so `PgDn` never lands past a row the user could have seen. */
export function listPage(body: ListBody, filter: ListFilter, width: number, height: number, window: RowWindow): number {
  return rowsPage(parts(body, filter, width), width, Math.max(1, height - LIST_HEADING), window);
}
