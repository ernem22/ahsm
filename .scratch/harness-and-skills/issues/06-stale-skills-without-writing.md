# 06: Stale skills are visible without writing

**What to build:** a check that compares what is installed against what the source now offers, marking
skills that are out of date. It answers "what is stale?" safely: nothing on disk changes, and where a
comparison cannot be made the answer is unknown rather than a guess. Small research is expected inside
this ticket, because the skills package exposes no ready-made update check.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] Installed skills are compared with their source and marked up-to-date / stale / unknown
- [ ] A run of the check leaves the home directory byte-identical
- [ ] An unreachable or changed source yields unknown, never a false "up-to-date"
- [ ] The output reuses the plan's vocabulary (installation, verification, not covered)
