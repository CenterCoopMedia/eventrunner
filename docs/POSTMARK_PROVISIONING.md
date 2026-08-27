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
   each client is a Server, so the plan needs to scale with the client count, not just message
   volume.

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
   if you want the stream name in Postmark's UI to read as the deployment's rather than the generic
   default. Whether the code actually sends on that stream depends on `config/providers.email.
   messageStream` (Tier B, `functions/src/email/send.cjs`): every send falls back to that config
   value when the call site doesn't pass its own `messageStream`, and `createPostmarkProvider` (in
   `postmark.cjs`) only omits `MessageStream` from the API payload — letting Postmark use the
   Server's default stream — when that value is unset. Note whatever you name or rename the stream
   to here; §5 needs it to register the webhook on the stream sends actually land on.

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
check `unknown` rather than failing, so a missing key reads as "can't tell" in
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
HTTP Basic credentials embedded in the webhook URL itself, checked against
`EMAIL_WEBHOOK_BASIC_AUTH` by `verifyDeliveryWebhook()`.

1. Generate a random `user:pass` pair for this deployment — never reused across deployments
   (rotating it means re-registering the URL below). For example:

   ```sh
   printf 'eventrunner-demo:%s\n' "$(openssl rand -hex 20)"
   # → eventrunner-demo:9f2c...   (use the whole "user:pass" string as EMAIL_WEBHOOK_BASIC_AUTH)
   ```

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
   https://<user>:<pass>@<EVENT_FIREBASE_REGION>-<EVENT_FIREBASE_PROJECT_ID>.cloudfunctions.net/emailDeliveryWebhook
   ```

   For the `eventrunner-demo` example: `https://eventrunner-demo:9f2c...@us-central1-<GCP_PROJECT_ID>.cloudfunctions.net/emailDeliveryWebhook`,
   using the region and project id that deployment's GitHub Environment variables actually name
   (`EVENT_FIREBASE_REGION`, `EVENT_FIREBASE_PROJECT_ID`) — copy those from the environment rather
   than guessing.

   Enable the **Delivery**, **Bounce**, and **SpamComplaint** triggers only. Leave **Open**, **Click**,
   and **SubscriptionChange** off: `parseDeliveryEvent()` in `functions/src/email/providers/
   postmark.cjs` returns `null` for a `SubscriptionChange` record unless `SuppressSending` is
   exactly `true`, and `emailDeliveryWebhook` treats a `null` parse as a bad request (`400`) — an
   info-only `SubscriptionChange` payload (`SuppressSending: false`, sent for e.g. a manual
   resubscribe) would 400 what is otherwise a legitimate webhook call. Nothing in this repo
   consumes `Open`/`Click` either.
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
      (`eventrunner.org` for the dev/demo deployment) — not just "unknown"; unknown means one of the
      two keys above is missing or wrong, not that the domain is fine.
- [ ] The DKIM TXT and Return-Path CNAME are visible in the DNS host (Cloudflare, for
      `eventrunner.org`) exactly as Postmark's UI showed them, and the Return-Path CNAME's proxy
      status is "DNS only" (grey cloud), not "Proxied".
- [ ] `EMAIL_WEBHOOK_BASIC_AUTH` is set (GitHub Environment secret + Secret Manager) and the
      matching `user:pass` is embedded in the webhook URL registered in Postmark, on the Delivery,
      Bounce, and SpamComplaint triggers.
- [ ] A test send (`init-event.cjs`'s welcome mail, or an OTP sign-in) shows up in this
      deployment's Server **Activity** tab, not some other deployment's.
- [ ] A test bounce (send to a Postmark-provided bounce test address, or an intentionally invalid
      recipient) produces a `sent_emails` row with `deliveryStatus` patched — confirms the webhook
      round-trip end to end, not just that it's registered.

## Follow-up: manual account creation

The CCM account itself (§1 above: sign-up, org-email ownership, Account Token custody, billing
plan sized for per-client Servers) is manual operator work with no code path to verify against, and
is tracked as its own follow-up issue rather than folded into #4's automatable scope.
