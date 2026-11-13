# agentenv

Install and track agent-harness setup — skills, MCP servers and hooks — from one package list, across
**Claude Code, Codex, pi and opencode**, and keep an honest record of what landed where.

```
$ agentenv status
harnesses
ready  claude-code  2.1.322 · min 2.1
ready  codex        0.166.0 · min 0.166
ready  opencode     1.19.0 · min 1.19
ready  pi           1.4.0 · min 1.4
items
up-to-date  emil-skills → claude-code [skill]
up-to-date  context7    → claude-code [mcp]
up-to-date  bash-log    → claude-code [hook]
```

## Why

A setup is spread over four harnesses that each keep their own config: `~/.claude/settings.json`,
`~/.codex/config.toml`, `~/.pi/agent/mcp.json`, `~/.config/opencode/opencode.jsonc`. Adding one skill
means editing four places by hand, and afterwards nothing tells you what is installed where — or whether
the thing you installed last month is still there.

agentenv keeps one list of what you want, installs it into the harnesses you pick, and answers "what is
installed, and is it actually installed?" from the providers' own records rather than from its own memory.

## What it does not do

- **It does not install skills or MCP servers itself.** Skills go through the
  [`skills`](https://github.com/vercel-labs/skills) package's API; MCP servers through
  [`add-mcp`](https://github.com/runeb/add-mcp). agentenv runs them, reads their results and records what
  happened. The only file it writes by itself is a hook merged into a harness's config.
- **It is not a registry.** It has no catalogue service and no ranking. Catalogues are files in this repo.
- **It does not install harnesses beyond their own default command.** A harness it cannot install is
  reported, not worked around.

agentenv is early and unpublished: `private: true`, no npm release yet, one development branch.

## Requirements

- **Node ≥ 22.20** (the `skills` package's own floor).
- Any of the four harnesses, or none — a harness that is absent stays listed and can still be targeted.
  Its CLI is a *requirement*: if it is too old, the plan says so and blocks the items that need it.

## Run it

Not published yet, so from a checkout:

```bash
npm ci
npm run build
node dist/cli.js status        # or: npm link  →  agentenv status
```

To try it the way a published package would behave:

```bash
npm pack                        # agentenv-0.1.0.tgz
npm i -g ./agentenv-0.1.0.tgz   # then: agentenv
```

## Use it

```bash
agentenv              # the TUI (see below)
agentenv status       # harnesses + what is installed, verified
agentenv plan         # what would happen — writes nothing
agentenv apply --yes  # do it
agentenv list         # every skill the provider inventory reports (read-only)
agentenv stale        # what is out of date (read-only)
agentenv update --yes # reinstall the stale ones through the same path
agentenv remove       # remove what is recorded
```

Useful flags: `--package <id>` (default: the package marked `default`), `--harness <id,id>`,
`--update <ids|all|none>` (marks too-old prerequisites for update; **the default is none**, so nothing
upgrades behind your back).

`plan` and `status` never write — not even a backup. `apply`, `update` and `remove` always show what they
will touch first, back up a config file before rewriting it, and record only what actually landed.

## The TUI

`agentenv` with no argument opens the interactive surface. One rail, one key table per surface; the keybar
and the help overlay are generated from the same table that dispatches the keys, so a listed key always
does something.

| key | surface | writes |
|---|---|---|
| `i` | install — harnesses, package, items | after `y` |
| `p` | plan (read-only) | no |
| `Enter` on plan | apply — marks, confirm | after `y` |
| `s` | status — harnesses and items | no |
| `l` | list — the provider inventory, filter with `/` | no |
| `v` | stale — verdicts and their reasons | no |
| `u` | update — the stale plan, confirm | after `y` |
| `x` | remove — paths shown before the key | after `y` |
| `?` | help, built from the current surface | no |

`space` toggles, `a` toggles all, `Esc` stops a running read, then clears a text filter, then goes back.
Long plans scroll with `↑/↓`, `PgUp/PgDn`, `g/G`; the requirement rows and the summary stay pinned above the
keybar. It works down to 20 columns, and colour is never the only signal.

## How it works

1. **detect** — each harness definition lists probes (`~/.codex` or `path:codex`); any hit means present.
2. **requirements** — a harness's own CLI is a requirement with a minimum version (`codex --version ≥
   0.166`). Missing → installed on approval. Too old → reported and blocking, unless you mark it.
3. **plan** — for every (item, harness) pair: which provider covers it, the exact argv, or the hook entry
   to merge. A pair with no provider is `not covered`, never silently skipped.
4. **apply** — backup, then write in order; a failure is reported per item and the rest continues.
5. **record** — `~/.agentenv/state.json` (atomic write) says what we did. Config files written outside it
   live in `~/.agentenv/backups/<timestamp>/`.
6. **verification** — "already installed" is claimed only when the provider's own inventory says so: the
   skills lockfile (`~/.agents/.skill-lock.json`), or the harness's MCP config (JSONC or TOML). With no way
   to check, the item is installed again rather than trusted.

Hooks are the one thing written directly: a surgical JSONC edit that preserves comments and trailing
commas, is idempotent, and refuses to touch a file it cannot parse.

## Configuration is data

Everything specific lives in YAML, so a new harness, provider, item type or requirement is a file, not a
code change:

```
catalog/     the items — a skill source, an MCP package or URL, a hook
packages/    named sets of items, with a note and a link (one marked default: true)
harnesses/   probes, agent id, config location, MCP keys, hook section
providers/   who performs a kind of installation, and how to verify it
requires/    a prerequisite and its per-platform install command
```

```yaml
# catalog/emil-skills.yaml           # packages/base.yaml
id: emil-skills                      id: base
kind: skill                          default: true
source: emilkowalski/skills          note: "the set I want on every machine"
targets: "*"                         items: [emil-skills, context7, bash-log]
```

Scope is user-level only for now (project-level is designed for, not built). Hook support covers
harnesses that take hooks as configuration — Claude Code and Codex; pi and opencode implement hooks as code,
so those pairs report `not covered`.

## Development

```bash
npm run check          # line endings + script syntax + both typechecks + unit tests + e2e
npm test               # node:test, headless: fake runners, temporary HOME
npm run e2e            # CLI scenarios against offline fixtures — no network
npm run e2e:network    # same, with real npx skills / add-mcp in a throwaway HOME
npm run cli:diff       # assert the CLI's output did not move (--base <rev> to compare)
```

The TUI is tested through `test/tui-harness.ts`: the real app rendered against a fake input stream and a
capturing output stream, asserting on frames with ANSI stripped.

## Documentation

- `goal-and-requirements.md` — what the product is for and what it refuses to do.
- `architecture.md` — invariants, flow, the harness/provider tables, deliberate limits.
- `GLOSSARY.md` — the vocabulary every surface and test uses.
- `docs/adr/` — decisions that are hard to reverse (delegation, "a record is not evidence").
- `docs/agents/` — how work is tracked and how the TUI's modules fit together.
- `.scratch/` — the local tracker: specs, tickets and research notes per feature.

## Limitations

- Not on npm yet: `npx agentenv` does not exist. Install from a tarball or a checkout.
- `update` can only refresh skills whose source appears in `catalog/`; anything installed from an
  uncatalogued source is reported as such rather than guessed at.
- An update installs whatever the source holds — a difference is not a direction, so a rewind upstream
  reinstalls the older copy.
- MCP and hook *freshness* is not checked; only skills have a staleness verdict.
- Only user-level scope; no Windows-specific installer beyond `npm install -g`.

## Licence

MIT — see [LICENSE](LICENSE).
