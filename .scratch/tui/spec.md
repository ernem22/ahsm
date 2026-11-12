# agentenv TUI

Status: ready-for-agent

Design artifacts: mockups at `.thinkrail/context/mockups/index.html` (copy deck), product record at
`.thinkrail/context/TASK-tui-design.md`. Design only: this spec changes no source file.

## Problem Statement

`agentenv` answers seven questions: what would install (`plan`), do it (`apply`), what is here
(`status`), what does the provider inventory hold (`list`), what does the source serve differently now
(`stale`), reinstall those (`update`), remove what was installed (`remove`). All seven are one-shot
commands with flags, and three of them print more than a terminal can hold.

Today's interactive surface covers one of the seven. It is a four-stage wizard with no way back from the
package stage, no scroll, no cancel, and no stated reason when `Enter` does nothing. Its plan stage is
where the design fails hardest: at 80 columns the `write:` path and the `adds hook:` JSON wrap mid-token,
and a ten-entry plan is taller than a 24-row window, so the requirement rows and the count line below the
fold cannot be reached at all. The one screen a user must understand before approving a write is the one
screen they cannot read.

`list` is worse in a quieter way: 103 rows, widest 177 columns. At 80 columns each row becomes two or
three lines, so the inventory is 200+ lines with no filter, no focus and no way to see one row whole.

So the second surface has five problems to solve, none of which is a new feature:

1. Seven answers are reachable only by remembering flags.
2. Long output has no window, no focus and no truncation discipline.
3. A write is approved without the writes being readable.
4. The slow reads (inventory ~7 s, provider check, apply up to ~20 s) are invisible or throwaway.
5. Nothing tells the user which state they are looking at, in words, when colour is gone.

## Solution

One window with nine surfaces: `install` (the home surface), `plan` (read-only), `apply` (the confirm
step reached with `Enter` from the plan — `y` is the only key there that writes), `status`, `list`,
`stale`, `update`, `remove`, and a help overlay generated from the keymaps.
A persistent header names the surface and the target, a command rail lists the seven commands with their
letters, a keybar sits pinned at the bottom, and a status line appears only when there is something true to
say.

Every surface is one focus, one row per line, one window, and one rule for length: the focused row shows
its full text, everything else truncates with `…`. A rows surface 100 columns wide or wider splits into a
50-column list and a detail column of `min(62, width − 52)`, so the exact `write:` path and `adds hook:`
JSON of the row you are looking at are always fully visible. Copy comes from `render.ts` unchanged, so the
TUI and the CLI never drift; the TUI adds chrome only.

The TUI starts on `install` and reaches the commands by letter, not by argument; `apply` is reached by
`Enter` from `plan` rather than by a rail letter, so the rail stays the seven commands the CLI has. The
CLI keeps its behaviour and its flags exactly as they are. Slow reads are named, counted when the count is known, timed
with real elapsed seconds, and cancellable. Writes are not cancellable, and the refusal says so.

## User Stories

1. As a user on a new machine, I want `agentenv` to open on the harnesses it can talk to, so that I start
   from what is here instead of a command index.
2. As a user on a new machine, I want the harness stage to say `nothing chosen — space to choose a
   harness` instead of ignoring `Enter`, so that a dead key never looks like a bug.
3. As a user, I want a harness that is not detected to stay listed and chooseable, so that installing it is
   one space away instead of a different command.
4. As a user, I want the target line to name the harnesses I chose, so that I can check the target without
   scrolling back.
5. As a user, I want the package and the items I already chose to stay on screen as folded summaries while
   I work on another section, so that the screen always answers where I am.
6. As a user, I want `Enter` to move one section forward and `Esc` to move one section back, so that the
   flow has one predictable direction and one predictable undo.
7. As a user, I want every section to show how many of its rows are chosen, so that I can see the shape of
   the installation before I review it.
8. As a user, I want the focused item's `kind` and its source, url or hook event on the row, so that two
   items of the same kind are told apart without opening anything.
9. As a user, I want `space` to toggle the focused row and `a` to toggle all of them, so that a package
   with 12 items is one key and a package with one exception is two.
10. As a user, I want `Enter` to open the plan in the same window, replacing the form in place, so that I
    do not lose the selection in order to read it.
11. As a user, I want the plan ordered by what happens to each entry, so that I read the installs first and
    the failures last.
12. As a user, I want the exact `write:` path and `adds hook:` JSON of the focused entry in full, so that I
    understand the write before approving it.
13. As a user, I want every other row shortened with `…` rather than wrapped, so that a 200-character hook
    never turns one entry into four lines.
14. As a user, I want the plan's count line directly above the key that runs it, so that the promise and
    the action sit together.
