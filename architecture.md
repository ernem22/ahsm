---
id: agentenv-architecture
type: architecture-design
status: active
title: agentenv architecture
parent: agentenv
---

# agentenv architecture

## Shape

agentenv is an **orchestrator**: it does not write the installation itself, it calls the providers. Only
hook merging is its own code. Five parts, four of them data:

- **Catalog** (data): item definitions and packages.
- **Harness definitions** (data): detection paths, the ids providers expect, config paths.
- **Provider definitions** (data): more than one tool per kind; which harnesses each supports, and its
  commands.
- **Requirement definitions** (data): a check command + a per-platform install command.
- **Core**: `detect → select → plan → bootstrap → apply → record`, independent of the TUI.

The value is not in performing an installation but in combining the three kinds in one package and giving a
single status view.

## Invariants

- Catalog, package, harness, provider and requirement definitions are data; adding a new harness / provider
  / kind **requires no code change**.
- **The plan is side-effect free** and includes the requirements too. `apply` only applies the plan.
- If there is no provider for a target, the plan says `not covered`; it is never silently skipped.
- There is no write without approval and no requirement installation without approval. The hook file
  agentenv writes itself and a corrupt `state.json` are backed up before being written; skills/MCP files are
  written by the provider.
- agentenv does not write the skills and MCP files (the provider writes them); hook merging is ours.
- Verification is read from the fast source: the lockfile for skills (~1 ms), the harness config for MCP.
  `listSkills()` is not used for the plan — it takes ~7 s on 103 skills; the API is used on the
  installation/removal path, in the explicit `list` command and for the names of `remove --skill` that have
  no counterpart in the record. `plan`, `status` and `stale` never call it.
- Scope is fixed in the provider command today (`-g` = user level); when project scope opens it enters the
  plan as a `{scope}` variable, no separate code path is opened.
- Sequential application does not stop on an error: the failed item is reported as `error` and the rest
  continue.
