'use strict';

/**
 * The event data package (issue #329): one zip that holds the event's
 * records as JSON and CSV, a manifest, and a README, for the customer
 * handoff after an event.
 *
 * `downloadEventPackage` is operator tier. The package holds attendees,
 * purchasers and pitch submitters, and a staff admin does not see orders
 * as a list anywhere else. POST `{ sections, includeStaffNotes }`:
 *
 *   sections           which parts to include (SECTION_IDS). Each is an
 *                      explicit choice; the admin page ticks all of them.
 *   includeStaffNotes  whether a pitch keeps the reviewers' private notes.
 *                      Off unless the operator turns it on.
 *
 * WHAT NEVER GOES. config/bootstrap (the admin allowlist) and
 * config/providers (provider wiring), every draft and version-history
 * collection (the CSV files too read the live documents only; a hidden
 * live record goes, with visible: false), the audit log, sign-in challenges, rate-limit windows, the
 * sent-mail log, invite tokens, webhook deliveries, the ticket sync queue,
 * payment attempts and raw provider payloads, and every secret. EXCLUDED
 * below is that list with the reason for each, and the manifest carries it,
 * so a reader can see what is missing on purpose. The records come from
 * exportRecords.cjs, which names every private field it copies and then
 * strips any key that names a credential.
 *
 * BOUNDED. Collections are read a page at a time (exportRecords.cjs
 * readPages), each collection once per package, at most MAX_PACKAGE_DOCS
 * documents in all, and the zip may
 * not pass MAX_PACKAGE_BYTES: the platform caps an HTTP function's response
 * near 10 MB. A larger event uses scripts/export-event-package.cjs, which
 * builds the same package with no cap from an operator's terminal.
 *
 * PRIVATE DELIVERY. The zip goes out in the response body only. It is never
 * written to Firestore or Storage, so there is no object path to guess or
 * leak. The admin_logs row is written, and awaited, before the first byte.
 * No row, no package.
 */

const crypto = require('node:crypto');
const { ZipFile } = require('yazl');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const { internals: { buildCsv: buildAttendeeCsv } } = require('../users/export.cjs');
const { internals: { DATASETS, buildCsv: buildDatasetCsv } } = require('./dataExport.cjs');
const {
  LimitError,
  admissionRecord,
  attendeeRecord,
  materialRecord,
  mediaRecord,
  orderRecord,
  organizationRecord,
  pitchRecord,
  publicRecord,
  readDocs,
  readRecords,
  scrub,
  sessionRecord,
  speakerRecord,
} = require('./exportRecords.cjs');

const ADMIN_LOGS = 'admin_logs';
const ACTION = 'downloadEventPackage';
const FORMAT = 'eventrunner-event-data-package';
const SCHEMA_VERSION = 1;

/** Most documents one package built by the endpoint may read. */
const MAX_PACKAGE_DOCS = 50000;

/** Most bytes one package from the endpoint may hold: under the platform's 10 MB response cap. */
const MAX_PACKAGE_BYTES = 9 * 1024 * 1024;

/** The config documents a package carries. Every one is world-readable already. */
const CONFIG_DOCS = Object.freeze(['event', 'theme', 'features', 'badges', 'pitch_call']);

/** The body keys this endpoint accepts. */
const BODY_KEYS = Object.freeze(['sections', 'includeStaffNotes']);

/**
 * Read one collection into a JSON file. `toRecord` is the record function
 * from exportRecords.cjs.
 */
function jsonFile(path, source, toRecord, description) {
  return {
    path,
    source,
    format: 'json',
    description,
    build: (ctx) => readRecords({ db: ctx.db, collection: source, counter: ctx.counter, maxDocs: ctx.maxDocs, cache: ctx.cache }, toRecord),
  };
}

/**
 * One of the spreadsheets from dataExport.cjs, as a CSV file in the
 * package. It reads the live documents only: the package holds no draft.
 */
