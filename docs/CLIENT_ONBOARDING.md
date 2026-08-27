# Client onboarding

The operator's start-to-finish checklist for standing up **one client event**, from a signed
agreement to a live, launch-ready site. This is the provisioning and content checklist; the
infrastructure steps it points into live in [`docs/DEPLOY_RUNBOOK.md`](DEPLOY_RUNBOOK.md) so they
are documented once. When you finish, hand the client [`docs/handbook/for-clients.md`](handbook/for-clients.md)
and [`docs/handbook/for-event-staff.md`](handbook/for-event-staff.md) — see [Handoff](#handoff-to-the-client)
below.

**Done when:** `node scripts/init-event.cjs --check` exits 0 and the client's first two admins can
sign in and edit content.

## 0. Prerequisites

Before you start provisioning:

- The client has answered [`docs/handbook/for-clients.md`](handbook/for-clients.md)'s "What you
  will need to give us" list: event name/dates/timezone/venue, the public URL they want, who the
  first admins are, their ticketing choice, and a sender address on **their own domain**.
- You know which ticketing provider this is: `eventbrite`, `manual` (CSV import), or `none`. Every
  onboarding step below that mentions ticketing is gated on this choice, not optional busywork —
  a `manual` deployment genuinely has no webhook step, not a skipped one.
- You have (or can get) `gcloud` access to create a GCP project, and Firebase Console access to add
  Firebase to it.

## 1. Project provisioning

This is entirely [`docs/DEPLOY_RUNBOOK.md`](DEPLOY_RUNBOOK.md)'s job — do not duplicate it here.
Work through, in order:

1. **§0–2** — name the project, set up Workload Identity Federation (once per GCP org/project if
   not already done), create the project, enable its APIs, create the per-client deploy service
   account and bind it to `refs/heads/main` only.
2. **§3** — create the GitHub Environment for this client and set every `vars.*` and `secrets.*`
   row the runbook's tables list, including the provider secrets your ticketing/email choice needs.
3. **§4** — decide now whether this client auto-deploys on push (`AUTO_DEPLOY_ENVIRONMENTS`) or
   stays on manual `workflow_dispatch` while it's new. Manual is the safer default for a first
   event.
4. **§5** — run the **bootstrap dispatch** (provision + functions only), confirming it succeeds
   before you touch this document again. Do not run the normal dispatch yet — there is no
   `config/event` document for it to build content from.

Stop here and come back to this document once the bootstrap dispatch is green.

## 2. init-event: the answers file

`init-event.cjs` is the one-time content bootstrap (`docs/DEPLOY_RUNBOOK.md` §5 step 2) — it does
not run from `deploy-client.yml`, and it is not repeatable in the way a deploy is: re-running it
never overwrites anything the client has already edited (`seeded: true` bookkeeping), so running it
again by mistake is safe, not silent data loss.

Build a `client-answers.json` from the client's intake (see `scripts/lib/answers.cjs` for the
prompt list and validation this file goes through — the same file interactive mode would produce
answering the same questions one at a time, and
[`docs/examples/demo-answers.json`](examples/demo-answers.json) for a filled-in example). At
minimum it needs the event name, dates, timezone, venue, the public URL, the ticketing provider
choice (and its event ID if `eventbrite`), the email provider choice, and the sender address.

```sh
export GOOGLE_APPLICATION_CREDENTIALS=<path to your own gcloud ADC, for this one-time step>
export EVENT_FIREBASE_PROJECT_ID=<the client's GCP project id>
node scripts/init-event.cjs --answers client-answers.json --admin <first-admin@client-domain>
```

Repeat `--admin` for a second address if you already know it — item 5 below still applies if you
don't yet.

This seeds `config/*`, the twelve default pages, placeholder CMS content, the two legal page
templates (flagged `reviewRequired`, see item 4 below), the client-visible email template
overrides, and the placeholder branding assets. It then prints the manual checklist below and the
seven-row launch-readiness table as **warnings** — init itself never fails on an unmet item; only
`--check` (§6) gates going live.

