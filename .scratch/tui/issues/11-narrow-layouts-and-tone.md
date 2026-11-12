# 11: Narrow layouts, tone and `NO_COLOR`

**What to build:** the last sweep that makes the design hold at every width and in every terminal. Add the
59-and-below layout on top of the 60-plus one that ticket 03 ships: a 1-column gutter, the rail dropped, and
continuation lines suppressed to one line ending in `…`. Route every
row through the four tones, drop colour when `NO_COLOR` is set or the terminal is dumb, and keep dim, marks and
words. Audit the marks to ASCII (`>`, `[x]`, `[ ]`, `+`, `=`, `!`, `-`): `…` and `→` are the only
non-ASCII glyphs a mark or a pointer may use, and the copy separates its parts with `·`, `–` and `—`. Add
the width sweep as a test: every surface at 120, 80 and 40 columns, no line over the frame width, and one
`NO_COLOR` frame with no colour sequence but the same state words.

**Blocked by:** 10

**Proves it:** open each of the eight surfaces in a 120, an 80 and a 40 column window and in a `NO_COLOR`
terminal. Nothing wraps mid-token, no row loses its state word, and focus is still visible when colour is gone.

**Status:** done

- [x] The two narrow layouts exist and every surface uses them
- [x] `NO_COLOR` and a dumb terminal drop colour and nothing else
- [x] Every mark is ASCII; `…`/`→` are the only non-ASCII marks and `·`, `–`, `—` only separate
- [x] The width sweep test runs all surfaces at 120, 80 and 40 and fails on an over-wide line
- [x] `npm run check` passes and no CLI output changed
