#!/usr/bin/env node
'use strict';

/**
 * DCO sign-off check (spec §1.5; CONTRIBUTING.md "Sign your commits").
 *
 * Verifies every commit added by a pull request carries a `Signed-off-by:`
 * trailer — the mechanical half of the Developer Certificate of Origin;
 * CONTRIBUTING.md documents the human half of what that attests.
 *
 * Deliberately a plain script, not a marketplace action:
 *   - zero secrets — reads only the checked-out git history, so a fork PR
 *     (no repo secrets, no write token) runs it exactly the same as a
 *     same-repo PR (spec §8.1's "every job must be runnable from a fork
 *     PR", extended here to the DCO job);
 *   - no third-party action pinned by a mutable tag or an unverifiable SHA
 *     entering the trust boundary of a workflow that runs on every PR;
 *   - the check is six lines of git plumbing — a dependency buys nothing
 *     here that `git log --format` doesn't already give for free.
 *
 * Usage:
 *   node scripts/check-dco.cjs <base-sha> <head-sha>
 *
 * `ci.yml` passes `github.event.pull_request.base.sha` and `.head.sha` — the
 * merge-base range for the PR, not `main...HEAD`, so a branch that started
 * before `main` moved on does not get blamed for commits it never added.
 *
 * Exit codes: 0 every commit signed off, 1 at least one is missing it,
 * 2 misuse (wrong argument count, unreadable range).
 */

const { execFileSync } = require('node:child_process');

const TRAILER_RE = /^Signed-off-by: .+ <.+@.+>$/m;

/**
 * @param {string} range `<base>..<head>` git revision range
 * @param {(args: string[]) => string} [run] injectable for tests
 * @returns {Array<{ sha: string, subject: string, signedOff: boolean }>}
 */
function checkRange(range, run = (args) => execFileSync('git', args, { encoding: 'utf8' })) {
  // %x00 separators: commit subjects/bodies can contain anything but a NUL.
  const raw = run(['log', '--no-merges', `--format=%H%x00%B%x00%x00`, range]);
  const records = raw.split('\x00\x00').map((r) => r.trim()).filter(Boolean);
  return records.map((record) => {
    const nul = record.indexOf('\x00');
    const sha = record.slice(0, nul);
    const body = record.slice(nul + 1);
    const subject = body.split('\n', 1)[0];
    return { sha, subject, signedOff: TRAILER_RE.test(body) };
  });
}

function main(argv) {
  const [base, head] = argv;
  if (!base || !head) {
    console.error('Usage: node scripts/check-dco.cjs <base-sha> <head-sha>');
    return 2;
  }
  let commits;
  try {
    commits = checkRange(`${base}..${head}`);
  } catch (err) {
    console.error(`Could not read the commit range ${base}..${head}: ${err.message}`);
    return 2;
  }
  if (commits.length === 0) {
    console.log('No non-merge commits in range — nothing to check.');
    return 0;
  }
  const missing = commits.filter((c) => !c.signedOff);
  for (const c of commits) {
    console.log(`${c.signedOff ? 'OK  ' : 'FAIL'} ${c.sha.slice(0, 12)} ${c.subject}`);
  }
  if (missing.length > 0) {
    console.error(
      `\n${missing.length} commit(s) missing a DCO sign-off.\n` +
      'Sign every commit with `git commit -s` (or `git rebase --signoff <base>` to fix ' +
      'history on this branch), per the Developer Certificate of Origin — see CONTRIBUTING.md.',
    );
    return 1;
  }
  console.log('\nEvery commit in range is signed off.');
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { checkRange, main };
