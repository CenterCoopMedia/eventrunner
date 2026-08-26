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

**CCM's own domain, `runofshow.net`, is the first (dev/demo) deployment this runbook stands up** —
sender address `events@runofshow.net` — so §2–6 below use it as the worked example throughout, with
its actual DNS steps (CCM's DNS is in Cloudflare). A real client's sender domain and DNS host will
differ; where that matters, the step says so and gives the general form alongside the concrete one.

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
3. Set up billing for the account's plan and confirm it covers the expected number of Servers —
   each client is a Server, so the plan needs to scale with the client count, not just message
   volume.

## 2. Per deployment: create the Server

1. Postmark → **Servers** → **Add server**. Name it after the deployment
   (`<EVENT_SLUG>` from `.env.example`) so the server list stays legible as deployments accumulate.
   For the first, dev/demo deployment this section provisions: name it `runofshow-dev` (or
   whatever `EVENT_SLUG` that environment actually uses — check `.env.example`/the environment's
   GitHub Environment variables rather than assuming).
2. Server type: **Live**, not the default demo/test server — even for the dev deployment, so its
   sending behavior (rate limits, bounce handling) matches what a real client server will do.
3. Open the new Server → **API Tokens** tab → copy the Server Token. This is
   `EMAIL_PROVIDER_API_KEY` for this deployment's environment.
4. (Optional) Rename the Server's default `Outbound` stream, or add a custom Transactional stream,
   if you want the stream name in Postmark's UI to read as the deployment's rather than the generic
   default. The code does not require this — `createPostmarkProvider` only sets `MessageStream` on
   a send when the caller passes one, and nothing in this repo currently does, so the default
   stream is what every send in v1 uses unless that changes.

## 3. Store the tokens for this environment

Per `docs/DEPLOY_RUNBOOK.md` §3: these are GitHub Environment **secrets** (not variables) on the
client's `<CLIENT_ENV>` environment, then mirrored into Secret Manager for the deployed functions
to read via `defineSecret`.

```sh
# GitHub Environment secrets (Settings → Environments → <CLIENT_ENV> → Secrets):
#   EMAIL_PROVIDER_API_KEY  = the Server Token from step 2.3 (per-client)
#   EMAIL_ACCOUNT_API_KEY   = the Account Token from step 1.2 (same value on every client
#                             environment — it is the one account-scoped credential)

# Secret Manager, once per client project (docs/DEPLOY_RUNBOOK.md §3):
echo -n "<server token>" | gcloud secrets create EMAIL_PROVIDER_API_KEY \
  --project=<GCP_PROJECT_ID> --data-file=- --replication-policy=automatic
echo -n "<account token>" | gcloud secrets create EMAIL_ACCOUNT_API_KEY \
  --project=<GCP_PROJECT_ID> --data-file=- --replication-policy=automatic

# Then bind secretAccessor on BOTH to the function's runtime service account
# (docs/DEPLOY_RUNBOOK.md §3 — the deploy SA and the runtime SA are different principals):
PROJECT_NUMBER=$(gcloud projects describe <GCP_PROJECT_ID> --format="value(projectNumber)")
RUNTIME_SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for secret in EMAIL_PROVIDER_API_KEY EMAIL_ACCOUNT_API_KEY; do
  gcloud secrets add-iam-policy-binding "${secret}" \
    --project=<GCP_PROJECT_ID> \
    --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor"
done
```

`EMAIL_PROVIDER_API_KEY` (the send path, `functions/src/email/providers/postmark.cjs`) and
`EMAIL_ACCOUNT_API_KEY` (the sender-domain check, same file's `verifySenderDomain`) are both
required for a `postmark` deployment — without the account token, `verifySenderDomain()` reports
every check `unknown` rather than failing, so a missing key reads as "can't tell" in
`scripts/verify-sender-domain.cjs`'s output, not as an error. Set both.

## 4. Verify the sender domain

This is `docs/CLIENT_ONBOARDING.md` §3 item 4, reproduced here with the Postmark-side and (for
`runofshow.net`) Cloudflare-side detail. General shape: get whoever controls DNS for the sender
domain to publish two Postmark-issued records plus one DMARC policy; Postmark shows the exact
values once the domain is added to the Server. **Do not invent the record values below** — they are
per-account and Postmark generates them when you add the domain; treat the ones shown here as
illustrative of the *shape*, and copy the real values from Postmark's UI.

### 4a. Add the domain in Postmark

Client's Server → **Sender Signatures** (or the Server's **Domains** tab) → **Add Domain** →
enter the sender domain (`runofshow.net` for the dev/demo deployment; a real client's own domain
otherwise — never a `*.runofshow.net` subdomain unless that client specifically doesn't have their
own). Postmark then displays:

- a **DKIM** TXT record: host something like `pm._domainkey.runofshow.net`, value a long
  `k=rsa; p=...` string,
- a **Return-Path** CNAME: host something like `pm-bounces.runofshow.net`, value something like
  `pm.mtasv.net`.

Copy both exactly as shown — Postmark's UI is the source of truth for the actual host/value pair,
not this document.

### 4b. Publish the records — Cloudflare (runofshow.net)

CCM's DNS for `runofshow.net` is managed in Cloudflare. In the Cloudflare dashboard for the zone →
**DNS** → **Records** → **Add record**, twice:

| Field | DKIM record | Return-Path record |
|---|---|---|
| Type | `TXT` | `CNAME` |
| Name | the host Postmark gave (e.g. `pm._domainkey`) — Cloudflare appends the zone automatically, so enter just the subdomain part, not the full `....runofshow.net` | the host Postmark gave (e.g. `pm-bounces`) |
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
| Content | `v=DMARC1; p=none; rua=mailto:events@runofshow.net` for a first pass (a `p=none` "report only" policy — tighten to `quarantine`/`reject` later once DMARC reports look clean; a real client's `rua` address is theirs, not CCM's) |
| Proxy status | n/a |

For a real client, replace "Cloudflare dashboard for `runofshow.net`" above with wherever *their*
DNS is hosted — the record shapes (TXT for DKIM and DMARC, CNAME for Return-Path, CNAME never
proxied through anything that isn't plain DNS) are the same regardless of host; only the UI for
adding them differs.

### 4c. Confirm with the script

From an operator (or provisioning-agent) machine with this deployment's environment variables
loaded:

```sh
EVENT_EMAIL_PROVIDER=postmark \
EMAIL_PROVIDER_API_KEY=<server token from §2.3> \
EMAIL_ACCOUNT_API_KEY=<account token from §1.2> \
EVENT_FIREBASE_PROJECT_ID=<GCP_PROJECT_ID for this deployment> \
  node scripts/verify-sender-domain.cjs --domain runofshow.net
```

(Omit `--domain` once `config/event.sender.email` is seeded — e.g. after `init-event.cjs` has run
with `events@runofshow.net` as the sender address — and the script reads the domain from there
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
   printf 'runofshow-dev:%s\n' "$(openssl rand -hex 20)"
   # → runofshow-dev:9f2c...   (use the whole "user:pass" string as EMAIL_WEBHOOK_BASIC_AUTH)
   ```

2. Store it as the `EMAIL_WEBHOOK_BASIC_AUTH` GitHub Environment secret for `<CLIENT_ENV>`
   (`docs/DEPLOY_RUNBOOK.md` §3), then in Secret Manager the same way as step 3 above.
3. In this deployment's Postmark **Server** → the stream from step 2.4 → **Webhooks** → add webhook:

   ```
   https://<user>:<pass>@<EVENT_FIREBASE_REGION>-<EVENT_FIREBASE_PROJECT_ID>.cloudfunctions.net/emailDeliveryWebhook
   ```

   For the `runofshow-dev` example: `https://runofshow-dev:9f2c...@us-central1-<GCP_PROJECT_ID>.cloudfunctions.net/emailDeliveryWebhook`,
   using the region and project id that deployment's GitHub Environment variables actually name
   (`EVENT_FIREBASE_REGION`, `EVENT_FIREBASE_PROJECT_ID`) — copy those from the environment rather
   than guessing.

   Enable the **Delivery**, **Bounce**, and **SpamComplaint** triggers (`SubscriptionChange` too, if
   this deployment sends anything Postmark treats as a broadcast stream — `parseDeliveryEvent()`
   already handles it). Leave **Open** and **Click** off; nothing in this repo consumes those events.
4. This webhook registration is scoped to the Server (and, within it, the stream you attached it
   to) — it does not need repeating for other deployments' Servers, and other deployments' webhooks
   do not need repeating here.

## 6. Verification checklist

Before calling a deployment's Postmark setup done:

- [ ] The deployment has its own Server under the shared CCM account, named after `EVENT_SLUG`.
- [ ] `EMAIL_PROVIDER_API_KEY` (this Server's token) is set as a GitHub Environment secret on
      `<CLIENT_ENV>` and mirrored to Secret Manager, with `secretAccessor` bound to the runtime SA.
- [ ] `EMAIL_ACCOUNT_API_KEY` (the one shared account token) is set the same way.
- [ ] `node scripts/verify-sender-domain.cjs` exits `0` for this deployment's sender domain
      (`runofshow.net` for the dev/demo deployment) — not just "unknown"; unknown means one of the
      two keys above is missing or wrong, not that the domain is fine.
- [ ] The DKIM TXT and Return-Path CNAME are visible in the DNS host (Cloudflare, for
      `runofshow.net`) exactly as Postmark's UI showed them, and the Return-Path CNAME's proxy
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
