# Audit 08: console/ (web, functions, rules, indexes, firebase.json, tests, README)

Scope read: `console/` in full for production code, `docs/adr/0007-*`, `packages/shared/src/consoleRequest.cjs`.
Nothing in the repository was changed. No suite, build, emulator or browser was run; only `grep`, and `node -e` to list module exports.

Headline: no broken endpoint wiring and no crash bug found. The findings are document/code drift, one rules surface that no code uses any more, one misleading rate-limit comment, and small dead code.

---

### 1. README says saving the build settings keeps other fields; the code replaces the document
- Category: inconsistent
- Confidence: certain
- Where: `console/README.md:120`; `console/functions/src/consoleSettings.cjs:220`
- Evidence: README, `saveConsoleSettings` row: "Checks and saves the build settings, and writes an audit record. Other fields on the document stay." Code: `tx.set(db.collection('console_config').doc('settings'), settings);` with no `{ merge: true }`. A Firestore `set` without merge replaces the whole document. The test fake models this the same way (`fakes.cjs:55-56`: merge only when `op.merge`).
- How it is reached / impact: every save from `/review/settings`. Today the document holds only `gcpFolder`, `billingAccount`, `region`, so nothing is lost. A field added to that document later (by hand or by another writer) would be erased by the next save, against what the README promises.
- Proposed fix: delete the sentence "Other fields on the document stay." in `console/README.md`, or add `{ merge: true }` to the `tx.set` in `consoleSettings.cjs` (owner picks; the README edit is the smaller one).

### 2. README gives the web-address name limit as 30 characters; the code and the web page use 27
- Category: inconsistent
- Confidence: certain
- Where: `console/README.md:70` and `:160`; `console/functions/src/siteNames.cjs:20-22`; `console/web/src/pages/setup/WebAddressStep.jsx` (hint and `maxLength={27}`)
- Evidence: README: "A web-address name is 3 to 30 characters". Code: `const NAME_MAX = 27; // The longest that fits a project id whole: er- and 27 is the limit of 30.` Web hint: "3 to 27 lowercase letters, numbers and hyphens". README:160 also says "A long name is cut to fit, and a short one gets `-site`": with 3 to 27 characters, `er-<name>` is always 6 to 30 characters, so neither branch of `projectIdFor` is reachable for a valid name (the code comment says so: "siteNames.cjs limits a name so this fits whole").
- Impact: a reader of the README expects 28 to 30 character names to work.
- Proposed fix: in `console/README.md` change "3 to 30" to "3 to 27", and drop or reword the "cut to fit / gets -site" sentence.

### 3. The browser never reads Firestore, but the rules still give members direct read of whole request documents, including fields the API hides
- Category: unneeded (rules vs code)
- Confidence: owner-decision
- Where: `console/firestore.rules:43-64` and `:116-121`; `console/web/src/firebase.js` (only `firebase/app` and `firebase/auth`); `console/functions/src/applications.cjs:100-143` (`applicationForClient`)
- Evidence: `grep -rn "firebase/" console/web/src` (non-test) returns only `firebase/app` and `firebase/auth`. `api.js` says "The console's only server door: one POST per action". So no shipped code uses these allowances: `organizations` get/list, `members` read, the `{path=**}/members` collection group, `applications` read, `console_audit` read. Meanwhile `applicationForClient` gives `frozen`, `review` and each history entry's `by` to operators only (`...(operator ? { by: entry.by || null } : {})`, `if (operator) { body.frozen = ...; body.review = ... }`), but `allow read: if isOperator() || isMember(resource.data.orgId)` lets any member, an Editor included, read the raw document with the Firebase SDK and the public web config: `review.by` (operator uid), history `by`, `signupLinkId`, `agreementAcceptance.sha256/email/id`, `buildStart`. The code comments know the document is browser-readable (`applications.cjs:18`, `connectionState.cjs:13`), so this is deliberate history, not an oversight; the stated reason ("the browser may only read") no longer matches a browser that reads nothing.
- Impact: low sensitivity data, but the server-side field filter is not a real boundary while the rule stays.
- Proposed fix: owner decides. Smallest: change the `organizations`, `members`, collection-group `members`, `applications` reads to `if false` (keep `console_audit` for operators if they read it in the Firebase console, which uses admin access anyway) and trim `console/tests/console.rules.test.js` to match. Otherwise keep the rules and say in the rules header that no shipped client uses them.

