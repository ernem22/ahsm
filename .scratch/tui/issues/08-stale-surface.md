# 08: The stale surface

**What to build:** `v` renders `staleLines(report)`: `stale`, `up-to-date` and `unknown` rows with the
provider's own reason attached to each, so `unknown` is never folded into `up-to-date`. When the provider
offers no update check the surface states `not covered — no provider offers an update check` instead of
listing rows. The read is slow and cancellable like the inventory. `f` cycles the state filter, `/` filters by
name, and `u` jumps to the update surface. The trailer stays as the last full-width line.

**Blocked by:** 07

**Proves it:** `v` on a machine with stale skills and one unreachable source: two `stale` rows, an
`unknown` row carrying `could not be reached — verification unknown`, and `u update these 2` on the keybar.
On a machine whose provider has no `check` argv, the surface says `not covered` and nothing else.

**Status:** ready-for-agent

- [ ] The three states render with their reasons and are never merged
- [ ] The not-covered state renders the existing sentence and lists no rows
- [ ] The read is cancellable and the cancelled copy is the specified one
- [ ] `f` and `/` narrow the set and the heading states the count
- [ ] Headless tests cover the three states, the not-covered answer and the cancel