function datasetFile(path, name, description) {
  const dataset = DATASETS[name];
  return {
    path,
    source: dataset.docPath,
    format: 'csv',
    description,
    build: (ctx) => dataset.read({ ...ctx, liveOnly: true }),
    toCsv: (rows) => buildDatasetCsv(dataset, rows, Infinity),
  };
}

/**
 * The parts of a package, in the order the admin page lists them. Each
 * part names its files; each file names its source collection, its format
 * and one line for the README.
 */
const SECTIONS = Object.freeze([
  {
    id: 'content',
    label: 'Site content and settings',
    files: [
      {
        path: 'content/config.json',
        source: 'config',
        format: 'json',
        description: `The public settings documents (${CONFIG_DOCS.map((id) => `config/${id}`).join(', ')}): event details, days, venue, site style, feature switches, badges and the pitch call. One object keyed by document id.`,
        build: async ({ db }) => {
          const snaps = await db.getAll(...CONFIG_DOCS.map((id) => db.collection('config').doc(id)));
          const out = {};
          CONFIG_DOCS.forEach((id, index) => {
            out[id] = snaps[index].exists ? scrub(snaps[index].data()) : null;
          });
          return out;
        },
      },
      jsonFile('content/content.json', 'cmsContent', publicRecord, 'Live content blocks: one record per section and field. visible is false for a block the site hides.'),
      jsonFile('content/pages.json', 'cmsPages', publicRecord, 'Live pages with their sections. visible is false for a page the site hides.'),
      jsonFile('content/updates.json', 'cmsUpdates', publicRecord, 'Live updates (news posts). visible is false for an update the site hides.'),
      jsonFile('content/timeline.json', 'cmsTimeline', publicRecord, 'Live timeline entries. visible is false for an entry the site hides.'),
      jsonFile('content/announcements.json', 'announcements', publicRecord, 'Announcements with their display windows.'),
      jsonFile('content/live-updates.json', 'live_updates', publicRecord, 'Live updates posted during the event, each with its category and its audience (everyone, attendees, or speakers).'),
      jsonFile('content/media.json', 'media_assets', mediaRecord, 'The media library index: each uploaded file\'s Storage path, type, size, alt text and title. The files themselves stay in Storage.'),
    ],
  },
  {
    id: 'program',
    label: 'Program',
    files: [
      jsonFile('program/sessions.json', 'cmsSchedule', sessionRecord, 'Live sessions. visible is false for a session the site hides, such as one converted from a pitch and not yet shown. speakerIds lists speakers/speakers.json ids; parentId names another session.'),
      datasetFile('program/sessions.csv', 'sessions', 'Live sessions as a spreadsheet: day, times, speaker names, and Hidden for a session the site hides. No drafts.'),
    ],
  },
  {
    id: 'speakers',
    label: 'Speakers',
    files: [
      jsonFile('speakers/speakers.json', 'speakers', speakerRecord, 'Every speaker record with contact address and pipeline status. No account ids or invite tokens.'),
      datasetFile('speakers/speakers.csv', 'speakers', 'Speakers as a spreadsheet, with the titles of their published sessions (live and shown).'),
    ],
  },
  {
    id: 'organizations',
    label: 'Organizations and sponsors',
    files: [
      jsonFile('organizations/organizations.json', 'cmsOrganizations', organizationRecord, 'Live organizations and sponsors with tier, website and logo path. visible is false for one the site hides.'),
      datasetFile('organizations/organizations.csv', 'organizations', 'Live organizations as a spreadsheet, with Hidden for one the site hides. No drafts.'),
    ],
  },
  {
    id: 'materials',
    label: 'Session materials',
    files: [
      jsonFile('materials/materials.json', 'session_materials', materialRecord, 'Session materials: a link names its address, a file names its Storage path. sessionId names program/sessions.json.'),
    ],
  },
  {
    id: 'attendees',
    label: 'Attendees',
    files: [
      jsonFile('attendees/attendees.json', 'users', attendeeRecord, 'Attendee accounts: the approved profile fields, registration status and badges. id joins tickets and pitches.'),
      {
        path: 'attendees/attendees.csv',
        source: 'users',
        format: 'csv',
        description: 'Attendees as a spreadsheet, in the columns of the Attendees page export.',
        build: async (ctx) => (await readDocs({
          db: ctx.db, collection: 'users', counter: ctx.counter, maxDocs: ctx.maxDocs, cache: ctx.cache,
        })).map(({ data }) => data),
        toCsv: (users, ctx) => buildAttendeeCsv(users, ctx.config),
      },
    ],
  },
  {
    id: 'orders',
    label: 'Ticket orders and admissions',
    files: [
      jsonFile('orders/orders.json', 'ticket_orders', orderRecord, 'Ticket orders: amounts in the currency\'s minor unit (see currencyExponent), payment and refund state, and the ticket ids each order issued.'),
      datasetFile('orders/orders.csv', 'orders', 'Ticket orders as a spreadsheet, with amounts in major units.'),
      jsonFile('orders/admissions.json', 'tickets', admissionRecord, 'Admissions (one per ticket) from every ticketing source: holder, status, check-in. orderId names an order.'),
      datasetFile('orders/admissions.csv', 'admissions', 'Admissions as a spreadsheet.'),
      jsonFile('orders/catalog.json', 'ticket_catalog', publicRecord, 'The ticket catalog: ticket types, prices and sales windows.'),
    ],
  },
  {
    id: 'pitches',
    label: 'Session pitches',
    files: [
      {
        path: 'pitches/pitches.json',
        source: 'session_pitches',
        format: 'json',
        description: 'Session pitches with their review status and revision. convertedSessionId and convertedSpeakerId name the session and speaker a converted pitch became; the session is in program/sessions.json once it is published. staffNotes is present only when the operator chose to include it.',
        build: (ctx) => readRecords(
          { db: ctx.db, collection: 'session_pitches', counter: ctx.counter, maxDocs: ctx.maxDocs, cache: ctx.cache },
          (id, data) => pitchRecord(id, data, { includeStaffNotes: ctx.includeStaffNotes }),
        ),
      },
    ],
  },
]);

