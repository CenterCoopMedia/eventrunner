# Admin guide

How to run a client's site from the admin panel, in the order the work happens. For the narrative "why does this work this way" version, hand a new staff member [`docs/handbook/for-event-staff.md`](handbook/for-event-staff.md) first; come back here for a specific task. For what the look is made of underneath — every site style, every option, every token — see [`design-reference.md`](design-reference.md). You do not need it to run a site.

**Draft and live are separate almost everywhere below.** Saving writes a draft; publishing copies it to what attendees see. If a change is not showing up on the public site, check that you published, not only saved.

## Who can do what: Operator and staff

An admin account holds one of two tiers. The rail shows the tier under your address, and it shows only the sections your tier can open. A link you type or follow to a section outside your tier meets a refusal, not the page. The server and the database rules refuse the same requests, so the tier is not only a matter of what the rail shows.

| Tier | Sections | For |
|---|---|---|
| Operator | Everything below, plus Features, Branding, Access, and System errors | The person who set the site up and answers for the deployment |
| Staff | Overview, Pages, Sessions, Organizations, Content, Updates, Media, Materials, Speakers, Attendees, Badges, Live updates, Ticketing, Feedback, Email log, Change requests, and Event settings | The people who run the event day to day |

Event settings are staff work because dates, venue, places, tracks, the register link, and social handles are content. Two things in there stay with the operator. The sender block: Staff can read the sender email, the sender name, and the reply-to address, and cannot change any of the three, because that is the email identity the deployment was verified against. The social sharing image (`seo.defaultOgImagePath`): It is branding, and only an operator changes it. A staff save that would change either is refused and the field is named.

An operator grants and revokes access on the Access page (below). At least one operator must always remain, and the server refuses a change that would leave none.

## Set the site up: Six steps

This is the whole visual setup, start to finish. It takes about twenty minutes and you do it once.

1. **Pick a site style.** Settings → Branding, the first control. Six site styles are available. Try your chosen style on your own content. Picking one replaces every value you have not changed yourself, so do this first.
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

**Site style.** The base look: A light palette, a dark palette, a type pairing, a shape, a header, and a default set of illustrations. Each one is finished work with a recommended configuration already chosen — you should not have to touch anything else to get a good result. Try the selected style on your event content before publishing. Picking a style replaces every value you have not changed yourself.

**Logo and icon.** Two slots are asked for here — the primary logo and the square icon — and the other three sit behind **More image slots**: The footer logo, the social sharing image, and the favicon. All five use the same image picker the Media tab uses.

The square icon also sets the app icon. A phone or a desktop browser shows the app icon when a visitor installs the site. To use your own app icon, upload a square PNG to the square icon slot, from 512 to 4096 pixels on a side. Any other value gives the neutral placeholder icon: An SVG, JPEG, or WebP file, an image that is not square, or a path that is not an uploaded file. The app icon changes at the next deploy. If the site publisher is on for your deployment, it also changes at the next content publish. Publishing the theme alone does not change it. When the placeholder is used, the deploy log names the reason. If the site publisher is on, its log after a content publish names the reason too. [`DEPLOY_RUNBOOK.md`](DEPLOY_RUNBOOK.md) §9 describes the site publisher.

**Main brand colour.** One colour, as a hex value. The darker and lighter steps, the rules, the control boundaries, and the whole dark palette are worked out from it. Leave it blank to keep the site style's own colour.

**Five more choices sit under Advanced.** Each site style also answers **Long read opening** (a drop cap, a standfirst, or plain, for the first paragraph of a page on the Long read template), **Quote device** (how a quoted sentence is set), **Directory style** (how the speaker shelf and the attendee index are set), **Section boundary** (whether a section heading carries its folio, and where), and **Table rules** (hairline rows, a ruled head, or the full grid). Every style comes with the answer that suits it, and each choice retunes values the style already declares.

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

## Overview

The admin opens here, for staff and operators alike. The page states how the event is going in short sentences. The server counts every number in them when you open the page or refresh it, so a figure is never a guess made in your browser.

| Sentence | What it counts |
|---|---|
| Accounts | Every account, then the accounts at each registration status: Pending, ticketed, approved, and revoked. |
| Profiles complete | The accounts with a complete profile, out of all accounts. |
| Tickets | Every ticket record, then valid, refunded, cancelled, and waiting for details. A ticket is one ticket record, not one seat. |
| Speakers | Every speaker record, by stage: Draft, invited, accepted, approved, and removed. |
| Sessions | The sessions on the site, and the sessions with unpublished changes. A new session that was never published counts as one with unpublished changes. |
| Unresolved errors | The count only. Operators read the errors themselves on the System errors page. |

**Read at.** The time under the title says when the server counted the figures, on the event's clock. The figures do not change by themselves. Select **Refresh figures** to count again. If a refresh fails, the page keeps the figures it has and says when they were read.

**Registration funnel.** Three stages, each stated as a number of all accounts beside a bar: **Accounts**, then **Ticketed or approved**, then **Approved**. The middle stage counts approved accounts too, because an admin can approve an account that never held a ticket. Revoked accounts count as accounts and in no later stage, and the panel says how many there are. With no accounts, the panel says "No one has signed up yet." and draws no bar.

