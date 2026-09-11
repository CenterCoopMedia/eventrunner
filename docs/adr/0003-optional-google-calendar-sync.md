# ADR 0003: Optional Google Calendar sync of saved sessions

## Status

Proposed; owner acceptance is still required. The M8 incident committed this record as
accepted without the review required by issue #177. The disabled implementation is retained
for review. Do not enable it for a client until the owner accepts this decision and the
operator verifies the grant and sync in that client's project.

## Context

ADR 0001 removed direct calendar sync because each client deployment needs its own OAuth
setup. Issue #177 asks to restore it as an optional integration. This proposal changes that
choice only for clients who opt in; it does not replace the existing `.ics` export.

## Proposed decision

- Keep `config/features.calendarSync` off by default. With it off, no sync control or OAuth
  request is made. The file export and per-session calendar links remain available.
- Use the client's Firebase Google provider. An attendee with a linked Google identity
  reauthenticates it. An attendee who signed in by email first links the chosen Google
  account to their event sign-in; the control states this before the popup opens. A Google
  account already linked to another event account is refused, with the file export as fallback.
- Request `https://www.googleapis.com/auth/calendar.app.created`. This permits creation of
  the app's dedicated calendar and management of its events. The original `calendar.events`
  scope did not permit calendar creation. See Google's [calendar creation permissions](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert).
- Keep access tokens only in memory. Save only the calendar ID in browser local storage,
  scoped to the Firebase project, attendee ID, and linked Google identity. Reloading the page
  needs a fresh grant but reuses that calendar. Clearing browser storage or using another
  browser can create another calendar; the attendee can remove old calendars in Google.
- While the personal schedule page is open, sync bookmark additions, removals, and published
  session changes. Read every page of the calendar's current events on each pass. Change
  only events tagged with the app's private session ID. Preserve user-created events.
- Serialize sync passes. Report partial failures, retry them on the next pass, and ask for a
  new grant after token expiry. Changing accounts or leaving the page cancels pending requests.
  A request already accepted by Google cannot be recalled.

## Ownership and provisioning

The OAuth client, consent screen, and enabled Calendar API belong to the client's existing
Firebase/GCP project. The client appoints its project owner and support contact; an event
configuration field is not proof of that authority. The operator configures the provider,
redirect domains, requested scope, and test audience with that owner's authorization.
Follow Google's current [OAuth verification requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
for the selected scope and audience. Do not promise a review time or assume every project
has the same verification requirements. See [client onboarding](../CLIENT_ONBOARDING.md#6-optional-google-calendar-sync-configfeaturescalendarsync).

## Verification before enabling

Use synthetic attendees in the client's test audience. Check both Google and email sign-in,
refused grants, reloads, account changes, a removed final bookmark, changed session times,
partial failure, and preservation of a user-created calendar event. Confirm that no token is
stored. Leave the flag off if any check fails or setup is incomplete.

## Non-goals

No server-side calendar writer, stored refresh token, sync with the browser closed, other
calendar providers, or organizer calendar is added.
