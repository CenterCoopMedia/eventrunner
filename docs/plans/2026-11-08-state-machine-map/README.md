# State machine map

Date: 2026-11-08. Code read at commit `5fcb859` on `main`. Line numbers in
these files point at that commit. They drift as the code changes.

This map lists every explicit and implicit state machine in the repository.
Use it to see how records move through their lives, and to find duplication,
drift and gaps.

- **Explicit**: a named status field with a fixed set of values.
- **Implicit**: state held in field presence, timestamps, booleans that
  combine, leases, counters, documents that move between collections, or
  React state.

The work was read-only. The code was read in five passes, one per area. Each
claim cites `path:line`. I re-read the code for 15 of the most serious claims, and all
15 held. Review then corrected two claims (defects 16 and 18) and one
fix suggestion (the admin listener hooks). They are marked "checked" below.

## Files

| File | Area | Machines |
|---|---|---|
| `01-ticketing-registration.md` | Accounts, tickets, Stripe orders, invoices, promo codes, OTP | 20 |
| `02-speakers-pitches-sessions.md` | Speakers, invites, pitches, materials, change requests, feedback, access | 27 |
| `03-cms-messaging.md` | Draft and publish, publisher, announcements, reminders, email, web address | 22 |
| `04-console-provisioning.md` | Console requests, builds, connections, archive and purge, workflows | 17 |
| `05-web-ui.md` | Web app and console UI state, steppers, loaders, autosave | 20 |

## Inventory

Kind: E = explicit, I = implicit, D = derived at read time (not stored).
"One writer" says whether all writes go through one helper.

### Server records

