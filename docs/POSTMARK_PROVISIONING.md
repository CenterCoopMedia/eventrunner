# Postmark provisioning

Operator runbook for standing up the shared CCM Postmark account and bringing a new client onto
it. Written to be followed end to end by whoever is doing the provisioning — an operator at a
keyboard, or an agent in a separate session working through it step by step — without needing the
rest of this repo's docs open at the same time; where a step leans on another doc it says so and
summarizes what's there.

This is infrastructure that gets set up once (the account, §1) and once per deployment (a Server,
sender domain, and webhook — §2–5). The per-client steps a deploy cannot automate are also listed
in [`docs/CLIENT_ONBOARDING.md`](CLIENT_ONBOARDING.md) §3 item 4; this document is the fuller
Postmark-side version that page points at.

Decided model (`docs/adr/0001-event-platform-v1.md` §3.1, Q3): **one CCM-owned Postmark account**,
not one account per client. Sender domains are verified per client. The API key that
`EMAIL_PROVIDER_API_KEY` holds is per **deployment environment**, never shared across clients.

**CCM's own domain, `eventrunner.org`, is the first (dev/demo) deployment this runbook stands up** —
sender address `info@eventrunner.org` — so §2–6 below use it as the worked example throughout, with
its actual DNS steps (CCM's DNS is in Cloudflare). A real client's sender domain and DNS host will
differ; where that matters, the step says so and gives the general form alongside the concrete one.

Two DNS-vs-Postmark distinctions worth keeping straight throughout this document: **outbound**
authentication (DKIM, Return-Path, DMARC — §4) is entirely Postmark-side sending configuration,
verified against records published in Cloudflare; **inbound** mail (anyone replying to or emailing
the sender address) is a separate, optional Cloudflare Email Routing setup that Postmark has no part
in — Postmark never receives mail for a domain, only sends it. For `eventrunner.org`, Cloudflare
Email Routing forwards `info@eventrunner.org` to the maintainer's real inbox; that rule lives
entirely in Cloudflare's **Email** → **Email Routing** tab for the zone, not in Postmark.

**Account creation itself is manual operator work and is out of scope here** — it is split into a
follow-up issue (see the note at the end of this document). What follows is everything after the
account exists: per-deployment servers, sender domains, tokens, and webhooks.

## 0. Postmark's object model, in the terms this repo uses

Postmark's hierarchy is **Account → Server → Message Stream**. A Server Token
(`X-Postmark-Server-Token`) is scoped to one Server; an Account Token
(`X-Postmark-Account-Token`) is scoped to the whole account and is the only credential the
Domains API accepts. Message Streams live *inside* a Server (a Server can hold up to 10, including
its two defaults) and do not carry their own token — sending and webhook registration for a stream
both authenticate with that stream's Server's token.

Because `EMAIL_PROVIDER_API_KEY` is one secret **per deployment environment** (§2.1), and a Server
Token is the only credential scoped tightly enough to hand one client, **each client gets its own
Server** inside the shared account, using that Server's default `Outbound` transactional stream (or
a client-named custom stream if you want a friendlier name than the default). One client cannot
read another's server token, sending logs, or bounce history, and revoking a client's access is
deleting one Server — the same isolation "one account per client" would have given, without a
separate Postmark account (and its own billing) per client. This is the practical reading of "one
account, per-client message streams": the *stream* is the sending surface, the *Server* is the unit
that actually carries a distinct token, so provisioning happens at the Server level.

## 1. One-time: the CCM account

Manual, done once, ahead of the first client. Split into a follow-up issue — see the note at the
end. Roughly:

1. Sign up for the Postmark account under an org-owned CCM email (not a personal address).
2. Note the account's Account Token (Account → API Tokens) — this is `EMAIL_ACCOUNT_API_KEY`,
   shared across every client deployment (it is account-scoped by design; there is only one).
   It stays in operator-controlled storage only (§3) — no deployed function binds it, so it never
   goes into a client's GitHub Environment or Secret Manager.
3. Set up billing for the account's plan and confirm it covers the expected number of Servers —
   each client is a Server, so the plan must cover both the client count and the expected
   message volume.

## 2. Per deployment: create the Server

