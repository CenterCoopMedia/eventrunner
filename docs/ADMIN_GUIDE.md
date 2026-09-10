# Admin guide

How to run a client's site from the admin panel, in the order the work happens. For the narrative "why does this work this way" version, hand a new staff member [`docs/handbook/for-event-staff.md`](handbook/for-event-staff.md) first; come back here for a specific task. For what the look is made of underneath — every site style, every option, every token — see [`design-reference.md`](design-reference.md). You do not need it to run a site.

**Draft and live are separate almost everywhere below.** Saving writes a draft; publishing copies it to what attendees see. If a change is not showing up on the public site, check that you published, not only saved.

## Set the site up: Six steps

This is the whole visual setup, start to finish. It takes about twenty minutes and you do it once.

1. **Pick a site style.** Settings → Branding, the first control. Six ship; three are the launch surface and three sit behind a disclosure until you have tried them on your own content. Picking one replaces every value you have not changed yourself, so do this first.
2. **Add the identity assets.** Five slots: The primary logo and the square icon, then the footer logo, the social sharing image, and the favicon behind **More image slots**. Same picker the Media tab uses. A slot you leave empty falls back to the event name in type, which is a finished look and not a placeholder.
3. **Set the Main brand colour.** One colour. The darker and lighter steps, the rules, the control boundaries, and the whole dark palette are worked out from it. You do not set them, and there is no second colour to set anywhere.
4. **Preview representative pages.** The **Page preview** beside the controls renders *your* pages with the draft applied. Look at three: The home page, the schedule on its longest day, and one session. Check each light and dark, and turn the **stress test** on once.
5. **Resolve the warnings.** Anything the editor flags — a colour pair too close to read, a logo the wrong shape — is named with the pair, the mode, and the measurement. Fix what it names.
6. **Publish.** The live public site restyles with no deploy. This is a config write, not a code change.

**Two things are worth knowing before you start.** A contrast failure stops a publish, not a save — you can leave a draft broken and come back. And nothing you do here reaches attendees until step 6.

## Settings → Branding

One tab decides how the whole public site looks. Controls on one side, the **Page preview** on the other rendering your own pages with the draft applied — the client's real pages, not swatches.

**What the preview can show you.** Pick the page — Home, Schedule, Session, Speakers, or Updates. Switch between **Desktop** and **Phone**, which render at real widths so the page's own breakpoints fire inside the frame. **Fit** the frame or see it at **Actual size**. Show it **Light**, **Dark**, or **Compare light and dark** side by side. And turn on the **stress test**: A made-up event name that wraps three times and a day packed with 28 sessions, so you meet a hard page here rather than after a client sends one. Nothing in the stress test is saved. If a colour or a font will not render as you asked, the preview says so.

Work down the controls in this order.

**Site style.** The base look: A light palette, a dark palette, a type pairing, a shape, a header, and a default set of illustrations. Each one is finished work with a recommended configuration already chosen — you should not have to touch anything else to get a good result. The three on the launch surface have been run against real client content; the other three are fully functional and are grouped separately so you try them on your own event first. Picking a style replaces every value you have not changed yourself.

**Logo and icon.** Two slots are asked for here — the primary logo and the square icon — and the other three sit behind **More image slots**: The footer logo, the social sharing image, and the favicon. All five use the same image picker the Media tab uses.

**Main brand colour.** One colour, as a hex value. The darker and lighter steps, the rules, the control boundaries, and the whole dark palette are worked out from it. Leave it blank to keep the site style's own colour.

**Header and schedule.** One panel holding two choices. **Header style** is how the site's identity appears at the top of every page: Each site style offers its own three — a letterhead, a masthead bar, a title page — and comes with the one that suits it. It is a site-wide choice on purpose, because the header is furniture a reader should stop noticing and it stops working the moment it differs page to page. **Schedule style** is how a session is set out on the schedule: A posted agenda, a hairline row, a departure board, and so on, depending on the style. Both retune the site style rather than inventing a value of their own, so you cannot make a combination the house has not looked at.

