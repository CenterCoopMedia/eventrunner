# Speakers, invites, pitches, sessions, materials, media, imports, change requests

Read-only survey. All paths are relative to /home/user/eventrunner. Line numbers are as of this read.

## Speaker pipeline status  (explicit)
- Entity / storage: `speakers/{id}.status`. Values are defined at packages/shared/src/speaker.cjs:39-45. The admin-settable subset is at speaker.cjs:54, and the publishing subset at speaker.cjs:57.
- States: draft, invited, accepted, approved, removed
- Transitions:
  - (none) -> draft. createSpeaker defaults it at functions/src/speakers/profile.cjs:94-104. Speaker import forces it at functions/src/imports/speakerImport.cjs:136. Pitch conversion creates it with a raw `tx.create` at functions/src/sessions/pitchQueue.cjs:147-149.
  - (none) -> approved. createSpeaker accepts `status` from the payload (speaker.cjs:376-381) and stamps `approvedAt` (profile.cjs:214). The demo seed writes it directly at scripts/lib/demo-event.cjs:67.
  - draft -> invited. Writer: applyMintInvite, functions/src/speakers/invites.cjs:277-285. Guard: `INVITABLE_SPEAKER_STATUSES=['draft']`, invites.cjs:216, inviteTokens.cjs:64.
  - invited -> invited (resend). Guard at invites.cjs:227. The old token is superseded at invites.cjs:259.
  - invited -> draft. Three writers: cancel (invites.cjs:417-433), an admin email change (profile.cjs:364-371), and an admin status edit to draft (profile.cjs:364-370).
  - invited -> accepted. Writer: acceptSpeakerInvite, invites.cjs:607-620. Guard: evaluateInvite, invites.cjs:464-476. Both the email match (invites.cjs:582) and the pair link happen in the same transaction.
  - any -> approved / draft / removed. The admin updateSpeaker allows these with no source-state guard. Its only special cases are leaving `invited` (profile.cjs:364) and entering `removed`, which clears uid (profile.cjs:336-338). It stamps approvedAt only the first time (profile.cjs:377-379).
  - any -> removed. Writers: the soft delete at functions/src/speakers/lifecycle.cjs:150-158 and the admin edit. A hard delete removes the document.
- Terminal states / reversibility: none is terminal. `removed` can go back to `approved` or `draft` through the admin edit, but uid was cleared, so the record comes back unlinked. Re-inviting requires going to `draft` first.
- Other copies of this lifecycle:
  - functions/src/speakers/projection.cjs:19-22 and speaker.cjs:201-204 isPubliclyVisibleSpeaker. These agree: approved means published.
  - profile.cjs:647 tests `stored.status === 'approved'` as a literal instead of calling isPubliclyVisibleSpeaker, which speakerImport.cjs:209 uses for the same gate. Same meaning, two spellings.
  - REMINDABLE_SPEAKER_STATUSES `['accepted','approved']` is at packages/shared/src/speakerReadiness.cjs:56. The web copies the same list as ELIGIBLE_STATUSES in apps/web/src/lib/speakerDashboardEligibility.js:1 instead of importing it, although apps/web already imports `shared/speakerReadiness` elsewhere.
  - The admin UI maps status to record words twice, with identical copies of `speakerRecordState` and `pendingFieldsOf`: apps/web/src/admin/pages/AdminSpeakersList.jsx:83-98 and AdminSpeakerEditor.jsx:74-91. The editor labels `approved` as "Published" (AdminSpeakerEditor.jsx:57), while the record-state word is "Live".
  - SPEAKER_STATUSES is consumed only by functions/src/admin/eventStats.cjs:88. Nothing validates a stored status against it.
