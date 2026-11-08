# Client web app UI and client-side state (apps/web/src, compared with console/web/src)

Scope: React state in the public site and admin shell. I read the files and grepped them. I did not run anything.
Paths are relative to `apps/web/src/` unless they start with `console/` or `packages/`.

## Auth handshake + admin probe  (explicit)
- Entity / storage: React state in `AuthProvider`. `loading` (bool), `adminStatus` and `adminTier` are set at contexts/AuthContext.jsx:149-157. `probeRun` is a counter at :162.
- States: `loading` true/false (the auth handshake). `adminStatus` is `unknown | admin | denied` (:149). `adminTier` is `null | operator | staff | unknown` (:156, :205).
- Transitions: mount -> `loading=false` when onAuthStateChanged fires (:166-169). Signed out -> `adminStatus='denied'`, `tier=null` (:177-181). A new user -> `unknown` (:184-191). Then the two probes, `cmsContent_drafts` and `admin_logs` (:198-201), move it to `admin`/`denied` and set the tier (:203-207). `refreshAdminStatus` bumps `probeRun` (:214-216). The rerun keeps the old verdict until the new one lands (:184 guard).
- Terminal / reversibility: none. The state follows the user.
- Other copies:
  - console/web/src/auth.jsx:96-100 is a second provider with `{user, ready}`. `ready` is the inverse of `loading`. It uses `onIdTokenChanged` to solve the same "same-UID sign-in fires no event" problem. The web app instead patches `setUser` by hand after OTP (AuthContext.jsx:252-258).
  - Consumers gate on `loading || (user && adminStatus==='unknown')` (admin/AdminApp.jsx:124). Admin WebMCP gates on `adminStatus==='admin'` (webmcp/AdminWebMcpRegistration.jsx:16). ProfileSetupRedirect gates on `adminStatus!=='denied'` (components/ProfileSetupRedirect.jsx:35). useAccountViews gates on `adminStatus==='admin'` (hooks/useAccountViews.js:59).
- Problems:
  - `adminStatus` cannot tell "drafts probe failed for a non-permission reason" apart from "not an admin". Any probe result other than `ok` becomes `denied` (:195, :203, :207). A transient failure therefore shows an admin the denial screen. The tier probe does have an `unknown` state for exactly this case (:205).
  - When the tier is `unknown`, the shell draws the staff docket (admin/AdminLayout.jsx:531-532) and shows a retry bar (:804-812).

## Own account document (ProfileContext)  (explicit, derived)
- Entity / storage: the `users/{uid}` listener (lib/profileSource.js:52-66). `status` is derived at contexts/ProfileContext.jsx:64.
- States: `signed-out | pending-account | ready`. `needsProfileSetup` is derived as `ready && !isProfileComplete` (:74).
- Transitions: uid null -> signed-out. uid set -> pending-account (:44-46). A snapshot with a doc -> ready. A snapshot with no doc -> back to pending-account (:48-49).
- Terminal / reversibility: reversible.
- Other copies:
  - The server writes `profileComplete`. The client never reads that field and recomputes it with shared `isProfileComplete` (packages/shared/src/profile.cjs:176). Both copies use the same predicate, so they agree.
- Problems:
  - `pending-account` has no exit when the doc is never created, is deleted, or the listener errors. subscribeWithRetry never calls onNext on an error (lib/retrySubscription.js:33-41). The result is a permanent spinner or placeholder at pages/Dashboard.jsx:38, pages/SpeakerDashboard.jsx:79 and pages/Profile.jsx:180, with no retry and no error copy.
  - "Listener failing" is folded into "account not seeded yet".

## OTP sign-in form  (explicit)
- Entity / storage: in components/SignInPanel.jsx:103-112:
  - `step` (`email | code`)
  - `busy` (`null | send | verify | google`)
  - `error` (`{field: email|code|null}`)
  - `retryAt`, `expiresAt` and `rateLimitMessage`
- States: email -> code. Only "Use a different email" goes back (`setStep('email')`, ~:404).
- Transitions:
  - The send succeeds -> code (:159-163).
  - A 429 sets the countdown and stays on the current step (:165-176).
  - Verify signs the user in (:198-200).
  - Google sign-in (:213-228).
