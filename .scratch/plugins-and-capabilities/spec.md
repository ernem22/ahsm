# Plugin items and harness capabilities

Status: needs-triage

> **Parked (2026-11-11).** Not scheduled: harness-and-skills foundation comes first, sequentially.
> The capability-probe approach described below was **dropped** — supporting several CLI generations is
> extra load we do not want. Stable-version support only: a harness declares a minimum version through
> the existing requirement check, and an outdated harness is *suggested* for update (and updated only if
> the user marks it) before the flow continues. What survives from this spec is the plugin item kind;
> the probe/cache machinery does not.

## Problem Statement

Today agentenv can install three kinds of item — skill, MCP server, hook — and it never asks a harness
what its CLI can actually do: the MCP path goes through `add-mcp`, skills through the `skills` package,
hooks we write ourselves, so nothing is assumed. That breaks the moment a user wants to install
something the harness itself owns.

Two problems follow:

1. **Plugins cannot be expressed at all.** A plugin is a distributable unit published by someone else
   that a harness installs as a whole and that may carry skills, MCP servers and hooks inside it. There
   is no way to put one in a package, so a user setting up four harnesses installs it four times by hand
   and never sees what it brings.
2. **The harness CLI is a moving target.** OpenCode 1.19.0 on this machine knows only
   `opencode plugin <module>`; OpenCode's current docs list `plugin add/list/check/update/remove`.
   Claude exposes `plugin list --json --available`, Codex exposes `plugin add/list/remove` plus
   `marketplace`. A plan that assumes any of these either promises work that cannot happen or fails
   halfway through an apply.

## Solution

Two changes that ship together:

- A **plugin item kind**, so a package can name a plugin the same way it names a skill, and agentenv
  shows one row per harness with the exact command and, where the harness can tell us, what the plugin
  contains.
- A **capability probe**: before planning plugin work, agentenv asks the harness (read-only) what this
  installed version supports, caches the answer next to the harness version, and reports
  `not covered (this version of the harness CLI)` instead of attempting the impossible.

Nothing else changes: skills, MCP and hooks keep their current paths, and an unsupported harness never
blocks the rest of a package.

## User Stories

1. As a user setting up a new machine, I want agentenv to tell me which harnesses can install plugins,
   so that I do not approve work that cannot happen.
2. As a user, I want to add a plugin to a package, so that I install it on all four harnesses from one
   selection instead of four separate commands.
3. As a user, I want to see what a plugin contains — skills, MCP servers, hooks — before approving, so
   that a plugin is not a black box.
4. As a user on an older OpenCode, I want the plan to say `not covered (this version)` rather than fail
   during apply.
5. As a user, I want the capability answer cached together with the harness's version, so that repeated
   plans are fast.
6. As a user, I want to be told when the cached answer is stale because the harness version changed, so
   that I do not trust an outdated plan.
7. As a user, I want a way to force a re-probe after upgrading a harness, so that the plan becomes
   correct without me deleting files by hand.
8. As a user, I want plugin removal to respect the same capability answer, so that it uses the
   harness's own remove command when there is one.
9. As a user, I want a plugin row whose state cannot be read to show `unknown` instead of `up-to-date`,
   so that the status stays honest.
10. As a user, I want a plugin item to name a concrete source (marketplace id or npm package), so that a
    bare name cannot silently install the wrong thing.
11. As a user, I want each plugin row to show the exact command that will run, so that approval is
    informed.
12. As a user, I want a plugin that ships hooks to be flagged, because hooks execute with my
    privileges.
13. As a user, I want to pin a plugin version where the source supports it, so that two machines end up
    with the same thing.
14. As a user, I want a plugin install that fails on one harness to leave the others installed and
    reported, so that a partial run is still useful.
15. As a user, I want plugin items to declare which harnesses they target, so that a claude-only plugin
    is not attempted on pi.
16. As a user, I want to mix plugins with skills, MCP servers and hooks in one package, so that a single
    approval covers a whole setup.
17. As a user, I want the plan to show the plugin's source and version, so that I can recognise it.
18. As a user, I want `status` to show what each harness supports, so that I understand why a row says
    `not covered`.
19. As a user, I want the probe to run only read-only commands, so that planning never changes my
    machine.
20. As a user, I want probe results to stay inside agentenv's own directory, so that nothing leaks into
    harness configuration.
21. As a user without a plugin-capable CLI, I want the plugin item reported as not covered instead of
    silently skipped.
22. As a user on Windows, I want plugin commands to be given as argv, never as a shell string, so that
    spaces and quotes in a marketplace id cannot break the run.
