# ADR 0009: Offline public pages and attendee data

**Date:** 2026-11-12  
**Status:** Proposed implementation contract; records the owner's accepted scope below.  
**Issue:** [#633](https://github.com/CenterCoopMedia/eventrunner/issues/633). Implementation belongs to [#634](https://github.com/CenterCoopMedia/eventrunner/issues/634).

## Context and owner decisions

The owner recorded these answers on November 4 in #633:

| Call | Answer |
| --- | --- |
| Build offline mode? | Yes, for the full event site. |
| Keep attendee data offline? | Yes, using Firestore persistent cache, including the signed-in reader's bookmarks. |
| Keep the attendee's ticket offline? | No. Ticket routes and ticket data stay online only. |

At main `56940cc5`, there is no service worker and `firebase.js` uses memory-only `getFirestore`. Generated public content is compiled into hashed JavaScript; `scripts/lib/emit.cjs` strips publication timestamps. `routeMeta` supplies public navigation HTML. Saving a shell therefore also saves its generated content, but proves neither current logistics nor an atomic published revision. This ADR adds no worker, cache, authentication change or offline write.

## Public shell and installation

Serve a complete saved public shell immediately on an eligible repeat navigation, and check for a new build in the background. Do not hold it behind a network-first timeout. Three or four seconds would show the old page or a blank document without a running page script; no source establishes either number. A cache hit adds no intentional wait or indicator. A first visit without a complete saved build uses the ordinary network path and has no offline promise.

Precache one neutral `index.html`, the transitive JavaScript/CSS graph of the public routes and the read-only My schedule page, its generated public snapshot, favicon/manifest, and the fonts those routes require. Produce an explicit URL manifest from the build graph, excluding admin, ticket/checkout, registration, speaker-profile, attendee-directory and specimen-only chunks. Include My schedule's lazy module and its dependencies explicitly: its code contains no personal records, and the attendee client supplies its data. Shared chunks required by these entries remain included. Do not cache `routeMeta` responses or arbitrary navigation HTML; the neutral shell contains no personal rendered page.

The precache limit is **2,048 KiB (2,097,152 decoded bytes) per build**, including HTML, CSS, fonts and JavaScript. This is a product limit, chosen to bound a venue download while leaving room above the current roughly 1 MiB initial script; it is not a measured offline build size. Measure the full set in #634. A build that cannot fit must reduce its public graph before claiming offline readiness. Do not silently omit a required public chunk or raise this limit.

Begin optional installation after the first page is usable, with one background request at a time; suspend it while the foreground page needs the connection. With Save-Data enabled, wait for the reader's explicit download request. Keep the current page usable if installation fails. Advertise a saved copy only after the complete manifest succeeds. Retain the active build and, while an open client needs it, its preceding build; remove superseded sets when those clients leave. Browser storage may still be evicted.

Images are not part of mandatory installation. Stale-while-revalidate may store only explicitly public, same-origin image/font URLs on the build's allowlist. Bound that optional cache to 64 entries and 8,192 KiB, evicting least-recently-used entries. Signed URLs, credential-bearing responses, opaque responses and Firebase Storage downloads are excluded. Missing images get the ordinary text/placeholder; they do not prevent offline reading. These caps stop an unbounded media cache from consuming the device's storage.

## Routes and the light view

Only published, visible, enabled public routes may receive the saved shell: the home page, schedule/session pages, public speaker and organization pages, public updates and explicitly listed public CMS paths. Generate that allowlist from the public projection; unknown paths use the network. Preserve path, query and fragment when opening the shell.

The following navigation paths, including descendants, are **network only**: `/admin`, `/ticket`, `/tickets`, `/profile`, `/speaker`, `/attendees`, `/schedule/mine`, `/schedule/user/:uid`, `/pitch`, `/registration`, `/signin`, `/unsubscribe` and `/dashboard`. Function endpoints, every non-GET request, material downloads and signed material URLs are never intercepted for caching. Do not infer eligibility from a successful response, filename or request destination. The Console is a different host and registers no worker.

This separates navigation responses from Firestore data. An already-running saved public app may show the signed-in reader's cached bookmarks, including through client-side navigation to My schedule. A direct offline reload of a network-only route cannot use a saved navigation response; enter through the saved public home/schedule instead. Do not promise offline ticket access or a restored private route after sign-out.

[#336](https://github.com/CenterCoopMedia/eventrunner/issues/336) and [#577](https://github.com/CenterCoopMedia/eventrunner/issues/577) retain their separate online-only light-view contract. The worker must bypass the eventual light-route address; `/low-bandwidth` is reserved from its navigation allowlist while that route is being decided. It remains live-source/no-store and never falls back to a generated snapshot. This ADR approves none of its content taxonomy, privacy projections or rollout choices.

## Saved state and age

Always label content served from a saved build or cached Firestore result: **“Saved copy. Updates have not been confirmed.”** Show the device-save time and, separately, the public snapshot's generation time. Add a build id and generation timestamp to the emitted manifest in #634; neither is a publication or live-source check. A device clock is an estimate, not evidence of freshness.

At **five minutes** since a dataset's last confirmed server read, add **“This information may have changed. Check times and locations with event staff.”** Show this warning immediately when the time is missing, invalid or in the future. Five minutes is a conservative product choice for changing event logistics, not an Apple/Firestore rule. Keep the saved content available at greater ages with its warning; never present cached safety or access instructions as verified current, even below five minutes.

Record confirmation per dataset only after its server result arrives. Do not promote one successful query, a shell download, `navigator.onLine` or a worker revalidation into confirmation for every dataset. Firestore listeners include metadata changes and use `fromCache`; restoring connectivity alone does not remove the saved-state wording. A complete public asset set does not establish coherent publication across collections.

## Attendee persistence and shared devices

Ask whether this is a trusted device before enabling personal persistence. A shared-device answer retains memory-only personal reads. Explain that the browser can retain data between visits and that removal is not forensic erasure. Firestore's guidance specifically warns about sensitive data on shared devices ([offline persistence](https://firebase.google.com/docs/firestore/manage-data/enable-offline)).

Use `initializeFirestore` with `persistentLocalCache` for a **separate read-only attendee client**, scoped to the current account. Its reads are limited to `users/{uid}` and `users/{uid}/bookmarks`. All ticket/registration-answer, directory, speaker-logistics, admin and other reads retain the memory-only client or existing function path. SDK persistence caches whole documents; it cannot be made selective by filtering fields after reading them. Two clients are necessary to stop those excluded records entering durable storage. Keep both while that SDK limitation and this privacy boundary exist.

The named attendee Firebase app uses the same project and existing user identity, with in-memory Auth persistence and the documented [`updateCurrentUser`](https://firebase.google.com/docs/reference/js/auth#updatecurrentuser) operation. No new login, token file, role or server permission is introduced. Start its subscriptions only after that identity is synchronized; tear them down on identity change. Cached profile roles/approval never authorize a server operation. No write API uses this client. Offline writes, mutation queues, background sync, charges and sends are excluded.

My schedule states **“Saved bookmarks”** with its last confirmed read time. Record whether the bookmark query was previously confirmed, including a legitimately empty result. An empty cache without that confirmation says **“Bookmarks have not been saved on this device. Connect to load them.”** It must neither spin indefinitely nor claim the reader has no bookmarks. This metadata prevents a missing cache from being mistaken for an empty account.

On sign-out or account change, clear personal UI state and stop subscriptions in every open tab, sign the attendee Auth client out, terminate its Firestore instance, then clear its IndexedDB persistence and dispose of the named app. Synchronize this removal across tabs before another account's offline client starts. A tab that prevents removal must close/reload before personal persistence can resume; report that removal is incomplete instead of claiming success. Account-specific cache identity prevents a different account opening the previous account's data. The public shell may remain.

[`clearIndexedDbPersistence`](https://firebase.google.com/docs/reference/js/firestore#clearindexeddbpersistence) requires an inactive client and does not securely overwrite storage. Do not promise device-wide erasure, revoke tokens by assumption or delete unrelated origin storage. No personal offline cache is enabled on a device whose reader declines that retention risk. Existing writes remain outside the durable client; reconnecting it cannot replay a write.

## Updates, scope and removal

Install each build as a complete set. Offer an update when it is ready; do not activate it over an open form. On the reader's reload, use matching HTML/chunks from that set. If a saved chunk is missing while offline, keep the running shell and use the existing error boundary to offer the saved home page and a reload after connecting. Do not automatically reload a network-only path such as `/schedule/mine` out of that working app. For an online stale-chunk failure, preserve `chunkReload.js`'s single automatic reload and boundary; never add a second reload loop. An interrupted update leaves the previous complete set usable. No background operation installs an admin chunk for offline use.

Put `sw.js` and its network-only policy at the deployment's actual base, register with that scope and `updateViaCache: 'none'`, and send `Cache-Control: no-store` for both. Explicit Hosting entries precede the asset/font long-cache rules; the script is not under `/assets/`. Cache names include project, normalized base and build id. Resolve manifest URLs against that base, and reject resources outside it. [#335](https://github.com/CenterCoopMedia/eventrunner/issues/335)/[#558](https://github.com/CenterCoopMedia/eventrunner/issues/558) still own prefixed Hosting support; test this contract there before enabling a prefixed site. Static demo builds register no worker and retain HashRouter behavior.

The required kill switch is the network-only policy's `enabled` setting, shipped disabled until #634 is accepted. Revalidate it in the background without holding a saved navigation. It stops a bad saved build or a privacy fault: on a confirmed disabled policy, the worker clears only its owned public caches, unregisters, notifies open clients to reload, and passes through to the network. The app also tears down personal persistence as above. It cannot reach an offline device; state that limit. Keep the worker/policy endpoints available while the site has installed clients; delete them when that site is retired. They remain necessary to deliver disabling instructions, not to serve a second application.

Migration starts with generation/age metadata, the isolated attendee reader and sign-out cleanup, then the bounded public manifest and worker in #634. Prove cached, missing, stale and quota-denied states; two-account/two-tab removal; excluded ticket/admin/material traffic; interrupted update and kill; root/prefixed paths; and offline startup in Safari and Chromium. Measure installation size and foreground network contention. None of that proof or implementation is claimed here.

Rollback sets the policy disabled and ships the ordinary network app with personal persistence off. Finish per-account removal before re-enabling it; do not delete the control endpoints while installed clients need them. No server schema or data migration is required.

## Alternatives and browser limits

- **No offline mode:** rejected by the owner's recorded decision.
- **Network first with a timeout:** rejected for saved public navigation because it holds a usable copy behind an unexplained blank/old page. First visits still depend on the network.
- **Precache everything or persist the default Firestore client:** rejected because that includes privileged chunks or excluded personal records and competes with the foreground visit.
- **Light view as the offline copy:** rejected because #577 requires live-source logistics and has a separate approval process.

The cache is a convenience, not a durable ticket, emergency plan or backup. WebKit's [2020 policy](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/) describes deletion after seven days of Safari use without site interaction, including worker/cache/IndexedDB storage; Home Screen apps use their own interaction counter. Its [2023 storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/) also permits quota/pressure eviction and treats default storage as best effort. Do not advertise seven days as guaranteed retention or claim Home Screen installation prevents all eviction. If a saved copy is gone, the site needs a connection again.

The public strategy follows the distinction between [cached access and background revalidation](https://developer.chrome.com/docs/workbox/caching-strategies-overview#stale-while-revalidate); the bounded install set follows [web.dev's minimum-resource guidance](https://web.dev/learn/pwa/caching#what-to-cache). The numerical limits, warnings and route decisions above are this product's choices.
