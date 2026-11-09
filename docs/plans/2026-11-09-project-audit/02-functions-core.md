# Audit 02: functions core (index, README, package.json, email, admin, cms, core, auth, public, pdf, maintenance, notify, telemetry)

Read-only audit. Nothing in the repository was changed. Findings are ordered by severity.

Barrel check first, because it was asked for by name: `functions/index.js` loads and exports 164 names. Every `require` in it resolves, every module exposes `handlers`, no name is exported twice and none is null (checked by loading the barrel in Node). Every file in my directories that defines `handlers` is in the barrel. The files with no `handlers` are all required by a wired module or by a script, except the three test helpers named under "Checked and found correct".

---

### 1. `logClientError` and `onSystemErrorCreated` throw on every call when the mail provider is postmark or webhook and the operator notifier is `webhook` or `none`
- Category: broken
- Confidence: certain (reproduced)
- Where: `functions/src/telemetry/systemErrors.cjs:161-171` (`notifierSecretNames`), `:178-189` (`buildNotifyDeps`, the eager `getEmailProvider` at `:186`); callers `systemErrors.cjs:200-205` and `functions/src/telemetry/clientErrors.cjs:170,183`.
- Evidence: `notifierSecretNames` binds the mail provider's send secrets only when `EVENT_OPERATOR_NOTIFIER=email`. `buildNotifyDeps` builds the provider on every call whatever the notifier is: `createEmailCore({ db, provider: getEmailProvider({ env: process.env }), getConfig })`. `createPostmarkProvider` throws without `EMAIL_PROVIDER_API_KEY` (`email/providers/postmark.cjs:131`), and `createWebhookProvider` throws without its URL and secret. Run in `functions/`:
  `EVENT_EMAIL_PROVIDER=postmark EVENT_OPERATOR_NOTIFIER=webhook OPERATOR_WEBHOOK_URL=… OPERATOR_WEBHOOK_SECRET=s node -e "…buildNotifyDeps()"` prints `secrets bound: [ 'OPERATOR_WEBHOOK_URL', 'OPERATOR_WEBHOOK_SECRET' ]` then `THROWS: postmark email provider requires EMAIL_PROVIDER_API_KEY`.
  The comment above `buildNotifyDeps` says the opposite ("'none' and 'webhook' never touch sendEmail"). True of `sendEmail`, but the provider constructor runs first.
- How it is reached / impact: `.env.example:25` ships `EVENT_OPERATOR_NOTIFIER=none`, so a postmark deployment with the default notifier is affected. `logClientError` calls `buildNotifyDeps()` before the method check, so every browser error report answers 500 and no `system_errors` row is written. `onSystemErrorCreated` fails on every delivery, so a webhook notifier never hears of a system error. The deploy smoke test sends only an OPTIONS preflight, which CORS answers before this line, so it does not catch it. No test calls `buildNotifyDeps`.
- Proposed fix: in `systemErrors.cjs` `buildNotifyDeps`, pass a lazy `sendEmail` as `maintenance/cleanup.cjs:351-353` and `cms/publish.cjs:371-379` already do (`sendEmail: async (m) => createEmailCore({ db, provider: getEmailProvider(...), getConfig }).send(m)`). Add a test that calls `buildNotifyDeps` with a postmark env and no key.

### 2. The publish-queue diagnostic always reports `publishedCount: 0`
- Category: broken
- Confidence: certain
- Where: `functions/src/admin/webMcpDiagnostics.cjs:194-197`; writer `functions/src/cms/store.cjs:440-446`; test fixture `functions/src/admin/webMcpDiagnostics.test.cjs:70`.
- Evidence: the diagnostic sums `Number.isInteger(item?.published) ? item.published : 0`. `publishDocs` stores `progress.<collection>.published` as an array of document ids (`published: [...published, ...chunkPublished]`). An array is never an integer, so the sum is always 0. The test passes because its fixture uses a shape no code writes: `progress: { cmsPages: { published: 1 } }`.
- How it is reached / impact: `webMcpInspectPublishQueue` (staff). A finished publish of 40 documents reads "0 published", which looks like a stalled run.
- Proposed fix: `Array.isArray(item?.published) ? item.published.length : 0` in `webMcpDiagnostics.cjs`, and change the test fixture to an array.

