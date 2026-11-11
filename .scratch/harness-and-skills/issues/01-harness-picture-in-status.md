# 01: Harness picture in status

**What to build:** `agentenv status` gains a harness section: for every harness the definition knows,
whether it is present on this machine, the version its own CLI reports, whether that version meets the
declared minimum, and — when it does not — the update command we would run. Read-only: asking the
question must never change anything.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `status` lists every harness with present/absent, version and usable/too-old
- [x] An absent harness is shown as absent, not as an error
- [x] A harness whose version is below the declared minimum shows the suggested update command
- [x] Running `status` writes nothing to disk (verified against a disposable home)