## 3. The §5.6 items

These are the steps a deploy cannot automate — the same list `init-event.cjs` prints after seeding
(`scripts/lib/checklist.cjs`, spec §5.6), reproduced here with the command for each so this document
stands on its own as a checklist you can work top to bottom.

### 1–2. Firebase Auth (manual console steps)

Firebase Console → Authentication:

1. **Sign-in method** → enable **Google**. Set the project support email and the public-facing app
   name — both appear in the Google consent dialog. Emailed one-time codes work without this;
   Google sign-in specifically does not.
2. **Settings → Authorized domains** → add the client's custom domain (the one from `EVENT_PUBLIC_URL`)
   **and** the Hosting default domain (`<EVENT_HOSTING_SITE>.web.app`). Sign-in fails silently on
   any domain not on this list — this bites operators who verify the custom domain and forget the
   default one is still needed for previews and the pre-cutover URL.

There is no Admin SDK read for "is Google sign-in enabled" — nothing in the platform can check
this for you. Once both steps are done, record it:

```sh
node scripts/init-event.cjs --attest-auth
```

This stamps `config/event.auth` (`googleProviderEnabled`, `authorizedDomainsConfigured`,
`attestedAt`, `attestedBy`) and — because enabling Google sign-in changes what the seeded privacy
policy is *true about* — refreshes the two legal templates' sign-in clause through the normal seed
path (client edits are still never overwritten). This is what clears the Auth row in `--check`.

### 3. Firebase Hosting custom domain

