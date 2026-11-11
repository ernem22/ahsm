# 07: Applying an update

**What to build:** updating the skills that were marked stale, through the same installation path and
with the same record: one approval, per-skill results, and a record that afterwards says what is
actually installed. No separate update mechanism, and no silent upgrade of anything the user did not
mark.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] Marked stale skills are updated through the install path, once each
- [ ] Results are reported per skill and per harness, with failures not stopping the rest
- [ ] The record is refreshed so a following status run agrees with reality
- [ ] Skills that were not marked are left untouched
