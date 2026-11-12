# 06: The status surface

**What to build:** `s` renders `statusLines(report)` as two sections with their two vocabularies (`ready`,
`too old`, `absent` for harnesses; `up-to-date`, `missing`, `unknown` for items), focusable row by row, with
the focused row printed in full in the detail column and its `update:` command in full when it has one. `r`
re-reads. The empty record renders the existing `record is empty — nothing installed yet`. The surface binds
no key that writes.

**Blocked by:** 05

**Proves it:** `s` on a machine with one too-old harness: the row reads `too old  pi  1.2.0 · min 1.4` and the
detail column carries `update: npm install -g @earendil-works/pi-coding-agent`. `r` re-reads without leaving.

**Status:** done

- [x] Both sections render with their own vocabulary and no renamed states
- [x] A too-old harness shows its minimum and its update command in full
- [x] The empty record state renders the existing sentence
- [x] No key on this surface writes; a test asserts the record and the tree are untouched after a visit
- [x] Headless tests cover the two sections, the too-old row and the empty state

## Comments

- `statusBody` (`src/tui/status.ts`) splits `statusLines(report)` into the report's warnings, the two
  headings and one block per row: a line indented by the four columns `render.ts` uses for a row's detail
  belongs to the row above it, so a too-old harness's `update:` line is that row's detail and never a row
  of its own. Every word, tone and state name comes from the formatter; the TUI only windows, pads and
  tones, so `ready`/`too old`/`absent` and `up-to-date`/`missing`/`unknown` cannot be renamed here.
- The rows frame moved out of `plan-body.tsx` into `src/tui/rows-frame.tsx`: the 50/2/62 split at 100
  columns, the truncated head, the wrapped detail, the scrolloff window and the padding. `plan-body.tsx`
  keeps only what is the plan's — its requirements, warnings and count line — and `status` shares the
  rest, so the two surfaces cannot drift on width, focus or wrapping.
- `statusLines` emits no count line, so the slot pinned above the keybar holds the report's warnings: an
  unreadable `state.json` keeps its lines while the rows give way, which is the one sentence on this
  surface that must not scroll away. Nothing is counted or invented to fill the slot.
- Focus marks only the focused row: a status row has no choice box to align with, and the 40-column
  mockup prints its rows flush left. The plan keeps the blank mark on every row because its boxes are
  what the column exists for.
- `r` is `refresh` here (the mockup's keybar) while the plan's `r` stays `rebuild`; the key table owns
  the label, so the keybar and the overlay agree without a second copy. `Up`/`Down`, `PgUp`/`PgDn`
  and `g`/`G` are hidden from the keybar and listed in `?`, and the page is the number of focusable rows
  in the current window, so paging never skips a row.
- The read runs when the surface becomes current and `r` is the same call; `s` on the result screen
  lands here and reads once. A read that has not answered prints `reading status…`, and a rejected one
  prints its message in the error tone and keeps the surface and the keybar.
- `tui-status.test.ts` holds the surface exactly: the two sections and their words, a too-old harness
  with its minimum and its whole update command in the detail column, every report row shown whole as
  the focus reaches it, the empty record's existing sentence, `r` replacing a too-old verdict without
  leaving, a damaged record's warning pinned above the keybar while twelve harnesses window, the 30-row
  item window, a failed read, and 40 columns. The read-only test snapshots the whole fixture home
  (record, lockfile, settings) around a visit that presses every key the surface has and asserts every
  command it caused was the harness's own version check.
