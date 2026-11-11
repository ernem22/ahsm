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

**Status:** ready-for-agent

- [ ] 103 rows render without wrapping and only the visible slice is mounted
- [ ] The heading carries the window and the filter; both update as they change
- [ ] `/` filters, `Esc` clears, and the matched count is stated
- [ ] The busy read is named, timed and cancellable, and the cancelled copy is the specified one
- [ ] A headless test asserts a 177-column row truncates in the row column and appears whole in the detail
      column