- Problems:
  - **What counts as "is a speaker" disagrees between server and client.** firestore.rules:453 and :590-594 treat `users.speakerId != null` as a speaker (attendee and directory access, the speaker live-update audience). Materials do the same: functions/src/materials/actor.cjs:67-68. Server self-service only checks uid ownership (profile.cjs:86-91 callerOwnsSpeaker; profileSteps.cjs:33-38). The web dashboard uses status ∈ {accepted, approved} (speakerDashboardEligibility.js). An admin edit from accepted or approved to `draft` keeps uid and users.speakerId, because only `removed` clears them (profile.cjs:336-338). That speaker keeps attendee access and server self-service while the dashboard shuts them out.
  - No transition table. Any admin-settable target is accepted from any source state. For example draft -> approved skips the invite and gives a published speaker with no account link. accepted -> draft keeps the link.
  - linkSpeakerToUser and unlinkSpeakerFromUser (lifecycle.cjs:248-262) are exported and documented as "the primitive", but nothing outside tests calls them. Every real path uses applySpeakerLinkInTx or inline writes. These exports are dead.
  - Writes that skip createSpeaker: pitchQueue.cjs:149, speakerImport.cjs:175-197 and demo-event.cjs:67 each build their own server-owned field set: uid, inviteToken, approvedAt, createdAt. pitchQueue does not use newSpeakerDefaults().
  - The stale rules comment at firestore.rules:509-510 lists only createSpeaker, updateSpeaker, deleteSpeaker and invite as writers. It leaves out import, pitch conversion, profileSteps, self-edit and photo-delete claims.

## Speaker invite token  (explicit + implicit expiry)
- Entity / storage: `speaker_invites/{sha256}.status`, defined at functions/src/speakers/inviteTokens.cjs:58. A mirror lives in `speakers.inviteToken`, which holds the hash.
- States: pending, accepted, cancelled, superseded. Implicit sub-states of pending: "not delivered" (`sentAt: null`, invites.cjs:271) and "expired" (`expiresAt` passed, TTL 14 days, inviteTokens.cjs:45).
- Transitions:
  - (none) -> pending: invites.cjs:262-273.
  - pending -> superseded: resend (invites.cjs:259), an admin edit (profile.cjs:367-369), soft delete (lifecycle.cjs:152-154), and hard delete.
  - pending -> cancelled: invites.cjs:428-430.
  - pending -> accepted: invites.cjs:604-607.
  - undelivered -> delivered: the `sentAt` stamp outside the transaction at invites.cjs:839-841. It is best effort.
  - All closures go through invalidateInviteInTx (inviteTokens.cjs:147-160), which sets closedAt and closedBy, except acceptance, which writes inline at invites.cjs:604-607.
- Terminal states / reversibility: accepted, cancelled and superseded are terminal. An idempotent accepted replay is handled at invites.cjs:545-550.
- Other copies: "an outstanding invite" is encoded three times, as `speakers.status==='invited'`, `speakers.inviteToken===hash` and `speaker_invites.status==='pending'`. evaluateInvite has to check all three (invites.cjs:465-476).
- Problems:
  - There is no `expired` state. An expired invite stays `pending`, and its speaker stays `invited`, forever. Nothing sweeps them. The admin list keeps saying "Expires <date>" after the date has passed (AdminSpeakersList.jsx:194-197).
  - INVITE_STATUSES and INVITE_TERMINAL_STATUSES (inviteTokens.cjs:58,61) are exported and never read. They are dead constants.
  - A send that fails leaves a live, usable token with `sentAt: null` (invites.cjs:821-830). This is intentional and documented.

## Speaker staged self-edits  (implicit)
- Entity / storage: `speakers.pendingEdits`, `pendingEditsAt` and `pendingEditsBy`. They are server-owned (speaker.cjs:126-128).
- States: none (null or {}), staged (a non-empty map).
- Transitions:
  - none -> staged: the speaker self-edits while `status==='approved'` (profile.cjs:647-660). The import also stages when the speaker is published (speakerImport.cjs:262-268).
  - staged -> none: apply (profile.cjs:718-726) or discard (profile.cjs:788).
- Terminal states / reversibility: none is terminal.
- Other copies: readiness lays pendingEdits over the record (speakerReadiness.cjs:63-68). Photo delete checks the pending headshot (functions/src/media/upload.cjs:649-654).
- Problems:
  - Staging is gated on status, but nothing clears it when status changes. An approved -> draft/removed edit (profile.cjs:336-392) leaves pendingEdits in place. A later self-edit then writes straight to the live fields while the stale queue still overrides readiness.
  - Apply and discard have no status check (profile.cjs:700-726).

## Speaker profile submission  (implicit)
- Entity / storage: `speakers.profileSubmittedAt`, written at functions/src/speakers/profileSteps.cjs:119-120.
- States: unsubmitted, submitted.
- Transitions: unsubmitted -> submitted, once. A replay is a no-op (profileSteps.cjs:119). The `speaker.profile_received` email is sent once by onceKey (profileSteps.cjs:95).
- Terminal states / reversibility: submitted is terminal. It is never cleared, and nothing checks speaker status first.
- Problems: the flag is one-way. Later edits do not re-open it, so staff cannot tell a profile submitted once from one that is current.

