# For clients

You are an organization that wants an event site. CCM deploys one Firebase project per event and operates it. Your staff run the admin. You do not fork the repo.

## What you are buying

The code is [Apache-2.0](https://github.com/CenterCoopMedia/eventrunner/blob/main/LICENSE). Anyone can read it. CCM's service is:

1. A managed deployment for your event
2. Setup and onboarding (sender domain, tickets, first admin)
3. Support while the event is live

The **Event Runner** name is CCM's. Apache-2.0 does not give anyone else the right to sell hosting under that name.

## What v1 includes

Schedule, speakers, attendees, a block CMS, emailed login codes, session materials, a media library, Eventbrite or spreadsheet tickets, and your colors and fonts.

What v1 does not include is in the [triage record](https://github.com/CenterCoopMedia/eventrunner/blob/main/docs/plans/2026-08-16-event-platform-v1-triage.md): video generation, bulk announcement mail, invoicing, social feeds, speaker chat.

## What you will need to give us

- Event name, dates, timezone, venue
- The public URL you want
- Who the first admins are
- Whether tickets are Eventbrite, a spreadsheet, or neither
- A sender address on **your** domain (for login codes). We will ask you to add SPF, DKIM, and a DMARC policy. Without that, emailed codes get quarantined.

## How to start

Open a [General](https://github.com/CenterCoopMedia/eventrunner/discussions/new?category=general) thread or email info@collaborativejournalism.org. Do not send an attendee list to GitHub.
