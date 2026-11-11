# 07: Applying an update

**What to build:** updating the skills that were marked stale, through the same installation path and
with the same record: one approval, per-skill results, and a record that afterwards says what is
actually installed. No separate update mechanism, and no silent upgrade of anything the user did not
mark.

**Blocked by:** 06

**Status:** done

- [x] Marked stale skills are updated through the install path, once each
- [x] Results are reported per skill and per harness, with failures not stopping the rest
- [x] The record is refreshed so a following status run agrees with reality
- [x] Skills that were not marked are left untouched

## Comments

- The surface is `agentenv update [--yes]` (`src/core/update.ts`): `buildUpdatePlan` reads the stale report
  (06), maps each stale row to its catalogue item and the harnesses the record says it was installed for,
  and builds the ordinary plan for exactly those `(item, harness)` pairs. Entries the plan calls `already`
  are turned into `run` — a stale skill is installed again — and `applyPlan` does the work: same provider
  argv/adapter, same verification, same `state.json` record. No second update mechanism, and the plan path
  writes nothing (unit test snapshots the sandbox tree).
- A stale skill with no catalogue item, no record, or a harness this data root does not define is reported
  with its reason instead of being dropped; the provider offering no `check` reports "not covered".
- A stale row is matched to its item by scope: an item naming one skill (`skill:`) owns only that skill,
  and an item naming none (a source-level item, the shape the catalogue mostly uses) owns every skill its
  `source` holds. A source-level item is then narrowed per entry (`PlanEntry.skills`), so the install
  carries that skill's name (`{skill}` / the adapter's `skills`) instead of reinstalling the whole source;
  one entry per stale skill keeps the results per skill even when two of them share an item.
