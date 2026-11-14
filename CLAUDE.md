# ahsm

Installs and tracks agent-harness setup (skills, MCP servers, hooks) from one package list.

## Agent skills

### Issue tracker

Issues and specs live as markdown under `.scratch/<feature>/` (spec + numbered issues). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, label strings unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root, read lazily. See `docs/agents/domain.md`.

### Git

Conventional commits, LF line endings, and the checked-in pre-commit hook (`.githooks/pre-commit`). See `docs/agents/git.md`.

## Where to look

- `src/i18n.ts` — all user-facing copy.
- `src/render.ts` — the one formatter for CLI/plan/outcome wording.
- `src/core/*.ts` — one module per command: plan/apply/remove/status/list/stale/update.
- `src/tui/rows-frame.tsx` — the shared rows frame: the 50/2/62 split, the truncated head, the wrapped detail and the window; list, status and plan all mount it.
- `src/tui/keys.ts` — the key table that drives dispatch, keybar and help.
- `src/tui/*` — one module + hook + body + test per surface; the map is in `docs/agents/tui.md`.
- `src/tui/window.ts` — `rowsInView`/`goTo`, the row window every rows surface shares.
- `test/tui-harness.ts` — the headless seam (`startTui`, `expectFrame`).
- `.scratch/<feature>/spec.md` + `issues/NN-*.md` — decisions per ticket.
- `~/.agents/skills/retro/SKILL.md` — the retrospective procedure; `scripts/session_stats.py` beside it summarizes `$PI_SESSION_FILE`.

On Windows, targeted edits go through the edit tool — never a heredoc (or a Python text-mode rewrite) that builds TypeScript string literals, because `\n` escapes arrive corrupted.