Firebase Hosting → add the custom domain, complete DNS verification (a TXT record), and wait for
certificate issuance before announcing the site. Both steps can take anywhere from minutes to about
a day; re-check readiness (§6) rather than assuming it finished. If this client's domain is a
`*.eventrunner.org` subdomain rather than their own domain, see the wildcard-vs-per-client DNS note
in `docs/DEPLOY_RUNBOOK.md` (issue #66) — the attach mechanics are the same Hosting custom-domain
flow either way.

### 4. Sender domain (SPF/DKIM/DMARC)

Emailed one-time codes are this platform's only sign-in path that depends on mail, and an
unauthenticated sender domain is exactly the condition that gets those codes quarantined by the
institutional mail filters a lot of this buyer set runs. Get the client to publish, in **their**
DNS, on the domain their sender address uses:

- an SPF record (or include) for the email provider,
- a DKIM TXT record from the provider console,
- a DMARC policy.

Then confirm:

```sh
node scripts/verify-sender-domain.cjs
```

Reads `config/event.sender.email` for the domain unless you pass `--domain`, and — on a **pass** —
is the *only* writer of `config/event.sender.domainVerified`/`domainVerifiedAt`, which is what
clears the sender row in `--check`. A provider with no domain API of its own (`webhook`, `console`)
can never get an automated pass; for those, confirm the DNS yourself and record it with
`--attest`:

```sh
node scripts/verify-sender-domain.cjs --attest
```

Don't skip this step because "the emails are going out fine in testing" — quarantine is
inconsistent across mail filters and shows up as an intermittent, hard-to-reproduce client
complaint weeks into the event, not a clean failure during setup.

### 5. Ticketing (capability-gated)

What to do here depends entirely on the provider this client chose — item 5 is written to be
satisfiable by every choice, not just Eventbrite, on purpose (a checklist entry a CSV deployment
can never complete is a checklist entry operators learn to ignore):

| Provider | Step |
|---|---|
| `eventbrite` | Create the API token in the ticketing provider (`TICKETING_API_TOKEN` — already set as a GitHub Environment secret per the runbook §3). Then register the webhook: `node scripts/register-ticketing-webhook.cjs`. Confirm the delivery via `getTicketingStatus` (admin Settings, or the Cloud Functions log for the registration call). |
| `manual` | No webhook to register. Upload the first attendee CSV through the admin Ticketing tab instead — that upload *is* the equivalent step for this provider. |
| `none` | Nothing to do. There is no token, no webhook, and no import. |

`register-ticketing-webhook.cjs` checks the provider's own `registerWebhook` capability
(`typeof provider.registerWebhook === 'function'`), never a hardcoded provider-name comparison —
today only `eventbrite` implements it, but the script (and this checklist) does not need to change
if a future provider adds the capability.

### 6. Cloud Billing

Google Cloud Console → confirm the Cloud Billing API is enabled for the deploying service account.
Without it, the functions deploy fails its pre-flight check with a 403 that reads like an unrelated
permissions error, not a billing one — check this **before** the first real deploy dispatch, not
after debugging a cryptic failure.

### 7. First admin, then a second

The first admin (from `--admin` above, or `config/bootstrap.adminEmails`) signs in and confirms the
admin panel loads. Then, **through the admin UI**, grant a second admin — do not leave
`config/bootstrap` as a single point of failure for a client who could lose access to one inbox.
`--check` (§6) requires at least two admin accounts for exactly this reason.

### Legal review sign-off

Not numbered in §5.6 (it's set at seed time, not checked off separately), but it gates go-live:
`init-event.cjs` seeds the privacy policy and terms of service from provider-aware templates
(`scripts/lib/legal.cjs`) with `config/event.legal.reviewRequired = true` and every jurisdiction- or
policy-dependent clause marked `[Client legal review required]`. While that flag is set, the admin
panel shows a persistent banner and the public pages carry a visible notice. There is no script for
this step — it is a human sign-off: the client's counsel reviews the seeded pages (edited in the
admin Content editor like any other page) and an admin clears `legal.reviewRequired` from **admin
Settings** once they're comfortable. Nothing in the platform ever asserts another organization's
terms on the client's behalf; the templates are a starting point, not a finished document.

## 4. Readiness gating (`--check`)

Once every item above is done (or deliberately attested), confirm launch readiness read-only:

```sh
node scripts/init-event.cjs --check
```

This prints the same seven-row table `init-event.cjs` prints as warnings, but here it **gates**:
exit 0 only when every row is met (legal review cleared, sender domain verified/attested, at least
two admins, seeded-content threshold, and the rest — see `scripts/lib/readiness.cjs` for the full
row list and each row's remedy text). Exit non-zero means at least one row is still UNMET; the
remedy column says what to run or click to clear it. Re-run after each fix — this is meant to be
run repeatedly, not once.

## 5. Go live

1. `--check` is green.
2. Run the **normal dispatch** (`docs/DEPLOY_RUNBOOK.md` §5 step 3) — this is the first run whose
   `content`/`build`/`hosting`/`post`/`smoke` jobs actually execute, since `config/event` now
   exists.
3. Confirm `docs/DEPLOY_RUNBOOK.md` §6's verification steps: the smoke job passed, the custom
   domain resolves and serves the deployed site (not a certificate-pending placeholder), and a
   fresh sign-in works end to end (Google if enabled, and an emailed code).
4. Add this client to `AUTO_DEPLOY_ENVIRONMENTS` now, if they're ready to auto-deploy on merge to
   `main` — or keep them on manual dispatch and revisit later (`docs/DEPLOY_RUNBOOK.md` §4).

## Handoff to the client

Once the site is live, point the client at the two handbook pages instead of re-explaining their
content here:

- [`docs/handbook/for-clients.md`](handbook/for-clients.md) — what they bought, what v1 does and
  doesn't include, and how to reach support.
- [`docs/handbook/for-event-staff.md`](handbook/for-event-staff.md) — the narrative walkthrough of
  what staff can change without a developer: pages, schedule, speakers, attendees, live updates,
  theme, badges. Pair it with [`docs/ADMIN_GUIDE.md`](ADMIN_GUIDE.md) for the task-by-task reference
  to every admin surface.

Do not send the client screenshots of another client's event data, and do not put their attendee
list, admin emails, or any other client-specific detail in a public GitHub issue or discussion —
see `docs/handbook/for-clients.md`'s "How to start" note.