### 4. The rules and the functions do not read the operator allowlist "the same way"
- Category: inconsistent
- Confidence: certain (the difference); low impact
- Where: `console/firestore.rules:35`; `console/functions/src/access.cjs:12-14` and `:48`
- Evidence: rules: `request.auth.token.email.lower() in get(operators).data.emails` (exact match against stored entries). Functions: `list.some((entry) => typeof entry === 'string' && entry.trim().toLowerCase() === email)`. `access.cjs` comment: "console/firestore.rules reads the same document the same way." The functions' own fixture seeds a mixed-case entry (`testData.cjs:50`: `'Two@CCM.example'`), which the functions accept and the rules would refuse.
- Impact: an allowlist entry typed with a capital or a space makes an operator for every endpoint but not for the rules. No effect today because the web app makes no Firestore read (finding 3).
- Proposed fix: correct the comment in `access.cjs` ("the rules need the stored entry in lowercase"), or resolve with finding 3.

### 5. "A refused acceptance does not use a slot" is only true for refusals before the transaction
- Category: inconsistent
- Confidence: likely
- Where: `console/functions/src/applicationStatus.cjs:105-114`; `console/functions/src/agreementAcceptance.cjs:116-146`
- Evidence: `acceptAgreement` calls `await takeSubmitSlot(db, user, now);` (its own transaction) and only then opens the main transaction, which can still refuse with `signup-link-required`, `signups-closed`, `agreement-changed`, or `incomplete` (name taken, teammate edit) from `answersToFreeze`. Each of those refusals has already spent one of the five daily slots. `rateLimit.cjs` has `takeSlotIn(tx, …)` for exactly this ("inside a caller's transaction: its refusal then charges nothing") and `buildRetry.cjs:85` uses it.
- How it is reached: an Owner who selects Accept after the operator saved a new agreement version gets `409 agreement-changed` and loses a slot; five such refusals in a day give `429`.
- Proposed fix: either call `takeSlotIn(tx, db, {...})` as the first read inside the `acceptAgreement` transaction, or change the comment to "A refusal before the transaction does not use a slot."

### 6. ADR 0007 still lists App Check as a control; the console has none. It also says the client launches with no hosting-team step, while the console has an operator "Mark as launched"
- Category: inconsistent (ADR vs code)
- Confidence: certain (App Check); owner-decision (launch)
- Where: `docs/adr/0007-client-console-self-serve-onboarding.md:195-196`, `:268-270`, `:322`; `console/web/src/firebase.js`; `console/functions/src/http.cjs`; `console/functions/src/reviewDecisions.cjs:132-141`
- Evidence: ADR (current, un-struck text): "Verified email, App Check, a daily limit on acceptances and the operator delete for spam stay." `grep -rni "app.?check" console` matches only `functions/package-lock.json`; the web app never initializes App Check and `postEndpoint` checks only the ID token. ADR Launch amendment: "The client launches from the setup checklist once every row passes. No hosting-team step is needed." Code: `launchApplication` (operators only, `ready -> launched`, "The hosting team does this once the client's event site goes public"), and the shared module says `launched   the hosting team marks a ready site as open to the public`. The ADR status list (`:322`) also lacks `archived`, which `console/README.md:48` attributes to that amendment.
- Proposed fix: amend the ADR text (remove "App Check", note the operator launch mark and `archived`), or open an issue for App Check if it is still wanted.