15. As a user, I want `y` to run the plan and `n` or `Esc` to go back with the selection intact, so that
    declining costs nothing.
16. As a user, I want a blocked entry to keep its requirement's name and offer its update command, so that
    the fix is on the same screen as the blocker.
17. As a user, I want `space` on a requirement row to mark only that requirement's update, so that I can
    accept one update and refuse another in the same run.
18. As a user, I want `a` to mark every requirement update at once, so that the common case is one key.
19. As a user, I want a marked requirement to say `marked — applying runs this update` in its detail, so
    that the mark is not only a colour.
20. As a user, I want items that need an unmarked requirement to stay blocked, so that the plan never
    upgrades a tool I did not mark.
21. As a user, I want the applying screen to show real elapsed seconds, so that I can tell a slow provider
    from a hung one.
22. As a user, I want the applying screen to show the shape of the work (`2 installs · 1 hook write · 0
    blocked`), so that I know what is being attempted.
23. As a user, I want no progress bar, so that the interface does not invent a percentage it cannot know.
24. As a user, I want `q` and `Esc` refused while a write runs, and the refusal stated, so that I never
    abandon a half-written tree without its result.
25. As a user, I want the result screen to report every entry in its own word (`installed`, `already
    installed`, `not covered`, `error`), so that a partial failure is legible instead of aggregated.
26. As a user, I want `s` on the result screen to jump to `status`, so that the follow-up question is one
    key away.
27. As a user, I want `Enter` on the result screen to exit, so that the common end is one key.
28. As a user, I want `Esc` on the result screen to go back instead of out, so that a second harness is one
    space away.
29. As a user keeping a machine current, I want the first screen to already show the review when every
    harness is detected, so that the fast path has no empty stages.
30. As a user keeping a machine current, I want the plan to finish fast, so that checking the state of a
    machine never waits on the provider's inventory or its network check.
31. As a user, I want `stale` reachable by its own key, so that the slow read is a named choice, not a
    hidden pause inside `plan`.
32. As a user, I want the busy line to name the work and the count (`reading the provider inventory… 4s,
    103 skills`), so that the wait is explained while it happens.
33. As a user, I want `Esc` during a read to stop waiting and say `stopped waiting — the check may still be
    running; nothing was written`, so that the escape is honest about what it did.
34. As a user, I want `stale` to keep `stale`, `up-to-date` and `unknown` apart, so that a comparison that
    never happened is never shown as good news.
35. As a user, I want each `unknown` row to carry the provider's own reason, so that I know whether the
    source was unreachable or the record had no hash.
36. As a user, I want `not covered — no provider offers an update check` as a full answer, so that a
    missing provider is stated once instead of row by row.
37. As a user, I want `u` on `stale` to open the update plan for exactly those skills, so that nothing else
    is touched.
38. As a user, I want the update plan to say what it skipped and why before the plan, so that a stale skill
    that matches no item is not silently dropped.
39. As a user, I want `list` to show one skill per row with a window count, so that 103 skills are a list
    rather than 200 wrapped lines.
40. As a user, I want `/` to filter the inventory by substring, so that finding one skill does not mean
    scanning 103 rows.
41. As a user, I want `f` to narrow the inventory to the skills a chosen harness does not report, so that
    the question `what is missing here?` has a key.
42. As a user, I want the filter to say how many skills matched (`3 of 103 skill(s) match the filter`), so
    that a filter never looks like a smaller inventory.
43. As a user, I want the shell to start on `install` and reach every other surface by letter, so that the
    CLI's flags and output stay untouched.
44. As a user, I want the rail of seven commands visible at 100 columns and above, so that the commands are
    discoverable without the help overlay.
45. As a user at 40 columns, I want the rail gone and the keys still working, so that width never changes
    what I can do.
46. As a user, I want a help overlay listing every key of the current surface, so that one screen answers
    `what can I press?`.
47. As a user, I want the help overlay generated from the same table that dispatches the keys, so that it
    cannot list a key that does nothing.
48. As a user, I want `remove` to show the affected harnesses and paths before the key, so that a shared
    skill directory is never a surprise.
49. As a user, I want `remove` to say how many items and what happens to the record (`y remove 3 items —
    the record is cleared for them`), so that the destructive key is the informed one.
50. As a user, I want to remove a skill by name that agentenv never installed, so that the TUI covers
    `remove --skill` without a flag.
51. As a user in a 16-colour or `NO_COLOR` terminal, I want every row to start with its state word, so that
    stripping colour loses no information.
52. As a user, I want focus marked with `>` and inverse video rather than a colour, so that focus survives
    a monochrome terminal.
53. As a user on Windows, I want ASCII marks only, so that a legacy console code page cannot turn a marker
    into mojibake.
