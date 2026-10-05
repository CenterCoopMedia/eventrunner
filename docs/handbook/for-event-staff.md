# For event staff

You edit the site. You do not deploy it. CCM (or another operator) handles Firebase, email sending, and tickets behind the scenes.

## What you can change without a developer

- Pages (about, travel, conduct, and anything else seeded for the event)
- Schedule, sessions, and bookmarks settings
- Session pitches: Private review, CSV import and export, and accepted proposal drafts
- Speakers: invite, accept, profile, approval
- Attendees and the public directory
- Sponsors and organizations
- Live updates (from the admin form, not from Slack)
- Site-wide announcements with active windows and optional links
- Theme: colors and the bundled font sets
- Badges from the predefined list and moderation of optional custom badges

Legal pages ship as templates. They stay flagged until your counsel signs off. Do not publish another organization's terms.

## Publish

Draft and live are separate. Publishing copies the draft to what attendees see. It is not a code deploy. If a change is not on the public site, check that you published, not only saved.

## Session pitches

Share `/pitch` for proposals. The form requires a verified email, title, description, and review consent. Open **Session pitches** to search and filter the private queue. Save a review decision and private notes explicitly. A conflict keeps your notes visible; copy them before loading the current review. Decisions do not send notifications.

Import outside proposals only after reviewing the CSV preview and verifying the source form's consent. Export downloads the filtered queue with contact details and excludes private notes. Keep the file private.

An accepted proposal can create private session and speaker drafts through a separate confirmed action. Review the names, consent, event day, and times first. Complete the session and speaker editors before publication. See [Operate session pitch intake](../operator/session-pitches.md) for the full workflow. Operators control intake and its deadline.

## Speakers

Invite by email. They accept with a login code, the same way attendees sign in. Do not send them a magic link. One speaker record is the source of truth — if a name is wrong in three places, fix the speaker record.

The signed-in speaker dashboard lists a missing biography or headshot and any assigned public session that has no submitted materials awaiting review or approved. Each item opens the profile editor or that session's Materials tab. A session with only rejected materials stays on the list until a replacement is sent. Profile edits from an approved speaker wait for organizer review; the checklist counts those submitted edits as work the speaker has done.

## Custom badges

Custom badges are off by default. If enabled in Features, attendees can write up to three badges of 24 characters each. Reserved role words and the event block list are refused. In Attendees, select the removal action beside a custom badge and confirm it. The removal is recorded in the admin log. Turning the feature off hides these badges and keeps other profile fields editable.

## Attendees

Approve and revoke registrations in Attendees. Select **Export** to save the rows on screen as a spreadsheet file. The file holds names, email addresses, organizations, roles, registration status, badges, past attendance, social handles, and profile visibility. Treat it as personal data. Every export is recorded in the admin log with your address.

**Edit record** on a row holds what only organizers keep: the past attendance list, one edition per line. Attendees cannot change it. The same panel deletes an account. A delete takes the person out of the directory at once and removes their sign-in, saved sessions, notes, profile photo, change requests, and ticket claim. It cannot be undone. You cannot delete your own account, an admin account, or an account linked to a speaker. If a delete stops part way, select **Try the delete again**.

## Change requests

Change requests are off by default. An operator turns them on in Features. Then a signed-in visitor can select **Request a change** in the footer, and you can send one from the Change requests page. Every request lands in one list on that page. Move a request on with its button (**Mark in progress**, **Mark done**, **Reopen**) or select **Decline**. **Remove** deletes a request and its text for good. The admin log records every request, status change, and removal, but never the text.

## Materials

Upload or link files on the session. Embargo holds them until the session ends. Prefer a real label ("Slides") over a raw URL as the link text.

The Materials page lists every session's files and links in one table. One file can be at most 9 MiB. Tick files and select **Download as archive** to save them as one zip file, at most 50 files and 9 MiB at a time. Every archive is recorded in the admin log with your address. The **Coverage** panel names the sessions and speakers that have no materials yet, so you know whom to ask.

## Tickets

Your operator chose Eventbrite, a spreadsheet import, or no ticketing. Signup email should match that choice. If a new person is told to "buy on Eventbrite" and you are not using Eventbrite, that is a product bug — [file it](https://github.com/CenterCoopMedia/eventrunner/issues/new?template=bug.yml).

## When to email CCM instead of posting

- Someone needs operator access (an operator can grant staff access from Settings → Access without asking)
- Login codes are not arriving (sender domain / spam)
- The site is down
- You need a new day added after launch and the admin will not let you

info@collaborativejournalism.org
