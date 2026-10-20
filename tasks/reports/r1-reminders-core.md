# r1: scheduled reminders, PR 1 of 3 (#518)

Branch `joe/blissful-einstein-9qvtd1-25-reminders-core`, from `origin/main` 2ef0d8a.
Scope: groundwork only. No user sees a change, except the wording-version fix.

## What changed

| Item | Files | Tests |
|---|---|---|
| ADR 0006, CONTRIBUTING one-queue paragraph | `docs/adr/0006-scheduled-reminders.md`, `CONTRIBUTING.md` | `node scripts/check-docs.cjs` |
| Event-clock conversion moved to shared | `packages/shared/src/eventDateTime.{cjs,mjs}`, `apps/web/src/lib/eventDateTime.js` (re-exports), `packages/shared/package.json`, `apps/web/vite.config.js` | new `packages/shared/src/eventDateTime.test.cjs`; existing `apps/web/src/lib/eventDateTime.test.js` and `EventDateTimeField` tests unchanged and passing |
| Pure planner | `packages/shared/src/reminderSchedule.{cjs,mjs}` | new `packages/shared/src/reminderSchedule.test.cjs` (15 tests) |
| Speaker reminder internals | `functions/src/speakers/reminderCore.cjs`, `reminders.cjs` | `reminders.test.cjs` and `tests/speaker-reminders.rules.test.js` unchanged and passing; new `reminderCore.test.cjs` for the `also` document |
| Announcement send chunks | `functions/src/announcements/sendRunner.cjs`, `sends.cjs` | `sends.test.cjs` unchanged; passes in memory and on the Firestore emulator |
| `wordingVersion(null)` fix | `functions/src/speakers/reminderCore.cjs`, `reminders.cjs` | `reminderCore.test.cjs` "the shipped wording version is a digest..." written first and seen failing (`actual: 'shipped'`) |
| Changelog | `CHANGELOG.md` | `build-pages --check` |

## Decisions the owner may want to change

- Planner offsets must be whole days from 1 to 365. Offset 0 is refused.
- A send time inside quiet hours (for example 21:00) is allowed. Each window then opens at the next 08:00.
- A window with no time outside quiet hours before it closes is `empty` and never sends.
- `reserve({ also })`: an `also` document that exists already refuses the reservation with reason `recorded`. A new `SKIP_REASONS.recorded` message was added for it. No caller passes `also` yet.
- `internals.SHIPPED_WORDING` in `reminders.cjs` is now a getter for the deployed shipped version, so the rules test reads the real value.
- The ADR is not added to the Pages manifest, the same as ADR 0004 and 0005.

## Known limit, for PR 2

- A saved override that fails its token check falls back to the shipped copy, but its wording version is still the override's digest. A deploy that changes the shipped copy does not change that version. The staff send is still safe, because its receipt covers the rendered bodies. The schedule's approval in PR 2 should bind the wording that is actually sent.

## Checks

See the PR body. Every check was run after the last source edit.
