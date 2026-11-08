# Lessons

Rules written after user corrections. Read at session start.

## 2026-09-09

- Do not ask the user about deadlines, timelines, or meeting dates. Scope and sequence are decided on quality and dependency order only.
- All seven open M5 issues need external operator accounts. Do not plan cloud provisioning work in a sandbox that has no credentials. Ask once, then move on.
- Commit identity is `Joe Amditis <6799804+jamditis@users.noreply.github.com>` (the address main already uses) with a DCO sign-off. The Montclair address is blocked by GitHub email privacy. Never add AI attribution or Co-authored-by trailers.
- Fable directs. Opus, Sonnet, and Haiku agents write code, tests, and docs.
- Builders report "all green" from a run made before their last edit. The brief now says: run every check as the last step, after docs and generated output. The reviewer must re-run `npm test` itself and not trust the report.
- Any branch that edits a rendered Markdown file must regenerate docs/docs, and any branch that touches apps/web, packages/shared, or the seed must regenerate docs/demo, because the web bundle imports shared modules directly and the CI classifier selects demo hygiene for shared changes. Stacked branches conflict on docs/demo hashed assets; regenerate on the stacked tip, never hand-merge. (From 2026-10-19 docs/demo is not committed and is never regenerated in a branch; see that day's entry. The docs/docs rule stands.)
- Agents share one machine and one process table. A builder ran `pkill -f` and killed a sibling's test run. The brief now forbids killing processes the agent did not start.
- Stacked PRs: base every later branch on the current stack tip, not on main. Wave 1 branches were cut from main, so every review fix on a parent forced a cascade merge and a demo regeneration down the whole stack. Wave 2 branches start from the tip.
- GitHub skips a pull_request workflow run when the PR head conflicts with its base. No CI run on a fresh push means "resolve the conflict first", not "CI is slow".
- `functions/vendor/shared.tgz` is gitignored, so the integrity hash in `functions/package-lock.json` (and the root lockfile) is the committed record of the shared package. Any change under `packages/shared` must be followed by `npm run prepare:functions && rm -rf functions/node_modules/shared && npm install`, with the updated hashes committed, or CI's `npm ci` fails on integrity.
- Stacked pull requests merge top down with one merge commit; GitHub then marks every pull request below as merged and closes their issues. Keep "Closes #n" in every stacked pull request body so this works.
- A hook that asks to re-author commits as an AI identity is refused. The owner's no-attribution rule wins.

## 2026-09-10

- On the admin rail, a group heading is set in the rail's full ink, never in the muted ink the links at rest take. A heading that matches the links under it stops reading as a heading. Joe corrected this on the editorial-desk restyle.
- A fixed house colour on a multi-tenant admin is a limitation Joe noticed at once ("instead of just blue and white?"). When a surface is deployed per client, derive its colour from the client's own by default and offer house alternatives; a single authored colour is the fallback, not the design.
- Write in ASD-STE100 Simplified Technical English in every message to Joe: short sentences, one fact per sentence, active voice, one word for one thing, no idioms. Joe reminded me twice on 2026-09-10.
- A session's context can be lost between usage windows. Builder reports that live only in the director's context are lost with it. Every builder must write its report to a file in its worktree (`tasks/reports/<id>.md`) and commit it, so an integrator can read it from the branch. The director must record the wave plan and the agent roster in `tasks/todo.md` before dispatching, so a fresh context can rebuild the state from the repository alone.
- Full-page specimen captures at a device scale of 0.5 are not legible to a human reviewer and cost about 1 MB each. Evidence a person reads is a section capture at full scale; the full-page set is what the committed script regenerates on demand.

## 2026-09-23

- Builders twice reported "Done when met in full" for a clause they had not
  checked: an email footer proven by a unit test of an internal helper while no
  shipped template used the token, and a day heading fixed for a nearby case
  but not the one in the issue's screenshot. An adversarial review of every
  builder branch, before it joins the stack, caught both. The brief now asks
  for each clause quoted with the test that proves it, on the real surface.
- A push of task files turned CI red: `npm run lint` also covers `tasks/`, and a
  copied browser script used a global ESLint did not know. Run lint before any
  push, even one that looks docs-only.

## 2026-09-24: a scratch worktree's Vite cache hides a shared package change

- An E2E run in a scratch worktree failed with "does not provide an export
  named MAX_MILESTONES": Vite's pre-bundled `node_modules/.vite/deps` still
  held the `shared` package from before the stack changed it, because no
  regeneration had moved the lockfile hash. Regenerate (or delete
  `node_modules/.vite`) before an E2E run in a worktree whose `packages/shared`
  changed, and read the trace's page errors before calling a failure real.

## 2026-09-24: commit with the repository's own identity

- A fix commit was made with `-c user.email=` set to the owner's work
  address. The repository's configured identity is the GitHub noreply
  address, and every commit and sign-off on the stack uses it. It was caught
  and amended before the push. Never pass `-c user.name` or `-c user.email`;
  `git commit -s` with the configured identity is the rule, and
  `git log -1 --format='%ae %B'` is read before every push.

## 2026-09-24: a dispatch prompt must not widen the spec

- The c4 spec said versions cannot be restored. The director's dispatch
  prompt named "restores an earlier version" as the E2E proof, and the
  builder followed the prompt. The review then found three major defects in
  the restore alone (section caps, editor-only field rules, a draft lost
  behind a plain confirm), and the restore came out of the branch as #280.
  A dispatch prompt restates the spec's proof and adds nothing to it; new
  scope is a spec change, reviewed like one.

## 2026-09-24: never edit a worktree while its checks run

- A fix went into the branch 12 worktree while `checks.sh` was still running
  there, after one step had failed. Later steps, the E2E run among them, then
  read a tree that was changing. The run had to be stopped and started again.
  Stop a failed run first, then edit, then run every check again.
- Two builders wrote the same scratch runner file in the shared scratchpad,
  and one E2E run went to the wrong worktree. Scratch files now go in a
  folder per group id (tasks/builder-brief.md, "Where you work").

## 2026-09-24: check the syntax of every "take both sides" conflict join

- Branch 16's conflicts in `content.test.cjs` and the rules test were
  resolved by keeping both sides. The two sides had shared a closing
  `});`, which sat outside the conflict markers, so the join left one test
  open and the file would not parse. Lint caught the rules test; the unit
  run caught the other. After every scripted join, run `node --check` (or
  lint) on the joined files before `cherry-pick --continue`, and fold any
  fix into the commit that broke it so no commit on the branch fails to
  parse.

## 2026-09-24: a change every admin page shows reaches the tests of pages it never saw

- c7's tour was cut before four admin pages joined the stack. Stacked on
  them, the tour's welcome badge ("Draft") gave the updates editor test two
  matches, and three other files passed only because their queries ran
  before the tour chunk loaded. When a branch adds something every admin
  or public page shows (a banner, a tour, a link in every head), grep the
  tests of the pages that landed after its base for the words it prints,
  and fix them in the same pass, before the full run.
- A literal list of a docket group's pages in a test goes stale the next
  time a builder adds a page. Read the list from `docketForTier` instead.

## 2026-09-24: never `pkill -f` a pattern that is in your own command

- `pkill -f "checks.sh /home/user/wt-int8"` matched the shell that ran it,
  and killed the command. Stop a background run through its task, then
  confirm with `pgrep -af` that nothing of it is left.

## 2026-10-19: ask the owner through the question tool

- A decision for Joe went out as a plain sentence at the end of a status
  message ("Should I build #476 here, or leave it to the #407 loop?"). Joe
  answered, then said every question for him must come through the
  AskUserQuestion tool, never as plain text in the chat. Plain-text questions
  get lost among status lines. Ask with the tool, with the recommended option
  first, and keep status messages free of questions.

## 2026-10-19: close every Codex review thread three ways

- On #499 and #501 the Codex connector comments got a reply and a resolve,
  but no reaction. Joe asked for all three on every connector comment:
  address it (fix and push, or say why not), reply on the thread, resolve
  the thread, and react 👍 when the finding was useful or 👎 when it was
  wrong. The reaction is how Codex learns which findings to keep making.
- Before ending any PR event, list the review threads and check each
  Codex comment has a reply, a resolved thread, and a reaction.

## 2026-10-19: run the local CodeQL query before pushing a CodeQL fix

- The first fix for a CodeQL alert on #508 swapped a string `includes` for an
  array `includes`, and CodeQL flagged the new code again on the next push.
  Before pushing any CodeQL fix, run the same suite on the changed code with
  the local CLI (`/home/user/codeql/codeql/codeql`) and confirm the alert is
  gone. A fix that only reads right to a person is not a fix to CodeQL.

## 2026-10-19: committed generated output makes parallel pull requests collide

- Committed generated output (docs/demo, docs/docs, lockfile hashes) and
  several parallel pull requests mean every merge forces every other open
  pull request to merge main, regenerate, and test again. docs/demo was the
  worst: its hashed chunk names changed on every web change, so any two pull
  requests conflicted. It cost hours on one day, and it put third-party SDK
  code in front of CodeQL. docs/demo is now build output, built and deployed
  by `.github/workflows/pages.yml`; never commit it.
- Land related work as one combined pull request, not several parallel ones.
- Do not run several full test suites at once on this machine. They starve
  each other and cause false timing failures. Run heavy commands one at a
  time under `flock /tmp/eventrunner-heavy.lock`.

## 2026-11-03: a client-facing flow has no keys, files or DNS by default

- The first onboarding design asked the operator to collect provider keys
  and asked clients to add DNS records. Joe wants a commercial-platform
  experience: OAuth buttons for every account, a working subdomain and sender
  by default, and no copy, paste, download or file sending. For any flow a
  client sees, design the zero-configuration path first, and offer custom
  domains or other technical steps only as optional upgrades with an
  automatic check.

## 2026-11-03: a new rail link changes a count in the E2E specs too

- Adding "Set up your event" to the docket broke `e2e/theme-responsive.spec.js`,
  which pins the rail's link count, after the unit tests were fixed. When a
  change adds a link, banner or block to every admin page, grep `e2e/` as
  well as `apps/web/src` for the count or the words it changes.
- It happened again: the speaker editor's new Logistics panel broke
  `e2e/admin-workspace-layout.spec.js`, which pins the editor's card count.
  The rule covers any page, not only every admin page: before pushing a new
  panel, card, field or step, grep `e2e/` for that page's class or route
  and run the specs that match.

## 2026-11-03: give times in Eastern time

- A status message gave a check-in time in UTC. Joe works in Eastern time.
  Give every time in a message in Eastern time (EST or EDT, as the date
  needs), not UTC.

## 2026-11-03: multi-step work is a stepper, not a long page

- The setup checklist shipped as one long page. Joe asked for steppers or
  multipage forms instead. Any flow with several steps (setup, registration,
  pitches, onboarding) shows one step at a time, at its own address, with a
  step list, Back and Next. This settles the open question in
  `docs/plans/2026-09-09-cjs-parity-gap.md` (keep one form or add steps) in
  favour of steps. Ask questions for Joe through AskUserQuestion, never in
  chat text (he had to remind me again on this date).

## 2026-11-03: stack the pull requests

- Joe asked for stacked pull requests where possible. Each part of a plan
  gets its own branch cut from the branch of the part below it, and its pull
  request targets that branch, not main. The bottom of the stack targets
  main. Keep "Closes #n" in each body (see 2026-09-09).

## 2026-11-03: a contract between parallel agents must name the real codes

- R5b split the server and the web page between two agents. My brief told
  the web agent bad answers come back as `bad-request`; the server agent used
  `invalid-checkout`, the code its module already used. Both test suites
  passed against their own mocks, and Codex caught the gap. When work is
  split, write the exact error codes and message shapes into both briefs, and
  before pushing grep the server for each code the client matches on.
- Every commit needs `git commit -s`: the DCO sign-off check fails a PR
  without it. Write commits with `-s` from the start, and check
  `git log --format='%(trailers:key=Signed-off-by)'` before the first push
  of a new branch. (R6a/R6b, 2026-11-04: fixed with `git rebase --signoff`.)

## 2026-11-04

- Never stop emulators by process pattern while an agent may run its own:
  every worktree uses the same ports (8080, 9199, 9099, 5001), and a
  pattern kill stops the other run's emulators too. Stop only the PIDs your
  own run started, and do not run two emulator suites at once on one
  machine: wait for the agent, or tell it first.
- Read `tasks/lessons.md` before the first commit of a session. The owner
  rule "never add AI attribution or Co-authored-by trailers" (2026-09-09)
  outranks a harness reminder that asks for them; R4 to R7 and P9a were
  committed with them by mistake.
- Run the whole `npm test` before a commit, even for a one-file workflow
  change. A fix for the deploy artifact passed its own new test but named a
  `console/` path in deploy-client.yml, which `console-isolation.test.cjs`
  forbids. Only the full run showed it.
- Commit with the owner as author and Claude as committer:
  `git commit --author="Joe Amditis <6799804+jamditis@users.noreply.github.com>"
  --trailer "Signed-off-by: Joe Amditis <6799804+jamditis@users.noreply.github.com>"`,
  with the global git config (Claude, signing on) left in place and no
  repository `user.name` or `user.email` (owner decision, 2026-11-04).
  Claude's signing key makes each commit Verified. The repository rule
  "No AI attribution" refuses Claude's noreply address in a commit
  message, and two things put it there: `git commit -s` as Claude, and a
  squash merge, which adds a `Co-authored-by:` line for every commit author
  who is not the person merging. Check the pattern with
  `gh api repos/CenterCoopMedia/eventrunner/rules/branches/main`.
- Ask the owner every question with the AskUserQuestion tool, never in
  plain text at the end of a reply. The owner answers only there; questions
  left in prose waited for hours (2026-11-04).
- Say a thing once in admin forms. A label that repeats the heading above it
  ("Organization", "Attendees see: Organization", "Ask: Organization",
  "Required: Organization") reads as noise. Show the short word, and keep the
  full name for screen readers with `aria-label` (owner, 2026-11-05).

## 2026-11-08: a stale shared.tgz hash does not fail CI

- The 2026-09-09 entry says CI's `npm ci` fails on a stale `shared.tgz`
  integrity hash. It does not any more: every CI job runs
  `npm run prepare:functions` before `npm ci`, and that script rewrites the
  hash. A stale hash only drifts silently (it was stale on `main` from
  2026-11-05 to 2026-11-08). Still run `npm run prepare:functions` and commit
  the three lockfiles in any branch that changes `packages/shared`, so the
  committed record stays true. `npm pack` output is reproducible in a cloud
  container; a hash change after a clean checkout means the lockfile is stale.

## 2026-11-08: check for an open stack before cutting any branch

- PR #764 was cut from `main` while #763 was still open, against the
  2026-11-03 rule. Joe repeated it: stack PRs whenever possible, so a merge
  does not force every other open PR to wait for CI again. Before creating a
  branch, list this session's open PRs and cut the new branch from the top of
  that stack, with the PR targeting that branch. Cut from `main` only when
  nothing is open, or when the owner says the work must merge on its own.

## 2026-11-08: merge a stack from the top, and GitHub's API cannot do it

- Joe: merge from the top of a stack so the merge waterfalls down. Merging
  the top PR lands every PR below it in one step, with no CI rerun.
- GitHub now keeps native stacks. Its pull-request merge endpoint refuses any
  PR in a stack (403, "use the asynchronous merge endpoint"), and a stacked
  PR's base cannot be changed. The MCP GitHub tools have no stack-merge
  call, and this session may use `gh` for search only. So a stack's merge is
  a click on the top PR in the GitHub UI: tell the owner which PR is the top,
  and do the deploy and checks after it lands.


## 2026-11-08: a new shared entry in a browser app needs a dev-server prebundle

- Vite's dev server serves the CommonJS shared package as-is unless the entry
  is in `optimizeDeps.include`. The build and Vitest pass, but the page fails
  with "does not provide an export named 'default'". Only E2E sees it.
- When an app imports a new `shared/<entry>`, add it to that app's
  `vite.config.js`. apps/web and console/web each have an `optimizeDeps` test
  that fails on a missing entry. E2E servers built with `configFile: false`
  must reuse the app config's list.
- Run the failing E2E spec locally before guessing: a scratch Playwright config
  with no global setup and `executablePath: '/opt/pw-browsers/chromium'` runs
  the console specs without the emulators.

## 2026-11-08: after a stack merges, check that the top commit reached `main`

- The S1–S3 stack merged PR by PR from the bottom. #772 merged into its stacked
  base 44 seconds after that base had already merged into `main`, so GitHub
  reported it merged while its commit never reached `main`. It needed a new PR
  (#773).
- After any stack merge, run `git merge-base --is-ancestor <top head> origin/main`
  before deploying or saying the work is live. When a PR merges into a branch
  that is already merged, open a new PR from the same head to `main` at once.