const SECTION_IDS = Object.freeze(SECTIONS.map((section) => section.id));

/** What a package never holds, and why. The manifest and the README carry this list. */
const EXCLUDED = Object.freeze([
  { source: 'config/bootstrap', reason: 'The admin allowlist. It controls access to this deployment.' },
  { source: 'config/providers', reason: 'Provider wiring for this deployment. Secrets live in Secret Manager and never in Firestore.' },
  { source: '*_drafts, cmsVersionHistory, cmsPublishQueue, cmsMeta', reason: 'Editing state. Every file holds live records only: a draft that was never published is not in the package. A hidden live record is, with visible: false (Hidden: yes in a CSV file).' },
  { source: 'admin_logs', reason: 'The audit log stays with the deployment. Request it separately.' },
  { source: 'auth_challenges, auth_rate_limits, auth_send_ceiling', reason: 'Sign-in codes and limits. Credentials.' },
  { source: '*_rate_limits', reason: 'Rate-limit windows. Operational only.' },
  { source: 'sent_emails, email_claims, email_templates', reason: 'The outbound mail log and its bodies.' },
  { source: 'speaker_invites, speaker_slugs', reason: 'Invite token hashes and slug reservations.' },
  { source: 'speaker_reminders, reminder_schedules, reminder_schedule_runs, reminder_ledger', reason: 'Reminder settings and the record of each reminder sent. Operational only.' },
  { source: 'ticket_webhook_deliveries, ticket_sync_queue, ticket_payment_attempts, ticket_inventory', reason: 'Raw provider payloads, the sync queue, payment attempts and holds.' },
  { source: 'users/*/bookmarks, users/*/sessionNotes, schedule_shares', reason: 'Each attendee\'s private saved sessions and notes.' },
  { source: 'users_public, speakers_public, session_materials_public, announcements_public', reason: 'Public projections of records the package already holds.' },
  { source: 'feedback, change_requests, system_errors', reason: 'Inbox and diagnostic records. Request them separately.' },
  { source: 'Storage files', reason: 'Uploaded images and material files. The package lists their paths; copy the bucket for the files.' },
]);