| Machine | Kind | Storage | States | One writer |
|---|---|---|---|---|
| Account registration | E | `users.registrationStatus` | pending, ticketed, approved, revoked | No (2 promoters) |
| Ticket admission | E | `tickets.status` | valid, pending_info, refunded, cancelled | Yes |
| Ticket claim | I | `tickets.claimedByUid` | unclaimed, claimed | No (2 delete paths) |
| Ticket check-in | I | `tickets.checkedInAt` | out, in | Yes |
| Stripe order | E x4 | `ticket_orders.status`, `paymentStatus`, `inventoryState`, `refundStatus` | 6 + 5 + 3 + 6 values | No |
| Payment attempt | E | `ticket_payment_attempts.state` | prepared, creating, unknown, created, exception, succeeded | No (webhook bypass) |
| Ticket sync queue | E + lease | `ticket_sync_queue.status` | pending, leased, exhausted, deleted | Yes |
| Webhook dedupe | I | `ticket_webhook_deliveries` presence | absent, claimed | Yes |
| Inventory and purchaser lock | I | `ticket_inventory`, `purchaser_*` | held and sold counts, lock | Yes |
| Answers custody | I | seat, `ticket_answer_holds`, `ticket_answers` | on seat, held, recorded | Yes |
| Promo code | E + D | `ticket_promo_codes` | inactive, scheduled, open, ended, exhausted | Yes |
| Catalog availability | I | `ticket_catalog` flags | closed, paused, window closed, sold out, open | Yes |
| Reconcile lease | I | `reconciliationLease` | free, leased | Yes |
| Invoice | E | `invoices.status` | draft, issued, paid, void | No (webhook bypass) |
| Invoice pay link | E | `invoices.payLinks[].status` | creating, open, paid, expired, cancelled, failed | Yes |
| Invoice payment review | I | `paymentReviews[].resolved` + `system_errors` | open, resolved | No (2 copies) |
| Invoice email send | E | `invoices.sends[].status` | sending, sent, failed, uncertain | Yes |
| OTP challenge | I | `auth_challenges` | open, consumed, deleted | Yes |
| Profile photo slot | E | `profile_photo_uploads.slots[].state` | uploading, ready, deleting | Yes |
| Speaker | E | `speakers.status` | draft, invited, accepted, approved, removed | No (4 creators) |
| Speaker invite | E | `speaker_invites.status` | pending, accepted, cancelled, superseded | Mostly |
| Speaker staged edits | I | `speakers.pendingEdits` | none, staged | Yes |
| Speaker profile submitted | I | `speakers.profileSubmittedAt` | no, yes | Yes |
| Speaker reminder delivery | E | `speaker_reminders.lastStatus` | sending, sent, failed, uncertain | Yes |
| Speaker readiness | D | computed | bio, headshot, description, materials | n/a (2 copies) |
| Pitch review | E | `session_pitches.status` | new, in_review, accepted, rejected | Yes (no table) |
| Pitch conversion | I | `session_pitches.conversion` | unconverted, converted | Yes |
| Pitch notices | E | `notices.*.state` | queued, sent, failed, unknown | Yes |
| Pitch call | D | `config/pitch_call` | off, open, open until, closed, external | n/a |
| Airtable refresh run | E + lease | `session_pitch_sync/airtable` | idle, running; 4 outcomes | Yes |
| Material review | E | `session_materials.reviewStatus` | pending, approved, rejected | Yes (no guard) |
| Photo delete claim | I | `speakers.headshotDeleteClaims[]` | unclaimed, claimed | Yes |
| Schedule share | E | `schedule_shares.scheduleVisibility` | private, attendees_only, public | Yes |
| Change request | E | `change_requests.status` | new, in_progress, done, declined | Yes (no guard) |
| Change request notices | E | `notices.*.state` | queued, sent, failed, unknown, suppressed | Yes |
| Feedback | E | `feedback.status` | new, reviewed, archived | Yes (no tx) |
| Admin access tier | E + D | `config/bootstrap` | none, staff, staff expiring, expired | Yes |
| Record import | E | `dryRun` then `confirmDigest` | preview, commit, partial | Yes |
| CMS draft | E | `<C>_drafts.status` | absent, dirty, clean | No (1 bypass) |
| CMS live record | I | `<C>` presence + `visible` + `revision` | unpublished, live, hidden | No (1 bypass) |
| CMS update tombstone | I | `cmsUpdates_deleted` | present, absent | Yes |
| Pending-count cache | I | `cmsMeta/pending` | counts | Yes (3 counters) |
| Publish run | E | `cmsPublishQueue.status` | running, done, failed | No (4 writers) |
| Publisher job | E x2 | `publisher.invoke.status`, `publisher.status` | invoked, failed; running, done, failed | No |
| Site launch | I | `config/launch.comingSoon` | absent, true, false | Yes |
| Banner announcement | D | `startsAt`, `endsAt` | scheduled, active, ended | n/a (4 copies) |
| Announcement email send | E + lease | `announcement_sends.status` | sending, sent, stopped, expired | No (sweep overwrites) |
| Email once-claim and log | I + E | `email_claims`, `sent_emails.status` | claimed; sent, failed | Yes |
| Email delivery | E | `sent_emails.deliveryStatus` | delivered, bounced, complained, suppressed | Yes |
| Email suppression | I | `email_suppressions` presence | mailable, suppressed | Yes |
| Reminder schedule | E | `reminder_schedules` | off, on, paused (+ reason) | Yes |
| Reminder window | D | planner | upcoming, open, closed, empty | n/a |
| Reminder run lease | I | `reminder_schedule_runs.running` | free, held; 4 outcomes | Yes (no token) |
| Reminder ledger | I | `reminder_ledger` | reserved, sent, failed, uncertain | Yes (2 shapes) |
| Web address | E | `web_address/current.state` | none, records, switch, done, removing | No entry writer |
| System error | I | `system_errors.resolved` | open, alerted, resolved | No (2 shapes) |
| Event phase | D | `packages/shared/src/config/lifecycle.cjs` | draft, announced, registration_open, registration_closed, in_progress, ended, archived | n/a (re-derived) |

### Console and client-site lifecycle

| Machine | Kind | Storage | States | One writer |
|---|---|---|---|---|
| Console request | E | `applications.status` + `history[]` | draft, approved, building, ready, launched, withdrawn, declined, archived | No (7 writers) |
| Build start flag | I | `applications.buildStart.state` | pending, started, failed | No (2 writers) |
| Build record | E | `console_builds.state`, `steps[].state` | queued, running, failed, done | Yes |
| Agreement acceptance | I | `agreementAcceptance`, `frozen`, `submittedAt` | not accepted, accepted | Yes (4 fields) |
| Signup link | E + D | `signup_links.status` | open, used, revoked; expired | Yes |
| Legacy draft quarantine | I | `legacyQuarantined` | linked, quarantined, unmigrated | Yes |
| Team invite | E + D | `invites.status` | pending, accepted, replaced; expired | Yes |
| Membership | E | `members.role` | owner, editor | Yes |
| Connection | E + lease | `applications.connections[p]` | absent, changing, live, unfinished | Yes |
| Name reservation | I | `site_names` | free, held, retained, tombstone | Yes |
| Archive, restore, purge | E + I | `archive.*`, `console_deleted_sites` | archiving, archived, restoring, purging, purged, verified | No (`purge --now`) |
| Silent-build watch | I | flag tx + mail kinds | started, build-failed, build-run-failed | Yes |
| Rate windows | I | `console_rate_limits` | count, window | Yes |
| Signup availability | D | console settings | open, closed | n/a |
| Workflow sequences | E | `.github/workflows/*.yml` | job graphs | n/a |
| Event template apply | E | `config/template.status` | applying, applied | Yes |
| Seed idempotency | I | `seeded` flag | missing, seeded, edited | Yes |

