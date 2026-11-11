# Harness and skill foundation

Status: ready-for-agent

## Problem Statement

agentenv can already detect four harnesses, install skills through the `skills` package, write hooks and
delegate MCP servers — but none of that is settled. Detection treats "config directory exists" as
"harness works"; harness installation exists only for the cases where our default command happens to
work; skills can be installed and removed, yet nothing tells a user when an installed skill is out of
date, and `status` cannot enumerate what is installed for a harness that agentenv did not record itself.

The user's own order is explicit: **no parallel work.** Detection, then harness installation, then skill
installation, then update, then removal and listing — each one settled before the next is touched. MCP
and hook freshness are allowed to stay stale; plugins and catalogue discovery are parked.

## Solution

One sequential slice that makes the existing path *trustworthy* instead of wider:

1. **Harness detection settles**: a harness counts as present when a probe hits, and as *usable* only
   when its declared minimum version is met. A too-old harness is not a detection failure; it is a
   requirement the plan can suggest updating — and the update happens only if the user marks it.
2. **Harness installation settles**: we use the default install command each harness definition already
   carries. If a harness cannot be installed by that default, we say so and stop — we do not add a
   second installation mechanism to work around it.
3. **Skill installation settles**: install through the existing provider/adapter path, verify through
   the existing inventory, and keep the plan honest about what is already there.
4. **Update becomes observable**: `status` and `plan` can say that an installed skill has a newer
   version upstream, using the skills package's own data. Applying the update is the same install path.
5. **Removal and listing settle**: every recorded skill can be listed per harness and removed, with the
   affected directories shown before approval.

MCP and hook freshness stay untouched in this slice; plugins and discovery stay parked.

## User Stories

1. As a user, I want `agentenv status` to tell me which harnesses are present on this machine, so that I
   know what a package can target.
2. As a user, I want `status` to distinguish "installed" from "usable", so that a harness whose CLI is
   too old does not silently fail later.
3. As a user, I want a too-old harness to appear as a requirement in the plan with an update command, so
   that I can fix it in the same run.
4. As a user, I want an update to run only when I mark it, so that a plan never upgrades my tools behind
   my back.
5. As a user, I want items that depend on an outdated harness to be reported as blocked, so that the run
   does not half-succeed.
6. As a user, I want the plan to keep working after the harness update, without re-running the command,
   so that one approval covers the whole flow.
7. As a user, I want harness installation to use the default command we already ship, so that behaviour
   is predictable.
8. As a user, I want to be told when a harness has no default install path, so that I know it is my job
   rather than a silent no-op.
9. As a user, I want a harness that cannot be installed to leave the rest of the package usable, so that
   one gap does not block everything.
10. As a user, I want skills installed through the same path as today, so that nothing regresses.
11. As a user, I want a skill installation that fails on one harness to leave the others installed, so
    that a partial run is still useful.
12. As a user, I want "already installed" to mean the provider's own inventory says so, so that a skill
    deleted by hand is restored rather than reported present.
13. As a user, I want `status` to show every skill installed for each harness, including ones installed
    outside agentenv, so that the picture is complete rather than self-referential.
14. As a user, I want to see when an installed skill has a newer version upstream, so that I can decide
    whether to update.
15. As a user, I want updating a skill to use the same install path and record, so that state cannot
    drift from reality.
16. As a user, I want an update check that never writes, so that asking "what is stale?" is safe.
17. As a user, I want the plan to tell me what an update would change before I approve it, in the same
    words it uses for installs.
18. As a user, I want to remove a skill and see which directories and harnesses are affected first, so
    that removal is informed.
19. As a user, I want removal to leave the record consistent, so that `status` does not report ghosts.
20. As a user, I want the same removal rules whether the skill came from agentenv or from the CLI, so
    that I do not have to remember which tool installed what.
21. As a user, I want the sequential order respected in the tracker, so that no later phase is built on
    an unsettled earlier one.