## Speaker session confirmation email  (implicit, dead)
- functions/src/speakers/confirmation.cjs:1-21. It has an onceKey per speaker and session, but it says itself that it has no caller, and no handler requires it. It is unreachable today, and ADR 0008 §3 (docs/adr/0008-registration-and-pitch-steppers.md:84-86) keeps it for a future action.

## Speaker readiness  (explicit derived)
- Entity: computed. READINESS_ITEMS `bio, headshot, description, materials` (speakerReadiness.cjs:41), plus a non-item `pendingMaterialsSessions` (speakerReadiness.cjs:148-151).
- Other copies:
  - apps/web/src/lib/speakerCompletion.js:9-44 builds the speaker's own "next steps" list from the shared predicates, but **leaves out the `description` item**. Its doc comment says "so a reminder never asks for an item this list shows as done", yet the reminder email can ask for a session description that this list never shows.
  - COUNTED_MATERIAL_STATUSES (speakerReadiness.cjs:38) is copied as COUNTED_REVIEW_STATUSES at apps/web/src/admin/materialsCoverage.js:22. The two agree, but the shared `materialCounts` already exists.
  - REMINDER_GROUPS is hard-coded in apps/web/src/admin/speakerReminders.js:6-14. The server derives EXPORT_GROUPS from READINESS_ITEMS (functions/src/speakers/reminders.cjs:123). They agree today.

## Speaker reminder delivery  (explicit)
- Entity / storage: `speaker_reminders/{speakerId}.lastStatus` (functions/src/speakers/reminderCore.cjs:322-329).
- States: sending, sent, failed, uncertain. There is also a 24-hour cooldown (reminderCore.cjs:30) and a 10-minute stale "sending" timeout (reminderCore.cjs:32).
- Transitions:
  - * -> sending: reserve, reminderCore.cjs:321-329. Guards: same batch, in progress, cooldown (reminderCore.cjs:310-320).
  - sending -> sent/failed/uncertain: reminderCore.cjs:357-365. This is a plain `set` and is not conditional on `lastBatchId`.
  - stale sending -> sent/failed: settled from email_claims, reminderCore.cjs:292-308.
- Problems: it has its own delivery vocabulary, compared under cross-cutting finding #4. The final stamp (reminderCore.cjs:357) is not attempt-checked, unlike pitch notices (pitchNotices.cjs:185) and change-request notices (changeRequestNotices.cjs:250).

## Session pitch review status  (explicit)
- Entity / storage: `session_pitches.status`, defined at functions/src/sessions/pitches.cjs:39. A second copy is at functions/src/sessions/pitchNotices.cjs:61.
- States: new, in_review, accepted, rejected
- Transitions:
  - (none) -> new: three separate writers. Site form at pitches.cjs:279-292, CSV import at pitchQueue.cjs:61, Airtable at functions/src/sessions/airtableSync.cjs:212-231. Each builds its own initial shape.
  - any -> any (including back to `new`): reviewSessionPitch at pitches.cjs:623-635. Guard: optimistic `expectedStatus` + `reviewRevision` (pitches.cjs:625-627). There is no transition table: readReview accepts any member of STATUSES (pitches.cjs:583-587).
  - The UI offers only accepted, rejected and in_review (apps/web/src/admin/pages/AdminSessionPitch.jsx:43-47). `new` can be set through the API but has no button.
- Terminal states / reversibility: none is terminal.
- Other copies: labels and tones are at apps/web/src/admin/pitchStatus.js:3-4. DECISION_TEMPLATE_IDS is keyed by status at packages/shared/src/pitch.cjs:79. The status list is not in shared.
- Problems:
  - **Spelling drift between rejected and declined.** The stored value is `rejected`. The UI word is "Declined" (pitchStatus.js:3), the template is `pitch.declined` (pitch.cjs:78-79), and the notice slot is `rejected` (pitchNotices.cjs:15, 83-84). Change requests store the same idea as `declined` (functions/src/admin/changeRequests.cjs:112).
  - STATUSES is duplicated in pitches.cjs:39 and pitchNotices.cjs:61.
  - **A converted pitch can be moved off `accepted`.** reviewSessionPitch never reads `conversion` (pitches.cjs:615-635 has no reference to it). The UI still shows Decline and Mark-in-review after conversion (AdminSessionPitch.jsx:174-186). The result is a declined pitch whose draft session and draft speakers remain, and invites may already have been sent.
  - A staff edit (pitches.cjs:545-555) and an Airtable refresh (airtableSync.cjs:244-254) both bump `reviewRevision` after conversion too. Neither updates the drafts. ADR 0005 accepts this (docs/adr/0005-airtable-pitch-intake.md:35).

