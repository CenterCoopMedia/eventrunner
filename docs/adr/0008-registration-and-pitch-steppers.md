# ADR 0008: Registration, session pitch and speaker steppers

**Date:** 2026-11-03  
**Status:** Accepted by the owner on 2026-11-03, with one pull request per part (R1 to R7 in `tasks/todo.md`).  
**Amends:** [ADR 0004](0004-stripe-ticket-commerce.md) (promo codes), and the open question in [the parity plan](../plans/2026-09-09-cjs-parity-gap.md) on steps versus one form: multi-step flows are steppers.

## Context

An inventory of the code on 2026-11-03 found:

- The session pitch form (`/pitch`) is one page: title, description, format text and consent.
  It has no co-presenters, track, length, audience or access needs.
- Accepting a pitch (`convertSessionPitch`) makes one draft session and one draft speaker with no
  bio, and sends no invite.
- Ticket checkout (`/tickets`) is one long page. It asks for each attendee's name and email only.
  No dietary, access, consent or custom questions exist anywhere.
- Promo codes are off (`allow_promotion_codes: false`, `discountAmount: 0`). Early-bird pricing
  works through per-ticket-type sale windows.
- Speakers join only by invite, through a single-page profile form.
- An admin approval of an attendee sends no email. The `speaker.confirmation` email has no trigger.
- There is no stepper component.

The owner wants these flows to feel like a commercial event platform: multi-step, plain, and
professional (2026-11-03).

## Owner choices (2026-11-03)

1. Attendee questions: a standard set plus up to 10 custom questions that staff write.
2. Attendees answer inside a checkout stepper, per ticket.
3. Speakers come in through pitches and invites. There is no open speaker sign-up.
4. Promo codes are in scope.

## Decision

### 1. One stepper pattern

A shared component, `apps/web/src/components/forms/Stepper.jsx`, used by the public site and the
admin panel (the admin setup page moves onto it).

- One step per page, at its own address (`/pitch/presenters`, `/tickets/attendees`). The browser
  Back button and a reload keep the reader on the step.
- A step list with the state of each step in words, `aria-current="step"` on the current one,
  and a folded one-line summary on a phone.
- **Next** checks only the current step. A failed check stays on the step, lists the errors, and
  puts the focus on the first field (`focusFirstError`). A later step cannot be opened before the
  earlier ones pass.
- Answers save as the reader types: in session storage for a signed-out reader, and in a
  server draft for a signed-in one, so a reader can come back on another device.
- The last step is **Review**: every answer, grouped by step, each group with an **Edit** link to
  its step. Submit is only on Review.
- `docs/interface-guidelines.md` gets a "Steppers" section; it replaces the "do not page small
  forms" note for flows with three or more groups.

### 2. Session pitch stepper (`/pitch`)

| Step | Fields |
| --- | --- |
| Your session | Title (160), one-line summary (300), description (5000) |
| Format | Format, length and track, each picked from lists staff set on the pitch call; audience level |
| Presenters | The submitter as lead (prefilled from the account); up to 4 co-presenters: name, email, organization, role |
| Access and notes | Access needs for the session (private), notes to the organizers |
| Review | All answers, the consent box, **Submit pitch** |

- `config/pitch_call` gains `formats`, `lengths`, `tracks` (each a list of at most 20 labels) and
  `maxCoPresenters` (0 to 4, default 4). An empty list hides its field.
- `session_pitches` gains `summary`, `format`, `lengthMinutes`, `track`, `audienceLevel`,
  `presenters[]` (`{ name, email, organization, role, lead }`), `accessNeeds`, `notes`. A pitch
  saved before this change reads as one lead presenter, the submitter.
- Co-presenters get no email at submit. Their address is used only when staff accept the pitch.
  The form says so.
- The CSV import and the Airtable mapping gain the new columns, with `presenter_1_name` …
  `presenter_5_email` for presenters. The queue export writes the same columns.
- The external-form mode (an Airtable form instead of this form) is unchanged.

### 3. From an accepted pitch to speakers

- `convertSessionPitch` makes one draft speaker per presenter. A presenter whose email matches an
  existing speaker is linked to that speaker, not duplicated. The session lists every presenter.
- The convert dialog has a box, **Invite the presenters now**, on by default. It sends the
  existing speaker invite to each new speaker in the same action, and shows who was invited.