- Guards: client regexes before each call (:141, :192). Each button disables only for its own `busy` value (:265, :303, ~:353). So Google sign-in and code send can run at the same time.
- Problems:
  - Code expiry is display-only (`expirySeconds`). Verify still runs after expiry and relies on the server.
  - Firebase popup-cancel codes are compared by hand at :218-220. The console maps the same codes in a table (console/web/src/auth.jsx:75-93).
  - `OtpRequestError` (AuthContext.jsx:89) is one of 11 hand-written HTTP error classes (see cross-cutting #4).

## Session pitch stepper  (explicit, re-derives a server lifecycle)
- Entity / storage: the draft lives in sessionStorage `session-pitch-draft-v2` (lib/pitchDraft.js:7). A v1 draft is migrated (:59-63). Page state is at pages/SessionPitch.jsx:58-67. Step state is computed at :100-105.
- States:
  - per step: `done | todo | locked` (:102-104; vocabulary at components/forms/Stepper.jsx:30-32)
  - page: `!modeKnown` (blank) | externalForm | saved | step view (:165-197)
  - call: `open/closed`, derived from `isPitchCallOpen` (:93)
- Transitions:
  - Next validates with shared `checkPitch` for that step, then marks it visited (:118-124).
  - A locked address redirects to the first open step (:197).
  - Submit validates all steps, checks open, checks email, then sets busy and calls `submitSessionPitch` (:126-149). Success sets `saved` and clears the draft (:80-83).
  - Every edit mints a new idempotency key (:110).
- Terminal / reversibility: `saved` is terminal until "Pitch another session" (:190).
- Other copies:
  - The open/closed check is re-implemented in lib/usePitchCallOpen.js:15-31. That copy has its own subscription and a deadline timer. The page ticks every 1 s instead (SessionPitch.jsx:76-79), and a read error means closed in both.
  - The server enforces the same `isPitchCallOpen`. These agree because the predicate is shared.
- Problems:
  - Two subscriptions and two clocks for one fact.
  - `configError` reads "Checking your connection…" for ever (:157). There is no retry beyond subscribeWithRetry.

## Registration answers stepper  (explicit)
- Entity / storage: the load object is `{status: loading|ready|error, asked}` (lib/useRegistrationTargets.js:40). Page flags are `pinnedForm`, `formStale`, `closed`, `saving`, `notice` and `failure` (pages/CompleteRegistration.jsx:83-91).
- States:
  - per step: `done | todo` (:176, :178). `locked` is never used, unlike the pitch stepper.
  - page: loading-auth | signed-out | nothing-to-answer | error | loading | no-ticket | closed | stepping (:112-169)
- Transitions:
  - Next validates with shared `checkAnswers`, then saves (:199-232).
  - Server code `form-changed` -> notice + stale (:219-221). The stale flag clears once the live revision differs (:100-106).
  - `registration-closed` -> `closed` (:222-223). This is terminal for the mount.
  - `bad-request` -> field errors parsed from the message (:38-46, :224-225).
- Other copies:
  - The server registration-window lifecycle is learned only from the save error. The client has no up-front closed state.
  - `fieldErrorsOf` here duplicates admin/adminApi.js:64 (`fieldErrorsOf`), which uses a different regex.
- Problems:
  - A form-listener error calls `setForm(null)` (useRegistrationTargets.js:44), which renders "nothing to answer" (CompleteRegistration.jsx:128-129). An error looks the same as "no form".
  - The steps are not locked, so Review can open with unsaved targets (it shows "Not saved yet").

## Speaker profile stepper  (explicit, re-derives the speaker lifecycle)
- Entity / storage: `load {status}` (pages/SpeakerProfile.jsx:140), `saved[]` slugs (:143), `submitted` (:145), `saving` (:147). `savedPayloadsRef` skips saving a step that did not change.
- States:
  - per step: `done | todo` (:294)
  - load: `loading | ready | error` (:185-217)
  - the speaker status copy table `draft, invited, accepted, approved, removed` (:48-63)
- Transitions:
  - Next saves the step, then navigates (:366-378).
  - Submit saves every changed step, then calls `submitOwnSpeakerProfile` (:380-402).
  - `result.staged` from the server decides the "Saved for review" copy and whether photo deletion is safe (:339-357).
- Other copies:
  - The speaker statuses are hard-coded here. The canonical list is packages/shared/src/speaker.cjs:39.
  - lib/speakerDashboardEligibility.js:1 `['accepted','approved']` duplicates shared `REMINDABLE_SPEAKER_STATUSES` (packages/shared/src/speakerReadiness.cjs:56).
  - admin/pages/AdminSpeakersList.jsx:84-85 and admin/pages/AdminSpeakerEditor.jsx:87-88 each map `status!=='approved'` to "draft".
- Problems:
  - Errors go to a toast (:376, :401), while the other two steppers use inline alerts. Three steppers on one Stepper component handle errors three ways.

## Generic async-load object  (implicit, many copies)
- Entity / storage: `useState({status:'loading'|'ready'|'error', ...})`, sometimes with `idle` or a `scope` key.
- Copies (13 files with `status: 'loading'`):
  - lib/useRegistrationTargets.js:40
  - pages/SpeakerProfile.jsx:140
  - pages/SpeakerDashboard.jsx:51-58 (adds `scope` and `idle`)
  - pages/MySchedule.jsx:63-70 (`pdfState`: idle/loading/error)
  - pages/AttendeeProfile.jsx
  - pages/OrganizationProfile.jsx
  - pages/Schedule.jsx
  - components/SessionMaterialsList.jsx
  - components/speaker/SpeakerActionItems.jsx
  - components/speaker/SpeakerSessionMaterials.jsx
  - admin/pages/AdminSpeakerReminders.jsx
  - admin/pages/AdminSpeakerMail.jsx
  - admin/components/AnnouncementEmailComposer.jsx
- Problems:
  - Each copy writes its own cancellation flag (`let active/current = true`) and its own retry counter (`attempt`). Examples: useRegistrationTargets.js:41,55,79 and SpeakerDashboard.jsx:52-60.
  - Stale-scope protection exists only in SpeakerDashboard (`scope`) and useAdminRecords (`collection`).

## Admin collection listeners (live + drafts)  (implicit)
- Entity / storage: two `subscribeAdminCollection` listeners, `X` and `X_drafts` (admin/adminSource.js:23-40).
- States: `loading = !ready && !error`, `ready = live!==null && drafts!==null`, `error = liveError ?? draftsError`.
- Copies, with the same lines each time:
  - useAdminContent.js:39-49
  - useAdminOrganizations.js:29-38
  - useAdminPages.js:37-51
  - useAdminSessions.js:34-42
  - useAdminTimeline.js:32-41
  - useAdminUpdates.js:35-49
  - The generic admin/useAdminRecords.js:24-66 already does this and also guards against a collection switch (:30, :50). Only AdminVersionHistory and AdminVersionRecords use it.
  - useAdminSpeakers.js:41 is a single-listener variant.
- Derived state: `recordStateOf` gives `draft | live | dirty | unknown` (admin/recordState.js:32-37). The UI re-derives the publish lifecycle from `draft.status === 'dirty'`. `deadMatter` is an ad-hoc fifth state (:55).
- Problems:
  - Six hand copies of useAdminRecords.
  - `unknown` (:36) is a dead state, because merged rows always have live or draft.

## Loading-stage timer  (explicit)
- Entity / storage: lib/useLoadingStage.js:8-28.
- States: `initial -> active (1 s) -> slow (10 s) -> prolonged (60 s)`. `restart()` resets it.
- Renderers:
  - components/LoadingState.jsx:55-62, with retry only when the caller passes `onRetry`
  - admin/components/adminChrome.jsx:127-134 `AdminLoadingState` (no retry)
  - components/LoadingStatus.jsx:3-6 (the copy)
  - FeedbackModal submission (components/FeedbackModal.jsx:93)
- Other copies:
  - console/web/src/LoadingState.jsx:10-18 has its own timers with the same thresholds. The last state is named `extended`, not `prolonged`, and the copy is different.
  - pages/specimen/sections/FeedbackSection.jsx:136 drives the stage by hand.
  - Plain `<p role="status">Checking your sign-in…</p>` bypasses the component (pages/MyTickets.jsx:61, pages/TicketStatus.jsx:100,116).
- Problems:
  - Value drift `prolonged` vs `extended`.
  - The public LoadingState is used in 15 files, and none passes `onRetry` in the pages checked. The `prolonged` retry button is effectively unused.

## Autosave  (explicit; two implementations)
- web: hooks/useSessionNote.js:24-195 has states `loading | editing | saving | saved | error`.
  - It has a debounce, a serial write queue (:40, :56-63), "latest edit wins" (:69-71) and a forced flush on identity change (:128-146).
  - `loading` is held twice: as a boolean (:32) and as the `loading` state (:34, :103, :191).
  - With no uid it reports `saved` (:96), so "nothing to save" and "saved" are the same value.
- console: console/web/src/setup/useAutosave.js:16-62 has states `idle | waiting | saving | saved | unsaved | error`.
  - It has a debounce, a serial chain, and keeps a failed value pending.
  - Bug: a save that finishes while a newer value is queued sets `saved` (:44) and overwrites the `waiting` that `queue()` set (:61). The UI says "Saved." while unsaved input is pending. useSessionNote guards this case (:71). useAutosave does not.
- Drift: `editing` vs `waiting`. The idle state is `saved` in one and `idle` in the other. Only the console has `unsaved`.

## Save / publish feedback in admin editors  (implicit)
- Entity / storage: `[status,setStatus]=useState('')` used as free text in:
  - AdminPageEditor.jsx:201, :432
  - AdminSessionEditor.jsx:128, :255
  - AdminSpeakerEditor.jsx:188, :253
  - AdminUpdateEditor.jsx:112
  - AdminTimelineEditor.jsx:86, :161-164
  - AdminOrganizationEditor.jsx:107, :209
  - AdminContentBlockEditor.jsx:281, :523, :547
  - AdminInvoiceEditor.jsx:117-118
  - AdminBranding.jsx:367
- States: '' -> message. Each editor clears it before its next save.
- Other copies:
  - admin/useSavedMessage.js:4-13 ties a message to the values it saved. Only 4 files use it.
  - About 75 other `notice/result/saved/feedback` text states exist across admin components (grep count).
  - The console uses `ActionFeedback`/`ActionResult` (console/web/src/ActionFeedback.jsx:6-40).
- Problems:
  - Copy drift: "It is not public until you publish." (PageEditor:432, ContentBlockEditor:523) vs "It is not live until you publish it." (Session/Org/Timeline). This sits beside recordState.js, which claims "one term per flow".
  - The unsaved-leave guard (admin/useUnsavedNavigation.js) is in Page, ContentBlock, Session, Speaker and Invoice editors. It is missing from AdminOrganizationEditor, AdminTimelineEditor and AdminUpdateEditor. No other file uses beforeunload.

## Calendar sync card  (explicit)
- Entity / storage: components/schedule/CalendarSyncCard.jsx:26 `state`, plus refs `busyRef`, `requestedRef` (coalescing), `tokenRef`, `completedKeyRef`. The calendar id is in localStorage (lib/calendarSync.js:30-58).
- States: `idle | syncing | synced | partial | refused | error` (:47, :82, :86, :89).
- Transitions:
  - click/input change -> syncing -> synced/partial, or refused (scope denied), or error.
  - A 401 drops the token (:88).
  - A queued resync runs in `finally` (:93-95).
  - An input key change auto-resyncs only while a token is held (:100-103).
- Terminal: none. It is keyed by uid in pages/MySchedule.jsx:282.
- Problems: low risk. The `busyRef` and `state==='syncing'` pair holds the same fact twice.

## Small UI machines
- Schedule copy: `idle | copied | error` (pages/Schedule.jsx:227, :263). There is no reset back to idle.
- Content overlay: per-collection `null` = snapshot, array = live. `source: live|snapshot` (contexts/ContentContext.jsx:160-168, :293-294). `loading` is hard-coded `false` (:307), and the file says the consumer branches are dead by design (:36-42; e.g. pages/MySchedule.jsx:194).
  - WebMCP renames `snapshot` to `generated-snapshot` (webmcp/publicTools.js:93, :141-142).
- Theme remaps: bounded retry `remapsRetry`/`remapsAttempts` (contexts/EventConfigContext.jsx:191-226). Font readiness `ready|loading|unavailable` (lib/themeRuntime.js:562-596).
- Chunk reload: a one-shot sessionStorage flag `eventrunner:chunk-reload` (lib/chunkReload.js:15, :69-78, :86-92). ChunkErrorBoundary has `failed` (components/ChunkErrorBoundary.jsx:22-27). A storage failure counts as "already reloaded" (safe default).
  - admin/tourState.js:23-28 treats a storage failure the opposite way ("not done"), so the tour reappears every load in a private window.
- Error reporting: a module-level `sentCount` cap of 20 and a 30 s dedupe map (lib/errorReporting.js:61-78). `functionsOrigin` is copied from AuthContext.jsx:66 into errorReporting.js:88.
- Subscription retry: fixed 15 s re-attach (lib/retrySubscription.js:12-50). It never surfaces an error state, so callers add their own `error` flags.
- Demo / read-only:
  - `IS_DEMO` is a compile-time flag (lib/demoMode.js:17). lib/demoModeFlag.js:3 has the same values as a function.
  - `isReadOnlyDemo = IS_DEMO || eventConfig.historicalDemo` (lib/readOnlyDemo.js:4-6).
  - 25 files gate on `IS_DEMO` only, and 13 use `historicalDemo`/`isReadOnlyDemo`. For example, pages/SessionPitch.jsx:73,157 and pages/SpeakerAccept.jsx:99,173 ignore `historicalDemo` and rely on sign-in being disabled elsewhere.
  - components/Layout.jsx:360 also keys behaviour on `eventConfig.shortName === 'NC Local'`.
- WebMCP mount refcount: `mounts`, `registrationTask` (webmcp/registration.js:32-89). There is a race: a remount after the `mounts>0` re-check at :78 but during the unregister `Promise.all` (:79-83) reuses a record whose tools are being removed. The record is then left mounted with no tools.
- Ticket order status (UI re-derivation):
  - Local sets `COMPLETE`/`TERMINAL`, `exception`, `refunded` and the show-tickets list (pages/TicketStatus.jsx:16-17, :41-45). There is no shared constant.
  - lib/ticketingCommerce.js:128-142 `ticketStatusLabel` mixes order, payment, refund, ticket and audit-event statuses in one map, with synonyms (`paid`/`succeeded`, `complete`/`completed`/`fulfilled`).

## Cross-cutting findings
1. **Six hand copies of the admin two-listener loading machine.** They are useAdminContent/Organizations/Pages/Sessions/Timeline/Updates (e.g. admin/useAdminPages.js:37-51). The generic admin/useAdminRecords.js:24-66, which also guards against a collection switch, already exists. Fix: make each hook a one-line `useAdminRecords('cmsPages')` wrapper.
2. **Async-load state rewritten in 13+ files.** Each has its own `{status:loading|ready|error}`, cancellation flag and `attempt` retry (lib/useRegistrationTargets.js:40-79, pages/SpeakerDashboard.jsx:51-60, pages/SpeakerProfile.jsx:140-217, …). Only two guard against a stale scope. Fix: one `useAsyncResource(key, loader)` hook that returns `{status, data, error, retry}`.
3. **Error states are folded into "empty" or "waiting".**
   - A ProfileContext listener error, or a missing doc, means `pending-account` for ever (contexts/ProfileContext.jsx:47-49,64; lib/retrySubscription.js:33-41).
   - A registration-form error looks like "no form" (lib/useRegistrationTargets.js:44).
   - A failed drafts probe makes an admin `denied` (contexts/AuthContext.jsx:195,207).
   - Fix: give subscribeWithRetry an error callback that flips an `error` state, and add `error` to these three machines.
4. **Two autosave machines with different vocabularies, and one has a status bug.** They are hooks/useSessionNote.js:24 (`loading|editing|saving|saved|error`) and console/web/src/setup/useAutosave.js:16 (`idle|waiting|saving|saved|unsaved|error`). The console version reports `saved` over a pending newer value (useAutosave.js:44 vs :61). Fix: in useAutosave, only set `saved` when `pending.current === undefined`. Longer term, share one hook.
5. **Loading-stage ladder copied between apps, with value drift.** The web app has `initial|active|slow|prolonged` (lib/useLoadingStage.js:16-18). The console has `initial|active|slow|extended` (console/web/src/LoadingState.jsx:12-15). Several pages use a bare `<p role="status">` instead (pages/MyTickets.jsx:61, pages/TicketStatus.jsx:100). Fix: move useLoadingStage into packages/shared (or a shared UI package) and use one name for the last stage.
6. **Eleven bespoke HTTP error classes, and the error parsing is copied too.**
   - The classes: OtpRequestError (AuthContext.jsx:89), AdminApiError (admin/adminApi.js:21), TicketingRequestError (lib/ticketingCommerce.js:6), SpeakerInviteError, TicketClaimError, BookmarkRequestError, ReactionRequestError, MaterialRequestError, ScheduleShareError, SchedulePdfError, CalendarScopeRefusedError.
   - There are two `fieldErrorsOf` parsers (admin/adminApi.js:64; pages/CompleteRegistration.jsx:39). WebMCP has its own status-to-error map (webmcp/adminTools.js:55-69).
   - Fix: one `postFunction(name, body, {auth})` plus one error type with `code/status/fieldErrors`.
7. **Admin save feedback is free text in about 10 editors, with copy drift and an uneven leave guard.** Compare "not public until you publish" (admin/pages/AdminPageEditor.jsx:432) with "not live until you publish it" (admin/pages/AdminSessionEditor.jsx:255). useSavedMessage is used in only 4 files. useUnsavedNavigation is missing from the Organization, Timeline and Update editors. Fix: one `useEditorSave` hook returning `{status, message}` with the copy in recordState.js, and add the guard to the remaining three editors.
8. **Pitch-call open state is computed twice in the client.** The copies are pages/SessionPitch.jsx:72-93 (1 s interval) and lib/usePitchCallOpen.js:15-31 (deadline timer). Fix: SessionPitch should use usePitchCallOpen and expose `settings` from it.
9. **Speaker and order lifecycles are re-spelled in UI files.**
   - Speaker: pages/SpeakerProfile.jsx:48-63, lib/speakerDashboardEligibility.js:1 (a copy of shared/speakerReadiness.cjs:56), admin/pages/AdminSpeakersList.jsx:84-85 and admin/pages/AdminSpeakerEditor.jsx:87-88.
   - Order: pages/TicketStatus.jsx:16-17,41-45 and the mixed-domain label table at lib/ticketingCommerce.js:128-142.
   - Fix: import the status sets from packages/shared and split `ticketStatusLabel` by domain.
10. **Two read-only gates with uneven use.** `IS_DEMO` alone is used in 25 files. `isReadOnlyDemo` (which adds `historicalDemo`) is used in 13 (lib/readOnlyDemo.js:4). components/Layout.jsx:360 also keys on the event name. Fix: route every write or sign-in gate through `isReadOnlyDemo`, and replace the name check with a config flag.
11. **Two auth providers solve the same problem two ways.** The web app uses onAuthStateChanged with a manual same-UID patch (contexts/AuthContext.jsx:165-169,252-258). The console uses onIdTokenChanged (console/web/src/auth.jsx:98-100). The flags are also inverted: `loading` vs `ready`. Fix: use onIdTokenChanged in the web app too and drop the manual patch.
12. **Browser-storage wrappers are written nine times in the web app.** They are layoutPreference, tourState, accountViews, calendarSync, changeRequestMarker, chunkReload, pitchDraft, ticketingCommerce and NoticeBar. There is one more in console/web/src/auth.jsx:24-40. Their fallback policies conflict: chunkReload.js:126-133 treats a storage failure as "done", while tourState.js:23-28 treats it as "not done". Fix: one `safeStorage` helper with an explicit fallback argument.
13. **Copied files between the two apps.** These are lib/recentMessages.js and console/web/src/recentMessages.js (both 40 lines), and admin/components/ReportProblemDialog.jsx:46-52 and console/web/src/ReportProblem.jsx:18-23. The dialog has the same `kind/description/busy/error/sent` machine in both. Fix: share them through packages/shared or a small UI package.
14. **Dead or duplicated states.** These include:
    - `recordStateOf` → `unknown` (admin/recordState.js:36)
    - ContentContext `loading:false` (contexts/ContentContext.jsx:307) and the consumer branches that test it
    - the `prolonged` retry with no callers passing `onRetry` (components/LoadingState.jsx:27)
    - `loading` held as both a boolean and a state in useSessionNote (hooks/useSessionNote.js:32,34)
    - `busyRef` alongside `state==='syncing'` (components/schedule/CalendarSyncCard.jsx:23,47)

    Fix: remove each one or collapse the pair to a single source.

### Pattern census (non-test files under apps/web/src, from grep)
- `useState` names that look like loading/ready flags: 22. Busy/saving/submitting/pending flags: 91. Error states: 165. `status` states: 28. Message states (notice/result/saved/feedback): 75.
- Loading renderers: 4. They are LoadingState/LoadingStateView, AdminLoadingState (used in 52 files), bare `role=status` text, and the console LoadingState.
- Stage timers: 3. They are useLoadingStage, the inline timers in console LoadingState, and the specimen's manual stage.
- Autosave machines: 2.
- Saved-message helpers: 1 (useSavedMessage), next to roughly 75 ad-hoc message states.
- Retry mechanisms: 6+. They are subscribeWithRetry (fixed 15 s), theme remaps (bounded backoff), chunk reload (one shot), `attempt` counters (registration, speaker dashboard), the TicketStatus refresh counter, and LoadingState `onRetry`.
- Steppers: 3 on one Stepper component. Only the pitch stepper uses `locked`. Each handles errors differently: inline alert, inline alert plus notice, or toast.
