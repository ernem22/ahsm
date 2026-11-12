# The TUI's surfaces

Eight surfaces, four files each plus the key table. Nothing else should need reading to find where a
surface lives: a new surface is a row in `src/tui/keys.ts#RAIL_LETTERS`, a row here, and its own four
files.

| surface | module (words/body) | hook (state) | body (component) | test |
|---|---|---|---|---|
| `install` | `src/tui/install.ts` | `src/tui/use-install.ts` | `src/tui/install-surface.tsx` | `test/tui-install.test.ts` |
| `plan` | `src/tui/plan.ts`, `src/tui/plan-body.tsx` | `src/tui/use-plan.ts` | `src/tui/plan-body.tsx` | `test/tui-plan.test.ts` |
| `apply` | `src/tui/apply.ts`, `src/tui/plan.ts` | `src/tui/use-apply.ts` | `src/tui/apply-body.tsx` | `test/tui-apply.test.ts` |
| `status` | `src/tui/status.ts` | `src/tui/use-status.ts` | `src/tui/status-surface.tsx` | `test/tui-status.test.ts` |
| `list` | `src/tui/list.ts` | `src/tui/use-list.ts` | `src/tui/list-surface.tsx` | `test/tui-list.test.ts` |
| `stale` | `src/tui/stale.ts` | `src/tui/use-stale.ts` | `src/tui/stale-surface.tsx` | `test/tui-stale.test.ts` |
| `update` | `src/tui/update.ts` | `src/tui/use-update.ts` | `src/tui/update-surface.tsx` | `test/tui-update.test.ts` |
| `remove` | `src/tui/remove.ts` | `src/tui/use-remove.ts` | `src/tui/remove-surface.tsx` | `test/tui-remove.test.ts` |

Shared pieces, so a surface only adds what is its own:

- `src/tui/keys.ts` — one key table per surface; dispatch, the keybar and the help overlay all read it.
  `SURFACES` and `RAIL` are built from one `Record<SurfaceId, …>`, and `test/tui-keys.test.ts` walks the
  same list, so a new surface cannot be added to one and forgotten in the other.
- `src/tui/rows-frame.tsx` — the 50/2/62 split, the row window, the heading/note/blocks/tail body.
- `src/tui/read.ts` + `src/tui/read-body.tsx` — the read states every surface shows.
- `src/tui/use-write.ts` + `src/tui/apply-body.tsx` — the in-flight refusal, the busy block and the result.
- `src/i18n.ts` — every word the TUI adds; `src/render.ts` — every domain sentence.
- `test/tui-harness.ts` — the headless seam (`startTui`, `expectFrame`).

The shell (`src/tui/shell.tsx`) owns the header, target line, status strip and keybar, and which surface
is current. A surface never reads another surface's state.