22. As a user, I want MCP and hook staleness explicitly out of this slice, so that their known gaps are
    not mistaken for regressions.
23. As a user, I want the plugin and discovery work to stay parked, so that the foundation is finished
    before new surface is added.
24. As a user, I want every phase to be verifiable from the CLI in a disposable home, so that I can
    trust the result without reading code.
25. As a user, I want the plan's wording to stay in the glossary's vocabulary, so that "installation",
    "requirement", "verification" and "not covered" keep meaning one thing.

## Implementation Decisions

- **No new seams.** Everything is exercised through the existing ones: `buildPlan`, `applyPlan`,
  `buildRemovePlan`, `applyRemovePlan`, `verifyInstalled`, plus the CLI end-to-end suite over the offline
  fixture harness. If a phase seems to need a new seam, that is a signal the phase is scoped too wide.
- **Detection stays probe-based**, but its contract grows one clause: present is not the same as usable.
  The usable check is a requirement, parsed from the same version command the harness already declares.
- **Minimum harness version is data.** A harness definition carries the minimum version next to its
  requirement; no capability probing, no branching on CLI generations. An outdated harness yields a
  requirement row with its update command and blocks the items that depend on it.
- **"Update if marked" reuses the requirement flow**: the plan lists the update, the user marks it, it
  runs, the requirement is re-checked, and dependent items proceed. No second mechanism.
- **Default harness installation only.** A definition that has no install argv is reported as such;
  adding a fallback installer per harness is out of scope by decision.
- **Update checks come from the skills provider's own inventory**, not from scraping git. Where the
  provider cannot say, the row reports unknown rather than guessing. The check is read-only; the update
  itself reuses the install path and the existing record.
- **Listing reads the provider's inventory**, so skills installed by the CLI outside agentenv appear
  too; the record is only used for what we did (ADR-0002).
- **Removal keeps its shape** (all-harness, affected paths first, record cleaned) and answers both cases
  with the same rules: the items the record holds, and a skill the user names (`--skill <name>`) that
  agentenv may never have installed. `list` and `remove` share the inventory read, and what a removal
  could not take out is reported while the rest continues.
- **Phase gate**: each phase lands with its own tests and an end-to-end scenario before the next begins.
  The tracker holds the order; a phase is not started while the previous one is unsettled.

## Testing Decisions

- A good test asserts external behaviour only: the rows `plan` prints, what `apply`/`remove` change in a
  disposable HOME, and what `status` reports afterwards. Internal helpers and caches are not asserted.
- Modules under test are reached through the existing seams listed above; the TUI remains a formatter and
  is not asserted.
- Prior art to follow: the fake-runner + temporary-HOME tests that already cover plan/apply/remove, and
  the offline end-to-end suite that drives the CLI against a fixture harness.
- Representative cases: an old harness version yields a requirement row and blocked items; marking the
  update runs it once and re-checks; a skill removed by hand is re-installed; a skill installed outside
  agentenv appears in listing but not in the record; an update check changes nothing on disk.

## Out of Scope

- **MCP freshness and hook staleness** — allowed to stay as they are; their gaps are known.
- **Plugins and capability probing** — parked (`plugins-and-capabilities`), probe approach dropped.
- **Discovery sources** (official MCP registry, SkillFed) — later.
- **Project-level scope.**
- **Alternative installers per harness** — if the default cannot do it, we report instead of adding one.
- **Multi-generation CLI support** — stable version support only.

## Further Notes

- Ordering is a first-class requirement here, not a note: the user asked for it explicitly, and the
  tracker should be read as a queue.
- The blocked-item behaviour already exists (an unmet requirement blocks dependents); this slice makes a
  harness's own version one of those requirements rather than inventing a new gate.
- Evidence for what each harness exposes (versions, config paths, which CLIs print them) is in
  `.scratch/harnesses/research.md`.
