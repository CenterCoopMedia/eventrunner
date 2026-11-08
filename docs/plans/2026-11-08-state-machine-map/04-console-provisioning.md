# Client console and client-site lifecycle (provision, deploy, decommission)

Scope read: console/functions/src/**, console/web/src/**, console/firestore.rules, .github/workflows/{provision-client,decommission-client,deploy-console,deploy-client,deploy}.yml, scripts/{provision-client,decommission-client,dispatch-security-rollout,migrate-*,publish-site,init-event,register-ticketing-webhook,verify-sender-domain,remove-web-address}.cjs, scripts/lib/{idempotency,deploy-matrix,checklist,readiness}.cjs, docs/DEPLOY_RUNBOOK.md §12, docs/adr/0007, docs/CLIENT_ONBOARDING.md.

Rules note: console/firestore.rules gives the browser no write anywhere (`allow write: if false` on every match, console/firestore.rules:46-120) and no read of builds, links, names, invites, connections or rate limits. So every guard below lives only in Cloud Functions or the provisioning scripts; nothing is enforced twice by rules. `console_deleted_sites` and `security_migrations` are absent from the rules' comment list (console/firestore.rules:14-17) but fall under default deny.

## Application status (explicit, the central machine)
- Entity / storage: `applications/{appId}.status` plus `history[]` (one entry per change). Declared at console/functions/src/applications.cjs:35 (`STATUSES`), shape comment applications.cjs:7-15.
- States (declared): draft, approved, building, ready, launched, withdrawn, declined. States actually written but NOT declared: `archived` (scripts/decommission-client.cjs:317, :780).
- Transitions:
  - (none) -> draft: signup link redeemed, console/functions/src/signupLinks.cjs:178 via `newApplicationData` applications.cjs:143-159. Guard: link open, terms open, signupLinks.cjs:171-175.
  - draft -> withdrawn: Owner, applicationStatus.cjs:116-143; guard `WITHDRAWABLE` applications.cjs:37, re-checked in tx applicationStatus.cjs:131. Releases names.
  - draft -> declined: operator, reviewDecisions.cjs:127-130 via central `transition()` reviewDecisions.cjs:55-76 (revision = history length, :63).
  - draft -> approved: Owner accepts agreement, agreementAcceptance.cjs:139-149 (tx). Guards: status draft :46-49/:122, paid signup link :123-130, terms open and version match :131-134, answers re-checked + name still held applicationStatus.cjs:93-103.
  - approved|building -> declined ("close"): operator, reviewDecisions.cjs:132-174; guard `canRetryBuild` (build dead) :146, no connection change :149, revision :145. Does NOT use `transition()`.
  - approved -> building: provisioner, scripts/provision-client.cjs:1326 via `moveStatus` :1162-1178 (result ignored).
  - building -> ready: provisioner final step, provision-client.cjs:1132 (`stepReady`), after Owners emailed :1118-1130.
  - ready -> launched: NO WRITER anywhere (grep of repo; only readers).
  - draft|ready|launched|approved/building-with-failed-build -> archived: decommission-client.cjs:306-321 (tx, guard :314 + `checkIdle` :276-280).
  - archived -> previous status: restore, decommission-client.cjs:367-378, using `archive.previousStatus`.
  - any non-busy status -> archived (raw): `purge --now`, decommission-client.cjs:780 (no history entry, no archivedAt/purgeAfter).
  - any -> document deleted: spam delete cleanup.cjs:80-98 (draft/withdrawn/declined), retention cleanup.cjs:119-154 (withdrawn/declined, 90 days), purge `console-records` decommission-client.cjs:664-676.
- Terminal / reversibility: withdrawn and declined are terminal in the console (no reopen); archived is reversible until `purgeAfter` (7 days, decommission-client.cjs:18, :317); ready is terminal in practice because launched is never set.
- Other copies of this lifecycle:
  - console/functions/src/reviewAccess.cjs:14 - identical `STATUSES` array, duplicated (agrees with applications.cjs:35; both omit `archived`).
  - console/web/src/reviewText.js:4-17 - operator labels + filter list (omit `archived`).
  - console/web/src/setup/steps.js:91-99 - a second, different `STATUS_LABELS` for clients (omits `archived`).
  - console/functions/src/mailer.cjs:66-73 `STATUS_WORDS` - approved, ready, launched, withdrawn, declined, plus pseudo-status `build-failed`; no `building`, no `archived`/restored mail.
  - ApplicationStatus.jsx:16-20 `STAGES`, :257-263 closed/underway/live lists; OrganizationHome.jsx:46; ReviewActions.jsx:6-7.
  - Many subset constants: CLOSED applications.cjs:36, CLOSED_STATUSES connectionState.cjs:32, RETAINED_STATUSES cleanup.cjs:38 (all = withdrawn, declined); RETRY_STATUSES buildState.cjs:19 and literal `['approved','building']` at provision-client.cjs:1257, :1285, :1351, decommission-client.cjs:278, ApplicationStatus.jsx:262, ReviewActions.jsx:7; BUILT_STATUSES connectionState.cjs:36 = ready, launched BUT BUILT_STATUSES problemReports.cjs:33 = building, ready, launched (same name, different set); SPAM_STATUSES cleanup.cjs:39 and ReviewActions.jsx:6 (agree).
  - Docs: ADR 0007 lines 322-325 says "An operator can decline only a draft" (closeApplication contradicts it) and lists no `archived`; console/README.md:48 same; DEPLOY_RUNBOOK.md:1419-1440 is the only place that documents `archived`.
- Problems:
  - `archived` is a real status absent from every status list. Effects: client status page shows a blank status line (ApplicationStatus.jsx:270 `STATUS_LABELS[app.status]`) and all stages "Not started" (:23 findIndex -1); org home shows "Status unavailable" (OrganizationHome.jsx:45); review page "In progress" (ReviewApplication.jsx:237); review queue cannot list archived requests (reviewQueue.cjs:31-32 rejects any status not in reviewAccess STATUSES); withdraw/connection refusals say "Your site is being built" (applicationStatus.cjs:122-123, connections.cjs:111, :123) for an archived site.
  - `launched` is a dead state: declared in 5+ places, read by guards (provision-client.cjs:1252, decommission-client.cjs:304/314/347, dispatch-security-rollout.cjs:26, connectionState.cjs:36) and mail text (mailer.cjs:69), never written. DEPLOY_RUNBOOK.md:1349 tells operators to act "once the site is launched", which the console cannot show.
  - Phantom status `building-failed` checked at decommission-client.cjs:273; never written anywhere (only a test, decommission-client.test.cjs:603).
  - Status writes bypass the one helper: three independent writers of status+history (`transition` reviewDecisions.cjs:55; inline in closeApplication :154-161, withdraw applicationStatus.cjs:134-139, acceptance agreementAcceptance.cjs:139-149, `moveStatus` provision-client.cjs:1162, decommission :316-320/:373-376/:780). `purge --now` writes status with no history entry (decommission-client.cjs:780), so the operator "revision" (history length, reviewQueue.cjs:123) does not change.
  - closeApplication declines a request that may own a cloud project (keeps names when a build record exists, reviewDecisions.cjs:164), but retention then deletes the application after 90 days (cleanup.cjs:101-105) and deleteApplication leaves `console_builds` (cleanup.cjs:71-73). Decommission refuses to archive `declined` (decommission-client.cjs:314) and cannot run at all once the application doc is gone without a tombstone (decommission-client.cjs:165). Result: orphaned client projects become unreachable by the purge tool after 90 days. Spam delete of a closed request (cleanup.cjs:39 includes declined) does the same immediately.

## Build start flag (implicit/explicit, on the application)
- Entity / storage: `applications/{appId}.buildStart = { state, at }`, documented applications.cjs:14.
- States: (absent), pending, started, failed.
- Transitions:
  - absent -> pending: acceptance, agreementAcceptance.cjs:145.
  - failed|silent -> pending: retry, buildRetry.cjs:94.
  - pending -> started: after dispatch returns, buildDispatch.cjs:143; ALSO when the run claims, provision-client.cjs:1304.
  - pending -> failed: dispatch threw, buildDispatch.cjs:136.
  - pending|started -> failed: run failed or stopped, provision-client.cjs:1197 (recordFailure, also via markStopped :1356-1364); silent-build job, buildRetry.cjs:114.
- Terminal / reversibility: none; never cleared after ready.
- Other copies: read in buildState.cjs:37-41, :52-56, :63-67; readableProgress reviewQueue.cjs:96-101.
- Problems: two writers of `started` with no ordering guard (buildDispatch.cjs:143 is an unconditional update after the dispatch call, so it can overwrite a `failed` written by a run that failed fast; benign only because `console_builds.state` = failed still drives canRetryBuild). The flag duplicates the build record's state for every case except "run never started"; two fields encode "this build failed".

## Build record (explicit)
- Entity / storage: `console_builds/{appId}.state` and `steps[].state`, comment buildState.cjs:7-11 (lists fields, not values).
- States: record: (absent), queued, running, failed, done. Step rows: running, done, failed (provision-client.cjs:1220-1229).
- Transitions:
  - absent|any -> running: run claim tx, provision-client.cjs:1284-1306 (guard: status approved|building only; no check of the current record state, relies on workflow concurrency provision-client.yml:36-38).
  - failed -> queued: retry, buildRetry.cjs:95 (only if record exists).
  - running -> failed: recordFailure provision-client.cjs:1194-1196 (set merge), markStopped :1349-1366.
  - running -> done: provision-client.cjs:1334.
  - Derived "silent": startWentSilent (pending/started + no record or queued, > 1 h, buildState.cjs:37-41) and runWentSilent (running > 6 h, :47-49).
- Side fields as implicit sub-machines (idempotency of re-runs): `ownersEmailedAt` (once-only email, provision-client.cjs:1118-1130), `ticketsKey`/`ticketsChangedAt` (:823-826), `stripeEndpointId` (:810), `environmentClaim` (:936-943), `resources.*` inventory (:282-285), `decommission: { mode, state, stepsCompleted }` (decommission-client.cjs:282-291).
- Terminal / reversibility: done is terminal; failed is re-entered by retry.
- Other copies: canRetryBuild is reused by closeApplication, requireConnectable, decommission (decommission-client.cjs:8, :273, :279) - good reuse. Client step grouping BUILD_PHASES setup/steps.js:82-90 duplicates provision STEPS ids provision-client.cjs:1137-1151 (currently all 13 agree; nothing ties them together).
- Problems:
  - `done` is written but no code path ever reads record state `done` (only step `done`, decommission-client.cjs:403).
  - Retry re-derives region/folder/billing from live console settings each run (buildSettings provision-client.cjs:1209-1214; `review.settings` is always null, reviewDecisions.cjs:71, :160) and then overwrites `resources.region` (provision-client.cjs:1319-1322). An operator changing console settings between a failed run and its retry builds in a new region, and decommission later uses the overwritten value (decommission-client.cjs:39). `review.settings` is a dead field still read in three places (provision-client.cjs:1211, decommission-client.cjs:174, problemReports.cjs:125).
  - GitHub concurrency (`cancel-in-progress: false`) keeps only one pending run per group; a third queued run (e.g. a scheduled purge, which shares `provision-<id>`, decommission-client.yml:114-116) replaces a pending retry. The retry's `queued` record then falls to the 1 h silent rule (buildState.cjs:20). (GitHub behavior, not in repo.)

## Agreement acceptance (implicit)
- Entity / storage: `agreement_acceptances/{id}` (create-only, agreementAcceptance.cjs:6-11, :138) and pointer `applications.agreementAcceptance` (:144); `frozen`, `submittedAt/By` (:141-143).
- States: not accepted (pointer null), accepted. Encoded three times: `agreementAcceptance != null`, `frozen != null`, `submittedAt != null`, plus status != draft.
- Transitions: none -> accepted only, in the same tx as draft -> approved (agreementAcceptance.cjs:137-151).
- Other copies: progress.agreement applications.cjs:92; reviewedAnswers falls back from frozen to answers reviewAccess.cjs:45-47.
- Problems: four fields for one fact; consistent today because they are set in one tx. The comment "A refused acceptance does not use a slot" (applicationStatus.cjs:105) is false: `takeSubmitSlot` runs in its own tx before the acceptance tx (agreementAcceptance.cjs:116 vs :120-151), so a refusal inside the acceptance tx (agreement-changed, signup-link-required, name taken) still spends a slot. Contrast retry, which takes its slot inside the tx (buildRetry.cjs:84-91).

## Signup link (explicit)
- Entity / storage: `signup_links/{linkId}.status`, signupLinks.cjs:8-13.
- States: open, used, revoked; derived `expired` (open + expiresAt passed) only in the list view, signupLinks.cjs:100.
- Transitions: create -> open :68-79; open -> used redeem tx :179 (guard :171); open -> revoked :117-126 (guard :120). Expiry is checked, not written (:146).
- Terminal: used, revoked. Expired-open stays `open` forever in storage.
- Other copies: web labels reviewText.js:19-24 (agree, including derived expired); web optimistic `revoked` SignupLinks.jsx:140; refusal codes StartEvent.jsx:13; acceptance re-verifies `used` + appId/orgId/usedBy agreementAcceptance.cjs:126-130; migration matches the same predicate scripts/migrate-console-signup-links.cjs:21.
- Problems: links are never deleted by spam/retention deletes (cleanup.cjs:61-77), only by purge (decommission-client.cjs:654-663), so `used` links keep pointing at deleted applications.

## Legacy draft provenance (implicit)
- Entity / storage: `applications.signupLinkId`, `legacyQuarantined`, `quarantinedAt`.
- States: linked (signupLinkId set), quarantined (legacyQuarantined true), unmigrated (neither).
- Transitions: scripts/migrate-console-signup-links.cjs:23-28, run on every console deploy (deploy-console.yml:97-100). Guard read at agreementAcceptance.cjs:123.
- Problems: not idempotent in its timestamp: every deploy re-writes `quarantinedAt` for every quarantined draft (filter :17 only skips linked ones). No path un-quarantines a draft. Compare migrate-security-data.cjs:16-17, which uses a completion marker; two idempotency styles for one-off migrations.

## Invite (explicit)
- Entity / storage: `invites/{inviteId}.status`, invites.cjs:6-12.
- States: pending, accepted, replaced; derived expired (filtered at organizations.cjs:65, reviewQueue.cjs:69; refused at invites.cjs:137). Implicit "deleted" when the email fails (invites.cjs:90).
- Transitions: create pending :71-77; pending -> replaced by a newer send :100-109 (batch, outside a tx); pending -> accepted tx :153.
- Terminal: accepted, replaced. No revoke action exists for a pending invite; invites are never deleted.
- Other copies: team listing implemented twice, organizations.cjs:52-75 and reviewQueue.cjs:59-73 (same query, same filtering).

## Membership / roles (explicit)
- Entity / storage: `organizations/{orgId}/members/{uid}.role` in ROLES (access.cjs), organizations.cjs:8.
- States: owner, editor; absent = not a member.
- Transitions: create on redeem (signupLinks.cjs:177) or invite accept (invites.cjs:151); change role / remove members.cjs:38-60 with last-owner guard :34.
- Other copies: owner-email lookup three times: applicationStatus.cjs:31-34 (dedups), reviewAccess.cjs:56-60 (no dedup), countOwners applications.cjs:67-70.

## Connection (explicit + lease)
- Entity / storage: `applications.connections[provider] = { connected, ..., change: { id, until } }` (connectionState.cjs:8-20); private `console_connections/{appId}`; tokens in Secret Manager; OAuth `console_connection_states/{hash}` (one-time, TTL 1 h, connections.cjs:63); pending token deletions `console_token_deletions/{appId}`.
- States per provider: absent, changing (connected:false + change lease 5 min, connections.cjs:61, :181-186), live (connected:true), unfinished (change present but expired, connectionState.cjs:88).
- Transitions: start -> state row :240-245; complete consumes row first :252-262, then changing -> live; disconnect live -> changing -> absent :392-428; built Stripe end via provider revoke :343-386; close/delete -> connections {} + token deletion row (reviewDecisions.cjs:156, cleanup.cjs:75).
- Guards: which statuses can change - CHANGEABLE draft (connectionState.cjs:31), failed-build reconnect of the chosen provider only (connections.cjs:120-127), closed disconnect only (:404-405), built Stripe end (:353). Lease checked by close/spam/retention/decommission (reviewDecisions.cjs:149, cleanup.cjs:90/:102, decommission-client.cjs:277).
- Other copies: client permissions computed again in connectionsForClient (connectionState.cjs:78-101) and again in ApplicationStatus.jsx:258-261 / canConnect prop.
- Problems: no case for `archived` (falls to "being built" message, connections.cjs:123).

## Web-address name reservation (implicit)
- Entity / storage: `site_names/{name} = { appId, orgId, reservedAt }`; tombstone form `{ appId, deleted: true }` (decommission-client.cjs:673).
- States: free (no doc), held, retained-after-build (held with no live app), deleted-tombstone.
- Transitions: reserve on save applicationSave.cjs:36-47; release on withdraw/decline (applicationStatus.cjs:132-133, reviewDecisions.cjs:64/:73), on close or delete only if no build record (reviewDecisions.cjs:164, cleanup.cjs:73); purge rewrites to tombstone or deletes (decommission-client.cjs:671-674).
- Problems: "a build began" is inferred from the presence of `console_builds/{appId}` in two places (reviewDecisions.cjs:164, cleanup.cjs:73), and decommission's draft archive creates that doc with only `resources`/`decommission` (decommission-client.cjs:201, :283), so a restored draft that is later declined keeps its name forever.

## Archive / restore / purge (explicit + implicit, decommission)
- Entity / storage: `applications.status = 'archived'`, `archivedAt`, `purgeAfter`, `archive: { previousStatus, versionName, pending, restoring }`; `console_builds.decommission`; tombstone `console_deleted_sites/{appId}` with `stepsCompleted[]`, `purgedAt`, `verifiedAt`.
- States: archiving (archived + pending), archived, restoring (archived + restoring), purging (tombstone, stepsCompleted partial), purged (purgedAt), verified (verifiedAt).
- Transitions: archive claim tx decommission-client.cjs:306-321 -> disable Hosting -> pending:false :328-335; restore claim :350-355 -> Hosting release -> status previousStatus :367-378; cancel-restore :380-391; purge tx creates tombstone :767-781 -> steps :783-797 -> verify :798-800; scheduled purge-due :837-850, decommission-client.yml:26-27.
- Guards: checkIdle :275-280; window :344, :353, :756; tombstone blocks restore/archive :295, :310, :339.
- Other copies: dispatch-security-rollout.cjs:21-35 treats tombstone or non-ready status as blocked; runbook §12.6 DEPLOY_RUNBOOK.md:1419-1440 (agrees, including "or a failed build").
- Problems: archive allowed statuses exclude withdrawn/declined (decommission-client.cjs:314) while purge --now accepts them; purge --now on a non-archived app sets status only, so a failed --now purge leaves an `archived` app with no `purgeAfter` that purge-due never picks up (decommission-client.cjs:780 vs :839-840). Two different "archive" concepts share the word: this one (Hosting off, deleted in 7 days) and the event-site lifecycle `archived` (site stays up as a back issue, packages/shared/src/config/lifecycle.cjs:103, CLIENT_ONBOARDING.md:375).

## Silent-build watch and notices (implicit)
- `runBuildWatch` hourly (handlers.cjs:61, :104) -> reportSilentBuilds buildRetry.cjs:128-151; flag tx :107-118 is the dedupe ("said once").
- Pseudo-statuses for mail: Owner `build-failed` (mailer.cjs:72; sent from agreementAcceptance.cjs:156, buildRetry.cjs:143, provision-client.cjs:1205); operator kinds `started`, `build-failed` (= did not start), `build-run-failed` (mailer.cjs:117-126). The same string `build-failed` means "did not start" to operators and "start or run failed" to Owners.
- Two notifyOwners implementations: applicationStatus.cjs:58-65 (returns boolean, redacts addresses in logs :51) and reviewDecisions.cjs:83-111 (returns {emailed, mailFailed}, logs raw error :103).

## Rate-limit windows (implicit)
- `console_rate_limits/{key} = { count, windowStart }`, rateLimit.cjs; keys submit-app (applicationStatus.cjs:108), retry-build (buildRetry.cjs:85), invite-org/user (invites.cjs:60-61), connection starts (connections.cjs:64). Fixed window, never cleaned up.

## Signup availability (implicit)
- `readSignupTerms().open` = all console settings valid + a checked agreement (consoleSettings.cjs:186-196). Saving a blank setting or a tampered agreement closes signups and acceptance (agreementAcceptance.cjs:114, :132). Same refusal text duplicated: consoleSettings.cjs:145 and web setup/steps.js:20.
- Agreement versions: monotonically increasing, create-only (consoleSettings.cjs:248-260).

## Guided setup UI (explicit, client)
- Steps: STEPS console/web/src/setup/steps.js:5-14 vs server STEP_IDS applications.cjs:38 (agree); ANSWER_STEPS steps.js:17 vs answers.cjs:24 (agree). Open steps derived openStepIds steps.js:30-35 (agreement opens only when draft + signups open + no errors), server re-derives canEdit/canAccept applications.cjs:128-129.
- Autosave status: idle, waiting, saving, saved, unsaved, error (useAutosave.js:16-62). Server save has no revision check: last write wins between teammates (applicationSave.cjs:62-68).
- Page loading machines: each page hand-rolls data/error/loading/refreshKey/busy/asking booleans (Organizations.jsx:36-39, OrganizationHome.jsx:13-16, ReviewQueue.jsx:16-18, ConsoleSettings.jsx:16-24, SignupLinks.jsx:73-82, useTeam.js:6-11); the two-step confirm (asking+busy) is re-implemented in ConnectionPanel.jsx:24-25, ApplicationStatus.jsx:114-115, SignupLinks.jsx:47-48, TeamMembers.jsx:8-10.

## Workflow job sequences (explicit)
- provision-client.yml: guard -> provision (13 steps, provision-client.cjs:1137-1151) -> "Record a run that stopped" on failure/cancel (provision-client.yml:127-137 -> markStopped).
- deploy.yml resolve -> deploy-client.yml guard -> changes/shared/validate-env -> provision/functions/publisher/content -> build -> hosting (deploy-client.yml:47-700). Concurrency `deploy-client-<client>` (:39-41) is separate from `provision-<appId>`, so decommission does not wait for deploys (runbook tells operators to cancel them by hand, DEPLOY_RUNBOOK.md:1415).
- Run identity by title string: deploy.yml:5 `Deploy <client>[ (bootstrap)]` is matched by provision-client.cjs:1013 and dispatch-security-rollout.cjs:73. Three copies of one naming contract, no shared constant.
- deploy-console.yml: migrate signup links (:97-100) -> deploy (:102-106) -> security rollout on push of the rollout JSON or input (:108-114); rollout file name hard-coded at dispatch-security-rollout.cjs:56 and deploy-console.yml:20.
- publish-site.cjs queue row `publisher.status`: running -> done|failed with failedStage (publish-site.cjs:466, :256-262).
- init-event template apply: `config/template.status` applying -> applied, resumable only by the same template (init-event.cjs:299-345, :534, :743-746).
- Seeding idempotency: missing -> create, seeded -> overwrite, edited -> skip (scripts/lib/idempotency.cjs decideSeedWrite); config docs skip unless --force, bootstrap list additive.
- Provider stamps: `config/providers.ticketing.webhookRegisteredAt/webhookId/registeredFor` (register-ticketing-webhook.cjs:82-89 writes ISO string; provision-client.cjs:1096-1098 resets on account change); sender `domainVerified` set/cleared by verify-sender-domain.cjs:294-307.

## Cross-cutting findings
1. `archived` is written but declared nowhere: add it to the one status list and every label/filter. Evidence: writers decommission-client.cjs:317, :780; lists applications.cjs:35, reviewAccess.cjs:14, reviewText.js:4-17, steps.js:91-99; broken views ApplicationStatus.jsx:270, OrganizationHome.jsx:45, reviewQueue.cjs:31-32. Fix: one shared STATUSES (with archived) and labels generated from it.
2. `launched` is dead (no writer) yet guards and docs depend on it (provision-client.cjs:1252, dispatch-security-rollout.cjs:26, connectionState.cjs:36, mailer.cjs:69, DEPLOY_RUNBOOK.md:1349, ADR 0007:322). Fix: delete it, or add the operator/client action that sets it.
3. Status lists are copied at least 20 times with drift: two STATUSES arrays (applications.cjs:35, reviewAccess.cjs:14), two client STATUS_LABELS (reviewText.js:4, steps.js:91), two different BUILT_STATUSES (connectionState.cjs:36 vs problemReports.cjs:33), literal `['approved','building']` in 6 places, phantom `building-failed` (decommission-client.cjs:273). Fix: export named groups (OPEN, CLOSED, BUILDING, BUILT) from one module and import them in functions, scripts and web.
4. Closed-after-build requests become unrecoverable orphans: closeApplication keeps the project (reviewDecisions.cjs:163-164), archive refuses declined (decommission-client.cjs:314), retention/spam delete the app but leave console_builds (cleanup.cjs:38-39, :71-73), and decommission needs the app or a tombstone (decommission-client.cjs:165). Fix: make retention and spam delete refuse any request with a build record (or route them to decommission), and allow archive of declined.
5. No single status-transition helper: seven code paths write status+history by hand (reviewDecisions.cjs:55 and :154, applicationStatus.cjs:134, agreementAcceptance.cjs:139, provision-client.cjs:1162, decommission-client.cjs:316/:373/:780); one of them skips history (:780). Fix: one `moveStatus(tx, from[], to, by, note)` in console/functions used by scripts too.
6. Build failure is encoded twice (`applications.buildStart.state` and `console_builds.state`) with two unordered writers of `started` (buildDispatch.cjs:143, provision-client.cjs:1304). Fix: keep buildStart only for "dispatch failed/never ran" and make the dispatch write conditional on state still pending.
7. Retry re-reads live console settings and overwrites the saved region (provision-client.cjs:1209-1214, :1319-1322) because `review.settings` is always null (reviewDecisions.cjs:71, :160) yet still read in 3 places. Fix: freeze build settings at acceptance (or prefer saved `resources`) and drop `review.settings`.
8. False invariant in a comment: "A refused acceptance does not use a slot" (applicationStatus.cjs:105) while the slot is taken before the tx (agreementAcceptance.cjs:116). Fix: use `takeSlotIn` inside the acceptance tx, as retryBuild does (buildRetry.cjs:84).
9. Duplicate helpers with different behaviour: notifyOwners (applicationStatus.cjs:58 vs reviewDecisions.cjs:83: return type and log redaction differ), ownerEmails (applicationStatus.cjs:31 vs reviewAccess.cjs:56: dedupe differs), readApplication (applications.cjs:50 vs reviewAccess.cjs:38: org check differs), team listing (organizations.cjs:52 vs reviewQueue.cjs:59). Fix: keep one of each.
10. Pseudo-status `build-failed` means different things to operators ("did not start", mailer.cjs:121) and Owners ("did not finish", mailer.cjs:72). Fix: rename the operator kind `start-failed`.
11. purge --now leaves an `archived` app without `purgeAfter`/history on failure, so neither purge-due nor restore recovers it (decommission-client.cjs:780, :839-840, :339). Fix: set archivedAt/purgeAfter=now and a history entry in that tx.
12. "Build began" inferred from console_builds existence (reviewDecisions.cjs:164, cleanup.cjs:73) while decommission creates that doc for drafts (decommission-client.cjs:201, :283). Fix: use an explicit field (e.g. `resources.projectId` or record `startedAt`).
13. The `Deploy <env>` run title is a cross-workflow contract in three files (deploy.yml:5, provision-client.cjs:1013, dispatch-security-rollout.cjs:73). Fix: one constant/helper used by both scripts, and a test that reads deploy.yml.
14. Two "archive" meanings (console decommission vs event lifecycle, lifecycle.cjs:103, CLIENT_ONBOARDING.md:375) and docs drift (ADR 0007:322-325 says decline only drafts and omits close/archive). Fix: rename console status to `decommissioning`/`disabled` or document both in ADR 0007.
15. Signup-link migration re-quarantines on every deploy (migrate-console-signup-links.cjs:17, :27; deploy-console.yml:97) while the security migration uses a completion marker (migrate-security-data.cjs:16-17). Fix: skip docs already quarantined, or add a marker.
16. UI loading/confirm state is hand-rolled per page (Organizations.jsx:36-39, OrganizationHome.jsx:13-16, ReviewQueue.jsx:16-18, ConsoleSettings.jsx:16-24, SignupLinks.jsx:73-82; confirm pattern in ConnectionPanel.jsx:24, ApplicationStatus.jsx:114, SignupLinks.jsx:47). Fix: one `useLoad` hook and one `ConfirmAction` component.
17. Minor: invites have no revoke and are never deleted (invites.cjs); used signup links outlive deleted apps (cleanup.cjs:61-77); "canceled" (DEPLOY_RUNBOOK.md:1428) vs "cancelled" elsewhere.
