# Ticket resource grants: inventory, activation and rollback

This runbook is for one client project at a time. It moves a deployment from the full-event ticket check to per-class ticket grants ([#557](https://github.com/CenterCoopMedia/eventrunner/issues/557), [#1008](https://github.com/CenterCoopMedia/eventrunner/issues/1008)), and back. The grant contract is in [tasks/specs/555-ticket-resource-grants.md](https://github.com/CenterCoopMedia/eventrunner/blob/main/tasks/specs/555-ticket-resource-grants.md) and the lifecycle is in [tasks/specs/556-ticket-grant-lifecycle.md](https://github.com/CenterCoopMedia/eventrunner/blob/main/tasks/specs/556-ticket-grant-lifecycle.md).

Merging this runbook does not activate grants on any deployment. Activation needs the organizer's approved class mappings and an operator decision for that project.

## Modes

`ticket_access_policies/current` sets the mode. Browsers cannot read or write it.

| State of `current` | Mode | Bookmark, reaction and note writes |
| --- | --- | --- |
| No document | Legacy | The attendee check alone decides. Every deployment is in this mode today. |
| `effectiveRevision: 0` | Legacy | The same as no document. This is the rollback state. |
| `effectiveRevision: 0`, `candidateRevision: N` | First sweep | Still legacy. The sweep writes grants for revision N. |
| `effectiveRevision: N`, `candidateRevision: null` | Granular | Speakers, admin-approved accounts and bootstrap admins/staff keep full access. Every other approved account needs a grant for revision N that covers the session or its day. |
| `effectiveRevision: N`, `candidateRevision: M` | Later sweep | Accounts that need a grant get **Access updating** until the sweep for M ends. |

The first sweep activates granular mode when it finishes. There is no separate switch.

The attendee feed follows the same modes and exemptions ([#1006](https://github.com/CenterCoopMedia/eventrunner/issues/1006)). In granular mode, reading posts and reply notifications, posting, replying, reporting a post and marking a notification read need the grant's `interactions` resource. Staff can still read, report and remove posts. During a later sweep the feed says access is updating, and an unsent post or reply comes back for the same reader when the feed reopens.

## Before you start

Run the commands from a checkout of `main` after `npm run prepare:functions` and `npm ci`. Use the client project's operator service account. Set the client values in the shell:

```bash
export EVENT_FIREBASE_PROJECT_ID=<client project>
export EVENT_TICKETING_PROVIDER=<stripe|eventbrite|manual>
export EVENT_TICKETING_EVENT_ID=<provider event ID>
export GOOGLE_APPLICATION_CREDENTIALS=<operator key file>
```

The provider and event ID must be the deployment's own values. A backfill refuses to run when they do not match the stored policy revision.

Reports and receipts contain counts, class IDs and account uids. They do not contain email addresses or names. Keep them with the project's operator records. A command never overwrites an existing file.

## 1. Take the inventory

The inventory only reads. Give it the candidate policy file that the organizer approved:

```bash
node scripts/ticket-grants.cjs inventory --policy <policy.json> --out <inventory-1.json>
```

Without `--policy` it uses the staged or effective revision, if there is one. A policy file with the same revision number as the staged or effective revision must be identical to it; the inventory then uses the stored revision, as a resumed sweep does. Exit code 0 means the activation condition holds and the policy file is valid. Exit code 2 means it does not; read the report.

Read these fields:

| Field | Meaning |
| --- | --- |
| `policy.issues` | The policy file does not validate against the deployment's days, sessions, provider and event. Fix the file. |
| `tickets.byClass` | Tickets for this provider and event by provider class ID, with the count that are valid. |
| `tickets.noClassId` | Tickets with no class ID. They grant nothing in granular mode. |
| `tickets.unmappedClassIds` | Class IDs that the policy does not map. Those tickets grant nothing. |
| `tickets.otherScope` | Tickets for another provider or event. They grant nothing. |
| `accounts.byApprovalSource` | Approved accounts by `approvalSource`. `missing` is an account with no `approvalSource`. |
| `accounts.needGrant` | Approved accounts that are not speakers and not admin-approved. Bootstrap admins and staff are counted here, but they keep full access. |
| `accounts.currentGrant` | Of those, the accounts with a grant for `candidateRevision`. Before the first sweep this is 0. |
| `accounts.projectedNoSessions` | Of those, the accounts whose grant under the policy covers no existing session. A day counts only when a session is on that day. These accounts lose new bookmark, reaction and note writes after activation. |
| `accounts.missingApprovalSource.unresolvedUids` | Approved accounts with no `approvalSource` whose grant does not cover an existing session. With a policy, this is the grant the next sweep or recompute writes, not a stored grant. Without a policy, it is the stored grant. |
| `activationReady` | True when `unresolvedUids` is empty. |

## 2. Correct the inputs

Repeat the inventory after each correction.

1. **Tickets with no class ID.** For Eventbrite, run a ticket sync: it stores each attendee's `ticket_class_id`. For CSV imports, import the same file again with a `ticketClassId` column. Use only the provider's own records or an import the organizer approved. Do not derive a class ID from a ticket name.
2. **Unmapped class IDs.** Add a mapping to the policy, or record that the organizer accepts that the class grants nothing. Check free, sponsor and complimentary classes with the organizer.
3. **Accounts in `unresolvedUids`.** Each one needs a ticket that maps to a class with sessions, or an explicit approval in Admin, which sets `approvalSource: 'admin'`. Activation does not start until this list is empty (coordinator condition, Nov. 15, 2026).
4. **`projectedNoSessions`.** Give the organizer the count. Those accounts keep read access but cannot add bookmarks, reactions or notes.

There is no fallback from an unknown or unmapped class to full access in granular mode. Do not add a catch-all class to make the counts go down.

## 3. Publish the revision

Publish only when the inventory exits 0 and the organizer approves the result. Use the current effective revision as the expected revision (0 for the first publication). Run the dry run first:

```bash
node scripts/ticket-grants.cjs publish --policy <policy.json> --expected-revision 0 --receipt <publish-dry-1.json>
node scripts/ticket-grants.cjs publish --policy <policy.json> --expected-revision 0 --apply --receipt <publish-1.json>
```

Both refuse, before any write, when:

- the expected revision is not the current effective revision;
- another revision is being recomputed;
- the policy revision is not above the effective revision, unless it resumes the staged revision;
- the policy differs from a stored revision with the same number;
- the policy file is not valid for the deployment;
- the activation condition in section 1 fails. The receipt's `checks` shows the inventory results that the decision used. The dry run stops after the checks.

With `--apply` the command stores the immutable revision, recomputes every account in pages of 100 and then sets the effective revision. The receipt has the sweep result (`sweep`) and the control document read back after it (`readback`). If the sweep stops, the receipt has `progress` and `error`. Correct the cause and run the same command again with the same policy. It continues from the last finished page. A different policy cannot replace an unfinished sweep.

For a later revision, publish at a quiet time. Accounts that need a grant get **Access updating** until the sweep ends.

## 4. Read back

1. Run the inventory again without `--policy`. Check that `control` is `{ "effectiveRevision": N, "candidateRevision": null }`, `accounts.currentGrant` equals `accounts.needGrant` and the command exits 0.
2. Run a backfill dry run (section 5). Check that `grantWrites` and `accountWrites` are 0.
3. Sign in with a limited test pass and confirm that a covered session accepts a bookmark and an uncovered session says the ticket does not include it.
4. With a pass that has no `interactions`, confirm that the attendee feed says the ticket does not include it. With a pass that has `interactions`, confirm that the post form appears.

## 5. Backfill grants

The backfill recomputes every account with the same code that the claim, the ticket trigger and the sweep use. Use it when a grant is missing or out of date, for example after a ticket trigger failed or after the class-ID corrections in section 2. It needs a staged or effective revision.

```bash
node scripts/ticket-grants.cjs backfill --receipt <backfill-dry-1.json>
```

The dry run is the default. It writes nothing and counts what it would write:

| Total | Meaning |
| --- | --- |
| `grantWrites` | Accounts whose grant would change. |
| `accountWrites` | Accounts whose registration status would change. The ticket trigger would make the same change. If this is not 0, find out why before you apply. A common cause is automatic approval turned off, which returns ticket approvals to review. |
| `invalid` | Accounts whose grant cannot be derived. Their uids are in `invalidUids`. Correct the policy or canonical data first. |

If the backfill stops on an error, the receipt keeps the totals of the accounts it finished and `failedUid`. Run it again; finished accounts count as unchanged.

Apply, then repeat the dry run:

```bash
node scripts/ticket-grants.cjs backfill --apply --receipt <backfill-apply-1.json>
node scripts/ticket-grants.cjs backfill --receipt <backfill-dry-2.json>
```

The second dry run shows `grantWrites: 0` and `accountWrites: 0`. A repeated apply writes nothing.

## 6. Roll back to legacy

Rollback does not publish anything. It sets the control document to the legacy state, so the attendee check alone decides again. Run the dry run, then apply:

```bash
node scripts/ticket-grants.cjs legacy --receipt <legacy-dry-1.json>
node scripts/ticket-grants.cjs legacy --apply --receipt <legacy-1.json>
```

With `--apply` the command writes `{ effectiveRevision: 0, candidateRevision: null, cursor: null, processed: 0, remaining: 0 }` to `ticket_access_policies/current` and reads it back. The receipt shows `legacy: true`. A project with no control document is already legacy, and the command does not create one. A running sweep stops with an error after the rollback; that is intended. Stored revisions stay as they are. After rollback, each account's next recompute removes its grant, because legacy mode has no grants.

To activate again, publish (section 3) with `--expected-revision 0`. The same stored revision can be published again; the sweep recomputes every account. If a session or day that the revision names was deleted after it was stored, that revision no longer validates. Publish a new revision number with current references.

## 7. Stay in legacy mode on purpose

A deployment that has no class-specific tickets does not need a policy. Do not publish one. With no `current` document every check is the same as before #557.
