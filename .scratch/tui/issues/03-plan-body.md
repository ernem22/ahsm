# 03: The plan body

**What to build:** one body component that renders `planLines(plan)` with the layout rule: at 100 columns
and above a 50-column row column and a 62-column detail column; the focused row's text opens the detail
column and its continuation lines follow in full; every other row truncates with `…`. Entries are ordered by
what happens to them (will install, already installed, not covered, error, blocked) by sorting a copy of
`plan.entries` before formatting. Requirement rows and the count line break out to full width below the row
column, so the count that `render.ts` emits last lands directly above the keybar. The surface reads through
the shared read hook, so `building the plan…`, a thrown message and `r` to rebuild all work. `p` opens the
surface read-only from the rail; `Enter` on the install form opens it from the selection. `Esc` returns with
the selection intact.

**Blocked by:** 02

**Proves it:** run `agentenv`, `Enter`, `Enter` on a machine with a hook item in the package. The hook entry's
`write:` path and `adds hook:` JSON are readable in full on the right, the other entries stay one line each,
and the count line sits directly above the keybar. Pressing `p` from anywhere shows the same body with no
write key bound.

**Status:** ready-for-agent

- [ ] `planLines` output is rendered unchanged; no domain sentence is rebuilt in the TUI
- [ ] Rows are ordered by outcome and the order is stable across rebuilds
- [ ] The focused entry's continuation lines appear in full in the detail column
- [ ] The layout ships as: two columns at 100 columns and above, one column with the focused row
      wrapping under itself at 60 and above; no rendered line exceeds the frame width, asserted at 120 and 80
- [ ] `p` opens the body with no confirm key bound; `Esc` returns and keeps the selection
- [ ] Busy, error and `r` rebuild states are covered by headless tests