### 3. Custom web address: the runbook describes an add flow the code refuses, nothing in the repository can create the record, and the add helpers are dead
- Category: inconsistent (and unneeded)
- Confidence: certain for the mismatch; owner-decision for which side moves
- Where: `functions/src/admin/webAddress.cjs:143-148` (add and remove answer 403 for every tier), `:83-106` (`checkRecord` only reads `hasAuthorizedDomain`), `:200-210` (`addDomain`), `:238-243` (`addAuthorizedDomain`), `:47-55` (`normalizeDomain`, `RESERVED_SUFFIXES`); `docs/DEPLOY_RUNBOOK.md:763-768`; `scripts/remove-web-address.cjs`.
- Evidence: the runbook says "An operator can add a custom web address on Settings → Web address… The `webAddress` function asks Firebase Hosting for the domain… When the domain is live it adds the domain to the Auth authorized domains." The handler refuses `add` and `remove` ("To add or remove a custom domain, contact us."), per commit `eba327d`. `grep -rn "addDomain(\|addAuthorizedDomain\|normalizeDomain"` over the repository finds only `webAddress.cjs` and its test. `grep -rn "web_address"` finds no writer that creates `web_address/current`: `checkRecord` writes only over an existing record, and the only script is the removal one.
- How it is reached / impact: an operator who follows the runbook gets a 403. To start a domain today someone must write the Firestore document, the Hosting domain and the Auth authorized domain by hand. `status` on an empty record then says "Contact us to set up your domain first."
- Proposed fix: either add `scripts/add-web-address.cjs` beside the removal script, using `normalizeDomain`, `addDomain` and `addAuthorizedDomain`, and rewrite the runbook section to name it; or delete those three helpers and rewrite the section to describe the manual steps. Also correct the module header ("Operator tier") since add and remove gate at staff.

### 4. The global email token `{{login_url}}` points at `/login`, a route that does not exist
- Category: broken
- Confidence: certain
- Where: `functions/src/email/render.cjs:222`; routes in `apps/web/src/App.jsx` (`path="signin"`); `firebase.json:27` (`/signin`).
- Evidence: `login_url: site ? `${site}/login` : ''`. A search of `apps/web/src`, `packages/shared/src`, `firebase.json` and `e2e` for a `/login` path finds nothing; the sign-in page is `/signin`. `/login` falls to the catch-all content page, which renders not-found.
- How it is reached / impact: `login_url` is in `GLOBAL_TOKEN_NAMES`, so every template override may use it, and `email/templateWording.cjs:83` returns it to the editor as a usable token. The one shipped template that uses it is `account.welcome`, which is never sent (finding 9), so today the reach is an override that uses the token.
- Proposed fix: `${site}/signin` in `render.cjs`, and update the assertion in `email/render.test.cjs` or `templates.test.cjs` that pins the old value.

### 5. Two per-IP rate-limit collections are never swept
- Category: inconsistent
- Confidence: certain that no sweep exists; owner-decision on retention
- Where: `functions/src/telemetry/clientErrors.cjs:90-106` (`client_error_rate_limits/{ipHash}`), `functions/src/admin/feedback.cjs:63,115-125,128-138` (`feedback_rate_limits/{ipHash}`), `functions/src/admin/accessMail.cjs:23` (`admin_mail_limits`, three fixed scopes plus one per actor and per recipient); the sweep that exists: `functions/src/auth/challenges.cjs:364-398`.
- Evidence: both modules say they mirror `auth/challenges.cjs takeRateLimitSlot`, and both write `updatedAt`. `sweepExpired` deletes `auth_rate_limits` and `auth_send_ceiling` on `updatedAt`. `grep -rn "feedback_rate_limits\|client_error_rate_limits"` over `functions/src` and `scripts` finds no delete; `maintenance/cleanup.cjs` sweeps only publish rows, `sent_emails` and `announcement_sends`.
- How it is reached / impact: both endpoints are unauthenticated, so each distinct client address leaves one document for good. The documents hold a hash of an IP address, which the 90-day rule for `sent_emails` suggests should not be kept without limit.
- Proposed fix: add the two collections to `sweepExpired` in `auth/challenges.cjs` (or to `maintenance/cleanup.cjs`) with the same `updatedAt` cutoff, using each window (10 and 15 minutes).