1. Postmark → **Servers** → **Add server**. Name it after the deployment
   (`<EVENT_SLUG>` from `.env.example`) so the server list stays legible as deployments accumulate.
   For the first, dev/demo deployment this section provisions: the CCM account's Server is named
   `Event Runner` (or whatever `EVENT_SLUG` that environment actually uses — check
   `.env.example`/the environment's GitHub Environment variables rather than assuming).
2. Server type: **Live**, not the default demo/test server — even for the dev deployment, so its
   sending behavior (rate limits, bounce handling) matches what a real client server will do.
3. Open the new Server → **API Tokens** tab → copy the Server Token. This is
   `EMAIL_PROVIDER_API_KEY` for this deployment's environment.
4. (Optional) Rename the Server's default `Outbound` stream, or add a custom Transactional stream,
   if you want the stream name in Postmark's UI to match the deployment name instead of the
   generic default. Whether the code actually sends on that stream depends on `config/providers.email.
   messageStream` (Tier B, `functions/src/email/send.cjs`): every send falls back to that config
   value when the call site doesn't pass its own `messageStream`, and `createPostmarkProvider` (in
   `postmark.cjs`) only omits `MessageStream` from the API payload — letting Postmark use the
   Server's default stream — when that value is unset. Note whatever you name or rename the stream
   to here; §5 needs it to register the webhook on the stream sends actually land on.
5. Invoice email (`invoiceAdmin` `send`) attaches the invoice PDF and can add one Cc address. It
   goes on this transactional stream and needs no Postmark setting: attachments and Cc are on by
   default. Postmark refuses a message over 10 MB, attachments included, and some file types;
   PDF is not one of them. The code caps attachments at 7 MB of file, which base64 turns into
   about 9.3 MB. The send is refused before it reaches Postmark when
   `config/providers.email.messageStream` (or the default `outbound`, when unset) equals
   `announcementStream`.

## 2a. Per deployment: the broadcast stream for announcements

