# 08: The stale surface

**What to build:** `v` renders `staleLines(report)`: `stale`, `up-to-date` and `unknown` rows with the
provider's own reason attached to each, so `unknown` is never folded into `up-to-date`. When the provider
offers no update check the surface states `not covered — no provider offers an update check` instead of
listing rows. The read is slow and cancellable like the inventory. `f` cycles the state filter, `/` filters by
name, and `u` jumps to the update surface. The trailer stays as the last full-width line.

**Blocked by:** 07

**Proves it:** `v` on a machine with stale skills and one unreachable source: two `stale` rows, an
`unknown` row carrying `could not be reached — verification unknown`, and `u update these 2` on the keybar.
On a machine whose provider has no `check` argv, the surface says `not covered` and nothing else.

**Status:** done

- [x] The three states render with their reasons and are never merged
- [x] The not-covered state renders the existing sentence and lists no rows
- [x] The read is cancellable and the cancelled copy is the specified one
- [x] `f` and `/` narrow the set and the heading states the count
- [x] Headless tests cover the three states, the not-covered answer and the cancel

## Comments

- `src/tui/stale.ts` builds the body from `staleLines` alone, exactly as `list.ts` builds the inventory from
  `listLines`: the heading is the formatter's own line (it sits below the warnings `staleLines` prints
  first), every row is `staleLines({ covered: true, rows: [row], warnings: [] })[1]`, and the trailer is the
  formatter's last line (`N skill(s) — verification only, nothing was installed`). Nothing here words a
  verdict, a source or a reason.
- The three states are never merged because a row is only ever a whole formatter line: the block the window
  moves over is that line, its tone included. The TUI does not re-tone either, so `unknown` differs from
  `up-to-date` in the two ways the spec allows — the state word that leads the row, and the provider's own
  reason after the source (`could not be reached — verification unknown`, `the provider update check did
  not finish — verification unknown`, `the lockfile records no folder hash for it — nothing to compare`).
  Colour is never the carrier, so a 16-colour or `NO_COLOR` terminal loses nothing; the focused row is
  printed whole in the detail column, so the reason survives even a 40-column frame.
- Not covered and an empty lockfile are full answers, not lists: the sentence is the line directly under the
  heading and there are no rows to move over. `staleLines` returns no count line for either, so the surface
  does not invent one, and the not-covered answer runs no command at all (asserted on the recording
  runner).
- `Esc` is now the rows surface's one precedence, stated once in `spec.md`: stop the running read → clear
  the text/state filter → leave the surface. The key table implements it as three `escape` bindings whose
  `when`s are checked in that order, so the keybar always names the step it will take (`Esc stop waiting`,
  `Esc clear filter`, `Esc back`). `frameKeys` keeps one entry per key per frame, which is what stops two
  `escape` bindings from being listed at once — the list surface had that double listing, and it is gone
  with the same change.
- The chrome the two rows surfaces share is one set of words in `i18n.ts`: `windowCount`, `windowEmpty`,
  `filterNone`, `filterText`, `matchCount`, `stoppedWaiting`, and `reading(what, seconds, count)` over the
  two names `inventory` and `provider update check`. The list-only words (`listCarriers`, `listNoCarriers`)
  stayed list-only, and the state filter added one: `state: stale`. `/` is called `search` on this surface
  because `f` is the filter there — the mockups' own two words.
- `u` opens the update surface from any stale row, and the keybar names it. Ticket 09 owns that surface, so
  today it lands on the entry that still prints only its own name (`update`); the key is wired, the plan is
  not. The keybar says `u update`, not the mockup's `u update these 2`: a label is a static string in the
  key table and the count the mockup shows is already the formatter's trailer, so a count on the label
  would be a second count that `f` could make wrong.
- The read reuses `useRead` and `elapsed.ts` unchanged: it runs when the surface becomes current, `r` runs
  it again, the busy line is `reading the provider update check… 4s` (with the previous count once a read
  knew it), and `Esc` flips it to the stopped copy while the token discards the answer. A rejected read
  prints the core's own message in the error tone and keeps the surface.
- `test/tui-stale.test.ts` holds the three states with their reasons, `unknown` never printed as
  `up-to-date`, the not-covered answer with no rows and no command, an empty lockfile, the named/timed read
  and its cancel, `f`'s cycle and the heading's state filter, `/` narrowing with `Esc` clearing before it
  leaves, `u` reaching the update surface, a read-only visit with the single recorded command, the keybar
  and the overlay naming each key once, and 40 columns.
