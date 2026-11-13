# ADR 0010: Event paths under one client host

**Date:** 2026-11-12  
**Status:** Proposed. Owner acceptance and implementation remain open.  
**Issue:** [#515](https://github.com/CenterCoopMedia/eventrunner/issues/515)  
**Scope:** An optional shared web address for separately deployed events. This record changes no running site, account, DNS record or provider setting.

## Context

A client should be able to use `https://nclocal.eventrunner.org/<event-slug>/`
for successive events. An address change must preserve event data, access,
ticketing and the ability to transfer or retire one event independently.

The source inspected at `3dfa14669462d160be0bfe0f1203de107bdfd364` has these boundaries:

- [ADR 0001](0001-event-platform-v1.md) defines one Firebase project per event.
  [ADR 0007's invoice and signup link amendment](0007-client-console-self-serve-onboarding.md#amendment-2026-11-04-invoice-and-signup-link)
  also makes each second event a separate organization and application. A shared client organization does not exist yet.
- [`scripts/provision-client.cjs`](../../scripts/provision-client.cjs) creates an event's project, Hosting site, provider configuration and deployment environment. `deployVariables` currently sets a root public URL.
- [`main.jsx`](../../apps/web/src/main.jsx) uses BrowserRouter without a basename for ordinary sites and HashRouter for the static demo. [`vite.config.js`](../../apps/web/vite.config.js) does not derive an event mount from the public URL.
- [`firebase.json`](../../firebase.json) routes public metadata and unsubscribe requests to event functions and account/admin routes to the app shell. A catch-all SPA rewrite alone would lose those distinctions.
- [`firebase.js`](../../apps/web/src/firebase.js) binds the bundle to one Firebase project. Browser state is mixed: [`calendarSync.js`](../../apps/web/src/lib/calendarSync.js) includes project identity in its key; [`changeRequestMarker.js`](../../apps/web/src/lib/changeRequestMarker.js) uses only the account UID.

The October URL-prefix plan in [#335](https://github.com/CenterCoopMedia/eventrunner/issues/335)
and children #558–#560 covers a mounted event. It does not supply a client host
registry or a second-event enrollment path.

## Proposed decisions

### 1. Deploy each event separately behind a client router

Keep one build, deployment environment and Firebase project per event. Add a
small edge router for the client host. It maps a complete event mount to that
event's fixed Hosting origin. A Cloudflare Worker is the proposed router;
deployment and account authorization belong to the later operator stage.
[Workers can construct an outbound request with a different URL](https://developers.cloudflare.com/workers/examples/modify-request-property/).

The operator-controlled routing record binds client host, event mount, application
ID, project ID, Hosting origin and lifecycle state. Only validated, explicitly
enrolled targets can be served. Request headers, query parameters and arbitrary
URL values cannot choose the project or upstream. Publishing an event cannot
edit its sibling's route. Update or remove a route independently of event data.

The router strips the selected mount exactly once before requesting Hosting:

| Browser address | Upstream path | Owner |
| --- | --- | --- |
| `/summit-2027/` | `/` | Event app and public metadata |
| `/summit-2027/program` | `/program` | Event public route |
| `/summit-2027/assets/<file>` | `/assets/<file>` | That event's build |
| `/summit-2027/updates/<id>` | `/updates/<id>` | That event's metadata function |
| `/summit-2027/admin` | `/admin` | That event's account and role checks |

Keep query parameters needed by existing signed links; do not log their values.
Forward GET and HEAD. Also forward POST for the exact `<mount>/unsubscribe`
path to that event's fixed origin, preserving its query, body and content type.
The existing [unsubscribe handler](../../functions/src/announcements/suppression.cjs)
owns signature validation and confirmation;
both its confirmation form and RFC 8058 one-click opt-out need POST. Log no
body or token values. Refuse other methods; all other API writes and provider
webhooks keep their explicit event endpoints. Preserve upstream security and
cache headers, including unsubscribe's no-store policy. Do not add a shared
response cache in this first version.
Handle upstream redirects explicitly: accept only an enrolled destination,
translate same-event paths to the public mount and refuse loops or a sibling
event destination. A redirect must never become an arbitrary outbound fetch.

An unknown mount returns 404; an unavailable enrolled origin returns 503 with a
retry message. Neither falls through to another event. A shared host is an
availability dependency, even though each event can still deploy separately.

### 2. Keep event data and provider boundaries

Retain separate Firestore, Storage, Auth, service accounts, secrets, ticketing
configuration and export/retirement operations. Keep [#328](https://github.com/CenterCoopMedia/eventrunner/issues/328)
and [#329](https://github.com/CenterCoopMedia/eventrunner/issues/329) event-scoped.
The router stores no attendee records, tickets or provider credentials.

Do not move collections into a shared project or select an event from an
untrusted browser path inside a privileged handler. A later shared-data model
would require a separate decision and migration.

The Console needs an explicit operator enrollment that groups existing
application IDs under one client host. Record authenticated consent from an
Owner of each event organization and verify authority over that client host.
Keep host, mount and existing web-address name separate: The current name still
identifies the event's project and deployment environment. Declining one draft
must not release a sibling's host or route reservation. Keep the current
single-use signup link, agreement and per-event build. Do not infer common ownership from an email
domain, organization label or the same person signing in. This enrollment is a
proposed extension to ADR 0007, not a claim that its current organization model
already groups events.

### 3. Sign in separately to each event

The Console account remains separate. Attendee accounts, approval and staff
roles remain in each event project. The same email address does not confer
access to another event; signing out of one event does not promise to sign out
of every event. Client-wide SSO is outside this proposal.

Authorize the shared host in each enrolled event's Auth configuration and
`EVENT_ALLOWED_ORIGINS`. Where App Check is configured, add the shared host to
its provider's domain restrictions; do not turn enforcement off to pass a check.
Use hostname values for provider domain lists and the full origin for CORS.
Retain that event's own `authDomain` and provider configuration. Do not route
the shared root `/__/auth/handler` to a project chosen by a query or cookie.
For Google sign-in, use the event's popup flow and verify it on supported
desktop and phone browsers. Firebase documents [popup sign-in as an alternative to redirect sign-in](https://firebase.google.com/docs/auth/web/redirect-best-practices#option_2_switch_to_signinwithpopup),
with a warning that popups can be blocked. A failure must offer the existing
emailed-code route. If redirect sign-in becomes a requirement, specify and
verify an event-specific helper-origin design before enabling it.

Paths on one host share an origin. Separate projects and namespaced keys do
not provide browser security isolation: [origins depend on scheme, host and port](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy#definition_of_an_origin).
Keep all event code operator-controlled. A requirement to run untrusted code
or isolate browser storage between events requires separate hosts instead.

### 4. Use one validated public-base contract

Derive these values once and reuse the existing shared configuration package:

| Value | Example | Use |
| --- | --- | --- |
| Public base | `https://nclocal.eventrunner.org/summit-2027/` | Canonical pages, emails and return links |
| Origin | `https://nclocal.eventrunner.org` | CORS and authorized-domain checks |
| Mount | `/summit-2027` | BrowserRouter basename and edge selection |
| Asset base | `/summit-2027/` | Vite, lazy chunks and public assets |
| API endpoint | The event's explicit function endpoint | Existing authorization and writes |

The mount is immutable once published. Use lowercase slug segments with exact
boundary matching: `/summit-2027-old` cannot match `/summit-2027`. Canonicalize a
bare mount to its trailing-slash home. Reject credentials, query/fragment parts
in the configured base, malformed escapes, dot segments, encoded separators and
ambiguous repeated separators before URL normalization removes that evidence.
Reserve host-level routes, including `/__/`, for the router rather than events.

Apply the same parser and joins to the deploy workflow and CMS publisher. Keep
stored CMS paths app-relative. Include metadata, canonical/OG URLs, manifests,
robots/sitemaps, email/unsubscribe/ticket links and checkout return URLs. The
upstream Hosting rules still see app-relative paths after the router strips the
mount; [Hosting passes the complete forwarded path to a function](https://firebase.google.com/docs/hosting/full-config#direct_requests_to_a_function).
Do not solve this by rewriting all requests to `index.html`.

Namespace application storage, cross-tab messages and cache names by immutable
event project identity, with UID where personal. Reuse project-scoped keys where
they already exist. [ADR 0009](0009-offline-cache-policy.md) owns offline policy;
any worker must stay at the event base, retain its network-only exclusions and
delete only that event's caches. Keep the static HashRouter demo separate.

### 5. Provision each client host explicitly

Choose one managed DNS/edge-host registration per enrolled client, with its
certificate verified before routing traffic. Event paths need no DNS records.
Keep existing docs, Console and demo hosts separate.

A wildcard record would not establish client ownership, select an event or
finish certificate setup. Defer it until measured provisioning volume warrants
that operational change. No DNS or custom-domain setting changes in this ADR.

### 6. Show a public event list at the client root

`https://nclocal.eventrunner.org/` shows only explicitly published event titles
and links, including archives the owner chooses to keep public. It neither
redirects silently to the newest event nor lists draft applications. With no
published events, show an empty state with no private metadata. Do not turn this
page into another account, registration or administration surface.

## Staged delivery and acceptance

1. **Design owner:** Accept or amend this ADR, including the shared-origin
   limit, separate sign-ins and the new Console enrollment. Record acceptance
   on #515 before treating the proposal as approved. A source PR merge alone
   does not record that product decision.
2. **Mount implementation owner, [#558](https://github.com/CenterCoopMedia/eventrunner/issues/558):**
   Build the shared parser and joins, both build paths, router/assets and
   event-scoped browser state. Preserve root deployments and static demos.
3. **Link and metadata owner, [#559](https://github.com/CenterCoopMedia/eventrunner/issues/559):**
   Apply the contract to public and private-route metadata, crawler files,
   emails, unsubscribe and ticket/payment return paths. Preserve no-store and
   publication boundaries.
4. **Client-routing owner, [#560](https://github.com/CenterCoopMedia/eventrunner/issues/560):**
   Extend that issue's proxy/operator acceptance to cover the explicit client
   enrollment, host registry, public root, routing lifecycle and per-project
   sign-in checks above. The operator owns each event's Auth authorized domains,
   App Check domain restrictions and `EVENT_ALLOWED_ORIGINS` changes, including
   retaining the rollback origins. Decompose within that existing chain if needed;
   application and registry writes must use existing authorization checks.
5. **Operator:** Rehearse two synthetic events at one approved test host. Verify
   root, `/conference` and a multi-segment mount, deep-link reloads, lazy assets,
   metadata and a CMS republish. Verify token rejection across projects and
   that normal event writes and cache/storage cleanup target only that event.
   This does not establish browser-origin isolation. Exercise popup/code
   sign-in, sign-out and offline exclusions in supported Safari and Chromium.
   Check unknown/retired mounts, upstream failures, redirects and query-bearing
   signed links. Verify the unsubscribe confirmation form and RFC 8058 one-click
   POST, signed-token refusal and repeated opt-outs against the correct event.
   Use hosted CI for this public repository; no live client data
   or real sends/payments are part of the fixture rehearsal.
6. **Release owner:** Inventory existing public and emailed URLs, then publish
   the reviewed route map and full public base through the approved deployment
   process. Verify HTTPS, crawler output and provider return paths before an
   approved client cutover. Keep original Hosting origins available for rollback;
   avoid an origin-to-public redirect that makes proxy reads loop. Roll back the
   affected route and its matching event build/config together. Do not repoint
   an old event slug to a different event or delete its project to revert a URL.

## Alternatives

- **One runtime and project for every client event:** Would require event-aware
  authorization, data paths, secrets, exports and lifecycle operations. It
  changes the accepted isolation model and is larger than this address feature.
- **Separate subdomains only:** Preserve browser-origin separation and current
  deployment behavior, but do not deliver the requested one-host event paths.
  Keep this as the supported choice when browser isolation is required.
- **DNS or Hosting catch-all alone:** Cannot select arbitrary isolated Hosting
  origins and preserve the event's metadata/account routing without a dispatch
  layer. The proposed edge router makes that selection explicit.

The proposal adds routing and enrollment work; a basename alone does not deliver
several events under one host. Implementation, fixture evidence, owner
acceptance and live rollout remain separate work.
