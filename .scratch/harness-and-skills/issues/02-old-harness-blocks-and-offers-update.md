# 02: An outdated harness blocks its items and offers the update

**What to build:** when a selected harness is too old, the plan shows it as a requirement with its
minimum version and the update command, and every item that needs that harness is reported as blocked
with the reason — instead of failing halfway. If the user marks the update, it runs with the harness's
default command, the requirement is re-checked, and the items proceed in the same run.

**Blocked by:** 01 (needs the version/usable notion settled first)

**Status:** done

- [x] Plan shows the harness requirement with version, minimum and update command
- [x] Items depending on it are blocked with a reason, and other harnesses still proceed
- [x] Marking the update runs it once, re-checks the version, then continues with the items
- [x] Without marking, nothing is updated and the run reports what stayed blocked