### 6. The daily auth sweep deletes one document per round trip inside a 60-second function
- Category: inefficient
- Confidence: likely
- Where: `functions/src/auth/challenges.cjs:369-380` (`drain`), scheduled at `functions/src/auth/otp.cjs:521-524` with no `timeoutSeconds`.
- Evidence: `for (const doc of batch.docs) { await doc.ref.delete(); }`, up to 40 batches of 250, three collections in sequence. The sibling sweep `maintenance/cleanup.cjs:249-251` uses `db.batch()` for the same work, and its comment says it matches this one. A scheduled v2 function defaults to 60 seconds.
- How it is reached / impact: 10,000 sequential deletes do not fit in 60 seconds. On a busy day (the send ceiling allows 500 codes an hour) the run times out inside `auth_challenges` and never reaches `auth_rate_limits` or `auth_send_ceiling`. Nothing breaks; the backlog is cleared more slowly than the code intends.
- Proposed fix: in `drain`, commit one `db.batch()` per page, as `sweepExpiredSentEmails` does.

### 7. `updatesMeta` answers 500 for an update id it cannot use as a document id
- Category: broken
- Confidence: likely (reproduced with a fake that throws as the Admin SDK does)
- Where: `functions/src/public/og.cjs:265-270` (`requestedUpdateId`), `:321`.
- Evidence: the id is `decodeURIComponent` of the path segment and goes straight to `db.collection('cmsUpdates').doc(id)`. `routeMeta` guards the same lookups with `isValidDocId` and `ROUTE_KEY_RE` (`:489, :499`); `updatesMeta` has no guard. Driving the handler with `/updates/a%2Fb`, `/updates/%E0%A4%A` and `/updates/..` gave 500 each time (a slash makes an invalid document path; a bad escape throws `URIError`).
- How it is reached / impact: `/updates/**` is rewritten to this function (`firebase.json:20-25`), so scanner paths get a 5xx where the app would show not-found. `og.test.cjs` has no case for it.
- Proposed fix: in `updatesMeta`, wrap the decode in try/catch and treat an id that fails `isValidDocId` as "no update", which falls to the event-level tags the handler already builds.

### 8. `emailDeliveryWebhook` always binds `EMAIL_WEBHOOK_BASIC_AUTH` on a postmark deployment; the docs say it is needed only "with delivery ingest enabled"
- Category: inconsistent
- Confidence: likely
- Where: `functions/src/email/send.cjs:709-725, 728-745`; `functions/src/auth/otp.cjs:469-470` (comment); `docs/DEPLOY_RUNBOOK.md:264`; `.env.example:126`.
- Evidence: `INGEST_SECRETS_BY_PROVIDER.postmark` is `['EMAIL_PROVIDER_API_KEY', 'EMAIL_WEBHOOK_BASIC_AUTH']`, and `emailDeliveryWebhook` is exported unconditionally. There is no switch named anywhere for "delivery ingest enabled". `grep EMAIL_WEBHOOK_BASIC_AUTH packages/shared/src scripts .github` finds it only in `scripts/provision-client.cjs`, which always creates it.
- How it is reached / impact: a postmark deployment set up from the runbook table, without the provisioning script, has no such secret, and a function that binds a secret that does not exist fails to deploy. Provisioned clients are unaffected.
- Proposed fix: change the two doc lines and the two code comments to "required when `EVENT_EMAIL_PROVIDER = postmark`". No code change.

