# 05: Skill inventory per harness

**What to build:** a read-only listing that answers "what is installed for each harness?" from the
provider's own inventory — including skills installed outside agentenv — with name, scope and the
harnesses that have them. This is the first surface that is not limited to what agentenv itself did.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Listing shows installed skills per harness from the provider inventory
- [ ] Skills installed outside agentenv appear in the listing
- [ ] The listing marks scope and which harnesses carry each skill
- [ ] Listing writes nothing and does not depend on the record being intact
