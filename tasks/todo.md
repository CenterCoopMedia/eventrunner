# Session task list

## 2026-09-23: burn down the open issues with stacked pull requests

Goal: close as many open issues as the sandbox allows, milestone by milestone,
as one stack of pull requests. The owner asked for this on 2026-09-23.

### Out of scope

These need operator accounts or third parties this sandbox does not have
(lesson of 2026-09-09): #35, #79, #91, #92, #96, #99, #100, #259.

#177 needs an accepted decision record before any code. This session writes the
record only (`docs/adr/0003-optional-google-calendar-sync.md`, status proposed),
and the pull request says "Refs #177", not "Closes".

### How the stack works

- Specs: every builder group gets a spec in `/home/user/specs/<id>.md`, written
  from the code and then attacked by an adversarial reviewer before dispatch.
- Every builder branch gets an adversarial review (five lenses, each finding
  checked by a skeptic) before it joins the stack.
- Builders work in parallel, each in its own worktree at `/home/user/wt-<id>` on
  branch `joe/confident-gates-gy99ip-b-<id>`, cut from the stack tip at dispatch.
  The brief is `tasks/builder-brief.md`. Each builder commits its report to
  `tasks/reports/<id>.md`.
- Builders never commit generated output except in one last commit named
  "Regenerate generated output". The director drops that commit, cherry-picks
  the rest onto the stack tip, regenerates there, runs every check, and pushes.
- Stack order: `joe/confident-gates-gy99ip` is the bottom branch. Each later
  pull request is `joe/confident-gates-gy99ip-<n>-<slug>`, based on the one
  below it. Every body keeps "Closes #n" so a top-down merge closes them all.
- At most three or four builders run at once (the machine has four cores).
  Heavy commands run under `flock /tmp/eventrunner-heavy.lock`.

### Roster

| Id | Model | Issues | State |
|---|---|---|---|
| a1 | Sonnet | #248, #227, #230, #247 | merged as #263 |
| a2 | Opus | #231, #226 | merged as #262 |
| a3 | Fable | design wave 2 of #249, #234 | reviewing the catalog split |
| a4 | Fable | #186, #187 | fixed; second review of the fixes running |
| b1 | Opus | #178, #179, #180, #181, #182 | dispatched from the tiers tip |
| b2 | Opus | #183 | dispatched from the tiers tip |
| b3 | Opus | #184, #185 | dispatched from the tiers tip |
| b4 | Opus | #188 | queued |
| b5 | Opus | #189 | queued |
| b6 | Opus | #218 | reviewed, fixed, integrated |
| b7 | Fable | #177 decision record only | merged as #264 |
| c1 | Opus | #190, #191 | queued (M10) |
| c2 | Opus | #192, #193 | queued |
| c3 | Opus | #194 | queued |
| c4 | Opus | #195 | queued |
| c5 | Opus | #196 | queued |
| c6 | Opus | #197 | queued |
| c7 | Opus | #198 | queued |
| d1 | Opus | #199 | queued (M11) |
| d2 | Fable | #200 | queued |
| d3 | Opus | #201, #202, #203 | queued |
| d4 | Opus | #204 | queued |
| d5 | Fable | #205, #206, #207 | queued |
| d6 | Opus | #208, #209 | queued |
| e1 | Opus | #210, #211 | queued (M12) |
| e2 | Opus | #212, #213 | queued |
| e3 | Opus | #214, #215, #216 | queued |

### Stack as integrated

| Pull request | Branch | Issues |
|---|---|---|
| #262 (merged 2026-09-23) | `joe/confident-gates-gy99ip` | #231, #226 |
| #263 (merged 2026-09-23) | `joe/confident-gates-gy99ip`, restarted from main | #248, #227, #230, #247 |
| #264 (merged 2026-09-23) | `joe/confident-gates-gy99ip-3-calendar-record` | refs #177 (record only; status still Proposed) |
| next | `joe/confident-gates-gy99ip`, restarted from main | #218 |
| after it | `joe/confident-gates-gy99ip-5-admin-tiers` | #186, #187 |

### After every integration

- [ ] Read every line of the builder diff before it goes on the stack.
- [ ] Regenerate on the tip, then run lint, unit, web, rules, build, and every
      `--check` last.
- [ ] Watch CI and the review bot on the new pull request.
- [ ] Update `tasks/lessons.md` after any correction.

## Design vocabulary expansion (#249): state carried from 2026-09-10

- Wave 1 merged as #254. Wave 4 landed with M8 on 2026-09-11, except #210 (M12).
- Wave 2 (text, feedback, and input devices; block types; option groups) runs
  this session as builder a3.
- Wave 3's first pass sits on `…-w3` in a worktree that no longer exists in this
  container. Waves 3 and 5 are queued after the milestones.
- Wave 6 (admin devices on the M9 to M11 pages) is built with those pages.
- Decisions still waiting on Joe from 2026-09-10: the toast tone's second signal
  is a weak rule; the segmented control and the tabs take no disabled prop;
  hover, focus and press are drawn once on the five shared shapes; an empty
  feedback message marks the field and moves focus, with no form-level alert.

## Handoff, 2026-09-24 00:00 UTC (usage limit; no fan-outs until it resets)

### Merged and open

- Merged: #262 (#231, #226), #263 (#248, #227, #230, #247), #264 (#177
  decision record, status still Proposed; #177 stays open until the owner
  accepts it).
