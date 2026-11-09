# Audit 04: apps/web/src/admin

Scope: `/home/user/eventrunner/apps/web/src/admin/` (319 files: 201 production, 118 tests).
Read-only. Nothing in the repository was changed. Nothing was run in a browser; no suite, build or emulator was started.

Coverage note, so the director can weigh "not found": the 42,700 production lines were not all read line by line.
Every file was covered by the mechanical checks listed under "Checked and found correct". The files listed under
"Files read" were read by eye. The JSX render halves of the large pages were mostly not read by eye.

Findings are ordered by severity. Paths are relative to `apps/web/src/admin/` unless they start with a top-level folder.

---

### 1. The unsaved-changes guard stays off for the rest of an editor's life after one "Discard"
- Category: broken
- Confidence: likely (traced in code; not run in a browser)
- Where: `useUnsavedNavigation.js:53` (declared), `:76`, `:87`, `:124` (the three guards return early on it), `:148` (set to `true`). No line sets it back to `false`.
- Evidence:
  ```js
  const allowLeaveRef = useRef(false);            // :53
  if (allowLeaveRef.current) return;              // :76 beforeunload, :87 link click
  if (!unsavedRef.current || allowLeaveRef.current) return;   // :124 popstate
  function discard() { ... allowLeaveRef.current = true; ...  // :148
  ```
  `grep -n allowLeave useUnsavedNavigation.js` shows one write, and it is `true`.
- How it is reached / impact: the ref lives as long as the component instance. React Router keeps the instance when the next address renders the same component at the same position (the invoice editor says so itself: `pages/AdminInvoiceEditor.jsx:100-102`, `:169-173`). One concrete path:
  1. Open invoice A, press Duplicate. `AdminInvoiceEditor.jsx:482` pushes `/admin/invoices/<B>` (no `replace`).
  2. Edit B, press the browser Back button, choose Discard. `allowLeaveRef` becomes `true`; the page lands on invoice A in the same instance.
  3. Edit A (a draft). Click any rail link, close the tab, or press Back. No dialog and no `beforeunload` prompt; the edits are lost.
  The same holds for any Back/Forward between two records of one editor route, and for the three list pages that guard an unsaved order (`AdminPagesList.jsx:174`, `AdminOrganizationsList.jsx:63`, `AdminContentSection.jsx:78`) if a discard ever leaves them mounted.
- Proposed fix: in `useUnsavedNavigation.js`, reset the ref when the form is clean again, in the existing `[unsaved]` effect at `:62-70`: `if (!unsaved) { editorIdxRef.current = null; allowLeaveRef.current = false; return; }`. Add a case to `useUnsavedNavigation.test.jsx`.

### 2. The Email log's Source list is missing eight sources the server stamps
- Category: inconsistent
- Confidence: certain on the mismatch; owner-decision on which labels to add
- Where: `pages/AdminEmailLog.jsx:65-76` (`SOURCE_LABELS`), used at `:113` (URL filter), `:210` (Source column), `:517` (Source select).
- Evidence: the comment at `:65` says "Every `source` a sender stamps on its row". The list has nine keys. The server also sends email with:
  `speaker-reminder` (`functions/src/speakers/reminderCore.cjs:215`), `speaker-profile` (`speakers/profileSteps.cjs:93`), `admin-access` (`admin/accessMail.cjs:88`), `change-requests` (`admin/changeRequestNotices.cjs:220`), `invoice` (`admin/invoiceEmail.cjs:221`), `attendee-approval` (`users/approval.cjs:215`), `session-pitches` (`sessions/pitchNotices.cjs:163`), `ticketing-confirmation` (`ticketing/commerceEmail.cjs:88`).
- How it is reached / impact: each of those messages shows "Other email" in the Source column, staff cannot pick them in the Source filter, and `/admin/email-log?source=invoice` is dropped by `readFilters` (`:113`). The server would accept the filter (`functions/src/email/log.cjs:182`, any id matching `SOURCE_RE`). The "Other email" fallback itself is deliberate (`AdminEmailLog.test.jsx:164`), so this is a stale list and not a crash.
- Proposed fix: add the eight keys with labels to `SOURCE_LABELS` in `pages/AdminEmailLog.jsx`. Check `docs/ADMIN_GUIDE.md:864` still reads correctly.

