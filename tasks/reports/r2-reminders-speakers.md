# r2: scheduled reminders, PR 2 of 3 (#518): the speaker schedule

Branch `joe/blissful-einstein-9qvtd1-32-remind-speakers`, from `origin/main` 291a8a1.

## What changed

| Item | Files | Tests |
|---|---|---|
| Wording version names the wording actually sent (note from PR 1) | `functions/src/speakers/reminderCore.cjs` | `reminderCore.test.cjs`: three new tests, written first and seen failing |
| Collections and rules | `firestore.rules` (`reminder_schedules`, `reminder_schedule_runs`, `reminder_ledger`, deny-all) | `tests/firestore.rules.test.js` deny list; `tests/reminder-schedules.rules.test.js` |
| Staff endpoint `reminderSchedules` (get, save, preview, approve, disable) | `functions/src/reminders/schedules.cjs`, `.github/smoke-endpoints.json` | `functions/src/reminders/schedules.test.cjs` (10 tests) |
| Scheduler `runScheduledReminders` (speakers branch, seam for attendees) | `functions/src/reminders/run.cjs`, `functions/src/reminders/speakerSchedule.cjs`, `functions/index.js` | `functions/src/reminders/speakerSchedule.test.cjs` (13 tests); rules test "a full run done twice" |
| Wording save or reset pauses the schedule | `functions/src/speakers/reminders.cjs` | unit "saving wording pauses…"; rules test "saving new wording pauses the schedule" |
| `{{due_date}}`, `{{days_left}}` tokens | `functions/src/email/templates/speaker.reminder.cjs`, `reminderCore.cjs` | unit and rules tests read "Please send them by Friday, November 20, 2026" in the sent text |
| Admin page | `apps/web/src/admin/pages/AdminReminderSchedules.jsx`, `apps/web/src/admin/reminderSchedules.js`, `AdminApp.jsx`, `AdminLayout.jsx`, `AdminSpeakerReminders.jsx` | `AdminReminderSchedules.test.jsx` (9 tests); docket tests updated |
| E2E | `e2e/reminder-schedules.spec.js` | preview, approve, next-run panel, paused banner after a wording edit |
| Docs | `docs/ADMIN_GUIDE.md`, `docs/DEPLOY_RUNBOOK.md`, `functions/README.md`, `functions/src/admin/eventPackage.cjs` EXCLUDED, `CHANGELOG.md` | `check-docs`, `build-pages --check` |

`docs/ROADMAP.md` does not track #518, so it is unchanged.

## Decisions the owner may want to change

- **Settings changes pause.** A save that changes the offsets, send time, due date or items while the schedule is on pauses it (`settings-changed`). The approval binds the settings as well as the wording, through a `settingsVersion` the preview returns.
- **Preview uses saved settings.** Staff save first, then preview. Previewing unsaved edits is refused in the page with "Save the settings first, then preview."
- **Admin log rows.** One `runScheduledReminders` row per run that emailed anyone (sent, failed or uncertain). A run that reached nobody writes only `reminder_schedule_runs/speakers.lastRun`. A pause, an approval, a save and a turn-off each write a row.
- **Waiting on the cooldown.** A speaker inside the 24-hour limit gets no ledger row, so a later run in the same window sends once the limit ends. A failed or uncertain send gets a ledger row and is never sent again in that window (ADR 0006).
- **Shipped copy uses only `{{due_date}}`.** `{{days_left}}` is offered for staff wording, so the shipped copy never reads "1 days" or "0 days".
- **Scheduler identity.** Runs use `{ uid: null, email: null }` in `admin_logs` and on `speaker_reminders`, the same as the scheduled Airtable refresh. `{{admin_contact_email}}` falls back to the event support address.
- **Lease.** 15 minutes per schedule (`reminder_schedule_runs/{schedule}`), longer than the 540-second function timeout.
- **Event ended.** The last configured day's end time has passed on the event clock. An event with no days never ends.
- **Nav.** One item, "Scheduled reminders", in the current Operations group, at `/admin/reminders`, which redirects to `/admin/reminders/scheduled`.
- **Sample speaker.** When nobody owes an item, the preview uses "Sample Speaker" with every chosen item missing.

## Checks

See the PR body for the final run. Every check was run after the last source edit.
