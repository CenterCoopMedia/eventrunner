# Audit 01 — functions/src/ticketing

Scope: `functions/src/ticketing/` (71 files), its wiring in `functions/index.js`,
`packages/shared/src/ticketCommerce.cjs` (+ `.mjs` shim), and agreement with
`firestore.rules`, `firestore.indexes.json`, `.env.example`, `packages/shared/src/config`.

Read-only. Nothing in the repository was changed. Two `node -e` proofs were run (shown below).

---

### 1. CSV import stores `createdAt` / `updatedAt` as numbers, not timestamps

- Category: broken
- Confidence: certain (reproduced)
- Where:
  - `functions/src/ticketing/csvImport.cjs:258` (`now = Date.now` default), `:284` (passes that `now` to `upsertTickets`), `:425` (`buildDeps` passes `now: Date.now`)
  - `functions/src/ticketing/sync.cjs:127-149` (`upsertTicket`: `const at = now(); … createdAt: at, updatedAt: at`)
- Evidence: every other caller gives `upsertTickets` a clock that returns a `Date` (`() => new Date()`). `csvImport` shares one `now` between `logAdminAction` (which wants epoch ms: `cms/store.cjs:501 at: new Date(now())`) and `upsertTickets` (which wants a `Date`). Run with the production wiring:
  ```
  node -e "… createTicketingImportCsvHandler({ db, auth, getConfig, now: Date.now … }) … db.read('tickets','ord-1')"
  → 200 number 1794257697754 number
  ```
  The tests hide it: every test in `csvImport.test.cjs` injects `now: () => T0` (a `Date`), e.g. `:161`, `:226 assert.deepEqual(ticket.createdAt, T0)`.
- How it is reached / impact: every committed `ticketingImportCsv` (the only way a `manual` deployment gets tickets). Those rows then
  - sort apart from Timestamp rows in `orderBy('createdAt')` (Firestore orders numbers before timestamps), so a deployment that has both synced and imported tickets lists them in two blocks;
  - give `providers/manual.cjs:159-162` a `createdAt` that is neither `Date` nor has `toDate`, so `nextPageToken` is null and `listTickets` (full sync) stops after the first 200 rows;
  - give `csvImport.cjs:376,385` null cursor and null `createdAt`/`updatedAt` in the admin list (see finding 2);
  - `registrationImport.cjs:166,230` writes the same collection with `new Date(now())`, so the two import paths disagree.
- Proposed fix: `csvImport.cjs:284` pass `now: () => new Date(now())`. Add one test that uses the default clock. Existing imported rows keep numeric values; a re-import does not fix `createdAt` (it is preserved), so decide whether a one-time correction is wanted.

### 2. Firestore Timestamps are tested with `instanceof Date`: the admin ticket list never paginates, and ticketing status never shows the last delivery

- Category: broken
- Confidence: certain for the code path; it rests on the Admin SDK returning `Timestamp` for stored dates, which `core/firestore.cjs` does not change (plain `getFirestore()`)
- Where:
  - `functions/src/ticketing/csvImport.cjs:376-378` (`last?.createdAt instanceof Date` → `nextCursor`), `:385` (`rowOf` `iso`)
  - `functions/src/ticketing/index.cjs:99-101` (`readyAt instanceof Date ? … : Date.parse(row?.readyAt)`), `:109-112` (`toIso`), `:121` (`lastDeliveryAt`), `:127` (`oldestReadyAt`)
- Evidence:
  ```
  node -e "const {Timestamp}=require('@google-cloud/firestore'); const t=Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')); console.log(t instanceof Date, Date.parse(t), String(t))"
  → false NaN [object Object]
  ```
  The webhook writes `receivedAt: at` and `readyAt: at` as `Date` (`webhook.cjs:140,150`); they come back as `Timestamp`. The unit tests pass because `cms/firestoreFake.cjs` returns the `Date` it was given (`index.test.cjs:88-92,114`). Other files in the same directory already handle this (`sync.cjs:66`, `commerceAdmin.cjs:49`, `providers/manual.cjs:161`, `stripeCommerce.cjs:281`).