## Pitch conversion  (implicit)
- Entity / storage: `session_pitches.conversion`, `convertedAt` and `convertedBy` (pitchQueue.cjs:151-152).
- States: unconverted, converted.
- Transitions: unconverted -> converted. Guard: `status==='accepted'` and the revision matches (pitchQueue.cjs:106). Idempotent replay is at pitchQueue.cjs:105.
- Terminal states / reversibility: converted is terminal. Nothing reverses it, and the status is not pinned, as noted above.
- Problems:
  - `conversion.speakerId` and `conversion.speakerIds` encode the same fact (pitchQueue.cjs:151). The UI falls back between them (AdminSessionPitch.jsx:219).
  - The invite step after conversion is outside the transaction (pitchQueue.cjs:158-160). Partial invites are reported, not retried.

## Pitch staff notes  (implicit, two fields)
- `privateNotes` is a single string, still writable through reviewSessionPitch (pitches.cjs:635). Every creator also seeds it as null.
- `reviewNotes[]` is a per-author array (functions/src/sessions/pitchNotes.cjs:1-13, 73-80).
- Problem: two fields encode staff notes. The legacy one is still writable, although the doc says it "stays as it was" (pitchNotes.cjs:12-13).

## Pitch / staff-edit provenance  (implicit)
- `submitted` is set once, on the first staff edit (pitches.cjs:545). `editedAt` and `editedBy` follow (pitches.cjs:555).
- Airtable rows add the flags `sourceUpdatedAt`, `sourceRemovedAt` and `sourceConsentMissingAt` (airtableSync.cjs:203-205, 225-227, 248-254). CSV-imported rows never carry those fields, so the shape depends on the source.

## Pitch email notices  (explicit)
- Entity / storage: `session_pitches.notices.{receipt|accepted|rejected}.state` (pitchNotices.cjs:15-16, 100-115).
- States: queued, sent, failed, unknown. A queued notice becomes stale after 10 minutes (pitchNotices.cjs:64).
- Transitions:
  - (none) -> queued: automatic receipt (pitchNotices.cjs:207-221) or a staff send (pitchNotices.cjs:340-370).
  - queued -> sent/failed/unknown: attempt-checked at pitchNotices.cjs:178-192.
  - failed -> queued: retry.
  - unknown or stale queued -> queued: needs `confirmUnknown` (pitchNotices.cjs:284-297).
- Terminal states / reversibility: sent (pitchNotices.cjs:281).
- Problems: an accepted email and a rejected email can both be sent for one pitch. `otherDecisionSent` only warns (pitchNotices.cjs:299-301). Receipt mode is `automatic|manual` (pitch.cjs:82), while change-request notices use `off|automatic` (changeRequestNotices.cjs:65). Those are two vocabularies for the same switch.

## Pitch call open/closed  (implicit)
- Entity / storage: `config/pitch_call.{enabled, closesAt, externalFormUrl}`.
- States: off; open (no deadline); open until a deadline; closed by the deadline; external form.
- Checks: isPitchCallOpen is at packages/shared/src/pitch.cjs:51-56. The server also refuses when an external URL is set (pitches.cjs:265). The client hook apps/web/src/lib/usePitchCallOpen.js:15-31 uses isPitchCallOpen only and leaves the external case to /pitch. This is consistent but split.

## Airtable refresh run  (explicit)
- Entity / storage: `session_pitch_sync/airtable.{running, lastRun.outcome, lastSuccessAt}` (airtableSync.cjs:292-310, 392-400).
- States: idle, running (a 10-minute lease); outcomes completed, partial, failed, plus skipped (busy, too-soon, not-due) (airtableSync.cjs:312-315, 330-331).
- Problems: lease release sets `running: null` without checking that this run owns the lease (airtableSync.cjs:397-400). A run that outlives LEASE_MS can clear a newer run's lease.