### 7. README omits or misstates several things the code does
- Category: inconsistent
- Confidence: certain
- Where: `console/README.md`
- Evidence, each against the code:
  - Functions table (`:86-126`) has no row for `launchApplication` or `reportProblem`, both in `handlers.cjs` `ENDPOINTS`/`REPORT_FUNCTION` and both rewritten in `firebase.json`. "Operator review" (`:152-156`) lists Decline, Retry, Delete as spam, and omits Close request and Mark as launched.
  - `:34` "Only `declineApplication` and `closeApplication` write `review`": `launchApplication` goes through `transition`, which always writes `review: { note, by, at, settings: null }` (`reviewDecisions.cjs:71`). `launchApplication` is also missing from the "Written by" list.
  - `:34` and `:43`: `agreementAcceptance` is given as `{ id, version, sha256, name, email, at }` and the record as `version, sha256, typedName, email, uid, orgId, appId, at`; the code also stores `legalName` and `title` in both (`agreementAcceptance.cjs:138,144`). `:101` says acceptance needs "a typed name"; it needs name, legal name and job title.
  - `:46` audit `by` is "a uid, `retention`, `console` or `build`": `buildRetry.cjs:115` writes `by: 'build-watch'`, and the writer list omits the build watch.
  - `:13` names one composite index (descending); `firestore.indexes.json` has two, and the ascending one serves the retention query (`cleanup.cjs:138-139`).
  - Settings table (`:196-217`) omits `CONSOLE_REPORT_INTAKE_URL`, `CONSOLE_REPORT_PROJECTS`, `CONSOLE_REPORT_INTAKE_SECRET`, `CONSOLE_REPORT_ACCESS_ID`, `CONSOLE_REPORT_ACCESS_SECRET` (`handlers.cjs:24-28`) and `VITE_CONSOLE_SIGN_IN_PROVIDERS` (`SignIn.jsx`, `deploy-console.yml:65`). The settings list in the `handlers.cjs` header in turn omits `CONSOLE_HELP_NAME` (`hostName.cjs`).
  - Pages table (`:221-229`) omits `/signin`, `/signin/finish`, `/organizations/:orgId/team`, `…/accepted-agreement`, `/invite/:inviteId`, `/review`, `/review/:appId`, `/review/settings` (`App.jsx:146-161`).
- Proposed fix: edit `console/README.md` (and the header comment of `handlers.cjs` for `CONSOLE_HELP_NAME`).

### 8. `review.settings` is always written as null, but three readers still branch on it
- Category: unneeded
- Confidence: owner-decision
- Where: writers `console/functions/src/reviewDecisions.cjs:71,171`; readers `console/functions/src/problemReports.cjs:127`, `scripts/provision-client.cjs:1218` ("The settings an operator approved…"), `scripts/decommission-client.cjs:175`; pass-through `applications.cjs:139`, `reviewQueue.cjs:89`
- Evidence: `grep -rn "settings: " console/functions/src scripts` (non-test): the only writes to `review.settings` are `settings: null`. Operator approval, which stored chosen settings, was removed by the ADR's second 2026-11-04 amendment ("No operator approves a request"). No web page shows `review.settings`.
- Impact: dead branches, and a stale comment in the provisioner. Kept deliberately only if a request approved before the amendment still exists in the live database (I cannot see that data).
- Proposed fix: if no stored request has `review.settings`, drop the field from the writers and the three `stored ||` branches; otherwise leave and say so in a comment.

### 9. Two copies of "email the Owners" and of "read the team"
- Category: unneeded (duplicate of an existing helper)
- Confidence: likely
- Where: `console/functions/src/applicationStatus.cjs:31-65` (`ownerEmails`, `sendAll`, `notifyOwners`) vs `console/functions/src/reviewAccess.cjs:57-61` (`ownerEmails`) and `console/functions/src/reviewDecisions.cjs:83-111` (`notifyOwners`); `console/functions/src/organizations.cjs:52-67` (`getTeam`) vs `console/functions/src/reviewQueue.cjs:59-73` (`readTeam`)
- Evidence: both `notifyOwners` read the Owners and the organization name, build the status link and call `mailer.sendStatusChange` once per Owner. They differ in small ways that look accidental: the review copy does not de-duplicate addresses and logs the raw error; the other de-duplicates and strips addresses from the log line. The web page uses only `mailFailed` from the review copy's result (`ReviewApplication.jsx:24`). The two team readers map and sort members and open invites with the same lines.
- Proposed fix: have `reviewDecisions.notifyOwners` call `applicationStatus.notifyOwners` and return `{ mailFailed: !sent }` (tests that assert `emailed` counts need a look), delete `reviewAccess.ownerEmails`; have `getTeam` call an exported `readTeam`.

