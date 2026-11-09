# Audit 03 — functions feature directories

Area: `functions/src/{speakers,materials,schedule,users,imports,media,sessions,reminders,announcements}`,
their wiring in `functions/index.js`, their Firestore queries against
`firestore.rules` / `firestore.indexes.json`, and the `shared/*` modules they import.

Read-only. Nothing in the repository was changed. Two findings were proven by
running in-memory code (`node -e`, fakes only); the rest are from reading.

No broken wiring, no missing composite index and no broken import was found.
The findings below are one clear waste, three real inconsistencies, dead code,
two owner decisions, and a group of stale comments. Ordered by severity.

---

### 1. A staff alt-text save reads the whole CMS corpus to answer a question two config documents answer
- Category: inefficient
- Confidence: certain
- Where: `functions/src/media/metadata.cjs:89-108`; `functions/src/media/upload.cjs:114-118`; `functions/src/media/usage.cjs:128-134,150-171`
- Evidence: for a staff (non-operator) caller `mediaUpdateMetadata` runs
  `scanUsage({ db, paths: [path] })` (metadata.cjs:100) and uses the result only for
  `referencedByBranding(references)` (metadata.cjs:107). `referencedByBranding` matches
  only `docPath.startsWith('config/theme')` or `config/event` with field
  `seo.defaultOgImagePath` (upload.cjs:114-118). `scanUsage` with default arguments
  first does `db.collection(name).get()` on all 12 `USAGE_COLLECTIONS`
  (cmsContent, cmsPages, cmsSchedule, cmsOrganizations, cmsTimeline, cmsUpdates, each
  live and draft) and only then reads the two config docs. Every collection hit is thrown away.
- How it is reached / impact: every alt text or title save by a staff-tier admin in the
  media library. Cost is one read per CMS document (live and draft) per save, where two
  reads suffice. `mediaDelete` needs the full scan (it returns the reference list); this
  endpoint does not.
- Proposed fix: in `metadata.cjs` pass `collections: []` to `scanUsage` (the parameter
  already exists). One line; `metadata.test.cjs` stays valid because the config hits are unchanged.

### 2. A speaker import can put `email` into `pendingEdits`, and the speaker's own profile read returns it
- Category: inconsistent (code vs its own stated contract)
- Confidence: certain (reproduced)
- Where: `functions/src/imports/speakerImport.cjs:63,225,262-270`; `functions/src/speakers/profile.cjs:446-451,480-485`
- Evidence: `buildOwnSpeakerView` documents that the own view carries "never `email`"
  (profile.cjs:449) and that `pendingEdits` is "Only ever a subset of
  SELF_EDITABLE_SPEAKER_FIELDS" (profile.cjs:481-482), then returns
  `{ ...speaker.pendingEdits }` unfiltered. That was true while only
  `applyUpdateOwnSpeakerProfile` wrote the queue. `speakerImport` now writes the queue
  for a published speaker with every reconciled field except `slug`
  (`pendingEdits: { ...queued, ...patch }`), and `RECORD_FIELDS` includes `email`.
  Reproduced with `speakersFake`: approved speaker `old@example.org`, import 1 links
  the row, import 2 changes the address →
  `run2 update [ 'email' ]` and `applyGetOwnSpeakerProfile(...)` for the owner returns
  `pendingEdits: {"email":"new@example.org"}`.
- How it is reached / impact: staff re-import a speakers CSV with a changed email for a
  published speaker; that speaker's browser (`getOwnSpeakerProfile`) then receives the
  address from the staff file, and `SpeakerProfile.jsx:189` merges it into its
  `effective` record. Low sensitivity when the address is the speaker's own; it is a
  real leak when the file holds an assistant's or agent's address. The documented
  boundary is false either way.
- Proposed fix: in `buildOwnSpeakerView` keep only `SELF_EDITABLE_SPEAKER_FIELDS` keys
  of `pendingEdits` (`functions/src/speakers/profile.cjs`); add one case to `profile.test.cjs`.

### 3. `schedule/share.cjs` initializes the Admin SDK when the export barrel is loaded
- Category: inconsistent (code vs the house rule in `core/firestore.cjs`)
- Confidence: certain (reproduced)
- Where: `functions/src/schedule/share.cjs:197-200,218-219`; `functions/src/core/firestore.cjs:7-9`
- Evidence: `core/firestore.cjs` says getDb is "Lazy so that requiring a domain module
  never initializes the Admin SDK at deploy analysis time." Every other module in the
  area calls `getDb()` inside the request or event callback. `share.cjs` defines
  `const runSync = () => createSyncHandler(getDb())` and then passes `runSync()` — called,
  not referenced — as the trigger body for both `syncScheduleShare` and
  `syncScheduleShareOnAccountWrite`. Ran:
  `require('./src/schedule/share.cjs').handlers` → `apps before 0 after 1`; the same for
  users/projection, speakers/projection, materials/projection, schedule/bookmarks,
  users/lifecycle, reminders/run and sessions/airtableSync → `apps 0`.
