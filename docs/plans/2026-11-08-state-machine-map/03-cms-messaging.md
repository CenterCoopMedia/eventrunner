# CMS content, publishing, announcements, reminders, email, telemetry, maintenance

Scope read: functions/src/cms/*, functions/src/announcements/*, functions/src/reminders/*, functions/src/email/{send,log}.cjs + providers, functions/src/notify/operator.cjs, functions/src/telemetry/*, functions/src/maintenance/cleanup.cjs, functions/src/public/og.cjs (visibility reads), functions/src/admin/{announcements,liveUpdates,webAddress,dataExport,eventStats,config}.cjs, scripts/publish-site.cjs (publisher half), packages/shared/src/{announcement,reminderSchedule,seed,page,update}.cjs, apps/web/src/admin/{recordState,contentEditState,pendingChanges,pendingChangesSource,pendingCountsSource,PendingChangesContext,useDirtyDrafts,publishResult,publishRunsSource,versionHistory,reminderSchedules,tourState,setupSteps}.js(x), firestore.rules, docs/adr/0006. publisher/ holds only a Dockerfile; the job code is scripts/publish-site.cjs.

## CMS draft revision (two-revision model)  (explicit)
- Entity / storage: `<C>_drafts/{id}.status` for C in PUBLISHABLE_COLLECTIONS (functions/src/cms/blockTypes.cjs:254-261), name derived by draftCollectionFor (blockTypes.cjs:271-275). Companion fields `basedOnRevision`, `visible`, `updatedAt/By`.
- States: (absent), `dirty`, `clean`. No other value is ever written (store.cjs:168, store.cjs:397).
- Transitions:
  - absent -> dirty: writeDraft (store.cjs:132-178); forks basedOnRevision from live.revision (store.cjs:158-162). Guards: createOnly/rejectLive (store.cjs:141-157), reserved-field strip (store.cjs:47-67, 92-98), callers' validators (content.cjs:164-178, pages.cjs, updates.cjs:93-96).
  - dirty -> dirty / clean -> dirty: writeDraft, same writer; pending-count delta +1 only when not already dirty (store.cjs:173-174).
  - dirty|clean -> clean: publishDocs `batch.update(..., {status:'clean', basedOnRevision})` with `lastUpdateTime` precondition (store.cjs:395-402); conflict re-read classifies `skipped: conflict` (store.cjs:360-366).
  - any -> absent: deleteBoth (store.cjs:202-217), atomically with live delete; count -1 if dirty.
- Terminal / reversibility: none terminal; delete is final except for cmsUpdates (tombstone, below) and version-history restore (re-creates as a new dirty draft via normal save endpoints, apps/web/src/admin/versionHistory.js:215-259).
- Other copies: pendingChangesSource.js:59-66 and listDirty (store.cjs:243-247) query `status=='dirty'` (agree); pendingCounts.cjs:40-53 counts the same; eventStats.cjs:94 counts it a third time.
- Problems:
  - A `clean` draft is re-published on request: publishDocs never checks `draft.status` before bumping (store.cjs:367-414), so publishing an unchanged doc writes a new revision and an identical cmsVersionHistory row. publishResult.js:79 says "had nothing new to publish" only for `no-draft`.
  - Writes that skip writeDraft: speakers/lifecycle.cjs:195-200 rewrites `speakerIds` on BOTH live cmsSchedule and cmsSchedule_drafts with `tx.set(..., {merge:true})`: no revision bump, no history row, draft status unchanged. This contradicts the module contract that only publishDocs/unpublishDoc/deleteBoth write live docs (store.cjs:9-11). materials/store.cjs:476,545 is a second, documented live-doc writer (`materialCount`, carried by store.cjs:384-389).
  - "Collection names are validated through draftCollectionFor" (store.cjs:20-22) is not true repo-wide: draft names are hard-coded in pages.cjs:42, updates.cjs:41, content.cjs:58, content.cjs:340, schedule/sessions.cjs:79, speakers/lifecycle.cjs:48, cms/organizationRepresentatives.cjs:72, imports/organizationImport.cjs:42, admin/dataExport.cjs:101, admin/config.cjs:396, media/usage.cjs:39-49, apps/web/src/admin/pendingChangesSource.js:60.

## CMS live revision / visibility  (implicit)
- Entity / storage: `<C>/{id}` presence + `visible` + `revision` + `publishedAt/By`; history in `cmsVersionHistory` (store.cjs:403-411).
- States: unpublished (no live doc), live-visible, live-hidden (`visible:false`).
- Transitions: none -> live (publishDocs, store.cjs:387-394, revision = max(history)+1 on recreation, store.cjs:374-377); live -> live (re-publish); visible flips only via a draft's `visible` carried by publish (store.cjs:379); live -> hidden via unpublishDoc `update({visible:false})` (store.cjs:227-234); live -> none via deleteBoth.
- Terminal: deletion; history rows survive (store.cjs:186-189).
- Other copies: rules gate anonymous reads on `resource.data.visible == true` (firestore.rules:91-149); shared isPublicPage `=== true` (packages/shared/src/page.cjs:110-127); og.cjs:316-322, 492, 509 `=== true`; publish-site reads `visible==true` (scripts/publish-site.cjs:323-326).
- Problems:
  - Spelling of "visible" drifts: writers treat absent as visible (`!== false`, store.cjs:150, 161, 379; recordState/pendingChanges hidden = `=== false`, pendingChanges.js:130; dataExport.cjs:111) while every public reader treats absent as hidden (`=== true`). Harmless only as long as every live write sets a boolean.
  - unpublishDoc (store.cjs:227-234) is dead in production (no caller outside tests) and, if used, would hide a doc with no revision bump and no history row, unlike every other live change.
  - cmsUpdates `publishAt` is display-only and never gates visibility (cms/updates.cjs:22-25) despite the name; it reads like a scheduled-publish state.

## Admin record state words  (explicit, derived)
- Entity / storage: derived from (live, draft) pair. apps/web/src/admin/recordState.js:17-37.
- States: `draft` (Draft), `live` (Live), `dirty` (Live with unpublished changes), plus `unknown`, plus `deadMatter` (recordState.js:55-57).
- Transitions: follow the two machines above.
- Other copies:
  - functions/src/admin/dataExport.cjs:80-84 `stateWord` (agrees; returns 'Live' where the client says 'unknown').
  - apps/web/src/admin/pendingChanges.js:109-111 `draftStateOf` derives the same words from `basedOnRevision` alone, a different input. It disagrees for a draft forked from a live doc with no numeric `revision` (store.cjs:160 leaves basedOnRevision null), which reads "Draft" here and "Live with unpublished changes" in recordStateOf.
- Problems: state id `dirty` (recordState.js:17) means "live + dirty draft", while the stored `status: 'dirty'` also covers never-published drafts. Same word, two meanings. "Hidden" is not part of the vocabulary; each surface adds its own `hidden` flag (pendingChanges.js:130, dataExport.cjs:111). dataExport takes `hidden` from the draft when one exists, so a hidden draft of a visible live record exports as Hidden although the site shows it (dataExport.cjs:107-111).

## cmsUpdates tombstone  (implicit)
- Entity / storage: `cmsUpdates_deleted/{id}` {deletedAt, deletedBy} (cms/updates.cjs:45, 228-236). Covered only by the default-deny rule (firestore.rules:856-858).
- States: present (deleted), absent.
- Transitions: delete -> tombstone in the same tx as deleteBoth (updates.cjs:228-236); save with `restore:true` clears it (updates.cjs:159-187); a save of a tombstoned id without restore is 404 (updates.cjs:167-168).
- Terminal: none; never swept.
- Other copies: client builds `restore` only for updates (versionHistory.js:225-229).
- Problems: only cmsUpdates has tombstones; pages, content, schedule, organizations and timeline can be recreated under a deleted id by any save. Delete semantics differ by collection.

## Pending-count cache  (implicit)
- Entity / storage: `cmsMeta/pending` {schemaVersion:1, counts{C:n}, updatedAt} (cms/pendingCounts.cjs:13-15, 67-69).
- States: absent/invalid -> valid; repaired by rebuild (pendingCounts.cjs:59-65, 72-78).
- Transitions: +/-1 per draft transition in the same tx (store.cjs:174, 213; pendingCounts.cjs:86-104); minus chunk dirty count at publish with lastUpdateTime precondition (store.cjs:419-438); force rebuild via cmsEnsurePendingCounts (pendingCounts.cjs:117-134), which the client calls when the doc is missing (PendingChangesContext.jsx:16-20, pendingCountsSource.js:29-39).
- Other copies: client parser apps/web/src/admin/pendingCountsSource.js:6-15 duplicates parsePendingCounts (pendingCounts.cjs:22-33) with `COLLECTION_CHOICES` (collectionWords.js:12-19) instead of PUBLISHABLE_COLLECTIONS (same six, different order: agree). useDirtyDrafts.js:16-34 recounts on the Unpublished page; eventStats.cjs:93-95 recounts again with aggregate queries.
- Problems: three independent counts of one fact. Writes that bypass writeDraft cannot drift it today only because none of them changes `status`.

## Publish run (cmsPublishQueue.status)  (explicit)
- Entity / storage: `cmsPublishQueue/{id}.status`, shape documented at cms/publish.cjs:22-25.
- States: `running`, `done`, `failed` (SETTABLE_STATUSES = failed|done, publish.cjs:43).
- Transitions:
  - (new) -> running: publish.cjs:198-206. (new) -> done for the no-op "open the site" case (publish.cjs:179-190).
  - running -> done: publish.cjs:233. running -> failed: publish.cjs:216-220 (error), maintenance sweep (maintenance/cleanup.cjs:98, 118-123), or by hand (publish.cjs:286-314).
  - failed -> running: resume `{queueId}` (publish.cjs:129-163). done -> (no-op, returns progress) (publish.cjs:139-141); running -> 409 (publish.cjs:142-153).
  - failed|running|done -> done|failed: cmsUpdatePublishStatus, no check of the current status (publish.cjs:295-311).
- Terminal: `done` (resume refuses to re-run). `failed` is resumable.
- Other copies: client words `RUN_WORDS` done/running/failed (apps/web/src/admin/pendingChanges.js:193-197) agree; failed-runs listener (publishRunsSource.js:40-52); sweep TERMINAL set (cleanup.cjs:76).
- Problems:
  - The "only a failed row is resumable" guard is check-then-set outside a transaction (publish.cjs:136-163): two concurrent resumes of one failed row both pass and both publish, which the comment at publish.cjs:142-146 says must never happen.
  - cmsUpdatePublishStatus allows `running -> failed` on a live run (inviting a concurrent resume), `running|failed -> done` with docs still unpublished, and `done -> failed`. `error` is not cleared on a manual `done`. It has no in-repo caller (only tests); neither has cmsGetPublishQueue (publish.cjs:257-281); the admin reads rows through Firestore listeners instead (publishRunsSource.js:20-52).
  - The final `status:'done'` write (publish.cjs:233) is unconditional, so a sweep that marked a slow run `failed` (cleanup.cjs:98) is overwritten back to done, and the reverse race is possible too.

## Site-publisher sub-state on the queue row  (explicit, two fields)
- Entity / storage: `cmsPublishQueue/{id}.publisher.invoke.status` (written by functions, cms/publisher.cjs:36-40, 224-237) and `publisher.status` (written by the Cloud Run job, scripts/publish-site.cjs:254-262, 466).
- States: invoke: `invoked`, `failed` (or absent = not configured, publisher.cjs:208-212). job: `running`, `done`, `failed` + `failedStage` (configure/build/... /`timeout`/`unknown`).
- Transitions: invoke absent -> invoked|failed (publisher.cjs:221-237). job absent -> running (publish-site.cjs:463-468) -> done|failed (publish-site.cjs:471-479). running|invoked-without-status -> failed/timeout by the sweep (cleanup.cjs:100-104, 124-130).
- Terminal: job done/failed (sweep TERMINAL, cleanup.cjs:76).
- Other copies: none in the admin UI. No client file reads `publisher` (grep of apps/web/src/admin), so a stale crawler snapshot is invisible to staff.
- Problems:
  - No guard on the job's terminal write: a job finishing after the sweep marked it `timeout` rewrites failed -> done (publish-site.cjs:270-280).
  - On a resume the old `publisher.status` (e.g. `failed`) and `publisher.startedAt` remain while `invoke` is replaced. strandedParts then treats the row as terminal and never times out the new invocation, and it prefers the stale `startedAt` over the newer `invoke.at` (cleanup.cjs:95-96, 102-104).
  - A row whose invoke stays `invoked` matches the sweep query forever (cleanup.cjs:169), so it is re-read on every 30-minute run.

## Site launch (coming soon)  (implicit, boolean)
- Entity / storage: `config/launch.comingSoon` + `openedAt` (cms/launch.cjs:1-38).
- States: absent (old site, open), `comingSoon:true`, `comingSoon:false`.
- Transitions: absent -> true by init-event on first run (scripts/init-event.cjs:559); true -> false on the first successful or no-op publish (publish.cjs:176-190, 237; launch.cjs:21-39). Read check is not transactional (launch.cjs:23-25).
- Terminal: false (no code sets it back).
- Other copies: client reads it live and from the build snapshot (apps/web/src/lib/launchSource.js:14, 26; scripts/lib/emit.cjs:166).
- Problems: none serious. The snapshot copy only changes when the publisher runs, so a failed publisher (above) leaves crawlers on the coming-soon page.

## Site announcements (banner)  (implicit, time window)
- Entity / storage: `announcements/{id}` {startsAt, endsAt, ...}; projection `announcements_public/current` (functions/src/admin/announcements.cjs:22-24).
- States: scheduled (now < startsAt), active, ended (now >= endsAt). No stored status.
- Transitions: clock only; the projection is rebuilt on save/delete (announcements.cjs:174-186, 216-229) and every minute (announcements.cjs:267-271).
- Terminal: ended; rows are never deleted or swept, only excluded from the query (announcements.cjs:65-69).
- Other copies (all agree on [startsAt, endsAt)): server publicRow (announcements.cjs:27-45); shared activeAnnouncements (packages/shared/src/announcement.cjs:56-61); rules `startsAt <= request.time && endsAt > request.time` (firestore.rules:156-165); admin label stateOf Scheduled/Active/Ended/"Check dates" (apps/web/src/admin/pages/AdminAnnouncements.jsx:52-59).
- Problems: four copies of the window rule. Two public read paths with different freshness: a direct `get` of a canonical row turns on at request.time, while the `current` projection lags up to a minute.

## Announcement email send  (explicit)
- Entity / storage: `announcement_sends/{sendId}.status` + `nextIndex`, `lease{token,until}`, `counts`, `retryRecipients`, `retryOf/retriedBy`, `reminder` (functions/src/announcements/sendRunner.cjs:87-122).
- States: `sending`, `sent`, `stopped`, `expired`. Sub-states: lease held/free (`busy`, sends.cjs:132), retried (`retriedBy` set).
- Transitions:
  - (new) -> sending: startSendRecord, create() or tx (sendRunner.cjs:123-157). Guards: receipt match (sends.cjs:448-450), staff vs schedule (sends.cjs:507-509).
  - sending -> sending (chunk) / -> sent: runChunk, only with the matching lease token (sendRunner.cjs:286-307).
  - sending -> stopped: markStopped, only without a live lease (sendRunner.cjs:192-202); callers: attendee schedule only (reminders/attendeeSchedule.cjs:360, 535, 566, 578, 595).
  - any -> expired: maintenance replaces the whole doc after 90 days of createdAt (maintenance/cleanup.cjs:278-310).
  - sent -> sent + retriedBy: retry creation (sendRunner.cjs:125-136).
- Terminal: sent, stopped, expired. takeLease treats every non-`sending` status as done (sendRunner.cjs:173).
- Other copies: the history row passes `status` through raw (sends.cjs:111-137); attendee schedule reads `last.status === 'sending'` (attendeeSchedule.cjs:552).
- Problems:
  - `expired` is written with `batch.set` (full replace) regardless of status (cleanup.cjs:295-301), so a never-finished `sending` record becomes `expired` and loses `reminder`, `audience` and `createdAt`. resolveRetry then answers "Finish this send before you retry" (sends.cjs:163) for an expired record, which is misleading.
  - `stopped` records cannot be retried (`status !== 'sent'`, sends.cjs:163) or continued by staff; there is no path out of `stopped`.
  - Two lease implementations in this area: sendRunner's tokenized lease (sendRunner.cjs:166-210) vs the reminder run lease (below), which releases without a token check.

## Email send-once claim and audit row  (implicit)
- Entity / storage: `email_claims/{hash(onceKey)}` (presence = claimed; `failure`, `auditFailed` added later) (email/send.cjs:306-323, 451-470, 539-556); `sent_emails/{auto}.status` (send.cjs:241-265).
- States: claim: absent, claimed, claimed+failure, claimed+auditFailed. Row status: `sent`, `failed` (log.cjs:59 STATUSES). Result-only flags: `skipped`, `uncertain` (batch, send.cjs:466, 488, 503), `ambiguous` (single send, send.cjs:357).
- Transitions: claim create before provider call, never rolled back (send.cjs:306-308). Row written once after the last attempt (send.cjs:518-530, 352-361).
- Terminal: claims are permanent and never swept (cleanup.cjs sweeps only sent_emails and announcement_sends).
- Other copies: client STATUS_WORDS sent/failed (apps/web/src/admin/pages/AdminEmailLog.jsx:63) agrees.
- Problems: one fact, two names: single `send()` marks an unknown outcome `ambiguous` (send.cjs:357), `sendBatch` marks it `uncertain` (send.cjs:466-527). Neither is persisted on sent_emails (writeAuditRow's field list, send.cjs:241-265), so the email log shows an uncertain send as plain `failed`, while the reminder UI tells staff to "check the Email log" for it (apps/web/src/admin/reminderSchedules.js:63, 167).

## Email delivery status  (explicit)
- Entity / storage: `sent_emails.deliveryStatus` + `deliveryUpdatedAt`, `bounceReason` (send.cjs:675-691).
- States: `delivered`, `bounced`, `complained`, `suppressed` (providers/webhook.cjs:60; providers/postmark.cjs:332-368).
- Transitions: any -> any, last-writer-wins by `occurredAt`, transactional (send.cjs:675-691). `suppressed` on an announcement row also creates `email_suppressions` (send.cjs:661-670).
- Terminal: none.
- Other copies: DELIVERY_WORDS (AdminEmailLog.jsx:83-92) agrees on the four values.
- Problems: ordering is by time only, not severity, so a later `delivered` overwrites a `bounced`/`complained`. The code comment says an older event must not overwrite "a newer bounce/complaint" (send.cjs:672-675), which is a different guarantee.

## Announcement suppression  (implicit, presence)
- Entity / storage: `email_suppressions/{hash(email)}` (announcements/suppression.cjs:131-143).
- States: absent (mailable), present (suppressed).
- Transitions: create via unsubscribe link or provider event (suppression.cjs:131-143; send.cjs:666); delete by staff (suppression.cjs:311-345).
- Other copies: read at audience build (audience.cjs:99-100), retry build (sends.cjs:168-169), per chunk (sendRunner.cjs:240-241), and change-request notices (admin/changeRequestNotices.cjs:193).
- Problems: none; the per-IP rate limit beside it (suppression.cjs:146-155) duplicates the sliding-window shape in telemetry/clientErrors.cjs:85-91 and auth.

## Reminder schedule setting  (explicit)
- Entity / storage: `reminder_schedules/{speakers|attendees}` {enabled, pausedReason, pausedAt, approved*Version, approvedAt/By} (reminders/scheduleCore.cjs:70-84).
- States: `off`, `on`, `paused` (scheduleState, scheduleCore.cjs:86-90). Pause reasons: speakers `wording-changed`, `settings-changed` (speakerSchedule.cjs:80-83); attendees adds `facts-changed` (attendeeSchedule.cjs:104-108).
- Transitions:
  - off|paused -> on: approve (reminders/schedules.cjs:301-318; attendee equivalent in attendeeActions.cjs), guarded by wordingVersion and settingsVersion match and an open/upcoming window (schedules.cjs:295-311).
  - on -> paused(settings-changed): save (schedules.cjs:217-235). on -> paused(wording-changed): wording editor (speakerSchedule.cjs:238-256) or a run (scheduleCore.cjs:173-205). on -> paused(facts-changed): attendee run (attendeeSchedule.cjs:477-481).
  - any -> off: disable, not transactional (schedules.cjs:339-352).
- Terminal: none. `paused` exits only by re-approval or disable.
- Other copies: client words on/paused/off (apps/web/src/admin/reminderSchedules.js:6-8, 103-105); rules deny all (firestore.rules:777-779).
- Problems:
  - Fail-open normalization: an unrecognized `pausedReason` normalizes to null (scheduleCore.cjs:79), so the schedule reads and runs as `on` (scheduleCore.cjs:87-89, 236-237). For example, an attendee-only reason on the speaker doc would un-pause it.
  - `readOffsets` and `SEND_TIME_RE` are duplicated between scheduleCore.cjs:41, 50-54 and packages/shared/src/reminderSchedule.cjs:46, 136-140. The copies differ: only the core caps the count at MAX_OFFSETS = 6.
  - "Event is over" is re-derived in scheduleCore.cjs:101-108 from the last day's end, independent of getEventPhase (packages/shared/src/config/lifecycle.cjs:88-115). It ignores `archivedAt`, so an archived event with future days keeps sending reminders.

## Reminder window (planner)  (explicit, computed)
- Entity / storage: none stored; planReminders (packages/shared/src/reminderSchedule.cjs:168-208).
- States: `upcoming`, `open`, `closed`, `empty` (reminderSchedule.cjs:185-193); `due` = open and not quiet hours. Endpoint nextRun status: `due`, `upcoming`, `none`, `not-set`, `invalid` (schedules.cjs:111-139; attendeeActions.cjs:111-113).
- Transitions: clock only.
- Other copies: client handles nextRun `due` and `upcoming` and falls back to the message (reminderSchedules.js:90-99).
- Problems: the window key embeds the anchor date (reminderSchedule.cjs:143-145), so moving the due date or the event start mints new ledger keys. Whether a second reminder then goes out depends on the facts and settings re-approval and the speaker cooldown, not on the ledger.

## Reminder run lease and last run  (implicit)
- Entity / storage: `reminder_schedule_runs/{id}.running.startedAt` (lease) and `.lastRun.outcome/reason` (scheduleCore.cjs:208-217, 261-274).
- States: lease free / held (15 min, scheduleCore.cjs:39). lastRun.outcome: `completed`, `nothing-due`, `paused`, `failed` (skipped runs return early and are not stored, scheduleCore.cjs:236-246). Reasons: quiet-hours, time-limit, window-closed, schedule-changed, superseded, busy, channel-changed, and others.
- Transitions: acquire in a tx (scheduleCore.cjs:208-217); release `running: null` (scheduleCore.cjs:274).
- Other copies: client lastRun words (reminderSchedules.js:55-85 speakers, 158-191 attendees), two near-identical switch statements.
- Problems: the release is not tied to the holder, so a run that outlives its 15-minute lease clears a successor's lease (scheduleCore.cjs:274). Compare the token check in sendRunner.cjs:204-209. The client has no words for reason `channel-changed` (attendeeSchedule.cjs:594-596 vs reminderSchedules.js:170-175).

## Reminder ledger  (implicit)
- Entity / storage: `reminder_ledger/{schedule}__{window}[__{speakerId}]` (ADR 0006 line 18; speakerSchedule.cjs:153, 354-365; attendeeSchedule.cjs:318-320, 409-421).
- States: speakers: reserved (no `outcome`) -> `sent`|`failed`|`uncertain` (speakerSchedule.cjs:377-385). Attendees: created only, never stamped.
- Transitions: create in the same tx as the reservation/record (sendRunner.cjs:142-153); speaker outcome stamp is best-effort (speakerSchedule.cjs:380-385).
- Terminal: permanent; never swept.
- Problems: the speaker and attendee ledgers have different shapes; a speaker row with no outcome can mean in flight or crashed after reserving.

## Web address  (explicit)
- Entity / storage: `web_address/current.state` (functions/src/admin/webAddress.cjs:12-15, 30-38).
- States: `none` (absent), `records`, `switch`, `done`, `removing`.
- Transitions: records|switch|done -> records|switch|done by check (webAddress.cjs:84-105); scheduled check only from records|switch (webAddress.cjs:112); any -> removing -> deleted by operator script (webAddress.cjs:249-261, scripts/remove-web-address.cjs).
- Terminal: deleted.
- Other copies: client STATE_WORDS records/switch/done (apps/web/src/admin/pages/AdminWebAddress.jsx:8-12).
- Problems: no code creates the record (`add` is refused, webAddress.cjs:5-10), so the none -> records entry is out of band. `removing` is missing from the header docs and from the client words. A `done` domain is never re-checked on the schedule.

## System errors  (implicit, boolean)
- Entity / storage: `system_errors/{id}.resolved`, `alertedAt`, `lastSeenAt`, `resolvedAt/By` (telemetry/systemErrors.cjs:59-70).
- States: unresolved/unalerted -> alerted (claimAlert, systemErrors.cjs:99-107); unresolved <-> resolved.
- Transitions: resolve, guarded against a reopen race by expectedLastSeenAt (telemetry/systemErrorsAdmin.cjs:160-176); reopen only for auth.otp fault rows (auth/otp.cjs:83-91, 177-190).
- Problems: two writers with different row shapes (`lastSeenAt` only on otp rows, systemErrorsAdmin.cjs:18-28). The alert dedupe is an in-memory per-container map (notify/operator.cjs:18-36). No retention sweep.

## Small client-only states
- Editor dirtiness: snapshot comparison (apps/web/src/admin/contentEditState.js:13-38); leave guard `pending` (useUnsavedNavigation.js:57). Explicitly separate from the stored vocabulary (contentEditState.js:1-4).
- Tour: localStorage `done` or an in-tab Set (tourState.js:14-37).
- Setup steps: `ready` from server check `state === 'ready'` (setupSteps.js:97-127).
- Live updates: no lifecycle (exists or deleted, `pinned`, `audience`). The audience list is in three places that agree: functions/src/admin/liveUpdates.cjs:73, firestore.rules (readableLiveUpdateAudiences, before :603), apps/web/src/lib/liveUpdatesSource.js:32.

## Cross-cutting findings
1. Non-atomic resume guard in cmsPublish. The failed -> running check and set are separate reads and writes (functions/src/cms/publish.cjs:136-163), so two resumes can double-bump revisions. Fix: do the status check and the `running` write in one transaction, with a run token.
2. Queue status writes are unguarded across three writers: cmsPublish's final `done` (publish.cjs:233), the sweep's `failed` (cleanup.cjs:118-123), the manual endpoint (publish.cjs:295-311, with no current-status check and no caller), and the job's publisher.status (scripts/publish-site.cjs:270-280). Fix: compare-and-set on the expected prior status for every write, and drop or restrict cmsUpdatePublishStatus.
3. Writes that bypass the publish model. speakers/lifecycle.cjs:195-200 edits live and draft cmsSchedule docs in place (no revision, no history), and store.cjs:9-11 says no such writer exists. Fix: route the edit through writeDraft and publishDocs, or document it as a second sanctioned live writer as was done for materialCount.
4. Visibility is spelled two ways: writers use `!== false` (store.cjs:150, 161, 379) and readers use `=== true` (firestore.rules:92; packages/shared/src/page.cjs:127; functions/src/public/og.cjs:322). Fix: one shared `isVisible` helper, and always write a boolean.
5. Three derivations of the Draft/Live/Live-with-changes word (recordState.js:32-37; dataExport.cjs:80-84; pendingChanges.js:109-111), and the last uses a different input (basedOnRevision). Fix: move recordStateOf into packages/shared and use it in all three.
6. Three counts of dirty drafts (cmsMeta/pending via pendingCounts.cjs; useDirtyDrafts.js:136-149; eventStats.cjs:93-95) and two parsers of the count document (pendingCounts.cjs:22-33; pendingCountsSource.js:6-15). Fix: share the parser, and have eventStats read cmsMeta/pending.
7. Publisher status (cmsPublishQueue.publisher.*) is stale after a resume and is never shown in the admin (cleanup.cjs:95-104; no `publisher` reads under apps/web/src/admin). Fix: reset `publisher` on each invoke, and show the snapshot state on the Unpublished changes page.
8. Retention gaps and a destructive expiry. The sweep covers only sent_emails and announcement_sends (cleanup.cjs:234-310). Its `expired` overwrite replaces records still `sending` (cleanup.cjs:295-301). email_claims, system_errors, ended announcements, cmsPublishQueue, reminder_ledger, cmsUpdates_deleted and the rate-limit docs are never swept. Fix: expire only terminal sends, use merge to keep the status history, and add sweeps or documented retention for the rest.
9. The reminder "event ended" check (scheduleCore.cjs:101-108) duplicates getEventPhase (shared/config/lifecycle.cjs:88-115) and ignores `archived`. Fix: use `getEventPhase(...) in {'ended','archived'}`.
10. An unknown pause reason fails open (scheduleCore.cjs:79, 87-89). Fix: normalize any non-empty unknown `pausedReason` to paused, for example `'unknown'`.
11. Duplicated planner validation (scheduleCore.cjs:41, 50-54 vs shared/reminderSchedule.cjs:46, 136-140), with different max-count rules. Fix: export readOffsets and SEND_TIME_RE from shared with a count option.
12. The two lease designs disagree: the run lease release has no token (scheduleCore.cjs:274) while sendRunner's lease does (sendRunner.cjs:204-209). Fix: give the run lease a token and release it only when the token matches.
13. Unknown email outcomes have two names (`ambiguous` send.cjs:357, `uncertain` send.cjs:466) and neither is stored on sent_emails (send.cjs:241-265). Fix: one `uncertain` flag, persisted and shown in the email log.
14. Delivery status is last-by-time, not by severity (send.cjs:675-691), which contradicts its own comment at send.cjs:672-675. Fix: never let `delivered` replace `bounced`, `complained` or `suppressed`.
15. A clean draft re-publishes as a new identical revision (store.cjs:367-414). Fix: skip a clean draft whose basedOnRevision equals live.revision, reported as `no-change`.
16. Delete semantics differ by collection: only cmsUpdates has a tombstone (cms/updates.cjs:45, 159-187, 228-236). Fix: put the tombstone in deleteBoth for every publishable collection, or document why only updates need it.
17. Draft collection names are hard-coded in more than ten modules despite draftCollectionFor (store.cjs:20-22; for example pages.cjs:42, speakers/lifecycle.cjs:48, media/usage.cjs:39-49, apps/web/src/admin/pendingChangesSource.js:60). Fix: import draftCollectionFor everywhere, including a web copy of the list.
18. Dead or uncalled code: store.unpublishDoc (store.cjs:227-234), cmsGetPublishQueue and cmsUpdatePublishStatus (publish.cjs:257-315), which have no in-repo client. Fix: delete them or wire them to the UI.
19. Web address: the entry state has no writer, `removing` is undocumented and has no client words, and `done` is never re-checked (webAddress.cjs:12-15, 112, 253; AdminWebAddress.jsx:8-12). Fix: document the out-of-band creation, add `removing` to STATE_WORDS, and include `done` in the hourly check.
20. The announcement window rule is in four copies (admin/announcements.cjs:27-45; shared/announcement.cjs:56-61; firestore.rules:156-165; AdminAnnouncements.jsx:52-59). They agree today. Fix: have the server publicRow call shared activeAnnouncements, and keep the rules copy as the only other one.
