# 08: Removal settles

**What to build:** removal answers both cases with the same rules: everything agentenv recorded can be
removed with the affected directories and harnesses shown before approval, and a skill named by the
user can be removed even when agentenv did not install it. Afterwards the record and status agree with
what is on disk.

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] Recorded items are removed with affected directories and harnesses shown first
- [ ] A skill agentenv did not install can be removed by name
- [ ] The record is cleaned so status reports no ghost entries
- [ ] Removal reports what it could not remove, without stopping the rest