### 10. Sequential reads where one batch would do
- Category: inefficient
- Confidence: certain (the pattern); small real cost
- Where: `console/functions/src/reviewQueue.cjs:19-27` (`organizationNames`: one awaited `get` per distinct organization, up to 200 queue rows); `console/functions/src/organizations.cjs:33-37` (`listOrganizations`: one awaited `get` per membership); `console/web/src/pages/OrganizationHome.jsx:23` (calls `getTeam`, which reads all members and pending invites, only to show `team.organization.name`)
- Proposed fix: `db.getAll(...refs)` or `Promise.all` in the two server loops; return the organization name from `listApplications` (it already checks membership) and drop the `getTeam` call on the organization page.

### 11. Refusal text says "Your site is being built" for a site that is already built
- Category: inconsistent
- Confidence: likely (reachable only by a stale page or a direct call)
- Where: `console/functions/src/connections.cjs:73,112,125`
- Evidence: `requireChangeable` and `requireConnectable` fall through to `stillBuilding` for every status that is not closed, archived or draft, which includes `ready` and `launched`. `connectionsForClient` sets `canChange`/`canDisconnect` false for those, so the page does not offer the action.
- How it is reached: a status page left open across the end of a build (it refreshes every 30 s), then Reconnect or Disconnect (Eventbrite).
- Proposed fix: one more line in each function: for `BUILT_STATUSES` answer "Your site is built. Ask the hosting team to change this account."

### 12. Small dead code and stale comments
- Category: unneeded
- Confidence: certain (each grep covered apps, functions, console, packages, scripts, e2e, .github)
- Items:
  - Exports that nothing outside their own file uses, tests included: `access.cjs` `requireOrganization`; `applicationStatus.cjs` `SUBMITS_PER_DAY`; `applications.cjs` `STEP_IDS`, `applicationForClient`, `countOwners`, `STATUSES` (re-export); `buildDispatch.cjs` `WORKFLOW`, `appJwt`; `checks.cjs` `websiteHref`, `LIMITS`; `cleanup.cjs` `RETENTION_DAYS`; `consoleSettings.cjs` `CONSOLE_FIELDS`; `mailer.cjs` `ROLE_WORDS`; `problemReports.cjs` `cleanLogs`, `tokenProject`, `verifyReporter`; `reviewDecisions.cjs` `requireNote`, `transition`; `siteNames.cjs` `normalizeSiteName`, `siteNameVerdict`; `testData.cjs` `BUILD_SETTINGS`; web `ReviewActions.jsx` `decisionsFor`, `firebase.js` `app`. Fix: remove the names from each `module.exports` / drop `export`.
  - `packages/shared/src/consoleRequest.cjs`: `canMoveConsoleRequest`, `inConsoleRequestGroup` and `CONSOLE_REQUEST_TRANSITIONS` are used only by `consoleRequest.test.cjs`. No writer consults the table ("Every move the code makes" is documentation that a test checks, not a gate). Owner-decision: keep as a tested map, or call `canMoveConsoleRequest` in `reviewDecisions.transition` and the other status writers.
  - `console/web/src/IconControl.jsx:9,12`: icons `download` and `more` are never requested (`grep 'icon="download"'`, `'icon="more"'`: 0).
  - `console/web/src/ReportProblem.jsx:57-58` sends `surface: 'console'` and `site: ''`; `problemReports.readReport` ignores both and the handler derives them from the verified token ("never the browser's word"). Remove the two fields. `readReport`'s JSDoc `@returns` also still lists `surface, site`.
  - Orphan JSDoc lines that sit above the wrong declaration: `console/web/src/reviewText.js:30` ("A time for people…" above `clockText`; it belongs to `formatDateTime` at :57) and `console/web/src/setup/steps.js:81` ("What the client reads for each status" above `BUILD_PHASES`).
  - `console/functions/src/fakeReview.cjs` and `testData.cjs` are two fixture files with the same `NOW`, `ana`, `ops`, a fake mailer each (the `fakeReview` one lacks `sendOperatorNotice` and `sendAgreementCopy`) and near-identical answers and application builders. Both are used (6 and 9 test files), so neither is dead; merging is owner-decision.
  - `console/functions/src/handlers.test.cjs:66` re-requires `firebase.json` that line 11 already parsed.