Announcement email (issues #202, #490) never uses the transactional stream that carries sign-in
codes and receipts. It needs its own **Broadcasts** stream on the same Server, so a spam complaint
or an unsubscribe on an announcement cannot hold back a sign-in code.

1. In the deployment's Server → **Message Streams** → **Create message stream**. Type:
   **Broadcasts**. Name and ID: `announcements` (any ID works; the deployment config names it).
2. In the new stream → **Settings** → **Unsubscribe handling**, choose one of the two modes.
   Postmark-managed is the default; choose it for every client whose mail goes through Postmark.
   - **Postmark** (Postmark-managed, the default): Postmark adds an unsubscribe link at the end
     of every message and suppresses the address on this stream. The application adds no link of
     its own. A staff restore on the Announcements page removes only the site's record:
     reactivate the address on this stream's suppression list as well, or Postmark keeps
     refusing it.
   - **Custom**: The application adds a signed per-recipient link and the `List-Unsubscribe` and
     `List-Unsubscribe-Post` headers, and records the opt-out itself. Postmark adds nothing.
     Custom is for clients on another email provider, where the site must supply the link.

   **None** is refused: the composer will not send on a stream with no unsubscribe handling.
3. Set the stream ID in the deployment's Tier B config: `config/providers.email.announcementStream`
   (for a new deployment, `providers.email.announcementStream` in the `init-event.cjs` answers file;
   for an existing one, edit that field in the Firestore console). Leave
   `config/providers.email.messageStream` alone: it stays the transactional stream.
4. Open **Announcements** in the admin panel. The composer reads the stream through the Postmark API
   with the Server Token before every send and before each chunk of a send. It refuses, with the
   reason, a missing, archived, or transactional stream, a stream with no unsubscribe handling, or
   a stream ID that equals the transactional one. No send or send-once claim happens before that
   check passes. Scheduled attendee reminders (**Scheduled reminders** page) use the same
   stream and the same check, before each reminder day's send and before each chunk of it. Send a
   test announcement before staff turn them on.
5. Register the delivery webhook on this stream too (section 5), with **SubscriptionChange** on as
   well, so a Postmark opt-out also becomes the application's suppression record and the next
   recipient count leaves that address out.

The webhook relay provider (`EVENT_EMAIL_PROVIDER=webhook`) has no batch or unsubscribe contract,
so announcement email is refused on it. The console provider sends announcements with the
application's own link, for development and the browser tests.

## 3. Store the tokens for this environment

These two tokens are stored differently — only one of them is a deployment secret.

`EMAIL_PROVIDER_API_KEY` (the send path, `functions/src/email/providers/postmark.cjs`) is a
per-deployment GitHub Environment **secret** (not variable) on the client's `<CLIENT_ENV>`
environment, per `docs/DEPLOY_RUNBOOK.md` §3, then mirrored into Secret Manager for the deployed
`emailDeliveryWebhook` function to read via `defineSecret`:

```sh
# GitHub Environment secret (Settings → Environments → <CLIENT_ENV> → Secrets):
#   EMAIL_PROVIDER_API_KEY  = the Server Token from step 2.3 (per-client)

# Secret Manager, once per client project (docs/DEPLOY_RUNBOOK.md §3):
echo -n "<server token>" | gcloud secrets create EMAIL_PROVIDER_API_KEY \
  --project=<GCP_PROJECT_ID> --data-file=- --replication-policy=automatic

# Then bind secretAccessor to the function's runtime service account
# (docs/DEPLOY_RUNBOOK.md §3 — the deploy SA and the runtime SA are different principals):
PROJECT_NUMBER=$(gcloud projects describe <GCP_PROJECT_ID> --format="value(projectNumber)")
RUNTIME_SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding EMAIL_PROVIDER_API_KEY \
  --project=<GCP_PROJECT_ID> \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"
```

`EMAIL_ACCOUNT_API_KEY` (the sender-domain check, `verifySenderDomain()` in the same provider file)
is **not** a deployment secret — no deployed function binds it via `defineSecret` (grep
`functions/src/email/send.cjs`'s `SEND_SECRETS_BY_PROVIDER`/`INGEST_SECRETS_BY_PROVIDER`: it isn't
in either list). Its only consumer is the operator-run `scripts/verify-sender-domain.cjs`. Keep it
in operator-controlled storage (the team password manager, or wherever this account's other
credentials already live) and inject it only as a local environment variable when running that
script (§4c) — do **not** create it as a GitHub Environment secret, do **not** mirror it into a
client's Secret Manager, and do **not** grant any runtime service account access to it. It is the
one account-scoped credential shared across every client deployment, which is exactly why it does
not belong inside a per-client project's trust boundary: granting a client's runtime SA access to
it would let that deployment's functions reach Postmark's account-wide domains API, far beyond
what any of them need.

Without `EMAIL_ACCOUNT_API_KEY` set when the script runs, `verifySenderDomain()` reports every
check `unknown` rather than failing, so a missing key appears as "can't tell" in
`scripts/verify-sender-domain.cjs`'s output, not as an error. Have it ready before §4c.

## 4. Verify the sender domain

This is `docs/CLIENT_ONBOARDING.md` §3 item 4, reproduced here with the Postmark-side and (for
`eventrunner.org`) Cloudflare-side detail. General shape: get whoever controls DNS for the sender
domain to publish two Postmark-issued records plus one DMARC policy; Postmark shows the exact
values once the domain is added to the Server. **Do not invent the record values below** — they are
per-account and Postmark generates them when you add the domain; treat the ones shown here as
illustrative of the *shape*, and copy the real values from Postmark's UI.

### 4a. Add the domain in Postmark

Client's Server → **Sender Signatures** (or the Server's **Domains** tab) → **Add Domain** →
enter the sender domain (`eventrunner.org` for the dev/demo deployment; a real client's own domain
otherwise — never a `*.eventrunner.org` subdomain unless that client specifically doesn't have their
own). Postmark then displays:

- a **DKIM** TXT record: host something like `pm._domainkey.eventrunner.org`, value a long
  `k=rsa; p=...` string,
- a **Return-Path** CNAME: host `pm-bounces.eventrunner.org` (the verified Return-Path host for
  this account), value something like `pm.mtasv.net`.

Copy both exactly as shown — Postmark's UI is the source of truth for the actual host/value pair,
not this document.

### 4b. Publish the records — Cloudflare (eventrunner.org)

CCM's DNS for `eventrunner.org` is managed in Cloudflare. In the Cloudflare dashboard for the zone →
**DNS** → **Records** → **Add record**, twice:

