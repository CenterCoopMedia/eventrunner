# ADR 0003: Optional Google Calendar sync of saved sessions

## Status

Proposed. The owner accepts or amends this record before any calendar code is reviewed as done (issue #177).

A disabled implementation and `docs/CLIENT_ONBOARDING.md` §6 reached `main` in the M8 wave before this record was reviewed. Both sit behind a flag that is off. The branch that follows acceptance reconciles both with this record. Where the code and this record differ, this record wins.

## What this record supersedes

ADR 0001 [§9 Porting map](0001-event-platform-v1.md#9-porting-map), row "Google Calendar sync": removed, with the reason "per-client OAuth consent-screen verification does not scale under deploy-per-client". The same table's "Schedule page" row carries the note "Google Calendar sync removed". The [triage record](../plans/2026-08-16-event-platform-v1-triage.md) gives the same reason.

This record replaces that one decision. It does not touch the "ICS export + calendar links" row: the `.ics` download and the Google and Outlook links stay the baseline for every deployment, and they are the fallback here. Every other decision in ADR 0001 stands.

## Context

### What ADR 0001 decided

The reference implementation asked the browser for the `calendar.events` scope and wrote each saved session into the attendee's primary calendar. `calendar.events` is a sensitive scope. It reads and writes every calendar the attendee can see. Google reviews an app that asks for a sensitive scope before the public can grant it. Under deploy-per-client the consent screen belongs to the client's Google Cloud project, so that review would repeat for every client, with every client's brand, and the operator would carry it. ADR 0001 removed the feature and shipped the `.ics` download and calendar links instead.

### What changed since ADR 0001

1. Google added narrower Calendar scopes. `calendar.app.created` lets an app make its own secondary calendar and manage events on that calendar only. Google's scope table listed it as non-sensitive when this record was written. A non-sensitive scope has no scope review. That removes most of the per-client cost ADR 0001 objected to. The check the operator makes before relying on this is in decision 2.
2. The platform now has the parts the sync needs. `config/features` has an admin editor where every flag defaults to off. `config/event.timezone` and `config/event.days[]` feed one shared session-time helper. The `.ics` export and calendar links exist per session and per schedule. Bookmarks live at `users/{uid}/bookmarks/{sessionId}`, written only by `bookmarkSession`. The onboarding checklist already carries manual console steps and an attestation for Google sign-in.
3. The owner asked for the feature back as an opt-in. Not every client wants it. The clients that do take the setup work.

## Decision

### 1. The flag

- The key is `calendarSync`, in `KNOWN_FEATURE_KEYS` in [`packages/shared/src/config/schema.cjs`](../../packages/shared/src/config/schema.cjs), stored as `config/features.calendarSync`. The key is already in the list.
- It is off by default. Every `config/features` flag defaults to false in the web client, and the admin editor sends the whole document, so an omitted key is off.
- It requires `icsExport`. The sync control renders only when both flags are true. The file export is the fallback, and the fallback must exist.
- Flag off: no control, no Google script, no OAuth request, no local storage key. The page is what it is today.
- Flag on before the client finishes the setup in decision 5: the control renders and offers the sync. While the client's app is in testing status, Google refuses the grant for anyone who is not a listed test user. The control then shows its "not granted" state with the `.ics` download beside it. There is no broken button, and nothing is written. The checklist says to turn the flag on last. If a client turns it on early, this is what an attendee sees.
- Turning the flag off later hides the control at once through the live config snapshot. Calendars already written stay. They belong to the attendee.

### 2. Who verifies the consent screen

- The consent screen belongs to the client's Google Cloud project, the one that holds their Firebase project. Google shows that project's brand and writes to that project's owner. So the client verifies. The operator does the console work as a project editor under the client's authorization and prepares any submission. The operator never submits its own brand and never hosts the client's privacy policy.
- The scope is `https://www.googleapis.com/auth/calendar.app.created`, and no other calendar scope. It is the narrowest scope that can write events. The app creates one secondary calendar and reads and writes events on calendars it created. It cannot see the primary calendar or any other. `calendar.events` and `calendar.events.owned` are sensitive scopes that reach the primary calendar. `calendar` is the whole account.
- Google groups scopes as non-sensitive, sensitive, and restricted. Calendar scopes were not in the restricted group when this record was written, and `calendar.app.created` was listed as non-sensitive. Both can change. Before configuring, the operator opens Google's [Calendar API scopes page](https://developers.google.com/workspace/calendar/api/auth) and the project's data access page in the Cloud console and confirms the current classification. If the console marks the scope sensitive, the client needs a sensitive-scope review before the flag goes on, and the timeline below does not hold.
- What verification involves for a non-sensitive scope: no scope review. [Brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification) is separate. It covers the app name, logo, homepage, privacy policy URL, and authorized domain, and it needs the domain verified in Google Search Console by the project owner. Google states a few business days for it. The consent screen works without it; what it shows for an unverified brand has changed before, so the operator checks it in the test pass.
- What verification involves if the scope is sensitive: a [sensitive-scope submission](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) with a justification per scope and a demonstration of the flow. Google may ask questions, and the client's contact answers them. Google states the expected time in the console when the app is submitted. Plan on weeks. Promise the client no date.
- Before verification completes, and while the app is in testing status: only listed test users can grant, up to 100 of them. Everyone else is refused at Google's screen. An unverified app in production with a sensitive scope shows Google's "unverified app" warning and caps new grants at 100 users. In every one of these cases the control ends in its "not granted" state and the `.ics` download stays.

### 3. Who owns the OAuth client and its credentials

- The client's project owns the OAuth client. It is the web client Firebase created when Google sign-in was enabled ([onboarding §3, items 1 and 2](../CLIENT_ONBOARDING.md#3-the-56-items)). Firebase's sign-in handler, `https://<auth domain>/__/auth/handler`, is already its redirect URI. No operator project is involved. No credential crosses projects, the same rule the site publisher follows.
- One operator-owned client was rejected. It would show the operator's name on every client's consent screen. Its secret would sit in every client's project, or the exchange would run in the operator's project. One Google action against the operator's app would stop every client's sync at once. Each of these breaks a rule ADR 0001 set.
- Secrets: none. The browser asks Firebase Auth for the grant and receives a short-lived access token. No client secret is used. So there is no new GitHub Environment secret, no Secret Manager entry, no `defineSecret` list change, and no new line in [`.env.example`](../../.env.example). Tier A gains nothing. Tier B gains nothing beyond the existing flag. The secret surface stays at seven.
- Rotation: Firebase's sign-in handler is the only consumer of the web client's secret, as today. If the client rotates it in the Cloud console, they paste the new value into Firebase → Authentication → Google provider, as they would for sign-in. The sync does not hold the secret and needs no redeploy.
- Revocation by the attendee: from their Google account's third-party access page. The app sees a 401 on its next pass and shows "not granted". Revocation by the client: turn the flag off. Deleting the OAuth client also stops Google sign-in for the whole deployment, so the client does not do that. Suspension by Google: the same 401 path and the same fallback. The operator hears from the client and turns the flag off.

### 4. The sync model

What is written:

- One secondary calendar per attendee per deployment, created by the app on the first pass and named for the event from `config/event.name`. It is the only calendar the scope reaches. The attendee can hide, recolour, or delete it as one thing.
- One event per bookmarked session: title, description, location, start, and end. Start and end come from `config/event.days[]` and `config/event.timezone` through the shared session-time helper, and the event body carries the event's IANA time zone. Google shows it in the attendee's own zone. A session with no valid times is counted and skipped, not written.
- Each event carries the session id as a private extended property. That tag is the only key. An event without the tag is never read, changed, or deleted, so an event the attendee adds to the calendar by hand is safe.

How updates and removals follow bookmarks:

- The unit of work is a pass. A pass lists the tagged events in the app's calendar, deletes the ones whose session is no longer bookmarked, updates the ones whose session still is, and creates the rest. A pass is idempotent.
- A pass runs when the attendee selects the control. While the My schedule page stays open, another pass runs whenever the bookmark set or the session data changes. Passes are serialized. A change during a pass asks for one more pass, in memory, not in a store. Leaving the page cancels what has not been sent. A request Google has accepted stands.
- Nothing runs with the browser closed. An admin edit made after the attendee leaves lands on the attendee's next visit. Open question 1 covers the alternative.

Token storage:

- The access token lives in page memory only. It is never written to Firestore, local storage, a cookie, or a log. It is dropped when the page unloads or Google refuses it. There is no refresh token anywhere.
- So there is nothing for the rules to guard. No collection holds a credential, and no rule or rules test is added for one. The rules that matter are the existing ones: `users/{uid}/bookmarks` is self-read and server-write.
- The only stored value is the calendar id, in the browser's local storage, keyed by project, attendee uid, and Google account id. It is an identifier, not a secret. If it is lost, in another browser or after clearing storage, the next pass makes a second calendar, and the attendee deletes the old one in Google. Open question 3 covers where else it could live.

No queue:

- [`CONTRIBUTING.md`](../../CONTRIBUTING.md#there-is-exactly-one-queue) allows one queue. This adds none. No collection records pending or failed writes. There is no scheduled function and no drain.
- Retry is the next pass. A failed create, update, or delete is counted and reported in the control as "n could not be written". The next pass reads Google's state again and repairs it. A 401 ends the pass and drops the token, and the attendee grants again.

Privacy, what leaves the deployment:

- To Google Calendar, on the attendee's own grant: the event name as the calendar title, and for each bookmarked session its title, description, location, start, end, and opaque session id. Nothing about other attendees, no session notes, no profile fields.
- Into the deployment: nothing new about the attendee's Google account beyond what Google sign-in already records. An attendee who signed in by email and chooses to sync links a Google account to their event account. The control says so before the popup opens. A Google account already linked to another event account is refused by Firebase, and the control names the `.ics` fallback.
- The client's privacy page states this before the flag goes on. It is a checklist item in decision 5.

Failure and fallback:

- Scope refused, because the attendee closed the popup, unticked the scope, or Google refused: the control shows "not granted" with the `.ics` download beside it. Nothing is written.
- Token expired or revoked during a pass: the pass stops, the token is dropped, and the control shows "could not update" with the `.ics` download. The next selection asks for a new grant.
- Calendar deleted by the attendee: the list call fails, the stored id is forgotten, and one new calendar is made. A second miss in the same pass is an error, not permission to make calendars in a loop.
- Network or API failure: the control shows the counts and the `.ics` download. Every state names the `.ics` download. The control has a keyboard path and visible focus, and no state is shown by colour alone.

### 5. Provisioning steps for `docs/CLIENT_ONBOARDING.md`

These steps replace the current §6 after acceptance. Until then nothing in that file changes.

- [ ] Opt-in recorded. The client's project owner asks for the feature in writing and accepts that their event name and support address appear on Google's consent screen, and that Google contacts them about it.
- [ ] Onboarding §3 items 1 and 2 are complete and attested with `init-event.cjs --attest-auth`: Google sign-in is enabled and the authorized domains are set.
- [ ] Privacy page. The client's privacy policy states that, at the attendee's request, saved sessions are written to a Google calendar the attendee chooses, what is sent, and how to revoke. The legal review sign-off in §3 happens after this edit, not before.
- [ ] Google Cloud console, client project: enable the Google Calendar API.
- [ ] Consent screen branding: app name is the event's public name, support email is the client's, homepage is `EVENT_PUBLIC_URL`, privacy policy is the page above, and the authorized domain is the client's domain, verified in Search Console by the project owner. Console page names move; read the current ones.
- [ ] Data access: add `https://www.googleapis.com/auth/calendar.app.created` and confirm the console lists it as non-sensitive. If it is listed as sensitive, stop here. The client submits for verification, and the flag stays off until Google approves.
- [ ] Audience: user type External. While testing, add the synthetic test accounts. Before enabling, set the publishing status to In production.
- [ ] OAuth clients: the Firebase web client lists `https://<auth domain>/__/auth/handler` as a redirect URI and the site's domains as JavaScript origins. Add a custom auth domain if the client uses one.
- [ ] Brand verification: submit it if the client wants its logo shown or the console asks for it. Record the submission date. For a non-sensitive scope, do not wait on it to enable, unless the test pass shows a warning screen.
- [ ] Test pass with synthetic attendees in the test audience, on the deployed site: Google sign-in and email sign-in; a refused grant; grant, revoke at Google, and select the control again; add and remove bookmarks, including the last one; change a session time in the admin and see the update; an event the tester added to the app's calendar by hand is untouched; the `.ics` download is present in every state; the whole path works from the keyboard.
- [ ] Admin panel → [Settings → Features](../ADMIN_GUIDE.md#settings-features): confirm `icsExport` is on, then turn `calendarSync` on.
- [ ] Record the date, the scope classification seen, the publishing status, and the client's project owner in the client's onboarding notes.
- [ ] Handoff: tell the client's staff that turning the flag off hides the control and leaves calendars in place, and that attendees revoke access from their own Google account.

## Consequences

- ADR 0001 §9 loses one row. Every other row holds. The `.ics` export and calendar links stay required for every deployment.
- Per client, the work is about an hour of console steps for a non-sensitive scope, and weeks of waiting if Google classifies it sensitive. The client carries it. The operator's fixed cost is the checklist.
- The implementation on `main` is reconciled in the branch that follows acceptance: it sends the event's time zone on each event, renders only when `icsExport` is also on, and matches the states in decision 4. Tests sit next to the change. No rule changes, so no rules test is added. The control stays brand neutral, with a keyboard path and visible focus.
- `docs/CLIENT_ONBOARDING.md` §6 is replaced by the checklist in decision 5. `docs/DEPLOY_RUNBOOK.md` does not change, because there is no new variable and no secret. `docs/ADMIN_GUIDE.md` gains one sentence under Settings → Features that points at the onboarding section. `CHANGELOG.md` records the change.
- `docs/ROADMAP.md` ticks #177 only when the code and the onboarding steps have landed, not when this record is accepted.

## Non-goals

- No server-side writer, no stored refresh token, and no sync while the browser is closed.
- No write to the primary calendar, and no read of any calendar the app did not make.
- No other calendar provider. Outlook keeps its link.
- No organizer or speaker calendar, no invitations, and no attendees on events.
- No operator-owned OAuth client.
- No new Tier A variable, secret, collection, rule, or queue.

## Open questions for the owner

Each question has a recommended answer. Acceptance of this record with no other note adopts the recommendations.

1. **Browser-side only, or a server-side writer with a stored refresh token?** Recommended: browser-side, as written. The server model adds an eighth secret, a server-only collection of per-attendee Google credentials with rules and rules tests, a trigger that fans out on every session edit, and a seven-day refresh-token expiry while the client's app is in testing status. That last state is the one a client who skips the setup sits in, so the feature would work for a week and stop. If sync while the browser is closed is wanted later, it needs its own record.
2. **If Google lists `calendar.app.created` as sensitive at setup time, does the feature stay available?** Recommended: yes. The client takes the review, the flag stays off until Google approves, and the operator prepares the submission but does not carry the review.
3. **Where does the calendar id live?** Recommended: browser local storage for this version. If duplicate calendars are reported, a later change stores the id on `users/{uid}` through a callable. It is an identifier, not a credential, but it is still a server write and a rules line, so not now.
4. **Should `init-event.cjs --check` gate the flag with an attestation, like `--attest-auth`?** Recommended: no for this version. The checklist and the admin editor are the gate. Add an attestation only if a client turns the flag on early.
5. **Should the control appear beside each session on the schedule page, or only on the My schedule page?** Recommended: My schedule only. One place to grant and one place to read the state.
6. **Who at the operator signs off the test pass before the flag goes on?** Recommended: the operator who ran onboarding, recorded in the client's onboarding notes with the date.
