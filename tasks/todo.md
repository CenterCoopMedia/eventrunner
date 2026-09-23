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

## Paused 2026-09-23 23:50 UTC (usage limit)

Resume in this order:

1. Re-run the stopped reviews with `resumeFromRunId` (cached agents replay):
   a3 round 2 `wf_ed110ad7-e40`, b2 `wf_54fd8612-e0b`, b3 `wf_66f76a40-f88`,
   b1 `wf_1c382032-f25`; M10 specs `wf_c0486301-fd0` (writes `/home/user/specs/c*.md`).
2. a4 round 3 (worktree `/home/user/wt-a4`) fixes the second review's escalation
   paths: seo.defaultOgImagePath, speaker headshotPath, sender byte and sub-key
   compare, staff Media page. Then put a4 on `joe/confident-gates-gy99ip-5-admin-tiers`,
   stacked on #266 (the local branch `joe/confident-gates-gy99ip-4-admin-tiers`
   holds the round 2 state on top of main's 3ccd388).
3. Stack order after a4: a3 (wave 2), then b1, b2, b3 (all built on the a4 tip).
   Watch the admin entry chunk budget (50,000 gzip) when b1, b2, b3 combine.
4. Then dispatch b4 (#188) and b5 (#189) from the new tip, and M10 from its specs.

Open: #266 (#218), green, waits on review. Filed follow-ups: #267, #268.