**Light or dark.** Always light, always dark, or follow the reader's own setting. Every site style defines both, so there is no wrong answer here.

**Admin colours.** The colour of the admin's own rail, buttons and links — this panel, not the public site. By default it follows the Main brand colour, adjusted until white text and the focus ring hold their contrast in light and in dark. Or pick one of six house schemes: navy, graphite, forest, oxblood, teal or plum. The admin changes colour when you publish the theme, and attendees never see it.

**Advanced.** Everything else the system can do, behind a disclosure, and none of it is needed for a finished site:

- *Navigation* — **Where the navigation sits**: Across the top, or down the leading edge on wide screens. One choice, every page, for the same reason the header is site-wide. A single page can overrule it from the page editor.
- *Typography* — the heading face, picked from the alternates your style offers, and any of the four font roles named outright from the 23-family library.
- *Illustrations* — a set of small drawings that carry the style's vocabulary, or none. They take the site's own ink and never carry a colour of their own, so they cannot fight your palette.
- *Surface and shape* — the surface texture, the corners, the spacing, and any extra control your style has of its own.
- *Advanced colour settings* — any single colour by hand, per mode, with a light tab and a dark tab holding separate values.

**Most staff never open Advanced**, and that is the intended outcome: Every value in there is normally worked out from the site style and the one brand colour. Setting a colour by hand takes it out of that derivation permanently, so it stops moving when your brand colour moves. Open **Advanced colour settings** when a brand guide names an exact value that the derived one does not reach; not to explore.

**A contrast failure stops a publish, not a save.** A draft may hold two colours too close together to read. Publishing that draft is refused, and the message names the pair, the mode, and the ratio it measured. Fix the pair, then publish again.

Fonts come from the bundled open-licence sets, so no page asks an external font service for anything.

## Pages

Every page document (About, Travel, Conduct, and anything else seeded or added) shows its state in the list, in the same three words every editor uses: **Draft** (never published), **Live** (published, with nothing pending), or **Live with unpublished changes** (published, with newer edits saved but not published yet). Create, edit, and publish from here.

**The site navigation is this list.** Every page that is visible gets a link in the header, in the order the list shows, under the label you gave it — so adding a page adds its link, hiding a page removes it, and renaming a page renames it in the navigation too. Nobody has to deploy anything for that to happen. One thing keeps a visible page out: a system page whose feature is switched off on the Features tab. An Updates page is still a page when *Updates* is off — it just has nowhere to send a reader.

**A page can carry two names.** The **navigation label** is what the header and the footer print, and every page shares one row, so keep it short — the seeded pages use FAQ, Conduct, Privacy, Terms. The **page heading** is the heading at the top of the page itself, and it is optional: leave it blank and the page is headed by its label. Set it only where the short label would read oddly as a heading, the way the FAQ page is labelled FAQ and headed *Frequently asked questions*. The heading is also what the browser tab and a shared link show.

**A built-in page has no heading field.** Schedule, Speakers, Sponsors, Attendees, Updates, and the home page write their own heading, so the editor states that where the field would be and offers nothing to set. Rename one of these in the navigation label and the browser tab follows the label too.

**One item is not a page.** The navigation ends with the account control, which the site adds itself. It reads **Sign in** for a reader who is not signed in and **Your profile** for one who is. You cannot remove it or reorder it, and it needs no page document.

**The footer lists the same pages.** The footer repeats the page list under the same rules, so a page you hide leaves both places at once and a page you rename is renamed in both. Below it the footer names the organization that operates the event and links its support address, both from the event configuration, and lists the event's social accounts if the configuration records any. Each account link is labelled with the service and the handle together, such as Mastodon @summit, so two accounts on one service can be told apart; an account recorded with no handle is labelled with the service name alone. An event with no social accounts gets no social block, not an empty one. Social account links are set when the site is created and have no editor here yet.

**Pick what kind of page this is.** Six named tasks, and picking one shapes the page:

| Template | For |
|---|---|
| Standard page | The ordinary page. Start here. |
| Feature first | A page whose subject is the first thing to see. |
| Directory with introduction | A few words, then entries in columns — speakers, sponsors. |
| Long read | Mostly text, meant to be read straight through. |
| Schedule | Dense and time-led, so a long day fits on one screen. |
| Landing page | A front page or a section opener. |

The individual settings behind that — header, arrangement, spacing — are still reachable under **Change the individual settings**, for the page that genuinely needs to differ. Changing one there clears the template and the template reads **Custom** from then on, because a page that no longer matches its template should not go on claiming it. A page that has never been given a template or a layout renders the defaults, so nothing changes until you change it.

**Where the navigation sits is one choice for the whole site.** Across the top, or down the side on wide screens, set on the Branding tab under **Advanced → Navigation**, because a navigation that wanders between pages stops being the shell that tells a reader where they are. That is the default every page follows.

One page can still differ. **Change the individual settings** also carries **Navigation on this page**: Leave it on *Follow the site setting* — which names what the site is currently set to — or overrule it for this page alone. Use it sparingly and on purpose: A rail beside one long directory is a decision; a rail on three pages out of nine is an accident. It is not part of a template, so setting it leaves the template alone.

**What a shared link shows.** The server builds the tab title, the search description, and the link preview card for each page from the page's own name plus the event settings, so a link to the travel page shows the travel page's own name rather than the site's front door. Sessions and speaker pages use their own record. The picture on the card is the **social sharing image** slot on the Branding tab; leave it empty and a neutral placeholder is used. Upload a PNG or a JPEG there, sized 1200 by 630, and not an SVG: the services that draw these cards fetch the file themselves and do not reliably render SVG, so one would leave the card blank. Three things are deliberately left plain: a page that is hidden, a system page whose feature is switched off, and an address that matches no page. Those get the event name alone and are marked so search engines skip them, so an unfinished page cannot be found through search before you publish it. A change reaches previews within a few minutes of the publish.

**A system page** — home, schedule, speakers, sponsors, attendees, updates — keeps its built-in feature and lets you put sections around it. Each section on one of those pages picks where it is inserted: **Before the main feature** or **After the main feature**. Custom pages have no built-in feature, so they have no insertion point to pick.

## Sessions

The schedule itself: Create, edit, publish, and delete a session. Saving writes a draft, and publishing sends it to the public schedule, the same two steps every other content tab uses. Use **Preview draft** to read the session's public page with the draft applied before you publish it.

**Recording link.** One optional field on a session, in the **Public session** panel. Enter the address where attendees can watch the session afterwards. The link must start with `http://` or `https://`; the editor and the server both refuse anything else, so a session cannot store an address a reader's browser would treat as a script. Leave the field empty until the recording is public. A session with a recording link shows **Watch the recording** on its schedule row and on its session page, and the link opens in a new tab. A session with no link shows nothing at all, so an empty field does not promise a recording later. The link stays on the page after the event, when a past day becomes a back issue and the live controls come off.

## Content (Pages → Content editor)

Filling in what a page's blocks say is a separate step from shaping the page: Pick a page, then a section, then the block inside it. A page's *structure* — its sections, which block types each allows, its default blocks — is set in the page editor above; this tree of screens is for the block *content*. All eight block types are editable here.

**The home page's Key facts section is a group of cards.** It answers the questions a first-time reader arrives with. Each **statistic** in that section opens a card. Each **list item** after a statistic is a line on that card, so a card is one figure and then whatever a reader also needs to know beside it. Move a line under a different statistic and it moves to that card. On a wide screen the cards sit in a row of three; on a phone they stack into one plain list, in the same order.

**You place it, like any other section.** Move it up or down the home page's section list and the group moves with it. Set it to appear before or after the main feature and it obeys that too. The seed puts it near the top, under the opening, which is where a reader looks first.

