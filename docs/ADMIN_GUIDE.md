# Admin guide

How to run a client's site from the admin panel, in the order the work happens. For the narrative "why does this work this way" version, hand a new staff member [`docs/handbook/for-event-staff.md`](handbook/for-event-staff.md) first; come back here for a specific task. For what the look is made of underneath — every site style, every option, every token — see [`design-reference.md`](design-reference.md). You do not need it to run a site.

**Draft and live are separate almost everywhere below.** Saving writes a draft; publishing copies it to what attendees see. If a change is not showing up on the public site, check that you published, not only saved.

## Set the site up: Six steps

This is the whole visual setup, start to finish. It takes about twenty minutes and you do it once.

1. **Pick a site style.** Settings → Branding, the first control. Six ship; three are the launch surface and three sit behind a disclosure until you have tried them on your own content. Picking one replaces every value you have not changed yourself, so do this first.
2. **Add the identity assets.** Five slots: the primary logo and the square icon, then the footer logo, the social sharing image, and the favicon behind **More image slots**. Same picker the Media tab uses. A slot you leave empty falls back to the event name in type, which is a finished look and not a placeholder.
3. **Set the Main brand colour.** One colour. The darker and lighter steps, the rules, the control boundaries, and the whole dark palette are worked out from it. You do not set them, and no second colour anywhere changes how the public site looks.
4. **Preview representative pages.** The **Page preview** beside the controls renders *your* pages with the draft applied. Look at three: the home page, the schedule on its longest day, and one long text page. Check each light and dark.
5. **Resolve the warnings.** Anything the editor flags — a colour pair too close to read, a logo the wrong shape — is named with the pair, the mode, and the measurement. Fix what it names.
6. **Publish.** The live public site restyles with no deploy. This is a config write, not a code change.

**Two things are worth knowing before you start.** A contrast failure stops a publish, not a save — you can leave a draft broken and come back. And nothing you do here reaches attendees until step 6.

## Settings → Branding

One tab decides how the whole public site looks. Controls on one side, the **Page preview** on the other rendering your own pages with the draft applied. Pick which page to preview and whether to see it light or dark.

Work down the controls in this order.

**Site style.** The base look: a light palette, a dark palette, a type pairing, a shape, a header, and a default set of illustrations. Each one is finished work with a recommended configuration already chosen — you should not have to touch anything else to get a good result. The three on the launch surface have been run against real client content; the other three are fully functional and are grouped separately so you try them on your own event first. Picking a style replaces every value you have not changed yourself.

**Logo and icon.** Two slots are asked for here — the primary logo and the square icon — and the other three sit behind **More image slots**: the footer logo, the social sharing image, and the favicon. All five use the same image picker the Media tab uses.

**Main brand colour.** One colour, as a hex value. The darker and lighter steps, the rules, the control boundaries, and the whole dark palette are worked out from it. Leave it blank to keep the site style's own colour.

**Header style.** How the site's identity appears at the top of every page. Each site style offers its own three — a letterhead, a masthead bar, a title page — and comes with the one that suits it. This is a site-wide choice on purpose: the header is furniture a reader should stop noticing, and it stops working the moment it differs page to page.

**Schedule style.** How a session is set out on the schedule: a posted agenda, a hairline row, a departure board, and so on, depending on the style. Like the header style, it retunes the site style rather than inventing a value of its own, so you cannot make a combination the house has not looked at.

**Navigation.** Whether the navigation runs across the top or down the leading edge. One choice, every page, for the same reason the header is site-wide.

**Light or dark.** Always light, always dark, or follow the reader's own setting. Every site style defines both, so there is no wrong answer here.

**Admin marker colour.** The one colour on this tab that does not touch the public site. It is used in exactly two places in the admin panel — the marker beside the section you are in, and the mark on the page-header rule — and leaving it blank uses the admin's own ink, which is what most deployments do. If the colour you enter is too pale to read against the admin background, the marker falls back to that ink and the panel tells you the ratio it measured and what it fell back to; your value is stored exactly as you typed it, so you can adjust it rather than start again.

**Advanced.** Everything else the system can do, behind a disclosure, and none of it is needed for a finished site:

- *Typography* — the heading face, picked from the alternates your style offers, and any of the four font roles named outright.
- *Illustrations* — a set of small drawings that carry the style's vocabulary, or none. They take the site's own ink and never carry a colour of their own, so they cannot fight your palette.
- *Surface and shape* — the surface texture, the corners, the spacing, and any extra control your style has of its own.
- *Advanced colour settings* — any single colour by hand, per mode, with a light tab and a dark tab holding separate values.

**Most staff never open Advanced**, and that is the intended outcome: every value in there is normally worked out from the site style and the one brand colour. Setting a colour by hand takes it out of that derivation permanently, so it stops moving when your brand colour moves. Open **Advanced colour settings** when a brand guide names an exact value that the derived one does not reach; not to explore.

**A contrast failure stops a publish, not a save.** A draft may hold two colours too close together to read. Publishing that draft is refused, and the message names the pair, the mode, and the ratio it measured. Fix the pair, then publish again.

Fonts come from the bundled open-licence sets, so no page asks an external font service for anything.

## Pages

Every page document (About, Travel, Conduct, and anything else seeded or added) shows its state in the list, in the same three words every editor uses: **Draft** (never published), **Live** (published, with nothing pending), or **Live with unpublished changes** (published, with newer edits saved but not published yet). Create, edit, and publish from here.

**Pick what kind of page this is.** Six named tasks, and picking one shapes the page:

| Template | For |
|---|---|
| Standard page | The ordinary page. Start here. |
| Feature first | A page whose subject is the first thing to see. |
| Directory with introduction | A few words, then entries in columns — speakers, sponsors. |
| Long read | Mostly text, meant to be read straight through. |
| Schedule | Dense and time-led, so a long day fits on one screen. |
| Landing page | A front page or a section opener. |

The individual settings behind that — header, arrangement, spacing — are still reachable under a disclosure, for the page that genuinely needs to differ. Changing one clears the template, because a page that no longer matches its template should not go on claiming it.

**A system page** — home, schedule, speakers, sponsors — keeps its built-in content and lets you put sections around it. Each section picks where it goes relative to that content: **before the main feature** or **after the main feature**. Custom pages have no built-in content, so they have no position to pick.

## Content (Pages → Content editor)

Filling in what a page's blocks say is a separate step from shaping the page: pick a page, then a section, then the block inside it. A page's *structure* — its sections, which block types each allows, its default blocks — is set in the page editor above; this tree of screens is for the block *content*. All eight block types are editable here.

**A statistic needs four things**, and the editor will not save one without them: the finding in words ("Two thirds of sessions are workshops", not "Session types"), what the number counts and over what period, where the number came from and the date you read it, and a line describing the finding for a screen reader. A stat block saved before this rule existed keeps working; the next time you edit one, you will be asked to fill the four parts in.

## Media

A browsable library, split by namespace because each answers a different question:

- **`cms-images/`** — images used inside pages and posts. Client-writable through this tab.
- **`branding/`** — the logo slots, backed by the same reusable image picker the Branding tab uses.
- **`speaker-photos/`** — set from the speaker editor, not uploaded loose here.

Upload, edit alt text, and delete from the library. A delete warns you first if anything currently on the site references the asset — do not dismiss that warning without checking what it names.

## Speakers

The canonical speaker list, with each record's pipeline status and the entry points to create, edit, invite, and review pending edits. This list reads the real speaker records, not the public-facing projection, on purpose: an admin needs to see speakers who are not published yet — drafts, outstanding invites, soft-deleted records.

**Pipeline states**, top to bottom of what a record moves through:

| Status | What it means | Action available |
|---|---|---|
| Not invited | Record exists, no invite sent | Invite |
| Invite sent | Emailed; not yet accepted | Resend |
| Accepted / published | Speaker signed in and (optionally) edited their own profile | — |

**Pending-edits review.** A speaker can propose changes to their own profile after accepting an invite. Those queue rather than landing on the live record, until an admin approves them. Review and approve (or reject) from the speaker's row — the queued fields are named right there, so you are never approving a change blind.

**Create/edit form.** Every field except the account link and the invite token is editable here. Those two move together in a single server-side transaction as part of the invite/accept pipeline and are never part of an admin payload, by design: a leaked value there is rejected by name on the server, not silently accepted.

One speaker record is the source of truth. If a name is wrong in three places on the public site, fix the speaker record — do not patch each place it appears.

## Attendees

The full attendee list with registration status and a search/filter. What action is available depends on the current status:

