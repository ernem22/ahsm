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

**Status:** ready-for-agent

- [ ] `space` marks one requirement, `a` marks all, and the marks are visible without colour
- [ ] The `updates` list the core receives equals the marked requirement ids
- [ ] Declining runs nothing and keeps the selection
- [ ] A headless test asserts the ids handed to the core for one mark, for all marks, and for none