/** The relationships the README documents and verifyEventPackage checks. */
const RELATIONSHIPS = Object.freeze([
  { from: 'program/sessions.json', field: 'speakerIds[]', to: 'speakers/speakers.json' },
  { from: 'program/sessions.json', field: 'parentId', to: 'program/sessions.json' },
  { from: 'materials/materials.json', field: 'sessionId', to: 'program/sessions.json' },
  { from: 'materials/materials.json', field: 'submittedBySpeakerId', to: 'speakers/speakers.json' },
  { from: 'attendees/attendees.json', field: 'speakerId', to: 'speakers/speakers.json' },
  { from: 'orders/orders.json', field: 'ticketIds[]', to: 'orders/admissions.json' },
  { from: 'orders/admissions.json', field: 'orderId', to: 'orders/orders.json' },
  { from: 'orders/admissions.json', field: 'claimedByAccountId', to: 'attendees/attendees.json' },
  { from: 'orders/orders.json', field: 'purchaserAccountId', to: 'attendees/attendees.json' },
  { from: 'pitches/pitches.json', field: 'submitterAccountId', to: 'attendees/attendees.json' },
  { from: 'pitches/pitches.json', field: 'convertedSessionId', to: 'program/sessions.json' },
  { from: 'pitches/pitches.json', field: 'convertedSpeakerId', to: 'speakers/speakers.json' },
]);

/** The package's folder name inside the zip, and the saved file name. */
function packageName(at) {
  return `event-data-package-${at.toISOString().slice(0, 10)}`;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Validate `{ sections, includeStaffNotes }`.
 *
 * @param {unknown} body
 * @returns {{ ok: true, sections: string[], includeStaffNotes: boolean } | { ok: false, errors: string[] }}
 */
function readPackageRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['body: must be a JSON object with sections and includeStaffNotes.'] };
  }
  const errors = [];
  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.includes(key)) errors.push(`${key}: is not accepted. Send sections and includeStaffNotes only.`);
  }
  const sections = [];
  if (!Array.isArray(body.sections) || body.sections.length === 0) {
    errors.push('sections: choose at least one part of the package.');
  } else {
    for (const [index, id] of body.sections.entries()) {
      if (!SECTION_IDS.includes(id)) {
        errors.push(`sections[${index}]: must be one of ${SECTION_IDS.join(', ')}.`);
      } else if (!sections.includes(id)) {
        sections.push(id);
      }
    }
  }
  if (typeof body.includeStaffNotes !== 'boolean') errors.push('includeStaffNotes: must be true or false.');
  if (errors.length > 0) return { ok: false, errors };
  // File order follows SECTIONS, not the request.
  return { ok: true, sections: SECTION_IDS.filter((id) => sections.includes(id)), includeStaffNotes: body.includeStaffNotes };
}

