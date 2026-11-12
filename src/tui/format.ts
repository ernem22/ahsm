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
