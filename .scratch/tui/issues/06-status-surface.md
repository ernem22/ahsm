# 06: The status surface

**What to build:** `s` renders `statusLines(report)` as two sections with their two vocabularies (`ready`,
`too old`, `absent` for harnesses; `up-to-date`, `missing`, `unknown` for items), focusable row by row, with
the focused row printed in full in the detail column and its `update:` command in full when it has one. `r`
re-reads. The empty record renders the existing `record is empty — nothing installed yet`. The surface binds
no key that writes.

**Blocked by:** 05

**Proves it:** `s` on a machine with one too-old harness: the row reads `too old  pi  1.2.0 · min 1.4` and the
detail column carries `update: npm install -g @earendil-works/pi-coding-agent`. `r` re-reads without leaving.

**Status:** done

- [x] Both sections render with their own vocabulary and no renamed states
- [x] A too-old harness shows its minimum and its update command in full
- [x] The empty record state renders the existing sentence
- [x] No key on this surface writes; a test asserts the record and the tree are untouched after a visit
- [x] Headless tests cover the two sections, the too-old row and the empty state
