# ADR 0007: Client console for self-serve onboarding and provisioning

**Date:** 2026-11-03 (revised the same day)  
**Status:** Accepted by the owner on 2026-11-03.  
**Amended:** 2026-11-04, for the agreement, the event fee and the automatic build. See [the amendment](#amendment-2026-11-04-agreement-fee-and-automatic-build).  
**Amends:** [ADR 0001 §2](0001-event-platform-v1.md) operating model, and [ADR 0004](0004-stripe-ticket-commerce.md) (Stripe Connect, see its 2026-11-03 amendment). The model stays one Firebase project per event. This record adds a way to sign up, connect accounts, and get that project made with no manual step by the client.

## Context

Today a client starts by email. The operator collects the answers by hand, writes
`client-answers.json`, works through `docs/DEPLOY_RUNBOOK.md` §0 to §5, pastes the client's
provider keys into Secret Manager, and asks the client to add DNS records. The steps are correct,
but the client sees none of it and must send keys and DNS changes by hand.

NC Local is the first outside client (#337, #516). The owner's requirement (2026-11-03): the
process must feel like the sign-up of a commercial event platform. The client signs up, answers
plain questions, and connects Stripe or Eventbrite with a button. The client never copies a key,
downloads or sends a file, edits DNS, or reads about Firebase, projects or infrastructure. Then
the site is made for them.

## Principles

1. **Clicks, not keys.** Every account connection is an OAuth or hosted-onboarding button.
   No field in the console takes a key, a token, an ID that a provider issues, or a DNS record.
2. **Works by default, upgrades are optional.** The site runs on `<name>.eventrunner.org` and
   sends mail from that subdomain at once. A custom web address or a custom sender domain is an
   optional upgrade with a guided, automatically checked step.
3. **Plain words.** The console never says Firebase, project, tenant, environment, webhook,
   secret, SPF or DKIM. It says "your site", "your web address", "ticket sales", "email".
4. **Approval before cost.** No cloud resource is created before a CCM operator approves the
   application. This is the control against cost and abuse from self-serve sign-up.
5. **One validator.** The console and `init-event.cjs` run the same answer rules
   (`shared/answers`).

## Decision

### 1. A separate console project

The console is a small app in its own Firebase project, owned by CCM, at
`console.eventrunner.org`. It is not deployed to any client project, and no client project reads
from it. Code lives in `console/` with its own `firebase.json`, rules, web app and functions, so
the client deploy (`deploy-client.yml`) never ships it. It has its own favicon, social preview
image and sharing metadata.

### 2. Account creation and team

- Sign up with Google, Microsoft, or an emailed sign-in link. The email address is verified
  before the client can submit.
- The client names their organization once. One organization can run more than one event; each
  event is its own application and its own site.
- **Team invites.** The client invites teammates by email from the console and gives each one a
  role: **Owner** (operator in the event admin) or **Editor** (staff). An invite is an email with
  a link; the teammate signs up and joins. The console requires two Owners before launch, because
  launch readiness requires two operators. The team list becomes `config/bootstrap` at seed time.
- CCM operators are named in `console_config/operators` (lowercase emails). They see every
  application. A client sees only its own organization.

### 3. The guided setup

A stepper, like the admin setup page: one step per page at its own address, a step list with
progress, and Back and Next. Each step saves as the client types. The client can
leave and come back, and a teammate can continue it.

| Step | What the client does | What the console does |
| --- | --- | --- |
| Your organization | Name, website, mailing address (for the email footer) | Checks the address format |
| Your event | Name, short name, one-line description, dates, time zone (preset from the browser), venue | Checks the answers with `shared/answers` |
| Your web address | Picks a name, for example `nclocal` | Shows `nclocal.eventrunner.org` and says at once if it is taken |
| Your team | Invites teammates, picks Owner or Editor | Sends the invites, shows who joined |
| Tickets | Chooses **Sell with Stripe**, **Use Eventbrite**, **Import a spreadsheet later**, or **No tickets** | See §4 |
| Email | Sender name and the reply-to address | Shows a preview: `Event name <hello@nclocal.eventrunner.org>`; replies go to the client |
| Review | Reads a summary and selects **Create my site** | Freezes the answers, notifies CCM |

After submit, the client sees a status page with plain steps and live state: "We are reviewing
your request", "We are building your site", "Your site is ready". Each change also sends the
client an email.

### 4. Connecting accounts

**Stripe (Connect, Standard accounts).** The client selects **Connect with Stripe**. Stripe's
own page lets them sign in to their Stripe account or create one, and approve Event Runner. The
console receives the connected account ID and an access token for that one account. Money goes
straight to the client's Stripe account. The client keeps the full Stripe Dashboard and owns
refunds, disputes and payouts, as ADR 0004 already says. CCM takes no platform fee. The ADR 0004
amendment says why a per-account token is used and how the webhook is made.

**Eventbrite (OAuth).** The client selects **Connect with Eventbrite**, signs in, and approves.
The console then lists the client's Eventbrite events, and the client picks one. No token or
event ID is typed. CCM registers one Eventbrite app.

**Spreadsheet or none.** Nothing to connect. Staff upload a spreadsheet in the admin later.

Tokens from these connections are written to the console's Secret Manager by the callback
function, and never to Firestore, a response, a log or the browser. The OAuth `state` value is
bound to the signed-in user and the application, and expires. The provisioner moves each token to
the client project's Secret Manager and deletes the console copy. The client can disconnect and
reconnect from the status page until the site is made, and from the admin panel after.

### 5. Review and approval

Statuses: `draft` → `submitted` → `changes_requested` (with a note to the client) or
`approved` → `building` → `ready` → `launched`. Also `withdrawn` (by the client) and
`declined` (by an operator, with a note).

The operator review screen shows the frozen answers and the connection state. **Approve** needs
no typed values: the GCP folder, billing account and region are console settings, and the
project id and GitHub Environment name are made from the web-address name. The operator can
change them before approval.

### 6. Building the site runs in GitHub Actions

Approval dispatches `provision-client.yml` with the application id. The workflow authenticates
with Workload Identity Federation as a provisioner service account, bound to this repository on
`refs/heads/main` only, like the deploy account. The provisioner needs folder-level project
creator and billing user rights; a credential with those rights must not sit behind an
internet-facing function. The console holds one narrow credential: a GitHub App installation
token with `actions: write` on this repository, to start the workflow.

The workflow runs `scripts/provision-client.cjs`, a list of idempotent steps. Each step reads the
current state first and does nothing when it is already right, so a failed run is repaired and
run again. Each step writes its result to the application's build record. The operator sees it in
full. The client sees it as the plain status lines in §3.

1. Create the project in the folder, link billing, enable the APIs, add Firebase, create
   Firestore, the bucket, the Hosting site and the web app.
2. Create the deploy service account, its roles, the WIF binding, and the service agent roles.
3. **Web address.** Add `<name>.eventrunner.org` to Hosting and write its DNS records in CCM's
   `eventrunner.org` zone through the DNS provider's API. Wait for the certificate.
4. **Sign-in.** Add the web address and the Hosting default domain to the authorized domains
   (Identity Toolkit API). Emailed sign-in codes work from here.
5. **Email.** Create a Postmark server for the event and the sender domain
   `<name>.eventrunner.org`, write its DKIM and return-path records to the zone, and wait for
   Postmark to verify them. Record the verification in `config/event.sender`.
6. **Tickets.** Move the connection token to the client project's Secret Manager. For Stripe,
   create the webhook endpoint on the connected account and store its signing secret. For
   Eventbrite, register the webhook (`register-ticketing-webhook.cjs`).
7. Create the GitHub Environment, its `main`-only branch rule, its variables and secrets.
8. Run the bootstrap dispatch, then `init-event.cjs` with the frozen answers and the team, then
   the normal dispatch.
9. Email the Owners a link to their admin panel. Set status `ready`.

### 7. Setup checklist in the event admin

The admin page **Set up your event** (`/admin/setup`) shows the launch-readiness rows as a
stepper: one step at a time at its own address (`/admin/setup/<step>`), the step list beside it,
and Back and Next. Each step says who does it (the client, the hosting team, or both), its state, and a link to
the screen for it. It reads `webMcpCheckEventReadiness`, which runs the `init-event.cjs --check`
policy and reads the config fresh, not from the five-minute container cache. It also holds the
operator's legal sign-off (`legal.reviewRequired: false`), which no admin screen wrote before.
The page says "hosting team", not CCM, because the code is white-label. It is on the rail under
Overview, and the first-visit tour waits until the reader leaves it. This page does not depend on the console; it also helps a client onboarded by hand.

On a site the console builds, §6 meets the rows for the sender domain, ticketing and the
authorized domains before the client signs in. The rows left for the client are logos,
placeholder text and the legal review. The second Owner is met at invite.

### 8. Optional upgrades

- **Custom web address.** The client types their domain in the admin panel. The page shows one
  record to add, in plain words, and a **Check now** button. A scheduled check also runs. When it
  passes, Hosting and the authorized domains are updated and `EVENT_PUBLIC_URL` changes through
  a deploy. The subdomain then redirects.
- **Custom sender domain.** The same pattern for email: the records, **Check now**, and a change
  of the sender address only after Postmark verifies the domain.

These are the only places a client sees a DNS record, and both are optional.

### 9. Steps that stay with the hosting team

| Step | Why | What the client sees |
| --- | --- | --- |
| Google sign-in | Needs an OAuth client and a consent screen for the project. Google has no stable API to create them. | "Google sign-in: turning on." Emailed codes already work. |
| Legal review | The client's counsel signs off on the client's own terms. | A step on the setup checklist. |
| Launch | The hosting team confirms `--check` and opens the site to the public. | "Your site is ready to launch" and an email. |

## Consequences

- A client goes from sign-up to a working site with clicks only. CCM types nothing by hand.
- CCM runs more shared infrastructure: the console project, a Stripe platform account, an
  Eventbrite app, a Postmark account that can create servers, an `eventrunner.org` zone with an
  API, a GitHub App, and a provisioner service account with folder-level roles. A new runbook
  section covers the one-time setup.
- Self-serve sign-up adds a public write surface: rate limits (three open applications per
  organization, five submits per account per day), verified email, App Check, and an operator
  delete for spam.
- Retention: a withdrawn or declined application and its tokens are deleted 90 days after the last
  change. An approved application is kept for the life of the engagement.
- CI stays credential-free. Every external call goes through an injected client with a fake in
  tests. Real provisioning is proved once in a test folder, with Stripe and Eventbrite test
  accounts, before NC Local uses it.

## Not in scope

- ~~Taking payment for the service or signing the agreement in the console.~~ Now in scope; see the 2026-11-04 amendment.
- Moving existing clients into the console.
- Changing an event project after `ready`, except through the admin panel and the deploy
  workflows.

## Owner answers (2026-11-03)

1. Console address: `console.eventrunner.org`.
2. NC Local goes through the console as its first real user.
3. Legal: CCM's legal review cleared this project (owner report). This covers the console and its
   intake of client contact data. It does not replace the per-event legal review step.
4. The client experience must feel like a commercial event platform: no keys, files or DNS.
5. Stripe: Connect with Standard accounts. Default sender: a subdomain of `eventrunner.org`.
   Default web address: a subdomain, with a custom domain as an option. Eventbrite: OAuth and an
   event picker.

## Prerequisites the owner must provide

1. A GCP folder and a billing account for client projects.
2. A Stripe platform account with Connect enabled (Standard accounts, OAuth).
3. An Eventbrite app (client id and secret).
4. The `eventrunner.org` DNS zone on a provider with an API (Google Cloud DNS preferred).
5. A Postmark account token with the right to create servers and domains.

## Amendment 2026-11-04: agreement, fee and automatic build

The owner's requirement: a client who does not know the hosting team opens one sign-up link, accepts
the agreement, pays the event fee and sets up the event alone, as on any commercial platform. The
client never has to ask anyone a question. This amendment replaces the parts of the record above
that conflict with that requirement.

**Agreement.** A step after Review shows the current agreement in full. An Owner types their name
and selects accept. The server stores an append-only record: agreement version, a SHA-256 hash of
the text, typed name, verified email, user id, organization, application and time. It emails the
signer a copy. The browser cannot write or change the record. The text lives in the console's
Firestore (`console_config/agreement`), and each version is kept unchanged. It is not in this public
repository. CCM's legal review must confirm this method and the text before a real client uses it.

**Event fee.** A step after the agreement sends the Owner to Stripe Checkout on CCM's Stripe account.
The server reads the amount and currency from `console_config/settings`. The browser never sends an
amount, and the repository holds no price. The console fails closed: with no agreement text or no
fee set, the request cannot move past Review, and the page says the site is not taking sign-ups.
A paid session counts only through a signature-verified Stripe webhook, which handles a repeated
event once. Returning from Checkout proves nothing. This payment is separate from the client's own
ticket sales, which go to the client's connected account and carry no CCM fee (§4 stands).

**Statuses.** `draft` → `awaiting_payment` → `approved` → `building` → `ready` → `launched`.
Accepting the agreement freezes the answers and sets `awaiting_payment`. The client can go back to
edit before paying, which clears the acceptance. The webhook sets `approved`. `submitted` and
`changes_requested` stay for a request an operator holds back. The status page shows each change,
and each one also sends an email.

**Automatic build.** This replaces principle 4 and §5's approval step. Payment starts the build, and
the operators get a notice. No cloud resource exists before payment, which is the control against
cost and abuse. The project id and environment name come from the web-address name, and the folder,
billing account and region from console settings. An operator can still see every request and decline one with a refund. The agreement states the
refund terms.

**Second Owner.** The second Owner moves from a condition of sending the request to a launch check.
A client working alone can finish sign-up, pay and set up the site. The launch check explains the
step and sends the invite from the same screen.

**Launch.** This replaces the Launch row in §9. The client launches from the setup checklist once
every row passes. No hosting-team step is needed. The Google sign-in row in §9 stays with the hosting
team and is optional, because emailed codes work without it. Legal review stays with the client.

**Ticket connections.** The first release includes all four choices in §3: Stripe, Eventbrite,
a spreadsheet and no tickets.

**A site built by hand first.** `eventrunner-nclocal` was built by hand on 2026-11-04 to rehearse a
real deployment. It records the steps the provisioner must perform (`docs/DEPLOY_RUNBOOK.md`). It is
not the client's site. It is removed or adopted before the client signs up, so `nclocal` is free.

**Added owner prerequisites.**

1. A Google Cloud organization. A folder needs one, and a service account cannot create a project
   without a parent. None exists today.
2. CCM's Stripe account in test and live mode, with Connect enabled (prerequisite 2 above). It both
   takes the fee and is the Connect platform.
3. The agreement text, its refund terms and the event fee, entered in the console.
