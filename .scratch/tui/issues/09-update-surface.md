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

**Status:** done

- [x] The plan holds only stale skills, narrowed per skill, through the same install path
- [x] Skips and warnings print before the plan and survive into the result
- [x] `y`, `n` and `Esc` behave as on `apply`, and the busy state is the shared one
- [x] Headless tests assert the plan's entries for a fixture with one stale and one unknown skill

## Comments

- `src/tui/update.ts` builds the body from `updateLines` alone, the way `stale.ts` builds its rows from
  `staleLines`: the warnings and skips are that function's first lines, the heading is its `UPDATE` line,
  every entry block is `planLines` narrowed to one entry, and the tail is everything it pins under them
  (requirements, plan warnings, the action count) plus its own `N stale skill(s) — M installation(s)
  planned`. Nothing here words an update line or drops one: a stale skill with no catalogue item or no
  record reaches the screen as the core's skip line, before the heading and again before the result's
  installs. The rows are mounted on the shared `rows-frame`, so the focused row wraps whole and the
  window is the one every other rows surface uses.
- Narrowing is the core's, not the TUI's: `buildUpdatePlan` already turns each stale row into the plan's
  own entry (`planLines` prints `skill-a` for a named item and `skill-all/alpha` for a source-level one)
  and forces `action: 'run'`, because "already installed" is exactly what a stale skill looks like to the
  plan. `y` hands that same plan to `applyPlan` with no marks, exactly as `agentenv update --yes` does, so
  the install path, the provider and the record are the CLI's.
- `unknown` and `up-to-date` never become plan rows: `buildUpdatePlan` narrows to `value === 'stale'`, and
  this surface prints only what the plan formatter wrote. An unreachable source therefore answers
  `no stale skill — nothing to update` rather than being guessed at as stale, which is the honest answer
  the ticket asks for; the source's own reason belongs to `v`, where the row lives.
- The write is the apply surface's, extracted rather than copied: `use-write.ts` owns the in-flight
  refusal, the result and the reset for both confirm surfaces, `use-apply.ts` keeps only the marked
  requirement ids, and `apply-body.tsx` now exports `Busy`, `Result` (over a line list) and `Failed`.
  `useUpdateSurface` is the per-surface hook beside its module; it owns the read, the window and the
  write, and the shell owns the one thing a surface cannot know — where `u` was opened from. `Esc` and `n`
  decline to that origin (the stale surface from `u`, install from the rail) and the surface's own
  `Esc` binding comes before the global one, so the keybar's `Esc back` is the binding that dispatches.
  The busy line, the elapsed seconds, the shape counted from the plan, `nothing else runs until this
  finishes` and the refusal are the apply surface's own components; the skips stay printed above them.
- The result keeps the warnings `updateOutcomeLines` does not repeat (it starts at the skips) by prefixing
  `updateLines`' warning lines, then the core's skip + outcome rows. `v` on the result opens `stale`
  again, which is the question the write just changed the answer to; the key is the mockup's `stale
  again`.
- `test/tui-update.test.ts` drives a real app against the offline data root, an in-memory provider check
  and a lockfile-writing install runner: the two-entry plan over a four-stale fixture (one `unknown`,
  one `up-to-date`, a no-item and a no-record skip), the skips before the heading, `y` installing and
  recording only `alpha`/`beta`, a partial failure with one `installed` and one `error` row that keeps the
  skip line, `n`/`Esc` declining without a call from both origins, the four honest answers, the shared
  busy screen and its refusal, the result's `v stale again`, the keybar's own words, and 40 columns.
  `test/tui-keys.test.ts` gained the surface's row in its table: `y apply`, `n decline`, the movement keys
  the overlay lists and the keybar hides, and `Esc back` as the binding that dispatches.
