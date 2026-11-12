import type { UpdatePlan } from '../core/update.js';
import { planLines, updateLines, type Line } from '../render.js';
import { wrap } from './format.js';
import { rowsBody, rowsPage, type BodyLine, type RowBlock, type RowsBodyParts } from './rows-frame.js';
import { goTo, type RowWindow } from './window.js';

/** The surface prints its own name above the body it hands to `updateFrame`. */
export const UPDATE_HEADING = 1;

/**
 * The update plan as the window can move over. Every word is `render.ts`'s: `updateLines` writes the
 * warnings and skips first, then the plan for exactly the stale skills, then its two count lines.
 */
export interface UpdateBody {
  /** The formatter's warnings and skips: what the update cannot act on, said before the plan. */
  notes: Line[];
  /** The formatter's `UPDATE` heading, then its rows; absent when there is nothing to update. */
  heading?: Line;
  /** The formatter's one-sentence answer when no stale skill can be updated. */
  answer?: Line;
  blocks: RowBlock[];
  /** The formatter's requirements, plan warnings and both count lines, pinned below the rows. */
  tail: Line[];
}

const EMPTY: UpdateBody = { notes: [], blocks: [], tail: [] };

/**
 * One entry and the lines the formatter writes for it, kept in the update plan's own order: the update
 * is the install plan, so its rows are `planLines`' rows — the skill, its harness, its command, its note.
 */
function entryBlocks(plan: UpdatePlan['plan']): RowBlock[] {
  return plan.entries.map((entry) => ({
    lines: planLines({ ...plan, entries: [entry], requirements: [], warnings: [] }).slice(0, -1),
    indent: true,
  }));
}

/**
 * The formatter's output split into the parts a rows surface can print: the skips and warnings first,
 * the plan's heading, one block per entry, then everything the formatter pins under them. Nothing here
 * words an update line or drops one the core produced.
 */
export function updateBody(update: UpdatePlan | undefined): UpdateBody {
  if (!update) return EMPTY;
  const all = updateLines(update);
  const noteCount = update.warnings.length + update.skips.length;
  const notes = all.slice(0, noteCount);

  if (update.plan.entries.length === 0) {
    const answer = all[noteCount];
    return { notes, ...(answer ? { answer } : {}), blocks: [], tail: [] };
  }

  const heading = all[noteCount];
  const blocks = entryBlocks(update.plan);
  const entryLineCount = blocks.reduce((total, block) => total + block.lines.length, 0);
  const tail = all.slice(noteCount + 1 + entryLineCount);
  return { notes, ...(heading ? { heading } : {}), blocks, tail };
}

/** The formatter's lines as cells, wrapped whole: a skip or a count is never shortened, only carried over. */
function pinned(lines: Line[], width: number): BodyLine[] {
  return lines.flatMap((line) => wrap(line.text, width).map((text): BodyLine => [{ text, tone: line.tone }]));
}

/**
 * The fixed lines, fitted to the body: skips may be many, so the pinned lines give way first — but the
 * formatter's last line (its count, or its one-sentence answer) always stays above the keybar.
 */
function fitted(top: BodyLine[], bottom: BodyLine[], height: number): { top: BodyLine[]; bottom: BodyLine[] } {
  const room = Math.max(0, Math.max(1, height) - 1);
  if (top.length + bottom.length <= room) return { top, bottom };
  const last = bottom.length > 0 ? bottom.slice(-1) : [];
  return { top: top.slice(0, Math.max(0, room - last.length)), bottom: last };
}

/** The fixed lines: the skips and heading above, the formatter's counts and answer below. */
function parts(body: UpdateBody, width: number, height: number): RowsBodyParts {
  const top = pinned([...body.notes, ...(body.heading ? [body.heading] : [])], width);
  const bottom = pinned([...body.tail, ...(body.answer ? [body.answer] : [])], width);
  const fittedParts = fitted(top, bottom, height);
  return { note: fittedParts.top, blocks: body.blocks, tail: fittedParts.bottom };
}

/** The whole body as cells, exactly `height` lines: skips, heading, rows, then the formatter's counts. */
export function updateFrame(update: UpdatePlan, width: number, height: number, window: RowWindow): BodyLine[] {
  const body = updateBody(update);
  return rowsBody(parts(body, width, height), width, height, goTo(window.index, body.blocks.length), 1);
}

/** One page is one window of rows, so `PgDn` never lands past a row the user could have seen. */
export function updatePage(update: UpdatePlan | undefined, width: number, height: number, window: RowWindow): number {
  const room = Math.max(1, height - UPDATE_HEADING);
  if (!update) return room;
  const body = updateBody(update);
  return rowsPage(parts(body, width, room), width, room, goTo(window.index, body.blocks.length), 1);
}