- How it is reached / impact: any `require('functions/index.js')` — firebase-tools
  trigger discovery at deploy, the emulator, any test of the barrel — creates the default
  app and a Firestore client. It works today because `initializeApp()` does not need
  credentials until first use; it is the one module that breaks the stated invariant.
- Proposed fix: make the trigger body lazy, e.g.
  `const runSync = (event) => createSyncHandler(require('../core/firestore.cjs').getDb())(event)`
  and pass `runSync` (no call) in `functions/src/schedule/share.cjs`.

### 4. Dead link primitives, and an error message that points operators at one of them
- Category: unneeded
- Confidence: certain
- Where: `functions/src/speakers/lifecycle.cjs:30-36,241-263,270,331,358-386,468-469`; `functions/src/schedule/sessions.cjs:484-504,889`
- Evidence: `grep -rn "linkSpeakerToUser\|unlinkSpeakerFromUser"` over the whole
  repository finds only `lifecycle.cjs` itself, two test files, `tasks/todo.md` and a
  note in `docs/plans/2026-11-08-state-machine-map/02-speakers-pitches-sessions.md:27`
  that already calls them dead. `writeSpeakerLink` exists only to serve them. The module
  doc (lifecycle.cjs:33-35) still says "the invite pipeline (issue #21) calls them";
  invites.cjs calls `applySpeakerLinkInTx`. The `link-occupied` comment
  (lifecycle.cjs:331) says "unlinkSpeakerFromUser is how they do it", but no endpoint
  exposes it, so the only real ways to clear a link are a soft delete or a hard delete.
  Separately `resolveSessionTrack` (sessions.cjs:497) is exported and used only by
  `sessions.test.cjs`; its doc says renderers use it, and no renderer in `apps/web` does.
- How it is reached / impact: none at run time. The cost is a documented capability
  ("unlink that speaker first") that staff cannot perform.
- Proposed fix: delete `linkSpeakerToUser`, `unlinkSpeakerFromUser` and
  `writeSpeakerLink` with their tests, and correct the two comments in
  `lifecycle.cjs`; delete `resolveSessionTrack` and its test, or move it to `shared`
  if the web is meant to use it. Owner may prefer to expose an unlink endpoint instead.

### 5. Material moderation and material CRUD write no `admin_logs` row
- Category: inconsistent
- Confidence: owner-decision
- Where: `functions/src/materials/review.cjs:50-62,95-97`; `functions/src/materials/store.cjs:657-740`; `firestore.rules:189-191`
- Evidence: `grep -n "logAdminAction\|admin_logs" functions/src/materials/*.cjs` finds
  only `bulk.cjs` (the archive download). `setMaterialReviewStatus`,
  `addSessionMaterialLink`, `uploadSessionMaterial`, `updateSessionMaterial` and
  `deleteSessionMaterial` write nothing to the audit trail. `firestore.rules:189-191`
  describes `admin_logs` as recording "every other admin action", and every other staff
  mutation in this area (speakers, invites, media, pitches, reminders, announcements,
  attendees, imports) writes a row.
- How it is reached / impact: an approval is the release signal for embargoed
  materials (`access.cjs canAccessMaterial`). Who approved, rejected or deleted a
  material cannot be answered from the audit log.
- Proposed fix: call `logAdminAction` after a successful `setMaterialReviewStatus`, and
  for admin-actor create/update/delete in `store.cjs` (a speaker's own writes need not
  be logged). If the omission is intended, say so in `review.cjs`.

### 6. Session pitches are a per-account store the attendee delete does not clear
- Category: inconsistent
- Confidence: owner-decision
- Where: `functions/src/users/records.cjs:80-83,107-144`; `functions/src/sessions/pitches.cjs:35,279-292`
- Evidence: `PER_ACCOUNT_STORES` says "ONE list … a store added later is added HERE and
  nowhere else", and gives the reason for sweeping `change_requests`: "A request is free
  text, so it must not outlive the identity it was stored against."
  `session_pitches/{sha256(uid\0key)}` stores `uid`, `email`, the proposal text and the
  presenter list, and `session_pitch_rate_limits/{sha256(uid)}` stores the account's
  submit window. Neither is in the list, in `onUserDeleted`, or in
  `maintenance/cleanup.cjs` (grep for "pitch" in `users/*.cjs` and `cleanup.cjs`: no hits).
  `tasks/specs/b3.md` decided reactions explicitly ("Default: no") and does not mention pitches.
