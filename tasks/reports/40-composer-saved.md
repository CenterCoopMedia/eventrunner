# Report: 40-composer-saved (#496, #497, parent #203)

Branch `joe/blissful-einstein-9qvtd1-40-composer-saved`, from main `767f2b9`.

## #496 Saved announcement messages

- New staff-tier endpoint `announcementMessages` (`functions/src/announcements/messages.cjs`):
  `list`, `load`, `save` (no id creates, an id updates), `rename`, `remove`.
- Store `announcement_messages/{id}`: server-only (`firestore.rules`), not the banner store
  and not the speaker wording overrides. Fields: `name` (1 to 80 characters, no control
  characters), `subject`, `message`, `linkUrl`, `linkLabel`, `createdAt`, `updatedAt`.
- The draft is checked by `compose.cjs` `validateDraft`, the composer's own check. It now
  also refuses the render's two internal slot words in any field.
- Random ids; duplicate names allowed. At most 100 messages (new saves refused at the limit,
  updates allowed). Historical demo refuses save, rename and remove. Each change writes an
  `admin_logs` row with actor and path only.
- Composer: new `AnnouncementSavedMessages.jsx` panel. Load keeps the audience, drops the
  preview and confirmation, and asks first when the draft has unsaved edits.

## #497 Send history remainder

- `sent_emails` rows carry `sendId` (additive change in `email/send.cjs`); `listSentEmails`
  takes a `sendId` filter (four new indexes). The email log page reads `?send=`.
- History list: no `failures`, `message` or `link`; adds `auditGaps`; pages with a
  `{ createdAt, id }` cursor (limit 1 to 50, 20 by default).
- `getAnnouncementSend`: frozen draft, rendered bodies with the inert link, failures;
  audited `view-announcement-send` row.
- `sendBatch` marks `auditFailed` on a result whose audit row failed; `runChunk` counts
  `auditGaps`; the history states the gap.
- `sweepExpiredAnnouncementSends` in `maintenance/cleanup.cjs`: 90 days, strict `<`, bounded
  batches. It replaces the record with `{ status: 'expired', unsubscribeKey, contentRemovedAt }`
  instead of deleting it, so unsubscribe links in old mail still work.
- The Announcements admin page is now lazy loaded, to keep the admin entry chunk in budget.

## Decisions the owner may want to change

- Retention keeps a key-only tombstone, not a delete (see above).
- A saved message stores no audience; load keeps the current audience.
- No saved-message reference is stored on a send record (the issue calls it optional).
- `createdBy` (the staff sender's address) stays in the history list; no recipient address does.
- The 100-message cap is checked with `count()` outside a transaction, so two concurrent
  creates at 99 can reach 101.
