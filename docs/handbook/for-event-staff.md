# For event staff

You edit the site. You do not deploy it. CCM (or another operator) handles Firebase, email sending, and tickets behind the scenes.

## What you can change without a developer

- Pages (about, travel, conduct, and anything else seeded for the event)
- Schedule, sessions, and bookmarks settings
- Speakers: invite, accept, profile, approval
- Attendees and the public directory
- Sponsors and organizations
- Live updates (from the admin form, not from Slack)
- Theme: colors and the bundled font sets
- Badges from the predefined list and moderation of optional custom badges

Legal pages ship as templates. They stay flagged until your counsel signs off. Do not publish another organization's terms.

## Publish

Draft and live are separate. Publishing copies the draft to what attendees see. It is not a code deploy. If a change is not on the public site, check that you published, not only saved.

## Speakers

Invite by email. They accept with a login code, the same way attendees sign in. Do not send them a magic link. One speaker record is the source of truth — if a name is wrong in three places, fix the speaker record.

## Custom badges

Custom badges are off by default. If enabled in Features, attendees can write up to three badges of 24 characters each. Reserved role words and the event block list are refused. In Attendees, select the removal action beside a custom badge and confirm it. The removal is recorded in the admin log. Turning the feature off hides these badges and keeps other profile fields editable.

## Materials

Upload or link files on the session. Embargo holds them until the session ends. Prefer a real label ("Slides") over a raw URL as the link text.

## Tickets

Your operator chose Eventbrite, a spreadsheet import, or no ticketing. Signup email should match that choice. If a new person is told to "buy on Eventbrite" and you are not using Eventbrite, that is a product bug — [file it](https://github.com/CenterCoopMedia/eventrunner/issues/new?template=bug.yml).

## When to email CCM instead of posting

- Someone needs admin
- Login codes are not arriving (sender domain / spam)
- The site is down
- You need a new day added after launch and the admin will not let you

info@collaborativejournalism.org
