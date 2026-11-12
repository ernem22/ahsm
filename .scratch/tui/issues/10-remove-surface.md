# 10: The remove surface

**What to build:** `x` renders `removePlanLines(plan)`: affected harnesses, paths and the command for every
entry, before any key acts. Because removal is the destructive surface, a confirm line states what the key
does (`y remove 3 items — the record is cleared for them`). `y` applies, `n` and `Esc` decline. `a` opens the
one text input outside the filter, a skill name, which removes a skill agentenv never installed through the
same `planRemoval` call and reads the provider inventory exactly as `remove --skill` does. The result is
`removeOutcomeLines` unchanged, ending with `s status` offered as the next step. `not covered` and
`needs a name — remove by hand` stay distinct.

**Blocked by:** 09

**Proves it:** `x` on a machine with a recorded skill and a recorded hook: the plan lists
`paths: ~/.agents, ~/.agents/skills, ~/.claude/skills` and `affects: claude-code, codex (all harnesses — the
skill dirs are shared)` before `y` is pressed. Typing a name agentenv never installed removes it and writes no
record.

**Status:** done

- [x] Paths and affected harnesses are on screen before the key
- [x] The confirm line states the record consequence
- [x] A skill can be removed by name without a record, reading the inventory only when the name is new
- [x] `not covered` and `needs a name — remove by hand` stay separate words
- [x] Headless tests cover the plan, the named input, the confirm and the result

## Comments

- `src/tui/remove.ts` builds the body from `removePlanLines` alone, the way `stale.ts` and `update.ts`
  build theirs: one block per entry (its row, then `affects:`, `paths:`, `run:` and `note:`), the plan's
  warnings pinned below the rows, and the confirm sentence under them. Nothing here words a removal
  line. The confirm counts the entries `y` acts on (`action: 'remove'`) rather than every row, and when
  every one of those is a name no record covers it says `no record was made for it` instead of claiming
  a record was cleared — a sentence that would be false for `remove --skill`.
- The name mode is the second text mode and reuses the filter's slot: `filterOf('remove')` returns the
  surface's `name` `FilterKeys`, so `activeKeys` dispatches `filterModeKeys` for it and the shell's
  character collection feeds it. The mode carries its own two labels (`Esc cancel`, `Enter remove it`),
  which is the only addition to `FilterKeys`. While it is open the plan rows stay on screen and keep their
  window, the confirm line steps aside, and `Esc` is the mode's: it empties the name and leaves the plan
  untouched. With the mode closed, `Esc` is the surface's — a running read is stopped first
  (`Esc stop waiting`), then `Esc back` and `n decline` leave for `install`.
- `a` submits through `planRemoval(data, ctx, { skillNames })` — the same call `remove --skill` makes — so
  the core reads the provider inventory only for a name no record covers. The surface re-reads the plan
  only when a new name joins the list (a duplicate name is not planned again and does not read the
  inventory); the recorded plan is read once per visit and never re-read per key. A name the inventory
  does not list is still planned, with the core's note, and the provider's own remove has the last word:
  the result says `not installed` and `state.json` is never touched.
- `y` runs `applyRemovePlan`, not a second removal path, and shows `removeOutcomeLines` unchanged, so a
  failure is one row with the provider's message and the remaining entries still run. The in-flight screen
  is the shared `Busy` block; its count line is the surface's own i18n sentence. That required one
  shared-change: `WriteState` and `useWrite` are now generic in their outcome and store the surface's
  already-worded shape line instead of an `ApplyShape` object. The apply and update surfaces render
  exactly the same text as before (`t.tui.applyShape(...)` is now composed by their hooks).
- The honest empty answers are sentences, not blank frames: an empty record says `nothing recorded — a
  name removes a skill agentenv never installed`, and `y` is still in the overlay but refused with the
  same words and never advertised in the keybar (a bar does not show a key that refuses). A record whose
  rows are all `not covered`/`manual` says `nothing here can be removed — the rows say why`; it never
  claims the record is empty. `not covered` and `needs a name — remove by hand` remain two formatter
  labels with their own reasons under each row, and the test asserts both at once.
- `test/tui-remove.test.ts` drives the real app: the recorded plan with its harnesses, paths and confirm
  (and no inventory read and no write), `y` clearing exactly the records it removed and stripping the
  hook from the config, a named skill planned/refused/written with no `state.json`, the inventory read
  exactly once and not again for a duplicate name, `n`/`Esc` declining and `Esc` cancelling the name
  mode first, `not covered` versus `manual` in one plan, a partial failure that still attempts the rest,
  the shared busy screen and its refusal, the empty record, and 40 columns. `test/tui-keys.test.ts` gained
  the surface's row: `a name a skill`, `n decline`, `Esc back`, the movement keys the overlay lists and
  the keybar hides, and `y remove` in the overlay but not the keybar for the empty fixture plan.
