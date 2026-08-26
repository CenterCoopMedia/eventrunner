# Operator handoff — naming, DNS, and Postmark provisioning

**Date:** 2026-08-26
**Status:** Executable. Paste this whole document into a local agent session that has this repo
checked out plus browser + CLI access. A human is present alongside that agent to do signups,
billing, and 2FA — every step below is marked `[HUMAN]` or `[AGENT]` so it's clear who does what.
**Self-contained on purpose:** this doc assumes the agent has nothing else from the session that
produced it — every fact it needs (findings, decisions, exact values) is inlined or points at a
file already in the repo.

## Context

Run of Show is CCM's (Center for Cooperative Media's) white-label event-platform product: a
Firebase-hosted web app that gives each client event a real-time, editable schedule
("run of show") plus attendee-facing pages, ticketing, and transactional email, deployed
per-client from this one codebase. It's pre-launch. This handoff covers three pieces of
launch-blocking infrastructure that don't depend on each other's completion order but do share one
constraint worth knowing up front: Workstream A is a legal/naming track that does **not** block B
or C — the working name "Run of Show" stays in the domain, GitHub org, and Postmark sender address
for now regardless of how the rename lands, because the codebase deliberately keeps the product
name out of code identifiers (see Workstream A's last step) so a rename later stays cheap.

Work the three workstreams in order (A, then B, then C) only because that's how this doc is laid
out — B and C are the more time-sensitive ones (they block a working email path), so if the human
present wants to jump to B/C first and loop back to A, that's fine; nothing in B or C depends on A
finishing.

---

## Workstream A — Naming and trademark

**Decision already made** (full research: `docs/plans/2026-08-26-trademark-screen.md`): the
current product name "RUN OF SHOW" is blocked from public launch by a live, registered U.S. federal
trademark — **Reg. No. 6,604,229**, owner "Run of Show, a Delaware corporation," Class 042, covering
almost exactly this product category ("a web hosting platform featuring a detailed schedule of the
item-by-item sequence of steps adjustable in real-time for events"). See that doc's §2 for the full
registration record and §6 for the reasoning. The replacement-name direction chosen after screening
five alternatives is **"Eventrunner"** — clean on the federal trademark register, real but diffuse
(non-blocking) common-law crowding, and open npm/domain namespace (full comparison: same doc, §8,
"Ranking" table).

1. **[AGENT] Claim npm assets for Eventrunner now, defensively — before anyone else does.**
   The trademark-screen doc confirmed (§8, "Eventrunner" section, checked 2026-08-26) that the
   `eventrunner` and `event-runner` package names and the `@eventrunner` / `@event-runner` npm
   scopes are all unclaimed. This is free, low-risk insurance against a third party grabbing the
   name — it is not a public launch of anything and does not require the rename or the trademark
   review to be finished first. It also does not need to wait for workstream C.

   Steps:
   a. Confirm current availability first — a screen from 2026-08-26 can be stale by the time you
      run this. `npm view eventrunner` and `npm view event-runner` should both 404 ("npm ERR! 404
      Not Found"); `npm view @eventrunner` similarly.
   b. `npm login` as the org's npm account (the human present provides credentials / handles 2FA —
      **[HUMAN]** step embedded here if the agent doesn't already have an authenticated npm
      session; hand off to them rather than guessing at credentials).
   c. Create a minimal placeholder package for each unclaimed name. A trivial `package.json` is
      enough — mark it clearly as a placeholder, not a real release, e.g.:
      ```json
      {
        "name": "eventrunner",
        "version": "0.0.0",
        "private": false,
        "description": "Reserved. Not a published product yet — see https://github.com/CenterCoopMedia/run-of-show.",
        "license": "UNLICENSED"
      }
      ```
      Do this in a scratch directory outside the repo (this doc's only allowed new file in the
      repo is itself — do not commit placeholder packages here).
   d. `npm publish --access public` for each of `eventrunner` and `event-runner`.
   e. Create the npm orgs for the two scopes (`@eventrunner`, `@event-runner`) via the npm
      website or `npm org create` if the CLI supports it in this npm version — an org claims the
      scope even before anything is published under it.
   f. **Success check:** `npm view eventrunner`, `npm view event-runner` both return the
      placeholder package's metadata (not a 404); `npm view @eventrunner` (or the npm website
      org page) shows the org as owned by CCM's account.

2. **`eventrunner.org` is already secured — verify it, don't hold off on it.** Update as of
   2026-08-26: the human purchased `eventrunner.org` (presumably via the same Cloudflare account
   that holds `runofshow.net`'s DNS), so the domain-registration hold that used to apply here no
   longer does for `.org`. `eventrunner.events` was still available as of the 2026-08-26 screen
   (trademark-screen doc §8) and can be picked up later if wanted, once counsel clears the name —
   no urgency on it, unlike `.org` which is now done. `eventrunner.com` and `.net` were already
   taken by third parties as of that screen and are not part of this plan.

   **Important distinction that doesn't change with this purchase:** securing the domain is not
   the same as *using* the name publicly. Trademark counsel clearance (step 4 below) still has to
   precede any public-facing use of "Eventrunner" — marketing copy, a live site under the domain,
   press, sign-up flows, anything a customer or the public would see. Until then this is just a
   parked/reserved domain, same posture as the npm placeholders in step 1.

   a. **[AGENT] Verify the domain and DNS zone.** Confirm `eventrunner.org` resolves and that its
      DNS zone exists in the Cloudflare account holding `runofshow.net`:
      ```sh
      dig +short NS eventrunner.org
      whois eventrunner.org | grep -i "registrar\|creation date\|name server"
      ```
      Then check the Cloudflare dashboard (the human present can confirm login) — DNS → the
      `eventrunner.org` zone should be listed alongside `runofshow.net`'s. It's fine (expected,
      even) if the zone currently has no records beyond Cloudflare's defaults — nothing should be
      published under it yet, since step 4's clearance hasn't happened.
      **Success check:** `dig +short NS eventrunner.org` returns Cloudflare nameservers
      (`*.ns.cloudflare.com`), and the zone is visible in the Cloudflare account's zone list.
   b. **[AGENT] Do not register `eventrunner.events` yet** — same reasoning as before, just now
      scoped to the one remaining domain: hold off until counsel clears the name in step 4, then
      re-check availability (it may have changed since 2026-08-26) before buying.
   c. **[AGENT] Do not publish anything public-facing under `eventrunner.org`** (no live site, no
      redirect visible to the public, no marketing copy) until step 4's counsel clearance is in
      hand — the domain being registered is infrastructure prep, not permission to use the name.

3. **[HUMAN] Engage trademark counsel.** Two things need a licensed trademark attorney's review,
   not a non-lawyer's read:
   a. Whether continuing to operate/develop under the *current* working name "Run of Show" (repo
      name, domain, internal references) poses coexistence/infringement risk against Reg.
      6,604,229 before any public launch, press, or paid marketing under that name.
   b. Formal clearance of "Eventrunner" as the replacement — the screen in
      `docs/plans/2026-08-26-trademark-screen.md` §8 is explicitly a non-lawyer knockout screen,
      not a clearance opinion (see that doc's §1 and §7 caveats).
   Useful context to hand counsel: the repo deliberately keeps the product name out of code
   identifiers (variable names, package names, API routes) specifically so that a rename touches
   only the repo name and a handful of prose/doc/UI-copy files, not a code refactor — this was a
   design decision made ahead of this naming question precisely to keep a rename cheap.
   **Success check:** counsel has responded in writing (email, memo, or call notes) on both 3a and
   3b. Until then, do not launch, market, or press-announce under either name.

---

## Workstream B — Cloudflare email/domain (runofshow.net)

`runofshow.net` is CCM's own domain and the current, working sender domain (per
`docs/POSTMARK_PROVISIONING.md`, this is the first/dev-demo deployment, sender address
`events@runofshow.net`). Its DNS is in the maintainer's Cloudflare account (`jamditis@gmail`), so
every DNS-editing step below needs that account's login — the human present holds those
credentials.

This workstream depends on Workstream C step 1 for its actual DNS record *values* (Postmark
generates them once the domain is added to a Server) — do Workstream C step 1 first if starting
from nothing, then come back here. The steps are ordered here for narrative clarity, not execution
order; `docs/POSTMARK_PROVISIONING.md` §4 has the fuller version of this with a general (non-CCM)
form alongside the concrete one — read that section for the exact field-by-field table if anything
below is ambiguous.

1. **[HUMAN] Log into the Cloudflare account (`jamditis@gmail`) that holds `runofshow.net`'s DNS.**
   **Success check:** the `runofshow.net` zone's DNS → Records page loads.

2. **[AGENT] Add the DKIM TXT record.** Postmark (from Workstream C step 1) shows a host like
   `pm._domainkey.runofshow.net` and a value like `k=rsa; p=<long base64 string>`. In Cloudflare:
   DNS → Records → Add record → Type `TXT`, Name = just the subdomain part Postmark gave (e.g.
   `pm._domainkey` — Cloudflare appends the zone automatically), Content = the `p=...` value exactly
   as Postmark shows it (quoted if Cloudflare's editor requires it), TTL Auto. **Do not invent this
   value** — copy it from Postmark's UI, not from any example in this doc.
   **Success check:** the record appears in Cloudflare's record list with the right name and a
   content value that starts with `k=rsa; p=`.

3. **[AGENT] Add the Return-Path CNAME record.** Postmark also shows a host like
   `pm-bounces.runofshow.net` and a target like `pm.mtasv.net`. Add record → Type `CNAME`, Name =
   the subdomain part (e.g. `pm-bounces`), Target = the value Postmark gave.
   **This is the step most likely to silently break things: Cloudflare's default proxy status for
   a new CNAME is "Proxied" (orange cloud). Click the cloud icon so it reads "DNS only" (grey
   cloud) before saving.** A proxied mail CNAME routes through Cloudflare's HTTP proxy instead of
   resolving as a plain DNS answer, which breaks both bounce handling and Postmark's own
   verification check, with no error message pointing at the cause.
   **Success check:** the CNAME record shows grey-cloud "DNS only" status in Cloudflare's record
   list, and `dig CNAME pm-bounces.runofshow.net` (swap in the real host) resolves to the Postmark
   target rather than a Cloudflare IP.

4. **[AGENT] Add the DMARC record.** This is the domain owner's own policy, not something Postmark
   issues. Add record → Type `TXT`, Name `_dmarc`, Content
   `v=DMARC1; p=none; rua=mailto:events@runofshow.net` (a "report only" `p=none` policy for the
   first pass — tighten to `quarantine`/`reject` later once DMARC reports look clean).
   **Success check:** `dig TXT _dmarc.runofshow.net` returns the record with `p=none` and the
   right `rua` address.

5. **[AGENT] (Optional) Set up inbound forwarding for events@runofshow.net.** Postmark only
   handles outbound mail — there's no inbox behind `events@runofshow.net` unless one is wired up.
   In Cloudflare: Email → Email Routing → create a routing rule that forwards
   `events@runofshow.net` to the maintainer's real inbox. This requires Cloudflare's Email Routing
   MX/TXT records to be added to the zone (Cloudflare's UI does this automatically when routing is
   enabled) — check these don't collide with anything Postmark needs; they're independent record
   types (MX for routing, vs. the TXT/CNAME above) so they normally coexist fine.
   **Success check:** send a test email to `events@runofshow.net` from an external address; it
   arrives in the maintainer's forwarding-target inbox within a few minutes.

6. **Cross-reference:** if any record value or field name here doesn't match what Postmark's UI
   actually shows, trust `docs/POSTMARK_PROVISIONING.md` §4 and Postmark's live UI over this
   document — Postmark generates per-account values and this doc's examples are illustrative only.

---

## Workstream C — Postmark provisioning

Full detail lives in `docs/POSTMARK_PROVISIONING.md` — this section is a sequenced pointer into it
by heading, not a duplicate. Read each referenced section before doing its step.

1. **[HUMAN] Account creation and billing** (`docs/POSTMARK_PROVISIONING.md` §1, "One-time: the
   CCM account"). Sign up for the Postmark account under an org-owned CCM email, not a personal
   address. Note the Account Token (Account → API Tokens) — hand it to the agent for step 2 via
   whatever secret-passing channel you're already using (never paste it into this doc or any repo
   file). **Set up billing and confirm the plan tier covers the expected client count** — Postmark's
   billing model here is a Server per client (§0, "Postmark's object model"), so the number of
   Servers the plan supports, not just message volume, is the real capacity constraint. Ask
   Postmark's plan page or support directly how many Servers the chosen tier allows, and compare
   against how many client deployments are expected in the near term.
   **Success check:** account exists, Account Token is in hand, and the human has confirmed
   (in writing, e.g. a note back to the agent or in this doc's results section below) which plan
   tier was chosen and how many Servers it supports.

2. **[AGENT] Create the dev/demo Server and stream, store both tokens as GitHub Environment
   secrets** (`docs/POSTMARK_PROVISIONING.md` §2 "Per deployment: create the Server" and §3 "Store
   the tokens for this environment"; also `docs/DEPLOY_RUNBOOK.md` §3 for the GitHub Environment
   secrets table and the Secret Manager mirroring commands).
   a. Postmark → Servers → Add server, name it `runofshow-dev` (confirm this matches `EVENT_SLUG`
      for this environment in `.env.example`/the GitHub Environment's variables rather than
      assuming), type **Live** (not demo/test).
   b. Open the Server → API Tokens tab → copy the Server Token. This is `EMAIL_PROVIDER_API_KEY`
      for this environment.
   c. Store `EMAIL_PROVIDER_API_KEY` (this Server's token) and `EMAIL_ACCOUNT_API_KEY` (the
      account token from step 1) as GitHub Environment **secrets** (not variables) on this
      client's environment — Settings → Environments → `<CLIENT_ENV>` → Secrets — per
      `docs/DEPLOY_RUNBOOK.md` §3.
   d. Mirror both into Secret Manager and bind `secretAccessor` to the *runtime* service account
      (the project's default compute SA, `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`
      — not the deploy SA) per the `gcloud secrets create` / `add-iam-policy-binding` commands in
      `docs/POSTMARK_PROVISIONING.md` §3.
   **Success check:** the Server exists in Postmark named after `EVENT_SLUG`; both secrets show up
   in `gh secret list --env <CLIENT_ENV>` (or the GitHub UI) and in
   `gcloud secrets list --project=<GCP_PROJECT_ID>`; `gcloud secrets get-iam-policy
   EMAIL_PROVIDER_API_KEY --project=<GCP_PROJECT_ID>` shows the runtime SA with
   `roles/secretmanager.secretAccessor`.

3. **[AGENT] Verify the sender domain** (`docs/POSTMARK_PROVISIONING.md` §4, all subsections).
   §4a is "add the domain in Postmark" (this is what produces the DKIM/Return-Path values
   Workstream B needs — do this before Workstream B steps 2–3 if starting fresh). §4b is the
   Cloudflare-side record publishing (== Workstream B above; don't redo it here). §4c is running
   the verification script:
   ```sh
   EVENT_EMAIL_PROVIDER=postmark \
   EMAIL_PROVIDER_API_KEY=<server token from step 2b> \
   EMAIL_ACCOUNT_API_KEY=<account token from step 1> \
   EVENT_FIREBASE_PROJECT_ID=<this deployment's GCP project id> \
     node scripts/verify-sender-domain.cjs --domain runofshow.net
   ```
   Re-run after DNS propagates — DKIM can take up to ~48 hours to show verified in Postmark even
   after the record is correctly published (Cloudflare itself typically propagates in minutes, so
   a long wait points at Postmark's own verification cadence, not a DNS problem).

   **Known caveat, don't chase this if it happens:** `scripts/README.md` notes the sender-domain
   check still requires the deprecated SPF field to resolve before it reports fully verified. If
   verification stalls with everything else (DKIM, Return-Path) green and only SPF unresolved,
   that is this known issue — **do not spend time re-checking or re-publishing DNS records over
   it**; report it back in the results section below instead so it can be tracked separately.

   **Success check:** `node scripts/verify-sender-domain.cjs --domain runofshow.net` exits `0`.
   Exit `1` = not verified (DNS not propagated yet or a record is wrong); exit `2` = misconfigured
   (a required key is missing — check both `EMAIL_PROVIDER_API_KEY` and `EMAIL_ACCOUNT_API_KEY`
   are set, since a missing account token makes every check report "unknown" rather than failing
   outright).

4. **[AGENT] Register the delivery webhook** (`docs/POSTMARK_PROVISIONING.md` §5, "Register the
   delivery webhook").
   a. Generate a random `user:pass` pair, unique to this deployment:
      `printf 'runofshow-dev:%s\n' "$(openssl rand -hex 20)"`.
   b. Store the whole `user:pass` string as `EMAIL_WEBHOOK_BASIC_AUTH` — GitHub Environment secret
      + Secret Manager, same pattern as step 2c/2d above.
   c. In Postmark, this Server → the stream from step 2 → Webhooks → add webhook, URL:
      `https://<user>:<pass>@<EVENT_FIREBASE_REGION>-<EVENT_FIREBASE_PROJECT_ID>.cloudfunctions.net/emailDeliveryWebhook`
      — using this environment's actual `EVENT_FIREBASE_REGION` / `EVENT_FIREBASE_PROJECT_ID`
      GitHub Environment variables, not a guess. Enable the **Delivery**, **Bounce**, and
      **SpamComplaint** triggers; leave **Open** and **Click** off (nothing in this repo consumes
      them).
   **Success check:** the webhook shows registered in Postmark's Server → Webhooks list with the
   three triggers enabled; a test send followed by an intentionally-invalid-recipient bounce
   produces both a `sent_emails` Activity entry and a bounce event that patches `deliveryStatus`
   (`docs/POSTMARK_PROVISIONING.md` §6, last two checklist items) — confirms the webhook
   round-trips end to end, not just that it's registered.

---

## Results — fill this in as you go

Local agent: update this section in place as each workstream's steps complete. Do not paste any
token, password, or API key value into this document — name only *where* it was stored.

### Workstream A
- [ ] npm placeholders published: `eventrunner` — done/blocked? npm scopes claimed:
      `@eventrunner`, `@event-runner` — done/blocked?
- [ ] eventrunner.org resolves and its zone is active in Cloudflare: yes/no
- [ ] eventrunner.events availability re-checked (still deferred until counsel clearance): yes/no
- [ ] Counsel engaged: yes/no, date, and (once available) their finding on 3a/3b

### Workstream B
- [ ] DKIM TXT record added and visible in Cloudflare: yes/no
- [ ] Return-Path CNAME added, confirmed "DNS only" (not proxied): yes/no
- [ ] DMARC TXT record added: yes/no
- [ ] Inbound forwarding for events@runofshow.net set up (optional): yes/no

### Workstream C
- [ ] Postmark account created; plan tier and Server capacity confirmed: (plan name / Server limit)
- [ ] Server `runofshow-dev` created; tokens stored as GitHub Environment secrets at:
      (name the environment, not the values) and mirrored to Secret Manager at project:
      (project id)
- [ ] `verify-sender-domain.cjs` output: (paste exit code and summary line, not any secret)
- [ ] Known SPF-field caveat hit: yes/no — if yes, this is expected, not a new bug
- [ ] Delivery webhook registered with triggers Delivery/Bounce/SpamComplaint: yes/no
- [ ] Round-trip test (send + bounce) confirmed via `sent_emails` row: yes/no

### Anything blocked
List anything that couldn't be completed and why (e.g. waiting on human 2FA, waiting on counsel,
DNS not yet propagated, Postmark plan doesn't cover Server count).