### 3. `QUOTE_HINTS` is exported, tested and never shown; the block editor uses a different inline copy
- Category: inconsistent / unneeded
- Confidence: certain
- Where: `blockTypes.js:155-172` (comment and export), `pages/AdminContentBlockEditor.jsx:90-95` (inline copy), `blockTypes.test.js:12,69` (the only importer).
- Evidence:
  ```js
  // AdminContentBlockEditor.jsx:90
  const FIELD_HINTS = Object.freeze({
    stat: STAT_CONTRACT_HINTS,
    fact: FACT_HINTS,
    quote: { text: 'Use the speaker’s exact words, without quotation marks.', attribution: 'Who said it, and in what role.' },
    sponsor_package: SPONSOR_PACKAGE_HINTS,
  });
  ```
  `grep -rnw QUOTE_HINTS apps packages e2e scripts docs functions console` finds only `blockTypes.js` and `blockTypes.test.js`. The split came in commit 8674161.
- Impact: the comment at `blockTypes.js:155` says the quote hints are "shown under the field in the block editor"; they are not. The test "writes a hint only for a field the block type has" checks text nobody sees and does not check the text the editor shows. The exported text also carries a fact the shown text lost (the first quote on a page is set as the pull quote).
- Proposed fix: either delete `QUOTE_HINTS` and its entry in `blockTypes.test.js:69`, or move the wanted wording into `QUOTE_HINTS` and write `quote: QUOTE_HINTS` in `AdminContentBlockEditor.jsx:93`.

### 4. Tickets "Load more" sends the form's current filter with the previous search's cursor
- Category: broken (low severity)
- Confidence: likely
- Where: `pages/AdminTicketing.jsx:354-373` (`search`), `:452` (Load more).
- Evidence: `search(true)` builds the body from the live `email` and `status` state and adds `cursor`. The cursor is a timestamp (`functions/src/ticketing/csvImport.cjs:362-369`, `startAfter(cursor)`), so the server accepts it under any filter.
- How it is reached: search with status "Any", change the Status select or the Email field without pressing Search, press Load more. Rows of the new filter that are older than the cursor are appended under the old filter's rows, with no sign the list is mixed.
- Proposed fix: keep the applied filter with the result, as `AdminEmailLog.jsx:364-369` does (`applied`), and have Load more send that. File: `pages/AdminTicketing.jsx`.

### 5. Dead exports that only tests (or nothing) import
- Category: unneeded
- Confidence: certain (whole-repository grep for each name: apps, packages, functions, console, scripts, e2e, docs)
- Where and evidence:
  - `versionHistory.js:58` `recordNameOf`, `:138` `valueText`, `:165` `pathText`: only `versionHistory.test.js` imports them. The screens use `pages/versionDisplay.js` (`versionRecordName`, `versionValue`, `versionFieldLabel`) instead. With them go the helpers only they use: `NAME_FIELDS`, `MAX_NAME_LENGTH`, `nonEmpty`, `cut` (`:38-47`) and `isScalar` (`:128`).
  - `updatesDoc.js:187` `extrasOf`: no importer at all, not even a test.
  - `reminderSchedules.js:13` `dayCount`: no importer at all. `components/AttendeeReminderSchedule.jsx:60` has its own identical `dayWords`.
  - `sessionDoc.js:112` `sessionIdFromTitle`: only `sessionDoc.test.js:87` calls it. The editor mints ids through `lockEditorialId` (`sessionDoc.js:107`). Note that `functions/src/schedule/sessions.cjs:136` and `scripts/lib/site-manifest.cjs:78` name this function in comments as "the editor's rule", so decide whether those comments or this function is the stale side.
  - `pendingChanges.js:71` `recordNameOf` and `:51` `fullNameOf`: `groupPending` (`:127-128`) still computes `name` and `fullName` with them, and the only caller overwrites both (`pages/AdminUnpublishedChanges.jsx:322-323`, with `versionRecordName`). The work is done and thrown away for every row.
