# Spec f1: Announce and Archive controls in Event settings

Audit 07 findings 1 and 6 (`docs/plans/2026-11-09-project-audit/07-shared-rules.md`). ADR 0001 section 2.2 (`announcedAt`, `archivedAt`) and section 2.5 (the phase table and "Null semantics").

## Goal

An operator can set and clear `config/event.announcedAt` and `config/event.archivedAt` in admin Event settings. Then a client site can leave the `draft` phase and reach the `archived` phase.

## Stored shape

- Each key is `null` or a naive event-local datetime: `YYYY-MM-DDTHH:MM`, with optional `:SS`. This is the shape `getEventPhase` (`packages/shared/src/config/lifecycle.cjs`) reads. It is not an RFC3339 instant.
- The month is 01 to 12, the hour is 00 to 23, the minutes and seconds are 00 to 59. The date is a real calendar date (no 2027-02-30).
- The admin form writes minute precision (`YYYY-MM-DDTHH:MM`). Stored values with seconds (the demo fixture) stay valid.

## Validation (the save endpoint, `functions/src/admin/lifecycleStamps.cjs`)

- `announcedAt`: absent, `null`, or the stored shape. Other values are refused: `announcedAt: must be null or a naive ISO datetime "YYYY-MM-DDTHH:MM(:SS)" with a real date and time`.
- `archivedAt`: the same rule, same message with its own key.
- `archivedAt` set while `announcedAt` is null or absent is refused: `archivedAt: needs an announce date`.
- `archivedAt` before `announcedAt` (compared at minute precision) is refused: `archivedAt: must not be before announcedAt`. The same minute is accepted.
- Validation of other fields does not change.

## Who may change them

- Operator tier only. A staff save that CHANGES either key is refused by name (`announcedAt: operator access required`), and nothing is written. This is the same rule as the sender block (`findOperatorKeyChanges` in `functions/src/admin/config.cjs`).
- "Unchanged" compares the trimmed string; an empty string, `null` and absent are all the same value. A staff save that carries an unchanged value goes through, and the stored bytes are kept.
- The staff form does not send the two keys.

## Admin UI (`AdminEventSettings.jsx`)

- One new panel, "Announce and archive", in the "Registration and deadlines" group.
- Operator: two `EventDateTimeField` controls, "Announced" and "Archived", both clearable, in the event's time zone. Each has a hint that says what the date does.
- Staff: the same two values as read-only text (date and time in words, or "Not set"), and a line that says the team sets them.
- Both roles: the phase the site is in now, in plain words, from `getEventPhase` on the saved config/event. Visitors see this phase. It changes when a save lands.
- The form keeps the naive string. The field gets the instant that the naive string names in the event zone. A changed instant goes back into the form as a naive string in that zone. A change to the event time zone keeps the wall clock.
- A time the clocks pass twice: the operator chooses one, and the choice stays. Both send the same wall clock.
- The values travel in the existing `toPayload` (operator only). The existing save button, unsaved state and save message apply.
- An operator save sends a date only when the operator changed it. The form compares each date with its baseline: the value the form adopted from the live config, and after a save, the value that save sent. An untouched date is not sent, and the server's merge keeps the stored value. Thus a save of another field does not undo an announce or archive that another operator made while this page was open.
- A field with an incomplete or skipped time stops the save: the field shows its problem, and focus moves to it. A blank field sends `null` (clears the date).
- A server error on `announcedAt` or `archivedAt` shows under that field, and in the existing error summary.

## Error cases

- Malformed value, archive without announce, archive before announce: 400 with the named field, nothing written.
- Staff change: 403 with the named field, nothing written.
- Event time zone not set: the field uses UTC and says so (existing field behaviour).
- A stored value that names a time the clocks skip (only possible by a hand edit): the field shows blank. The stored value is kept unless the operator edits the field.

## What proves it

- `packages/shared/src/config/schema.test.cjs`: the accept and refuse cases above.
- `functions/src/admin/config.test.cjs`: staff change refused, staff unchanged accepted and stored bytes kept, operator change accepted, `findOperatorKeyChanges` names each key.
- `apps/web/src/admin/pages/AdminEventSettings.test.jsx`: operator sees editable fields and the phase, the saved payload carries naive local strings, a cleared field sends null, an untouched date is not sent (also when the stored value changed after the form adopted it), the next save is measured from the dates the last save sent, staff sees read-only text and the payload has no lifecycle keys, a server error shows on the field, an incomplete field stops the save and gets focus, a time the clocks pass twice keeps its choice.