- Open: #266 on `joe/confident-gates-gy99ip` (#218), green, no threads, waits
  on the owner.
- Filed follow-ups: #267 (redact `%40` addresses), #268 (`sent_emails`
  retention).

### Built, not yet on the stack

Worktrees live only in this container. Every branch below is local; push the
builder branches first if the container may be reclaimed.

| Id | Worktree / branch | Head | State |
|---|---|---|---|
| a4 | `/home/user/wt-a4`, `…-b-a4` | opened as #269 | #186, #187. Round 2 review found escalation paths (seo.defaultOgImagePath, speaker headshotPath, sender byte and sub-key compare, staff Media page); the builder is fixing them. Review the round 3 diff before it joins. |
| a3 | `/home/user/wt-a3`, `…-b-a3` | moved to `trial/a3-on-tiers` | Round 2 review: 18 of 23 confirmed (blocker: the CMS never clears `seeded`, so an edited When card and the seed upgrade both fail). Builder is fixing on the trial base. Then cherry-pick b1 to b3 from `trial/stack-a3-b3` onto it. |
| b1 | `/home/user/wt-b1`, `…-b-b1` | `bd2ac01` | #178 to #182. Review: 4 of 9 confirmed, minor; the director fixed them on the trial stack (`6d86f81`). |
| b2 | `/home/user/wt-b2`, `…-b-b2` | `63c1862` | #183. Review stopped: resume `wf_54fd8612-e0b`. |
| b3 | `/home/user/wt-b3`, `…-b-b3` | `46935c1` | #184, #185. Review: 6 of 9 confirmed (major: a delete failing after phase 1 with a transport error offers no retry; claims made in the token window are never released). Builder is fixing on its old base; cherry-pick the fixes onto the trial stack. |

`joe/confident-gates-gy99ip-4-admin-tiers` (local) holds a4 round 2 on
`3ccd388`, fully checked. Rebuild it from a4's round 3 commits instead.

### Trial stack, 2026-09-24 03:00 UTC

Local branches, not pushed, with every conflict already resolved:

- `trial/a3-on-tiers` (worktree `/home/user/wt-int`): a3 on #269's tip
  `0b70221`, plus two director commits: the #247 ProfilePhoto tests now
  prove the rule through the `.avatar` tokens, and Branding and the block
  editor load on demand (admin entry chunk 51,756 to 35,297 gzip). Every
  check passed on it before the lazy-load commit, except the chunk budget.
- `trial/stack-a3-b3` (worktree `/home/user/wt-int2`): b1, b2 and b3 on
  `trial/a3-on-tiers`. b1's review (4 of 9 confirmed, all minor) is fixed
  there by the director in `6d86f81`, and `36b8955` moves the seed pin to 101
  content blocks because a3 adds a key fact. b2 and b3 wait on their reviews.
- To build the real stack, take review fixes onto these: a3 fixes on the
  first, then cherry-pick the resolved b1, b2, b3 commits from the second.

### Resume order

1. Resume the four stopped reviews (the review script is
   `workflows/scripts/review-builder-branch-*.js` in the session directory;
   the brief for a new one is in this file's "How the stack works").
2. When a4 round 3 lands, review its diff, then stack it as
   `joe/confident-gates-gy99ip-5-admin-tiers` on #266.
3. Stack a3, then b1, b2, b3 on top, one pull request each. b1, b2 and b3 were
   cut from the a4 round 1 tip `426f430`; cherry-pick their commits without
   their regenerate commit. They all edit AdminApp.jsx, AdminLayout.jsx,
   functions/index.js, .github/smoke-endpoints.json, CHANGELOG and ADMIN_GUIDE,
   and the docket count. Watch the admin entry chunk budget (50,000 gzip): b1
   left it at 49,145; b3 made the attendees route lazy.
4. Dispatch b4 (#188) and b5 (#189) from the new tip with
   `tasks/specs/b4.md`, `b5.md`. b3's `PER_ACCOUNT_STORES` must gain b4's two
   stores.
5. M10: specs `tasks/specs/c1.md` to `c7.md` were written; their reviews may
   not all have finished (resume `wf_c0486301-fd0` to finish them). Then M11
   and M12 specs, builders, reviews, and the stack, as above.

### Director tools (copied into `tasks/director/`)

- `regen.sh <worktree>`: regenerate every generated output and commit it.
- `checks.sh <worktree>`: every CI tier locally, heavy steps under
  `flock /tmp/eventrunner-heavy.lock`.
- `union.py <file>`: join CHANGELOG/ROADMAP conflict blocks, ours then theirs.
- `capture.sh <worktree> <plan.json> [out]` with `capture.spec.mjs`: PR
  screenshots through the E2E harness. The server strips image embeds from
  PR bodies, so link the committed PNGs instead.

### Decisions waiting on the owner

- Accept or amend ADR 0003 (#177), with its six open questions.
- a4: absent `config/bootstrap` means no admins (fail closed); `/admin/<unknown>`
  shows the operator refusal to staff; event settings are staff with sender
  operator-only.
- a3: sticky table head dropped; one pull quote per page enforced at render;
  a `[Replace]` placeholder is never created on a launched home page.
- b2 decision 10: no sort control, no bulk row, search text kept out of the URL.
