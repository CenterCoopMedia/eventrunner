# r3: scheduled reminders, PR 3 of 3 (#518): the attendee schedule

Branch `joe/blissful-einstein-9qvtd1-38-remind-attendees`, from `origin/main` cfbcc48.

## What changed

| Item | Files | Tests |
|---|---|---|
| Shared schedule rules (no behaviour change) | `functions/src/reminders/scheduleCore.cjs`, `speakerSchedule.cjs` | existing speaker suites pass unchanged |
| Send runner guard, stop marker, no staff continue of a scheduled send | `functions/src/announcements/sendRunner.cjs`, `sends.cjs` | `sends.test.cjs` (new test) |
| Attendee schedule and run | `functions/src/reminders/attendeeSchedule.cjs`, `run.cjs` | `attendeeSchedule.test.cjs` (17 tests) |
| Endpoint actions | `functions/src/reminders/attendeeActions.cjs`, `schedules.cjs` | `attendeeActions.test.cjs` (9 tests) |
| Emulator proof | - | `tests/reminder-schedules.rules.test.js` (3 new tests, deny list extended) |
| Admin panel and history marks | `apps/web/src/admin/components/AttendeeReminderSchedule.jsx`, `AnnouncementEmailComposer.jsx`, `reminderSchedules.js` | web tests; `e2e/reminder-schedules.spec.js` |
| Docs | `docs/ADMIN_GUIDE.md`, `CHANGELOG.md`, `functions/README.md`, `docs/DEPLOY_RUNBOOK.md`, `docs/POSTMARK_PROVISIONING.md` | `check-docs`, `build-pages --check` |

Rules are unchanged: `reminder_schedules/{scheduleId}` and the other two collections were already deny-all.

## Decisions the owner may want to change

- **Audience.** `resolveAudience({ audience: 'registered' })` as #518 says: approved attendees and people who claimed a ticket. The narrower "ticket holders only" (`ticketed`) was not chosen, because the spec names the audience exactly.
- **Stripe flag.** "Stripe ticket sales on" is `EVENT_TICKETING_PROVIDER=stripe` (`config.tierA.ticketingProvider`), the switch ADR 0004 names. A Stripe deployment with an unpublished catalog still links to `/tickets/mine`.
- **Facts.** Start date and time of the first event day, the venue (name and address), the ticket link and its label. The event name is not in the facts version, so renaming the event does not pause.
- **One send per window.** A re-approval in a window whose send already began does not send again: the rest of that send stops, and the next window uses the new approval. A moved event start makes new windows, so attendees get the reminders for the new date.
- **Days in the email** are the days left when that window's send began. A send resumed the next morning keeps the earlier number.
- **Shipped wording.** Saving text equal to the shipped draft keeps the shipped draft, so a deploy that changes it still pauses. The wording version also covers the announcement layout.
- **Approval needs a working channel.** Approve is refused while announcement email cannot be sent; a run that finds the channel broken fails and tells the operator (deduplicated).

## Review fixes (Codex on #532)

1. The send record binds the settings version too: a settings-only re-approval stops the rest of that day's send.
2. The branches run side by side with one 480-second deadline that both respect between steps.
3. The next-run count of a send in progress is the addresses left on its frozen list.
4. A guard stop (off, paused, changed) marks the record `stopped`.
5. A per-chunk channel refusal tells the operator (same notice key); `channel-changed` also stops the record.
