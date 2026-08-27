# Admin guide

Task-oriented reference to every tab in the admin CMS, for the staff who run a client's event day
to day. For the narrative, "why does this work this way" version, see
[`docs/handbook/for-event-staff.md`](handbook/for-event-staff.md) — that page is the one to hand a
new staff member first; this one is what you come back to for a specific task.

Draft and live are separate almost everywhere below. Saving writes a draft; publishing copies it to
what attendees see. If a change isn't showing up on the public site, check that you published, not
only saved.

## Pages

Every `cmsPages` document (About, Travel, Conduct, and anything else seeded or added) has a
publish state visible in the list: **Never published** (draft only), **Unpublished changes** (a
published page with a dirty draft), or fully published. Create, edit, and publish from here.

Each page also sets its own **layout**: the header (full or compact nameplate — a page always has
one), whether it arranges its items as a grid or a list, how much space sits between things, and
whether navigation runs across the top or down the side. A page that has never been given a layout
renders the defaults, so nothing changes until you change it.

A **system page** — home, schedule, speakers, sponsors — keeps its built-in content and lets you
put sections around it. Each section on one of those pages picks a position: above the main
content, with it, or below it. Custom pages have no built-in content, so they have no position to
pick.

## Content (Pages → Content editor)

Filling in what a page's blocks actually say is a separate step from shaping the page: pick a
page, then a section, then the block inside it. A page's *structure* — its sections, which block
types each allows, default blocks — is set in the page editor above; this tree of screens is for
the block *content* itself. Every one of the eight CMS block types is editable here.

**A statistic needs four things**, and the editor will not save one without them: the finding in
words ("Two thirds of sessions are workshops", not "Session types"), what the number counts and
over what period, where the number came from and the date you read it, and a line describing the
finding for a screen reader. A stat block saved before this rule existed keeps working; the next
time you edit one, you will be asked to fill the four parts in.

## Media

A browsable library, split by namespace because each answers a different question:

- **`cms-images/`** — images used inside pages and posts. Client-writable through this tab.
- **`branding/`** — logo slots, backed by the same reusable image picker the Branding tab uses.
- **`speaker-photos/`** — set from the speaker editor, not uploaded loose here.

Upload, edit alt text, and delete from the library. A delete warns you first if anything currently
on the site references the asset — don't dismiss that warning without checking what it names.

## Speakers

The canonical `speakers/{speakerId}` list, with each record's pipeline status and the entry points
to create, edit, invite, and review pending edits. This list reads the real speaker records, not
the public-facing projection, on purpose — an admin needs to see speakers who aren't published yet:
drafts, outstanding invites, soft-deleted records.

**Pipeline states**, top to bottom of what a speaker record moves through:

| Status | What it means | Action available |
|---|---|---|
| Not invited (`draft`) | Speaker record exists, no invite sent | Invite |
| Invite sent (`invited`) | Emailed; not yet accepted | Resend |
| Accepted / published | Speaker signed in and (optionally) edited their own profile | — |

**Pending-edits review.** A speaker can propose changes to their own profile after accepting an
invite; those land in `speaker.pendingEdits`, not directly on the live record, until an admin
approves them. Review and approve (or reject) from the speaker's row — the queued fields are named
right there, so you're never approving a change blind.

**Create/edit form.** Every field except `uid` and `inviteToken` is editable here — those two move
together in a single server-side transaction as part of the invite/accept pipeline and are never
part of an admin payload, by design (a leaked value there is rejected by name on the server, not
silently accepted).

One speaker record is the source of truth. If a name is wrong in three places on the public site,
fix the speaker record — don't patch each place it appears.

## Attendees

The full attendee list with registration status and a search/filter. What action is available
depends on the current status:

- **Pending / ticketed** → Approve
- **Approved** → Revoke (approving again is available only when the original approval came from a
  ticket — re-approving pins `approvalSource` to `admin` so a subsequent revoke behaves correctly)
- **Revoked** → Approve (the only way out of revoked)

Approve/revoke always go through the server endpoints (`approveUser`/`revokeUser`) — every
registration field involved, including `approvalSource`, is server-owned and not editable directly,
even for the account's own owner.

## Ticketing

Provider status, CSV import, and a searchable ticket list — what's here depends on the client's
provider choice (`docs/CLIENT_ONBOARDING.md` §3 item 5):

- **Eventbrite**: provider status shows webhook registration state (from
  `scripts/register-ticketing-webhook.cjs`) and recent sync activity.
