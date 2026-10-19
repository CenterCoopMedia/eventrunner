# Archive and hand off a past event

Use this runbook after an event ends. It covers four things: the files the client receives, a full backup of the Firebase project, the uploaded files in Storage, and how to keep the past site online and read-only.

The client owns the event data. Each client deployment uses a separate Firebase project, so the data never shares a database with another client.

## Three kinds of access

These are different things. State which ones the client gets.

| What | What it gives | Who has it |
|---|---|---|
| Access to the cloud project | Console and command-line access to the Firebase and Google Cloud project: the database, Storage, logs and billing. | The deployment operator. The client gets it only when the contract says so. |
| Data ownership | The contract terms: the client owns the records the event collected, and decides how long to keep them. | The client. |
| Portable export | Files the client can open and keep without the project: spreadsheets and the event data package. | Anyone the client gives the files to. |

A portable export is not a backup of the project. A managed export (below) is a backup, and it needs the project to restore.

## 1. Spreadsheets for staff

Open **Data export** in the admin panel (System group). Staff and operators can export:

- **Sessions**: title, state, whether it is hidden, day, times, location, speakers and description.
- **Speakers**: name, email address, organization, status and published sessions.
- **Organizations and sponsors**: name, state, whether it is hidden, tier, website and description.

Operators can also export **Ticket orders** and **Admissions**. Those files name purchasers and amounts.

Attendees and session pitches export from their own pages, with the page's filter: **Attendees** → **Export**, and **Session pitches** → the queue export.

Every spreadsheet writes an admin log entry before the file is sent. A cell that starts with =, +, - or @ gains a leading apostrophe, so a spreadsheet shows it as text and does not run it. No file holds an account id, an invite token, a private note or a raw payment provider record.

## 2. The event data package

An operator selects **Download event data package** on the **Data export** page. The package is one zip file:

- One JSON file per record type: content and settings, pages, updates, timeline, announcements, live updates, the media library index, sessions, speakers, organizations, session materials, attendees, ticket orders, admissions, the ticket catalog and session pitches with their review state.
- CSV files for sessions, speakers, organizations, attendees, orders and admissions.
- `manifest.json`: the format name, the schema version, the export time, each file's record count and SHA-256 checksum, the relationships between files and the list of what is left out.
- `README.md`: what each file holds, the formats, the relationships, and the rules for personal data.

**Choose the parts.** Every part is selected at the start. Clear the parts the client does not need. **Include staff notes on session pitches** is off at the start. Turn it on only when the client asks for the reviewers' notes.

**Live records only.** Every file in the package, CSV files included, holds the live version of each record. A draft that was never published, and a newer draft of a live record, are not in it. A hidden live record is in it: `visible` is `false` in its JSON record, and **Hidden** is `yes` in its CSV row. Before you send the package to a third party, check the hidden records. The staff spreadsheets differ: they show drafts, with their state.

**What the package never holds.** `config/bootstrap` (the admin allowlist), `config/providers`, drafts and version history, the admin log, sign-in codes, rate limits, the sent mail log, invite tokens, webhook deliveries, the ticket sync queue, payment attempts, raw provider payloads, and every credential. Credentials live in Secret Manager, not in Firestore. The manifest lists each excluded collection with its reason.

**Delivery.** The zip goes from the server to the operator's browser only. The server writes no copy to Firestore or Storage, so there is no link to share by mistake. The server writes the admin log entry before it sends the file. If the entry cannot be written, the server sends nothing.

**Size.** The page can send a package of up to 9 MB (50,000 records). A larger event gets a message that names the script below.

### A large event: the script

Run the same export from a terminal with the operator's credentials:

```sh
EVENT_FIREBASE_PROJECT_ID=<project-id> node scripts/export-event-package.cjs --out event-data-package.zip
```

- `--sections program,speakers` limits the parts. The ids are `content`, `program`, `speakers`, `organizations`, `materials`, `attendees`, `orders` and `pitches`.
- `--include-staff-notes` adds the pitch reviewers' notes.
- `--force` replaces an existing file.

The script uses application-default credentials or `GOOGLE_APPLICATION_CREDENTIALS` (`scripts/lib/firebase-init.cjs`). It writes an admin log entry with `details.via: 'script'`, then the file with owner-only permissions.

### Check a package

```sh
node scripts/export-event-package.cjs --verify event-data-package.zip
```

The check reads the manifest, compares each file with its checksum and record count, and follows each relationship (for example, a session's `speakerIds` to `speakers/speakers.json`). It prints the counts and any reference that does not resolve. A reference that does not resolve is not damage: a speaker deleted after the event, or an admission from an external ticketing source, can name a record the package does not hold. The command exits 1 only when a file is missing, changed or not listed.

A consumer reads the package without Event Runner: unzip it, read `manifest.json`, and join the JSON files on `id`. `README.md` names every join.

## 3. A full backup: Firebase managed export

The package holds the records a client uses. A managed export holds the whole database, and it restores into a Firebase project.

1. Make a Cloud Storage bucket for the archive, in the same project or in the client's own project. Give it uniform bucket-level access and no public access.
2. Give the account that runs the export the **Cloud Datastore Import Export Admin** role (`roles/datastore.importExportAdmin`) and write access to the bucket.
3. Run the export:

   ```sh
   gcloud firestore export gs://<archive-bucket>/firestore-$(date +%Y-%m-%d) --project <project-id>
   ```

4. Wait for the operation to finish: `gcloud firestore operations list --project <project-id>`.

A managed export includes every collection, the admin log and the excluded collections among them. Treat it as more sensitive than the package. To restore it, run `gcloud firestore import` into a project.

## 4. Uploaded files in Storage

The package lists paths and does not copy files. Logos, images, profile photos and session material files stay in the project's Storage bucket. Copy them with the backup:

```sh
gcloud storage cp --recursive gs://<storage-bucket>/* gs://<archive-bucket>/storage-$(date +%Y-%m-%d)/
```

`cms-images/` and `branding/` hold the site's images, and `content/media.json` in the package names each one's path. `session-materials/<sessionId>/` holds material files, and `materials/materials.json` names each one's path. `speaker-photos/` and `profile-photos/` hold speaker and attendee photos, which are personal data.

## 5. Keep the past site online, read-only

The public site can stay online after the event:

1. Settle ticketing first. Pause sales, finish refunds and reconciliation, and wait until the ticket sync queue is empty. The [deploy runbook](../DEPLOY_RUNBOOK.md) section "Archiving an event with ticket sales" gives the order.
2. Close the pitch call in **Session pitches**.
3. In **Settings → Event settings**, set the **archive date**. Every day becomes a back issue: the content stays, and bookmarking, reactions and calendar links go away.
4. Set `config/event.historicalDemo` to `true`. Account, feedback and email actions then refuse writes. The admin panel stays readable, and both exports still work.
5. Remove staff access the client no longer needs on **Access**.

To take the site offline instead, export first, then disable Hosting (`firebase hosting:disable --project <project-id>`).

## 6. Retention and deletion

- Agree a retention period with the client before the handoff, and write it in the handoff record.
- Store the package, the managed export and the Storage copy with access control. Do not send any of them as an open link.
- When a person asks to be deleted after the export, delete the account in **Attendees**, and remove the person from every copy of the package and the backup, or delete those copies.
- When the retention period ends, delete the archive bucket, every downloaded package, and, when the contract ends, the Firebase project.

## Handoff record

Record these items for each handoff:

- The date of the package and its `manifest.json` checksum list.
- The parts included, and whether staff notes were included.
- The location of the managed export and the Storage copy.
- Who received each one, and the retention period.
- Whether the site stays online, and the archive date.
