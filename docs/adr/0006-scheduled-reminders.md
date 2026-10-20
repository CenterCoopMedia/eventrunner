# ADR 0006: Scheduled speaker and attendee reminders

**Date:** 2026-10-20  
**Status:** Proposed for review with the first pull request of [issue #518](https://github.com/CenterCoopMedia/eventrunner/issues/518).  
**Extends:** [ADR 0001 §3.1](0001-event-platform-v1.md#31-emailprovider) and the one-queue rule in [CONTRIBUTING](../../CONTRIBUTING.md#there-is-exactly-one-queue), for scheduled reminders only.

## Context

Staff can send speaker reminders by hand (`speakerReminders`) and announcements to attendees (`sendAnnouncementEmail`). Both send in the request that asked for them. Nothing sends on a timer.

Issue #518 asks for reminders that go out on their own: to speakers who still owe readiness items before a due date, and to attendees a few days before the event. A timer means a scheduled function, and a scheduled function that sends email looks like the machinery ADR 0001 §3.1 removed: a per-minute processor, a list of pending sends, and a drain. CONTRIBUTING says a change like that needs an ADR first, and that `ticket_sync_queue` stays the only queue. This record says why a reminder schedule is not a queue, and what keeps it from becoming one.

## Decision

A scheduled function, `runScheduledReminders`, runs every 60 minutes. On each run it works out what is due, sends it through the send paths that already exist, and records what it did.

- **What is due is computed, not stored.** Each run reads the schedule settings (`reminder_schedules/{speakers|attendees}`) and the clock, and computes the due window with the pure planner `shared/reminderSchedule`. Nothing writes a "to send" row for a later run to find. A run that does not happen loses nothing: the next run computes the same answer.
- **The ledger records only what was done.** `reminder_ledger/{schedule}__{windowKey}__{speakerId}` is created in the same transaction as the `speaker_reminders` reservation, so each speaker gets at most one reminder per window. No run reads the ledger to find work. It only stops a second send.
- **The scheduler is one more caller of the existing send paths.** Speaker reminders go through `functions/src/speakers/reminderCore.cjs`, the code the staff endpoint uses. The 24-hour cooldown applies in both directions between manual and scheduled sends, and the email core's send-once claim is the second barrier. Attendee reminders go through `functions/src/announcements/sendRunner.cjs`, the code staff announcements use. They get the suppression check, both unsubscribe modes, the stream check before each chunk, and the send history. A deterministic `announcement_sends/{sendId}` and the email core's claim make each attendee send idempotent.
- **One run at a time.** The run holds a lease on `reminder_schedule_runs/{id}`, the same shape as the ten-minute lease of `scheduledAirtablePitchRefresh` ([ADR 0005](0005-airtable-pitch-intake.md)). The lease stops two runs from overlapping. It does not hold work.
- **Server only.** Firestore rules deny clients `reminder_schedules`, `reminder_schedule_runs` and `reminder_ledger`. Staff change a schedule only through a staff-tier endpoint, which writes an `admin_logs` row.
- **Bounded and visible.** Each run writes one `admin_logs` row. A run refuses on a read-only demo and does nothing after the event ends. A run that cannot send (for example, the wording or the facts changed) pauses the schedule and tells the operator. It never retries in the background.

### Timing rules

- Offsets are calendar days before the anchor, at a staff-set local send time on the event's clock. Across a daylight saving change, 7 days before at 10:00 is 10:00 on the clock people read, not 168 hours earlier.
- A local send time that daylight saving skips fires at the first minute after the gap. A time that happens twice fires at the earlier instant. The server uses `shared/eventDateTime`, the same conversion the admin uses.
- Each offset has a window. It runs from the offset's fire time until the next offset fires, and the last window runs until the anchor. Its key is the anchor's local date and the offset, for example `2026-11-20-7d`.
- A missed run is made up inside the same window. A window that has closed is dropped, because a later offset has replaced it.
- Quiet hours are 20:00 to 08:00 on the event's clock. Nothing sends then. A window that opens in quiet hours waits for 08:00.

### Owner decisions (2026-10-20)

- **Offsets.** Speakers: 14, 7 and 2 days before the readiness due date. Attendees: 7 and 1 days before the event. Staff can change them.
- **Opt-in.** Every schedule is off by default.
- **Approved wording.** Staff preview the wording, then approve it and turn the schedule on. The schedule sends only the approved wording version. For attendees the approval also covers a facts version (start, venue, ticket link). A change to the wording or the facts pauses the schedule until staff approve it again. The shipped wording has a digest version (`shipped:{digest}`), so a deploy that changes the shipped copy also pauses it.
- **Who gets a speaker reminder.** Only speakers who still owe items. A speaker who finishes stops getting them.
- **Ticket link.** The attendee reminder links to `/tickets/mine` when the deployment sells tickets through Stripe ([ADR 0004](0004-stripe-ticket-commerce.md)), and to `/dashboard` otherwise.

## Consequences

- `ticket_sync_queue` stays the only queue. The reminder schedule has no pending-work collection, no drain, and no retry of failed sends. A failed or uncertain send is recorded and is not sent again by a later run.
- Reminders can be late but never doubled. A run that is missed or fails sends later in the same window, or not at all if the window closed.
- A change to the planner's rules changes what every later run sends. The planner is pure and has its own tests, so a change is visible in review.
- Turning on the attendee schedule needs the Postmark Broadcasts stream (#91) and `config/providers.email.announcementStream`. The operator sends a test announcement first.
- A request for another kind of scheduled email needs a new record, or an amendment to this one.