/** The README a package carries: what each file is, what is left out, and how to handle it. */
function buildReadme({ manifest }) {
  const lines = [
    '# Event data package',
    '',
    `Exported ${manifest.exportedAt}. Format \`${FORMAT}\`, schema version ${SCHEMA_VERSION}.`,
    '',
    'This package holds the event\'s records as the deployment stored them. `manifest.json` lists every file with its record count and SHA-256 checksum.',
    '',
    '## Files',
    '',
    '| File | Source | Records | What it holds |',
    '|---|---|---|---|',
    ...manifest.files.map((file) => `| \`${file.path}\` | \`${file.source}\` | ${file.records ?? ''} | ${file.description} |`),
    '',
    '## Formats',
    '',
    '- A JSON file is one array of records (`content/config.json` is one object). Every record has an `id`: the Firestore document id. Times are ISO 8601 strings in UTC. A session\'s `startTime` and `endTime` are wall-clock times in the event\'s time zone (`content/config.json`, `event.timezone`).',
    '- A CSV file starts with a UTF-8 byte-order mark, quotes every cell, and ends each row with CRLF. A cell that starts with =, +, - or @ gains a leading apostrophe, so a spreadsheet shows it as text and does not run it.',
    '- Order amounts in JSON are integers in the currency\'s minor unit. Divide by 10 to the power of `currencyExponent`.',
    '',
    '## Relationships',
    '',
    ...RELATIONSHIPS.map((rel) => `- \`${rel.from}\` \`${rel.field}\` names an \`id\` in \`${rel.to}\`.`),
    '',
    'Run `node scripts/export-event-package.cjs --verify <file.zip>` from the Event Runner repository to check the checksums, the counts and these links.',
    '',
    '## Left out on purpose',
    '',
    ...manifest.excluded.map((entry) => `- \`${entry.source}\`: ${entry.reason}`),
    '',
    '## Personal data and retention',
    '',
    '- This package holds personal data: names, email addresses, organizations and profile details of attendees, speakers, purchasers and pitch submitters.',
    '- Store it in a place with access control. Do not send it as an open link.',
    '- Keep it only as long as the client\'s retention policy allows, then delete every copy.',
    '- A person who asks to be deleted after this export must also be removed from every copy of this package.',
    `- Staff notes on pitches: ${manifest.includeStaffNotes ? 'included, at the operator\'s choice' : 'not included'}.`,
    '- Account ids (`id` in attendees, `*AccountId` fields) are opaque keys. They join records and grant no access.',
    '',
  ];
  return lines.join('\n');
}

/**
 * Build every file of a package. Pure apart from the reads.
 *
 * @param {{ db: object, config?: object, sections: string[], includeStaffNotes: boolean,
 *           at: Date, maxDocs?: number }} args
 * @returns {Promise<{ name: string, files: Array<{ path: string, buffer: Buffer }>, manifest: object }>}
 * @throws {LimitError}
 */
async function buildEventPackage({ db, config = {}, sections, includeStaffNotes, at, maxDocs = MAX_PACKAGE_DOCS }) {
  // One cache per build: a collection that feeds several files is read once.
  const ctx = { db, config, counter: { read: 0 }, cache: new Map(), maxDocs, includeStaffNotes };
  const name = packageName(at);
  const files = [];
  const entries = [];
  for (const section of SECTIONS) {
    if (!sections.includes(section.id)) continue;
    for (const file of section.files) {
      const rows = await file.build(ctx);
      const records = Array.isArray(rows) ? rows.length : null;
      const content = file.format === 'csv' ? file.toCsv(rows, ctx) : JSON.stringify(rows, null, 2);
      const buffer = Buffer.from(content, 'utf8');
      files.push({ path: file.path, buffer });
      entries.push({
        path: file.path,
        section: section.id,
        source: file.source,
        format: file.format,
        records,
        bytes: buffer.length,
        sha256: sha256(buffer),
        description: file.description,
      });
    }
  }
  const manifest = {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: at.toISOString(),
    sections: [...sections],
    includeStaffNotes,
    files: entries,
    relationships: RELATIONSHIPS.filter((rel) => entries.some((e) => e.path === rel.from) && entries.some((e) => e.path === rel.to)),
    excluded: EXCLUDED,
  };
  files.unshift(
    { path: 'manifest.json', buffer: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    { path: 'README.md', buffer: Buffer.from(buildReadme({ manifest }), 'utf8') },
  );
  return { name, files, manifest };
}

/**
 * The files as one deflated zip, every entry inside the package's folder.
 *
 * @param {{ name: string, files: Array<{ path: string, buffer: Buffer }>, at: Date }} args
 * @returns {Promise<Buffer>}
 */
function zipPackage({ name, files, at }) {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    const chunks = [];
    zip.outputStream.on('data', (chunk) => chunks.push(chunk));
    zip.outputStream.on('error', reject);
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    for (const file of files) {
      zip.addBuffer(file.buffer, `${name}/${file.path}`, { mtime: at, compress: true });
    }
    zip.end();
  });
}

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           now?: () => Date, log?: Pick<Console, 'info'|'error'>,
 *           maxDocs?: number, maxBytes?: number }} deps
 */
