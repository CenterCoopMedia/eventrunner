# Session task list

## 2026-10-19 (wave 2): burn down issues toward the NC Local launch

Goal: a ready-to-start NC Local site in mid-November (early bird tickets and a
session pitch call), then the backlog an agent can finish without the owner.
Each PR is cut from the stack tip. Bottom branch: `joe/blissful-einstein-9qvtd1-1-<slug>`;
later PRs `joe/blissful-einstein-9qvtd1-<n>-<slug>` based on the one below.
The old `joe/blissful-einstein-9qvtd1` remote branch was merged as #491 and a
force reset was refused, so it is not reused.

Out of scope: #475-#478 and #345 (the #407 design loop owns them), operator
issues (#35, #79, #91, #92, #99, #100, #259), product decisions (#177, #325,
#326, #327, #333-#336, #338). Already fixed on main: #355, #388, #488.

| Id | Issues | Worktree | State |
| --- | --- | --- | --- |
| r1 | Launch rehearsal (NC Local shape, emulator) | read-only on main | done: no hard blocker, 7 gaps |
| l1 | Launch gaps: Get tickets before catalog, catalog stale warning, empty cart copy, Stripe onboarding docs | /home/user/wt-l1 | dispatched |
| l2 | Launch gaps: CTAs to hidden sections, seeded empty pages, home footer section, launch recipe docs | /home/user/wt-l2 | dispatched |
| l3 | #476 event-timezone date and time fields (pitch deadline, catalog sales windows) and the pitch call saved message; Joe approved 2026-10-19 | /home/user/wt-l3 | dispatched |
| w1 | #324 pitch receipts and decision notifications | /home/user/wt-w1 | dispatched |
| w2 | #357, #356 Eventbrite webhook registration and signing | /home/user/wt-w2 | review fixes in progress |
| w3 | #346 docs leftovers | main checkout | PR #492 |
| d1 | #354 CI gate and DCO from base | main checkout | PR #493 |
| w4 | #328 repeat event template | /home/user/wt-w4 | dispatched |
| w5 | #200 live update audience and key dates | — | queued |

Every builder branch gets an adversarial review before it joins the stack.

## 2026-10-19: NC Local pilot launch site (session pitches, native or Airtable)

Goal: close Catherine Komp's October 12 asks for a mid-November launch site
with early bird tickets and a session pitch call to action. The pitch form must
work as this site's own form or as a link to an external form (Airtable).
Stripe ticketing (#484-#486) and multiple events (one deployment per event)
are already done. #476 (deadline controls) belongs to the #407 loop and stays
out of this change. #324 (receipts) was not asked for.

Design: `config/pitch_call` gets one optional field, `externalFormUrl`
(https URL or null). No Airtable API key and no sync: the site links to the
Airtable form, and staff bring answers back with the existing CSV import.

- [x] Shared: `readPitchFormUrl` (https only) in `packages/shared/src/pitch.cjs`.
- [x] Functions: `updatePitchCall` validates, stores and audits `externalFormUrl`.
- [x] Functions: `submitSessionPitch` refuses native intake while an external form is set.
- [x] Admin: call settings choose "This site's form" or "An external form" with a URL field.
- [x] Public `/pitch`: external mode shows status, deadline and one link to the form.
- [x] Home: a "Pitch a session" action in the lead while the call is open.
- [x] CSV import: accept Airtable's checkbox export (`checked`) and ignore extra columns.
- [x] Tests: shared unit, rules/handler, web unit, E2E where the flow changes.
- [x] Docs: admin guide launch-site recipe and Airtable steps; changelog; generated docs/demo.
- [x] Run every check last; independent review; PR; draft email to Catherine.

Review: an independent review found that an update without `externalFormUrl`,
a read error on `/pitch`, and an http address in the admin could each reopen
or misreport native intake. All three are fixed with tests. The full check run
also exposed a date-bound Schedule test that fails on main since October 17;
it now uses a far-future day. Local E2E needs Chromium without its sandbox
(root container); the pitch and Stripe specs pass that way, and CI runs the
full suite with the sandbox.


## 2026-10-13: Stripe ticket commerce epic #483

Goal: open the complete MVP implementation as a reviewable stack, address connector
review threads, and finish with green required CI. Merchant configuration and live
cutover are separate, as the epic states. Preserve existing providers and one queue.

| Slice | Owner | State |
| --- | --- | --- |
| Catalog, checkout, holds, purchaser recovery | Checkout builder | Implemented; integration review |
| Provider, webhook, reconciliation, claim races | Provider builder | Implemented; deployment wiring review |
| Attendee and organizer UI, browser evidence | UI builder | Implemented; integration review |
| Organizer APIs, email, rules, ADR/runbook, PR stack | Director | Integrating and validating |

- [x] Read epic, related issues, contributor instructions, and ticketing architecture.
- [x] Implement isolated slices with synthetic regression coverage and signed commits.
- [x] Review payment/expiry, claim/refund, demo-write, and repeated-checkout races.
- [ ] Verify complete integrated Node/web/rules/build/generated outputs.
- [ ] Open foundation, organizer operations, and UI/runbook PRs in dependency order.
- [ ] Resolve supported connector findings and verify CI on every final PR head.
- [ ] Record hosted browser evidence and the separately unrun Stripe sandbox rehearsal.

## 2026-10-11: product trailer and task tutorials

Goal: make a 45-second customer-facing trailer and three single-task tutorials,
each in landscape and vertical. Follow `docs/video-production.md` and the four
linked piece specs. Keep private production inputs and outputs outside the checkout.
Preserve all earlier task records below.

- [x] Read product, contributor, design, and workflow documentation.
- [x] Find brand assets, fonts, local emulator setup, and capture helpers.
- [x] Complete the creative interview and record dated decisions in the specs.
- [x] Draft acts, frame ranges, two-cut layouts, source claims, and review gates.
- [x] Receive approval of the proposed acts and timing before build or render.
- [x] Create the isolated `video/` kit and a fully fictional local fixture.
- [x] Verify capture privacy, blocked external traffic, and repeatable boxes (79 landscape and 81 vertical delivery captures).
- [x] Implement shared clock, scenes, tutorial planner, synth, and meaningful tests.
- [x] Prove defect tests fail on controlled bad inputs, then restore them.
- [x] Inspect the exact Boardwalk PR #24 reference and retire the rejected trailer treatment.
- [x] Review the 20-second study; record Joe’s request for original constituent-part animation and richer music.
- [x] Build a new 45-second illustrated trailer and a separate original 112 BPM arrangement.
- [x] Independently review semantic relationships and source freshness; fix the camera-boundary findings.
- [x] Review both cuts as stills and check fast-act partial renders for flashes.
- [x] Render all eight public MP4s; measure every final file and inspect contact sheets.
- [x] Produce tutorial transcripts and the public preview page without autoplay.
- [x] Complete independent source review; fix camera, title overlap, and export-freshness findings.
- [x] Commit with the repository’s GitHub noreply identity and DCO; open [draft PR #480](https://github.com/CenterCoopMedia/eventrunner/pull/480) with public evidence.
- [x] Deliver all ten cuts and measured results; identify the remaining full headphone and laptop-speaker watch/listen before release.

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
| b2 | `/home/user/wt-b2`, `…-b-b2` | `63c1862` | #183. Review: 13 of 17 confirmed (the preview can still navigate its frame by SMIL, declarative shadow DOM, and reparse; a forged cursor throws; Load more drops a pending search). Builder is fixing on its old base; cherry-pick the fixes onto the trial stack. |
| b3 | `/home/user/wt-b3`, `…-b-b3` | `aab2b49` | #184, #185. Review: 6 of 9 confirmed; fixed by the builder and on `trial/stack-a3-b3` (`ec94446`..`5c2ae53`). |
| b4 | `/home/user/wt-b4`, `…-b-b4` | cut from `5c2ae53` | #188. Dispatched 2026-09-24 03:30 UTC; adds its stores to b3's `PER_ACCOUNT_STORES`. |
| b5 | `/home/user/wt-b5`, `…-b-b5` | cut from `4426143` | #189. Dispatched 2026-09-24 03:25 UTC. |

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

### The stack from #270 up (2026-09-24 04:50 UTC)

Handoff updates now ride on the top branch of the stack, so the lower pull
requests stay stable.

| PR | Branch | Issues | State |
|---|---|---|---|
| #270 | `joe/confident-gates-gy99ip-6-design-wave-2` | #234, refs #249 | Codex round fixed and resolved; green |
| #272 | `joe/confident-gates-gy99ip-7-admin-overview` | #178 to #182 | Codex round fixed (`323fa9f` saves need a live session, `3553711` one read-only transaction for the figures, `1a1157c` event clock for countdowns), resolved; green. Also `4f82523` returns the speaker and session editors to their lists |
| #273 | `joe/confident-gates-gy99ip-8-email-log` | #183 | Rebuilt on #272 after its fixes (force-pushed with a lease); Codex found nothing; green |
| #274 | `joe/confident-gates-gy99ip-9-attendees` | #184, #185 | Codex round fixed (`8aebebf` a bookmark re-reads its account in the transaction, `8515ccb` the export is built per chunk with a 10 MB limit), resolved; green locally |
| #275 | `joe/confident-gates-gy99ip-10-change-requests` | #188 | b4's feature, report and seven review fixes on #274 in `/home/user/wt-int2`. Codex round fixed in `1cb0a0c`: the store reads `users/{uid}` in its transaction (an account delete wins), a changed retry under a used key is 409 and both forms take a new key on an edit (`lib/submissionKey.js`), and a removal the listener delivers first keeps its row |
| #277 | `joe/confident-gates-gy99ip-11-materials` | #189 | b5's feature and review fixes in `/home/user/wt-int`. Codex round fixed in `ae2f3dd`: the archive holds at most 9 MiB (a streamed 2nd-gen response stops at 10 MB), each session keeps its own folder, and a file that leaves the list leaves the selection |
| #281 | `joe/confident-gates-gy99ip-12-organizations` | #192, #193 | c2 in `/home/user/wt-int3`. The change request dialog loads on demand (the demo chunk was 82 bytes over). Codex round fixed in `03e71d7`: the editor waits for both listeners, a resume reports the failed run's ids, the create form moved to `new/organization`, and a package limit must be a whole number of 1 or more |
| #283 | `joe/confident-gates-gy99ip-13-updates` | #190, #191 | c1 in `/home/user/wt-int4`, plus the same resume fix for the updates list (`c6dd433`); Codex found nothing |
| #284 | `joe/confident-gates-gy99ip-14-versions` | #195 | c4 in `/home/user/wt-int5`, read-only (the restore became #280). Codex round fixed in `69c7696`: each listener keeps its own error, and a record's versions show only under its own address |
| #286 | `joe/confident-gates-gy99ip-15-unpublished` | #196 | c5 in `/home/user/wt-int6`; the version pages import its collection list; the link tests now test the docket rule. Codex round fixed in `dc07a3b`: a stale table's publish waits, and a partial publish names what went out; the listener cost is #287. #284's fixes merged in `f1d560e` |
| #288 | `joe/confident-gates-gy99ip-16-timeline` | #194 | c3 in `/home/user/wt-int7`, with the History list on the eager path (spec); the feedback dialog loads on demand to make room. Branch 15 merged in `58376b9`. Codex round fixed in `18b9213`: the editor waits for both listeners, each listener keeps its own error (five other hooks filed as #289), a resume keeps the failed run's ids |
| #290 | `joe/confident-gates-gy99ip-17-editor-tour` | #198 | c7 in `/home/user/wt-int8`, stacked before c6 because it needed no fix round. `3d454c4` gives the History section its edit link (c3's spec: the branch that lands second wires it); `dea7e64` marks the tour ended in the tests of the four pages c7 never saw |

M10: spec reviews finished for c1 to c7 (specs in `/home/user/specs/`). c1 (#190, #191) and c2 (#192, #193) were dispatched 2026-09-24 05:25 UTC from #274's tip `874976f` in `/home/user/wt-c1` and `/home/user/wt-c2`; c4 (#195) and c5 (#196) from `6a47f70` in `/home/user/wt-c4` and `/home/user/wt-c5`; c6 (#197) at 06:30 UTC from #275's head `5992a68` in `/home/user/wt-c6`. c2 reported done at 06:28 (`93cb0b7`, regenerate `39ab249`); its adversarial review is workflow run `wf_7b4186fd-ba7`. c5 reported done at 06:45 (`1838be3`, regenerate `78fac23`); its review is `wf_e1aebb22-c01`. c3 (#194) was dispatched at 06:47 from c2's unreviewed tip `39ab249` in `/home/user/wt-c3`, to keep four builders busy; c2's review fixes join c2's commits when the stack takes them, before c3's. Order: c5 before c7 (banner, then tour). Next: c7 from c5's tip when a slot frees, then M11 and M12 specs.

PR #277 (branch 11, #189) is open on #275 and completes M9.

State at 10:10 UTC: branches 12 to 17 are pushed (#281, #283, #284, #286, #288, #290); #290 is the top. Next on the stack: c6 (#197) as branch 18. An independent check of c6's first fix round found two regressions in `321ff50` (switching list type splits the list; Ctrl+Z after a list lift duplicates text) and three smaller faults; c6 is in a second fix round in `/home/user/wt-c6` with the director's decisions (the check's probes are in `scratchpad/c6-verify/` in the session directory). The demo's initial chunk is the tightest budget: 290,912 of 292,000 gzip bytes on #290.

M11 and M12: all nine specs (`/home/user/specs/d1.md` to `d6.md`, `e1.md` to `e3.md`) are written and reviewed (`wf_13b84c3f-590`). Builders, each in `/home/user/wt-<id>` on `joe/confident-gates-gy99ip-b-<id>`:

| Id | Issues | Base | State |
|---|---|---|---|
| d3 | #201 to #203 | `a990720` | building (Opus) |
| d4 | #204 | `a990720` | done (`c0bf546`, report `e1cf9a8`, regenerate `3222aaa`); adversarial review `wf_b1bdb81e-181` running |
| d5 | #205 to #207 | `a990720` | building (Fable) |
| d1 | #199 | `6121af5` | building (Opus) |
| e1 | #210, #211 | `e90822d` | building (Opus) |
| d2, d6 | #200; #208, #209 | | queued for the next free slot |
| e2 | #212, #213 (and #271 first) | | after e1; it imports e1's `speakerSessions` |
| e3 | #214 to #216 | | cut from d4's reviewed branch |

Builders cut from `a990720` (d3, d4, d5) predate c7's tour: when they stack on #290, any new admin shell test must call `markTourDone`, and any E2E state locator must read inside the page header (see `tasks/lessons.md`). The node_modules of stacked builder worktrees (a1, a2, a3-review, b1 to b7, c1 to c5, c7) were removed to free disk.

Review rounds (2026-09-24 07:10 UTC): c2 fixed and stacked as branch 12. c1 (the update editor adopted the live doc before the drafts listener reported, so a save could overwrite the draft; a partial date saved as undated) and c5 (nine minor findings; the director chose the 20 newest failed runs by `requestedAt` desc with a composite index, and accepts up to +3,400 raw bytes on the admin entry chunk) are in their fix rounds. c4's review is `wf_6b43322b-dd2`. Findings files: `scratchpad/cN-findings.json` in the session directory. After c1 and c5 are fixed, they stack as branches 13 and 14; then c3 on c2, c4, c6, c7 on c5.

M11 and M12 specs: workflow run `wf_13b84c3f-590` writes `/home/user/specs/d1.md` to `d6.md` and `e1.md` to `e3.md` from `/home/user/wt-spec` at `b74383b`; #271 is in e2's scope, before #213.

The `AdminSpeakers.test.jsx` failure under load was a real bug (see `4f82523`).
The demo's initial chunk is at 291,069 of 292,000 gzip bytes after b4.
`tasks/director/checks.sh` now keeps a failing step's whole output in
a private file from `mktemp`; run it from the top branch's
worktree, since the main worktree holds the #269 branch.

Filed: #271 (a session material's storage path is not confined to its
session folder; fix before #213), #276 (feedback has the same
changed-retry flaw Codex found in change requests), #278 (a single
material over 10 MB cannot be downloaded, the same streaming cap) and #279
(the page and session editors adopt the live doc before the drafts listener
reports, the race c1's review found), #280 (a safe restore of a version),
#282 (the pages list reports a resume against the wrong ids) and #285 (the
E2E publish check waits on any listener, and a listener retry outlasts its
timeout).

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
