import type { StaleReport, StaleRow, StaleValue } from '../core/stale.js';
import { t } from '../i18n.js';
import { staleLines, type Line } from '../render.js';
import { truncate, wrap } from './format.js';
import { rowsBody, rowsPage, type BodyLine, type RowBlock, type RowsBodyParts } from './rows-frame.js';
import type { RowWindow, WindowView } from './window.js';

/** The surface prints its own name, then the heading line `staleLines` owns. */
export const STALE_HEADING = 2;

/** What narrows the report: the typed substring, and the verdict `f` cycles through. */
export interface StaleFilter {
  text: string;
  /** One of the formatter's three state words, or `undefined` for every row. */
  state?: StaleValue;
}

export interface StaleBody {
  /** The formatter's heading, `skills (provider update check)`. */
  heading: Line;
  /** The report's warnings, pinned below the rows so a damaged lockfile is never scrolled away. */
  warnings: Line[];
  blocks: RowBlock[];
  /** The formatter's one-sentence answer when there is nothing to list: not covered, or empty. */
  note?: Line;
  /** The formatter's count line, `103 skill(s) — verification only, nothing was installed`. */
  trailer?: Line;
  total: number;
  matched: number;
}

const HEADING: Line = staleLines({ covered: true, rows: [], warnings: [] })[0] ?? { text: t.staleTitle, tone: 'dim' };
const EMPTY: StaleBody = { heading: HEADING, warnings: [], blocks: [], total: 0, matched: 0 };

/** The order `f` walks: the two states a user acts on, the gap, then every row again. */
const STATES: readonly (StaleValue | undefined)[] = ['stale', 'up-to-date', 'unknown', undefined];

export function nextState(state: StaleValue | undefined): StaleValue | undefined {
  return STATES[(STATES.indexOf(state) + 1) % STATES.length];
}

/** A count and a state word only narrow the report when they are actually on. */
function narrowed(filter: StaleFilter): boolean {
  return filter.text !== '' || filter.state !== undefined;
}

/** One recorded skill as the formatter writes it: the state word, the name, the source, the reason. */
function rowLine(row: StaleRow): Line | undefined {
  return staleLines({ covered: true, rows: [row], warnings: [] })[1];
}

/**
 * The report as the window can move over: the formatter's heading, one line per recorded skill it
 * keeps, and the formatter's count line. Nothing here words a verdict — the state word, the source and
 * the provider's reason all arrive from `staleLines`, so `unknown` can never be read as good news.
 */
export function staleBody(report: StaleReport | undefined, filter: StaleFilter): StaleBody {
  if (!report) return EMPTY;
  const all = staleLines(report);
  const warnings = all.slice(0, report.warnings.length);
  const heading = all[report.warnings.length] ?? HEADING;
  const answer = all[report.warnings.length + 1];

  // Not covered and an empty lockfile are full answers: one sentence, and not a row to move over.
  if (!report.covered || report.rows.length === 0) {
    return { heading, warnings, blocks: [], ...(answer ? { note: answer } : {}), total: 0, matched: 0 };
  }

  const wanted = filter.text.toLowerCase();
  const blocks: RowBlock[] = [];
  for (const row of report.rows) {
    if (filter.state !== undefined && row.value !== filter.state) continue;
    const line = rowLine(row);
    if (!line) continue;
    if (wanted !== '' && !line.text.toLowerCase().includes(wanted)) continue;
    blocks.push({ lines: [line], focusable: true });
  }

  return { heading, warnings, blocks, trailer: all[all.length - 1], total: report.rows.length, matched: blocks.length };
}

/** How many lines the tail pins below the rows: the warnings, the match count, the trailer. */
function tailLines(body: StaleBody, filter: StaleFilter, width: number): BodyLine[] {
  const lines: BodyLine[] = [];
  for (const warning of body.warnings) lines.push(...wrap(warning.text, width).map((text): BodyLine => [{ text, tone: warning.tone }]));
  if (body.total > 0 && narrowed(filter)) {
    lines.push([{ text: truncate(t.tui.matchCount(body.matched, body.total), width), tone: 'dim' }]);
  }
  if (body.trailer) lines.push([{ text: truncate(body.trailer.text, width), tone: body.trailer.tone }]);
  return lines;
}

/** The one-sentence answer, wrapped, directly under the heading: there are no rows to push it down. */
function noteLines(body: StaleBody, width: number): BodyLine[] {
  if (!body.note) return [];
  return wrap(body.note.text, width).map((text): BodyLine => [{ text, tone: body.note?.tone ?? 'dim' }]);
}

/** The report as a body: the heading with its meta, the one-sentence answer, the rows, then the tail. */
function parts(body: StaleBody, filter: StaleFilter, width: number): RowsBodyParts {
  return {
    heading: { line: body.heading, meta: (view) => metaLines(body, filter, view) },
    note: noteLines(body, width),
    blocks: body.blocks,
    tail: tailLines(body, filter, width),
  };
}

/** The window, the filter and the state, shortest last, so a narrow frame drops words rather than rows. */
function metaLines(body: StaleBody, filter: StaleFilter, view: WindowView): string[] {
  const window = body.total === 0 ? t.tui.windowEmpty : t.tui.windowCount(view.start + 1, view.end, body.total);
  const own = filter.text === '' ? t.tui.filterNone : t.tui.filterText(filter.text);
  const state = filter.state === undefined ? undefined : t.tui.stateFilter(t.staleLabels[filter.state]);
  const statePart = state ? [state] : [];
  return [
    [window, own, ...statePart].join(t.tui.keybarSeparator),
    [window, own].join(t.tui.keybarSeparator),
    [window, ...statePart].join(t.tui.keybarSeparator),
    window,
  ];
}

/**
 * The whole body as cells, exactly `height` lines: the heading with its window and state filter, the
 * sentence when there is nothing to list, the rows in their window, then the warnings and the
 * formatter's count line.
 */
export function staleFrame(body: StaleBody, filter: StaleFilter, width: number, height: number, window: RowWindow): BodyLine[] {
  return rowsBody(parts(body, filter, width), width, height, window);
}

/** One page is one window of rows, so `PgDn` never lands past a row the user could have seen. */
export function stalePage(body: StaleBody, filter: StaleFilter, width: number, height: number, window: RowWindow): number {
  return rowsPage(parts(body, filter, width), width, Math.max(1, height - STALE_HEADING), window);
}
