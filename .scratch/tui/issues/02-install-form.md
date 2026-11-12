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

**Status:** done

- [x] The three sections render with exactly one focused, and unfocused sections fold to a summary
- [x] `space`, `a`, `Enter` and `Esc` behave as above in all three sections
- [x] A harness that is not detected is listed, chooseable, and marked `not detected`
- [x] `Enter` with nothing chosen advances nothing and states why on the status line
- [x] The focused item row carries its kind and its source, url or hook event
- [x] Headless tests cover the fold, the nothing-chosen hint, and the back-navigation with a kept selection

## Comments

- The form state is `InstallForm` in `src/tui/install.ts`: the rows it resolved once (harnesses from
  `detectHarnesses`, packages from `packages/*.yaml`) plus the stage, the cursors and the chosen ids. It
  is created by `initialForm`, which asks `resolveSelection` for the CLI's own default selection, so the
  window opens on the default package and the detected harnesses and cannot disagree with `agentenv plan`
  with no flags.
- The state lives in the shell, not in the component, which is what makes `Esc` keep every choice: leaving
  `install` for `plan` and coming back reopens the section the user left.
- `Enter` on the items section opens the plan surface. That is the flow's next stage, and the plan's body
  is ticket 03; the key does not dead-end meanwhile.
- The package section is a single choice, so `space` selects the focused package (and re-derives its items,
  which come pre-chosen as the CLI's selection does) and `a` is inactive there rather than meaning nothing.
- `Up`/`Down` move the cursor inside the focused section. They are `hidden` in the keybar (the copy deck's
  keybar has no room for them) and listed in the `?` overlay, so no key exists that the overlay cannot name.
- `Esc` on the harnesses section is not listed: there is nothing behind it. On the other two it walks back
  one section, and the overlay's own `Esc close` wins while the overlay is open.
- While the overlay is open the keybar now prints only the overlay's own live keys (`Esc close · q quit`).
  With keys on a surface at last, the old `frameKeys` keybar listed `space choose` during the overlay, where
  `space` dispatches nothing; the overlay still lists the surface's keys, which is what it is for.
- The row renderer is `src/tui/install-surface.tsx` over `src/tui/format.ts` (`truncate`, `pad`,
  `fitSegments`), which cuts a line at the frame width with `…` and keeps every line inside it. Below 60
  columns a row's detail moves to its own indented line, the way the 40-column mockup draws it.
- Copy: `t.tui` gained `sections`, `chosenOf`, `packageSummary`, `notDetected`, `nothingChosenHarness`,
  `nothingChosenItem`, the `source:`/`url:`/`package:`/`link:` labels and `ellipsis`; the note label is the
  existing `t.notePrefix`, so the TUI and the plan call a note a note. The mockup's `— Enter to change`
  suffix is not printed: `Enter` only ever moves forward, so the suffix would promise a key that does not
  do what it says.
- `Enter review` is not used either: the copy deck's word for the items step belongs to the plan surface
  (ticket 03), so every forward step says `Enter next` until that screen has its own keys.