### 9. The `account.welcome` template has no sender
- Category: unneeded
- Confidence: owner-decision (certain that nothing sends it)
- Where: `functions/src/email/templates/account.welcome.cjs`, registry entry `functions/src/email/templates.cjs:22`, the `next_steps_html` resolver `functions/src/email/render.cjs:141-148`, `functions/README.md:8` ("phase-2 templates (`auth.otp`, `account.welcome`)").
- Evidence: `grep -rn "account\.welcome"` over the repository finds the template, the registry, tests, the README and ADR 0001 (which plans a `welcome:{uid}` send-once key). No production file renders or sends it. Every other id in the registry has a sender (checked one by one). `next_steps_html` is used by this template only.
- How it is reached / impact: none at runtime. It is dead code with tests, and it keeps the broken `login_url` (finding 4) looking used.
- Proposed fix: either wire the send the ADR describes (in `users/lifecycle.cjs`), or remove the template, its registry line, the resolver and their tests, and drop it from the README.

### 10. `getSiteContent` is a deployed public endpoint with no caller
- Category: unneeded
- Confidence: owner-decision
- Where: `functions/src/cms/content.cjs:762-774, 809-812`; `.github/smoke-endpoints.json:4`.
- Evidence: `grep -rn getSiteContent` over the repository finds the handler, its tests, the smoke list, one comment in `scripts/generate-content.cjs:110` and ADR 0001. The web app and the build read `cmsContent` from Firestore directly.
- How it is reached / impact: an unauthenticated GET that reads every visible content block on each call, with no cache header and no limit. Nothing in the repository depends on it; an outside consumer could.
- Proposed fix: remove the export, its handler factory, tests and smoke entry, if no outside consumer exists. Otherwise add a `Cache-Control` header.

### 11. `core/storage.cjs` uses the app check that `core/firestore.cjs` documents as a bug, and five call sites bypass it for the default bucket
- Category: inconsistent
- Confidence: likely
- Where: `functions/src/core/storage.cjs:35` (`if (getApps().length === 0) initializeApp();`) against `functions/src/core/firestore.cjs:18-27`; bypasses at `materials/store.cjs:634`, `materials/download.cjs:225`, `materials/bulk.cjs:582`, `materials/projection.cjs:163`, `users/projection.cjs:259`.
- Evidence: `firestore.cjs` explains that under the Functions emulator the runtime registers a named app before a background trigger runs, so a bare length check skips `initializeApp()` and the next call throws "The default Firebase app does not exist". `storage.cjs` has that bare check, and `media/imageSizes.cjs:429` calls `getBucket()` from a Storage trigger with no `getDb()` before it. Separately, `storage.cjs:9-17` says falling back to the default bucket "would be worse than throwing", and five modules call `getStorage().bucket()` with no name.
- How it is reached / impact: the first part is emulator-only. The second matters only where `EVENT_STORAGE_BUCKET` is not the project default bucket: media would then write to one bucket and materials and profile photos to another. The five call sites are in other agents' areas; I report them because they contradict this file.
- Proposed fix: copy the `[DEFAULT]` check into `storage.cjs`. Decide whether the five call sites should use `getBucket()`.

### 12. `functions/README.md` does not match the code in six places
- Category: inconsistent
- Confidence: certain for a to e; likely for f
- Where and evidence:
  - a. Line 16 and the tier table list the `exportEventData` datasets as sessions, speakers, organizations, orders, admissions (and invoices). `admin/dataExport.cjs:210-232` also has `speakerLogistics` (staff).
  - b. The tier table (lines 51-52) omits `saveAnnouncement` and `deleteAnnouncement` (staff, `admin/announcements.cjs:159,206`), `webAddress` (operator for status and check, `admin/webAddress.cjs:144`) and `updateRegistrationForm` (operator, `ticketing/registrationForm.cjs:24`). The paragraph says each endpoint's tier is listed.
  - c. Line 62: "only `src/core/firestore.cjs` imports firebase-admin". `core/storage.cjs`, every `buildHandlers` (`firebase-admin/auth`), `auth/otp.cjs:509` (`app-check`) and the five files in finding 11 import it.
  - d. Lines 52 and 56 say a change to the `sender` block needs an operator. `admin/config.cjs:513-520` refuses a changed `sender.email` and a changed `legal.postalAddressHtml` for operators too ("contact us"), which agrees with AGENTS.md.
  - e. Line 5 still reads "Landed so far (M2 backend foundation)", and the list has no entry for `src/public/`, `src/telemetry/`, `src/maintenance/`, `src/pdf/`, `src/schedule/` or `src/speakers/`. `cleanupExpiredAuthChallenges`, `publishActiveAnnouncements`, `webAddressCheck`, `routeMeta`, `updatesMeta` and `logClientError` appear nowhere in the file.
  - f. Line 15 has lost its leading "- " and renders as a continuation of the `src/users/` item.