- **Manual / CSV import**: upload a spreadsheet, map its columns to attendee fields, preview the
  import as a dry run, then commit it. This is the whole ticketing story for a `manual` deployment
  — there's no webhook tab content to speak of.
- **None**: nothing to configure.

Ticket records themselves are server-only in Firestore (no direct client read/write); every list,
search, and import here goes through an admin-gated endpoint.

## Live updates

Compose, edit, and delete entries in the live-updates feed shown on the public site. There is no
draft/publish step here, unlike the CMS content tabs — a save here is live immediately. This is an
admin-authored feed only; nothing ingests from Slack or any other external source.

## Feedback

Every submission from the public feedback modal, newest first, with a mark-reviewed / archived
action. This reads the feedback collection directly (admins can read it under `firestore.rules`);
only the status change goes through the admin endpoint, because the rules deny every client write
to the collection outright.

## Materials

Session materials review — upload or link files against a session, with an optional embargo that
holds the material until the session ends. Prefer a real label ("Slides") over a bare URL as the
link text a viewer sees. This collection is fully server-only, even for an admin's direct Firestore
read, so every action here — upload, edit, delete — goes through Cloud Functions rather than a
client SDK call.

## System errors

Unresolved `system_errors` rows — the operational surface for things like an invalid email-template
override falling back to its code default. Each row has a resolve action. This collection is
server-only in Firestore; the list and the resolve action both go through admin endpoints
(`functions/src/telemetry/systemErrors.cjs`). If you're chasing down why a template edit "isn't
working," check here before assuming it's a bug — a rejected override logs here and silently keeps
serving the last-good copy rather than breaking the send.

## Settings

### Event settings

The `config/event` fields an admin owns: name, dates, timezone, venue, sender address, and the rest
of the event's identity fields. This is a merge-then-validate write — the form only needs to send
the keys it's actually changing; fields it doesn't touch (like the legal postal address or SEO
metadata) are left alone.

**Tracks** live here too: the lines your event runs when sessions happen at the same time in
different rooms. Each track has a letter (A to Z) and a name, and the schedule shows both — a
reader tells two lines apart by the letter and the name, never by colour alone. Sessions point at a
track by its letter, so renaming a track is one edit here rather than a change to every session.
Leave the list empty if everything happens in one room.

**What the track list changes on the public site.** Once you list tracks, the schedule draws as a
grid on a wide screen: time down the left, one column per track, in the order you listed them. On a
phone — and for anyone reading with a screen reader — the same day reads as a time-ordered list,
which is a designed view rather than a lesser one. A session with no track runs across the whole
width, which is what a plenary is. A session that names a parent is listed under it as a stop on
the way through it rather than as a separate entry, in both views.

**Past days become back issues.** When a day ends, its page keeps every word and quietens: the
colour drops out, the day head says "Back issue", and the controls that act on a live event —
bookmarking, reactions, adding to a calendar — go away. Nothing is hidden, and every link still
works. Setting an **archive date** for the whole event does the same thing to every day at once.

**Printing.** Print any schedule page and you get the handout: every day of the event, every
session and every stop under it, tracks named by letter and name, no buttons. You do not have to
prepare anything for it.

### Features

Feature flags, wired to a **whole-document replace** — every known flag is always sent, and an
omitted flag means disabled. When a new flag is added to the platform, it appears here automatically
because the form's key list comes from the same shared schema the server validates against; there's
no separate "add it to the admin UI" step.

### Badges

The badge catalog: categories, each with a max-picks cap and its list of badges, which attendees
self-select from on their profile. Also a whole-document replace — editing one badge sends the
complete set of categories back.

### Branding

The palette (`config/theme.colors`), the three font roles (from the bundled open-license font
sets — no external font CDN), and the five logo slots, each backed by the same image picker the
Media tab uses. Changes here restyle the live public site with no separate deploy — this is a
config write, not a code change.

## Legal pages (Settings, or wherever the review banner points)

Privacy policy and terms of service ship as CMS content pages seeded from provider-aware templates,
each clause needing review flagged `[Client legal review required]`. They stay flagged — a
persistent banner in the admin panel and a visible notice on the public page — until an admin clears
`config/event.legal.reviewRequired` after the client's counsel has actually reviewed the seeded
copy. See `docs/CLIENT_ONBOARDING.md`'s legal review section for the full context. Do not publish
another organization's terms verbatim; the seeded text is a starting point, not a finished policy.