- **Pending / ticketed** → Approve
- **Approved** → Revoke. Approving again is available only when the original approval came from a ticket; re-approving records the approval as an admin decision so a later revoke behaves correctly.
- **Revoked** → Approve. That is the only way out of revoked.

Approve and revoke always go through the server endpoints. Every registration field involved is server-owned and not editable directly, even for the account's own owner.

## Ticketing

Provider status, CSV import, and a searchable ticket list. What is here depends on the client's provider choice ([`CLIENT_ONBOARDING.md`](CLIENT_ONBOARDING.md) §3 item 5):

- **Eventbrite**: Provider status shows webhook registration state and recent sync activity.
- **Manual / CSV import**: Upload a spreadsheet, map its columns to attendee fields, preview the import as a dry run, then commit it. That is the whole ticketing story for a manual deployment.
- **None**: Nothing to configure.

Ticket records are server-only in Firestore. Every list, search, and import here goes through an admin-gated endpoint.

## Live updates

Compose, edit, and delete entries in the live-updates feed shown on the public site. There is no draft/publish step here, unlike the CMS content tabs — a save is live immediately. This is an admin-authored feed only; nothing ingests from Slack or any other external source.

## Feedback

Every submission from the public feedback modal, newest first, with a mark-reviewed / archived action. Admins can read the feedback collection directly; only the status change goes through an admin endpoint, because every client write to that collection is denied outright.

## Materials

Session materials review — upload or link files against a session, with an optional embargo that holds the material until the session ends. Prefer a real label ("Slides") over a bare URL as the link text a viewer sees. This collection is fully server-only, even for an admin's direct read, so every action here goes through Cloud Functions.

## System errors

Unresolved system-error rows — the operational surface for things like an invalid email-template override falling back to its code default. Each row has a resolve action. If you are chasing down why a template edit "is not working", check here before assuming it is a bug: a rejected override logs here and silently keeps serving the last-good copy rather than breaking the send.

## Settings → Event settings

The event's own identity fields: name, dates, timezone, venue, sender address, and the rest. This is a merge-then-validate write — the form only sends the keys it is actually changing, and fields it does not touch (the legal postal address, the SEO metadata) are left alone.

**Tracks** live here too: the lines your event runs when sessions happen at the same time in different rooms. Each track has a letter (A to Z) and a name, and the schedule shows both — a reader tells two lines apart by the letter and the name, never by colour alone. Sessions point at a track by its letter, so renaming a track is one edit here rather than a change to every session. Leave the list empty if everything happens in one room.

**What the track list changes on the public site.** Once you list tracks, the schedule draws as a grid on a wide screen: time down the left, one column per track, in the order you listed them. On a phone — and for anyone reading with a screen reader — the same day reads as a time-ordered list, which is a designed view rather than a lesser one. A session with no track runs across the whole width, which is what a plenary is. A session that names a parent is listed under it as a stop on the way through it rather than as a separate entry, in both views.

**Past days become back issues.** When a day ends, its page keeps every word and quietens: the colour drops out, the day head says "Back issue", and the controls that act on a live event — bookmarking, reactions, adding to a calendar — go away. Nothing is hidden, and every link still works. Setting an **archive date** for the whole event does the same thing to every day at once.

**Printing.** Print any schedule page and you get the handout: every day of the event, every session and every stop under it, tracks named by letter and name, no buttons. You do not have to prepare anything for it, and you get the light edition even if you print from a dark screen.

## Settings → Features

Feature flags, wired to a **whole-document replace** — every known flag is always sent, and an omitted flag means disabled. When a new flag is added to the platform it appears here automatically, because the form's key list comes from the same shared schema the server validates against.

## Settings → Badges

The badge catalog: categories, each with a max-picks cap and its list of badges, which attendees self-select from on their profile. Also a whole-document replace — editing one badge sends the complete set of categories back.

## Legal pages

Privacy policy and terms of service ship as CMS content pages seeded from provider-aware templates, each clause needing review flagged `[Client legal review required]`. They stay flagged — a persistent banner in the admin panel and a visible notice on the public page — until an admin clears the review flag after the client's counsel has actually reviewed the seeded copy. See [`CLIENT_ONBOARDING.md`](CLIENT_ONBOARDING.md)'s legal review section for the full context. Do not publish another organization's terms verbatim; the seeded text is a starting point, not a finished policy.