- The invited speaker completes a **speaker profile stepper** (`/speaker/profile`): About you
  (name, pronouns, title, organization) → Bio and photo → Links → Logistics (travel, access needs,
  audio and video needs; private to staff) → Review. Accepting the invite opens it.
- ~~`speaker.confirmation` is sent when a speaker submits the profile.~~ Amended by the owner on
  2026-11-03: a submitted profile sends a new email, `speaker.profile_received`, once per speaker.
  `speaker.confirmation` names a confirmed time and room, so it stays for a later staff action that
  confirms a session.
- The Logistics answers live in a separate record, `speaker_logistics/{speakerId}`, that only staff
  can read (owner choice, 2026-11-03). The public speaker copy is built from `speakers`, so these
  answers cannot reach it.

### 4. Attendee registration questions

**Standard set**, each one on or off and required or optional, set by an operator:
organization, job title, dietary needs (choices plus "other"), access needs (free text), photo
consent, attendee directory listing. The directory answer sets the profile's visibility.

**Custom questions**, at most 10: short text, long text, one choice, several choices, or yes/no;
a label (200), help text (300), up to 20 choices, required or optional.

- The form lives in `config/registration_form` with a `revision` number. The validators are in
  `shared/registrationForm`, used by the browser, the checkout function and the import.
- Answers are private: `ticket_answers/{ticketId}` (one per attendee, not per buyer). Staff read
  them. The attendee reads and edits their own until registration closes. They are never in
  `users_public`.
- Access and dietary answers are marked sensitive. They show in the attendee record and the
  export, with a counts summary for catering and access planning. They are deleted with the
  event data at archive, by the existing retention steps.
- An admin page, **Registration form** (`/admin/registration-form`), edits the standard set and
  the custom questions, with a preview of the attendee's view.

### 5. Checkout and registration steppers

**Stripe (`/tickets`):** Tickets → Attendees (name and email per ticket) → Questions (per
attendee) → Review (promo code, total, refund policy) → Pay (Stripe-hosted page). The server
checks the answers against the form revision when it makes the reservation, and stores them with
the order. Fulfilment copies them to `ticket_answers`. The rest of ADR 0004 (reservation,
recovery, reconciliation) does not change.

**Eventbrite, spreadsheet import and no tickets:** after a ticket is claimed, or after sign-in when
the event has no tickets, the attendee sees **Complete your registration**: Questions → Review.
The account dashboard reminds them until it is done.

**Emails:** an attendee approved by an admin gets `attendee.approved`. The confirmation emails
that exist stay.

**Where answers live (2026-11-03, after R4b review).** Answers always belong to an account, so the
holder can read them and they are deleted with the account. With no tickets (provider `none`) the
record is `ticket_answers/account-{uid}`. Answers given at checkout for other people are held with
the order's seats and copied to `ticket_answers/{ticketId}` when that person claims the ticket.

### 6. Promo codes

- `ticket_promo_codes`, operator- and staff-editable: code (case-insensitive, unique), percent or
  fixed amount, which ticket types it applies to, a use limit, a per-order limit, start and end
  times, active or not.
- The discount is computed on the server only, inside the reservation transaction, and the
  discounted unit price goes to Stripe Checkout as `price_data`. A use is reserved with the
  reservation and released when the reservation ends unpaid, so a limit cannot be exceeded by
  open checkouts.
- The order records the code and the discount. Refunds follow the paid amount.
- Stripe's own promotion codes stay off, so one place decides a price.

### 7. Data ingest and exports

- The record import (`/admin/import`) gains **Registrations**: name, email, ticket type, and the
  answers by question id. It makes tickets for the manual provider with answers attached.
- The attendee export adds a column per question. The pitch export adds the new pitch columns and
  presenters. A new speaker logistics export lists travel, access and audio and video needs.

## Consequences

- Every public intake becomes a stepper with the same keyboard path, error handling and save
  behaviour, so the next form costs less.
- Access and dietary answers are sensitive personal data. They stay private, appear only to
  staff, and leave with the archive. The privacy policy template gains a clause for them, under
  legal review like the rest.
- The pitch and ticket schemas grow, so the CSV and Airtable mappings and the exports change in
  the same pull request as each schema.
- Promo codes touch money. They get their own pull request, an ADR 0004 amendment, and tests for
  limits under concurrent checkouts.

## Not in scope

- Open speaker sign-up without a pitch.
- Group or table registrations, waitlists, and per-session capacity.
- A general form builder beyond the 10 custom questions.
