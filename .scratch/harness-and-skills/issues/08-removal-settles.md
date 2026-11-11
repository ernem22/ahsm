# 08: Removal settles

**What to build:** removal answers both cases with the same rules: everything agentenv recorded can be
removed with the affected directories and harnesses shown before approval, and a skill named by the
user can be removed even when agentenv did not install it. Afterwards the record and status agree with
what is on disk.

**Blocked by:** 07

**Status:** done

- [x] Recorded items are removed with affected directories and harnesses shown first
- [x] A skill agentenv did not install can be removed by name
- [x] The record is cleaned so status reports no ghost entries
- [x] Removal reports what it could not remove, without stopping the rest

## Comments

- The surface is `agentenv remove --skill <name,name>` alongside the existing
  `agentenv remove [--package id]`; a bare `remove` still means every recorded item. `planRemoval`
  (`src/core/remove.ts`) is the one entry point: it builds the same plan `buildRemovePlan` always built,
  and when a named skill no record covers exists it reads the inventory `list` uses
  (`readSkillInventory`) to fill in the harnesses and directories. A name the record already covers is
  planned from the record — same provider, same paths, same cleanup — so one removal rule covers both
  cases. The inventory is not read at all when the record already covers every name (the read costs
  ~7 s per hundred skills).
- A named skill with no record cleans no record: `applyRemovePlan` only rewrites `state.json` when a
  recorded entry actually left, so removing a hand-installed skill creates no file and no ghost.
- What cannot be removed is a row, not a stop: no provider that can remove a skill yields "not covered",
  an adapter that does not find the name in its inventory yields "not installed", a provider failure
  yields "error", and the remaining entries still run. A failed inventory read warns and plans the name
  anyway — a read must not block a removal the user asked for.
- The plan is still only a plan: `remove` without `--yes` writes nothing (unit test and e2e both snapshot
  the sandbox tree), and the affected harnesses/directories are shown before approval.