- Impact: the README is the stated source for tier classification ("Adding an endpoint").
- Proposed fix: edit `functions/README.md` only.

### 13. Three readers treat a missing `visible` as shown; the rest of the system treats it as hidden
- Category: inconsistent
- Confidence: certain (low impact)
- Where: `functions/src/admin/dataExport.cjs:185` (`session.visible !== false` for "Published sessions") against `:111` in the same file (`hidden: current.visible !== true`); `functions/src/cms/versions.cjs` in `toEntry` (`visible: data.visible !== false`) and `describeChanges` (`previous.visible !== false`), against `cms/store.cjs:185-187` (`isVisible` is `=== true`), `public/og.cjs` and `firestore.rules`.
- How it is reached / impact: only a document with no `visible` field, which `publishDocs` never writes (it always stores a boolean). A hand-written or old seeded session shows "Hidden: yes" in the sessions spreadsheet and still counts as a published session in the speakers spreadsheet.
- Proposed fix: `session.visible === true` in `dataExport.cjs:185`; use `=== true` in the two `versions.cjs` reads.

### 14. Two small costs in the publish path
- Category: inefficient
- Confidence: likely
- Where: `functions/src/cms/store.cjs:367-369`; `functions/src/cms/publish.cjs:81-83`.
- Evidence: (a) `publishDocs` awaits `maxHistoryRevision` (one query) inside the per-document loop for every document with no live copy, so a first publish of N imported records runs N queries in sequence before each chunk commits; `cmsPublish` has the default 60-second timeout. (b) `resolveRequest` checks `docIds` by hand (`!id.includes('/')`) though the file imports `isValidDocId`; an id of `..` or one over 300 characters passes, a queue row is created, and `publishDocs` then throws, leaving a `failed` row.
- Proposed fix: (a) collect the documents with no live copy and run their history queries with `Promise.all` before the loop. (b) use `isValidDocId` in `resolveRequest`.

### 15. Dead exports and stale comments
- Category: unneeded
- Confidence: certain
- Where and evidence (each name grepped across `functions`, `scripts`, `apps/web/src`, `console`, `e2e`, `tests`, `packages/shared/src`):
  - `email/send.cjs:34,749,762`: `providerCan` is exported twice (top level and `internals`) and no other file names it.
  - `admin/config.cjs:137,712`: `EVENT_OPERATOR_KEYS` is defined and exported; nothing reads it, in the file or outside.
  - `admin/feedback.cjs:115-125`: `takeFeedbackRateLimitSlot` is used only by its test; the handler uses the window inside `storeFeedback`.
  - `email/templates/pitchNotice.cjs:67`: `buildPitchNoticeBodies`, `RECEIPT_TOKENS`, `DECISION_TOKENS` are exported and used only inside the file. `email/templateWording.cjs`: `WORDING_FIELDS`, the same.
  - `auth/challenges.cjs:358`: "maintenance/cleanup.cjs calls the same". It does not call `sweepExpired`.
  - `auth/challenges.cjs:161-164, 207-210`: the two doc comments say the ceiling slot is released when the send does not happen or `sendEmail` throws. `auth/otp.cjs:269-292` releases it only when `createChallenge` throws.
  - `admin/changeRequestNotices.cjs:75-76`: the comment "A queued record older than this…" now sits above `MAX_ERROR_LENGTH`; its constant moved to `email/noticeRetry.cjs`.
  - `cms/content.cjs:10` and `cms/pages.cjs:15`: "removes live + draft in one batch"; both are transactions. `content.cjs:252-270`: the doc block for `checkBlockContract` sits above `sponsorPackageErrors`.
  - `email/providers/postmark.cjs` and `webhook.cjs`: `safeEqual`, `header` and `retryAfterMsFrom` are identical copies in both files.
