# ADR 0003: Optional Google Calendar sync of saved sessions

## Status

Accepted. Supersedes the calendar-sync removal in ADR 0001 (§ "Schedule page": "Google Calendar sync removed — per-client OAuth consent-screen verification does not scale under deploy-per-client").

## Context

ADR 0001 removed direct calendar sync on purpose: writing an attendee's saved sessions into their Google Calendar needs the `https://www.googleapis.com/auth/calendar.events` scope, a sensitive scope Google will not surface on an unverified consent screen, and verifying a consent screen is a per-Cloud-project process. Under deploy-per-client every deployment is its own project, so "verify once, run everywhere" is not available.

The owner has decided the feature returns as an optional integration, off by default, because a meaningful group of attendees build their personal schedule around their calendar and the existing file and link exports do not update once saved.

The facts that drove the original removal have not changed, so this record names the decisions the original one declined to make.

## Decision

### What is built

A client-side sync that writes an attendee's bookmarked sessions into their own Google Calendar and updates them when the bookmarks change:

- The attendee signs in to the site, then grants Google access through Firebase Auth's Google provider with the `calendar.events` scope. The access token stays in the browser for the session and is never written to Firestore.
- The sync creates a dedicated calendar for the event (named from `config/event`), and keeps one Google event per bookmarked session, tagged with a private extended property so the event set can be diffed.
- On every later bookmark change, while the attendee has a live token, the sync applies the difference: new bookmarks insert, changed sessions update, removed bookmarks delete.
- When the scope is refused, or the token has expired, or the flag is off, the attendee gets the existing file export — the .ics download and the per-session calendar links, both of which already work with no Google grant at all.

### Who verifies the consent screen, and who owns the credentials

- The OAuth client, the consent screen, and the Calendar API enablement all live in the CLIENT's own Firebase/GCP project — the same project every deployment already uses for hosting, Firestore, and email. No cross-client credential store exists and none is created.
- The CLIENT (the account owner named in `config/event`) is the verified owner of that consent screen. The OPERATOR performs the verification steps for them, from the runbook in `docs/CLIENT_ONBOARDING.md`, using the client's project access; Google's verification review is answered by the client as the API user.
- No secret is added to the platform. Firebase Auth's Google provider uses the web client already configured per project; the requested scope is the only addition.

### How the flag behaves when a client skips verification

`config/features.calendarSync` gates every surface of the integration, and it is off by default:

- Flag off: no sync control renders anywhere, no scope is ever requested, and the file export is the only calendar path. This is the state of every fresh deployment and of any client who skips the verification steps.
- Flag on without a verified consent screen: the site renders the sync control, but Google shows the unverified-screen warning and a test account can complete the grant only while the client is in testing mode with that account added. A production audience would be refused at the consent screen. This state is acceptable for a pilot with known users; the runbook names it explicitly.
- The client who does nothing gets exactly the pre-feature behavior. Skipping verification is not a broken state; it is the old state.

## Consequences

- The platform ships no Google credentials and stores no tokens. A leaked sync token is a per-attendee, per-session browser artifact, revocable at the Google account.
- Attendees keep their own consent and can revoke it from their Google account at any time; deleted grants simply stop the sync.
- The fallback file export remains the honest default, so a deployment's calendar story never depends on Google's verification queue.
- The client-side diff must tolerate partial failures (a rate-limited event updates on the next pass) and must never delete events it did not create — the private extended property is the ownership test.

## Non-goals

This record does not reintroduce server-side calendar writes, background re-sync without a browser session, Outlook or other providers, or a shared event calendar for organizers. Those remain out of scope under the same deploy-per-client reasoning that removed sync in the first place.
