---
id: ahsm
type: goal-and-requirements
status: active
title: ahsm
---

# ahsm

A tool that performs the installation of skills + MCP + hooks for agent harnesses from one place, and
knows what is installed where.

## Overview

ahsm picks the skills, MCP servers and hooks of the agent harnesses on a machine (Claude Code, Codex
CLI, opencode, pi) from a single list and installs them. Items live in this repo as **source definitions**
(a git repo/URL for skills, a server package for MCP, a file for a hook), grouped into named packages; the
TUI shows the list, and the selection is made per harness or for all of them at once.

ahsm does not write the skill installation itself: it delegates it to mature tools such as
`npx skills`. The only thing it writes itself is the MCP config record and the hook merge, which have no
common installer.

After an installation ahsm knows which item was installed into which harness, in which scope. The
ambiguity of "was it installed into the project, via npx, or into the harness folder" collapses into a
single source of truth.

## Problem

Today installation is spread over four different config formats of four different harnesses: for every new
skill, MCP server or hook the files are edited by hand. Two consequences follow:

- **Loss of visibility.** Whether an item is installed, and in which harness and which scope it sits,
  cannot be read anywhere in one go.
- **Repetition.** The same 8-10 items are selected again on every installation and written separately for
  every harness; when one is forgotten, silent differences appear between harnesses.

## Capabilities

- **Item catalog.** Every item is a source definition — a git repo/URL for skills (optionally with a single
  skill name), a server package and config template for MCP, event + matcher + command for a hook. Beside
  it are a name, the target harnesses, a short note and, optionally, a link.
- **Packages.** Named item lists are defined in a single YAML file; every package can have its own note and
  link. When a package is selected in the TUI its contents come marked, and the user can change them one by
  one.
- **TUI.** Lists the harnesses and the items, shows package notes, takes a selection. Before the
  installation it shows the work to be done (the command that will run, the entry to be written for a hook)
  and asks for approval; the target file's difference is not shown, because the skills/MCP file is written
  by the provider. Only the hook file it writes itself is backed up before being overwritten.
- **Multiple installations at once.** The selected items can be written into a single harness or into all
  harnesses at once.
- **Delegating the installation (skills + MCP).** ahsm does not write the skill files and the MCP
  records; it calls the provider tools (`npx skills add <source> -g -a <harness>`, `npx add-mcp <package>`).
  Symlink/copy, check/update/remove are those tools' job.
- **Provider model.** More than one provider can be defined for each item kind; every provider declares
  which harnesses it supports. An unsupported pair is not silently skipped, it is shown as "not covered".
- **Hooks.** There is no multi-harness hook builder; ahsm merges hooks into `settings.json` — the target
  file and the entry to be written are shown, approval is asked, a backup is taken, the other settings in
  the file are preserved.
- **Requirements.** The tools that are missing (Node/npx, uv, the harness binary that is needed) are listed
  at the plan stage and installed after approval; the installation recipe is given per platform.
- **Writing in the right format.** Every harness gets its own format; the MCP key is not written in plain
  text, the `${VAR}` reference and the required variable names are visible in the plan output.
- **Removal.** Installed items can be taken back: `npx skills remove` for skills, `npx add-mcp remove` for
  MCP, deletion of the recorded entry from the config for hooks. Removal covers **every harness** (the
  skill directories are shared); the plan shows the affected directories and harnesses in advance.
- **Status.** The harness + scope map of the installed items can be seen with one command. The record is
  compared with the truth that can be verified: `up-to-date` / `missing` / `unknown`. Three states are
  enough: a hook that is recorded but whose content has changed also counts as `missing`, skills/MCP that
  cannot be verified say `unknown`.
- **Secrets.** No plain key is written into the MCP config; a `${ENV_VAR}` reference is written and the TUI
  says which variable is required.
- **Extensibility.** Adding a new harness, a new scope (e.g. project level) or a new item kind does not
  require writing code; adding a definition file is enough.

## Alternatives Considered

There are tools that do parts of the same work; none of them covers all four at once (package from a local
file + TUI + multiple harnesses + honest status).

| Tool | What it does | What is still missing in ahsm | Link |
|---|---|---|---|
| `skills` (vercel-labs) | Installs skills from git repos with `npx skills add`, 75+ harnesses, lockfile | Does not go beyond skills: no MCP record, no hook merging and no local package definition | https://github.com/vercel-labs/skills |
| Bridle | Translates profiles, skills/agents/commands/MCP between Claude Code, OpenCode, Goose, Amp, Copilot CLI | Items come from GitHub (no local file library); no hook merging and no TUI | https://github.com/neiii/bridle |
| skillz | Installs/removes skills/plugins/hooks/MCP/subagents, named profiles | Claude Code + Codex only; no TUI, selection limited to a profile | https://github.com/killallgit/skillz |
| harness-ai-kit | An "agent asset package manager" with a typed asset schema, dependency resolution and a lockfile | Installation-heavy, no local single-file package + note/link idea | https://github.com/seed-forge/harness-ai-kit |
| skill-manager | Cross-harness inventory: what is in use, where it is active; on/off | Desktop application; no terminal/TUI flow and no one-command installation | https://github.com/mode-io/skill-manager |
| chezmoi / `mise dotfiles` | General dotfile management, templating, version tracking | Not harness-aware: does not know the skills/MCP/hook formats, does not let you choose | https://mise.jdx.dev/dotfiles.html |

## Tech Notes

| Topic | Decision | Rationale |
|---|---|---|
| Language / distribution | TypeScript + Ink; Node ≥20, runs without installation via `npx ahsm` | Harness configs are already JSON; one language carries both the TUI and the installation code. Running in every environment depends on Node being present; a machine without Node is not a target. |
| Harness definitions | Data files (`harnesses/*.yaml`): detection paths (`~/folder` or `path:binary`), the `agentId` providers expect, the hook section | A new harness = a new file; the core code does not know harness names. |
| Item kinds | One layout definition per kind: `skill` = `npx skills`, `mcp` = `npx add-mcp`, `hook` = `settings.json` merge | Adding a new kind becomes adding a new definition, not an `if` chain. |
| Providers | More than one provider per kind, each declaring the harnesses it supports and its commands | So that where `add-mcp` does not support a harness we can fall back to `mcpm`, or later to another tool |
| Skill installation | The `skills` package's programmatic API (`installSkills`/`removeSkills`), primary; `npx skills` fallback | A structured result (`failed[]`), correct removal semantics (a shared copy stays if another agent uses it) and no subprocess. Requires Node ≥22.20. |
| Packages | `packages/*.yaml`: `id`, `items[]`, `note`, `link` — one package per file | Read/edited by humans; the TUI shows the note and the link from here. |
| Installation state | `~/.agentenv/state.json` (item, harness, provider, command, time) + the verifiable target; hooks `up-to-date`/`missing`, skills/MCP `unknown` | So as not to call "up-to-date" something we have not verified, and not to put the record in place of the truth. |
| Scope | Today only user level: `-g` is written fixed into the two provider commands | When project scope opens it becomes a `{scope}` variable; no separate code path is opened. |
| Platform | Windows / macOS / Linux path differences in a single path layer | Development may be on Windows, use on other machines. |
| i18n | All user-facing text in a single table in `src/i18n.ts`, today only English | So that multiple languages can be added later and the text is not embedded in the code. |
