import type { RemovePlan } from '../core/remove.js';
import { t } from '../i18n.js';
import { removePlanLines, type Line } from '../render.js';
import { wrap } from './format.js';
import { rowsBody, rowsPage, type BodyLine, type RowBlock, type RowsBodyParts } from './rows-frame.js';
import { goTo, type RowWindow } from './window.js';

/** The surface prints its own name above the body it hands to `removeFrame`. */
export const REMOVE_HEADING = 1;

/** The skill-name text mode as the body shows it: the only text input outside the filter. */
export interface RemoveName {
  typing: boolean;
  text: string;
}

/**
 * The removal plan as the window can move over. Every word is `render.ts`'s: one block per entry (its
 * row, then the harnesses, paths, command and note that entry owns), with the formatter's warnings and
 * the confirm sentence pinned below the rows.
 */
export interface RemoveBody {
  blocks: RowBlock[];
  /** The formatter's warnings, said above the confirm and never scrolled away. */
  warnings: Line[];
  /** The formatter's answer when the key has nothing to act on: an empty record, or only unremovable rows. */
  answer?: Line;
}

const EMPTY: RemoveBody = { blocks: [], warnings: [] };

/** The number of entries `y` would act on: the ones the plan says will be removed. */
export function removeCount(plan: RemovePlan): number {
  return plan.entries.filter((entry) => entry.action === 'remove').length;
}

/**
 * The confirm line: how many entries the key acts on, and the one record consequence it has. A plan of
 * names alone has no record to clear, so it says exactly that instead of claiming one.
 */
export function removeConfirm(plan: RemovePlan): Line | undefined {
  const count = removeCount(plan);
  if (count === 0) return undefined;
  const recorded = plan.entries.some((entry) => entry.action === 'remove' && !entry.named);
  return { text: recorded ? t.tui.removeConfirm(count) : t.tui.removeNamedConfirm(count), tone: 'normal' };
}

/** What the plan owes the user when the key would do nothing: the empty record, or rows that say why. */
export function removeAnswer(plan: RemovePlan | undefined): Line | undefined {
  if (!plan) return undefined;
  if (plan.entries.length === 0) return { text: t.tui.removeEmpty, tone: 'dim' };
  if (removeCount(plan) === 0) return { text: t.tui.removeUnremovable, tone: 'dim' };
  return undefined;
}

/** One entry and the lines the formatter writes for it, in the plan's own order. */
function entryBlocks(plan: RemovePlan): RowBlock[] {
  return plan.entries.map((entry) => ({
    lines: removePlanLines({ ...plan, entries: [entry], warnings: [] }),
    indent: true,
  }));
}

/** The plan as rows: the formatter's entries, its warnings, and its answer when there is nothing to do. */
export function removeBody(plan: RemovePlan | undefined): RemoveBody {
  if (!plan) return EMPTY;
  return {
    blocks: entryBlocks(plan),
    warnings: removePlanLines({ ...plan, entries: [], warnings: plan.warnings }),
    answer: removeAnswer(plan),
  };
}

/** The formatter's lines as cells, wrapped whole: a path list is carried over, never cut. */
function pinned(lines: Line[], width: number): BodyLine[] {
  return lines.flatMap((line) => wrap(line.text, width).map((text): BodyLine => [{ text, tone: line.tone }]));
}

/**
 * The name mode's own block, pinned under the plan: its title, the text as typed, and the sentence that
 * says where the inventory comes in. Every word is `i18n.ts`'s.
 */
function nameLines(name: RemoveName, width: number): BodyLine[] {
  if (!name.typing) return [];
  return pinned(
    [
      { text: t.tui.removeNameTitle, tone: 'normal' },
      { text: `${t.tui.removeNamePrompt} ${name.text}`, tone: 'normal' },
      { text: t.tui.removeNameHint, tone: 'dim' },
    ],
    width,
  );
}

/**
 * The lines the body pins below the rows: the warnings, the answer, the confirm sentence, and the name
 * mode when it is open. The name block is last, so a short frame drops a warning rather than the input.
 */
function tailLines(body: RemoveBody, plan: RemovePlan, name: RemoveName, width: number, height: number): BodyLine[] {
  const confirm = name.typing ? undefined : removeConfirm(plan);
  const lines = [
    ...pinned(body.warnings, width),
    ...(body.answer ? pinned([body.answer], width) : []),
    ...(confirm ? pinned([confirm], width) : []),
    ...nameLines(name, width),
  ];
  // A body shorter than its tail gives up the plan's rows, never the sentence the key answers for.
  const room = Math.max(0, Math.max(1, height) - 1);
  return lines.length > room ? lines.slice(lines.length - room) : lines;
}

/** One page is one window of rows, so `PgDn` never lands past a row the user could have seen. */
function parts(body: RemoveBody, plan: RemovePlan, name: RemoveName, width: number, height: number): RowsBodyParts {
  return { blocks: body.blocks, tail: tailLines(body, plan, name, width, height) };
}

/** The whole body as cells, exactly `height` lines: the entries in their window, then the pinned lines. */
export function removeFrame(
  plan: RemovePlan,
  name: RemoveName,
  width: number,
  height: number,
  window: RowWindow,
): BodyLine[] {
  const body = removeBody(plan);
  return rowsBody(parts(body, plan, name, width, height), width, height, goTo(window.index, body.blocks.length), 1);
}

/** One page is one window of rows, so `PgDn` never lands past a row the user could have seen. */
export function removePage(
  plan: RemovePlan | undefined,
  name: RemoveName,
  width: number,
  height: number,
  window: RowWindow,
): number {
  const room = Math.max(1, height - REMOVE_HEADING);
  if (!plan) return room;
  const body = removeBody(plan);
  return rowsPage(parts(body, plan, name, width, room), width, room, goTo(window.index, body.blocks.length), 1);
}