- Proposed fix: delete the listed functions and their test cases; drop `name`/`fullName` from `groupPending` in `pendingChanges.js` (and from `pendingChanges.test.js`); in `AttendeeReminderSchedule.jsx` either import `dayCount` or delete `dayCount`.

### 6. CSS rules no element uses
- Category: unneeded
- Confidence: certain (each class name appears only in its own CSS file across apps, e2e, docs, scripts, video, tasks; no template string builds them)
- Where:
  - `adminWorkspace.css`: `.admin-figure-grid` (`:7`, `:70`, `:76`), `.admin-figure-card` and `__body`, `--attention`, `--wide` (`:8-15`, `:23`, `:71-72`, `:77`), `.admin-figure-breakdown` (`:19-21`, `:90-96`), `.admin-card-action` (`:24`, `:64`, `:66`), `.admin-overview-detail-grid` (`:31-32`, `:78`, `:97-98`), `.admin-block-type-choices` (`:44-45`, `:241`), `.admin-content-settings-toggle` (`:60`), `.admin-feature-card__key` (`:183`).
  - `communicationsWorkspace.css`: `.admin-email-workspace__steps`.
  - `contentBrowser.css`: `.admin-content-page-path`, `.admin-content-browser__note`.
- Impact: bytes in the admin entry stylesheet (`adminWorkspace.css` is imported by `AdminLayout.jsx:65`). `.admin-figure-total` and `.admin-figure-note` in the same block are still used and must stay.
- Proposed fix: delete those rules from the three CSS files.

### 7. Single-document screens listen to whole collections
- Category: inefficient
- Confidence: owner-decision (the collections are small on a small event; the cost grows with the event)
- Where:
  - `pages/AdminSessionPitch.jsx:262`: one pitch's review page listens to all of `session_pitches` and picks one row (`:264`).
  - `components/SpeakerSessionConfirmations.jsx:157-161`: every speaker editor listens to all of `session_confirmations` (one document per speaker and session) and filters by `speakerId` in the browser (`:169-171`).
  - `pages/AirtablePitchSync.jsx:66-74` (`useDoc`), `pages/AdminPitchSettings.jsx:26-29`, `pages/AdminChangeRequests.jsx:267`: each reads a collection to find one document id (`airtable`, `notices`).
- Evidence: `adminSource.js:51` already has `subscribeAdminDoc`, used once (`components/SpeakerLogisticsPanel.jsx:19`). `firebase.js:25` uses plain `getFirestore` (memory cache), so each mount reads every document again. `firestore.rules:662-679` allow an admin a single-document read and a filtered query on these collections.
- Proposed fix: use `subscribeAdminDoc('session_pitches/<id>')` in `AdminSessionPitch.jsx`, and `subscribeAdminDoc` in the three settings readers. For confirmations, add a `where('speakerId', '==', speakerId)` query (a small helper beside `subscribeAdminCollection` in `adminSource.js`).

### 8. Small helpers copied between admin files
- Category: unneeded (duplication)
- Confidence: certain on the copies; owner-decision on whether to merge
- Where:
  - `toDate(value)`: identical in `pages/AdminChangeRequests.jsx:119`, `pages/AdminFeedback.jsx:54`, `pages/AdminLiveUpdates.jsx:38`; near-identical in `components/PitchNotes.jsx:15`.
  - `toMillis(value)`: three versions with different accepted inputs: `versionHistory.js:75` (Date, Timestamp, number), `pendingChanges.js:24` (adds `toDate()`), `components/ChangeRequestEmails.jsx:44` (adds ISO strings). Five files import the `versionHistory.js` one for data that has nothing to do with version history.
  - `formatIn` / `withZone` / `formatClock`: `pages/AdminEmailLog.jsx:135-162` repeats `versionHistory.js:89-126`; `pendingChanges.js:83` (`formatPublishedAt`) is a third copy of the same formatter.
  - `GalleyHead`: `pages/AdminTicketing.jsx:86`, `pages/AdminEmailLog.jsx:194`, `pages/AdminAccess.jsx`.
