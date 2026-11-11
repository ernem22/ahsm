# 03: Harness installation uses only the default command

**What to build:** harness installation settles on what the definition already carries: the default
install command for this platform. Where no default exists, the plan says the harness cannot be
installed here and apply reports the same — no second installation path is invented, and the rest of the
package is unaffected.

**Blocked by:** 02 (same requirement path)

**Status:** done

- [x] A definition without an install command for this platform reports "no install command", in plan
      and in apply
- [x] A definition with a default command runs exactly that command, verbatim
- [x] A harness that cannot be installed leaves other harnesses' items usable