- How it is reached / impact: staff delete an attendee who submitted a pitch; the
  pitch keeps the uid, the address and the free text. This may be wanted (an accepted
  pitch is the organizer's record, and it may already be a draft session), so it is a
  decision, not a bug.
- Proposed fix: either add the two stores to `PER_ACCOUNT_STORES` (an `owned` store on
  `uid` for unconverted pitches, a `doc` store is not possible for the hashed
  rate-limit id without a small kind), or add one sentence to the list's comment and
  to `docs/ADMIN_GUIDE.md` "Delete an account" saying pitches are kept and why.

### 7. Comments that contradict the code or the rules
- Category: inconsistent
- Confidence: certain
- Where and evidence:
  1. `functions/src/media/upload.cjs:68-71` — "Profile photos are capped lower (2 MiB)
     by storage.rules, since those upload directly." and `:583-584` — "storage.rules
     refuses a profile-class photo of EXACTLY the cap (`size < 2 MiB`); this mirrors
     that". `storage.rules:54-58` is now `allow list, create, update: if false` for
     `profile-photos/`; uploads go through `users/photos.cjs` ("Upload bytes through
     the server"). There is no size rule left to mirror.
  2. `functions/src/materials/bulk.cjs:599` — "540 s: at the byte cap that is about
     3.1 Mbit/s". The cap is `MAX_ARCHIVE_BYTES = 9 MiB` (bulk.cjs:70); 9 MiB over
     540 s is 0.14 Mbit/s. 3.1 Mbit/s is a 200 MB cap; `megabytes()`'s example
     ("250.3" for 262,458,573 bytes, bulk.cjs:298) dates from the same earlier limit.
     The 540 s timeout itself is now far more than the response can need.
  3. `functions/src/speakers/lifecycle.cjs:51-58` — "up to five writes on the speaker
     itself (user link, projection, record, slug reservation, outstanding invitation)".
     The code makes six (`speaker_logistics` delete, lifecycle.cjs:210) and
     `FIXED_WRITES = 6`. The constant is right; the comment is not.
  4. `functions/src/users/export.cjs:8-14` — "EXACTLY the owner-approved field set
     leaves the deployment: name, email, … profile visibility." `buildExport` also
     appends one `Answer: …` column per registration question, which includes dietary
     and access answers (export.cjs:197-216, 314-337). `docs/ADMIN_GUIDE.md:512`
     describes the answer columns; the module header does not.
  5. `functions/src/schedule/reactions.cjs:50-53` — "Exported so the web client and
     its tests can render/validate against the same list instead of a second copy."
     The web cannot import functions code and keeps its own copy,
     `apps/web/src/lib/reactionsSource.js:16-17` ("must match … REACTION_KINDS").
  6. `functions/src/media/deps.cjs:4-7` — "shared by the four media endpoints …
     three modules (upload, metadata, usage)". Seven endpoints in four modules use it
     (profilePhoto.cjs too).
  7. `functions/src/imports/recordImport.cjs:4-5` — "speakers, sessions and
     organizations (sponsors)"; `defaultImporters()` also has `registrations`.
  8. `functions/src/materials/actor.cjs:4-5` lists `review.cjs` as a user; it calls
     `requireAdmin` directly.
  9. `functions/src/schedule/pdf.cjs:107` (an orphan line "The one speaker status this
     file will resolve…" with no constant under it), `:471` (the `buildSchedulePdf`
     doc comment sits on `createBuildMySchedulePdfHandler`);
     `functions/src/schedule/sessions.cjs:692-719` (the `checkSchedulePublishSet` doc
     sits on `parentLink`); `functions/src/sessions/pitchNotices.cjs:66-67` (a comment
     about queued-record staleness above `MAX_SEND_BODY_BYTES`; the constant moved to
     `email/noticeRetry.cjs`); `functions/src/reminders/attendeeSchedule.cjs:428-431`
     (the `sendDue` doc sits on `isChannelRefusal`).
- How it is reached / impact: none at run time. Items 1, 2 and 4 are the ones a
  reviewer would act on wrongly (a size rule that is gone, a timeout sized for a
  limit that is gone, a PII field set that is wider than stated).
- Proposed fix: correct each comment in place. For item 2 also consider lowering
  `timeoutSeconds` for `downloadSessionMaterialsArchive` (and `bulk.test.cjs:1004`).

### 8. Generated PDFs still name the project by its old name
- Category: inconsistent
- Confidence: owner-decision
- Where: `functions/src/schedule/pdf.cjs:212-213` (and the same two lines in `functions/src/admin/invoicePdf.cjs:79-80`, outside this area)
- Evidence: `doc.setProducer('run-of-show'); doc.setCreator('run-of-show');`.
  `scripts/build-pages.test.cjs:159` records "The repository used to be called
  run-of-show". Every user-facing string elsewhere says "Event Runner"
  (`sessions/airtableClient.cjs:144`, `notify/sinks/email.cjs:51`).
- How it is reached / impact: the Producer and Creator fields of every public schedule
  PDF and every invoice PDF, visible in any PDF reader's document properties.
- Proposed fix: change both strings (and the invoice ones) and regenerate
  `functions/src/schedule/pdf.parity.snapshot.cjs` with `UPDATE_PDF_PARITY=1` if the
  hash covers the info dictionary.

### 9. Small repeated reads
- Category: inefficient
- Confidence: certain (each is small; listed once so nobody re-derives them)
- Where and evidence:
  1. `functions/src/schedule/sessions.cjs:664-666` — `checkSessionDeletable` calls
     `findChildren` (which already runs `cmsSchedule where parentId == docId`,
     sessions.cjs:424) and then `publishedChildren`, which runs the identical query
     again in the same transaction (sessions.cjs:629-631). `findChildren` could return
     its live snapshot.
  2. `functions/src/schedule/pdf.cjs:498-507` — the personal PDF reads the whole
     `speakers` collection and every visible session on each request; the public one
     reads only the speakers its sessions name (`publicSpeakerNames`, pdf.cjs:391-407)
     and could be reused on the bookmarked sessions.
  3. `functions/src/imports/sessionImport.cjs:344` → `sessions.cjs:274-300` — a row
     with both a track and a place reads `config/event` twice in its transaction
     (`readTrackLetters`, `readPlaceIds`), up to 1,000 extra reads on a 500-row import.
  4. `functions/src/users/export.cjs:176-181` — `exportRow` rebuilds the badge label
     map (`badgeLabels(config?.badges)`) for every account, up to 10,000 times per export.
  5. `functions/src/users/lifecycle.cjs:153` then `:165` — `onUserDeleted` deletes the
     account's `organization_edit_requests` in a transaction, then `clearAccountStores`
     queries the same store again.
- Proposed fix: each is a local change in the named file; none is urgent.

### 10. Small leftovers
- Category: unneeded
- Confidence: likely
- Where and evidence:
  1. `functions/src/media/usage.cjs:190-197` — the "no `paths`" branch of
     `resolveScanPaths` (scan every indexed asset). The only caller in the repository,
     `apps/web/src/admin/components/media/AssetModal.jsx:122`, always sends one path.
     The branch also cuts the list at `MAX_PATHS_PER_SCAN` (200) silently, so if it were
     used, assets past 200 would come back with no usage entry.
  2. `functions/src/sessions/pitches.cjs:222-233` — `verifySubmitter` is
     `core/auth.cjs verifyAuthToken` (auth.cjs:286-301) without the per-request memo:
     same bearer extraction, same `verifyIdToken(token, true)`, same null on failure.
     Its comment explains revocation checking as special to pitch intake; the shared
     helper now always does it.
  3. `functions/src/sessions/pitchQueue.cjs:203` —
     `process.env.EVENT_FIREBASE_REGION || 'us-central1'`. Every other handler module
     uses `(process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1'` (grep
     shows this file is the only exception).
  4. `functions/src/users/lifecycle.cjs:153-160` — `onUserDeleted` hardcodes the three
     directory-phase stores (`users_public`, `schedule_shares`,
     `organization_representatives`) instead of reading
     `PER_ACCOUNT_STORES`, whose comment promises a single list. They agree today; a
     fourth directory `doc` store would be missed by the auth-delete path.
  5. `functions/src/speakers/speakersFake.cjs`, `functions/src/imports/importTestKit.cjs`,
     `functions/src/schedule/pdf.parity.snapshot.cjs` — test-only files (no non-test
     requirer) that `firebase.json`'s functions `ignore` (`**/*.test.cjs`) does not
     exclude, so they deploy (about 36 KB). Same convention as the fakes in other
     directories; an `ignore` pattern would cover all of them.
- Proposed fix: remove the branch in 1 (or page it), replace 2 with `verifyAuthToken`,
  add `.trim()` in 3, derive 4 from the list, extend `ignore` for 5.

---

## Files read

Production code read in full (tests read where a finding needed them):

- `functions/index.js`, `firestore.rules`, `firestore.indexes.json`, `CONTRIBUTING.md`, `firebase.json` (functions and rewrites), `storage.rules` (profile and speaker photo blocks)
- `speakers/` 12 files: profile, invites, inviteTokens, lifecycle, projection, references, reminders, reminderCore, sessionConfirmations, confirmation, mailTemplates, profileSteps (+ speakersFake header)
- `materials/` 8 files: store, bulk, access, download, projection, review, actor, policy
- `schedule/` 6 files: sessions, bookmarks, reactions, share, pdf, pdf.parity.snapshot
- `users/` 6 files: records, export, approval, projection, lifecycle, photos
- `imports/` 6 files: recordImport, sessionImport, speakerImport, organizationImport, registrationImport, seedFlag
- `media/` 6 files: upload, imageSizes, usage, metadata, deps, profilePhoto
- `sessions/` 6 files: pitches, pitchNotices, pitchNotes, pitchQueue, airtableSync, airtableClient
- `reminders/` 6 files: run, scheduleCore, schedules, speakerSchedule, attendeeSchedule, attendeeActions
- `announcements/` 6 files: sends, sendRunner, audience, compose, messages, suppression
- Supporting reads: `core/auth.cjs` (token and admin gate), `core/firestore.cjs`, `core/demoWrites.cjs`, `core/http.cjs` (CORS default), `packages/shared/src/speaker.cjs` (field lists), `apps/web` callers of the media usage scan and reactions list, `tasks/specs/b3.md`

## Checked and found correct

- **Wiring.** Every module in the area that exports `handlers` is spread in `index.js`. Built all 79 handler sets of the area and all 166 of the barrel with `node -e`: every module loads, none is missing `handlers`, no two modules export the same name. Every HTTP handler of the area has a caller in `apps/web`, `e2e`, `scripts` or `firebase.json`; the 11 with none are triggers and schedules.
- **Indexes.** The one composite query in the area is `speaker_invites where speakerId == … orderBy createdAt desc` (`invites.cjs:720-723`); its index exists. Every other query is single-field (`==`, `in`, `!=`, `array-contains`, or `orderBy` on one field plus `__name__` in the same direction), so none needs a composite index. No index in `firestore.indexes.json` belongs to this area and is unused.
- **Rules.** Every collection the area writes is either named in `firestore.rules` or covered by the deny-all fallback as its comment states (`speaker_photo_upload_budgets`). `allocatedProfilePhoto` matches the ledger shape `users/photos.cjs` writes (slot id is path segment 2, `state: 'ready'`, `expiresAtMs`). `session_materials_public` carries exactly the four fields the rule comment names.
- **Shared imports.** Every destructured name imported from `shared/*` and from sibling modules resolves to a real export (scripted check, zero misses); each of the 18 shared modules used has its `.cjs` and `.mjs`.
- **Token verification is not doubled.** `verifyAuthToken` memoizes per request, so `materials/actor.cjs` and `schedule/share.cjs` calling it and then `requireAdmin` / `requireAttendeeAccess` cost one remote check.
- **Demo guard.** `checkDemoWrites` covers account, feedback and email actions by design; its absence from speaker, material and import writes is the stated scope, not a gap.
- **Reactions on account delete** are kept on purpose (`tasks/specs/b3.md` open question 1).
- **Schedule PDF ordering** sorts `startTime` as text, the same way the web does (`apps/web/src/lib/scheduleView.js:257`), so the two agree.
- **`/unsubscribe`** has its hosting rewrite to `emailUnsubscribe`; `tierA.ticketingProvider` exists in `core/config.cjs`.
- **Transactions.** Read-before-write order holds in the long ones checked: `applyUpdateSpeaker`, `applyDeleteSpeaker`, `applyAcceptInvite`, `reserve`, `convertPitch`, `runImport` and its four importers, `startSendRecord`, `takeLease`, `removeFromDirectory`.
- **`readSubmission`** in `pitches.cjs` looks legacy but is live: `pitchQueue.cjs` and `airtableSync.cjs` use it. `users/export.cjs buildCsv` is live through `admin/eventPackage.cjs` (it writes the attendee file without the answer columns; the other agent owns that file).
