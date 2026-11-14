# ahsm

Installs and tracks agent-harness setup — skills, MCP servers and hooks — from one package list, and
knows what landed where.

## Language

**Harness**:
A coding agent whose setup ahsm manages — Claude Code, Codex, pi, opencode.
_Avoid_: client, agent, tool, assistant

**Item**:
One thing that can be installed into a harness: a skill, an MCP server, or a hook.
_Avoid_: entry, asset, extension, plugin

**Package**:
A named set of items that the user chooses together. Never an npm package ("npm package") and never a
plugin.
_Avoid_: bundle, profile, set, collection, plugin

**Plugin**:
A distributable unit published by someone else that a harness installs as a whole, and which may carry
skills, MCP servers and hooks inside it. Its inventory is part of what the user approves, never a
detail.
_Avoid_: package, bundle, extension (that is pi's own word for its code-level mechanism)

**Discovery source**:
A catalog we search to draft an item — the official MCP registry, SkillFed, a harness marketplace. It
supplies metadata only; installing still goes through a provider.
_Avoid_: registry (say which registry), catalog (that is ours under `catalog/`)

**Provider**:
The external tool that performs an installation for one item type — the `skills` CLI for skills,
`add-mcp` for MCP servers. ahsm does not install skills or MCP servers itself.
_Avoid_: installer, adapter, driver

**Requirement**:
Something that must exist before an installation can succeed: a runtime (Node) or the harness's own
CLI.
_Avoid_: dependency, prerequisite

**Requirement state**:
The three answers a requirement check gives, the same three `status` gives for a harness: **ready** (a
usable version was read and it meets the declared minimum), **too old** (a version was read and it is
below it), **absent** (no usable version was read, so it is bootstrapped). Plan and status print these
words, and only these; a requirement has no fourth condition and no second name.
_Avoid_: outdated (banned outright), old, unmet, version-mismatch — and `missing` for a requirement: that
word belongs to the item states (`up-to-date` / `missing` / `unknown`)

**Installation (kurulum)**:
The act of making something present, always qualified by its object: harness installation, skill
installation, MCP installation, hook installation, ahsm installation. There is no separate verb for
"writing config" as opposed to "installing a runtime" — the object says which.
_Avoid_: setup (as a noun), apply/bootstrap (as user-facing words)

**Scope (kapsam)**:
Where an installation lands: user level (the only one today) or project level (later).
_Avoid_: target, destination, profile

**Record (kayıt)**:
What ahsm remembers about an installation: item, harness, provider, command, time. It says what we
did, not what is true now — which is why an update that reinstalled one stale skill records that command,
narrowed, and the plan recognises it as the item's own.
_Avoid_: state (as a concept; `state.json` is just the file), history, log

**Verification (doğrulama)**:
Asking the provider's own inventory whether an installation is actually there. The answer is present,
missing, or unknown — and unknown is not present.
_Avoid_: check, validation, health

**Not covered (kapsanmıyor)**:
No provider supports this item type for this harness. The plan says so; it never skips silently.
_Avoid_: unsupported, skipped

**Stale (bayat)**:
An installed item whose source now offers a different copy — a newer one, or none at all. Decided by the
provider's own comparison (recorded hash against what the source holds now), never by a timestamp. Its
opposite is **up-to-date**, and where the provider cannot compare the answer is **unknown**, which is not
up-to-date. Updating one means installing it again through the same provider path and record — it is an
installation, never a mechanism of its own.
_Avoid_: outdated, old, dirty, drifted, upgrade, refresh
