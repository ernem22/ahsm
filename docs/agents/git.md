# Git workflow

How work lands in this repo. Read this before committing.

## Commits

Conventional commit subjects, imperative, scoped where it helps:
`feat(apply): install harnesses only with their default command`,
`chore(issue): tick 03's acceptance criteria`, `docs(agents): ...`.

A ticket's acceptance tick and its `Status: done` line travel in the same commit as the change they
describe — see `issue-tracker.md`.

## Branches and worktrees

Work happens on a feature branch (`feat/<slug>`), often in a separate `git worktree` per agent. A
worktree shares the index and branch with its siblings, so never run `git add -A` from the repo root
while another agent is working in the same checkout; stage the paths you changed.

## Line endings

`.gitattributes` pins `text=auto eol=lf`: the index and the worktree keep LF. `npm run check:eol`
(`scripts/check-eol.mjs`) reads `git ls-files --eol` and fails when the worktree has drifted to CRLF —
that state shows as ` M` in `git status` with an empty `git diff`, which is what the guardrail exists
to kill. Fix with an LF conversion plus `git add --renormalize .`.

## Pre-commit hook

`.githooks/pre-commit` runs the fast subset of the full check — `npm run check:eol`,
`npm run typecheck`, `npm run typecheck:test`, `npm test` — so a broken commit never reaches CI. The
hook is checked in; `.git/hooks` is not tracked, so enable it once per clone:

```sh
git config core.hooksPath .githooks
```

It is a plain `#!/bin/sh` script with LF endings, so it needs no executable bit on Windows and no CRLF
translation anywhere; git just runs it. `git commit --no-verify` skips it — reserve that for work in
progress, never for a commit you intend to keep.

The full gate, including the build and the end-to-end run, is `npm run check`. Run it before handing
work off.