## Pitch stepper / draft  (implicit client)
- Steps are session, format, presenters, access and review (packages/shared/src/pitchForm.cjs:163-169). Progress is `visited[]`, stored in sessionStorage under the v2 key with a v1 migration (apps/web/src/lib/pitchDraft.js:3-4, 16-22, 51-64).
- The idempotency key `submissionKey` rides in the draft. The pitch id is derived from uid + key (pitches.cjs:374).

## Session material review  (explicit)
- Entity / storage: `session_materials.reviewStatus`, defined at functions/src/materials/review.cjs:29.
- States: pending, approved, rejected
- Transitions:
  - (none) -> pending: functions/src/materials/store.cjs:468.
  - any -> any: admin setMaterialReviewStatus at review.cjs:50-60. There is no guard on the source state.
  - Delete: any state, by an admin or the owner (store.cjs:519-537).
  - A speaker may edit only while the material is pending (store.cjs:500-502).
- Terminal states / reversibility: none is terminal.
- Other copies: the projection publishes approved materials only (functions/src/materials/projection.cjs:48). The access embargo checks for approved (functions/src/materials/access.cjs:68). The readiness "counted" set and its web copy are covered in the readiness section.
- Problems:
  - Review writes no reviewedAt or reviewedBy, and no admin_logs row: review.cjs:58 writes only `{reviewStatus, updatedAt}`, and grep finds no logAdminAction call. Pitch reviews, feedback and change requests all stamp the reviewer.
  - A rejected material cannot be edited by its speaker, only deleted and sent again.
  - `cmsSchedule.materialCount` is a hand-maintained counter (store.cjs:478, 532-535) that duplicates a count query.

## Session record (draft/live/visible)  (explicit, owned by cms/store)
- Entity / storage: `cmsSchedule_drafts.status` dirty|clean (functions/src/cms/store.cjs:168, 397) and `cmsSchedule.visible`.
- Imports and pitch conversion create hidden drafts (functions/src/imports/sessionImport.cjs:380; pitchQueue.cjs:144).
- Admin words come from apps/web/src/admin/recordState.js:31-36. recordStateOf ignores `visible`, so an unpublished live session (`visible:false`) reads "Live". Speaker readiness, bookmarks and dashboards treat `visible!==true` as absent (speakerReadiness.cjs:101; functions/src/schedule/bookmarks.cjs:67).
- Problem: bookmarks.cjs:67 refuses even an *un*bookmark on a hidden session, so a bookmark saved before the session was hidden cannot be removed. The same refusal is in reactions.

## Speaker photo delete claim  (implicit lock)
- Entity / storage: `speakers.headshotDeleteClaims[]` (functions/src/media/upload.cjs:637-654, 717-722).
- States: unclaimed, claimed. The claim is released only on delete failure (upload.cjs:737-748).
- Guard: the self-edit refuses a claimed path (profile.cjs:634-645).
- Problems: the claim is never removed after a successful delete, so the array grows without bound. The admin updateSpeaker and import paths do not check claims; only self-edit does.

## Schedule share visibility  (explicit)
- `schedule_shares.scheduleVisibility` private|attendees_only|public, with default private (functions/src/schedule/share.cjs:38-51). Rules are at firestore.rules:494-495.
- The same three values are PROFILE_VISIBILITIES in packages/shared/src/profile.cjs:68, with a different default, attendees_only (profile.cjs:74), and are copied again in firestore.rules:378. There are three lists and no shared import.

## Change request status  (explicit)
- Entity / storage: `change_requests.status`, defined at functions/src/admin/changeRequests.cjs:112. Outcome subset at :113.
- States: new, in_progress, done, declined
- Transitions:
  - (none) -> new: changeRequests.cjs:400-407.
  - any -> any: updateChangeRequestStatus at changeRequests.cjs:508-545. There is **no expectedStatus/revision guard**, so the last write wins. The pitch review has one.
  - Into done/declined creates a fresh `outcome`. Moving to a non-outcome state sets outcome to null, which drops the staff reply (changeRequests.cjs:528-532).
  - `history[]` is capped at 50 entries (changeRequests.cjs:114, 526).
- Terminal states / reversibility: none is terminal.
- Problems:
  - The audit row has no from/to details (changeRequests.cjs:540-545). Pitch review records them (pitches.cjs:637-647).
  - queueOutcome's "first-ever move" rule reads the capped history (functions/src/admin/changeRequestNotices.cjs:178-181). It is backed up by the `notices[status]` check.
  - done -> declined after a sent done email can send a second, contradictory email. This is the same issue as pitch notices.