- Proposed fix: delete the unused names and correct the comments. The duplicated adapter helpers could move to one file under `email/providers/`; that is optional.

---

## Files read

Read in full (production code): `functions/index.js`, `functions/package.json`, `functions/README.md`, `functions/src/vendor.test.cjs`; `core/` (9 files); `auth/` (2); `email/` `send`, `render`, `log`, `templates`, `templateWording`, `noticeRetry`, `stream`, `providers/` (4), and `templates/` (13 of 25 line by line; the other 12 for tokens, required tokens, storage flag and links); `notify/` (3); `maintenance/` (1); `telemetry/` (5); `pdf/kit.cjs`; `public/og.cjs`; `cms/` (14 production files, `firestoreFake.cjs` header only); `admin/` `access`, `accessMail`, `announcements`, `changeRequestNotices`, `changeRequests`, `config`, `customBadges`, `dataExport`, `eventStats`, `feedback`, `invoiceEmail`, `invoices`, `liveUpdates`, `webAddress`, `webMcpDiagnostics`.

Not read line by line: `admin/invoicePayLink.cjs`, `admin/invoicePdf.cjs`, `admin/eventPackage.cjs`, `admin/eventPackageReader.cjs`, and `admin/exportRecords.cjs` after line 185. For these I checked the exports, the importers, and the constants and refusals the README states. `admin/exportFixture.cjs`: header only. Test files: read only where a finding needed the fixture (`webMcpDiagnostics.test.cjs`, `og.test.cjs`, `systemErrors.test.cjs`, `webAddress.test.cjs`).

## Checked and found correct

- Barrel: 164 exports, no duplicate, no null, every `handlers` file wired (loaded in Node).
- README identifiers: every backticked path and relative link in `functions/README.md` exists.
- README figures that match the code: 30 `count()` aggregates in `getEventStats`; email log scan cap 500 and page sizes; `sendBatch` rules; invoice pay-link times (23 h, 22 h, 15 min); event package limits (50,000 documents, 9 MB); export 413 messages name `scripts/export-event-package.cjs` and `docs/operator/archive-handoff.md`, both present; `invoicePdf` refuses a draft with 409; staff end times and `resolveAdminTier` behaviour.
- Env keys: every `EVENT_*` key read in my directories is in `.env.example` and `packages/shared/src/config/deploy.cjs`, or is written by `deploy-client.yml` (`EVENT_SITE_PUBLISHER_JOB`). `EMAIL_ACCOUNT_API_KEY` is documented as operator-only.
- `functions/package.json`: all eight dependencies are required by production code. `express` and `@google-cloud/storage` are required only by three test files outside my area and are not declared (they resolve through firebase packages).
- Every email template id in the registry except `account.welcome` has a production sender.
- Admin gates: every endpoint in my directories states its tier at `requireAdmin`; the tiers match the README table where the table lists them.
- Secret binding: `sendOtpCode`, `setAdminAccess`, `resendAdminAccessInstructions`, `submitFeedback`, the change request senders, `invoiceAdmin`, `cmsPublish` and `cleanupStrandedPublishRows` bind what their paths read. Telemetry is the one exception (finding 1).
- `firestoreFake.cjs`, `exportFixture.cjs` and `importTestKit.cjs` are test helpers kept under `src/` on purpose; `scripts/export-event-package.test.cjs` uses the fixture.
- `eventPackageReader.cjs` is used by `scripts/export-event-package.cjs`; `removeWebAddress` by `scripts/remove-web-address.cjs`.