23. As a user, I want the record to keep the plugin's resolved version, so that I can tell later what
    was installed.
24. As a user, I want removing a plugin to empty its record, so that `status` does not keep reporting a
    ghost.
25. As a user, I want plugin support to be entirely additive, so that existing packages keep working
    unchanged.

## Implementation Decisions

- **New item kind `plugin`**, alongside `skill`, `mcp` and `hook`. The kind set stays data: a provider
  declares the kind it serves, so a new kind does not touch plan/apply branching.
- **One new seam: `capabilities`.** It takes a harness and the context, runs that harness's declared
  probes through the existing command runner, and returns a map of capability id → supported, plus the
  CLI version it saw. Everything accepted as a command goes through the runner already injected into the
  context, so tests answer without a harness installed.
- **Probes are data, not code.** A harness definition lists its probes as capability id + argv
  (`plugin.add`, `plugin.list`, `mcp.add`, …). Interpretation is uniform: exit code 0 means supported.
  Probes are read-only by contract; a probe that would mutate is a bug in the data.
- **Cache.** The answer is stored under agentenv's own directory, keyed by harness id, the CLI version
  and a probe-schema version, so an upgrade invalidates it automatically. A forced re-probe exists as a
  flag and as a TUI action; the cache never influences anything but the plan's wording and gating.
- **Provider gating by capability.** A provider can require capability ids; when one is unmet the plan
  emits `not covered (this version of the harness CLI)` — the same vocabulary the plan already uses for
  a missing provider, extended with the reason.
- **Plugin providers are argv templates**, one per harness (`claude plugin install`, `codex plugin add`,
  `opencode plugin add`, `pi install npm:`), each declaring the capability ids it needs. No new adapter
  interface: the existing provider shape already carries templates, requirements and verification.
- **Inventory before approval.** Where the harness can list plugin components
  (`claude plugin details`, `claude plugin list --json --available`, `codex plugin list … --json`), the
  plan shows what the plugin brings. Where it cannot, the row says the inventory is unknown — it is
  never guessed.
- **Verification** follows ADR-0002: a plugin counts as installed only when the harness's own listing
  says so; otherwise the row is `unknown` and a plan re-installs. We do not read plugin caches by path.
- **Removal** uses the harness's plugin remove command when the capability exists, and otherwise reports
  not covered. agentenv does not hand-edit plugin layouts — we do not own them.
- **Security invariants** carried into the spec: never auto-run a plugin's hooks, always show source,
  version and command, flag any plugin that carries hooks, and leave authentication to the harness.
- **Targets**: a plugin item declares its harness targets like any other item, and per-harness rows stay
  one per pair, so a claude-only plugin never appears for pi.

## Testing Decisions

- A good test asserts external behaviour only: what `plan` prints (rows, actions, reasons), what
  `apply`/`remove` do to a disposable HOME, and what `status` reports afterwards. Internal caches and
  helper shapes are not asserted.
- Modules under test are reached through the existing seams: `capabilities` (new), `buildPlan`,
  `applyPlan`, `buildRemovePlan`, `applyRemovePlan`. No UI-level assertions; the TUI stays a formatter.
- Prior art to follow: the fake-runner + temporary-HOME tests already covering plan/apply/remove, and
  the offline end-to-end suite that drives the CLI against a fixture harness. The fixture gains a fake
  plugin CLI script so the whole feature is exercised without network.
- Representative cases: a harness whose probe lacks `plugin.add` yields `not covered (this version)`;
  one that has it yields a run row with the argv; a cached answer with a different CLI version is
  ignored; a plugin whose inventory is unavailable says unknown; a failing plugin on one harness leaves
  the others installed.

## Out of Scope

- **Discovery sources** — searching the official MCP registry or SkillFed and drafting items from the
  results. Decided, not in this spec.
- Hook support for pi and opencode (they are code — extensions/plugins — not configuration).
- Project-level scope; everything here stays user-level.
- Update/freshness commands and pinned-version drift reporting.
- Any authentication flow: OAuth and logins remain the harness's business.

## Further Notes

- Evidence for the divergent plugin CLIs and for the "no CLI exposes every config path" correction is
  recorded in `.scratch/harnesses/research.md`, collected from the installed CLIs and packages.
- The decisions behind this spec live in `architecture.md` ("Keşif, plugin ve yetenek yoklaması —
  karar, henüz uygulanmadı") and in `GLOSSARY.md` (plugin, discovery source, capability probe).
- Non-goal worth stating: agentenv is not a marketplace client. It reads a catalog, drafts an item and
  installs through the harness; it does not host, rank or vet plugins.
