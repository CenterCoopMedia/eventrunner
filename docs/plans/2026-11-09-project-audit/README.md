# Project audit

Date: 2026-11-09. Code read at commit `bc07c19` on `main`. Line numbers in
these files point at that commit. They drift as the code changes.

The audit looked for four things in every part of the repository: defects,
places that must agree and do not, waste, and code or files that nothing uses.

## How it was done

- Baseline first: lint, the copy check, the documentation checks, the
  generated-content check, the audit policy, 4,699 unit tests, 4,306 web tests
  and 290 console tests. All passed before any change.
- Ten read-only passes, one per area. Each wrote one file in this folder. Each
  claim cites `path:line`.
- The director read the code again for every finding before a fix. Each bug
  fix has a test that failed before the fix.

Limits. The passes did not read every line. Each file ends with a "Files
read" section that says what was read in full and what was only searched. The
rules tests under `tests/`, the largest operator scripts, and static JSX
markup had the least reading. The emulator suites (rules, E2E) were not run
here; the pull request's CI runs them.

## Files

| File | Area | Findings |
|---|---|---|
| `01-functions-ticketing.md` | `functions/src/ticketing` | 9 |
| `02-functions-core.md` | Functions: email, admin, cms, core, auth, public, telemetry | 15 |
| `03-functions-features.md` | Functions: speakers, materials, schedule, users, imports, media, sessions, reminders | 10 |
| `04-web-admin.md` | `apps/web/src/admin` | 9 |
| `05-web-public.md` | Public components and pages | 13 |
| `06-web-lib.md` | Web lib, hooks, contexts, WebMCP, app config | 11 |
| `07-shared-rules.md` | `packages/shared`, rules, indexes, `firebase.json`, `.env.example` | 12 |
| `08-console.md` | Client console | 12 |
| `09-scripts-ci.md` | Scripts, workflows, root config, E2E | 10 |
| `10-docs-tasks.md` | Docs, tasks, video, design | 17 |
| `11-doc-fixes.md` | The documentation corrections made, and those left | |

The area files are the passes' own notes, not edited. Where a file and this
page disagree, this page is the later word.

## Fixed in the audit pull request

| # | Defect | Source |
|---|---|---|
| 1 | Admin ticket list never gave a cursor, so staff saw the newest 100 tickets and no "Load more". Ticketing status never showed the last delivery or the oldest queued order. Stored dates were tested with `instanceof Date`; the Admin SDK returns a `Timestamp`. | 01 #2 |
| 2 | CSV ticket import stored `createdAt` and `updatedAt` as epoch numbers. | 01 #1 |
| 3 | `logClientError` answered 500 and `onSystemErrorCreated` failed every delivery on a postmark site with the operator notifier `none` or `webhook`. | 02 #1 |
| 4 | The publish-queue diagnostic always reported 0 published. | 02 #2 |
| 5 | The `{{login_url}}` email token pointed at `/login`; the route is `/signin`. | 02 #4 |
| 6 | `updatesMeta` answered 500 for an id with an encoded slash, a dot segment or a bad escape. | 02 #7 |
| 7 | A speaker's own profile read returned `email` from a staff import's queued edits. | 03 #2 |
| 8 | A staff alt-text save scanned all twelve CMS collections to read two config documents. | 03 #1 |
| 9 | The schedule share triggers initialized the Admin SDK when the export barrel loaded. | 03 #3 |
| 10 | The unsaved-changes guard stayed off after one Discard while the same editor instance lived. | 04 #1 |
| 11 | The attendee directory cut a letter group in two at an accented name (duplicate keys and ids). | 05 #1 |
| 12 | The speaker page listed hidden sessions in draft preview and the snapshot fallback. | 05 #4 |
| 13 | The schedule page rebuilt the whole programme text on every render. | 05 #5 |
| 14 | The change request list used a border class the theme does not define. | 05 #2 (first of three) |
| 15 | WebMCP kept the old tier's tools registered after an admin tier change. | 06 #1 |
| 16 | The `.ics` download revoked its blob URL before the browser read it. | 06 #2 |
| 17 | Local CI skipped the console tests and build that the hosted jobs it replaces run. | 09 #1 |
| 18 | A change to `console/README.md` did not select the copy check that scans it. | 09 #3 |
| 19 | `prepare:functions` changed `package-lock.json` with no change in the shared package on npm 10.9, which makes local CI refuse the worktree. | Baseline run |
| 20 | Console README: name limit (27, not 30) and the settings save. | 08 #1, #2 |
| 21 | Documentation statements the code contradicts. | `11-doc-fixes.md` |

