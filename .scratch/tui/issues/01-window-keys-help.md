# 01: The window, the key table and the help overlay

**What to build:** `agentenv` with no argument opens a new frame instead of today's wizard. A header names
the current surface and the target, carries the command rail (`i install · p plan · s status · l list ·
v stale · u update · x remove`) at 100 columns and above, and a keybar pinned to the bottom is generated from
the same key table that dispatches the keys. A status line appears only when there is something to say. The
seven other surfaces exist as named stubs that print only their surface name, so every key from the rail
already moves somewhere. `?` opens a help overlay built from the current surface's key table; `Esc` closes
only the overlay. `q` quits. The `t.tui` copy block lands in `i18n.ts`. The headless test harness lands here
too: render the real app against a fake input stream and a capturing output stream, push keys, assert on the
frame with ANSI stripped.

**Blocked by:** None (can start immediately)

**Proves it:** run `agentenv` in a 120-column and a 40-column terminal. At 120 the rail is on the first line
and lists seven commands. At 40 it is gone and every letter key still moves surfaces. `?` lists exactly the
keys the keybar shows, and `Esc` closes it without leaving the surface.

**Status:** ready-for-agent

- [ ] The new shell renders with header, keybar and no leftover wizard stages
- [ ] Every letter key in the rail reaches its named surface, and `Esc` returns to `install`
- [ ] The keybar and the help overlay are both generated from the key tables, not written by hand
- [ ] `t.tui` holds every new string; no literal copy sits in a component
- [ ] A headless test renders the app against fake streams, pushes `?`, and asserts the overlay text
- [ ] `npm run check` passes and `dist/cli.js` output for `plan`, `apply`, `status`, `list`, `stale`,
      `update`, `remove` and `--help` is unchanged
