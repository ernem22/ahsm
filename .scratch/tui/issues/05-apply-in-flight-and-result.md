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

**Status:** ready-for-agent

- [ ] The in-flight body shows real elapsed seconds and the plan's shape
- [ ] No spinner, progress bar or percentage appears in any frame
- [ ] `q` and `Esc` are refused during the write and the refusal is on screen
- [ ] The result prints `outcomeLines` unchanged, and a partial failure stays a set of rows
- [ ] `s`, `Enter` and `Esc` behave as specified on the result screen
- [ ] Headless tests cover the refusal, the result rows, and the `s` jump