function createDownloadEventPackageHandler({
  db, auth, getConfig, now = () => new Date(), log = console,
  maxDocs = MAX_PACKAGE_DOCS, maxBytes = MAX_PACKAGE_BYTES,
}) {
  return async function downloadEventPackage(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    const verdict = await requireAdmin({ auth, db, getConfig }, req, { tier: 'operator' });
    if (!verdict.ok) return sendError(res, verdict.status, verdict.code, verdict.message);

    const request = readPackageRequest(req.body);
    if (!request.ok) return badRequest(res, request.errors.join('; '));

    const at = now();
    let built;
    let zip;
    const tooLarge = () => sendError(
      res, 413, 'too-large',
      'This event is too large to package here. Run scripts/export-event-package.cjs from a terminal instead (docs/operator/archive-handoff.md).',
    );
    try {
      const config = await getConfig();
      built = await buildEventPackage({ db, config, ...request, at, maxDocs });
      zip = await zipPackage({ name: built.name, files: built.files, at });
    } catch (err) {
      if (err instanceof LimitError) return tooLarge();
      log.error('downloadEventPackage: the package could not be built', err);
      return internal(res, 'The package could not be built. Try again.');
    }
    if (zip.length > maxBytes) return tooLarge();

    try {
      await db.collection(ADMIN_LOGS).doc().set({
        action: ACTION,
        docPath: 'event-package',
        uid: verdict.uid,
        email: verdict.email,
        at,
        details: {
          sections: request.sections,
          includeStaffNotes: request.includeStaffNotes,
          files: built.manifest.files.map((file) => ({ path: file.path, records: file.records })),
          bytes: zip.length,
        },
      });
    } catch (err) {
      log.error('downloadEventPackage: the admin_logs row could not be written; nothing was sent', err);
      return internal(res, 'The package could not be recorded, so it was not sent. Try again.');
    }

    log.info?.(`downloadEventPackage: ${built.manifest.files.length} files, ${zip.length} bytes`);
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${built.name}.zip"`);
    res.set('Cache-Control', 'private, max-age=0, no-store');
    return res.status(200).send(zip);
  };
}

/** Deployable export: downloadEventPackage. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (handled) return;
    await handler(req, res);
  };

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getEventConfig } = require('../core/config.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }) };
  };

  return {
    // 1 GiB and 300 s: at the document cap the JSON is built in memory.
    downloadEventPackage: onRequest({ region, memory: '1GiB', timeoutSeconds: 300 }, withCors(async (req, res) => {
      await createDownloadEventPackageHandler(buildDeps())(req, res);
    })),
  };
}

module.exports = {
  createDownloadEventPackageHandler,
  buildEventPackage,
  zipPackage,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    ACTION,
    CONFIG_DOCS,
    EXCLUDED,
    FORMAT,
    MAX_PACKAGE_BYTES,
    MAX_PACKAGE_DOCS,
    RELATIONSHIPS,
    SCHEMA_VERSION,
    SECTIONS,
    SECTION_IDS,
    buildReadme,
    packageName,
    readPackageRequest,
  },
};
