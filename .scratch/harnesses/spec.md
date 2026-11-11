# Harnesses: codex, pi, opencode + removal

Status: resolved

## Why

The tool's claim is one package list across four harnesses; only claude-code is proven. The scout found
each harness keeps its config somewhere different, and two of them can be verified only by reading a
non-JSON file. Removal is the missing half of installation.

## What

- Harness definitions for codex, pi and opencode, each with detection, its skills agent id, and its MCP
  config location.
- Hook support extends to codex (`~/.codex/hooks.json`, same `matcher` + `hooks[]` shape). pi and
  opencode get extension/plugin hooks — out of scope, reported as not covered.
- MCP verification gains a TOML strategy so codex is verifiable instead of always reinstalling.
- `agentenv remove`: removes an item from **every** harness (the skill dirs are shared), showing which
  directories and harnesses are affected. Skills via `npx skills remove -g`, MCP via
  `npx add-mcp remove -g`, hooks by deleting the recorded entry from the harness config.

## Acceptance

- `plan` on a machine with all four harnesses shows one row per (item, harness) pair: hook items are
  covered for claude-code and codex, and `not covered` for pi and opencode.
- Codex MCP verification reads `config.toml`: present → `already installed`, missing → reinstall.
- `remove` prints the affected dirs before writing, then leaves the skills lockfile without the source
  and the hook config without our entry; `status` shows an empty record afterwards.
- `npm test` and `npm run e2e` stay green; remove has an offline e2e scenario, TOML verification is
  covered by a unit test (the offline fixture harness is JSON-only).

## Out of scope

- Project-level scope.
- pi/opencode hooks (they are code, not config).
- Update/freshness commands.