**Content readiness.** A table with one row per collection: Pages, Content blocks, Sessions, Organizations, Timeline, and Updates. **On the site** counts the records attendees can see. **Unpublished changes** counts the records with a draft that is not published yet, including new records that were never published. A zero is printed as 0, and when nothing at all is on the site the panel says so.

**Milestones.** When the event settings list milestones or a registration goal, a **Milestones** panel sets the approved count against the goal and lists each milestone with its date and the days left. You set both under Settings → Event settings, in **Milestones and the registration goal**. With neither set, the panel is not shown.

## Pages

Every page document (About, Travel, Conduct, and anything else seeded or added) shows its state in the list, in the same three words every editor uses: **Draft** (never published), **Live** (published, with nothing pending), or **Live with unpublished changes** (published, with newer edits saved but not published yet). Create, edit, and publish from here.

**The site navigation is this list.** Every page that is visible gets a link in the header, in the order the list shows, under the label you gave it — so adding a page adds its link, hiding a page removes it, and renaming a page renames it in the navigation too. Nobody has to deploy anything for that to happen. One thing keeps a visible page out: a system page whose feature is switched off on the Features tab. An Updates page is still a page when *Updates* is off — it just has nowhere to send a reader.

**A page can carry two names.** The **navigation label** is what the header and the footer print, and every page shares one row, so keep it short — the seeded pages use FAQ, Conduct, Privacy, Terms. The **page heading** is the heading at the top of the page itself, and it is optional: leave it blank and the page is headed by its label. Set it only where the short label would read oddly as a heading, the way the FAQ page is labelled FAQ and headed *Frequently asked questions*. The heading is also what the browser tab and a shared link show.

**A built-in page has no heading field.** Schedule, Speakers, Sponsors, Attendees, Updates, and the home page write their own heading, so the editor states that where the field would be and offers nothing to set. Rename one of these in the navigation label and the browser tab follows the label too.

**One item is not a page.** The navigation ends with the account control, which the site adds itself. It reads **Sign in** for a reader who is not signed in and **Your profile** for one who is. You cannot remove it or reorder it, and it needs no page document.

**The footer lists the same pages.** The footer repeats the page list under the same rules, so a page you hide leaves both places at once and a page you rename is renamed in both. Below it the footer names the organization that operates the event and links its support address, both from the event configuration, and lists the event's social accounts if the configuration records any. Each account link is labelled with the service and the handle together, such as Mastodon @eventname, so two accounts on one service can be told apart; an account recorded with no handle is labelled with the service name alone. An event with no social accounts gets no social block, not an empty one. You add and edit the accounts under Settings → Event settings, in the **Social accounts** panel.

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

**Most saved.** The panel at the top of the list ranks the sessions by how many attendees saved them to their own schedule, most first. Each row names the session, links to its editor, and gives its day and the count. The counts are the same ones the public schedule shows. A sentence under the table says how many sessions on the site nobody has saved yet; drafts and hidden sessions are not counted, because attendees cannot save them. Before anyone saves a session the panel says "No session has been saved yet." If the `sessionBookmarks` feature is off (Settings → Features), the panel says so, because the counts cannot change until an operator turns it on again.

**Recording link.** One optional field on a session, in the **Public session** panel. Enter the address where attendees can watch the session afterwards. The link must start with `http://` or `https://`; the editor and the server both refuse anything else, so a session cannot store an address a reader's browser would treat as a script. Leave the field empty until the recording is public. A session with a recording link shows **Watch the recording** on its schedule row and on its session page, and the link opens in a new tab. A session with no link shows nothing at all, so an empty field does not promise a recording later. The link stays on the page after the event, when a past day becomes a back issue and the live controls come off.

## Organizations

The organizations the Sponsors page draws: Add, edit, publish, and delete them here, without a script. Saving writes a draft, and publishing sends it to the Sponsors page and to the home page's logo wall.

**The list** is a table in the order the Sponsors page draws the organizations: by **Order**, lowest first. Each row gives the name, the page address, the tier, the order, and the state in words. An organization that is saved but not shown on the site also says **Hidden**. **Publish all** publishes every organization with a saved draft.

**The fields.** **Name** is required. **Description** is one or two sentences under the name on the organization's page and on the Sponsors page in the list arrangement. **Website** must start with `http://` or `https://`. **Tier** is the group heading on the Sponsors page. **Order** is a number, and lower numbers come first. **Logo** comes from the media library, or you upload it there. Clear **Show this organization when it is published** to keep a published organization off the site.

**Tiers group by their exact text.** Organizations with the same tier text form one group, so "Gold" and "gold" are two groups. The Tier field suggests the tiers already in use. The groups appear in the order of their first organization, and the first group draws the largest logos. To move a tier up, give its organizations lower order numbers.

**Each organization has its own page** at its page address, `/sponsors/` and then the address. It shows the logo, the name, the description, the tier, and a link to the website. The **Read more** link on the Sponsors page opens it. Use **Preview draft** to read the page with the draft applied before you publish it.