### UI state (web app and console)

| Machine | Kind | Where | States |
|---|---|---|---|
| Auth and admin probe | E | `apps/web/src/contexts/AuthContext.jsx` | loading; unknown, admin, denied |
| Own account | D | `apps/web/src/contexts/ProfileContext.jsx` | signed-out, pending-account, ready |
| OTP sign-in form | E | `apps/web/src/components/SignInPanel.jsx` | email, code; busy kind |
| Pitch stepper | E | `apps/web/src/pages/SessionPitch.jsx` | done, todo, locked; saved |
| Registration stepper | E | `apps/web/src/pages/CompleteRegistration.jsx` | done, todo; 8 page states |
| Speaker profile stepper | E | `apps/web/src/pages/SpeakerProfile.jsx` | done, todo; loading, ready, error |
| Async load object | E x13 | 13 files | loading, ready, error |
| Admin live + drafts listener | I x7 | `apps/web/src/admin/useAdmin*.js` | loading, ready, error |
| Admin record words | D x3 | `recordState.js`, `dataExport.cjs`, `pendingChanges.js` | draft, live, dirty |
| Loading stages | E x2 | `useLoadingStage.js`, console `LoadingState.jsx` | initial, active, slow, prolonged or extended |
| Autosave | E x2 | `useSessionNote.js`, console `useAutosave.js` | 5 and 6 states, different names |
| Editor save message | I x10 | admin editors | empty, message |
| Calendar sync | E | `CalendarSyncCard.jsx` | idle, syncing, synced, partial, refused, error |
| Console guided setup | E | `console/web/src/setup/steps.js` | 8 steps; autosave |
| Demo and read-only gate | I | `demoMode.js`, `readOnlyDemo.js` | demo, historical demo, live |

## Patterns that repeat across areas

These are the root causes. Most single findings are one of these patterns.

1. **No status list lives in one place.** Status values are restated as
   literals in functions, rules, scripts and both web apps. Examples:
   console request statuses (20+ copies, `04` finding 3), ticket, order and
   payment statuses (no shared definition, `01` finding 6), pitch statuses
   (2 server copies, `02` finding 6), speaker statuses (3 UI copies, `05`
   finding 9). Drift has already happened: `archived` and `launched`
   (checked), two different `BUILT_STATUSES` (checked), `prolonged` and
   `extended`, `rejected` and `declined`.
2. **No transition tables.** Only account registration has one
   (`packages/shared/src/registration.cjs:25-34`). Speaker, pitch, material,
   change request, feedback and invoice each check their source state by hand,
   or do not check it.
3. **Writes that skip the central helper.** Examples: invoice paid by webhook
   (`01` finding 9), Stripe session id attached by webhook (`01` finding 9),
   live `cmsSchedule` edited by speaker delete (`03` finding 3, checked),
   console status written by 7 code paths (`04` finding 5).
4. **One fact in two or more fields.** Order "done" in four fields, an
   outstanding invite in three, a build failure in two, agreement acceptance
   in four, pay-link review in two collections, `ticket_answers.ticketStatus`
   mirroring `tickets.status`.
5. **Delivery state has five vocabularies.** Pitch notices, change request
   notices, speaker reminders, access mail and email send each name
   "unknown outcome" differently: `unknown`, `uncertain`, `ambiguous`. Pitch
   and change request notice code is a near copy.
6. **Leases differ in shape and safety.** At least seven leases. The send
   runner checks a token on release. The reminder run lease and the Airtable
   lease do not. One Stripe order carries three leases with three timeouts.
7. **Silent fallbacks pick the wrong side.** Unknown invoice status reads as
   `draft` (most permissive). Unknown reminder pause reason reads as `on`.
   A failed admin probe reads as `denied`. A failed listener reads as
   "waiting" for ever.
8. **Dead states and dead code.** `launched` (console, checked), order
   `cancelled` and `failed` (checked), `building-failed`,
   `claimPromptSentAt`, `INVITE_STATUSES`, `unpublishDoc`,
   `cmsUpdatePublishStatus`, `exhaustRow`, `recordStateOf` `unknown`.
9. **UI state is rebuilt per page.** 13 async-load objects, 7 copies of the
   admin listener hook (the generic `useAdminRecords` exists and is used by
   two pages), 2 autosave machines, 2 loading-stage timers, 11 HTTP error
   classes, 9 storage wrappers.

## Defects found by the mapping