- How it is reached / impact:
  - `ticketingListTickets`: `nextCursor` is always null, so `apps/web/src/admin/pages/AdminTicketing.jsx:450` never shows "Load more"; staff see at most the newest 100 tickets. `claimedAt`, `createdAt`, `updatedAt` are always null in the response.
  - `getTicketingStatus` (and `admin/webMcpDiagnostics.cjs:291,297`, which reuses it): `lastDeliveryAt` and `queue.oldestReadyAt` are always null. `AdminTicketing.jsx:143` shows "None" for the last delivery however many arrive.
- Proposed fix: use the existing helpers `iso` / `millis` from `functions/src/ticketing/stripeCommerce.cjs:279-288` (they accept `Date`, `Timestamp`, number and string) in `csvImport.cjs` (`rowOf`, `nextCursor`) and `index.cjs` (`toIso`, `readyAtMs`). Add a test row that carries an object with `toMillis()`.

### 3. `config.features.ticketing` is read but is not a feature key

- Category: inconsistent / unneeded
- Confidence: certain
- Where: `functions/src/ticketing/providers/stripe.cjs:344`
- Evidence: `if (origin.protocol !== 'https:' || config?.features?.ticketing === false) return { send: false };`. `packages/shared/src/config/schema.cjs:146-155` (`KNOWN_FEATURE_KEYS`) has no `ticketing`, and `:1145` rejects unknown keys. Whole-repo grep for `features.ticketing` / `features?.ticketing` finds only this line.
- Impact: the condition can never be true through any supported write path; a reader would think a "ticketing" switch suppresses the Stripe sign-up prompt.
- Proposed fix: delete the clause (or add the key to `KNOWN_FEATURE_KEYS` and the admin feature page if the switch is wanted).

### 4. Dead fields, states and parameters

- Category: unneeded
- Confidence: certain for each item (grep over apps, functions, console, packages, scripts, e2e); owner-decision on whether to delete
- Items:
  - `ticketsPersisted: true` — set in `stripeReconcile.cjs:195,206,207,214,225,237,295,309` and `providers/stripe.cjs:331`; never read anywhere. The drain and full sync read `provider.ownsTicketPersistence` instead (`sync.cjs:346,382`).
  - Order status `cancelled` — read at `stripeReconcile.cjs:146,160`; nothing writes it (`commerceAdmin.cjs:326-327` cancels tickets only) and `ORDER_STATUSES` in `packages/shared/src/ticketCommerce.cjs:253` does not list it. Already recorded in `docs/plans/2026-11-08-state-machine-map/01-ticketing-registration.md:79,249`.
  - `tickets.claimPromptSentAt` — initialized to null (`sync.cjs:138`, `stripeCommerce.cjs:229`, `stripeReconcile.cjs:285`), never set or read. Also already in the state-machine map (`:51,252`).
  - Prompt triggers `ticket_unclaimed` and `admin_resend` — no caller passes either (`registrationPrompt.cjs:97,120`; branches at `providers/manual.cjs:195-205`, `providers/eventbrite.cjs:643-653`, `registrationPrompt.cjs:191-197,202-203`). The module doc marks `ticket_unclaimed` as future work; `admin_resend` appears only in the JSDoc type and one test loop.
  - `transitionOrderInventory` (`stripeCommerce.cjs:134-148`, exported `:293`) — used only by `stripeCheckout.test.cjs`. Production uses `inventoryTransitionPatch` directly.
  - `claimTicketsForUser` passes `getConfig` to `applyTicketClaimToUser` (`registration.cjs:214`), which does not take it (`:57`); both HTTP handlers thread `getConfig` through for nothing.
  - Exports with no importer outside their own file (not even tests): `commerceAdmin.cjs` `readOrderDetail`, `publicOrder`, `publicTicket`; `commerceHttp.cjs` `buildCommerceDeps`; `providers/stripe.cjs` `createStripeClient`; `providers/index.cjs` `REQUIRED_METHODS`, `OPTIONAL_METHODS`.