- No copy exists in `apps/web/src/lib` or `packages/shared` for these (`grep -rnE "export (function|const) (toMillis|toDate)" apps/web/src packages/shared` finds only the two admin exports), so nothing here ignores an existing shared helper.
- Proposed fix: one `adminTime.js` with `toMillis`, `toDate` and the zone formatter, imported by the files above. Low priority.

### 9. Stale comments and leftovers (one line each)
- Category: unneeded / inconsistent
- Confidence: certain
- `adminApi.js:7` names "AdminGate.jsx"; no such file exists. `AdminGate` is in `AdminApp.jsx:117`.
- `adminApi.js:45-52`: the JSDoc for `fieldErrorsOf` sits above the JSDoc for `fieldLabel`, so it documents the wrong function.
- `AdminLayout.jsx:615` and `:619` test the same thing twice; the second (`closest('dialog, [role="dialog"]')`) covers the first.
- `contentEditState.js`: `contentEditSnapshot` is a plain alias of `contentEditKey`.
- `pages/AdminDataExport.jsx:6-7`: the header lists the staff-tier spreadsheets without Speaker logistics, which the list below it (`:59`) and the server both have.

---

## Files read

By eye, in full: `AdminApp.jsx`, `AdminLayout.jsx`, `PendingChangesContext.jsx`, `adminApi.js`, `adminSource.js`, `pendingChangesSource.js`, `pendingCountsSource.js`, `publishRunsSource.js`, `useAdminRecords.js`, `useAdminSessions.js`, `useAdminPages.js`, `useAdminSpeakers.js`, `useOrganizationRepresentatives.js`, `useDirtyDrafts.js`, `useUnsavedNavigation.js`, `tourState.js`, `plannerErrors.js`, `contentError.js`, `contentBrowser.js`, `contentEditState.js`, `recordState.js`, `publishResult.js`, `collectionWords.js`, `speakerRecord.js`, `sessionPopularity.js`, `pitchConversion.js`, `pitchStatus.js`, `pitchCallSettings.js`, `featureChoices.js`, `downloadFile.js`, `themeColors.js`, `components/useModalDialog.js`, `components/communicationsErrors.js`, `components/SpeakerSessionConfirmations.jsx`, `components/SpeakerLogisticsPanel.jsx`, `components/PitchCallSettings.jsx`, `pages/AdminAttendees.jsx`, `pages/AdminTicketing.jsx`, `pages/AdminOverview.jsx`, `pages/AdminSessionPitches.jsx`, `pages/AdminPitchSettings.jsx`, `pages/versionDisplay.js`.

By eye, the logic half (hooks, effects, handlers; not all of the JSX): `pages/AdminEmailLog.jsx`, `pages/AdminSystemErrors.jsx`, `pages/AdminMaterialsTab.jsx`, `pages/AdminVersionHistory.jsx`, `pages/AdminPageEditor.jsx`, `pages/AdminFeedback.jsx`, `pages/AdminLiveUpdates.jsx`, `pages/AdminInvoiceEditor.jsx` (lines 100-200), `pages/AdminSessionPitch.jsx` (the page component), `pages/AirtablePitchSync.jsx` (the readers), `pages/AdminDataExport.jsx` (lines 1-110), `pages/AdminFeatureSettings.jsx` (lines 1-80), `pages/AdminAccess.jsx` (the reload timer), `versionHistory.js`, `pendingChanges.js`, `blockTypes.js` (hints), `updatesDoc.js` (lines 175-227), `reminderSchedules.js` (lines 1-30), `components/media/AssetModal.jsx` (lines 30-75).

