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
`events@runofshow.net`). Its DNS is in CCM's Cloudflare account, so every DNS-editing step below
needs that account's login — the human present holds those credentials.

This workstream depends on Workstream C step 1 for its actual DNS record *values* (Postmark
generates them once the domain is added to a Server) — do Workstream C step 1 first if starting
from nothing, then come back here. The steps are ordered here for narrative clarity, not execution
order; `docs/POSTMARK_PROVISIONING.md` §4 has the fuller version of this with a general (non-CCM)
form alongside the concrete one — read that section for the exact field-by-field table if anything
below is ambiguous.

1. **[HUMAN] Log in to the Cloudflare account that manages `runofshow.net` — account identity per
   operator records.**
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

2. **[AGENT] Create the dev/demo Server and stream, store the server token as a GitHub Environment
   secret** (`docs/POSTMARK_PROVISIONING.md` §2 "Per deployment: create the Server" and §3 "Store
   the tokens for this environment"; also `docs/DEPLOY_RUNBOOK.md` §3 for the GitHub Environment
   secrets table and the Secret Manager mirroring commands).
   a. Postmark → Servers → Add server, name it `runofshow-dev` (confirm this matches `EVENT_SLUG`
      for this environment in `.env.example`/the GitHub Environment's variables rather than
      assuming), type **Live** (not demo/test).
   b. Open the Server → API Tokens tab → copy the Server Token. This is `EMAIL_PROVIDER_API_KEY`
      for this environment.
   c. Store `EMAIL_PROVIDER_API_KEY` (this Server's token) as a GitHub Environment **secret** (not
      variable) on this client's environment — Settings → Environments → `<CLIENT_ENV>` → Secrets —
      per `docs/DEPLOY_RUNBOOK.md` §3. Do **not** store `EMAIL_ACCOUNT_API_KEY` (the account token
      from step 1) here or anywhere client-scoped — no deployed function binds it, only the
      operator-run `scripts/verify-sender-domain.cjs` does (step 3 below), so it stays in operator
      storage instead (`docs/POSTMARK_PROVISIONING.md` §3).
   d. Mirror `EMAIL_PROVIDER_API_KEY` into Secret Manager and bind `secretAccessor` to the
      *runtime* service account (the project's default compute SA,
      `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com` — not the deploy SA) per the
      `gcloud secrets create` / `add-iam-policy-binding` commands in
      `docs/POSTMARK_PROVISIONING.md` §3.
   **Success check:** the Server exists in Postmark named after `EVENT_SLUG`; `EMAIL_PROVIDER_API_KEY`
   shows up in `gh secret list --env <CLIENT_ENV>` (or the GitHub UI) and in
   `gcloud secrets list --project=<GCP_PROJECT_ID>`; `gcloud secrets get-iam-policy
   EMAIL_PROVIDER_API_KEY --project=<GCP_PROJECT_ID>` shows the runtime SA with
   `roles/secretmanager.secretAccessor`. `EMAIL_ACCOUNT_API_KEY` is confirmed available in operator
   storage, not in `gh secret list` or `gcloud secrets list` output for this project.

