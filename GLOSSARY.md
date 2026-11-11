# agentenv

Installs and tracks agent-harness setup — skills, MCP servers and hooks — from one package list, and
knows what landed where.

## Language

**Harness**:
A coding agent whose setup agentenv manages — Claude Code, Codex, pi, opencode.
_Avoid_: client, agent, tool, assistant

**Item**:
One thing that can be installed into a harness: a skill, an MCP server, or a hook.
_Avoid_: entry, asset, extension, plugin

**Package**:
A named set of items that are chosen together. Never an npm package; those are always "npm package".
_Avoid_: bundle, profile, set, collection

**Provider**:
The external tool that performs an installation for one item type — the `skills` CLI for skills,
`add-mcp` for MCP servers. agentenv does not install skills or MCP servers itself.
_Avoid_: installer, adapter, driver

**Requirement**:
Something that must exist before an installation can succeed: a runtime (Node) or the harness's own
CLI.
_Avoid_: dependency, prerequisite

**Installation (kurulum)**:
The act of making something present, always qualified by its object: harness installation, skill
installation, MCP installation, hook installation, agentenv installation. There is no separate verb for
"writing config" as opposed to "installing a runtime" — the object says which.
_Avoid_: setup (as a noun), apply/bootstrap (as user-facing words)

**Scope (kapsam)**:
Where an installation lands: user level (the only one today) or project level (later).
_Avoid_: target, destination, profile

**Record (kayıt)**:
What agentenv remembers about an installation: item, harness, provider, command, time. It says what we
did, not what is true now.
_Avoid_: state (as a concept; `state.json` is just the file), history, log

**Verification (doğrulama)**:
Asking the provider's own inventory whether an installation is actually there. The answer is present,
missing, or unknown — and unknown is not present.
_Avoid_: check, validation, health

**Not covered (kapsanmıyor)**:
No provider supports this item type for this harness. The plan says so; it never skips silently.
_Avoid_: unsupported, skipped
