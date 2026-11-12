/**
 * The row window every rows surface shares: focus follows the cursor, `PgUp`/`PgDn` page it and
 * `g`/`G` jump to the ends. The view is derived from the cursor, so a rebuilt list can never leave
 * the window pointing past its end.
 */
export const SCROLLOFF = 2;

/** Where the focus is. The view around it is computed, never remembered. */
export interface RowWindow {
  index: number;
}

export interface WindowView {
  /** First row in view. */
  start: number;
  /** One past the last row in view. */
  end: number;
}

export function emptyWindow(): RowWindow {
  return { index: 0 };
}

/** The focused row kept inside the list; an empty list has nowhere to point. */
export function goTo(index: number, count: number): RowWindow {
  if (count === 0) return emptyWindow();
  return { index: Math.min(Math.max(index, 0), count - 1) };
}

export function moveBy(window: RowWindow, count: number, delta: number): RowWindow {
  return goTo(window.index + delta, count);
}

/**
 * The rows to print. `heights` is how many lines each row takes — one, plus the continuation lines of
 * a row that wraps under itself — so the focused row is always inside the view, with up to `SCROLLOFF`
 * rows of context above it and the rest of the height filled below.
 */
export function rowsInView(window: RowWindow, heights: number[], height: number): WindowView {
  const count = heights.length;
  if (count === 0) return { start: 0, end: 0 };
  const index = goTo(window.index, count).index;
  const budget = Math.max(1, height);
  const heightAt = (at: number): number => heights[at] ?? 1;

  let start = index;
  let used = heightAt(index);
  for (let above = 0; start > 0 && above < SCROLLOFF && used + heightAt(start - 1) <= budget; above += 1) {
    start -= 1;
    used += heightAt(start);
  }
  let end = index + 1;
  while (end < count && used + heightAt(end) <= budget) {
    used += heightAt(end);
    end += 1;
  }
  // At the end of the list the rest of the budget belongs above, so the last page is a full one.
  while (end === count && start > 0 && used + heightAt(start - 1) <= budget) {
    start -= 1;
    used += heightAt(start);
  }
  return { start, end };
}