Mechanical checks only (not read by eye): the other pages and components, among them `AdminBranding.jsx`, `AdminEventSettings.jsx`, `AdminContentBlockEditor.jsx`, `AdminSessionEditor.jsx`, `AdminSpeakerEditor.jsx`, `AdminOrganizationEditor.jsx`, `AdminUpdateEditor.jsx`, `AdminTimelineEditor.jsx`, `AdminRecordImport.jsx`, `AdminAnnouncements.jsx`, `AnnouncementEmailComposer.jsx`, `AdminSpeakerReminders.jsx`, `AdminReminderSchedules.jsx`, `AdminChangeRequests.jsx`, `AdminUnpublishedChanges.jsx`, `AdminSetup.jsx`, the Invoice and Stripe components, `ThemeProof.jsx`, `VenueReferenceEditor.jsx`, `RichTextEditor.jsx`, `formControls.jsx`, `presetCopy.js`, `invoiceDoc.js`, `recordImport.js`, the media components, and all 118 test files. A bug that needs a human reading of those files is not ruled out.

## Checked and found correct

- Endpoint names: every name the admin posts to (76 literal `call('…')` names, plus `approveUser`, `revokeUser`, `cmsGetVersionHistory`, `organizationRepresentatives`, `speakerMailTemplates`, `invoicePdf`, `downloadSessionMaterialsArchive`, `downloadEventPackage`, and the restore endpoints) is an export of `functions/index.js` (checked against the 164 keys of `require('./index.js')`).
- Firestore reads against `firestore.rules`: every collection or document the admin listens to (`cms*` and `*_drafts`, `cmsMeta/pending`, `cmsPublishQueue`, `users`, `speakers`, `speaker_logistics`, `ticket_answers`, `feedback`, `live_updates`, `announcements`, `change_requests`, `change_request_settings`, `organization_representatives`, `organization_edit_requests`, `session_pitches`, `session_confirmations`, `session_pitch_settings`, `session_pitch_sync`) allows `isAdmin()`. `session_pitch_sources` is operator-only in the rules and the page reads it only when `isOperator` (`AirtablePitchSync.jsx:216`).
- Routes: every docket item in `AdminLayout.jsx` has a route in `AdminApp.jsx` and every route's first segment is a docket item. Every absolute `/admin/...` link target in the admin has a route. The three public preview links (`/schedule/:id`, `/sponsors/:id`, `/updates/:id`) have routes in `App.jsx`, and the sponsor page looks the record up by id.
- Unimported modules: none. Every production file under `admin/` is imported by a non-test file.
- Props: 2,645 `name=` attributes on components defined in `apps/web/src` were compared with each component's destructured props; none is passed to a component that does not take it.
- Effect dependencies: an ESLint run of `react-hooks/exhaustive-deps` over the production files (static analysis only, `--no-cache`) reports nothing beyond the three places that disable it with a stated reason (`PitchCallSettings.jsx:62`, `AdminTicketing.jsx:377`, `AdminInvoiceEditor.jsx:162`) and a ref-in-cleanup note in `useModalDialog.js:30`. All four were read and are deliberate.
- `useAdminApi`'s `call` only changes when the `user` object does, and `AuthContext` keeps that object stable, so the many `useEffect(..., [call])` loaders do not refetch on token refresh.
- Lists copied from the server that agree with it: `FEATURE_CHOICES` and `FEATURE_GROUPS` vs `KNOWN_FEATURE_KEYS`; `SPREADSHEETS` (names and tiers) vs `DATASETS` in `functions/src/admin/dataExport.cjs`; `PACKAGE_SECTIONS` vs `SECTION_IDS` in `functions/src/admin/eventPackage.cjs`; `PITCH_STATUS_LABELS` vs `PITCH_STATUSES`.
- `AdminTicketing.jsx:485` unmounting the provider workspace while the status is being re-read is deliberate (`AdminTicketing.test.jsx:81`).
- File paths named in admin comments (`functions/src/...`, `apps/web/src/...`, `docs/...`, `scripts/...`) all exist, except the one in finding 9.
- `wrapModalTab` re-export in `useModalDialog.js:6` is still used by two admin files.