These are behaviour bugs, not only mess. Ranked by impact. Each needs a
failing test first.

| # | Defect | Evidence | Checked |
|---|---|---|---|
| 1 | Two concurrent resumes of a failed publish can both run and double-bump revisions | `functions/src/cms/publish.cjs:136-163` | Yes |
| 2 | Deleting an account in Firebase Auth leaves its tickets claimed for ever | `functions/src/users/lifecycle.cjs:146-162` | Yes |
| 3 | A console request in `archived` is missing from every status list: blank client status, operator queue cannot list it | `console/functions/src/applications.cjs:35`, `scripts/decommission-client.cjs:317` | Yes |
| 4 | Retention and spam delete remove a closed request that owns a cloud project, so decommission can no longer reach it | `console/functions/src/cleanup.cjs:71-73`, `scripts/decommission-client.cjs:165` | No |
| 5 | A Stripe order in `exception` keeps seats, purchaser lock and promo use, with no exit | `functions/src/ticketing/stripeCheckout.cjs:254-258`, `:399` | No |
| 6 | A converted pitch can still be declined; its draft speakers and invites stay | `functions/src/sessions/pitches.cjs:615-635` | Yes |
| 7 | A speaker moved from accepted to draft keeps attendee and materials access | `functions/src/speakers/profile.cjs:336-338`, `firestore.rules:453` | Yes |
| 8 | Writers treat a missing `visible` as shown; rules and readers treat it as hidden | `functions/src/cms/store.cjs:150`, `firestore.rules:92` | Yes |
| 9 | Console autosave shows "Saved." while a newer value waits to save | `console/web/src/setup/useAutosave.js:44`, `:61` | Yes |
| 10 | A later `delivered` event overwrites a `bounced` or `complained` status | `functions/src/email/send.cjs:675-691` | Yes |
| 11 | Reminder "event ended" check ignores archived events | `functions/src/reminders/scheduleCore.cjs:101-108` | Yes |
| 12 | Unknown reminder pause reason un-pauses the schedule | `functions/src/reminders/scheduleCore.cjs:79`, `:87-89` | No |
| 13 | Retention sweep overwrites a `sending` announcement record in full | `functions/src/maintenance/cleanup.cjs:295-301` | Yes |
| 14 | Unknown invoice status reads as editable, deletable `draft` | `functions/src/admin/invoices.cjs:120-122` | No |
| 15 | Reminder run lease and Airtable lease release without an owner check | `functions/src/reminders/scheduleCore.cjs:274`, `functions/src/sessions/airtableSync.cjs:397-400` | No |
| 16 | `purge --now` writes `archived` with no history entry, `archivedAt` or `purgeAfter`. A failed run resumes from its tombstone checkpoints on a manual retry, but `purge-due` never picks it up | `scripts/decommission-client.cjs:767-780`, `:839-840` | Yes |
| 17 | A retry re-reads live console settings and can move a build to a new region | `scripts/provision-client.cjs:1209-1214`, `:1319-1322` | No |
| 18 | When the account document stays absent, or the profile listener never delivers a first snapshot, account pages wait for ever with no error copy. A transient error retries after 15 s | `apps/web/src/contexts/ProfileContext.jsx:64`, `apps/web/src/lib/retrySubscription.js:33-41` | Yes |

## Suggested cleanup order

Do the defects first, one test-first fix per pull request, from the table
above. Then remove the root causes in this order, because each step makes the
next one smaller:

1. **One status module per lifecycle in `packages/shared`.** Export the value
   list, named groups (open, closed, built, terminal) and labels. Import them
   in functions, scripts and both web apps. Delete the copies. Start with the
   console request, Stripe order and pitch, which have the most drift.
2. **One transition table per lifecycle**, in the same module, in the shape of
   `packages/shared/src/registration.cjs:25-34`. Each server writer calls one
   `move(from, to)` check.
3. **One writer per lifecycle.** Route the bypass writes through it (pattern 3).
4. **Delete dead states and dead code** (pattern 8), after step 1 shows what is
   unused.
5. **One delivery-state module** for notices, reminders and mail (pattern 5),
   and **one lease helper** with an owner token (pattern 6).
6. **UI consolidation**: one shared live-plus-drafts subscription for the
   admin listener hooks, with each hook keeping its own merge step and return
   fields (sessions returns `groups`), one async-load hook, one autosave hook, one HTTP error type (pattern 9).

## Limits

- The passes read and searched. They did not run code. Claims marked "No" in
  the defect table are not yet checked against a running system.
- Line numbers are for commit `5fcb859`.
- `publisher/` holds only a Dockerfile. The job half is in
  `scripts/publish-site.cjs`.
