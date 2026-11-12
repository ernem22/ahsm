# agentenv

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
- `src/tui/keys.ts` — the key table that drives dispatch, keybar and help.
- `src/tui/window.ts` — `rowsInView`/`goTo`, the row window every rows surface shares.
- `test/tui-harness.ts` — the headless seam (`startTui`, `expectFrame`).
- `.scratch/<feature>/spec.md` + `issues/NN-*.md` — decisions per ticket.

On Windows, write files with the edit/write tools or `newline=''` — never a Python text-mode rewrite.
