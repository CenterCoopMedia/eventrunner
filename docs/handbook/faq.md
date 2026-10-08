# FAQ

## Is this the Collaborative Journalism Summit site?

No. The 2026 summit site is the reference implementation. This project is the white-label extract. Summit-only tools (video generator, invoices) stay there.

## Why a 6-digit code instead of a magic link?

University and nonprofit inboxes treat a "click this login URL" email as phishing. A short code in the message body gets through more often.

## Can we use Slack or Telegram to post live updates?

Not in the product. Staff post live updates from the admin. Operator alerts go to a generic webhook the operator configures.

## Can attendees make their own badges?

They pick from the list you set. An optional custom-badge feature also lets them enter up to three badges of 24 characters each. It is off by default. Validation blocks reserved role words and any additional words configured for the event; staff can remove a badge.

## Will you add social feeds or speaker chat?

Only if a client pays for them after v1. They were cut because they need moderation.

## Where is the demo?

The [static visitor preview](https://centercoopmedia.github.io/eventrunner/demo/) shows an NC Local past-event mock-up: A selected historical program from the March 27, 2026 NC News & Information Summit, with eight named sessions and 25 public speakers. It is read-only and has no admin panel. Sign-in, registration, ticket claims, email actions, the attendee directory, and calendar exports are disabled. This is not the full agenda, an official NC Local site, an endorsement, or a future event.

The separate [hosted admin/client demo](https://eventrunner-demo.web.app/) has an [admin panel](https://eventrunner-demo.web.app/admin). Admin screens require an authorized account. Its content and release can differ from the static preview. Checked October 8, 2026: It still shows the fictional Harborlight event; the NC Local refresh is tracked in [issue 346](https://github.com/CenterCoopMedia/eventrunner/issues/346). Read the [admin guide](../ADMIN_GUIDE.md) for the staff editing screens.

## Who do I talk to about money or a contract?

Email info@collaborativejournalism.org. Do not negotiate that in a public issue.