**A fresh site seeds one card**: The dates as the figure, and three lines for the venue name, its address, and the nearest transit. Add a statistic to open a second card. A fact that is not a number — a venue, an audience — belongs in the lines, not in a statistic: A statistic has to name where its number came from, and there is no source to name for the name of a hall. Empty the section, or fill it only with block types this section does not draw, and no heading is printed at all.

**The home page's Sponsors section is the logo wall, not a list of blocks.** It holds one line of text, and under it the site draws the same tiered logo wall the Sponsors page draws, from the same published organizations in the same tier order. Add or reorder organizations in the Organizations list; nothing about them is edited here.

**It is a section like any other, so you place it.** Move it up or down the home page's section list and the wall moves with it. Set it to appear before or after the main feature and it obeys that too. The section draws nothing at all when no organization is published yet, when the *Sponsors* feature is switched off, or when you delete the section from the home page. Deleting the section is how you take the wall off the home page and keep the Sponsors page.

**A statistic needs four things**, and the editor will not save one without them: The finding in words ("Two thirds of sessions are workshops", not "Session types"), what the number counts and over what period, where the number came from and the date you read it, and a line describing the finding for a screen reader. A stat block saved before this rule existed keeps working; the next time you edit one, you will be asked to fill the four parts in.

## Media

A browsable library, split by namespace because each answers a different question:

- **`cms-images/`** — images used inside pages and posts. Client-writable through this tab.
- **`branding/`** — the logo slots, backed by the same reusable image picker the Branding tab uses.
- **`speaker-photos/`** — set from the speaker editor, not uploaded loose here.

Upload, edit alt text, and delete from the library. A delete warns you first if anything currently on the site references the asset — do not dismiss that warning without checking what it names.

## Speakers

The canonical speaker list, with each record's pipeline status and the entry points to create, edit, invite, and review pending edits. This list reads the real speaker records, not the public-facing projection, on purpose: An admin needs to see speakers who are not published yet — drafts, outstanding invites, soft-deleted records.

**Pipeline states**, top to bottom of what a record moves through:

| Status | What it means | Action available |
|---|---|---|
| Not invited | Record exists, no invite sent | Invite |
| Invite sent | Emailed; not yet accepted | Resend |
| Accepted / published | Speaker signed in and (optionally) edited their own profile | — |

**Pending-edits review.** A speaker can propose changes to their own profile after accepting an invite. Those queue rather than landing on the live record, until an admin approves them. Review and approve (or reject) from the speaker's row — the queued fields are named right there, so you are never approving a change blind.

**Create/edit form.** Every field except the account link and the invite token is editable here. Those two move together in a single server-side transaction as part of the invite/accept pipeline and are never part of an admin payload, by design: A leaked value there is rejected by name on the server, not silently accepted.

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

Unresolved system-error rows — the operational surface for things like an invalid email-template override falling back to its code default. Each row has a resolve action. If you are chasing down why a template edit "is not working", check here before assuming it is a bug: A rejected override logs here and silently keeps serving the last-good copy rather than breaking the send.

## Settings → Event settings

The event's own identity fields: Name, dates, timezone, venue, sender address, and the rest. This is a merge-then-validate write — the form only sends the keys it is actually changing, and fields it does not touch (the legal postal address, the SEO metadata) are left alone.

**Tracks** live here too: The lines your event runs when sessions happen at the same time in different rooms. Each track has a letter (A to Z) and a name, and the schedule shows both — a reader tells two lines apart by the letter and the name, never by colour alone. Sessions point at a track by its letter, so renaming a track is one edit here rather than a change to every session. Leave the list empty if everything happens in one room.

**What the track list changes on the public site.** Once you list tracks, the schedule draws as a grid on a wide screen: Time down the left, one column per track, in the order you listed them. On a phone — and for anyone reading with a screen reader — the same day is a time-ordered list. It contains the same sessions in the same order as the wide-screen grid. A session with no track runs across the whole width, which is what a plenary is. A session that names a parent is listed under it as a stop on the way through it rather than as a separate entry, in both views.