---

## Files read
- `console/functions`: `index.js`, `package.json`, every non-test module in `src/` (32 files, in full), `fakes.cjs` (exports and write semantics only), `fakeReview.cjs`, `testData.cjs`, `handlers.test.cjs`, `vendor.test.cjs` in full; other `*.test.cjs` only by targeted grep.
- `console/web`: `package.json`, `vite.config.js`, `index.html`, every non-test file under `src/` (54 files, in full) except `styles.css`/`actionFeedback.css` (class-usage scan only); `test/setup.js`, `test/renderPage.jsx`, `test/setupPage.jsx`, `optimizeDeps.test.js`, `reviewText.test.js`; other tests by grep.
- `console/firestore.rules`, `firestore.indexes.json`, `firebase.json`, `README.md` in full; `console/tests/console.rules.test.js` setup and test titles.
- `docs/adr/0007-client-console-self-serve-onboarding.md`, `packages/shared/src/consoleRequest.cjs` and `.mjs` in full; the parts of `scripts/provision-client.cjs` and `scripts/decommission-client.cjs` that import console modules.

## Checked and found correct
- Web calls vs functions vs rewrites: the 34 names the web calls (static and the dynamic ones in `useTeam.js`, `ReviewApplication.jsx`) equal `ENDPOINTS` + `reportProblem`, and equal the 34 `/api/*` rewrites. No call to a missing endpoint, no unrouted handler, no endpoint nothing calls. Scheduled jobs have no rewrite.
- Secret flags per endpoint (`mail`, `connect`, `build`) match what each action uses.
- Every collection the code touches has a rule; every write is denied to the browser.
- Indexes vs queries: `status ==` + `orderBy updatedAt desc` (review queue) and `status ==` + `updatedAt <=` (retention) each have their composite index; the `members.uid` collection-group override serves `listOrganizations`; all other queries are single-field or equality-only.
- Status lists: console code takes groups from `shared/consoleRequest` (`closed`, `editable`, `building`, `built`, `spamDeletable`); `STATUS_FILTERS` is a deliberate reorder guarded by `reviewText.test.js`; the remaining literals are single-status writes or checks.
- Limits repeated in the web match the server: name 3-27, organization name 2-100, days 14, note 2000, agreement title 200 / body 200000, signer fields 200, report 4000, invite 7 days, link 30 days, settings regexes, `SIGNUPS_CLOSED` text.
- Build step ids in `steps.js` `BUILD_PHASES` and `ReviewApplication.jsx` `SETUP_STEP_LABELS` equal the 13 ids in `scripts/provision-client.cjs`; mail `kind`/`status` values sent by console and scripts all have words in `mailer.cjs`.
- Dependencies: every dependency in both `package.json` files is imported. `fakes.cjs`, `fakeReview.cjs`, `testData.cjs` are all used and all excluded from deploy by `firebase.json`.
- README file references exist (`scripts/console-isolation.test.cjs`, `scripts/prepare-functions.cjs`, `scripts/dev/build-social-cards.mjs`, `design/brand/README.md`, runbook §11.3, §12, §12.2, §12.5); `emailLayout.cjs` is on the ESLint hex allowlist as its comment says.