**The page address is set once.** A new organization's page address follows its name until you type your own. It uses lowercase letters, digits, and hyphens, and it cannot change after the first save. To change it, delete the organization and add it again. Two organizations cannot share an address: The editor names an address already in use before it saves, and the server refuses a second organization with the same address when you save, not when you publish. Deleting an organization frees its address.

**Every save is checked.** The editor and the server refuse an empty name, an order that is not a number, and a website that does not start with `http://` or `https://`. The server also refuses a name that is not text, and it checks the logo path: The path must point inside the site's own files, so a web address, a path that starts with `/`, and a path that contains `..` are refused. The server does not check that the file exists. Each refusal names the field, and the editor shows it on that field, the logo's on the Logo field.

**Delete** removes the live organization and its draft. The logo stays in the media library.

## Content (Pages → Content editor)

Filling in what a page's blocks say is a separate step from shaping the page: Pick a page, then a section, then the block inside it. A page's *structure* — its sections, which block types each allows, its default blocks — is set in the page editor above; this tree of screens is for the block *content*. All eleven block types are editable here.

**A fact is a term and a description.** The **fact** block carries three parts: The term ("Where", "Who", "Format"), the fact itself (the hall's name, the audience), and one optional line under it (the address, a way to get there). It asks for no source and no finding, because a venue counts nothing. A run of facts renders as one ruled list of term and description pairs. Use it for anything that is true and is not a number.

**A quote is one sentence and who said it.** The **quote** block carries the sentence, without quotation marks, and an optional attribution. The site draws the marks and the rules in every site style, either a large opening mark or a pair around the sentence. One pull quote per page: The first quote block on a page, in reading order, is set as the pull quote, and any quote after it is set as a plain quotation in the body, with its attribution under it. Nothing you wrote is dropped; the second one does not take the page's one expressive frame.

**The home page's Key facts section is a group of cards.** It answers the questions a first-time reader arrives with. Each **fact** or **statistic** in that section opens a card. Each **list item** after one is a line on that card, so a card is one fact and then whatever a reader also needs to know beside it. Move a line under a different fact and it moves to that card. On a wide screen the cards sit in a row of three; on a phone they stack into one plain list, in the same order.

**You place it, like any other section.** Move it up or down the home page's section list and the group moves with it. Set it to appear before or after the main feature and it obeys that too. The seed puts it near the top, under the opening, which is where a reader looks first.

**A fresh site seeds three cards**: When, with the dates from your event settings; Where, with the venue's name and its address under it, and one line for the nearest transit; and Who, which you write. The When card follows your event settings for as long as you have not edited it: Move a day in Settings and the card moves with it, so it never disagrees with the Dates list beside it. Remove every day and the card goes back to the placeholder the seed writes for an event with no dates. Edit the card and it reads as you wrote it from then on. Add a statistic to open a card on a figure that is evidence: A statistic has to name where its number came from, and there is no source to name for the name of a hall, which is why a place or an audience is a fact and not a statistic. Empty the section, or fill it only with block types this section does not draw, and no heading is printed at all.

**The home page's Sponsors section is the logo wall, not a list of blocks.** It holds one line of text, and under it the site draws the same tiered logo wall the Sponsors page draws, from the same published organizations in the same tier order. Add or reorder organizations in the Organizations list; nothing about them is edited here.

**It is a section like any other, so you place it.** Move it up or down the home page's section list and the wall moves with it. Set it to appear before or after the main feature and it obeys that too. The section draws nothing at all when no organization is published yet, when the *Sponsors* feature is switched off, or when you delete the section from the home page. Deleting the section is how you take the wall off the home page and keep the Sponsors page.

**A sponsor package is one thing a sponsor can support.** The **sponsor package** block carries a name and what the package includes, both required, and an optional price and limit. Write the price as it should read, with its currency. The limit is how many sponsors can take the package, as a whole number of 1 or more: The page shows "Open to 3 sponsors", and shows nothing for no limit. The save refuses any other number. The Sponsors page seeds one section for packages, **Sponsorship packages**, after the logo wall. It is not shown until it holds a package, so an empty section never reaches a visitor. A site whose Sponsors page was edited before this section existed keeps its own sections; add the section in Pages if you want it.

**A statistic needs four things**, and the editor will not save one without them: The finding in words ("Two thirds of sessions are workshops", not "Session types"), what the number counts and over what period, where the number came from and the date you read it, and a line describing the finding for a screen reader. A stat block saved before this rule existed keeps working; the next time you edit one, you will be asked to fill the four parts in.

## Updates

The posts on the site's Updates page. Each row gives the post's title, its state in the three words every editor uses, its date, its category, and its place in the list: **Featured**, **Featured and pinned**, **Pinned**, or **By date**. A post that is not shown when published also carries **Hidden**. The list is in the order the public page uses: Pinned posts first, then the newest date first, and undated posts last. Short notices for the dashboard card are a different feed, under **Live updates**.

**Write an update** opens an empty editor. Give it a title and the text. **Save draft** writes a draft: The public page does not show it. **Save and publish** saves and then publishes it, and the public page shows it at once. **Publish all** on the list publishes every update with a saved draft that is not live. Press Enter in a one-line field to save a draft.

**The date is the date readers see, on the event's clock.** It is set in the event's time zone (Settings → Event settings), the same clock the public page uses for the date under the title. Leave it empty for an undated post; an undated post goes after every dated one. The date does not delay publishing. A post dated next month goes live when you publish it, and it shows next month's date.

**Pin** a post to hold it at the top of the list, above newer posts. Clear **Show this update when it is published** to publish a post that the public page does not show.

**A category is one or two words**, such as Travel or Program, shown as a tag beside the post's title on the Updates page. It takes up to 24 characters on one line, so the tag fits on a phone. Leave it empty for no tag. The field suggests the categories other posts already use, so one topic keeps one spelling.

**Feature a post to put it at the head of the page.** The Updates page sets the featured post first, under its own heading, **Featured**, with a larger title and its opening lines. If more than one post is featured, the one that comes first in the list leads: A pinned post before an unpinned one, then the newest date. The other featured posts stay in their usual places. To change the lead, clear **Feature this update at the head of the list** on the post that leads now.

**A picture and content blocks.** A post can also carry a picture and content blocks. This editor does not change them. When a post has them, the editor says so, and a save keeps them as they are.

**Delete this update** removes the live post and its draft together. Its version history stays. If *Updates* is off under Features, the list and the editor say so, because the public site does not show the page. Only an operator can turn it on.

## Media

A browsable library, split by namespace because each answers a different question:

- **`cms-images/`** — images used inside pages and posts. Client-writable through this tab.
- **`branding/`** — the logo slots, backed by the same reusable image picker the Branding tab uses.
- **`speaker-photos/`** — set from the speaker editor, not uploaded loose here.

Upload, edit alt text, and delete from the library. A delete warns you first if anything currently on the site references the asset — do not dismiss that warning without checking what it names.

**Branding needs an operator.** An upload into `branding/`, and a delete or an alt-text edit of a branding asset or of any asset a Branding slot or the social sharing image uses, is refused for a staff account, with or without the delete warning dismissed. A staff account sees the Branding drawer read-only, with a note that an operator manages branding files. Everything else in the library is staff work.

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

**Export the list.** The button in the title band reads **Export 42 attendees**, where the number is the rows on screen after your search and status filter. It saves a CSV file with one row per account, in the order the page lists them. The file has nine columns, and nothing else leaves the site:

| Column | What it holds |
|---|---|
| Name | The display name |
| Email | The sign-in address |
| Organization | The organization on the profile |
| Role | The role on the profile (the job title, not an access level) |
| Registration status | The stored value: `pending`, `ticketed`, `approved`, or `revoked` |
| Badges | The configured badge labels, then the custom badges while that feature is on |
| Past attendance | The editions an organizer recorded on the account |
| Social handles | `label: handle` pairs, sorted by label |
| Profile visibility | The stored value: `public`, `attendees_only`, or `private` |

A cell with more than one entry joins them with a semicolon. The file carries no account id, pronouns, bio, photo, or dates. The status and visibility columns keep the stored words, so a spreadsheet filter on them stays stable.

**Formulas stay text.** A spreadsheet runs a cell that starts with `=`, `+`, `-`, or `@` as a formula. In the file, such a cell starts with an apostrophe, and so does a cell that starts with a tab or a carriage return, or with spaces and then one of those four characters. The spreadsheet shows the value as text.

**Every export is recorded.** The server writes an admin log entry with your address, the number of rows, the status filter, and whether a search narrowed the list. It never records the search text, because that text can name a person. If the entry cannot be written, the server refuses the export and makes no file. The server keeps no copy of the file. One export holds at most 10,000 attendees and 10 MB; a larger one is refused before anything is recorded, and the message asks you to narrow the filter.

**Past attendance.** Select **Edit record** on a row to open that account's record. **Past attendance** takes one edition per line, such as a year: at most 20 editions of up to 40 characters each, with no repeats. Select **Save record** to store it. Attendees cannot change this list, and it never appears in the directory. It is a column in the export, and the row shows it under the address. Each save writes an admin log entry.

**Delete an account.** In the record, select **Delete account**, read what the delete removes, and select **Delete this account**. The delete removes the account, its directory profile, and its shared schedule, and releases its ticket claims, in one step, so the person leaves the directory at once. It then removes the sign-in, the saved sessions (and lowers each session's saved count), the private notes, the profile photo, and the change requests the person sent. The ticket record stays, unclaimed. Sent email records, feedback, session reactions, and the admin log stay too. The delete writes an admin log entry with your address, and it cannot be undone. A person whose account was deleted can sign in again later; they get a new pending account with no history.

The server refuses a delete in four cases, and says why:

- Your own account.
- An account with operator or staff access. An operator removes that access on the Access page first.
- An account linked to a speaker. Delete the speaker record first, in Speakers.
- An account that holds more than 496 claimed tickets. The refusal names the count, because one delete can release at most 496.

**If a delete stops part way.** When the account has left the directory but some of its data did not clear, the page keeps a notice with **Try the delete again**. The page does the same when the answer does not arrive, for example after a timeout or a dropped connection, because the delete may have started. Select it until the page says the account is deleted. Each retry clears only what is left, and records itself in the admin log. For up to an hour after the delete, the person's open session can still claim a ticket; a retry also releases a ticket claim made after the delete. A refusal made before anything was deleted, such as a speaker-linked account, shows in the record itself.

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

## Email log

Every message the site sent, newest first: Sign-in codes, speaker invitations, acceptances and confirmations, feedback receipts, operator alerts, and ticket prompts. Staff and operators can open it. Nobody can edit or delete a row here.

- **Search** looks for your text in the recipient address and in the subject. Case does not matter. One search reads the 500 most recent messages. If nothing in those 500 matches, the page says so and offers **Search older messages**, which reads the next 500.
- **Source** picks one kind of message. **Status** picks **Sent** or **Failed**, which is what the mail provider answered when the site sent the message. A later delivery report shows as a word in the Status column: Delivered, Bounced, Complained, or Suppressed. **Bounced** means the recipient's mail server refused the message. **Complained** means the recipient marked it as spam. **Suppressed** means the mail provider did not send it, because the address is on the provider's block list.
- **The filters stay in the page address**, so a reload or a shared link keeps them. The search text does not: An address you search for never enters the page address, the browser history, or an error report.
- **Preview** opens the stored message under its row, with the plain text version under it. The preview runs no script and loads no remote image. A link shows as its words only. So opening a message, or clicking in it, sends nothing to any other site. If the HTML of a message cannot be shown safely, the preview shows the plain text version instead. A stored body stops at 100 KB, and the preview says so when a body was cut.
- **Sign-in codes and speaker invitations never store their body or their subject**, because each one holds a code or a link that signs a person in. Their rows show "Not stored", and their preview says why.
- **Every preview you open is recorded** in the admin log with your account and the message's record. The record never holds the address or the subject.

Sent messages are closed to every browser, admins included. The page reads them through two admin-gated endpoints.

## Change requests

Requests for a change to the site, from signed-in visitors and from staff. Both kinds arrive in one list, newest first. Staff and operators can open it.

- **The feature is off by default.** An operator turns on `changeRequests` in Settings → Features. While it is off, the footer has no **Request a change** button, this page has no form, and the server refuses every request. The list, the status changes, and **Remove** still work, so you can clear the list after the feature is off.
- **Only a signed-in visitor can send one.** The footer shows **Request a change** only to a visitor who is signed in, and the server refuses a request from an address that is not verified. The request is stored with the sender's sign-in address. One account can send 5 requests in 15 minutes. The server refuses more, and the refusal says how many minutes to wait.
- **Send one yourself** from the **Request a change** panel at the top of the page. It goes through the same server checks and the same limit.
- **Show** picks the requests the list shows: **Open** (new and in progress, the default), **All**, **New**, **In progress**, **Done**, or **Declined**. The choice stays in the page address.
- **Each row** shows the status as a word, the time the request arrived, the sender's address, the page it is about, and the text. The row's button is the next step: **Mark in progress**, **Mark done**, or **Reopen**. **Decline** closes a new or in-progress request.
- **Remove** deletes the request and its text. It cannot be undone.
- **The admin log records every request, status change, and removal**, with the account that did it and the request's record. The log never holds the text of a request.

Only admins can read a request. The sender cannot read it back, and no email is sent. When an account is deleted in Attendees, the change requests it sent are deleted too, and the server refuses a new request from that account's open session.

## Materials

Session materials review — upload or link files against a session, with an optional embargo that holds the material until the session ends. Prefer a real label ("Slides") over a bare URL as the link text a viewer sees. This collection is fully server-only, even for an admin's direct read, so every action here goes through Cloud Functions. Staff and operators both use this page.

**The table.** One table lists the materials for every session, hidden sessions included. It shows at most 2,000 materials. Past that, a notice above the table says that some materials are not shown. Each row gives the file name, the word **File** or **Link** with its storage path or address, the session, the review state as a word, and when the material last changed. Select **Material**, **Session**, or **Changed** at the top of a column to sort by it; the button states the order in words, such as **A to Z** or **Newest first**. The table opens in schedule order. Under **Show**, the **Session** and **Review** filters narrow the rows. **Add a link** appears when one session is chosen. **Refresh** reads the list again and says **Refreshing…** until the list arrives. If the list does not load, the table stays as it was and the page says so.

**Download one file.** Select **Download** on a file row. A link row has **Open link** instead, which opens the address in a new tab. A stored address that is not a web address gets no link, and the row says so.

**Download an archive.** Tick the files you want, or tick the box at the top of the column to select every file row shown, then select **Download as archive**. The browser saves `session-materials.zip`, with one folder per session (named by the session id) and each file under its own name. Two files with the same name in one folder are saved as, for example, `slides.pdf` and `slides (2).pdf`. Two sessions whose ids give the same folder name get a folder each, the second as, for example, `talk-one (2)`. Links have no checkbox and never go in an archive. One archive holds at most 50 files and 9 MB, because the server sends it as one stream and the hosting platform stops a stream at 10 MB; for more, download in parts. The line above the table counts what is selected. A change to either filter clears the selection. The server builds the archive and sends it straight to your browser: There is no shareable download link, and nothing is stored. If the transfer stops part way, the browser saves nothing and the page says so.

**Every archive is recorded.** The server writes one admin log entry per file in the archive, with your address, before it sends the first byte. If those entries cannot be written, the server refuses the archive. A single-file download writes no entry.

**Coverage.** The **Coverage** panel names the sessions with no materials and the speakers with no materials on any of their sessions. A pending or approved material counts; a rejected one does not. A session counts only when its published record names at least one speaker who is not removed, so a session with no speaker is left out. A speaker added in an unpublished draft does not count until the session is published. The panel reads the same list as the table, before any filter, and states when it read it. When the list passes 2,000 materials, the panel says so and shows no figures.

## System errors

Unresolved system-error rows — the operational surface for things like an invalid email-template override falling back to its code default. Each row has a resolve action. If you are chasing down why a template edit "is not working", check here before assuming it is a bug: A rejected override logs here and silently keeps serving the last-good copy rather than breaking the send.

## Settings → Event settings

The event's own identity fields: Name, dates, timezone, venue, sender address, social accounts, milestones, and the rest. The venue's places, movements, and map are set here too, in the panels described below. This is a merge-then-validate write — the form only sends the keys it is actually changing, and fields it does not touch (the legal postal address, the SEO metadata) are left alone.

**Tracks** live here too: The lines your event runs when sessions happen at the same time in different rooms. Each track has a letter (A to Z) and a name, and the schedule shows both — a reader tells two lines apart by the letter and the name, never by colour alone. Sessions point at a track by its letter, so renaming a track is one edit here rather than a change to every session. Leave the list empty if everything happens in one room.

**What the track list changes on the public site.** Once you list tracks, the schedule draws as a grid on a wide screen: Time down the left, one column per track, in the order you listed them. On a phone — and for anyone reading with a screen reader — the same day is a time-ordered list. It contains the same sessions in the same order as the wide-screen grid. A session with no track runs across the whole width, which is what a plenary is. A session that names a parent is listed under it as a stop on the way through it rather than as a separate entry, in both views.

**The register control.** Two fields under Registration draw the one control that sends a reader to wherever you actually take registrations: the **external registration URL** and the **register button label**. Set the URL and the control appears twice — as the filled action at the top of the home page, and as a quiet control in the site header on every page. It opens in a new tab, because the form belongs to your ticket provider rather than to this site. The label is what the control says; leave it empty and it says "Register".

**Leave the URL empty and no control is drawn anywhere.** That is the right answer for an event that takes no registrations yet, or one whose provider has not given you a link. The site would rather say nothing than show a button that goes nowhere. The URL must start with `https://` — a save with anything else is refused and the field says why, because a registration form is where a reader types their name and their email.

**It is the same URL your registration email uses.** Your ticket provider reads this same field when it builds the email a new account gets, so the link on the page and the link in that email can never drift apart. Change it here and both change.

**Past days become back issues.** When a day ends, its page keeps every word and quietens: The colour drops out, the day head says "Back issue", and the controls that act on a live event — bookmarking, reactions, adding to a calendar — go away. Nothing is hidden, and every link still works. Setting an **archive date** for the whole event does the same thing to every day at once.

**The home page counts down on its own.** Before the first day starts, the home page shows a live countdown to that moment, reading the dates and timezone set here. Once the first day begins, the countdown stops and the page states that the event is running, checking about once a minute so it moves on to stating the event has ended on its own once the last day is over — a reader does not have to reload the page for that. Setting the **archive date** states the same "event has ended" line; nothing looks different to a reader. Nothing to configure: the page always reads the same dates, timezone, and archive date this section sets.

**Printing.** Print any schedule page and you get the handout: Every day of the event, every session and every stop under it, tracks named by letter and name, no buttons. You do not have to prepare anything for it, and you get the light edition even if you print from a dark screen.

### Places

A place is one named room or hall at the venue. Sessions, movements, and the venue map all point at places, so each room's name is stored once. Rename a room in its place, and the transfer lines, the room list beside the venue map, and the admin sessions list all follow.

Select **Add place** in the **Places** panel. Each place has three fields:

- **Name**: The name readers see, such as Main hall. Required.
- **Id**: The stable key that sessions, movements, and map markers store. Use lowercase letters, digits, and single hyphens, such as `main-hall`. For a new place, the id fills in from the name as you type. Type in the id field and the id stops following the name. Until you save, a movement or map marker that already picked the new place follows its id when the id changes.
- **Floor**: Optional, such as Level 2. The room list beside the venue map and the transfer line both show it.

**Keep a saved id the same.** Change a place's name as often as you need to; the id stays. A saved place's id does not follow its name. If you change a saved id anyway, every movement and marker that named the old id is refused until you point it at the new one. The server also refuses the save while a live or draft session still uses the old id.

**Removing a place.** Select the **Remove** control on the place's row. The place's movements and its map marker go with it, and a line above the **Places** panel says what will go. Nothing is removed until you save. You cannot remove a place that a live or draft session uses. Its remove control is off, and the row names the sessions that use it. Move those sessions to another place first. The server makes the same check when you save.

### How a session uses a place

In the session editor, **Recorded place** picks one of your places, or **No recorded place**. It is a separate field from **Public location text**. The location text is the wording attendees read, and it does not change the recorded place. The site never matches the location text against place names. The sessions list in the admin shows the recorded place's name, or the location text when a session has no recorded place.

A session can only name a place that exists. The server refuses any other id, and refuses every id while the venue has no places at all. Add the place in Event settings first, then pick it on the session.

### Movements

A movement is one recorded walk from one place to another. The site shows a walk only where a movement records that exact pair of places. It never guesses a walking time.

Select **Add movement** in the **Movements** panel and fill in:

- **From** and **To**: Two different places from your list.
- **Walking minutes**: A whole number from 0 to 120. Use 0 for rooms across the corridor; the site then says "under a minute’s walk".
- **Accessible route**: Optional. The step-free way between the same two places, in your own words. Leave it empty if nobody has checked one. The site then says nothing about a step-free route, rather than saying there is none.

**A movement is one way.** A walk from the main hall to the studio says nothing about the walk back, so record the reverse as its own movement, even when it takes the same time. The site does not join movements either: A walk from A to B and a walk from B to C do not make a walk from A to C.

**Where a walk shows.** A transfer line appears in two places only:

- On **My schedule**, between two sessions a reader bookmarked, one after the other on the same day, when a movement records the walk from the first session's place to the second session's place.
- In a session's calling points, when a child session sits in a different place from its parent and a movement records that walk.

The line names both places, the destination's floor, and the walk. When you recorded an accessible route, a second line gives it after "Step-free route:". The full schedule shows no transfer lines, because a reader scanning the programme is not walking it in order.

**Removing a movement.** Select **Remove movement** on its row. It goes when you save.

### Venue map

Upload a map of the building and the travel page prints it, with the venue's rooms listed beside it. Under **Venue map** you choose or upload the image the same way you pick any other picture, and then write the **alt text**: One sentence saying what the map shows. The alt text is required — a map with none does not publish, because an image nobody described tells a reader using a screen reader nothing at all. The picture has to come from the media library, so a link to a map on somebody else's site is refused; upload the file instead.

**The map lists your places.** The room list beside the map is your **Places** list, in the same order, with each room's floor. Every place is listed, marked or not, so a reader who cannot see the picture still gets every room name. Add your places before you mark them: A marker can only name a place that already exists. The **Map URL** field in the **Venue** panel is a different thing. It links to an outside street map, and it does not use places.

**Where the map appears.** The travel page carries a section called **Venue map** (its id is `travel_map`), and the map draws wherever that section sits, so you move the map by moving the section in Pages. If your travel page does not have that section — every site set up before this feature shipped is in that position — the map draws at the end of the page instead, so uploading one always publishes something.

**Marking rooms on the map.** A marker puts a numbered dot on the image where one of your places is. Add one with **Add marker**, pick the room, and type how far **across** and **down** it sits as percentages of the picture: 0 across is the left edge, 100 the right; 0 down is the top, 100 the bottom. The number on the dot is the number in the list, so a reader can match the two. Numbers run down the list in the order your places are listed, not the order you added the markers. One marker per room. **Remove marker** takes one off, and removing a place takes its marker with it — the panel says so before you save.

**Taking the map down.** Clear the map image. The alt text and the markers are cleared with it, and the travel page shows no map after you save.

### Rules for places, movements, and the map

The places and movements fields are checked as you type, and a field that breaks a rule is marked at once. The map fields are checked when you select **Save event settings**. Either way, **Save event settings** stays available. A save with a marked field sends nothing and moves focus to the first field that needs a fix. The server checks the same rules again and names the field it refused.

| Field | Rule |
|---|---|
| Place name | Required. |
| Place id | Lowercase letters, digits, and single hyphens. No two places share an id. |
| Removing a place | Refused while a live or draft session uses it. |
| Movement **From** and **To** | Two different places from your list. One movement per direction for each pair. |
| Walking minutes | A whole number from 0 to 120. |
| Map image | Chosen from the media library, so its path starts with `cms-images/` or `branding/`. |
| Map alt text | Required once an image is chosen. |
| Marker room | One of your places. One marker per place. |
| Marker across and down | A number from 0 to 100. |

### Social accounts

The **Social accounts** panel holds the event's own accounts. The site footer and the footer of every built-in email list them, in the order the panel shows. In an email, the formatted copy links each service name, and the plain-text copy gives one line per account: The service, then the address. An email template override that replaces a body keeps the footer that body has. Leave the list empty and neither footer shows social links.

Select **Add account**. Focus moves to the new row's **Service** field. Each account has three fields:

- **Service**: The name readers see, such as Mastodon. Required, at most 40 characters.
- **Handle**: Optional, such as @eventname, at most 40 characters. The site footer prints it beside the service, so two accounts on one service can be told apart. The email footer leaves it out.
- **Link**: The full address of the account. It must start with `https://` or `http://`.

**Removing an account.** Select **Remove account** on its row. Focus moves to the remove control of the account that takes its place, or of the one before it when you removed the last, or to **Add account** when none is left. The account goes when you save.

**What the save checks.** The accounts are checked when you select **Save event settings**. A save is refused, and focus moves to the first field that needs a fix, when a service name is empty, a link is not a full `https://` or `http://` address, or the same service and link are listed twice. A link with no scheme, such as `example.org/@eventname`, is refused, and so is a `javascript:` link. The server checks the same rules and names the field it refused.

**Social hashtag.** One word with no spaces, such as #EventName. The event settings store it, but the site and its email do not show it.

### Milestones and the registration goal

The **Milestones** panel lists the dates the Overview counts down to, such as the day proposals close or the day the programme is announced. The Overview shows them in date order, each with its date and the days left: **In 12 days**, **Today**, or **3 days ago** once it has passed.

**Anyone can read the milestones and the goal.** They are stored with the event settings, which the public site reads, so every name, date, and goal is public. Keep private notes out of them.

Select **Add milestone**. Focus moves to the new row's name field. Each milestone has a name, at most 80 characters, and a date. An event can list 20 milestones; at 20, **Add milestone** does nothing and says so until you remove one. **Remove milestone** moves focus to the milestone that takes its place, or to the one before it when you removed the last, or to **Add milestone** when none is left. A milestone goes when you save. A milestone with no name or no date is refused when you save, and focus moves to the field that needs it.

**Registration goal** is in the **Registration** panel: The number of approved attendees you are aiming for. Anyone can read it. The Overview sets the approved count against it, as a sentence and a bar. Leave it empty for no goal. It must be a whole number from 1 to 1,000,000; the server refuses anything else and names the field.

With no milestones and no goal, the Overview shows no milestone panel at all.

## Settings → Features

Feature flags, wired to a **whole-document replace** — every known flag is always sent, and an omitted flag means disabled. When a new flag is added to the platform it appears here automatically, because the form's key list comes from the same shared schema the server validates against.

`changeRequests` turns on the change request form in the footer and on the Change requests page. It is off by default. See [Change requests](#change-requests).

## Settings → Badges

The badge catalog: Categories, each with a max-picks cap and its list of badges, which attendees self-select from on their profile. Also a whole-document replace: editing one badge sends the complete set of categories back and preserves the configured custom-badge block list.

**Custom badges.** The separate feature is off by default. When enabled, attendees can enter up to three badges of 24 characters each. Reserved role words are always blocked; `config/badges.customBadgeBlockList` adds event-specific words. The owner form and public projection use the same validator. The category editor preserves this list; an operator changes it through the badge configuration API.

**Remove a custom badge.** In Attendees, select the removal action beside the badge and confirm. The result stays on the page and an `admin_logs` entry records the action. Turning the feature off removes custom badges from the public projection; attendees can still edit their other profile fields.

## Settings → Access

Operators only. One ruled table of every admin account with its tier word, and a form to grant access to a new address.

**Grant access.** Enter the address and pick a tier. The page asks you to confirm, states what the person gains, and only then writes the grant. The address is stored lowercase, so the case you type does not matter. The person signs in with that address the way every admin does, by Google or by the emailed code; there is no invitation to send.

**Change a tier or remove access.** Each row carries two quiet actions: **Change to staff** or **Change to operator**, and **Remove access**. Each one opens a confirmation under the grant form, above the table, that names the account and the consequence. Removal sits on the alarm ground; a tier change does not, because it narrows or widens access without deleting anything. Cancel returns you to the control you pressed.

**At least one operator stays.** The server refuses a change that would leave the deployment with no operator: Demoting or removing the last operator, your own grant included. Grant a second operator first. The refusal is stated in place, in the server's words.

**What is recorded.** Every grant, change, and removal writes a row to the admin log with your address, the account, and the tier it moved from and to. A change that changes nothing writes no row.

**When it takes effect.** At once. The database rules, the server, and the admin rail all read the access lists live: A granted account is admitted on its next request, a removed account is refused on its next request, and the rail shows the right sections the next time the person signs in or reloads.

## Legal pages

Privacy policy and terms of service ship as CMS content pages seeded from provider-aware templates, each clause needing review flagged `[Client legal review required]`. They stay flagged — a persistent banner in the admin panel and a visible notice on the public page — until an admin clears the review flag after the client's counsel has actually reviewed the seeded copy. See [`CLIENT_ONBOARDING.md`](CLIENT_ONBOARDING.md)'s legal review section for the full context. Do not publish another organization's terms verbatim; the seeded text is a starting point, not a finished policy.