54. As a user, I want `r` to re-read the current surface, so that a second look costs one key.
55. As a user, I want an unreadable `state.json` to be a warning above the keybar, never a crashed screen,
    so that the record's damage is reported the way the CLI reports it.
56. As a maintainer, I want every domain sentence to come from `render.ts`, so that the CLI and the TUI
    cannot drift.
57. As a maintainer, I want every string the TUI adds to live in `i18n.ts`, so that a second locale is one
    table.
58. As a maintainer, I want each surface to be its own component over shared compounds, so that adding the
    seventh surface was a file, not a branch.
59. As a maintainer, I want the tests to render the real app against fake streams and a fixture data root,
    so that a test asserts what a user sees.
60. As a maintainer, I want no new dependency, so that the TUI ships inside the existing tree.

## Implementation Decisions

**One formatter, one place for copy.** `render.ts` stays the only module that builds a domain sentence.
The TUI calls its line functions and turns `Line` values into `Text` with a tone. It never builds a plan,
result, status, inventory, stale, update or removal sentence itself. What the TUI adds is chrome: surface
names, keybar labels, the rail, busy and cancel lines, window and filter counts, and the empty-selection
hints. All of it goes into `i18n.ts` under one `tui` entry, so the copy deck in the mockups is the
literal content of that entry.

**One derived line, and only one.** The confirm surfaces print the count line `render.ts` already emits,
which lands directly above the keybar because that function puts it last. Nothing is re-counted. The plan
is grouped by ordering a copy of `plan.entries` before formatting (will install, already installed, not
covered, error, blocked), so grouping costs no new formatter.

**Surfaces.** Each surface is a component file with its own reducer and its own keymap table. The shell owns
the header, the keybar, the status line and which surface is current. `install` holds the three-section
form and its stages; `plan` and `apply` share one body component and differ in which keys the table binds;
`update`, `remove` and `install` share the result component. Shared compounds: a shell with header, body,
keybar and status slots; a surface with heading, meta, row and empty slots; a row window; a busy block; a
confirm line. No boolean props: variants are separate components.

**Where each surface lives.** `src/tui/` gains one file per surface, one per compound component, a key
table module, a format module that maps `Line` to rendered width, a read module that runs each surface's
data function with a cancel token, and the shell that replaces today's single `App` component. `App.tsx`
keeps its exported entry point and its `render(...)` call so `cli.ts` does not change.

**Keys.** One table per surface, entries of shape `{ keys, label, when, run, refuses }`. Dispatch, the
keybar and the help overlay all read that table, so a key cannot be listed without working. `refuses`
returns the message that goes on the status line, which is how `q` during a write and `Enter` with nothing
chosen explain themselves instead of being ignored. Global keys live in one table merged under the surface
table. Three single-line modes exist and `Esc` closes each: help, filter, and a skill name for `remove`.

**Reads and cancellation.** Each surface's data call goes through one read hook holding
`idle | busy | done | stopped | error`, the start time and the resulting lines. A read carries a token;
`Esc` flips the surface to `stopped`, which discards the result when it resolves and shows the cancelled
copy. Reads are read-only by contract (plan, status, inventory, stale), so stopping the wait changes
nothing on disk. `Runner.run` has no kill and this design does not add one, so the copy says the check may
still be running. Writes get no cancel token at all: `apply`, the update apply and the removal apply run to
completion, and the key table returns the refusal for every key that would leave.

**Slow and fast stay separate.** No surface on the fast path calls the provider inventory or the provider
check. `plan`, `apply`, `status` and `remove`'s recorded path stay sub-second; `list` and `stale` are the
only surfaces that read the inventory or run the check, exactly as `architecture.md` requires for the CLI.

**Width.** Three layouts. At 100 columns and above the body is a 50-column row column and a detail column
of `min(62, width − 52)` with a 2-column gutter: 62 columns from 114 columns up, and 48 at exactly 100, so
the two panes and the gutter never claim more than the frame has; the focused row's text is the detail
column's first line, and its continuation lines follow. Between 60 and 99 the body is one column and the
focused row wraps under itself with a 4-space indent. At 59 and below it is one column with a 1-column
gutter and the rail is dropped. Rows truncate with `…`; only the focused row is ever wrapped. The command
rail occupies the right end of the header's first line when it fits, and is omitted when it does not.
Assert in tests: no rendered line
exceeds the frame width.

**Tone and marks.** Four tones: normal, dim, warning, error. Colour comes from the existing `toneColor`
mapping; `NO_COLOR` or a dumb terminal drops colour and keeps dim, marks and words. Every row leads with
its state word, so no information depends on colour. Marks are ASCII (`>`, `[x]`, `[ ]`, `+`, `=`, `!`,
`-`, `·`); `…` and `→` already ship in `i18n.ts` and are the only non-ASCII glyphs. Focus is `>` plus
inverse video on the row text, never a colour.

