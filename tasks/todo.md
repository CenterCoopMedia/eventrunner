# Session task list

## Plan for review: audit follow-up (2026-11-09)

Source: `docs/plans/2026-11-09-project-audit/README.md` ("For the owner to
review"). The owner decided each item on 2026-11-09 through the question
tool. Rule the owner gave for unused code: a part that is half built or
planned gets finished; a part with no design intent and no reader is removed.

Builders run on Opus at medium effort. The director reviews each diff and
runs the checks. Bug fixes are test-first.

The four pull requests are a stack (owner, 2026-11-09). Each later branch
starts from the tip of the one before it, and its pull request is based on
that branch, so no step waits for a merge:

| PR | Branch | Base |
|---|---|---|
| 1 | `claude/project-audit-cleanup-rkmnhg` | `main` |
| 2 | `claude/project-audit-cleanup-rkmnhg-2-features` | PR 1 branch |
| 3 | `claude/project-audit-cleanup-rkmnhg-3-docs` | PR 2 branch |
| 4 | `claude/project-audit-cleanup-rkmnhg-4-cleanup` | PR 3 branch |

A review fix on a lower branch is merged up the stack, and generated output
is regenerated on each tip, never hand-merged. The stack merges top down.
After it merges, check `git merge-base --is-ancestor <top head> origin/main`.

### PR 1. Defects, rules and data handling

- [x] Tickets "Load more" sends the applied filter, not the form's (04 #4).
- [x] `/updates/:id` claims its tab title (05 #3).
- [x] Console: a refused acceptance spends no daily slot (`takeSlotIn`) (08 #5).
- [x] `text-status` becomes `text-text-secondary`; `text-body-lg` becomes
      `text-lead` (05 #2).
- [x] Email log: eight source labels: Invoice, Speaker reminder, Speaker
      profile request, Admin access, Change request notice, Attendee
      approval, Pitch notice, Ticket confirmation (04 #2).
- [x] `firebase.json`: `/dashboard`, `/registration`, `/tickets/mine`,
      `/tickets/status` join the private block, after a check that each
      needs sign-in or a private token; runbook and deploy tests (07 #2).
- [x] `storage.rules`: remove the `exports/` grant (the PDF is streamed) (07 #3).
- [x] Daily sweep also clears `client_error_rate_limits` and
      `feedback_rate_limits`, deletes in batches, longer limit (02 #5, #6).
- [x] Attendee delete clears the account's session pitches and its pitch
      rate-limit row (`PER_ACCOUNT_STORES`) (03 #6).
- [x] Material approve, reject, create, update and delete write an
      `admin_logs` row (03 #5).
- [x] Three readers use `visible === true` (02 #13).
- [x] One-time migration, run in each client deploy with a completion
      marker: numeric ticket dates become timestamps (01 #1).
- [x] `migrate-console-signup-links` gets a completion marker. The four
      one-time jobs stay in the deploys (09 #5, #6).
- [x] Schedule and invoice PDFs name EventRunner as Producer and Creator (03 #8).
- [x] The classifier selects the unit tier for `apps/web`, rules and
      generator changes; CONTRIBUTING table (09 #2).
- [ ] Not changed, by decision: the console `applications` read grant (08 #3).

### PR 2. Features that were half built (a short spec each, in `tasks/specs/`)

- [x] Announce and Archive controls in admin Event settings (operator);
      `validateEventConfig` checks `announcedAt` and `archivedAt`; runbook
      and admin guide (07 #1, #6).
- [x] "Sync all tickets" staff action in admin Ticketing; `ticketingSync`
      gets a time limit that fits a real event (01 #5).
- [x] "Create account from ticket" staff action on a ticket (01 #5).
- [x] `account.welcome` is sent once when an account is created
      (`welcome:{uid}`), as ADR 0001 section 6 has it (02 #9).
- [x] `getSiteContent` stays (owner, 2026-11-09). A deploy does not delete
      a function that left the code: it stops until an operator runs the
      delete command for each client site. Remove it when that is planned.
- Decisions made during the build (owner, 2026-11-09): the welcome email
  skips Owners and Editors; a stopped ticket sync resumes with Continue
  sync. The date checks are at the save endpoint, not in the shared
  validator, to keep the public bundle inside its budget (it has 72 gzip
  bytes left).

### PR 3. Docs and repository weight

- [ ] One support address, `info@eventrunner.org`, in every file (09 #4).
- [ ] `NOTICE`: product name and the full font list with each licence. The
      owner confirms the licence facts before the commit (10 #5).
- [ ] Handbook pages describe invoices and Stripe tickets as built (10 #3).
- [ ] Runbook: the custom web address is an operator procedure; remove the
      dead add helpers in `admin/webAddress.cjs` (02 #3).
- [ ] Pages does not serve `docs/plans` or `docs/pr-evidence` (10 #8).
- [ ] Remove `video/assets/audio/*.wav` and ignore the folder (10 #15).
- [ ] List the plan-evidence and PR-evidence folders nothing references;
      remove them after the owner confirms the list (10 #12, #13).

### PR 4. Dead code and refactors (no product change)

- [ ] Each dead item gets the owner's test first. Planned or half-built
      items go back to the owner as a list. The rest are removed:
      `ticketsPersisted`, `claimPromptSentAt`, order status `cancelled`,
      `features.ticketing`, the speaker link primitives, the
      `review.settings` branches, unused exports and CSS rules, four
      unreferenced public files (01 #3, #4; 03 #4; 04 #5, #6; 05 #8;
      06 #3, #10; 08 #8, #12).
- [ ] Complete the five `.mjs` shims; a test compares each shim with its
      module (07 #4).
- [ ] One `CommerceError`; merge copied helpers where no first-page bundle
      cost results (01 #7; 04 #8; 05 #9; 06 #9; 07 #9; 08 #9).
- [ ] Single-record admin screens use `subscribeAdminDoc` (04 #7).
- [ ] Batch the sequential reads (01 #8; 02 #14; 03 #9; 08 #10).

### Done when

Each pull request: `npm test`, `npm run test:web`, lint, the copy and docs
checks pass locally, "CI gate" is green, every review thread is resolved,
and the audit README marks the item closed.

## Plan for review: shared status modules (2026-11-08)

Approved by the owner on 2026-11-08: start with S0. Decisions: S1 adds a
Launch action that sets `launched` (no deletion). S3 uses `declined`
everywhere, with a one-time migration of stored pitch statuses.

Source: root causes 1 to 3 in
`docs/plans/2026-11-08-state-machine-map/README.md`. Bug fixes from the
map are in PR #763; this is the architecture step after it.

### Goal

Each lifecycle gets one module that holds its value list, named groups,
labels and transition table. Functions, scripts, rules tests and both web
apps import it. No status literal is typed twice. Behaviour does not change.

### Module shape (one file pair per lifecycle in `packages/shared/src/status/`)

```js
STATUSES            // frozen list, in lifecycle order
GROUPS              // named subsets: { closed, built, terminal, ... }
TRANSITIONS         // { from: [to, ...] }, shape of registration.cjs:25-34
canMove(from, to)   // true when TRANSITIONS allows it
LABELS              // staff words; client words only where they differ
```

### Order (one PR each, stacked, smallest drift first)

- [x] S0. The hash is reproducible. The committed lockfiles were stale on
      `main`: `packages/shared` changed in 941e81d and d28579a after the
      last refresh (c8ef222). CI never failed, because `prepare:functions`
      rewrites the hash before `npm ci`. Refreshed in PR #763. Each later
      step runs `npm run prepare:functions` and commits the three lockfiles.
- [x] S1a. `packages/shared/src/consoleRequest.cjs`: one list, groups,
      transition table and both label sets; every copy in console functions,
      console web and the provisioning scripts imports it. No behaviour change.
- [x] S1b. The Launch action: **Mark as launched** moves a ready request to `launched` (operator only, revision-checked, emails the Owners).
- [ ] S1. Console request (`applications.status`): one list, groups
      (open, closed, building, built), labels for operator and client.
      Replace the 20+ copies, the two `BUILT_STATUSES` and the six
      `['approved', 'building']` literals. Add the Launch action that moves
      a ready site to `launched` (owner decision).
- [x] S2 (lists). Ticket, order, payment, inventory and refund status lists and
      `isOrderFulfilled` are in `shared/ticketCommerce`; check-in, the confirmation
      email, ticket sync, reconcile, the admin filters and the purchaser page read
      them.
- [x] S2 (labels). `ticketStatusLabel` is split by field: ticket, order,
      payment, refund state, Stripe refund and Stripe dispute each have their
      own words. A pending refund no longer reads "Confirming payment", and the
      admin ticket filter no longer keeps its own word list.
- [x] S3. Pitch review statuses are in `shared/pitch` and every write stores
      `declined`. Readers pass stored values through `pitchStatusOf` and
      `pitchNoticesOf`, so a pitch an older site stored as `rejected`, and its
      `notices.rejected` email record, read as declined and a sent decline is
      never sent again. Change requests already stored `declined` in one list.
      The one-time rewrite (owner approved) runs in each client deploy:
      `scripts/migrate-pitch-declined.cjs`. Once every site has run it, the
      legacy read in `pitchStatusOf` and `pitchNoticesOf` can go.
- [x] S4. Speaker statuses have a transition table, `SPEAKER_TRANSITIONS` in
      `shared/speaker`, checked by `applyUpdateSpeaker` and by the admin
      editor's choices. Owner decisions: a draft may be published with no
      account; a removed speaker goes back only to draft. The dashboard list,
      the coverage list and the two admin speaker helpers import one copy.
      Invite and material review statuses already had one list each.
- [x] S5. Pitch and change request notices store `uncertain`, like the
      reminders, access mail, invoices and announcements (owner decision).
      `shared/delivery` holds the state list and reads the old `unknown`.
      Both notice flows use one retry rule, `functions/src/email/noticeRetry.cjs`.
      The API names `confirmUnknown` and `delivery-unknown` stay, because
      loaded pages send and read them.
- [x] S6. Every lease already releases only with its owner token (#763).
      `functions/src/core/lease.cjs` now holds the run lease rules (live,
      held, new token) for reminder schedules, the Airtable refresh and
      announcement send chunks. The Stripe order leases stay beside their
      payment steps, because each one changes payment state with it.
- [x] S7. Deleted the unused invite status lists, `exhaustRow` (an unguarded
      copy of the queue's exhaust step) and `store.unpublishDoc` (it would
      hide a doc with no revision bump or history row). Kept on purpose:
      `sendSessionConfirmationEmail` (its template is live and editable; the
      feature is unwired, not dead, which is a product call),
      `linkSpeakerToUser`/`unlinkSpeakerFromUser` (thin tested wrappers) and
      `claimPromptSentAt` (part of the data export).

### Done when (each step)

- A test lists every value the server writes and fails if a module lacks it.
- `grep` finds no status literal list outside the module, except the rules
  file, which has a parity test against the module.
- `npm test`, `npm run test:web`, lint and the rules suite pass.

### Risks

- Firestore rules cannot import JS. Their copies stay, guarded by tests.
- `apps/web` imports `shared` directly, so a shared change rebuilds the web
  bundle; run the web build in each PR.
- Console code goes live only after `deploy-console.yml`.


## What's left (updated 2026-11-04, 9 p.m. Eastern)

**1. Merge the open stack, in order.** Each PR is based on the one before.
CI was green on #589 to #593 at the last check; the newer ones are running.

| PR | Slice | State |
|---|---|---|
| #589 | R4a registration form editor | Ready |
| #590 | R4b private answers, attendee record, export | Ready |
| #592 | R5a Complete your registration | Ready |
| #593 | R5b checkout stepper with questions | Ready |
| #594 | R6a promo codes (server) | Needs your two choices below |
| #595 | R6b promo codes (web) | CI running |
| #596 | R7a registrations import | CI running; review fixes pushed |
| #597 | R7b speaker logistics export | CI running |

**2. Decisions only the owner can make.**
- [ ] #594: refuse an order that has more discounted tickets than the
      per-order limit (no part discount). Recommended: yes.
- [ ] #594: a 100% code makes a free order under the free-ticket limits
      (a cap per buyer, one free ticket per email). Recommended: yes.
- [ ] The five ADR 0007 prerequisites: GCP folder and billing, Stripe
      platform account (Connect), Eventbrite app, a DNS zone with an API,
      a Postmark account token. These block P6, P8 and P10.
- [ ] Approve the Stripe sandbox rehearsal (ADR 0004) before live sales.

**3. Build: the client console (ADR 0007), one PR each.** NC Local's site
waits on all of P4 to P10.
- [ ] P4 Console foundation — can start now.
- [x] P5 Guided setup — built on `ccr-7be41c6c-vyzsth-p5-setup`, on top of P4.
- [x] P6 Stripe and Eventbrite connections — built on `console-connections`, against fakes. Live use needs the prerequisites.
- [x] P7 Operator review — built on P4; waits for the P5 rebase.
- [ ] P8 Provisioner — blocked on prerequisites.
- [ ] P9 Custom web address and sender domain — can start now.
- [ ] P10 Runbook and live proof in a test folder — needs the owner.

**4. Follow-ups (small, no decisions needed).**
- [ ] Split the 640-line `apps/web/src/pages/Tickets.jsx` into step components.
- [ ] Browser E2E for the registrations import (unit and page tests exist).
- [ ] Stripe epic leftovers: hosted browser evidence and the sandbox
      rehearsal (item 2). Its other three boxes are stale: that code shipped.

## 2026-11-03: registration, pitch and speaker steppers

Spec: [ADR 0008](../docs/adr/0008-registration-and-pitch-steppers.md),
accepted, one PR per part. Owner choices: standard questions plus 10 custom; answers in a
checkout stepper; speakers through pitches and invites; promo codes in.
Order is set by NC Local's launch: pitch call and early-bird tickets first.

- [x] R1 Stepper component (public and admin), interface guideline
      section; move the admin setup page onto it. Stacked on #581.
- [x] R2 Pitch stepper: five steps, presenters, staff lists for format,
      length and track, `updatePitchFormOptions`, review panel. Stacked on R1.
      Server drafts across devices are not built; the draft stays in tab
      storage, as before.
- [x] R2b Admin pitch pages in the house style: queue, one pitch with
      decision buttons, notes and staff edits (`editSessionPitch`), settings
      and import pages. Stacked on R2.
- [x] R2c CSV import, Airtable mapping and queue export for the new pitch
      fields and presenters. Stacked on R2b. Airtable co-presenters are not
      mapped (CSV only).

Owner decision (2026-11-03): NC Local waits for the console, and the pitch
path (R2c, R3) comes before registration.
- [x] R3a Accept a pitch: a speaker per presenter, linked by email, invite
      in one action. Stacked on R2c.
- [x] R3b Speaker profile stepper (`/speaker/profile`) and an email on
      profile submit. Stacked on R3a. Owner choices (2026-11-03): a new
      `speaker.profile_received` email; logistics in `speaker_logistics/{id}`.
  - [x] Steps: About you (name, pronouns, title, organization) → Bio and
        photo → Links → Logistics (travel, access needs, audio and video
        needs; staff only) → Review and submit. Reuse `components/forms/Stepper`.
  - [x] Pronouns: a new self-editable public field in `shared/speaker`, in
        the public projection and the speaker page.
  - [x] Logistics: `speaker_logistics/{id}`, never in `speakers_public`;
        shown to staff on the speaker's admin page; rules tests.
  - [x] Submit: `speaker.profile_received`, sent once per speaker.
  - [x] Tests: shared validation, handler, web page, E2E invite → accept →
        steps → submit → email; docs and changelog.
- [x] R4 Registration questions, in two stacked PRs:
  - [x] R4a `shared/registrationForm` (form and answer checks),
        `config/registration_form` saved by `updateRegistrationForm` with a
        revision guard, and Settings → Registration form with a preview.
  - [x] R4b private `ticket_answers`, rules, the attendee's own save
        (`saveTicketAnswers`), attendee record, export columns, counts
        summary, deletion with the account, archive exclusion. Stacked on
        R4a. The attendee's own form comes with R5.
- [x] R5 Checkout stepper and "Complete your registration", in two stacked PRs:
  - [x] R5a `/registration` (Questions per ticket → Review) for every
        provider; with no tickets (provider `none`) answers are keyed
        `ticket_answers/account-{uid}`. Dashboard reminder until answered.
        `attendee.approved` email once per account on admin approval.
        Stacked on R4b.
  - [x] R5b Stripe `/tickets` as Tickets → Attendees → Questions → Review →
        Pay. Answers for other people are held with the order seats and
        bound to `ticket_answers` when each person claims their ticket.
- [x] R6 Promo codes (ADR 0004 amendment), with concurrency tests. R6a (#594)
      is the server; R6b is the admin panel and the review-step field. Later:
      split the 640-line `Tickets.jsx` into step components.
- [x] R7 Registration import in `/admin/import`; speaker logistics export.
  - [x] R7a Registrations import type (ADR 0008 §7). Manual provider only;
        any other provider refuses every row. Columns: external ID (the
        ticket ID), email, first and last name, ticket type, and
        `answer:<question id>` per question. A new row makes a valid manual
        ticket. Answers are checked against the live form; until a claim
        they wait in server-only `ticket_answer_holds/{ticketId}`, and
        `claimTicket` moves them to `ticket_answers` as it does for checkout
        seats (an attendee's own record wins). Re-import is the three-way
        merge: an answer or name staff or the attendee changed is kept and
        reported. The email of a claimed ticket never changes by import.
  - [x] R7b Speaker logistics export (staff-only `speaker_logistics`):
        travel, access, audio and video needs. The pitch queue export
        already has the new pitch columns and presenters (pitchCsv.js).

## 2026-11-03: client onboarding, account creation and provisioning

Spec: [ADR 0007](../docs/adr/0007-client-console-self-serve-onboarding.md),
accepted 2026-11-03. Console at console.eventrunner.org. NC Local goes
through the console, so P4 to P10 must finish before NC Local's site is made.
P1 to P3 are on PR #581. Legal: the owner reports that CCM's legal review
cleared this project. Each event's own privacy policy and terms still need
the client's sign-off on the setup page.

Revised 2026-11-03: the owner wants a commercial-platform experience. No
keys, files or DNS for the client. Stripe Connect (Standard), Eventbrite
OAuth with an event picker, a `<name>.eventrunner.org` address and sender by
default, team invites. ADR 0007 rewritten; ADR 0004 amended.

Each phase is one pull request after #581, in this order. Each phase runs
lint, the unit suites, the rules suite and E2E where it touches them, and
gets an adversarial review before it merges.

- [x] P1 Spec: ADR 0007 and this plan.
- [x] P2 Shared: `shared/answers` (one validator for console and CLI).
- [x] P3 Admin setup checklist (`/admin/setup`), the legal sign-off, and
      the fresh readiness read (found by `e2e/admin-setup.spec.js`).
- [ ] P4 Console foundation: `console/` app and functions; sign-up with
      Google, Microsoft, email link; organizations; team invites with Owner and
      Editor; operators allowlist; rules tests; favicon and social metadata.
      Built by a builder agent in its own worktree (2026-11-04); every line
      read before it goes on a PR.
- [x] P5 Guided setup: seven steps, autosave, web-address availability,
      shared validation, review and submit with rate limits, status page,
      client emails. Web unit, rules, handler and E2E tests.
      Done without the E2E spec; console/README.md has the endpoints.
- [x] P6 Connections: Stripe Connect OAuth and Eventbrite OAuth with the
      event picker; tokens to console Secret Manager only; state binding;
      disconnect. Tests against fake OAuth servers.
      Branch `console-connections`. No real provider has been called; P10's
      live proof must check Stripe's token field and Eventbrite's `state`.
- [x] P7 Operator review: queue, read, request changes, decline, approve
      with defaults from console settings; spam delete; 90-day retention.
      Branch `ccr-7be41c6c-vyzsth-p7-review`, on P4.
- [ ] P8 Provisioner: `scripts/provision-client.cjs` idempotent steps
      (project, Hosting subdomain + DNS, authorized domains, Postmark server
      and domain + DNS, tokens and webhooks, GitHub Environment, dispatches,
      init) against injected fakes; `provision-client.yml`; GitHub App dispatch.
- [ ] P9 Optional upgrades in the admin: custom web address and custom
      sender domain with **Check now** and a scheduled check.
  - [ ] P9a Custom web address (2026-11-04 plan). `/admin/web-address`,
        operator tier. The server asks Firebase Hosting (its own project,
        default credentials, injected client) to add the domain and shows
        the records Hosting returns, in plain words. **Check now** and a
        scheduled check read Hosting's state; when the domain is live the
        server adds it to the sign-in authorized domains (Identity Toolkit,
        injected client) and records that the public address must change by
        a deploy. Until P8's GitHub App, that deploy is a hosting-team step
        on the setup checklist. Fakes in every test; CI stays credential-free.
  - [ ] P9b Custom sender domain, after P8. Postmark domain verification
        needs the account-level token, which ADR 0004's isolation rule keeps
        out of client projects, so the check runs from the console.
- [ ] P10 Operator runbook for the one-time setup and a live proof in a test
      folder with Stripe and Eventbrite test accounts. Needs the owner.

Blocked on the owner for P6, P8 and P10: the five prerequisites in ADR 0007
(GCP folder and billing, Stripe platform, Eventbrite app, DNS zone with an API,
Postmark account token). P4, P5, P7 and P9 can start now.

## 2026-10-19 (wave 3): deliver every promise in the NC Local proposals

Joe set the three October 19 proposal PDFs (self-serve, supported, full
service) as the spec: anything they promise must exist in the product.
A gap check found five promises the code does not deliver:

| Id | Promise | State |
| --- | --- | --- |
| g1-airtable | Airtable connection: pull pitch records, refresh without duplicates, keep review decisions | workflow wf_e62b5d98-1d3, building |
| g2-announce | Event announcement email (#490, #201, #202, #203) | workflow, building |
| g3-remind | Speaker reminder email (#204, #332) | workflow, building |
| g4-export | Full data export and archive handoff (#329) | workflow, building |
| g5-import | Initial imports for speakers, sessions, sponsors | workflow, building |
| docs | Handoff docs: communications, exports, Airtable, stale Stripe omissions | director, after g1-g5 |

Security and dependencies (Joe, 2026-10-19): 34 CodeQL alerts (s1, /home/user/wt-codeql);
non-breaking npm audit fix (PR #498); major upgrades as separate PRs: u1 vitest 5 + vite 8,
u2 firebase-tools 15 (both dispatched), u3 firebase-admin 14 + react-router 7 (queued).

Sponsorship invoicing (#208, #209) is back in: the owner approved the spec on
2026-10-20 (comment on #208). Five PRs, in order: 1 the invoice record, draft
form and settings (#208, branch `joe/blissful-einstein-9qvtd1-30-invoice-record`);
2 move the PDF helpers into `functions/src/pdf/kit.cjs`; 3 issue and numbering,
the PDF, mark paid, void, duplicate, the export and docs (#209); 4 email the PDF
as an attachment; 5 the Stripe pay link with an ADR 0004 amendment (#519).
Each build gets an adversarial review in the workflow; the director integrates
onto the stack tip, regenerates, and opens stacked PRs.

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
| w2 | #357, #356 Eventbrite webhook registration and signing | /home/user/wt-w2 | PR #494 |
| w3 | #346 docs leftovers | main checkout | PR #492 |
| d1 | #354 CI gate and DCO from base | main checkout | PR #493 |
| w4 | #328 repeat event template | /home/user/wt-w4 | review fixes in progress |
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

## Speaker session confirmation (owner decisions, 2026-11-08)

Staff send `speaker.confirmation` per speaker per session, after a preview.
A new send is allowed only when the session's title, time or room changed
since the last sent one.

- [x] Server `sendSessionConfirmation` (staff, POST `{ sessionId, speakerId,
      preview?, confirmUnknown?, expectedNamed? }`). Reads the LIVE session
      (`cmsSchedule/{id}`, visible, with a day and start time) and the
      speaker (named in `speakerIds`, not removed, has an email).
- [x] Record in staff-only `session_confirmations/{sessionId}__{speakerId}`:
      state (shared/delivery), attempt, onceKey, `named { title, time, room }`,
      queuedAt/sentAt/by. Retry rule from `email/noticeRetry.cjs`; a `sent`
      record allows a new attempt only when `named` changed.
- [x] Preview returns the rendered subject and text and whether the slot
      changed since the last send. Send requires the preview's `named`, so
      staff send what they saw.
- [x] firestore.rules: staff read, no client write. Rules test.
- [x] Web: Sessions panel on the speaker editor listing published sessions
      that name the speaker, with time, room, confirmation state and
      Preview → Send.
- [x] Docs: ADMIN_GUIDE speakers section; ADR 0008 note that the action exists.
