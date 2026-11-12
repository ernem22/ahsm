# 07: The list surface, its window and its filter

**What to build:** `l` renders `listLines(report)` as one row per skill in a windowed column. The surface's
heading line carries the window and the filter right-aligned (`1–12 of 103 · filter: none`), the focused row
is printed in full in the detail column, and every other row truncates with `…`. Only the visible slice is
rendered, with a 2-row scrolloff; `↑`/`↓`, `k`/`j`, `PgUp`/`PgDn`, `g`/`G` move. `/` filters by substring and
the heading states how many skills matched (`3 of 103 skill(s) match the filter`); `f` cycles the carrier
filter. The read is the slow one, so the body shows `reading the provider inventory…` with elapsed seconds and
the count once known, and `Esc` stops waiting with `stopped waiting — the check may still be running; nothing
was written`. The trailer `render.ts` emits stays as the last full-width line.

**Blocked by:** 06

**Proves it:** `l` on a machine with 103 skills: rows do not wrap, the window line counts up as you page, `/`
plus a substring narrows to a handful, and `Esc` in the filter clears it. `Esc` during the read shows the
stopped copy and leaves the previous surface reachable.

**Status:** done

- [x] 103 rows render without wrapping and only the visible slice is mounted
- [x] The heading carries the window and the filter; both update as they change
- [x] `/` filters, `Esc` clears, and the matched count is stated
- [x] The busy read is named, timed and cancellable, and the cancelled copy is the specified one
- [x] A headless test asserts a 177-column row truncates in the row column and appears whole in the detail
      column

## Comments

- `src/tui/list.ts` builds the body from `listLines` alone: the heading is the formatter's first line, the
  trailer its last (`103 skill(s) — inventory read only, nothing written`), and every row is
  `listLines({ rows: [row] })[1]`, so name, scope, source and carriers are never re-worded here. The
  filter keeps or drops those whole rows; it never builds one.
- The filter matches the rendered row text case-insensitively, so a source substring
  (`emilkowalski/skills`) finds skills whose names do not contain it. `f` is the positive carrier filter —
  keep the skills one of the harnesses chosen on `install` reports — and it refuses, on the status line,
  when the selection is empty, because an empty selection carries nothing. Both narrow at once (AND);
  the heading states the window, `filter: <text>` and `carriers: <ids>`, and the pinned line under the
  rows states `N of M skill(s) match the filter` whenever either is on, so a filter never looks like a
  smaller inventory.
- `Esc` is one key with a precedence, and the keybar always names the step it will take: while the slow
  read is in flight it stops waiting (`Esc stop waiting`), then while a filter is set it clears it
  (`Esc clear filter`), then it leaves for `install` (`Esc back`) — which is also what the second `Esc`
  after a stopped read does. In the filter's own text mode `Esc` clears and leaves the mode; `Enter`
  keeps the text and leaves the mode.
- The filter is a mode of the key table, not a branch beside it: `filterKeys` holds the two keys that
  end the mode, and `activeKeys` returns it while typing, so the keybar cannot advertise the rail
  letters while a letter is text. Letters the table does not claim are collected by the shell; that is
  the only input path outside a table, and it is bounded to one text mode.
- The read hook gained `startedAt` and a `stopped` state, and a reload keeps the last value so the busy
  line can count what a previous read knew: `reading the provider inventory… 4s` becomes `… 4s, 103
  skills`. `Esc` on a busy read flips it to `stopped` and the token discards the answer when it arrives;
  the copy is the ticket's `stopped waiting — the check may still be running; nothing was written`.
  `src/tui/elapsed.ts` is the one one-second interval, shared with the apply block.
- The heading line is `t.skillsTitle` on the left and the window/filter right-aligned, longest variant
  first, so 40 columns keeps `1–23 of 103` and drops the filter words rather than the window. The mockup's
  en dash is kept, which widens `spec.md`'s non-ASCII list by one glyph (`…`, `→`, `–`).
- `r` is `refresh` (the mockup's keybar) and the read runs when the surface becomes current, as `status`
  does; a rejected read prints the provider's own message in the error tone and keeps the surface.
  `test/tui-list.test.ts` holds 103 rows with only the slice mounted, the page, `/` narrowing and
  `Esc`-clear-then-leave, `f` and its refusal, the 177-column row, the busy/stopped read, an empty and a
  failing inventory, a read-only visit, and 40 columns.
- The shared headless fixture now answers `skills.list()` from memory: the inventory is the one read that
  leaves the machine, so entering `l` in any shell test no longer waits on the real lockfile. The
  shell's "every letter and Esc" test presses `Esc` twice when a surface's read is still in flight, which
  is the behaviour the ticket asks for rather than a workaround.
