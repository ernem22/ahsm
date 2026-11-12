# 01: The window, the key table and the help overlay

**What to build:** `agentenv` with no argument opens a new frame instead of today's wizard. A header names
the current surface and the target, carries the command rail (`i install · p plan · s status · l list ·
v stale · u update · x remove`) at 100 columns and above, and a keybar pinned to the bottom is generated from
the same key table that dispatches the keys. A status line appears only when there is something to say. The
six other surfaces exist as named stubs that print only their surface name, so every key from the rail
already moves somewhere. `?` opens a help overlay built from the current surface's key table; `Esc` closes
only the overlay. `q` quits. The `t.tui` copy block lands in `i18n.ts`. The headless test harness lands here
too: render the real app against a fake input stream and a capturing output stream, push keys, assert on the
frame with ANSI stripped.

**Blocked by:** None (can start immediately)

**Proves it:** run `agentenv` in a 120-column and a 40-column terminal. At 120 the rail is on the first line
and lists seven commands. At 40 it is gone and every letter key still moves surfaces. `?` lists exactly the
keys the keybar shows, and `Esc` closes it without leaving the surface.

**Status:** done

- [x] The new shell renders with header, keybar and no leftover wizard stages
- [x] Every letter key in the rail reaches its named surface, and `Esc` returns to `install`
- [x] The keybar and the help overlay are both generated from the key tables, not written by hand
- [x] `t.tui` holds every new string; no literal copy sits in a component
- [x] A headless test renders the app against fake streams, pushes `?`, and asserts the overlay text
- [x] `npm run check` passes and `dist/cli.js` output for `plan`, `apply`, `status`, `list`, `stale`,
      `update`, `remove` and `--help` is unchanged

## Comments

- The shell is `src/tui/shell.tsx` (header, body, status slot, keybar), the tables are `src/tui/keys.ts`,
  the overlay is `src/tui/help.tsx`, the surface bodies are `src/tui/surfaces.tsx`, and `App.tsx` keeps its
  exported entry point so `cli.ts` is untouched. The headless harness is `test/tui-harness.ts`: fake stdin
  with `isTTY`/`setRawMode` stubbed, a capturing stdout whose `columns`/`rows` are the window, `press(...keys)`
  settling on Ink's own `waitUntilRenderFlush()` rather than a guessed delay, and ANSI-free `frame()`/`lines()`.
- One table per surface plus a global table; a binding is `{ keys, label, hidden?, when?, run }`. Dispatch,
  the keybar and the help overlay all read it, so a listed key always dispatches. The seven rail letters are
  `hidden` because the rail prints them in the header, not the keybar.
- The copy deck shows `? keys` only in the home keybar; here it is in every keybar. While the overlay is
  open the keybar and the overlay both come from that mode's own table (`Esc close`, `q quit`), so no frame
  shows one key under two names; the overlay also lists the rail's seven letters, so a narrow window hides
  the chrome, not the knowledge of what the keys are.
- `Esc` is a mode rule: while the overlay is open the active table is the overlay's own (close, `q`), so
  `Esc` closes the overlay and does not also leave the surface. On `install` there is nothing to go back to,
  so `Esc` is not listed and does nothing.
- The status slot exists and prints nothing until a key has something to say; ticket 02 is its first user
  (`nothing chosen — space to choose a harness`).
- `install` has an empty body and the six other surfaces print only their name; their bodies are tickets
  02-10. The keybar drops entries from the end that do not fit, which is why 40 columns still fits
  `? keys · q quit` while the rail (100 columns and above) is gone.
- No colour is used yet: the header title is bold, the target, rail and keybar are dim, and every word is
  readable with colour stripped. `NO_COLOR` and the 16-colour sweep belong to ticket 11.
