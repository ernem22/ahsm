# 04: Requirement marks and the confirmation

**What to build:** the `apply` surface becomes the plan body plus one key. `space` on a focused requirement
row marks only that requirement's update, `a` marks every requirement, and the mark is stated in the detail
column with the existing `updates marked — applying runs them` and `updates not marked — items that need them
stay blocked` copy. `y` runs only what is marked, through the same `applyPlan(data, ctx, plan, { updates })`
the CLI calls; `n` and `Esc` decline and keep the selection. Items that depend on an unmarked requirement stay
blocked in the plan and in the result.

**Blocked by:** 03

**Proves it:** with a too-old harness in the plan, press `space` on its requirement row: only that update is
marked and the detail column says so. Press `y`: the runner receives exactly the marked requirement ids.
Press `n` on a second run and nothing runs.

**Status:** done

- [x] `space` marks one requirement, `a` marks all, and the marks are visible without colour
- [x] The `updates` list the core receives equals the marked requirement ids
- [x] Declining runs nothing and keeps the selection
- [x] A headless test asserts the ids handed to the core for one mark, for all marks, and for none

## Comments

- The plan surface is the review: `space`/`a` mark requirement updates, `Enter` opens the `apply` surface
  — the same body, the same marks, plus `y`. `p` from the rail still opens the plan read-only in the sense
  that it binds no writer; `Enter` is navigation, not a write.
- A requirement row is focusable: `Down` past the last entry walks the requirement rows, `Up` walks back.
  Only a `too old` requirement with an install command is markable; `ready` has nothing to run and an
  `absent` one is bootstrapped either way, so neither gets a box.
- The mark is a `[x]`/`[ ]` box in front of the requirement row (visible at every width and in `NO_COLOR`)
  and the existing `updates marked — applying runs them` / `updates not marked — items that need them stay
  blocked` statement in the focused row's detail and once above the count line. The count line the
  formatter emits last still sits directly above the keybar.
- `y` filters the marks to the requirements the current plan offers and calls
  `applyPlan(data, ctx, plan, { updates })`; with no marks it passes no options at all, so the core's
  "nothing marked" path is the one that runs. `n` and `Esc` go back to the plan without calling the core;
  the install selection and the marks survive.
- `test/tui-apply.test.ts` drives the offline root with one entry and two too-old requirements whose
  update commands differ, so one mark, all marks and no marks are told apart by the argv the runner
  receives. The busy/result halves of the apply surface belong to ticket 05.