**The register control.** Two fields under Registration draw the one control that sends a reader to wherever you actually take registrations: the **external registration URL** and the **register button label**. Set the URL and the control appears twice — as the filled action at the top of the home page, and as a quiet control in the site header on every page. It opens in a new tab, because the form belongs to your ticket provider rather than to this site. The label is what the control says; leave it empty and it says "Register".

**Leave the URL empty and no control is drawn anywhere.** That is the right answer for an event that takes no registrations yet, or one whose provider has not given you a link. The site would rather say nothing than show a button that goes nowhere. The URL must start with `https://` — a save with anything else is refused and the field says why, because a registration form is where a reader types their name and their email.

**It is the same URL your registration email uses.** Your ticket provider reads this same field when it builds the email a new account gets, so the link on the page and the link in that email can never drift apart. Change it here and both change.

**Past days become back issues.** When a day ends, its page keeps every word and quietens: The colour drops out, the day head says "Back issue", and the controls that act on a live event — bookmarking, reactions, adding to a calendar — go away. Nothing is hidden, and every link still works. Setting an **archive date** for the whole event does the same thing to every day at once.

**The home page counts down on its own.** Before the first day starts, the home page shows a live countdown to that moment, reading the dates and timezone set here. Once the first day begins, the countdown stops and the page states that the event is running, checking about once a minute so it moves on to stating the event has ended on its own once the last day is over — a reader does not have to reload the page for that. Setting the **archive date** states the same "event has ended" line; nothing looks different to a reader. Nothing to configure: the page always reads the same dates, timezone, and archive date this section sets.

**Printing.** Print any schedule page and you get the handout: Every day of the event, every session and every stop under it, tracks named by letter and name, no buttons. You do not have to prepare anything for it, and you get the light edition even if you print from a dark screen.

**Venue map.** Upload a map of the building and the travel page prints it, with the venue's rooms listed beside it. Under **Venue map** you choose or upload the image the same way you pick any other picture, and then write the **alt text**: One sentence saying what the map shows. The alt text is required — a map with none does not publish, because an image nobody described tells a reader using a screen reader nothing at all. The picture has to come from the media library, so a link to a map on somebody else's site is refused; upload the file instead.

**Where the map appears.** The travel page carries a section called **Venue map** (its id is `travel_map`), and the map draws wherever that section sits, so you move the map by moving the section in Pages. If your travel page does not have that section — every site set up before this feature shipped is in that position — the map draws at the end of the page instead, so uploading one always publishes something.

**Marking rooms on the map.** A marker puts a numbered dot on the image where one of your places is. Add one with **Add marker**, pick the room, and type how far **across** and **down** it sits as percentages of the picture: 0 across is the left edge, 100 the right; 0 down is the top, 100 the bottom. Every place is listed beside the map whether or not you mark it, and the number on the dot is the number in the list, so a reader can match the two. Numbers run down the list in the order your places are listed, not the order you added the markers. One marker per room. **Remove marker** takes one off, and removing a place takes its marker with it — the panel says so before you save.

## Settings → Features

Feature flags, wired to a **whole-document replace** — every known flag is always sent, and an omitted flag means disabled. When a new flag is added to the platform it appears here automatically, because the form's key list comes from the same shared schema the server validates against.

## Settings → Badges

The badge catalog: Categories, each with a max-picks cap and its list of badges, which attendees self-select from on their profile. Also a whole-document replace — editing one badge sends the complete set of categories back.

## Legal pages

Privacy policy and terms of service ship as CMS content pages seeded from provider-aware templates, each clause needing review flagged `[Client legal review required]`. They stay flagged — a persistent banner in the admin panel and a visible notice on the public page — until an admin clears the review flag after the client's counsel has actually reviewed the seeded copy. See [`CLIENT_ONBOARDING.md`](CLIENT_ONBOARDING.md)'s legal review section for the full context. Do not publish another organization's terms verbatim; the seeded text is a starting point, not a finished policy.
