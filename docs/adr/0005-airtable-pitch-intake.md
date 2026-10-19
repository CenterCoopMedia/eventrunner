# ADR 0005: Airtable refresh for session pitch intake

**Date:** 2026-10-19  
**Status:** Proposed for review with the implementation on this branch.  
**Supersedes:** one row of [ADR 0001 §9](0001-event-platform-v1.md#9-porting-map), "Airtable sync: not ported", for session pitch intake only.

## Context

ADR 0001 did not port the reference implementation's Airtable sync: four exports, six scripts and a formula escaper that wrote CMS content to and from Airtable. The reasons still hold for content. Firestore is the record for every published thing, and a second editable store makes two sources of truth. The README repeated the decision: "Airtable ... stays out".

Two things changed:

1. Session pitches arrived (`functions/src/sessions/`). A call for sessions can already send people to an external form, such as an Airtable form, and staff bring the answers in with a reviewed CSV import. That import blocks a whole batch when one row changes, and it needs a person to export and upload a file for every update.
2. The first paying client was sent proposals that include an Airtable connection in every tier: bring pitch records from an approved table into the private review queue, refresh them without duplicates, keep review decisions, and keep publication under staff control.

## Decision

Event Runner reads one operator-approved Airtable table into `session_pitches`. Nothing else uses Airtable.

- **Read only.** The token needs only `data.records:read` on one base. Event Runner never writes to Airtable. Airtable stays the record for the submitter's answers. Firestore stays the record for review decisions, notes, conversion and everything published.
- **One origin.** The client calls only `https://api.airtable.com`. Ids are checked by pattern. The emulator alone may name a loopback origin for the browser suite.
- **Managed secret.** The token is `AIRTABLE_API_TOKEN` in Secret Manager. It is bound only when the deployment sets `EVENT_AIRTABLE_ENABLED=true`, so other clients deploy as before. It never enters Firestore, a response or a log.
- **Operator approves, staff refresh.** An operator saves the base, table, view, field mapping and timing (`session_pitch_sources`, operator-read only). Staff may refresh, because a refresh only adds private proposals to the queue they already review and publishes nothing.
- **Upsert, never delete.** Records keep the CSV import's identity, so an earlier CSV import with the source name `airtable` is adopted. A changed record updates the proposal fields only and raises the review revision, so an open review of the old text conflicts. A removed record is flagged, not deleted. A row without a ticked consent box is skipped.
- **No queue.** The optional schedule is a scheduled function that runs the same refresh. It holds a ten-minute lease on the status document so runs cannot overlap. Nothing waits in Firestore for later work, so `ticket_sync_queue` stays the only queue.
- **No mail.** A refresh sends no email. A notification workflow for pitches must treat `source: 'airtable'` rows as having no Event Runner account.
- **Audit.** Every run writes `session_pitch_sync/airtable` (staff-readable) and one `admin_logs` row.

## Consequences

- Clients that use an Airtable form get updates without CSV round trips, and staff see what changed.
- The CSV import keeps its rule that a changed row blocks the batch. A file does not show which copy is current, so a silent overwrite there is less safe than a refusal.
- The scope of Airtable is fixed at pitch intake. A request to sync content, speakers or schedule with Airtable needs a new record.
- One refresh reads at most 1,000 records. A larger table needs a smaller view.
- If the client edits an accepted proposal in Airtable after conversion, the drafts do not change. The queue marks the pitch, and staff edit the drafts.