**Density.** A rows surface renders only the visible slice, with a 2-row scrolloff and one `Text` per line.
The window and the filter count sit right-aligned on the surface's heading line. No virtualization library,
no memoisation beyond the slice; 103 rows are 103 objects and at most a window of `Text` nodes.

**No new dependency.** Ink and React are in the tree. Elapsed seconds come from a one-second interval.
Nothing in this design needs a package that is not already installed.

## Testing Decisions

A good test here asserts what a user sees. Render the real app headlessly against a fake input stream and a
capturing output stream, push keys, and assert on the frame's text with ANSI sequences stripped. Assert
words and order, never internal component state or props. Existing seams are enough: a fixture data root
plus `createContext({ home, runner, skills })` already make `plan`, `status`, `stale`, `update` and `remove`
deterministic without a network, which is how the unit and e2e suites work today. The TUI adds no seam of
its own.

Surfaces and modules to test:

1. The shell: each of the eight surfaces renders at 120 and at 40 columns, and no line exceeds the frame
   width.
2. The key table: the same table drives the keybar and the help overlay, so a surface's keybar lists exactly
   the keys its table dispatches.
3. Navigation: `p`, `s`, `l`, `v`, `u`, `x` reach their surfaces from `install`; `Esc` returns; `?` opens
   the overlay and `Esc` closes only the overlay.
4. The install form: `Enter` with nothing chosen keeps the stage and prints the hint; `Esc` from the items
   section returns to the package section with the selection intact.
5. The plan body: grouping order, the count line directly above the keybar, and the focused entry's
   continuation lines present in full.
6. Marks: `space` on a requirement marks one, `a` marks all, and the update ids the adapter or runner
   receives equal the marks.
7. Read states: a read that never resolves shows the busy line; `Esc` shows the cancelled copy; a rejected
   read shows its message in the error tone above the keybar and keeps the surface.
8. Write refusal: during an apply, `q` does not exit and the status line carries the refusal.
9. Long rows: a 177-column inventory row truncates in the row column and appears whole in the detail column.
10. `NO_COLOR`: the frame contains the state words and no colour sequence.
11. The remove flow: the paths are in the frame before `y`, and the record claims are those the core returns.
12. Regression: `npm run check` stays green and `dist/cli.js` output is byte-identical for the six
    non-interactive commands, since no CLI path changes.

Stays CLI-only, untested here: flag parsing (`--package`, `--harness`, `--update`, `--skill`, `--yes`), exit
codes, the `--help` text, and the e2e scripts. The interactive surface sets no exit code, which the tests
assert by not asserting on one.

## Out of Scope

- Streaming apply results row by row. `applyPlan` resolves once; a per-entry callback is core work.
- Killing a running child process on cancel.
- Editing the catalogue, a package or a record inside the TUI.
- Mouse input of any kind.
- Project scope. The provider argv carries `-g`; the TUI cannot offer a scope the core does not have.
- Discovery sources and plugin inventory. Both are parked upstream of this surface.
- Changing `AGENTENV_ROOT`, or accepting a data root as an argument.
- A second formatter, a second colour system, a spinner, a progress bar or a timer animation.
- Translating the catalogue's `note:` values. They are data and render as data.

## Further Notes

Copy that this design will surface, and must not silently fix (the CLI's output has to stay as it is):

1. Catalogue `note:` values are Turkish while every UI string is English. The TUI shows them labelled
   `note:`, so they read as data, but the mixture is now visible on a screen instead of buried in
   `catalog/*.yaml`.
2. `t.updateTitle` is `UPDATE` in capitals while `t.plan` is `PLAN` and every other heading is sentence case
   (the wizard's `planTitle`/`resultTitle` went with the wizard). The TUI prints the string as it comes from
   `render.ts`, so heading case is not consistent.
3. `t.removeNotCovered` produces `no provider can remove a mcp yet`. The article is wrong for `mcp` and
   `hook`, and the TUI shows it more often than the CLI does.
4. `t.actions` prints `2 action(s), 1 skipped, 2 blocked`. The parenthesised plural is a pipe affordance; it
   stays because it is the CLI's line.
5. `agentenv remove` with an empty record prints `to run it: agentenv remove --yes`, a hint to run the
   command the user is already in. The TUI does not print that hint; the CLI keeps it.

Unconfirmed decisions a reviewer should challenge, recorded with the product note in
`.thinkrail/context/TASK-tui-design.md`: the rail letters (`v` for stale, `x` for remove), refusing `q`
during a write, per-requirement marks instead of one mark for all, and the named-skill input as the only
text entry besides the filter.
