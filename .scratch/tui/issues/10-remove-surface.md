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

**Status:** ready-for-agent

- [ ] Paths and affected harnesses are on screen before the key
- [ ] The confirm line states the record consequence
- [ ] A skill can be removed by name without a record, reading the inventory only when the name is new
- [ ] `not covered` and `needs a name — remove by hand` stay separate words
- [ ] Headless tests cover the plan, the named input, the confirm and the result