## Follow-up (2026-11-09)

The owner decided each item in the list below on the same day. Four stacked
pull requests closed them: #783 (defects, rules, data handling), #784 (the
half-built features), #786 (docs and repository weight) and #787 (dead code
and refactors). `tasks/todo.md`, "Plan for review: audit follow-up", has the
decision and the result for each item.

Still open after the follow-up:

- `getSiteContent` stays deployed. A deploy stops on a function that left
  the code until an operator deletes it for each client site (A 10, D 2).
- The four one-time migrations stay in the deploys until every site has run
  them. Each now has a completion marker (D 1).
- The console `applications` read grant stays, by decision (B 2).
- The WAV audio stays: the video kit checks each file against a stored
  hash. The evidence folders that a GitHub thread names stay (D 6).
- `deploy-client.yml` action pinning, App Check in ADR 0007, the
  `VITE_` variables, and `video/tests` in CI were not in the follow-up
  (B 6, B 7, C 2, C 3).
- The Eventbrite adapter, the sync resume token included, is not verified
  against the live API. Issue #79 has the acceptance criteria.
- The public demo's initial bundle is about 100 gzip bytes under its
  limit. The next first-paint change needs room made first.

## For the owner to review

Ordered by effect. Each line names the area file and finding that holds the
evidence.

### A. Probable defects that need a product decision

