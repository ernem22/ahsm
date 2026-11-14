# Contributing

ahsm installs a list of skills, MCP servers and hooks into agent harnesses and keeps an honest
record of what landed. It delegates the installing: skills go through the `skills` package's API, MCP
servers through `add-mcp`. The only file it writes by itself is a hook merged into a harness's config.

## Setup

```bash
npm ci
npm run build          # dist/cli.js
node dist/cli.js status
npm link               # optional: puts `ahsm` on your PATH
```

Node 22.20 or newer — that is the `skills` package's floor.

## Before you open a pull request

```bash
npm run check
```

It runs, in order: the line-ending guard, a syntax check of every script, both typechecks, the unit
suite and the five offline end-to-end suites. It needs no network and no harness installed.

To have it run on every commit:

```bash
git config core.hooksPath .githooks
```

`npm run cli:diff -- --base <rev>` proves the CLI's output did not move; `npm run e2e:network` runs the
end-to-end suite against the real `npx skills` / `npx add-mcp` in a throwaway home (network required).

## How the code is shaped

- **Data, not code.** `catalog/`, `packages/`, `harnesses/`, `providers/` and `requires/` are YAML. A new
  harness, provider, item type or prerequisite is a file, not a branch in a function. If a change needs a
  name from that data inside `src/`, the design is wrong.
- **One owner per concern.** `src/render.ts` owns every line the CLI prints; `src/i18n.ts` owns every
  user-facing string; `src/core/<verb>.ts` owns one command; `src/tui/keys.ts` owns the key table that
  drives dispatch, the keybar and the help overlay. Do not create a second formatter or a second wording.
- **Read-only means read-only.** `plan`, `status`, `list` and `stale` never write — not even a backup.
  Only `apply`, `update` and `remove` write, always after showing what they will touch, and always with a
  backup of the file they replace.
- **A record is not evidence.** "Already installed" is claimed only when the provider's own inventory says
  so; with no way to check, the item is installed again. This is deliberate; see `docs/adr/0002`.
- **Delegation is deliberate.** Re-implementing what `skills` / `add-mcp` already do well is out of
  scope; see `docs/adr/0001`.

## Tests

Tests live at a small number of seams, and a good test asserts observable behaviour: what `plan` prints,
what `apply` changes in a disposable home, what `status` reports afterwards.

- `test/*.test.ts` — unit and integration at the core seams, with a fake command runner and a temporary
  `HOME`. A fake provider must actually write the inventory it claims, or the test proves a lie.
- `test/tui-harness.ts` — renders the real TUI against a fake input stream and a capturing output
  stream; assertions run on frames with ANSI stripped.
- `scripts/e2e*.mjs` — the CLI end to end against `test/fixtures/offline`, never the real profile.

## Commits

Conventional subjects (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`), one idea per commit,
and a body that says *why* when the diff cannot. The line-ending guard runs on commit, so a file written
with CRLF will be rejected — convert it to LF rather than bypassing the hook.

## Documentation

The specs are the ground truth for behaviour, not the code:

- `architecture.md` — invariants, the command flow, the harness/provider tables, deliberate limits.
- `goal-and-requirements.md` — what the product is for and what it refuses to do.
- `GLOSSARY.md` — the words every surface and test uses.
- `docs/adr/` — decisions that are hard to reverse.

A change that moves a boundary, gains a capability or overturns a decision updates the owning document in
the same pull request. A user-facing string goes to `src/i18n.ts`; a new key goes to the surface's key
table, never to a bespoke `if`.

## Not in scope

- Being a registry, a marketplace client or a ranking service.
- Installing skills or MCP servers by writing their files.
- Project-level scope (designed for, not built), per-harness hook support for harnesses whose hooks are
  code, and multi-generation CLI support — all recorded as limits in `architecture.md`.