3. **[AGENT] Verify the sender domain** (`docs/POSTMARK_PROVISIONING.md` §4, all subsections).
   §4a is "add the domain in Postmark" (this is what produces the DKIM/Return-Path values
   Workstream B needs — do this before Workstream B steps 2–3 if starting fresh). §4b is the
   Cloudflare-side record publishing (== Workstream B above; don't redo it here). §4c is running
   the verification script:
   ```sh
   EVENT_EMAIL_PROVIDER=postmark \
   EMAIL_PROVIDER_API_KEY=<server token from step 2b> \
   EMAIL_ACCOUNT_API_KEY=<account token from step 1, operator storage> \
   EVENT_FIREBASE_PROJECT_ID=<this deployment's GCP project id> \
     node scripts/verify-sender-domain.cjs --domain runofshow.net
   ```
   Re-run after DNS propagates — DKIM can take up to ~48 hours to show verified in Postmark even
   after the record is correctly published (Cloudflare itself typically propagates in minutes, so
   a long wait points at Postmark's own verification cadence, not a DNS problem).

   **SPF is informational, don't chase it:** the verification gate is DKIM + Return-Path only
   (issue #93). Postmark's Domains API deprecates its SPF field and satisfies SPF through the
   Return-Path CNAME, so the script reports the SPF verdict but never blocks on it and never asks
   you to publish an SPF record. If SPF shows `unknown` or `FAIL` while DKIM and Return-Path are
   green, the domain is verified — **do not re-check or publish DNS records over it**.

   **Success check:** `node scripts/verify-sender-domain.cjs --domain runofshow.net` exits `0`
   (verified). Exit `1` means the domain is not verified — this covers DNS not propagated yet, a
   wrong record, *and* a missing or rejected `EMAIL_ACCOUNT_API_KEY` (the provider then reports
   DKIM/Return-Path as `unknown` instead of `fail`, which still isn't a pass, so the script still
   exits `1`). Exit `2` is reserved for setup/provider failures that keep the script from checking
   DNS at all — e.g. a missing or invalid `EMAIL_PROVIDER_API_KEY` (server token), no sender domain
   configured, or the provider call itself erroring — not for an account-key problem, which is
   exit `1`.

4. **[AGENT] Register the delivery webhook** (`docs/POSTMARK_PROVISIONING.md` §5, "Register the
   delivery webhook").
   a. Generate a random `user:pass` pair, unique to this deployment:
      `printf 'runofshow-dev:%s\n' "$(openssl rand -hex 20)"`.
   b. Store the whole `user:pass` string as `EMAIL_WEBHOOK_BASIC_AUTH` — GitHub Environment secret
      + Secret Manager, same pattern as step 2c/2d above.
   c. Confirm which stream sends actually use before registering anything: check this
      deployment's `config/providers.email.messageStream` — unset means the Server's default
      `Outbound` stream, set means that named stream instead (`docs/POSTMARK_PROVISIONING.md`
      §2.4/§5). In Postmark, this Server → that stream → Webhooks → add webhook, URL:
      `https://<user>:<pass>@<EVENT_FIREBASE_REGION>-<EVENT_FIREBASE_PROJECT_ID>.cloudfunctions.net/emailDeliveryWebhook`
      — using this environment's actual `EVENT_FIREBASE_REGION` / `EVENT_FIREBASE_PROJECT_ID`
      GitHub Environment variables, not a guess. Enable the **Delivery**, **Bounce**, and
      **SpamComplaint** triggers only; leave **Open**, **Click**, and **SubscriptionChange** off
      (nothing in this repo consumes the first two, and `parseDeliveryEvent()` 400s a
      `SubscriptionChange` payload whose `SuppressSending` isn't exactly `true` —
      `docs/POSTMARK_PROVISIONING.md` §5).
   **Success check:** the webhook shows registered in Postmark's Server → Webhooks list with the
   three triggers enabled; a test send followed by an intentionally-invalid-recipient bounce
   produces both a `sent_emails` Activity entry and a bounce event that patches `deliveryStatus`
   (`docs/POSTMARK_PROVISIONING.md` §6, last two checklist items) — confirms the webhook
   round-trips end to end, not just that it's registered.

---

## Workstream D — Repository rename (execute now)

**Decision: the repo renames from `run-of-show` to `eventrunner` now, not gated on counsel.**
This is different from the product-name decision in Workstream A: the repo slug/URLs are
infrastructure, not public product marketing, and the maintainer has explicitly accepted the
timing risk of moving the repo ahead of counsel's review — counsel still reviews trademark
exposure per Workstream A step 3, in parallel, not as a blocker to this workstream. The repo
**stays under the `CenterCoopMedia` GitHub org** — no org change. The "claim the name as an org"
piece of this is the `@eventrunner` npm scope already covered in Workstream A step 1, not a GitHub
org move.

**Explicitly out of scope for this workstream:** the visible product name. Page copy, UI strings,
and prose that say "Run of Show" as the *product name* (as opposed to a repo/URL reference) stay
exactly as they are for now — that visible rename is a separate, later pass, gated on counsel
per Workstream A. This workstream only touches the repo slug and the URLs/paths that are
mechanically tied to it.

1. **[HUMAN or AGENT with org admin rights] Rename the repo on GitHub.** Repo Settings → General →
   Repository name → change `run-of-show` to `eventrunner`, same `CenterCoopMedia` org. GitHub
   automatically redirects the old web URL, git remotes, and API calls made against the old
   `owner/repo` path to the new one, and open PRs/issues/milestones carry over untouched — none of
   that needs separate handling.
   **Success check:** `https://github.com/CenterCoopMedia/run-of-show` redirects (HTTP 301) to
   `https://github.com/CenterCoopMedia/eventrunner`; the repo's Settings page shows the new name.

2. **[AGENT] Update local clone remotes.** GitHub's redirect makes this optional for correctness,
   but leaving remotes pointed at the old name is confusing and one day the redirect could be
   retired, so do it anyway:
   ```sh
   git remote set-url origin https://github.com/CenterCoopMedia/eventrunner.git
   # or, for an SSH remote:
   git remote set-url origin git@github.com:CenterCoopMedia/eventrunner.git
   ```
   **Success check:** `git remote -v` shows `eventrunner`, not `run-of-show`, and `git fetch`
   succeeds against it.

3. **[AGENT] CRITICAL — GitHub Pages does not redirect.** Unlike the repo's web/git/API URLs, the
   Pages site does not follow the rename: it physically moves from
   `https://centercoopmedia.github.io/run-of-show/` to
   `https://centercoopmedia.github.io/eventrunner/` with no redirect from the old path. Two
   follow-up changes are needed in a commit after the rename:

   a. **Update the greppable set of repo-URL references in prose/docs.** These were found by
      grepping the repo for `run-of-show` on 2026-08-26 (pre-computed here so the agent doesn't
      need to re-derive the list) — the codebase deliberately keeps the product *name* out of code
      identifiers, so this is a short, entirely prose/doc set, no code or config: `README.md`,
      `CONTRIBUTING.md`, `SUPPORT.md`, `GOVERNANCE.md`, `SECURITY.md`, `docs/index.html`,
      `docs/handbook/README.md`. In each, every `run-of-show` occurrence is part of a GitHub URL
      of the shape `github.com/CenterCoopMedia/run-of-show[/...]` or the Pages URL
      `centercoopmedia.github.io/run-of-show[/...]` — replace `run-of-show` with `eventrunner` in
      both URL patterns; do not touch any prose that says "Run of Show" as a *name* (there isn't
      any in this specific `run-of-show`-token grep, but scan the same files' diffs before
      committing to be sure a stray one didn't get swept in). Re-grep after editing to confirm
      nothing was missed:
      ```sh
      grep -rn "run-of-show" README.md CONTRIBUTING.md SUPPORT.md GOVERNANCE.md SECURITY.md \
        docs/index.html docs/handbook/README.md
      ```
      **Note:** `apps/web/README.md` also matches a `run-of-show` grep, but its occurrences are
      the Firebase demo project id `demo-run-of-show` (an unrelated literal used by the local
      emulator instructions, not a repo URL) — leave that file alone; renaming that id is a
      separate concern with its own blast radius (Firestore/Storage emulator config, `.env`
      examples) and is not part of this workstream.
      **Success check:** the grep above returns nothing for the seven listed files; every link in
      those files that used to point at `.../run-of-show...` now points at `.../eventrunner...`.

   b. **Rebuild the static demo under `docs/demo/` with the new Pages base path.** The demo is
      built by `scripts/build-demo.cjs`, which takes `--base <path>` (default
      `/run-of-show/demo/`, hardcoded as `DEFAULT_BASE` in that script, reasoned there as "Pages
      project site root is `/run-of-show/`; the demo lives beside the docs") and syncs Vite's
      output into `docs/demo/`, deleting stale contents first so no renamed hashed asset lingers.
      Run it with the new base and commit the regenerated output:
      ```sh
      node scripts/build-demo.cjs --base /eventrunner/demo/
      git add docs/demo/
      git commit -m "Rebuild demo for /eventrunner/demo/ Pages base after repo rename"
      ```
      **Success check:** `docs/demo/index.html` and its asset references use `/eventrunner/demo/`
      paths, not `/run-of-show/demo/`; `git status` shows only `docs/demo/` changed by this step
      (plus whatever 3a touched, if committed together).

4. **[AGENT] Verify end to end, after both the GitHub rename and the 3a/3b commit are live.**
   - Old web URL redirects: `curl -sI https://github.com/CenterCoopMedia/run-of-show` shows a
     redirect to the `eventrunner` path.
   - Pages serves at the new URL: `https://centercoopmedia.github.io/eventrunner/` loads (the old
     `.../run-of-show/` Pages URL will 404 — expected, per 3 above, not a bug to chase).
   - Demo loads at the new path: `https://centercoopmedia.github.io/eventrunner/demo/` loads and
     is interactive (not a blank page or broken asset paths — confirms 3b's base path took).
   - PR #90 is still open and still attached to this repo (now at its `eventrunner` URL) —
     `gh pr view 90 --repo CenterCoopMedia/eventrunner` shows it open with its original commits
     and comments intact.
   **Success check:** all four of the above are true. If Pages hasn't rebuilt yet, GitHub Pages
   deploys can lag a few minutes behind the push — re-check before treating a blank/404 result as
   a real failure.

---

## Workstream E — Public demo instance (issue #35)

The sales artifact: a live Firebase deployment, seeded entirely with fiction, that a prospective
client can click through. It is onboarded as an ordinary client — `docs/CLIENT_ONBOARDING.md` →
`docs/DEPLOY_RUNBOOK.md` — with demo-specific substitutions at a few points, not a separate
pipeline. Issue #35's own approved deploy-plan comment (2026-08-22) has the fuller version of this
checklist; what's below is this doc's sequenced pointer into it, same pattern as Workstream C's
pointer into `docs/POSTMARK_PROVISIONING.md`.

1. **[HUMAN] Create the demo Firebase/GCP project, with billing.** The project id needs a
   **delimited `demo` token** — `run-of-show-demo`, not `ros-demonstration` — because step 4's seed
   script refuses to run against a project id that doesn't match (see that step). Add Firebase to
   it (Firestore Native mode, Storage, a Hosting site) per `docs/DEPLOY_RUNBOOK.md` §2's Firebase
   prerequisites block.
   **Success check:** the project exists, Firebase is added, and `gcloud services list
   --project=<DEMO_PROJECT_ID>` shows the APIs `docs/DEPLOY_RUNBOOK.md` §2 enables.

2. **[AGENT] Configure the demo as a client via the standard per-client pipeline.** Work
   `docs/DEPLOY_RUNBOOK.md` §0–§3 exactly as for any client (WIF pool/provider reuse if one already
   exists, per-client deploy service account bound to `refs/heads/main` only, a GitHub Environment
   named for the demo, e.g. `demo`) — see `docs/CLIENT_ONBOARDING.md` §1 for the same steps read as
   an onboarding checklist rather than raw IAM commands. Two deviations from a normal client, both
   from issue #35's scope:
   - `EVENT_EMAIL_PROVIDER = console` or `none`, `EVENT_TICKETING_PROVIDER = none` (or `manual` if
     showing the Ticketing tab in the walkthrough matters), `EVENT_OPERATOR_NOTIFIER = none`. This
     means the demo needs **no provider secrets** — it deploys credential-free. **If Workstream C
     (Postmark) is done by the time this runs**, a dedicated Postmark message stream for the demo is
     an option instead of `console`, so a prospect can see a real OTP email — not required, just an
     upgrade path issue #35 explicitly allows; don't block this workstream on C to get it.
   - `EVENT_PUBLIC_URL` is just the `.web.app` Hosting URL — no custom domain to provision for a
     demo.
   Keep it on manual `workflow_dispatch` (do not add to `AUTO_DEPLOY_ENVIRONMENTS` yet — that's step
   7). Run the **bootstrap dispatch** (`docs/DEPLOY_RUNBOOK.md` §5 step 1) and confirm it's green
   before continuing.
   **Success check:** the GitHub Environment exists with the values above, no secrets are required
   by `deploy-client.yml`'s env validation, and the bootstrap dispatch succeeds.

3. **[AGENT] Seed the demo content.** Two scripts, in order, against the demo project (not the
   emulator):
   ```sh
   export GOOGLE_APPLICATION_CREDENTIALS=<operator ADC, for this one-time step>
   export EVENT_FIREBASE_PROJECT_ID=<DEMO_PROJECT_ID>
   node scripts/init-event.cjs --answers demo-answers.json --admin <operator-admin@ccm-domain>
   node scripts/seed-demo-event.cjs
   ```
   `demo-answers.json` doesn't exist in the repo yet as of this handoff — build it from
   `scripts/lib/answers.cjs`'s prompt list (event name/dates/timezone/venue can come straight from
   the demo fixture, `scripts/lib/demo-event.cjs`). `seed-demo-event.cjs` is the script with the
   project-id guard from `scripts/README.md`: it refuses to run against a project id that isn't an
   exact `DEMO_PROJECT_ID` or doesn't contain a delimited `demo` component, unless
   `--i-know-this-is-not-a-demo-project` is passed — that override should never be needed here if
   step 1's project id was chosen correctly, and reaching for it is a sign to stop and recheck the
   project id, not push through. Both scripts are idempotent on `seeded: true` — re-running never
   clobbers an admin-UI edit.
   **Success check:** both commands exit 0; `node scripts/init-event.cjs --check` shows the seeded
   rows (legal/admins/etc. still pending until step 5).

4. **[AGENT] Verify the committed `apps/web/src/generated` snapshot matches the seed output.** This
   is the CI hygiene fixture requirement issue #35 names explicitly: `scripts/seed-demo-event.cjs`
   and `generate-content.cjs --demo` read the same fixture (`scripts/lib/demo-event.cjs`) by
   construction, so this should already hold — the point of this step is confirming it, not fixing
   a drift that shouldn't exist.
   ```sh
   node scripts/generate-content.cjs --demo --check
   ```
   **Success check:** exits 0 (no diff). If it doesn't, something edited `apps/web/src/generated/*`
   or `scripts/lib/demo-event.cjs` out of sync — fix that before continuing, in a normal PR (see
   Workstream F step 5's note on this repo's no-direct-push posture; it applies here too), not by
   force-regenerating and committing straight to this branch.

5. **[AGENT] Readiness gate.** `node scripts/init-event.cjs --check` until it exits 0: enable Google
   sign-in (optional for a demo, but exercise it if the walkthrough should show it) and add the
   `.web.app` domain to Authorized domains, then `--attest-auth`
   (`docs/CLIENT_ONBOARDING.md` §3 items 1–2); `verify-sender-domain.cjs --attest` for the
   `console`/`none` provider case, which has no domain API to check automatically
   (`docs/CLIENT_ONBOARDING.md` §3 item 4); clear `legal.reviewRequired` in admin Settings after a
   skim (a prospect will see these pages, so don't skip the skim even though it's fiction); sign in
   as the first admin and grant a second through the admin UI.
   **Success check:** `node scripts/init-event.cjs --check` exits 0.

6. **[AGENT] Go live.** Run the **normal dispatch** (`docs/DEPLOY_RUNBOOK.md` §5 step 3) now that
   `config/event` exists — this is the first run where `content`/`build`/`hosting`/`post`/`smoke`
   actually execute. Confirm the smoke job passes and a fresh sign-in works
   (`docs/DEPLOY_RUNBOOK.md` §6).
   **Success check:** the dispatch succeeds end to end, including `smoke`.

7. **[AGENT/HUMAN] Verify the demo URL is publicly browsable, and fill in the README's pending
   link.** `README.md` currently notes: "A public demo instance and README screenshots are pending
   the operator's deploy of that instance" — this step is what clears that note. Load the URL from
   a machine with no special access (not the operator's authenticated session) to confirm it's
   really public, then add the demo URL and screenshots to `README.md` in the normal PR flow (this
   doc's file is the only direct-edit exception this handoff carries — `README.md` goes through a
   PR like any other change).
   **Note on the interim artifact:** the static GitHub Pages demo at `/demo/` (built by
   `scripts/build-demo.cjs`, a `vite build --base .../demo/` against the same committed synthetic
   snapshot, served with no backend) already exists and is click-through today — it's the interim
   sales artifact until this live Firebase deployment lands. Once this workstream's demo URL is
   live, decide whether the README links one or both (the Pages demo has no live backend — no real
   sign-in, no CMS — while this deployment is a full, if credential-free, client instance); either
   is a reasonable answer, but don't let "the Pages demo already exists" be a reason to skip this
   workstream — issue #35 is asking for the live deployment specifically, precisely because it's a
   permanent integration test as well as a sales artifact (it IS a client).
   Optionally add the demo environment to `AUTO_DEPLOY_ENVIRONMENTS` (`docs/DEPLOY_RUNBOOK.md` §4)
   so every merge to `main` redeploys it — a live regression check, on top of being a sales page.
   **Success check:** the demo URL loads from an unauthenticated browser/network path and is
   interactive; `README.md`'s pending-demo note is replaced with the real link (and screenshots, if
   captured).

**Done when** (mirrors issue #35): the demo URL is publicly browsable, and the committed
`apps/web/src/generated` snapshot matches the seed output.

---

## Workstream F — Eventbrite sandbox verification (issue #79)

The Eventbrite adapter ships verified against hand-authored synthetic fixtures
(`functions/src/ticketing/providers/__fixtures__/`) written to Eventbrite's *documented* schemas,
not captured from a live account — that fixtures README says so explicitly and names six numbered
judgment calls the adapter's module doc also numbers (signing header/scheme, delivery-id
derivation, `api_url` resource shape, `order.refunded` folding, the "complete" signal, and
`registerWebhook`'s org-discovery call). This workstream is what confirms or corrects those six
against reality. It needs no relationship to Workstream E beyond both being M5 operator follow-ups
— it runs against a normal dev deployment, not the demo project.

1. **[HUMAN] Create an Eventbrite account with a test/sandbox event.** Free tier is fine; the goal
   is an event this workstream can place, refund, and cancel real orders against without touching a
   real one. Note the event's numeric id (`EVENT_TICKETING_EVENT_ID`) and generate an API token
   (`TICKETING_API_TOKEN`) from the account's API keys page.
   **Success check:** the sandbox event exists in the Eventbrite account and both values are in
   hand.

2. **[AGENT] Register the webhook against a dev deployment.** Not the demo project from Workstream
   E (that one's `EVENT_TICKETING_PROVIDER` is `none`) — use an existing dev/staging client
   deployment (e.g. the same `runofshow-dev` environment Workstream C provisions Postmark against,
   if that naming is still in use) with `EVENT_TICKETING_PROVIDER=eventbrite` and this sandbox
   event's id and token set (`docs/CLIENT_ONBOARDING.md` §3 item 5's `eventbrite` row):
   ```sh
   EVENT_TICKETING_PROVIDER=eventbrite EVENT_TICKETING_EVENT_ID=<sandbox event id> \
   TICKETING_API_TOKEN=<from step 1> TICKETING_WEBHOOK_SECRET=<generate one, store it like
     EMAIL_WEBHOOK_BASIC_AUTH in Workstream C step 4b> \
   EVENT_FIREBASE_PROJECT_ID=<dev project id> \
     node scripts/register-ticketing-webhook.cjs
   ```
   **Success check:** the script exits 0 (registered); confirm via `getTicketingStatus` (admin
   Settings) or the Cloud Functions log for the registration call, per
   `docs/CLIENT_ONBOARDING.md` §3 item 5.

3. **[AGENT] Exercise order placed / refunded / cancelled end to end.** Through the sandbox event's
   real Eventbrite checkout flow (or Eventbrite's own test-order tooling if the sandbox account
   offers one): place an order, then refund one, then cancel one — three separate deliveries so all
   three actionable webhook actions actually fire against the registered callback, not just
   `order.placed`. Confirm each one lands: a `ticket_sync_queue` row is created and processed, and
   the resulting ticket/entitlement state in the dev project's Firestore matches what the order
   actually did (placed → entitled, refunded → revoked, cancelled → revoked).
   **Success check:** all three flows produce the expected end state, observable in the dev
   project's admin Ticketing tab or directly in Firestore.

4. **[AGENT] Capture real payloads and sanitize them before they leave the sandbox account.** Pull
   the raw webhook delivery bodies and the `GET /orders/{id}/` responses your dev project actually
   received (Cloud Functions logs, or the ticketing sync queue rows the deliveries produced) for
   each of the three flows. Before these payloads touch this repo or any doc:
   - **Strip every real identifier.** Attendee/organizer names, email addresses, the sandbox
     Eventbrite account's organization name and id, real order/ticket numeric ids, phone numbers,
     and any free-text fields (order notes, custom question answers) a real person could have typed
     — replace each with an obviously-fake placeholder in the same shape (a fake name, a
     `@example.org` address, a renumbered id sequence), not with `[REDACTED]` blocks that would
     break the JSON's field-shape value for testing.
   - **Keep the shape, not the content.** The entire point of this capture is confirming field
     *names*, *nesting*, and *types* match what the synthetic fixtures assumed — sanitizing values
     while preserving structure is what makes the diff in step 5 meaningful. Do not summarize or
     restructure the payload; sanitize in place.
   - **Never commit an unsanitized payload, even temporarily** — sanitize before the first `git add`,
     not after, and don't paste an unsanitized payload into this doc's results section either (same
     rule this doc already states for tokens/passwords).
   - **Mark every fixture file clearly as sanitized-real, distinct from the existing synthetic
     ones.** The existing `__fixtures__/README.md` header says "hand-authored synthetic JSON... none
     of it was captured from a real Eventbrite account" — that sentence stops being true the moment
     a sanitized-real fixture is added, so it needs updating, and each new file's provenance must be
     unambiguous at a glance. Concretely: a `-sanitized` suffix on new/replacement filenames (e.g.
     `webhook-order-placed-sanitized.json`) and a one-line header comment or a new README table
     column stating "captured from a real Eventbrite sandbox delivery on <date>, values sanitized"
     — so nobody six months from now mistakes a sanitized-real fixture for the original
     documentation-derived synthetic one, or vice versa.
   **Success check:** sanitized payloads exist locally for all three flows, each one visibly marked
   with its provenance, and a second read-through finds no real name/email/org-identifying value
   left in any of them.

5. **[AGENT] Compare against the committed synthetic fixtures; update in a PR if shapes drifted.**
   Diff the sanitized captures against the matching files in
   `functions/src/ticketing/providers/__fixtures__/` field by field, specifically checking the six
   numbered assumptions from the adapter's module doc and the fixtures README (signing header name
   and scheme, delivery-id stability across retries, `api_url`'s resource path for `attendee.*`
   deliveries, whether `order.refunded` really has no distinct webhook action in practice, what
   signals order completeness, and whether `registerWebhook`'s org-discovery call still holds for
   this account). **This repo's changes go through a normal PR, not a direct push to this branch**
   — this workstream's file edits belong in `functions/src/ticketing/providers/__fixtures__/` (and,
   if a fixture's assumed shape was wrong, the adapter code and its module-doc comments in
   `functions/src/ticketing/providers/eventbrite.cjs` plus the affected tests) on a separate branch
   with its own PR, same as any other code change — this doc's "sole file I edit" instruction is
   specific to this handoff document, not a license to push fixture/adapter changes straight to
   `main` or this branch.
   **Success check:** each of the six numbered assumptions has an explicit written verdict
   (confirmed / corrected, with what changed) recorded in the results section below; if any fixture
   or adapter code changed, a PR is open with that diff and this doc's results section links it.

**Done when** (mirrors issue #79): the real sandbox run has produced a written verdict — confirmed
or corrected — on each of the six numbered API-shape assumptions, and any resulting fixture/adapter
changes are in an open (or merged) PR.

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
- [x] Domain is `eventrunner.org` (superseding `runofshow.net` above — see issue #98's verified
      source of truth). DKIM TXT record added and visible in Cloudflare: yes
- [x] Return-Path CNAME added, confirmed "DNS only" (not proxied): yes — `pm-bounces.eventrunner.org`
- [x] DMARC TXT record added: yes
- [x] Inbound forwarding for `info@eventrunner.org` set up: yes, via Cloudflare Email Routing,
      forwarding to the maintainer's real inbox (`amditisj@montclair.edu`) — this is the inbound
      side, entirely separate from Postmark's outbound-only sending; see issue #91 for the
      live-sending cutover once Postmark approves the account.

### Workstream C
- [x] Postmark Server `Event Runner` created for the `eventrunner.org` sender domain (issue #98's
      verified source of truth). Plan tier and Server capacity: not yet recorded here — see issue #91.
- [ ] `EMAIL_PROVIDER_API_KEY` stored as a GitHub Environment secret at: (name the environment, not
      the value) and mirrored to Secret Manager at project: (project id) — pending, see issue #91.
      `EMAIL_ACCOUNT_API_KEY` (the Postmark account token) confirmed in operator storage only, never
      a deployment's GitHub Environment or Secret Manager: yes, per issue #98's verified source of
      truth ("Postmark account token remains operator-only"; "application deployments receive only
      their Server token").
- [ ] `verify-sender-domain.cjs` output: (paste exit code and summary line, not any secret)
- [ ] SPF line in that output (informational only — any value is fine when DKIM and Return-Path
      pass; no SPF record to publish): (paste the SPF verdict)
- [ ] Delivery webhook registered with triggers Delivery/Bounce/SpamComplaint: yes/no
- [ ] Round-trip test (send + bounce) confirmed via `sent_emails` row: yes/no

### Workstream D
- [ ] Repo renamed `run-of-show` → `eventrunner` under `CenterCoopMedia` (no org change): yes/no
- [ ] Local clone remotes updated: yes/no
- [ ] Prose/doc repo-URL references updated in the seven listed files (grep confirms none
      remain): yes/no
- [ ] Demo rebuilt with `--base /eventrunner/demo/` and `docs/demo/` committed: yes/no
- [ ] Old repo URL redirects: yes/no
- [ ] Pages serves at `centercoopmedia.github.io/eventrunner/`: yes/no
- [ ] Demo loads at `centercoopmedia.github.io/eventrunner/demo/`: yes/no
- [ ] PR #90 still open and attached at the new repo URL: yes/no

### Workstream E
- [x] Demo GCP/Firebase project created with a delimited `demo` project id; billing enabled: yes —
      `eventrunner-demo`, same billing account as CCM, Firebase added.
- [x] Demo configured as a client (GitHub Environment name, providers used —
      console/none/Postmark stream, ticketing none/manual, notifier none): GitHub Environment
      `demo`; `EVENT_EMAIL_PROVIDER=console`, `EVENT_TICKETING_PROVIDER=none`,
      `EVENT_OPERATOR_NOTIFIER=none`, site publisher off for the first deployment; restricted to
      deployments from `main`.
- [ ] Bootstrap dispatch green: not yet run — see "Remaining steps for issue #35" below.
- [ ] `init-event.cjs` + `seed-demo-event.cjs` run against the demo project: not yet run.
- [ ] `generate-content.cjs --demo --check` exits 0 (committed snapshot matches seed output): not
      yet run (both scripts read the same `scripts/lib/demo-event.cjs` fixture by construction, so
      this should already hold once step above runs — this only confirms it).

**Remaining steps for issue #35** (issue #35 stays open on GitHub; this is a progress note, not a
closing record):

Already done, per the 2026-08-26 progress comment on issue #35: the `eventrunner-demo` project,
Firestore/Hosting/Storage/web-app registration, Google sign-in with support email
`info@eventrunner.org`, authorized Auth domains, and 19 non-secret `demo` environment variables.

Two things unblocked since that comment: issue #101 (the config validator wrongly required
`measurementId` when Analytics is off — confirm it's merged before the bootstrap dispatch below,
or the functions deploy may fail validation) and the WIF binding (intentionally deferred until the
repo rename landed — #97 has since merged as `CenterCoopMedia/eventrunner`, so the trust condition
can now target `repo:CenterCoopMedia/eventrunner:ref:refs/heads/main`).

What's left, in order:

1. Configure WIF and the per-client deploy service account (`docs/DEPLOY_RUNBOOK.md` §1–§2),
   trust condition `assertion.repository == 'CenterCoopMedia/eventrunner'`, `--project=eventrunner-demo`.
2. Run the bootstrap dispatch of `deploy-client.yml` against `demo` (provision + functions only);
   confirm green.
3. Seed content with [`docs/examples/demo-answers.json`](../examples/demo-answers.json) as the
   `--answers` file:
   ```sh
   export GOOGLE_APPLICATION_CREDENTIALS=<operator ADC, one-time>
   export EVENT_FIREBASE_PROJECT_ID=eventrunner-demo
   node scripts/init-event.cjs --answers docs/examples/demo-answers.json --admin <operator-admin@ccm-domain>
   node scripts/seed-demo-event.cjs
   ```
   Pass the real first-admin address as `--admin` — it wins over the template's placeholder
   `adminEmails` entry.
4. Confirm `node scripts/generate-content.cjs --demo --check` exits 0 (should already hold by
   construction; this step confirms it, not fixes a drift).
5. Readiness gate: attest Google sign-in (`init-event.cjs --attest-auth`) and the sender domain
   (`verify-sender-domain.cjs --attest`, since `console` has no domain API to check), skim and clear
   `legal.reviewRequired`, grant a second admin, then re-run `init-event.cjs --check` until it
   exits 0.
6. Go live: run the normal dispatch (`deploy-client.yml` against `demo`) and confirm `smoke` passes.
7. Confirm the demo URL loads from a machine with no special access, then open a normal PR adding
   the demo URL and screenshots to `README.md`. Optionally add `demo` to
   `AUTO_DEPLOY_ENVIRONMENTS` (`docs/DEPLOY_RUNBOOK.md` §4).
8. Issue #35 itself is closed by whoever files that PR, once the demo URL is publicly browsable and
   `generate-content.cjs --demo --check` passes — not by this document.

Postmark upgrade path (optional, not blocking issue #35): per issues #91/#100, the demo stays on
`EVENT_EMAIL_PROVIDER=console` until Postmark approves live sending. Once approved,
[`docs/POSTMARK_PROVISIONING.md`](../POSTMARK_PROVISIONING.md) §7 covers switching the demo to a
real Postmark stream so a prospect can see a real OTP email — an upgrade, not a requirement for
closing #35.
- [ ] Readiness gate (`init-event.cjs --check`) exits 0: yes/no
- [ ] Normal dispatch succeeded, smoke passed: yes/no
- [ ] Demo URL confirmed publicly browsable from an unauthenticated path: yes/no (URL)
- [ ] README's pending demo-link/screenshots note replaced (PR link): yes/no
- [ ] Added to `AUTO_DEPLOY_ENVIRONMENTS` (optional): yes/no

### Workstream F
- [ ] Eventbrite sandbox account + test event created: yes/no
- [ ] Webhook registered via `register-ticketing-webhook.cjs` against a dev deployment
      (environment/project used): (fill in)
- [ ] Order placed / refunded / cancelled exercised end to end, each confirmed in Firestore/admin
      Ticketing tab: yes/no
- [ ] Payloads captured and sanitized (no real names/emails/org identifiers remain), filed as
      `-sanitized` fixtures with provenance noted: yes/no
- [ ] Verdict on each of the six numbered assumptions (signing header/scheme, delivery-id
      stability, `api_url` shape for `attendee.*`, `order.refunded` folding, completeness signal,
      `registerWebhook` org discovery): confirmed/corrected — (one line each)
- [ ] Fixture/adapter PR opened (if any drift found): yes/no (PR link)

### Anything blocked
List anything that couldn't be completed and why (e.g. waiting on human 2FA, waiting on counsel,
DNS not yet propagated, Postmark plan doesn't cover Server count).