| Field | DKIM record | Return-Path record |
|---|---|---|
| Type | `TXT` | `CNAME` |
| Name | the host Postmark gave (e.g. `pm._domainkey`) — Cloudflare appends the zone automatically, so enter just the subdomain part, not the full `....eventrunner.org` | the host Postmark gave (e.g. `pm-bounces`) |
| Content / Target | the `p=...` value Postmark gave, exactly, quotes and all if Cloudflare's editor asks for a quoted TXT | the target Postmark gave (e.g. `pm.mtasv.net`) |
| Proxy status | n/a (TXT records aren't proxied) | **must be "DNS only" (grey cloud), not "Proxied" (orange cloud)** |
| TTL | Auto | Auto |

**The Return-Path CNAME's proxy status is the one step that silently breaks this if missed.**
Cloudflare's default for a new CNAME is "Proxied" (orange cloud) — that's correct for a web host
record, but for a mail-related CNAME like this one it routes the name through Cloudflare's HTTP
proxy instead of leaving it as a plain DNS answer, so bounce handling (and Postmark's verification
check) never resolves correctly. Click the cloud icon to toggle it to grey before saving.

Then, separately, publish DMARC — not a Postmark record, the domain owner's own policy:

| Field | Value |
|---|---|
| Type | `TXT` |
| Name | `_dmarc` |
| Content | `v=DMARC1; p=none; rua=mailto:info@eventrunner.org` for a first pass (a `p=none` "report only" policy — tighten to `quarantine`/`reject` later once DMARC reports look clean; a real client's `rua` address is theirs, not CCM's) |
| Proxy status | n/a |

For a real client, replace "Cloudflare dashboard for `eventrunner.org`" above with wherever *their*
DNS is hosted — the record shapes (TXT for DKIM and DMARC, CNAME for Return-Path, CNAME never
proxied through anything that isn't plain DNS) are the same regardless of host; only the UI for
adding them differs.

### 4c. Confirm with the script

From an operator (or provisioning-agent) machine, with this deployment's `EMAIL_PROVIDER_API_KEY`
loaded and the account token from operator storage (§3) — not from the client's GitHub Environment
or Secret Manager, since it doesn't live there:

```sh
EVENT_EMAIL_PROVIDER=postmark \
EMAIL_PROVIDER_API_KEY=<server token from §2.3> \
EMAIL_ACCOUNT_API_KEY=<account token from §1.2, operator storage> \
EVENT_FIREBASE_PROJECT_ID=<GCP_PROJECT_ID for this deployment> \
  node scripts/verify-sender-domain.cjs --domain eventrunner.org
```

(Omit `--domain` once `config/event.sender.email` is seeded — e.g. after `init-event.cjs` has run
with `info@eventrunner.org` as the sender address — and the script reads the domain from there
instead.)

On a pass this is the only writer of `config/event.sender.domainVerified` / `domainVerifiedAt` —
what clears the sender row in `init-event.cjs --check`. Re-run it after DNS propagates; DKIM can
take up to ~48 hours to show verified in Postmark even after the record is correctly published,
though Cloudflare itself typically propagates within minutes. `--no-write` reports without
stamping, useful for a first look before write access to `config/event` is wired up for this
environment.

## 5. Register the delivery webhook

Per the ADR (§3.1): Postmark does not sign delivery/bounce/complaint webhooks, so authentication is
HTTP Basic credentials, set in the webhook's HTTP auth fields and checked against
`EMAIL_WEBHOOK_BASIC_AUTH` by `verifyDeliveryWebhook()`.

A console build does this section itself in its `mail-webhooks` step (`docs/DEPLOY_RUNBOOK.md` §12).
Postmark tests the address when a webhook is saved and refuses it unless the function answers `200`,
so the function must be deployed first. That applies to these manual steps too.

1. Use the deployment's existing `EMAIL_WEBHOOK_BASIC_AUTH`. The normal provisioner creates and
   stores a unique random `user:pass` pair when it is missing. An authorized manual setup uses
   the approved private credential route to generate and store the pair without displaying it.
   A credential rotation also requires updating this deployment's webhook auth fields.

2. Store it as the `EMAIL_WEBHOOK_BASIC_AUTH` GitHub Environment secret for `<CLIENT_ENV>`
   (`docs/DEPLOY_RUNBOOK.md` §3), then in Secret Manager the same way as step 3 above.
3. Before registering anything, confirm which stream sends actually use: check this deployment's
   `config/providers.email.messageStream` (Tier B) — if it's unset, sends use the Server's default
   `Outbound` stream; if it's set, they use that named stream instead (§2.4). Register the webhook
   on **that** stream, not on whichever one happens to be open, or delivery events will never reach
   `emailDeliveryWebhook`.

   In this deployment's Postmark **Server** → the stream identified above → **Webhooks** → add
   webhook:

   ```
   https://<EVENT_FIREBASE_REGION>-<EVENT_FIREBASE_PROJECT_ID>.cloudfunctions.net/emailDeliveryWebhook
   ```

   Enter `user` and `pass` in the webhook's HTTP auth username and password fields. Use the region
   and project id that deployment's GitHub Environment variables actually name
   (`EVENT_FIREBASE_REGION`, `EVENT_FIREBASE_PROJECT_ID`) — copy those from the environment rather
   than guessing.

   Enable the **Delivery**, **Bounce**, and **SpamComplaint** triggers only. Leave **Open**, **Click**,
   and **SubscriptionChange** off on this stream. Nothing in this repo consumes `Open`/`Click`.
   On the **announcements** broadcast stream (section 2a), register the same URL and also turn on
   **SubscriptionChange**. A record with `SuppressSending: true` on an announcement becomes the
   application's suppression record; a resubscribe record (`SuppressSending: false`) is accepted
   with nothing to record.
   The site records each message after Postmark accepts it. An event that arrives first,
   for a message the site has no record of yet, gets `503` with `Retry-After: 60` for 15
   minutes after the event's own time, and Postmark retries it (after 1, 5 and 10 minutes).
   An older event for an unknown message gets `200` and is dropped. Mail that another
   application sends through the same Server is such an unknown message; give that
   application its own Server so its events do not reach this webhook.
4. This webhook registration is scoped to the Server (and, within it, the stream you attached it
   to) — it does not need repeating for other deployments' Servers, and other deployments' webhooks
   do not need repeating here.

## 6. Verification checklist

Before calling a deployment's Postmark setup done:

- [ ] The deployment has its own Server under the shared CCM account, named after `EVENT_SLUG`.
- [ ] `EMAIL_PROVIDER_API_KEY` (this Server's token) is set as a GitHub Environment secret on
      `<CLIENT_ENV>` and mirrored to Secret Manager, with `secretAccessor` bound to the runtime SA.
- [ ] `EMAIL_ACCOUNT_API_KEY` (the one shared account token) is available in operator storage —
      **not** a GitHub Environment secret or Secret Manager entry on this (or any) client project,
      since no deployed function binds it.
- [ ] `node scripts/verify-sender-domain.cjs` exits `0` for this deployment's sender domain
      (`eventrunner.org` for the dev/demo deployment) and reports a pass. An `unknown` result means
      one of the two keys above is missing or wrong. It does not mean that the domain is ready.
- [ ] The DKIM TXT and Return-Path CNAME are visible in the DNS host (Cloudflare, for
      `eventrunner.org`) exactly as Postmark's UI showed them, and the Return-Path CNAME's proxy
      status is "DNS only" (grey cloud), not "Proxied".
- [ ] `EMAIL_WEBHOOK_BASIC_AUTH` is set (GitHub Environment secret + Secret Manager) and the
      matching `user:pass` is set in the HTTP auth fields of the webhook registered in Postmark, on
      the Delivery, Bounce, and SpamComplaint triggers.
- [ ] A test send (`init-event.cjs`'s welcome mail, or an OTP sign-in) shows up in this
      deployment's Server **Activity** tab, not some other deployment's.
- [ ] The **announcements** Broadcasts stream exists with Postmark-managed unsubscribe handling
      (the default; Custom only for a client on another email provider),
      `config/providers.email.announcementStream` names it, and the Announcements page shows no
      setup notice. **Send a test to me** arrives from the broadcast stream in **Activity**.
- [ ] With an authorized synthetic recipient, a real announcement's unsubscribe link suppresses
      that address on the broadcast stream, and the next preview leaves it out. Local tests prove
      the mapping only; this check proves the provider's link replacement and suppression.
- [ ] An invoice emailed from **Invoices** with **Email invoice** arrives on the transactional
      stream in **Activity**, with the PDF attached and the Cc address you added.
- [ ] A test bounce (send to a Postmark-provided bounce test address, or an intentionally invalid
      recipient) produces a `sent_emails` row with `deliveryStatus` patched. This confirms the
      complete webhook round trip, including the Firestore update.

## 7. Acceptance on an approved writable target

Use this procedure for issue #91 on an approved rehearsal or client deployment. The historical
public demo keeps `EVENT_EMAIL_PROVIDER=console` and its persisted read-only policy.

### 7.0. Confirm the target and execution authority

Record the approved GitHub Environment, Firebase project, deployed revision, normal Deploy run
and site URL in the private operator handoff. Read that project's current `config/event` write
policy: `historicalDemo` must not be true, and the document and flag must be valid. A build-time
flag or Auth claim cannot override this server-owned policy.

Confirm the permitted recipients, test messages and cleanup before any account or mail action.
Account creation can send a welcome message; a new staff grant can send access instructions.
Record the intended Server's outbound count before those actions. Keep recipient identities and
credentials in the private operator record.

### 7.1. Recover the existing evidence and confirm capacity

Read the target's existing Postmark Server, send records, webhook registrations and deployment
results first. Reuse completed send evidence rather than sending another message for documentation.
An accepted send is not proof of a delivered message or a Firestore webhook update.

Confirm account approval for live sending and the current plan's maximum Server count. Record
the plan name, Server limit and expected client count. The monthly message allowance and the
number of existing Servers do not establish that limit.

### 7.2. Verify the deployed provider and credential boundaries

Use the normal target setup in §2–5 and [the deployment runbook](DEPLOY_RUNBOOK.md). Automated
clients use the existing Provision and Deploy workflows. A green run proves this release only
when its target, revision and actual Functions, Hosting and smoke jobs match the approved action.

Confirm that the target selects `postmark` and uses its own Live Server. Its Server Token is
`EMAIL_PROVIDER_API_KEY`; its webhook credentials are `EMAIL_WEBHOOK_BASIC_AUTH`. Verify their
approved store names and runtime bindings without displaying their values. Use the existing
per-secret compute-account grants and the normal deployment inventory for runtime metadata.

`EMAIL_ACCOUNT_API_KEY` remains in operator-controlled storage. No deployed function binds it,
and it must not be in a client's GitHub Environment or Secret Manager. Fetch credentials only at
use time through the approved operator route; keep values out of command arguments, URLs and logs.

### 7.3. Verify the sender, streams and authenticated webhooks

Read the target's `config/event.sender` and its current sender-domain verification result. Use
§4 for an authorized operator correction if needed; client editors cannot change the From address.

Identify the stream used by each approved test message. Transactional sends use
`config/providers.email.messageStream`, falling back to the Server's default `outbound` stream.
Announcements use their configured broadcast stream (§2a). The normal provisioner registers
webhooks for both streams; the registration must match the stream that sent the message.

Verify the deployed `emailDeliveryWebhook` URL for this target's actual project and region. Its
HTTP Basic auth must match the target's stored `EMAIL_WEBHOOK_BASIC_AUTH`; use the webhook's auth
fields, keeping credentials out of the URL. Confirm **Delivery**, **Bounce** and **SpamComplaint**
triggers on the sending stream. Leave **Open** and **Click** off. The announcements broadcast
stream also needs **SubscriptionChange** (§5); leave that trigger off on the transactional stream.

### 7.4. Prove delivery and bounce updates

1. Match an existing successful send's Postmark message ID to its `sent_emails.providerMessageId`
   in the approved project. Record the delivery event and the row's resulting `deliveryStatus`.
2. If a new send is required, use the normal application path and only an approved recipient and
   message. Count automatic welcome or access messages in the planned total.
3. Under explicit send authority, use the single approved Postmark bounce-test address. Match its
   provider message ID to the target's `sent_emails` row before and after the webhook event. Require
   the bounce event to change that row's `deliveryStatus`.
4. Record the Server's outbound count after the run and reconcile every new message with the
   approved plan. Remove only fixtures created for this run and restore any temporarily changed
   target settings to their recorded values.

Webhook registration and accepted sends alone do not complete #91. Successful delivery and a
real bounce must each have a matching provider event and Firestore status update on the approved
target.

### 7.5. Record the result

Update Workstream C in [the operator handoff](plans/2026-08-26-operator-handoff.md) and issue #91
with the target/revision, deployment run, capacity result, webhook stream/triggers and the
delivery/bounce result. Keep full provider/row references and recipient details in the private
operator record. Report incomplete checks as incomplete; a source change or smoke pass is not
live mail acceptance.

## Follow-up: manual account creation

The CCM account itself (§1 above: sign-up, org-email ownership, Account Token custody, billing
plan sized for per-client Servers) is manual operator work with no code path to verify against, and
is tracked as its own follow-up issue rather than folded into #4's automatable scope.