## Change request notices  (explicit)
- `change_requests.notices.{received|done|declined}.state`: queued, sent, failed, unknown, suppressed (changeRequestNotices.cjs:23-35, 120-130, 200-256). The stale timeout is 10 minutes (changeRequestNotices.cjs:76).
- Almost a copy of pitch notices: compare queuedRecord at pitchNotices.cjs:100-115 with changeRequestNotices.cjs:120-130, and onceKeyFor and the retry rules at pitchNotices.cjs:281-297 with changeRequestNotices.cjs:343-350. Only this copy has `suppressed`.

## Feedback status  (explicit)
- `feedback.status` new|reviewed|archived (functions/src/admin/feedback.cjs:84). Create is at feedback.cjs:149-156. The admin moves any -> any at feedback.cjs:325-336.
- Problems: the update is a plain `ref.update` outside a transaction, and the audit row is written afterwards (feedback.cjs:336-347). Change requests use one transaction for the update and its audit row. Restoring to `new` still stamps reviewedAt and reviewedBy (feedback.cjs:336).

## Admin access tier and staff expiry  (explicit + time-derived)
- `config/bootstrap.adminEmails`, `.staffEmails` and the `.staffExpiry` map (functions/src/admin/access.cjs:1-66).
- States: none, staff (permanent), staff (expiring), expired (computed), and invalid, for a malformed expiry (access.cjs:192-205). Operator never expires.
- Transitions:
  - setAdminAccess (access.cjs:264+), with the last-operator guard.
  - expired -> none by the sweep endExpiredStaffAccess (access.cjs:501-543).
- Copies: core/auth.cjs resolveAdminTier and firestore.rules:57-70 staffGrantActive. The comments say these agree. The access-mail result vocabulary is accepted, uncertain and failed (functions/src/admin/accessMail.cjs:100-114), a fourth delivery vocabulary.

## Record imports (preview/commit)  (explicit)
- `dryRun`, then `confirmDigest` must match (functions/src/imports/recordImport.cjs:299-304, 450-458). Row verdicts are create, update, unchanged and error (speakerImport.cjs:190-257).
- The audit row is written with `finished:false` and later set to true (recordImport.cjs:466-494). A crash leaves `finished:false` as an implicit "partial import" state.
- The seed flag `seeded`/`seededAt` is cleared on any import write (functions/src/imports/seedFlag.cjs:9-18).
- Problem, policy drift: the import keeps the stored email of an `invited` speaker (speakerImport.cjs:228-231), while the admin editor accepts the change, supersedes the invite and resets to draft (profile.cjs:361-371). The same event gets two policies.

## Custom badges
- No lifecycle. This is a list-removal action only (functions/src/admin/customBadges.cjs:55-71). A removed badge is not blocklisted, so the attendee can add it again.

## Cross-cutting findings
1. **Three definitions of "this account is a speaker".** firestore.rules:453 and :590-594, plus materials/actor.cjs:67, use `users.speakerId != null`. Server self-service uses uid ownership (profile.cjs:86-91). The web uses status ∈ {accepted, approved} (speakerDashboardEligibility.js:1). profile.cjs:336-338 clears the link only on `removed`, so a speaker set back to draft keeps access. Fix: clear the uid/speakerId pair on any move out of accepted or approved, or add one shared `isActiveSpeaker` used by the server, the rules mirror and the web.
2. **A pitch can be declined after its drafts were created.** pitches.cjs:615-635 never checks `conversion`, and AdminSessionPitch.jsx:174-186 still offers Decline. Fix: refuse a status change when `conversion` is set, or define an explicit un-convert step.
3. **Speaker status changes have no transition table.** profile.cjs:336-379 accepts draft->approved (no account), accepted->draft, and removed->approved (unlinked). Fix: add an `ALLOWED_SPEAKER_TRANSITIONS` map in shared/speaker.cjs and check it in applyUpdateSpeaker.
4. **Four delivery-state vocabularies for one idea:**
   - pitch notices: queued/sent/failed/unknown (pitchNotices.cjs:178)
   - change-request notices: queued/sent/failed/unknown/suppressed (changeRequestNotices.cjs:234)
   - reminders: sending/sent/failed/uncertain (reminderCore.cjs:354-355)
   - access mail: accepted/failed/uncertain (accessMail.cjs:106-110)

   Pitch and change-request notices also duplicate the queuedRecord and retry code. Fix: one shared `noticeRecord` module with one state list.
