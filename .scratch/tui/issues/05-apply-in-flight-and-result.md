# 05: Apply in flight and the result

**What to build:** the half of `apply` that a user watches. While `applyPlan` runs, the body shows
`applying…` with real elapsed seconds, the shape of the work (`2 installs · 1 hook write · 0 blocked`,
counted from the plan), and one line saying nothing else runs until it finishes. No spinner, no progress bar,
no percentage. During the write every key that would leave returns the refusal instead of acting, and the
status line carries `q and Esc are disabled until it finishes`. On completion the body is the result: every
entry in its own word from `outcomeLines`, one line each, plus any requirement failure, with no aggregate
verdict. `Enter` exits, `s` opens `status`, `Esc` returns to the form with the selection intact.

**Blocked by:** 04

**Proves it:** run the full journey against the offline fixture root: `agentenv`, `Enter`, `Enter`, `y`. The
screen counts up through a slow apply, `q` does nothing until it finishes, and the result reports `installed`,
`already installed`, `not covered` and `error` rows side by side.

**Status:** done

- [x] The in-flight body shows real elapsed seconds and the plan's shape
- [x] No spinner, progress bar or percentage appears in any frame
- [x] `q` and `Esc` are refused during the write and the refusal is on screen
- [x] The result prints `outcomeLines` unchanged, and a partial failure stays a set of rows
- [x] `s`, `Enter` and `Esc` behave as specified on the result screen
- [x] Headless tests cover the refusal, the result rows, and the `s` jump

## Comments

- The write is one state machine (`src/tui/apply.ts`): `idle` → `applying` (start second + the shape counted
  from the plan) → `done` (the outcome the core returned) or `error` (the message it threw). Writes get no
  cancel token, so there is no `stopped`: the only honest end is the result.
- Elapsed seconds come from `Date.now()` at the moment `y` ran and a one-second interval in the busy body.
  Nothing is animated between ticks and nothing is invented: the number is the wall clock's. The headless
  test does not assume a duration — it waits for the tick and asserts the pattern, so it is deterministic in
  what it asserts and not in how long it takes.
- Refusal is a column of the key table, not a branch in the shell: `refuses?(host)` returns the sentence a
  key would say instead of acting. `q`, `Esc`, the rail letters, `y` and `n` carry it while a write is in
  flight; the shell says the sentence on the status strip in the warning tone, and the keybar drops the
  entries that would refuse rather than advertising keys that do nothing. `space`, `a` and the rows keys are
  filtered out with `when: notWhileWriting` — the body is the busy block, so they would act on nothing.
- The refusal is exactly 40 columns, so at 40 it fits whole; a narrower frame wraps it. The status strip is
  measured in `bodyHeight` (`statusLines(status, width).length`), so a wrapped status line takes its lines
  from the body, never from the keybar.
- The result prints `outcomeLines(outcome)` and nothing else: no heading of its own beyond `result`, no
  aggregate verdict, no count. The mockup's dim `the record holds what succeeded — s shows it` was dropped —
  recording can be disabled (unreadable `state.json`), so that sentence would claim more than the core
  reported. A result taller than the window keeps the rows that fit and counts the rest (`… N more rows`)
  rather than pushing the keybar off the frame.
- Keys on the result: `Enter` exits, `s` opens `status`, `Esc` goes back to the install form with the
  selection intact (`Esc` on the confirm still declines to the plan), `n` returns to the plan and `r` reads it
  again after the write so its rows show what is now true.
- `tui-apply.test.ts` holds the offline root still: a gated runner holds the skill install open so the busy
  screen is read and `q`/`Esc` are pressed against it, a second root adds a harness no provider lists so the
  result carries `installed`, `already installed`, `not covered` and `error` rows side by side, and a third
  run makes both requirements fail so the requirement rows and the blocked items are asserted.
