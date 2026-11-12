# 03: The plan body

**What to build:** one body component that renders `planLines(plan)` with the layout rule: at 100 columns
and above a 50-column row column and a detail column of `min(62, width − 52)`; the focused row's text opens
the detail column and its continuation lines follow in full; every other row truncates with `…`. Entries
are ordered by what happens to them (will install, already installed, not covered, error, blocked) by
sorting a copy of `plan.entries` before formatting. Requirement rows and the count line break out to full
width below the row column, so the count that `render.ts` emits last lands directly above the keybar. The
surface reads through the shared read hook, so `building the plan…`, a thrown message and `r` to rebuild all
work. `p` opens the surface read-only from the rail; `Enter` on the install form opens it from the selection.
`Esc` returns with
the selection intact.

**Blocked by:** 02

**Proves it:** run `agentenv`, `Enter`, `Enter` on a machine with a hook item in the package. The hook entry's
`write:` path and `adds hook:` JSON are readable in full on the right, the other entries stay one line each,
and the count line sits directly above the keybar. Pressing `p` from anywhere shows the same body with no
write key bound.

**Status:** done

- [x] `planLines` output is rendered unchanged; no domain sentence is rebuilt in the TUI
- [x] Rows are ordered by outcome and the order is stable across rebuilds
- [x] The focused entry's continuation lines appear in full in the detail column
- [x] The layout ships as: two columns at 100 columns and above, one column with the focused row
      wrapping under itself at 60 and above; no rendered line exceeds the frame width, asserted at 120 and 80
- [x] `p` opens the body with no confirm key bound; `Esc` returns and keeps the selection
- [x] Busy, error and `r` rebuild states are covered by headless tests

## Comments

- The body is `src/tui/plan-body.tsx` over `src/tui/plan.ts` (ordering and slicing), `src/tui/read.ts`
  (the read hook), `src/tui/window.ts` (the row window every rows surface will share) and `wrap()` in
  `src/tui/format.ts`. The shell owns the plan's read and its cursor; the key table only moves them.
- No sentence is rebuilt: `planBlocks` and `planTail` call `planLines` on narrowed copies of the plan —
  one entry at a time for the blocks, entries-without-requirements and entries-without-warnings for the
  two tails — and the count line is the formatter's own last line, never recounted. Grouping is
  `[...plan.entries].sort()` by outcome rank (run, already, not covered, error, blocked) on the entry,
  with `blockedBy` last; `sort` is stable, so a rebuild keeps the order and the plan object is untouched.
- The body renders exactly the height it is given: the requirement rows, the warnings and the count line
  are laid out first at the bottom, and the row window gets what is left. That is what makes the defect
  the design recon found impossible — the count line is always directly above the keybar, and a ten-entry
  plan no longer pushes it out of reach. A body shorter than the rows below it gives up row lines, never
  the count line. Padded lines hold one space, because an empty `Text` measures zero rows.
- The window is derived from the cursor (`index` only, no remembered offset), with a 2-row scrolloff and
  a full page at the end of the list; `PgUp`/`PgDn` page by the rows the current window shows — the body
  height minus the heading and the pinned tail, measured in rows — so a page never skips one; `g`/`G`
  jump to the ends. Rows are measured in lines, so the focused row's wrapped continuations consume the
  window in one column and are free in two.
- At 100 columns the list is 50 and the detail column is 48, not 62: the pane is `min(62, width − 52)`, so
  it is 62 from 114 columns up and shrinks with the frame below that. No line leaves the frame at 120, at
  100 or at 80. `wrap()` carries the formatter's text over as written — the CLI's double spaces survive —
  and only the focused row is ever wrapped; every other row truncates with `…`.
- `Up`/`Down`/`PgUp`/`PgDn`/`g`/`G` are `hidden` in the keybar (the copy deck's keybar has no room for
  them) and listed in the `?` overlay, so the keybar is `r rebuild · ? keys · Esc back · q quit` and no key
  exists that the overlay cannot name. `Esc` and `q` stay the global bindings, so the selection behind the
  surface is untouched, and `y`/`n` dispatch nothing because this table binds nothing that writes.
- The copy is `t.planBuilding` for the busy state and the read's own message for a failure; the TUI adds
  no domain sentence, and the header still names the surface. Requirement marks (`space`/`a`), the apply
  keys and the 59-and-below layout belong to tickets 04, 05 and 11.