5. **Spelling drift: rejected vs declined.** Pitch stores `rejected` and shows "Declined" (pitchStatus.js:3), its template is `pitch.declined` (pitch.cjs:79), and change requests store `declined` (changeRequests.cjs:112). Receipt modes are `automatic|manual` (pitch.cjs:82) but `off|automatic` for change requests (changeRequestNotices.cjs:65). Fix: migrate to one spelling and one mode pair.
6. **Lists duplicated instead of imported:**
   - pitch STATUSES at pitches.cjs:39 and pitchNotices.cjs:61, not in shared
   - ELIGIBLE_STATUSES (speakerDashboardEligibility.js:1) copies REMINDABLE_SPEAKER_STATUSES
   - COUNTED_REVIEW_STATUSES (materialsCoverage.js:22) copies COUNTED_MATERIAL_STATUSES
   - REMINDER_GROUPS (speakerReminders.js:6-14) copies EXPORT_GROUPS
   - VISIBILITIES (share.cjs:38) copies PROFILE_VISIBILITIES and firestore.rules:378
   - speakerRecordState and pendingFieldsOf are copied in AdminSpeakersList.jsx:83-98 and AdminSpeakerEditor.jsx:74-91

   Fix: import them from shared or from one admin module.
7. **The speaker's "next steps" list leaves out the session-description item** that reminders ask for: speakerCompletion.js:9-38 vs speakerReadiness.cjs:41 and 140-148. This contradicts its own comment. Fix: add the description requirement, or compute the list from speakerReadiness().
8. **Speaker and pitch rows are created in several places with hand-built server-owned fields.**
   - Speakers: profile.cjs:206-217, speakerImport.cjs:175-182, pitchQueue.cjs:147-149, demo-event.cjs:67.
   - Pitches: pitches.cjs:279-292, pitchQueue.cjs:61, airtableSync.cjs:212-231.

   Fix: add `newSpeakerRecord()` and `newPitchRecord()` factories in shared.
9. **Invites expire implicitly and stay `pending`/`invited` forever.** Nothing sweeps them, and the admin note shows a past "Expires" date (inviteTokens.cjs:45,58; AdminSpeakersList.jsx:194-197). The outstanding invite is also encoded three ways (invites.cjs:465-476). Fix: show expired in the list, or add an `expired` status set at read time or by a sweep.
10. **Staged edits and claims are never tidied.** pendingEdits survives a status change away from approved (profile.cjs:647 vs 336-392). headshotDeleteClaims grows forever (upload.cjs:637-748), and only self-edit checks it. Fix: clear pendingEdits on leaving approved, prune claims after a successful delete, and check claims in admin and import saves.
11. **Concurrency and audit are inconsistent.**
    - Change-request status has no optimistic guard (changeRequests.cjs:508-545); pitch review does.
    - Material review has no reviewer stamp or audit row (review.cjs:58).
    - Feedback status is updated outside a transaction (feedback.cjs:336).
    - The Airtable lease release has no owner check (airtableSync.cjs:400).
    - The reminder final stamp is not attempt-checked (reminderCore.cjs:357).

    Fix: one pattern of expected revision plus a same-transaction audit row.
12. **Dead or legacy code:**
    - INVITE_STATUSES and INVITE_TERMINAL_STATUSES (inviteTokens.cjs:58,61) are unused.
    - linkSpeakerToUser and unlinkSpeakerFromUser (lifecycle.cjs:248-262) are uncalled.
    - sendSessionConfirmationEmail (confirmation.cjs) is uncalled.
    - Legacy `privateNotes` is still writable beside `reviewNotes` (pitches.cjs:635; pitchNotes.cjs:12).
    - `conversion.speakerId` duplicates `speakerIds` (pitchQueue.cjs:151).
    - The firestore.rules:509-510 writer list is stale.

    Fix: remove them, or mark them deprecated and stop writing them.
13. **Two policies for an email change on an invited speaker.** The import keeps the old address (speakerImport.cjs:228-231). The editor supersedes the invite and resets to draft (profile.cjs:361-371). Fix: route both through one helper.