1. **Nothing sets `config/event.announcedAt`.** The seed writes null, and no
   admin page, script or runbook sets it. `getEventPhase` then returns `draft`
   on every client site for good: registration answers never lock, the home
   countdown never draws, and the ended and archived states are never reached.
   Decide between Announce and Archive controls in Event settings, or a value
   set at launch. (07 #1; `validateEventConfig` also does not check the two
   fields, 07 #6)
2. **Custom web address.** The runbook describes an add flow that
   `admin/webAddress.cjs` refuses for every tier. Nothing in the repository
   creates `web_address/current`, and the add helpers are dead. (02 #3)
3. **Private routes missing from `firebase.json`.** `/dashboard`,
   `/registration`, `/tickets/mine` and `/tickets/status` fall to `routeMeta`,
   so each load costs a function call and a query, and they get no `noindex`
   header. The runbook says an authenticated route belongs in the private
   block. Recommended; not done here because it changes hosting. (07 #2)
4. **Email log sources.** Eight sources the server stamps have no label, so
   they show as "Other email" and cannot be filtered. The labels need your
   words. (04 #2)
5. **Tickets "Load more"** sends the form's current filter with the previous
   search's cursor. Now that the cursor works (fix 1), this is reachable. (04 #4)
6. **Imported tickets already stored with numeric dates** (before fix 2) sort
   apart from the others. Decide if a one-time correction is wanted. (01 #1)
7. **`/updates/:id` tab title** changes from the update's title to "Updates"
   when the app starts. (05 #3)
8. **Two undefined Tailwind classes** remain: `text-status`
   (`SpeakerSessionMaterials.jsx:248`) and `text-body-lg`
   (`SessionPitch.jsx:154`). They emit no CSS; the intended tone and size are
   yours to name. (05 #2)
9. **Console: a refused agreement acceptance can spend a daily slot**, against
   its comment. `takeSlotIn` exists for this. (08 #5)
10. **`ticketingSync` would time out** on a real Stripe event if called (60 s
    limit, up to 50 pages). It has no caller today. (01 #5)

### B. Security and data handling

1. `storage.rules` keeps a world-readable `exports/` path that nothing writes
   or reads. (07 #3)
2. Console rules let any member read whole `applications` documents, with
   fields the API gives operators only. The browser never reads Firestore.
   (08 #3)
3. Two per-IP rate-limit collections (`client_error_rate_limits`,
   `feedback_rate_limits`) are never swept. (02 #5)
4. Session pitches (uid, email, free text) are not cleared when an attendee is
   deleted. (03 #6)
5. Material approve, reject, create, update and delete write no `admin_logs`
   row. (03 #5)
6. `deploy-client.yml` uses mutable action tags, one third-party; the other
   privileged workflows pin SHAs. (09 #8)
7. ADR 0007 lists App Check as a console control; the console has none. (08 #6)

### C. CI gaps

1. Path-selected tiers skip unit tests that read files outside their tier. An
   `apps/web`-only or `firestore.rules`-only pull request does not run
   `npm test`, yet some of those tests read those paths. (09 #2)
2. `video/tests` never run in CI. (09 #10)
3. Client builds pass two `VITE_` variables nothing reads, and never set
   `VITE_BUILD_ID`, so problem reports carry an empty version. (06 #5, 07 #7)

### D. No longer needed (your decision to delete)

1. One-time migrations still run on every deploy:
   `migrate-security-data`, `migrate-pitch-declined`,
   `migrate-console-signup-links` (no completion marker; it rewrites every
   quarantined draft each time) and `dispatch-security-rollout`. The
   repository cannot prove they are finished on every site. (09 #5, #6)
2. Deployed endpoints with no caller: `ticketingSync`,
   `createUserFromTicket`, `getSiteContent`. The `account.welcome` template
   has no sender. (01 #5, 02 #9, #10)
3. Dead fields and code: `ticketsPersisted`, order status `cancelled`,
   `claimPromptSentAt`, `features.ticketing`, the speaker link primitives,
   `review.settings` readers, status tables only tests read. (01 #3, #4;
   03 #4; 07 #5; 08 #8)
4. About 3.5 MB of demo-only files ship in every client build from
   `apps/web/public/`; four files have no reference at all. (06 #3)
5. Unused exports, CSS rules, Tailwind keys and five specimen-only
   components. (04 #5, #6; 05 #7, #8; 06 #10, #11; 08 #12)
6. Repository weight: `docs/videos` (88 MB), `video/` (120 MB, 95 MB of it
   WAV files that can be made again), `docs/plans` (28 MB),
   `docs/pr-evidence` (25 MB), `design/brand/concepts` (9 MB). Pages serves
   all of `docs/`, plans and evidence included. Most plan, evidence and task
   report folders have no reference from the repository. (10 #8, #12 to #16)

### E. Inconsistent

1. Two support addresses: `info@eventrunner.org` and
   `info@collaborativejournalism.org`. (09 #4, 10 #4)
2. `NOTICE` has the old product name and a partial font list; the console
   bundles a font that is not OFL. (10 #5)
3. Handbook pages still say invoices are out of v1 and tickets are Eventbrite
   or spreadsheet only. ROADMAP M14 is unticked while the console is live.
   (10 #3, #7)
4. Schedule and invoice PDFs name the old product in their metadata. (03 #8)
5. Five `.mjs` shims export fewer names than their `.cjs` modules. Nothing
   imports the missing names. (07 #4)
6. Two `CommerceError` classes with swapped constructor arguments, and other
   helpers copied between files. (01 #7; 04 #8; 05 #9; 06 #9; 07 #9; 08 #9)
7. Three readers treat a missing `visible` as shown; the rest treat it as
   hidden. (02 #13)
8. Stale comments, listed once per area. (01 #9; 02 #15; 03 #7; 04 #9;
   05 #13; 07 #12)

### F. Inefficient (small)

1. The daily auth sweep deletes one document per round trip in a 60-second
   function. (02 #6)
2. Single-document admin screens listen to whole collections. (04 #7)
3. Sequential reads where one batch works: ticketing reconcile, console
   review queue, publish path. (01 #8; 02 #14; 03 #9; 08 #10)
