# 04: Skill installation is verified, not assumed

**What to build:** installing skills settles on evidence rather than on our own record: the result is
decided by the provider's inventory, a skill deleted by hand is installed again, "already installed" is
only claimed when the inventory confirms it, and a failure on one harness leaves the others installed
and reported.

**Blocked by:** 03

**Status:** done

- [x] A fresh install reports installed, and a second run reports already installed without writing
- [x] A skill deleted by hand reappears on the next run
- [x] A failure on one harness is reported per item while other harnesses finish
- [x] The record reflects only what actually landed
