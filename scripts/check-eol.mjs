#!/usr/bin/env node
/**
 * Line-ending guardrail: the repo keeps one form (LF in the index *and* in the worktree — see
 * `.gitattributes`). CRLF keeps leaking back into the worktree while the index stays LF, which shows
 * up as a diff that is not a change. This reads git's own report (`git ls-files --eol`), so it costs
 * one git call and never scans file contents itself.
 *
 * A worktree file that differs from the index only in EOL shows as ` M` in `git status` with an empty
 * `git diff` — exactly the state this guardrail exists to kill.
 *
 * Only `w/crlf` fails: the index being CRLF (`i/crlf`) is reported by git as the other direction and
 * is what `git add --renormalize .` fixes, so it must not fail here.
 */
import { execFileSync } from 'node:child_process';

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return undefined;
  }
}

const eol = git(['ls-files', '--eol']);
if (eol === undefined) {
  // Not a git checkout (tarball, CI export): there is no index to compare the worktree against.
  console.log('line endings: no git checkout, skipped');
  process.exit(0);
}

const crlf = eol
  .split('\n')
  .filter((line) => line.includes('w/crlf'))
  .map((line) => line.split('\t').pop()?.trim())
  .filter(Boolean);

if (crlf.length === 0) {
  console.log('line endings: LF everywhere');
  process.exit(0);
}

console.error(`line endings: ${crlf.length} file(s) have CRLF in the worktree while the index keeps LF:`);
for (const file of crlf) console.error(`  ${file}`);
console.error('');
console.error('fix: convert the files above to LF in the worktree, then run `git add --renormalize .`');
process.exit(1);