- Proposed fix: remove `ticketsPersisted` and the unused `getConfig` argument now (no behavior change); decide the rest with the state-machine map's item 5.

### 5. `ticketingSync` and `createUserFromTicket` are deployed with no caller

- Category: unneeded
- Confidence: owner-decision
- Where: `functions/src/ticketing/sync.cjs:470-473`, `functions/src/ticketing/registration.cjs:502-506`
- Evidence: grep for both names over `apps/`, `console/`, `scripts/`, `e2e/` finds nothing. They appear only in `.github/smoke-endpoints.json:121,123`, `functions/README.md:52`, ADR 0001 and `docs/nclocal-demo.md:39`.
- Impact: two staff-gated HTTP endpoints that no screen or script calls. `ticketingSync` also has the default 60 s timeout while one page of a Stripe sync reconciles up to 25 orders sequentially (`providers/stripe.cjs:316-331`) and the loop allows 50 pages (`sync.cjs:48`), so it would time out on a real event if somebody did call it.
- Proposed fix: either add the admin buttons the ADR implies, or remove both exports (and their rows in `smoke-endpoints.json` and `functions/README.md`).

### 6. Two names the registries do not know

- Category: inconsistent
- Confidence: certain that they are absent; owner-decision on the fix
- Where / evidence:
  - `EVENT_TICKETING_ORGANIZATION_ID` — read at `providers/eventbrite.cjs:567`, set by `scripts/provision-client.cjs:1107`. Not in `.env.example` and not in `packages/shared/src/config/deploy.cjs`. Every other `EVENT_*` key the ticketing code reads is in both.
  - Collection `ticketLookupBudgets` — `lookupBudget.cjs:14` is the only reference in the repository. It is the only camelCase ticketing collection; it has no named rule in `firestore.rules` (it is denied only by the catch-all at `:865`), is not in the server-only list in `tests/firestore.rules.test.js:645-650`, and is not in `scripts/lib/event-template.cjs` `EXCLUDED_REASONS` (`:105-113`, which also lacks `ticket_promo_codes`, `ticket_answers`, `ticket_answer_holds`; those fall to the "not on the allowlist" report, which is the safe side).
- Impact: none at runtime (deny-all covers it). An operator registering an Eventbrite webhook by hand has no documented way to learn the organization override.
- Proposed fix: add a commented `EVENT_TICKETING_ORGANIZATION_ID` line to `.env.example` next to `EVENT_TICKETING_EVENT_ID`; add the collection to the rules block and `EXCLUDED_REASONS` (as "rate limits").

### 7. Duplicated helpers, one with a swapped signature

- Category: unneeded
- Confidence: likely (a defect waiting, not one today)
- Where:
  - Two `CommerceError` classes with different argument order: `stripeCommerce.cjs:18-25` `(code, message, status)` and `commerceAdmin.cjs:26-28` `(status, code, message)`. `commerceAdmin` calls into `promoCodes.cjs` and `stripeCheckout.cjs`, which throw the other class; it only works because the catch at `commerceAdmin.cjs:426` also accepts any error with a 4xx `status`.
  - `scopeMatches`: `providers/stripe.cjs:76-79` and `commerceAdmin.cjs:53-57` (same test), plus `assertOrderScope` in `stripeCommerce.cjs:61-67`.
  - Timestamp readers: `sync.cjs:63-69 toMillis`, `stripeCommerce.cjs:279-288 millis/iso`, `stripeReconcile.cjs:21-25 millis`, `commerceAdmin.cjs:48-52 iso`, and the two incomplete ones in finding 2.
  - Collection names: constants in `index.cjs:26-28` and `stripeCommerce.cjs:8-11`, redefined in `entitlement.cjs:44` and `commerceAdmin.cjs:12-15`, and typed as string literals in `providers/stripe.cjs`, `stripeReconcile.cjs`, `commerceEmail.cjs`, `ticketAnswers.cjs`, `stripeCheckout.cjs:347,355`.
