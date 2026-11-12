import { t } from '../i18n.js';

/** One piece of a line, with the one attribute the TUI has used so far: dimmed chrome. */
export interface Segment {
  text: string;
  dim?: boolean;
  bold?: boolean;
}

/** Shortened to the width, never longer: the last column carries the ellipsis. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length <= width) return text;
  if (width === 1) return t.tui.ellipsis;
  return `${text.slice(0, width - 1)}${t.tui.ellipsis}`;
}

export function pad(text: string, width: number): string {
  return text.length >= width ? text : text.padEnd(width, ' ');
}

/**
 * The one line that is allowed to wrap: a line the user must read in full. Continuation lines sit two
 * columns in from the line's own indent, a token wider than the frame (a hook's JSON) is cut where it
 * stands, and the text itself is carried over untouched — spacing included, so the formatter's words
 * arrive as the formatter wrote them.
 */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) return [];
  const lead = text.length - text.trimStart().length;
  const indent = ' '.repeat(Math.min(lead + 2, width - 1));
  const lines: string[] = [];
  let rest = text;
  let first = true;

  while (rest !== '') {
    const prefix = first ? '' : indent;
    const room = width - prefix.length;
    if (rest.length <= room) {
      lines.push(prefix + rest.trimEnd());
      break;
    }
    // Break at the last space of a run: a double space belongs to the text, not to the break.
    let cut = -1;
    for (let at = Math.min(room, rest.length - 1); at > 0; at -= 1) {
      if (rest[at] === ' ' && rest[at + 1] !== ' ') {
        cut = at;
        break;
      }
    }
    const hard = cut <= 0;
    if (hard) cut = room;
    lines.push(prefix + rest.slice(0, cut));
    rest = rest.slice(hard ? cut : cut + 1);
    first = false;
  }
  return lines;
}

/** The segments laid out on one line, cut at the frame width: what does not fit is one ellipsis. */
export function fitSegments(segments: Segment[], width: number): Segment[] {
  const kept: Segment[] = [];
  let left = width;
  for (const segment of segments) {
    if (left <= 0) break;
    const text = truncate(segment.text, left);
    if (text) kept.push({ ...segment, text });
    left -= text.length;
    if (text.length < segment.text.length) break;
  }
  return kept;
}
