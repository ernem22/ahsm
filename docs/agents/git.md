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

The gate writes to a temporary log and a passing commit prints one line (`pre-commit: eol + typechecks +
tests OK`); a failing one prints the log's last 40 lines and names the full log, then exits with the
gate's status.

The full gate, including the build and the end-to-end run, is `npm run check`. Run it before handing
work off.

## CLI output must not move

`dist/cli.js` is the surface every script and every user runs, so a change to the interactive window or
to anything else it never reaches still has to leave the commands' output alone. `npm run cli:diff`
proves it without a hand-run: it builds a base revision out of `git archive` into a scratch directory,
builds the working tree, and runs `plan`, `plan --package group`, `apply --yes`, `status`, `list`,
`stale`, `update`, `remove --yes` and `--help` from both against one sandbox HOME pointed at
`test/fixtures/offline`. It prints `IDENTICAL` or `DIFF` per command and exits non-zero on any
difference in stdout, stderr or exit code.

The base is `HEAD` unless `--base <rev>` says otherwise: `npm run cli:diff -- --base 398f147`. On a
clean tree the two sides are the same commit, so it says `clean tree — comparing HEAD with itself,
nothing to prove` instead of claiming a result. `plan` and `status` must exit 0 on both sides, because
two identical failures would read as a match. Run it after any change that touches `src/`, with a base
that predates the branch when you want the change itself proved.