- Proposed fix: have `commerceAdmin.cjs` import `CommerceError`, `iso` and the collection names from `stripeCommerce.cjs` and `scopeMatches` from `providers/stripe.cjs`; drop `stripeReconcile.cjs`'s private `millis`.

### 8. Small read inefficiencies

- Category: inefficient
- Confidence: certain, low value (bounded at 20 seats / 50 rows)
- Where:
  - `stripeReconcile.cjs:167-174` `readTickets`: one `get()` per ticket in a loop; `:250` one `tx.get` per seat inside the transaction. `db.getAll` / `tx.getAll` does each in one round trip (the file's neighbours already use it: `stripeCheckout.cjs:567`).
  - `commerceAdmin.cjs:504-511` `ticketingMyTickets`: re-reads the parent order for every ticket; `listCommerce` in the same file caches by `orderId` (`:215,223-227`).
  - `index.cjs:89-107` `readTicketingStatus`: three independent queries awaited one after another.
- Proposed fix: `getAll`, reuse the `orderCache` pattern, `Promise.all`.

### 9. Comments that no longer describe the code

- Category: inconsistent
- Confidence: certain
- Where:
  - `providers/none.cjs:6-8` "Until the manual/CSV adapter lands (issue #31)" — it landed (`providers/manual.cjs`).
  - `registrationPrompt.cjs:51-53` "neither adapter's `ctaUrl` for that branch is wired to a real page yet (both return `ctaUrl: null` …)" — both return `claimUrl(config)` → `/ticket/claim` (`manual.cjs:201`, `eventbrite.cjs:649`), and the route exists (`apps/web/src/App.jsx:147`).
  - `providers/manual.cjs:24-25` "paginated by document id" — the method paginates by `createdAt` (`:136-153`).
  - `entitlement.cjs:77-122`: the JSDoc for `recomputeEntitlement` sits above `holdsPaidTicket`'s JSDoc and function, 27 lines before the function it describes (`:149`). Its line 111-113 ("the claim path marks an account `ticketed` the moment a ticket is claimed — whatever its status") is false: `registration.cjs:126` refuses any ticket that is not `valid`.
  - `firestore.rules:827` "every write is saveTicketAnswers" — `registration.cjs:165,185` (`claimTicket`) and `ticketAnswers.cjs:186` (`syncAnswerStatus`) also write `ticket_answers`.
  - `ticketing/index.cjs:8-9` "nothing outside this module ever names an adapter file" — `scripts/provision-client.cjs:44` requires `providers/stripe.cjs` directly.
  - `docs/plans/2026-11-08-state-machine-map/01-ticketing-registration.md:107,253` cites a dead `exhaustRow` at `sync.cjs:183`; that function no longer exists (grep: no match in `functions/src`).
- Proposed fix: edit the comments; move the `recomputeEntitlement` JSDoc to line 149.

---

## Files read

- `functions/index.js` (165 lines, in full).
- `functions/src/ticketing/` production code, in full (22 files): `index.cjs`, `webhook.cjs`, `sync.cjs`, `registration.cjs`, `entitlement.cjs`, `registrationPrompt.cjs`, `registrationForm.cjs`, `ticketAnswers.cjs`, `csvImport.cjs`, `lookupBudget.cjs`, `commerceHttp.cjs`, `commerceAdmin.cjs`, `commerceEmail.cjs`, `promoCodes.cjs`, `promoPreview.cjs`, `stripeCommerce.cjs`, `stripeCheckout.cjs`, `stripeReconcile.cjs`, `providers/index.cjs`, `providers/none.cjs`, `providers/manual.cjs`, `providers/eventbrite.cjs`, `providers/stripe.cjs`.
- Test support and tests: `ticketingFake.cjs` and `commerceTestKit.cjs` (headers and exports), `csvImport.test.cjs` and `index.test.cjs` (the parts that bear on findings 1-2); the other 24 test files were grepped, not read line by line. `providers/__fixtures__/README.md` in full; all 21 fixture JSON files checked for a referencing test (each has one).
- `packages/shared/src/ticketCommerce.cjs` and `.mjs` in full; `packages/shared/src/config/schema.cjs` (feature keys), `deploy.cjs` (ticketing keys); `.env.example`.
- `firestore.rules:796-869`, `firestore.indexes.json` (all 24 indexes), `core/firestore.cjs`, `core/demoWrites.cjs`, parts of `core/auth.cjs`, `email/templates.cjs`, `cms/store.cjs`.

## Checked and found correct

- `functions/index.js` spreads all 12 ticketing handler modules; `stripeCheckout`, `promoPreview`, `promoCodes`, `stripeReconcile`, `lookupBudget`, `stripeCommerce` are reached through `commerceHttp` / `commerceAdmin` / the Stripe provider. All 23 production modules load (`require` of each succeeded).
- All 21 exported functions exist; 19 have a caller in the web app, a trigger, a schedule or a provider (the two exceptions are finding 5).
- Every composite query has its index: `tickets` (claimedByUid+status; email+createdAt desc; status+createdAt desc; provider+createdAt; provider+externalId; claimedByUid+externalId), `ticket_sync_queue` (status+readyAt), `ticket_orders` (provider+id), `admin_logs` (orderId+at desc). The email+status+createdAt list query is served by merging the two single-equality indexes. Equality-only and single-field queries need none.
- Every collection the code writes is denied to clients in `firestore.rules` (named rules for 10 collections; `ticketLookupBudgets` by the catch-all). `ticket_answers` records carry the `uid` the read rule tests.
- Env keys: `EVENT_TICKETING_PROVIDER`, `EVENT_TICKETING_EVENT_ID`, `EVENT_STRIPE_ACCOUNT_ID`, `EVENT_STRIPE_MODE`, `EVENT_PUBLIC_URL`, `EVENT_ALLOWED_ORIGINS`, `EVENT_FIREBASE_REGION`, `EVENT_FIREBASE_PROJECT_ID`, `EVENT_EMAIL_PROVIDER`, `EVENT_OPERATOR_NOTIFIER`, `TICKETING_API_TOKEN`, `TICKETING_WEBHOOK_SECRET` are all in `.env.example` and `deploy.cjs`. `PROVIDER_NAMES` equals `TICKETING_PROVIDERS`.
- Shared imports resolve: `shared/registration`, `shared/registrationForm`, `shared/promoCodes`, `shared/email`, `shared/config`, `shared/ticketCommerce`; the `.mjs` shim exports the same 24 names as the `.cjs`. The five transition edges `entitlement.cjs` / `registration.cjs` use are all valid in the shared table.
- Status vocabularies agree between `ticketCommerce.cjs` and the writers (`paymentStatus`, `inventoryState`, `refundStatus`, ticket statuses).
- Transactions do all reads before writes (`claimTicket`, `reserveCommerceOrder`, reconcile commit, `releaseHold`, `changeAdmission`, `correctAttendee`, check-in).
- Webhook path: claim + enqueue in one transaction, duplicate handling, raw-body requirement for Stripe, wrong-event → 200, queue lease/generation fencing, attempt cap and operator alert.
- Email links `/tickets/status?orderId=`, `/ticket/claim?order=`, `/tickets` match routes and query names in `apps/web` (`App.jsx:147,149`, `TicketClaim.jsx:64`, `TicketStatus.jsx:37`).
- `requireAdmin` returns `tier`, as `commerceAdmin.cjs:303` expects; `config.tierA.publicUrl` exists (`core/config.cjs:82`).
- Secret binding per function matches what each runtime path reads (ticketing secrets, send secrets for the three email-sending functions, notifier secrets for the queue drain).
