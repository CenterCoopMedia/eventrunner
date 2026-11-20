# Two-event shared-host rehearsal

This plan covers [#1063](https://github.com/CenterCoopMedia/eventrunner/issues/1063) and the original [#560](https://github.com/CenterCoopMedia/eventrunner/issues/560) gates. The coordinator selected the test hostname on November 18, 2026. The rehearsal, provider changes and rollout require separate authorization. Prefix hosting stays closed to customer onboarding until #560 passes.

## Environment

| Fixture | Console organization and application | GitHub environment and Firebase project/site | Standalone address → mounted address |
| --- | --- | --- | --- |
| A | Rehearsal organization, `1qF07BkyIzliqjpsna7n` | `rehearsal-nov4`, `er-rehearsal-nov4` | `https://rehearsal-nov4.eventrunner.org/` → `https://er1063-rehearsal.eventrunner.org/conference/` |
| B | EventRunner fresh build test, `fresh-nov11-ae21` | `fresh-nov11-ae21`, `er-fresh-nov11-ae21` | `https://fresh-nov11-ae21.eventrunner.org/` → `https://er1063-rehearsal.eventrunner.org/events/workshop/` |

The fixed origins are `https://er-rehearsal-nov4.web.app` and `https://er-fresh-nov11-ae21.web.app`. Their Firebase Hosting config reports `er-rehearsal-nov4.firebaseapp.com` and `er-fresh-nov11-ae21.firebaseapp.com` for Auth. Both projects use `us-central1` for functions. Compare the deployed SDK config to those values before testing the popup.

On November 18, 2026, a read-only inventory matched each Console application's organization and ready status to its environment owner ID. Both Hosting origins served distinct project IDs. A's latest Hosting release was `1794420979291000`, version `41443b761d4b5177` at 18:16:19Z on November 11. B's was `1794431531070000`, version `70957c593bf4a0e6` at 21:12:11Z on November 11. Refresh those release receipts before a future run.

A's completed Console build predates resource recording and lacks the `resources` map. Enrollment and address sync require its project, site, environment and domain. Archive and restore also need the region. Of three build records, one lacks the map and belongs to this test organization. The source started recording the map in [07c7b109](https://github.com/CenterCoopMedia/eventrunner/commit/07c7b1091674518b26a2b2a332746c66944a6ee3) on November 5, 2026 Eastern. The first extant record with all four address-sync fields started November 11 at 19:22:41Z. Signup test (delete after) has no application, and the `demo` environment has no Console application owner. Keep A and B. Reuse the existing organizations and requests.

| Boundary | Responsible operator |
| --- | --- |
| Host authority | Center for Cooperative Media (CCM) release coordinator. Record the Cloudflare zone and authority receipt `er1063/host-authority`. Each event organization Owner approves their exact base with their own Console session. |
| DNS, router and TLS | CCM Cloudflare zone administrator. Attach the exact hostname as a Custom Domain on the isolated `er1063-client-host` Worker. Cloudflare creates its DNS record and manages its certificate. DNS selects the host, and the Worker selects the complete path. |
| Hosting origins, event variables and deploys | CCM Firebase and release operators with access to the two existing test projects and the corresponding GitHub environments. Keep each project's fixed `.web.app` origin, runtime and publisher identity. |
| Provider configuration | Each test project's Firebase Auth/App Check operator and the existing Google OAuth, mail, and ticket test operators. Record consent, approved synthetic accounts and capture boundaries before use. |
| Route projection | CCM Console and provisioning operators write the dedicated Google Cloud Storage bucket. The Worker reads the public projection over HTTPS and needs only the bucket name. |

## Resources and removal

Verify claimed names in their owning dashboards before creation. The test hostname returned NXDOMAIN and the repository route-map variable was absent on November 18. A missing public object alone cannot establish bucket availability. Use the values below in the later approved rehearsal only.

| Resource or setting | Exact value and operator | Reversal |
| --- | --- | --- |
| A's build resources | Console data operator seeds only `console_builds/1qF07BkyIzliqjpsna7n.resources` with `projectId=er-rehearsal-nov4`, `site=er-rehearsal-nov4`, `environment=rehearsal-nov4`, `domain=rehearsal-nov4.eventrunner.org`, `region=us-central1`. Dry-run the patch against the build document update time and absence of the map. Cross-check the environment owner ID, project, site and function region, public DNS and Hosting release. Apply a field-mask update with the same update-time precondition, then read back all five fields. | Reversible before enrollment if the document is unchanged. Retain reconciled resource identity after enrollment. |
| Isolated edge service | CCM edge operator creates `er1063-client-host` with repo entry `console/functions/client-host-worker.mjs`, a plain string `CLIENT_ROUTE_MAP_BUCKET=er1063-public-route-maps`, and the exact Custom Domain `er1063-rehearsal.eventrunner.org`. Use no reserved-path service binding on the empty test hostname. Disable its `.workers.dev` route and preview URLs. | Reversible. Detach the Custom Domain and confirm removal of its generated DNS/certificate association. Delete only this Worker and its test rules. |
| Ingress and cache | Create a cache bypass for `http.host eq "er1063-rehearsal.eventrunner.org"`. Create the raw-path rejection rule in step 2 before making the mount public. | Reversible. Remove the two rules after detaching the test hostname. |
| Rehearsal fault rules | CCM edge operator stages a temporary block on `http.host eq "er1063-rehearsal.eventrunner.org" and http.request.uri.path eq "/conference/" and http.request.method in {"GET" "HEAD"}` for the post-release failure. Step 8 uses a temporary Worker fault revision confined to the two exact paths stated there. | Reversible. Remove the block before reverting the A address. Restore the known good Worker revision as soon as the two origin probes finish. |
| Public projection | CCM cloud operator creates a dedicated empty `gs://er1063-public-route-maps` in the approved Console service project. The only planned object is `er1063-rehearsal.eventrunner.org.json`. Grant public object reads on this dedicated bucket and object read/write to the Console runtime and provisioning/decommission identities used by their workflows. Set `CONSOLE_CLIENT_ROUTE_MAP_BUCKET=er1063-public-route-maps` for those workflows, with the Console deployment picking up the same value. The bucket contains only the public projection. | Reversible after Console and edge readers stop. Remove the setting and redeploy the affected Console configuration, revoke access, then delete the test object and bucket if dedicated and empty. Stop if public read policy prevents this dedicated bucket from working. |
| Per-project Auth and CORS | Neither Firebase Auth allowlist currently includes `er1063-rehearsal.eventrunner.org`. Add that hostname to both. The deploy operator adds origin `https://er1063-rehearsal.eventrunner.org` to `EVENT_ALLOWED_ORIGINS` in each test environment alongside its existing standalone and fixed origins. The address sync preserves all three. Retain each project's Auth domain and `https://<project>.firebaseapp.com/__/auth/handler` OAuth callback. | Reversible. After both standalone rollbacks remove only the rehearsal hostname/origin from both allowlists, redeploy affected runtime configuration, and verify standalone sign-in. |
| App Check and popup | Both test environments currently show `EVENT_APP_CHECK_ENFORCED=false` and no environment App Check site key. In B, use an approved synthetic Firebase web app registration, authorize `er1063-rehearsal.eventrunner.org`, `fresh-nov11-ae21.eventrunner.org` and `er-fresh-nov11-ae21.web.app` in the App Check provider's domain restrictions, and set `VITE_FIREBASE_APP_CHECK_SITE_KEY` to its site key. After attestation works, prove enforcement with `EVENT_APP_CHECK_ENFORCED=true`. A's Google provider is enabled. B has no Google provider configuration. Its provider operator enables Google for B with an approved synthetic OAuth client and callback `https://er-fresh-nov11-ae21.firebaseapp.com/__/auth/handler`. Use approved existing synthetic Google identities. | Reversible. Restore the recorded provider and build settings after the exercise. Keep any pre-existing enforcement enabled throughout. Calendar consent requires separate approval. |
| CMS publisher | Both environments have `EVENT_SITE_PUBLISHER_ENABLED=false`, and readback found no publisher job or dedicated runtime account on either. Enable the publisher in B for the CMS Hosting republish. Use [deploy runbook §9.1](../../docs/DEPLOY_RUNBOOK.md#91-one-time-setup-per-client) with `GCP_PROJECT_ID=er-fresh-nov11-ae21`, `CLIENT_ENV=fresh-nov11-ae21`, `EVENT_PUBLISHER_SERVICE_ACCOUNT=site-publisher@er-fresh-nov11-ae21.iam.gserviceaccount.com` and `EVENT_SITE_PUBLISHER_ENABLED=true`. The GCP and release operators own the job and its scoped grants. | Reversible. Finish or cancel B's queued fixture publications, restore the flag and deploy standalone configuration before removing the rehearsal job and grants. Preserve shared APIs and any non-rehearsal resources. |
| B's Stripe deploy binding | The B environment selects Stripe test mode. The current Deploy workflow reads `secrets.EVENT_STRIPE_ACCOUNT_ID`, and no corresponding repository or B environment secret metadata exists. The existing test account identity must be bound privately to that exact B environment by the release/Stripe operator before a root or mounted deploy. Verify the metadata and Deploy's validate-env job. Checkout tests use the fake provider. | Reversible. Remove the new binding only when returning to a recorded compatible baseline permits it. Keep the proven test binding if current deployments still need it. |
| Mail and payment boundary | Both environments currently select `postmark`. The email-code and signed-email-link steps require an approved non-delivery boundary for the existing event functions, with code/link output accessible privately to an operator. The existing console provider and `E2E_MAIL_FILE` demonstrate the emulator path, and the console provider can write message bodies to logs. Use hosted fake evidence while a deployed capture-only boundary is unavailable. For checkout use the existing fake Stripe client rather than a live account. | Pending approval. No transport, key, account, or payment change is part of preparation. Remove any approved temporary capture configuration and delete synthetic captures after verification. |
| Temporary legacy addresses | CCM edge operator stages separate reversible rules for `rehearsal-nov4.eventrunner.org` and `fresh-nov11-ae21.eventrunner.org`. Both currently use DNS-only CNAMEs to their fixed origins. Use proxied DNS only with a validated edge certificate and Full (strict) origin TLS for those exact hosts. See step 2 for rule values. | Disable each redirect first during rollback. At cleanup restore DNS-only CNAMEs to the original `.web.app` hosts and verify them over HTTPS. |
| Mount and fixture content | Console operator reserves `/conference` and `/events/workshop` for the original applications. The event operators use a public page `/rehearsal-details`, one distinct published update per project and synthetic fixture users, messages, RSVP/ticket records and suppressions scoped to the two projects. Use the approved existing membership; any missing synthetic roles/records require the two Owners' approval. | Remove the routes and restore changed content and provider settings. The immutable slug reservations and enrollment audit records intentionally persist. Use existing fixture cleanup functions for test data. |

## Ordered procedure

Record each step in the rehearsal receipt with UTC times, identity, expected and observed result, and recovery taken. Run hydrated browser checks in the operator's approved browser session outside a Codex sandbox. Hosted CI runs source tests and builds. Use the scripts from the reviewed checkout with Node 22. Any unexpected result stops the current step and invokes its recovery. Pause concurrent deployments and publisher jobs only for the affected fixture while applying or rolling back its address.

### 1. Verify identity and prepare the baseline

- In Console **Review**, open each request and verify its organization, Owner, completed build, project/site and deployment environment. Capture authenticated consent later in step 3. For A, verify the approved resource backfill and its readback before continuing.
- In Firebase **Hosting → Release history**, record both exact current release and version IDs and corresponding hosted Deploy run URLs and source SHAs. Export only approved synthetic fixtures. Inventory host, public page, admin, speaker, unsubscribe, welcome, reminder, ticket and return URLs, including old emailed links. Record the current URL variables, provider allowlists, metadata revisions and both DNS targets. Verify each baseline `/signin` and `/unsubscribe?test=1` at its standalone host before changing any provider setting.
- Create or confirm the page **Rehearsal details** at stored path `/rehearsal-details` and one published update with a distinct heading in each site. Capture the update ID and title as `UPDATE_A`, `TITLE_A`, `UPDATE_B`, `TITLE_B`. Record the original CMS values. Use the existing public heading and publish controls, with approval for synthetic records. Confirm the release baseline and ordinary root-host regression with the browser commands in step 5 using `root` in place of `mounted`.
- Record the hosted CI gate and the web-build mount fixture for the exact source. Source baseline for routing is `eaf13609f1d5ff8f7a4202239d1dede4727daad4`. Record the actual later Worker/Console/Deploy source and dependencies and the static HashRouter demo readback. #96's root-host receipt is historical evidence.

**Expect** two completed existing applications with matching distinct identities and two working root builds. **Recover** by skipping all writes if identity or baseline differs. Restore any changed fixture content from its recorded original.

### 2. Prepare edge, TLS, projection and provider settings

- In the approved hosted release environment use Node 22.23.5, as pinned in `.nvmrc`. Install the repo's locked dependencies using `npm run prepare:functions` and `npm ci`. Save the following configuration as `wrangler.er1063.toml` in the checkout root.

  ```toml
  name = "er1063-client-host"
  main = "console/functions/client-host-worker.mjs"
  compatibility_date = "2026-11-18"
  workers_dev = false
  preview_urls = false
  routes = [{ pattern = "er1063-rehearsal.eventrunner.org", custom_domain = true }]

  [vars]
  CLIENT_ROUTE_MAP_BUCKET = "er1063-public-route-maps"
  ```

  Bootstrap Wrangler 4.160.1 with `npx` from a temporary directory outside the checkout. This keeps the repository lockfile untouched. The npm cutoff keeps dependency resolution within the versions available after that release on November 11, 2026. Record the emitted CLI version in the browser/proxy receipt. [Pinned Wrangler release](https://www.npmjs.com/package/wrangler/v/4.160.1) · [npm resolution cutoff](https://docs.npmjs.com/cli/v10/using-npm/config#before)

  ```sh
  ER1063_CHECKOUT="$PWD"
  ER1063_TOOLS="$(mktemp -d)"
  (
    set -e
    cd "$ER1063_TOOLS"
    export npm_config_before=2026-11-11T16:00:00Z
    npx --yes wrangler@4.160.1 --version
    npx --yes wrangler@4.160.1 deploy --cwd "$ER1063_CHECKOUT" --config wrangler.er1063.toml
  )
  ```

  Verify the Worker deployment ID, public DNS and verified TLS with `curl --silent --show-error --output /dev/null --write-out '%{http_code} %{ssl_verify_result}\n' https://er1063-rehearsal.eventrunner.org/`. Before enrollment a missing map can return 404. The TLS result must be 0.
- In Cloudflare **Security → WAF → Custom rules**, block the expression below for this ASCII-only fixture host. The conservative percent check leaves encoded query values alone. Customer ingress must preserve supported encoded path characters and enforce the router's precise [raw-path contract](CLIENT_HOST_ROUTING.md). Verify any custom rules before allowing paths.

  ```text
  (http.host eq "er1063-rehearsal.eventrunner.org" and
   (raw.http.request.uri.path contains "%" or
    raw.http.request.uri.path contains "//" or
    raw.http.request.uri.path contains "\\" or
    raw.http.request.uri.path contains "/./" or
    raw.http.request.uri.path contains "/../" or
    ends_with(raw.http.request.uri.path, "/.") or
    ends_with(raw.http.request.uri.path, "/..")))
  ```

- Apply the dedicated bucket and Console configuration above. Verify the live Console has no enrolled production host depending on a different bucket before setting the repository value or dispatching **Deploy console**. In each Firebase project use **Authentication → Settings → Authorized domains** for the hostname and **App Check → Apps** plus the provider console for domain restrictions. Apply B's publisher and approved Stripe test binding. With the public URL variables still set to standalone, dispatch `gh workflow run deploy.yml --repo CenterCoopMedia/eventrunner --ref main -f client="$CLIENT_ENV"` for each test environment. Check deploy smoke, the exact Auth domain and OAuth handler URI, then use `node scripts/dev/client-host-rehearsal.cjs cors a` and `cors b` before publication. Re-record both root Hosting releases for rollback. Keep the shared host's `/__/auth/handler` on the host fallback (404 on this fixture). A path selects no OAuth provider.
- For legacy custom addresses, in **DNS → Records** retain each CNAME target and stage the proxied setting only after confirming compatible edge and origin certificates. In **Rules → Redirect Rules**, stage a temporary 302 rule per old hostname. Match its exact hostname and GET or HEAD, excluding `/unsubscribe`, `/__/…` and `/.well-known/…`. Dynamic targets are `concat("https://er1063-rehearsal.eventrunner.org/conference", http.request.uri.path)` and `concat("https://er1063-rehearsal.eventrunner.org/events/workshop", http.request.uri.path)`. Preserve query strings. Keep the rules disabled until that event's mounted Hosting release. Old unsubscribe requests keep their existing Hosting rewrite and same-project handler. Never attach a redirect to a fixed `.web.app` origin.

**Expect** valid HTTPS, exact host-only ingress controls and unchanged root-site behavior. **Recover** by disabling test rules and restoring the exact baseline settings if DNS, TLS, provider or root smoke checks fail. If the old addresses cannot be safely proxied, obtain approval for a separately hosted notice on those custom aliases before cutting over. Keep the fixed origins dedicated to the router's upstream and recovery.

[Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) · [Raw request path](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/raw.http.request.uri.path/) · [Firebase Google popup](https://firebase.google.com/docs/auth/web/google-signin) · [Firebase App Check](https://firebase.google.com/docs/app-check/web/recaptcha-provider)

### 3. Record consent and enroll

In each authenticated Owner session, call HTTPS `POST /api/consentEventMount` with JSON `{"appId":"<application>","orgId":"<its organization>","publicBase":"<exact mounted address>","confirm":true}`. Use the Console session's Firebase ID token in memory, as the [Console API client](../web/src/api.js) does. Run each request from the approved Console origin and retain only status, application and confirmed base. Obtain the exact organization ID from the authenticated Console request. Never paste credentials into a command, log, or receipt.

As Console operator, call `POST /api/manageEventMount` using the same authenticated request contract. Use `{"action":"enroll","appId":"<application>","publicBase":"<exact mounted address>","confirmAuthority":true,"authorityReference":"er1063/host-authority"}` for A, then `{"action":"enroll","appId":"<application>","publicBase":"<exact mounted address>"}` for B. Use `{"action":"get","appId":"<application>"}` to verify each private record after the action. Compare each event's project, immutable mount and fixed origin. Record the second enrollment's returned map version in `MAP_VERSION` and run:

```sh
node scripts/dev/client-host-rehearsal.cjs edge empty "$MAP_VERSION"
```

**Expect** two enrollments and an empty public index with both mounts returning 404. A malformed base or prefix overlap fails validation with no route change. **Recover** by re-reading the records and projection after a non-200 response. Fix the cause before repeating an identical action. An unsuccessful readback can follow a committed registry update.

### 4. Rehearse the cutover windows and both recovery boundaries

Rehearse A, then B. Keep all required approvals, open operator sessions, deploy dispatch and rollback commands ready before publication. Start with the repo's ordinary deploy and CMS publisher reading the same public base. The shared base supplies the browser basename, asset base and canonical URLs. The router strips the complete mount once and keeps app-relative Hosting rewrites and original queries. The app sends writes to explicit project function endpoints. The router bypasses shared caching and preserves the event's security and cache headers.

1. Run `POST /api/manageEventMount` as the operator with `{"action":"publish","appId":"<application>","publicBase":"<exact mounted address>","publicTitle":"<approved title>","confirm":true}`. Use **Rehearsal Conference** and **Rehearsal Workshop** for A and B. Record route-map version/time and run `node scripts/dev/client-host-rehearsal.cjs edge staged-a "$MAP_VERSION"` (or `staged-b`). The mount routes, the old root works, and the staged event has no index link or sitemap discovery. The staged event may still serve root-based build references.
2. To exercise **failure before Hosting release**, stop here on A's first pass. Record the unchanged Hosting version and working old root. Call the remove action below and verify the map reverted to empty. If a sync already wrote URL variables or function config, run the rollback sync even if Hosting did not change. Obtain fresh approval or reuse a still-valid exact consent as permitted by the Console, then enroll and publish A again.
3. Immediately dispatch **Actions → Provision client → Run workflow** on `main`, or use `gh workflow run provision-client.yml --repo CenterCoopMedia/eventrunner --ref main -f application_id="$APP_ID" -f sync_event_mount=true` in the authorized release session. The provisioner writes both address inputs, runs **Deploy** for that event only and waits for its hosted result. Record the publish time, Hosting release time and version, public smoke start/finish and applied-address time. The first measured window runs from publication to Hosting release. The second runs from release through smoke and applied-map readback. After release the mount is the visitor address. Enable that event's staged old-host rule at release and verify the old public deep link with `curl --head --silent --show-error https://rehearsal-nov4.eventrunner.org/rehearsal-details` (substitute B's exact alias for B). Expect a 302 to the matching mounted path. Confirm a direct GET/HEAD to that event's fixed Hosting origin receives no redirect through the router.
4. After a successful cutover, read `manageEventMount get` for the applied URL and use the existing read-only Console Firestore session to read `console_client_hosts/er1063-rehearsal.eventrunner.org.revision` (document ID `er1063-rehearsal.eventrunner.org`, field `revision`). Set `MAP_VERSION` to that independently recorded revision. Use `edge only-a "$MAP_VERSION"` after A and `edge both "$MAP_VERSION"` after B. Verify the applied URL, listing, sitemap and fixed origin. Use the same revision readback for restore or sync checks that lack an action response with the version. If the receipt or public smoke fails, stop the next event and use the recovery below.
5. Rehearse **failure after Hosting release** on A while B is mounted and healthy. Roll A back to standalone first, verify `edge only-b`, then re-enroll and publish A. Verify `edge staged-a-with-b`. Enable the temporary block from the resource table before dispatching sync. Record Hosting release success, public smoke failure and the absence of a new applied mounted receipt. Verify B throughout. Remove the test fault rule and roll A back, verify `edge only-b`, then enroll, publish and sync A again and verify `edge both`. A readback-only failure after a successful deploy can be retried with the same sync if the coordinator elects to complete the cutover.

**Rollback one address.** Disable that event's old-host redirect before putting its restored root back in service. As Console operator call `POST /api/manageEventMount` with `{"action":"remove","appId":"<affected application>","confirm":true}`. Verify the returned version at `/.well-known/eventrunner-route-map` and confirm the sibling. Dispatch the same `sync_event_mount` command for that application to restore standalone URL variables and the matching full Deploy including functions/metadata, publisher configuration and Hosting. A before-release abort without any deploy-variable changes needs no redeploy. If the previous public hostname became the shared host, the sync uses the fixed Hosting origin for standalone rollback. Do not reset the whole host map. The route reservation remains tied to its application.

Use the saved Firebase **Hosting → Release history → Roll back** only as an approved recovery during the full paired restore. Coordinate runtime URL, CMS publisher and metadata refresh with it so the next publication cannot restore the mounted bundle. Recovery ends when the standalone address boots and its explicit project functions work, the affected mount gives 404, and the sibling's route, Hosting version and data are unchanged. Reopen only that event's publisher after those readbacks. [Deployment rollback runbook](../../docs/DEPLOY_RUNBOOK.md#8-rolling-back-a-bad-deploy)

### 5. Verify built routes, metadata and CMS publication

```sh
node scripts/dev/client-host-rehearsal.cjs browser a mounted chromium desktop "$UPDATE_A" "$TITLE_A"
node scripts/dev/client-host-rehearsal.cjs browser b mounted webkit phone "$UPDATE_B" "$TITLE_B"
node scripts/dev/client-host-rehearsal.cjs cors a
node scripts/dev/client-host-rehearsal.cjs cors b
```

Run the browser command for both events in both engines with both `desktop` and `phone` forms. The `chromium` leg uses the operator's installed Google Chrome with the sandbox enabled. Chrome and Playwright WebKit exercise the built entry, CMS page and reload, lazy assets, listing links, published update canonical/OG, generic sign-in metadata, noindex, relative manifest scope and icons. Use supported installed Safari on desktop and iPhone Safari for the provider and browser matrix as well. Playwright WebKit mobile emulation supplies additional evidence. Record OS, version and device for each actual run.

In each event open the mounted **Pages** CMS under `/admin/pages` as its test editor. In B use the page link or row for **Rehearsal details**, change its approved marker, choose **Save draft** and **Publish** for that page, then verify the site publisher's generated Hosting release. Direct-load and reload the page, check updated copy and metadata before hydration, and repeat the browser command. The browser requests use the existing release instead of a Vite development server. Check `/<mount>/sitemap.xml` for the updated page and absence of private URLs, and `/robots.txt` at the client root for both mounted exclusions and both sitemap URLs. If the sitemap probe fails, verify that the existing exclusion survives. On a host with an existing fallback record, confirm its reserved-path responses and robots policies byte-for-byte where unchanged.

**Expect** mounted assets and URLs throughout both build paths, metadata sourced from the released template at the fixed origin, no public metadata on account shells, and unsubscribe `no-store` in step 7. **Recover** by restoring the synthetic draft. If the publisher produced an incompatible release or either mount loses its prefix, stop and apply the affected event's address rollback.

### 6. Verify provider and project boundaries

Use Playwright roles/labels or fresh agent-browser element references, with browser recording, tracing and state export disabled. Get references before entering a credential or PIN. Before taking another snapshot, clear just the typed field if it remains present. Record only the request endpoint, response status, header names and result.

On each mount use the **Email address** label and **Email me a code** button after confirming the approved non-delivery boundary. Submit a known incorrect six-digit value once, clear the field, then submit the privately captured valid code with **Sign in**. Verify the browser requests each event's explicit OTP function and the expected CORS response. On configured B compare a valid attestation with the handler's missing-attestation refusal. Real provider evidence requires the actual two hosted projects. A fake provider pass is source evidence.

Use **Continue with Google** for each project's approved synthetic Google account in Safari and Chromium and on the phone. Record the popup's own `.firebaseapp.com` handler and return to the same mount. Block the popup once in the approved browser settings and verify the email-code fallback remains available. Sign in to A as an A editor and to B as a B attendee in the same browser profile. Verify allowed A/B writes using an approved synthetic record and deny privileged B action. For the cross-project check, use approved synthetic speaker accounts in both projects and the read-only `POST https://us-central1-<project>.cloudfunctions.net/getOwnSpeakerProfile` request. Supply the selected fixture's ID token and any required attestation in memory. Verify the two valid same-project responses before swapping only the ID token. Record both token refusals and the corresponding positive controls. Sign out of A using **Sign out** and confirm B retains its own signed-in state.

Check that project-scoped keys, notices, writes and Storage objects affect just the selected event. Use a stale A lazy-chunk request in the approved browser to exercise the namespaced reload flag and verify B's open tab and its session state survive. Inspect service-worker registrations and Cache Storage without recording values. The current app has no service-worker registration. Confirm the mounted entries install no shared-origin worker and that private, sign-in and token routes receive no offline app fallback after warming a public page. Record applicable worker-scope and cache cleanup checks again if the deployed build adds a worker. Both mounts share a browser origin. Separate projects and keys do not isolate untrusted code. Keep calendar permissions gated and use approved external calendar links without granting consent.

**Expect** separate project roles, writes and sign-outs plus the configured provider checks. **Recover** by clearing typed fields, closing the affected browser session, removing synthetic writes and stopping at the first unexpected role, mail or attestation behavior. Missing non-delivery, Google or App Check authority leaves the matching receipt open.

### 7. Verify outbound URLs and unsubscribe

Generate welcome, speaker invite, reminder, ticket and announcement samples through approved fake/capture boundaries. Follow each public or signed link using the corresponding role or label and check its event, scope and query behavior. Verify the signed link opens the proper synthetic record. Compare external map, calendar and registration destinations with the baseline. Run the existing hosted fake checkout contract, including the actual return builder and unsafe external target refusal, then open the synthetic success/cancel returns in each browser with no live charge. Retain only event, link kind, pathname and result.

Use distinct signed fixture recipients for confirmation and RFC 8058 testing, and record baseline suppression absence in both projects. With private links supplied only through stdin, run `node scripts/dev/client-host-rehearsal.cjs unsubscribe a mounted confirm` and repeat for B. In the confirmation page activate the **Unsubscribe** button by role and repeat once. GET must leave the suppression absent and the first POST must set it. Then run `node scripts/dev/client-host-rehearsal.cjs unsubscribe a mounted one-click` on the separate one-click fixture and repeat it once. Run the `invalid` case with the same signed input to test signature refusal. Repeat for B and during the root baseline with `root`. Verify the first suppression timestamp does not change on repeats, both routes send no-store/noindex, and the other project records no suppression. Use the authenticated **Suppressed addresses** operator action for fixture cleanup, or the documented `removeEmailSuppression` API on the original project.

**Expect** canonical mounted links and event-scoped opt-outs, with legacy signed POST requests reaching their original handler. **Recover** by stopping sends and checkout probes, removing synthetic suppressions and capturing safe status-only evidence. Never use a real payment or outbound delivery for this step.

### 8. Verify negative routing, retire and clean up

In an approved HTTP probe session request `/conference-other/`, `/events/workshop-other/`, `/unknown-event/`, `/__/auth/handler` and `/.well-known/nonexistent`. Expect host fallback or 404 with each one kept off the event projects. Use `curl --path-as-is --head --silent --show-error` on these exact test-host paths: `/conference//rehearsal-details`, `/conference/../events/workshop/`, `/conference/%2Frehearsal-details`, `/conference/%5crehearsal-details` and `/conference/%252frehearsal-details`. Expect the raw ingress rule to refuse them before a route is selected. Prove malformed enrollment by submitting a base with a query or empty segment against a synthetic application after saving its current record. The Console must reject it before mutation.

Exercise unavailable origin and redirect loop with the hosted fault fixtures in `console/functions/src/clientHostRouter.test.cjs`. For live ingress evidence, use the separately approved test-only entry [client-host-rehearsal-faults.mjs](../../scripts/dev/client-host-rehearsal-faults.mjs) with the same pinned CLI and scratch directory. First record the reviewed version with `node scripts/client-host-worker-version.cjs capture er1063-client-host` (environment `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`) and keep its `versionId` in the browser/proxy receipt.

```sh
(
  set -e
  cd "$ER1063_TOOLS"
  export npm_config_before=2026-11-11T16:00:00Z
  npx --yes wrangler@4.160.1 deploy scripts/dev/client-host-rehearsal-faults.mjs --cwd "$ER1063_CHECKOUT" --config wrangler.er1063.toml
)
```

Request `/conference/rehearsal-origin-unavailable` and `/conference/rehearsal-origin-loop` on the test hostname using `curl --head --silent --show-error`. Expect 503 on both and a working B. Restore the recorded reviewed version at once with `node scripts/client-host-worker-version.cjs restore er1063-client-host <recorded version id> er1063-rehearsal.eventrunner.org /conference /events/workshop`, then expect 200 on both probe paths and run `edge both <revision>`. Do not use `wrangler rollback` here: it reads the just-uploaded fault version first, which can fail with Cloudflare code 100146 (#1125). Record exact revisions and the fact that these were injected origin responses.

With both addresses healthy, dispatch `gh workflow run decommission-client.yml --repo CenterCoopMedia/eventrunner --ref main -f application_id="$APP_ID" -f mode=archive` for A only after approval. Verify A's mount is retired and absent from discovery, its prior release is recorded, and B still serves. Restore A immediately inside the job's recovery window with the same command using `mode=restore`. Verify its saved route, opening page and preserved data. To finish, roll both addresses back to standalone with step 4, then remove temporary provider and edge changes using the resource table in reverse dependency order. Preserve both projects and original domains.

**Expect** app and edge isolation, safe failure behavior, and verified restore with the sibling unchanged. **Recover** by stopping the exercise, restoring the reviewed Worker immediately after a fault probe, and following that application's archive/restore recovery before changing or deleting any shared resource. Never purge a project to undo an address change.

## Checks and receipts

| #1063 acceptance box | Evidence from the later rehearsal |
| --- | --- |
| 1. Approved identity and ownership | Environment table, authority receipts and exact source, deploy and route-map readbacks in steps 1–4 |
| 2. Two built events, root regression and CMS | Root and mounted browser matrix, both Hosting releases, normal and CMS publish comparison and crawler/manifest results in steps 1 and 5 |
| 3. Sign-in, roles and event state | Per-project popup/code, attestation, token denial, writes, sign-out and cache tests in step 6 |
| 4. Provider settings | Domain, origin and exact Auth handler readbacks in steps 2 and 6 |
| 5. Links, payment returns and opt-outs | Sanitized route receipts, fake checkout and same-event suppression deltas in step 7 |
| 6. Failure isolation | Staged lookup, malformed inputs, fault responses and archive/restore sibling evidence in steps 4 and 8 |
| 7. Operator procedure | Steps 1–8, both timed cutover windows, old-address behavior, recovery before/after release |
| 8. Exact revisions and unrun checks | Three separate files below |

Attach `source-ci` (commit, hosted run, source fixtures and static preview), `browser-proxy` (test host and TLS, Wrangler version, exact Worker/Hosting revisions, route-map version/export time for each phase, browser/device, CMS release, timestamps and before/after recovery) and `provider` (sanitized domain settings, origin checks, synthetic role/callback and capture-boundary evidence). Record which checks remain unrun and who must authorize or supply their prerequisites. Exclude live signed URLs, messages, tokens and personal details. Keep #335, #560 and #1063 open until their execution receipts exist.

During preparation only the inventory and reviewed source changes are available. All browser/proxy, map application, provider, mail capture, cutover, retirement and recovery steps remain unrun.
