# 02: The install form

**What to build:** the home surface becomes one screen with three sections, one focused at a time:
`harnesses`, `package`, `items`. `space` toggles the focused row, `a` toggles all rows in the section,
`Enter` moves focus one section forward, `Esc` moves it one section back without losing a choice. Sections
that are not focused fold to a one-line summary that states what was chosen (`2 of 4 chosen`,
`base · 3 items`), so the screen always answers where the user is. The header's target line names the chosen
harnesses, or `no installed harness found`. A harness that is not detected stays listed and chooseable and
carries `not detected`. `Enter` with nothing chosen keeps the stage and prints
`nothing chosen — space to choose a harness` on the status line. The focused item row shows its `kind` and
its `source`, `url` or hook event.

**Blocked by:** 01

**Proves it:** run `agentenv`, press `space` on a harness, then `Enter`, `space`, `Enter`. The target line,
the folded summaries and `3 of 3 chosen` all follow the choices, and `Esc` walks back one section at a time.

**Status:** ready-for-agent

- [ ] The three sections render with exactly one focused, and unfocused sections fold to a summary
- [ ] `space`, `a`, `Enter` and `Esc` behave as above in all three sections
- [ ] A harness that is not detected is listed, chooseable, and marked `not detected`
- [ ] `Enter` with nothing chosen advances nothing and states why on the status line
- [ ] The focused item row carries its kind and its source, url or hook event
- [ ] Headless tests cover the fold, the nothing-chosen hint, and the back-navigation with a kept selection
