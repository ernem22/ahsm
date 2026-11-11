# 09: The update surface

**What to build:** `u` renders `updateLines(update)` on the plan body: the skips and warnings first, in the
words the core already produces, then the plan for exactly the stale skills, narrowed to each skill, then the
count. `y` applies it through the same `applyPlan` the CLI calls; `n` and `Esc` decline. The in-flight and
result states reuse the apply surface's busy and result components, with the skips still printed before the
installs. An `unknown` or `up-to-date` skill never appears in the plan.

**Blocked by:** 08

**Proves it:** `v` then `u`: the plan holds only the two stale skills across the harnesses the record names.
A stale skill that matches no catalogue item is printed as a skip before the plan, never dropped. `y` then
installs those and only those, and the result keeps the skip line.

**Status:** ready-for-agent

- [ ] The plan holds only stale skills, narrowed per skill, through the same install path
- [ ] Skips and warnings print before the plan and survive into the result
- [ ] `y`, `n` and `Esc` behave as on `apply`, and the busy state is the shared one
- [ ] Headless tests assert the plan's entries for a fixture with one stale and one unknown skill