- **A record is not evidence.** `already` is said only when the owner says "it is here" (`verify` recipe:
  the skill lockfile, the harness's MCP config). If it cannot be verified the item is installed again —
  installers are idempotent.
- A corrupt `state.json` is not silently reset: a file that is read but cannot be parsed is copied under
  `backups/` during `apply` and a warning is shown. A file that cannot be read at all (permission / I/O
  error) or that cannot be backed up is left untouched: installations still run, this run's records are not
  written and a warning is shown. `plan` and `status` never write under any circumstances.

## Layout

```
catalog/*.yaml      item definitions (kind, source, targets, note, link)
packages/*.yaml     named packages (note, link, items[])
harnesses/*.yaml    harness definitions
providers/*.yaml    provider definitions (kind, supports, argv templates)
requires/*.yaml     requirements (check + platform install command)
src/core/           detect, plan, apply, remove, state, status, verify, list
src/apply/          hook-merger + config-writer (the only native writer)
src/providers/      skills-api adapter (in-process, the `skills` package)
src/context.ts      Ctx, Runner (real + recording), argv expansion
src/cli.ts          commands + TUI entry
~/.agentenv/        state.json, backups/<time>/
```

## Schemas

A provider may declare an embedded adapter instead of an argv: `adapter: skills-api` (priority 5). It uses
the skills package's programmatic API (`installSkills` / `removeSkills`); `skills-cli` (priority 10) is the
fallback path that does the same work with a command. `check:` lives only in `skills-cli`: the package
offers no programmatic update check (`resolveSource` does not give the content), and the only surface that
performs the comparison is the `skills check` subcommand. That is why `stale` selects the provider by
capability (`pickProvider(data, 'skill', { capability: 'check' })`), independent of the installation path.

```yaml
# providers/skills-cli.yaml
id: skills-cli
kind: skill
supports: [claude-code, codex, opencode, pi]      # npx skills agent names
requires: [node]
priority: 10                                      # order when there are several providers for the same kind
verify: { strategy: skill-lock, file: "~/.agents/.skill-lock.json" }
install: [npx, skills, add, "{source}", -g, -a, "{agentId}", -y, "--skill {skill}"]
remove:  [npx, skills, remove, -g, -y, "{skill}"]         # removal covers every harness
update:  [npx, skills, update, "{skill}"]
check:   [npx, skills, check, -g]
```

```yaml
# providers/add-mcp.yaml
id: add-mcp
kind: mcp
supports: [claude-code, codex, opencode, pi]      # verified with `add-mcp list-agents`
requires: [node]
install: [npx, add-mcp, "{package}", -g, -a, "{agentId}", -y]
```

The `{package}` field takes both an npm package and a remote MCP URL (`add-mcp` accepts both); the item
definition says `package:` or `url:`.

```yaml
# providers/builtin-hooks.yaml
id: builtin-hooks
kind: hook
supports: [claude-code, codex]
writes: { path: "{harness.config}", section: "hooks.{event}" }
```

```yaml
# requires/node.yaml
id: node
check: { command: [node, --version], min: "20" }
install:
  win32:  [winget, install, OpenJS.NodeJS.LTS, --silent]
  darwin: [brew, install, node]
  linux:  [bash, -lc, "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install -y nodejs"]
```

`AGENTENV_ROOT` changes the data root (for snapshots/test sets); the `{root}` variable gives that root in an
argv. Commands are written as an **argv array**; if a `{variable}` in an element is empty that element is
dropped (e.g. if `skill` is not defined, `--skill {skill}` is not added at all). Item definitions: `kind`,
the source field (`source`+`skill` / `package` or `url` / `event`+`matcher`+`hookCommand`), `targets`,
`note`, `link`. Packages: `id`, `items[]`, `note`, `link`, an optional `default: true` (installed when
nobody names a package) — all one object, one definition per file.

```yaml
# harnesses/claude-code.yaml
id: claude-code
label: Claude Code
detect: [ "~/.claude", "path:claude" ]          # either is enough
agentId: claude-code                            # the value of npx skills / add-mcp -a
config: { path: "~/.claude/settings.json", format: jsonc }
hooks:  { path: "~/.claude/settings.json", section: "hooks.{event}" }
mcp:    { path: "~/.claude.json", key: "mcpServers" }   # to verify the delegated MCP installation
```

```yaml
# catalog/context7.yaml
id: context7
kind: mcp
url: https://mcp.context7.com/mcp
targets: "*"                                    # or [claude-code, codex, ...]
note: "Kütüphane dokümanlarını güncel haliyle çeker"
link: https://github.com/upstash/context7
```

```yaml
# packages/base.yaml
id: base
note: "Her makinede istediğim çekirdek set"
link: https://github.com/emilkowalski/skills
items: [emil-skills, context7, bash-log]
```

## Flow

1. **detect** — the `detect` paths in the harness definitions; those found are marked, those not found are
   dim.
2. **select** — when a package is selected its items come marked; per harness or "all of them". Output:
   `(kind, item, harness)` triples.
3. **plan** — for every triple the provider is resolved (is it in `supports`), the command (the entry to be
   written for a hook) is produced; if there is a record, the truth is checked with the provider's `verify`
   recipe; the missing requirements are listed. Every requirement row carries the version that was read, the
   definition's minimum (`check.min`) and, if it is missing, the update command; if the definition has no
   `install` argv for this platform the row does not invent a command, it says `no install command` —
   `apply` reports the same reason and the items bound to that requirement become `error`. An installation
   is made only with the default command in the definition; there is no second path per harness. If a
   harness's minimum version is not met the row says `too old` (the same word as status). The items bound to
   that requirement are shown as `blocked` together with their reason; another harness's items are not
   affected. Nothing is written.
4. **bootstrap** — requirements are handled according to the two states the plan reports: **absent**
   (`absent`: the check produced no usable version) is always installed once with the platform command;
   **too old** (`too-old`: a version was read but it is below `check.min`) is updated only if the user marked
   it. After the installation the version is checked again.
   `apply --yes` by default marks no too-old requirement; `--update <id,id>` marks only the named ones,
   `--update all` marks all offers, `--update none` none. An unmarked too-old requirement is not updated, the
   dependent items are reported as `error` together with their reason; the absent ones, the other harnesses
   and the unblocked items continue.
5. **apply** — sequential application; before every hook write the target file is backed up, before a corrupt
   `state.json` is recorded that file is backed up. Result row: `installed` / `already installed` /
   `not covered` / `error`. A skill installation does not end with the installer's word: even if the command
   returns 0 (or the adapter says "installed") the provider's inventory (lockfile) is checked — if it is not
   there the item becomes `error` and is **not recorded**; "already installed" is likewise said only when the
   inventory verifies it. MCP and hooks today settle for the command's own result. CLI (`apply --yes`) exit
   code: 1 if an item gave `error` or a requirement was not met, 0 if there are only warnings; the
   interactive TUI does not set an exit code. "Blocked" is not a separate gate: apply looks at its own
   requirement result and does not run the item — the plan only shows the same result in advance.
6. **record** — `state.json`: item, harness, provider, the command that was run, time. Written atomically
   after each successful item (tmp + rename); if recording is disabled (`state.json` cannot be read, the
   corrupt file cannot be backed up, or the record cannot be written) it is not written. Exception: for a
   hook already present at the target (by hand or from an earlier run) no command is run; only `hookCommand`
   is recorded (`command` empty), so that when the command changes later the old entry is found and replaced
   in place. This record is not counted as proof that it exists: `status`/`plan` still read the target file
   themselves.
7. **status** — two sections, both side-effect free: **harnesses** and **items**.
   - *harnesses*: for every harness definition present/absent (the existing `detect` probe), the version its
     own CLI reports, whether it meets the `check.min` minimum of the requirement the definition binds with
     `requires` (`ready` / `too old` / `absent`) and, if it does not, the update command we would run (the
     requirement's `install` argv on this platform). The minimum version is data; there is no number in the
     code.
   - *items*: the record + the truth that can be verified: `up-to-date`/`missing` in providers that have a
     `verify` recipe, `unknown` in those that do not. The update commands sit in the provider definitions
     (`update:`), they do not enter the plan yet.

   Both sections go through a single formatter (`src/render.ts`); the CLI writes the row, the TUI turns the
   tone into colour.
8. **list** — explicit command (`agentenv list`, `src/core/list.ts`): the provider's own inventory
   (`listSkills`) is read and, per row, the skill name, the scope and the harnesses carrying that skill are
   written. Because the source is the inventory, skills installed outside agentenv (by hand, with another
   CLI) are visible too; a skill that no harness reports is still listed as `no harness reports it`, and an
   undefined provider agent appears under its own name. The record is not read (ADR-0002) and nothing is
   written: a corrupt `state.json` does not change the list, not even a backup is taken and no command is
   run. Scope today is user level only (the provider's `-g`), the row says so. Because the inventory is slow
   this read does not enter `plan`/`status` — `list` is the only gate.
9. **stale** — explicit command (`agentenv stale`, `src/core/stale.ts`): for each recorded skill the question
   "does the source still offer the same thing?" is answered `up-to-date` / `stale` / `unknown`. The
   comparison is not ours, it is the provider's own account: `skills check -g` (the `check:` argv in the
   provider definition) compares the `skillFolderHash` recorded at installation with the tree digest the
   source has today and installs nothing. We only read the lockfile (~1 ms); `listSkills()` is again not
   called, `state.json` is never read and nothing is written (no installation, no lockfile, no record). The
   three states are separated honestly: `stale` only when the provider reported an update/deletion for that
   skill, `up-to-date` only when the check completed for that source's skills, the rest is `unknown` (the
   source could not be reached, the command did not finish, there is no hash/source in the record). If the
   provider offers no `check:`, "not covered" is written instead of rows.
10. **update** — explicit command (`agentenv update`, `src/core/update.ts`): the skills that `stale` called
    **stale** are installed again through the same installation path. The comparison is again the provider's
    own check; the work is again `buildPlan` + `applyPlan`: the stale rows are mapped to the catalog item and
    to the harnesses in the record, the plan is built only for those (item, harness) pairs and the entries
    that say `already installed` are turned into `run` — no separate update mechanism, no second installer;
    the provider's `install` argv/adapter and the `state.json` record are the same. Approval is one: without
    `--yes` only the plan is printed (the check and the plan write nothing), with it every pair is installed
    once and its record is refreshed; one skill's error does not stop the others, the exit code becomes 1.
    **Unmarked** skills are not touched: `up-to-date` and `unknown` rows never enter the plan. A stale skill
    that has no item in the catalog, that the record did not write to a harness, or whose harness is not
    defined here is not silently skipped — the row is written with its reason (in the sense of
    `not covered`).
11. **remove** — explicit command (`agentenv remove`, `src/core/remove.ts`): it answers two states **with the
    same rules**. Every recorded item is removed (it can be narrowed with `--package`); `--skill <name,name>`
    removes the named skill even if agentenv did not install it. The single gate is `planRemoval`: if the
    record already covers the name the recorded rules apply (the same provider, the same paths, the same
    record cleanup); if it does not, the plan reads the inventory that `list` reads and fills the
    harnesses/directories from there. The inventory is read only if the name is not in the record. Removal
    covers every harness (the skill directories are shared) and the plan first writes the affected harnesses,
    the directories and the command; without `--yes` nothing is written. What cannot be removed is a row, not
    a stop: if there is no provider `not covered`, if the adapter cannot find it in the inventory
    `not installed`, if the provider errors `error` — the rest still run. A name with no record never writes
    `state.json`, an item that goes from the record cleans up its record: afterwards `status` shows no ghost.
    If reading the inventory fails a warning is written and the name is still planned.

## Skill targets are shared

In the `npx skills` table `codex`, `pi`, `opencode` use the same global directory (`~/.agents/skills/`),
`claude-code` a separate one (`~/.claude/skills/`). The TUI asks the target by harness name; the directory
mapping stays in the provider and harness definition.

## Testing

- `npm test` — unit/integration: `node:test`, temporary HOME + recording runner, no network.
- `npm run e2e` — `scripts/e2e.mjs`, **22 scenarios without network** with `test/fixtures/offline`:
  installation, idempotence, verification, self-repair, corrupt JSONC, corrupt state, missing requirement,
  plan/status not writing, the harness section of status (ready / too old + update command / absent), an old
  harness showing in the plan with its version/minimum/update command and blocking its items, the update not
  running without `--update`, a missing requirement being bootstrapped unmarked, `--update all` running the
  update once and installing the items in the same run, a definition with no install command on this
  platform saying `no install command` in plan and apply, a harness that cannot be installed not holding
  back another harness's items, and a skill installation that writes nothing not being counted as
  `installed`.
- `node scripts/e2e-list.mjs` — four separate scenarios without network for `list` (wired into `npm run
  e2e`): a hand-installed skill appearing with its name and scope, it writing nothing, it continuing to work
  with a corrupt `state.json`, and `plan`/`status` never reading the inventory. Because the inventory also
  reads the machine's real `~/.agents` store, these scenarios verify the behaviour rather than the full
  list.
- `node scripts/e2e-stale.mjs` — seven separate scenarios without network for `stale` (wired into `npm run
  e2e`): an update notification from the fixture's `check` command making it `stale`, `up-to-date` when the
  check completes and the tree not changing at all, the inventory never being read, `unknown` when the
  source cannot be reached even though the provider says "all up to date", `unknown` when the check never
  finishes, no comparison when the hash is not recorded, and a corrupt `state.json` not changing the result.
  A `check` without network means "the source cannot be reached"; this is the real scenario for `unknown`.
- `node scripts/e2e-update.mjs` — five separate scenarios without network for `update` (wired into `npm run
  e2e`): it doing nothing and the tree not changing when there is no stale skill, the plan showing the stale
  skill as an installation row and writing nothing, `--yes` actually installing the skill once (a
  hand-deleted file comes back) and an unmarked MCP item not being touched, `status` then saying
  `up-to-date`, and finally a source-level item (one with no named skill) being installed only with the
  stale skill's name and its fresh sibling not being reinstalled.
- `node scripts/e2e-remove.mjs` — five separate scenarios without network for `remove` (wired into `npm run
  e2e`): the plan showing the affected harnesses and directories before approval and writing nothing, every
  recorded item going away with `--yes` and the record emptying, a skill agentenv did not install being
  removed by name (without creating a record), one name being reported with a provider error and the other
  still being removed, and a name with no provider saying `not covered`.
- `scripts/check-syntax.mjs` (`npm run check:scripts`) — parses `scripts/*.mjs` and
  `test/fixtures/offline/bin/*.mjs` with `node --check`: because e2e runs these programs with `spawn`, the
  typecheck never sees them.
- `npm run e2e:network` — in addition to the above, an installation with the real `npx skills` / `npx
  add-mcp` in a temporary HOME, `status`, and a second run doing nothing.

## Harnesses

| harness | detection | skills | MCP | hooks |
|---|---|---|---|---|
| claude-code | `~/.claude`, `path:claude` | `~/.claude/skills` | `~/.claude.json` → `mcpServers` (JSONC) | `settings.json` |
| codex | `~/.codex`, `path:codex` | `~/.codex/skills` + shared | `config.toml` → `[mcp_servers]` (**TOML**) | `hooks.json` |
| pi | `~/.pi`, `path:pi` | shared + `~/.pi/agent/skills` | `~/.pi/agent/mcp.json` → `mcpServers` | none — extension |
| opencode | `~/.config/opencode`, `path:opencode` | shared + `~/.config/opencode/skills` | `opencode.jsonc` → `mcp` | none — plugin |

## Discovery, plugins and version support (decided — not implemented)

Plugins and discovery are parked; priority was given to the harness + skill base first. The "capability
probe" idea was **dropped**: supporting several generations of CLI is extra burden. Instead the **stable
version** goal applies — the harness definition declares the minimum version with the existing
`requirement` check; if the version is old the plan offers an update, if the user marks it it is updated and
the flow continues. The three rules below will apply only when the plugin/discovery work comes.

- **Discovery only produces drafts.** The official MCP registry (`registry.modelcontextprotocol.io`) and
  SkillFed (`skillfed.io/api/...`) are read for searching; a server/skill that is found enters the catalog
  *as a draft*, and the installation still happens through `apply`. Being in the catalog is not a security
  audit.
- **A plugin is a separate item kind.** The unit of installation is the harness's plugin CLI; the preview
  shows the inventory of skills/MCP/hooks inside the package (`claude plugin details`, `codex plugin list
  --json`). A plugin is not our `package`.
- **Version, not capability.** A harness's subcommand support changes from version to version; we do not
  probe one by one. The harness definition declares the minimum version with `requires` (`opencode
  --version ≥ x`), if it is below the plan says "update" and those items are blocked. Config paths still sit
  as data in `harnesses/*.yaml`: `pi mcp list --json` and `codex doctor` can give the path,
  `claude`/`opencode` cannot.
- **The skills.sh REST API is not used.** Installation/removal is done with the functions of the `skills`
  package; the Vercel OIDC token that the `/api/v1/*` endpoints ask for is not in play on our path.

## Deliberate limits

- If there is no `npx` no provider runs; the plan says so as a requirement (a Node installation is
  recommended).
- The harness version is asked of the harness's **own CLI** (`claude --version`); agentenv does not write,
  but the CLI can create its own cache (e.g. `opencode` on its first run creates `~/.cache/opencode`,
  `~/.local/state`). `status`'s "writes nothing" guarantee is for agentenv's own files.
- Project scope is closed today: both providers take `-g`, that is they write only at user level. `list`
  also reads the inventory only at user scope; because the adapter does not give a scope per row, every row
  says `user`. When project scope opens the scope will come from the adapter per row, no separate code path
  is opened.
- `list` cannot turn provider agents that have no `agentId` in the harness definitions into harnesses; it
  shows them under the provider's own name (e.g. `hermes-agent`). Those are harnesses agentenv does not
  manage — the list itself is not limited to what agentenv installed anyway.
- `status`/`plan` counts an installation as "installed" only if the provider's own inventory verifies it; in
  a provider with no `verify` recipe it says `unknown` and the plan installs the item again.
- `update` obeys what the provider calls "different", not what it calls "newer": `skills check` does not
  report a direction, it only says that the recorded hash and the source's state today differ. If the source
  has been taken back (or the installed copy has been edited by hand) the "update" installs the older
  content; preventing this would mean writing a second comparison, which is why `update` does not know
  direction.
- `update` works through the catalog and the record: if the stale skill has no item in the catalog, if the
  record did not write it to a harness, or if that harness is not defined here, no installation is made and
  the row is reported with its reason. If the source no longer offers the skill, `stale` reports it as
  `stale` (deleted) and `update` still tries: if the installation fails that skill becomes `error`, the rest
  keep installing.
- `skill-lock` verification does not separate by harness: the lockfile does not say for which harness it was
  installed (`~/.agents/.skill-lock.json`, only the source and the skill name per item). A skill installed
  for `codex` can appear as `already installed` for `claude-code` too; `~/.claude/skills/` is not looked at
  separately. If the item has no `skill` field it is enough for any skill from the source repo to be
  recorded (a partial installation also counts as "present"). The lockfile location can change with
  `$XDG_STATE_HOME`; `verify` and `stale` do not read that.
- `stale` reports the provider's comparison, not ours: the recorded `skillFolderHash` against the source's
  tree digest today. Its limits:
  - If the source no longer offers a skill on GitHub's fast (tree/blob) path, `skills check` does not report
    it at all — that row stays `up-to-date`. A deletion is caught only on the clone path ("deleted
    upstream"). If a skill has been moved, the same silence applies.
  - A hand edit in the installed copy is not compared; at global scope only "does it exist on disk" is
    looked at (the `computedHash` comparison at project scope is not in play).
  - If the record has no `skillPath`/`skillFolderHash` (installations before the hash, local sources) →
    `unknown`.
  - If the source cannot be reached `skills check` still prints `✓ All global skills are up to date` and
    returns 0; `stale` takes as its basis not this summary but the `✗ Failed to check skills from …` line
    and writes that source's skills as `unknown`. If the check never finishes (no command, crash, the output
    format changed) the summary line is not seen and no row becomes `up-to-date` — unknown being the default
    is deliberate.
  - The provider output is plain text (the `check` subcommand has no `--json`); unreadable output falls to
    `unknown`, not to a wrong `up-to-date`.
  - `npx` can write its own download cache; the "writes nothing" guarantee is for agentenv's own files, the
    provider's lockfile and the installed skill directories.
- If the hook command changes the old entry is replaced in place (found with the `hookCommand` in the
  record); if the command was edited by hand the old entry stays — because hooks carry no identity in the
  harness schema, this is the only marker.
- If `event`/`matcher`/`hookCommand` is missing in a hook the plan says `error`; an empty value is not
  written to the config.
- Hooks only in harnesses configured with JSON (claude-code, codex). pi and opencode do hooks as an
  extension/plugin — that is code; agentenv does not write code, the plan says `not covered`.
- MCP verification reads three formats: JSON, JSONC and TOML (codex). If a new format arrives, a reader is
  added to `verify`.
- Hook merging is written only for JSONC targets; if another format is needed a new format is added to
  `hook-merger`, the core does not change.
- The `skills` package wants Node ≥22.20; `engines` and `requires/node` say 22.20 for that reason. The CLI
  provider stays as a fallback but today is not selected in any harness (the API covers all four).
- In Claude Code the single source of MCP is not `~/.claude.json`: `claude mcp list` also shows `plugin:…`
  entries. Our verification reads the records at **user scope**; the servers a plugin brings are not
  agentenv's record.
- The `agentId` field has to be valid for both `skills` and `add-mcp`. Today they overlap (`pi`, `codex`, …);
  if they diverge a per-provider id is needed in the harness definition.
- `add-mcp` shares the `.mcp.json` file at project scope with Claude Code and GitHub Copilot CLI (removal
  affects both). Since we use only global scope, this is not in play today.
- MCP secrets (`${VAR}` → `add-mcp --env KEY=${VAR}`) are not implemented yet; the item definition has no
  env field.
- `status` knows three states (`up-to-date` / `missing` / `unknown`); a hook that is recorded but whose
  command has changed counts as `missing` — there is no separate "different" state. The harness section uses
  a separate scale (`ready` / `too old` / `absent`); `plan` requirement rows use the **same** three words
  and the same `harnessLabels` labels (`ready` / `too-old` / `absent`) — there is no second name such as
  "missing/old for a requirement", and the word `outdated` is banned in the GLOSSARY. `too old` is not a
  detection error, it is an unmet requirement. If the version cannot be read the row says `version unknown`
  and, if there is a minimum, counts as `too old`.
- `update` makes a narrowed installation, and the record also holds the argv that **actually ran**: the
  item's install command narrowed to a single skill (in the adapter the fingerprint `['skills-api', source,
  skill]`). `plan` counts such a record as the item's own scope: every argv the template can produce by
  putting a value in place of `{skill}` matches. Otherwise an updated item would look like a new
  installation in every `plan` and the next `apply` would install the whole source again. The record is
  still not evidence: only `verify` answers "is it there" (ADR-0002).
- File access is not injected through `Ctx`: `plan` reads the target file, and the tests verify this through
  the real file system with a temporary HOME.
