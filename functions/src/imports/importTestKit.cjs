'use strict';

/**
 * TEST-ONLY helpers for the record import tests (no emulator, house rule).
 * Nothing under src/ requires this outside *.test.cjs.
 */

const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { createImportRecordsCsvHandler, defaultImporters } = require('./recordImport.cjs');

const OPERATOR_EMAIL = 'operator@example.com';
const STAFF_EMAIL = 'staff@example.com';
const QUIET = { warn() {}, error() {}, info() {}, log() {} };
const T0 = Date.parse('2026-10-01T09:00:00.000Z');

/** The event config the session tests resolve days, tracks and places against. */
const EVENT_CONFIG = {
  name: 'Example event',
  days: [
    { id: 'day-1', date: '2026-11-12', label: 'Opening day', startTime: '08:00', endTime: '18:00' },
    { id: 'day-2', date: '2026-11-13', startTime: '08:00', endTime: '18:00' },
  ],
  tracks: [{ letter: 'A', name: 'Main hall' }, { letter: 'B', name: 'Workshops' }],
  venue: { places: [{ id: 'hall-1', name: 'Hall 1' }, { id: 'room-2', name: 'Room 2' }] },
};

function makeDb(seed = {}) {
  return makeFakeDb({
    'config/bootstrap': { adminEmails: [OPERATOR_EMAIL], staffEmails: [STAFF_EMAIL] },
    'config/event': EVENT_CONFIG,
    ...seed,
  });
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) { res.headers[name] = value; return res; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

/** Auth that answers for one address, verified. `null` is no token at all. */
function authFor(email) {
  return {
    async verifyIdToken() {
      if (email === null) throw new Error('no token');
      return { uid: `uid-${email}`, email, email_verified: true };
    },
  };
}

/**
 * Call importRecordsCsv once.
 *
 * @returns {Promise<{ statusCode: number, body: object }>}
 */
async function callImport(db, body, { email = STAFF_EMAIL, method = 'POST', now = () => T0 } = {}) {
  const handler = createImportRecordsCsvHandler({
    db,
    auth: authFor(email),
    getConfig: async () => ({}),
    importers: defaultImporters(),
    now,
    log: QUIET,
    // One more than the speakers stored: unique, because each create
    // stores one before the next row mints an id.
    newId: () => `speaker-${db.ids('speakers').length + 1}`,
  });
  const res = makeRes();
  await handler({ method, body, headers: { authorization: 'Bearer token' } }, res);
  return res;
}

/** Preview, then commit with the preview's digest: what the admin page does. */
async function previewAndCommit(db, body, options) {
  const preview = await callImport(db, { ...body, dryRun: true }, options);
  if (preview.statusCode !== 200) return { preview, commit: null };
  const commit = await callImport(db, { ...body, dryRun: false, confirmDigest: preview.body.digest }, options);
  return { preview, commit };
}

/** Collections no import may ever write: mail, invitations and live records. */
const FORBIDDEN_COLLECTIONS = Object.freeze([
  'sent_emails',
  'email_claims',
  'speaker_invites',
  'speakers_public',
  'cmsSchedule',
  'cmsOrganizations',
  'users',
]);

/** The collections an import wrote, from the fake's write audit. */
function writtenCollections(db, since = 0) {
  return [...new Set(db.writes.slice(since).map((w) => w.path.split('/')[0]))].sort();
}

module.exports = {
  OPERATOR_EMAIL,
  STAFF_EMAIL,
  EVENT_CONFIG,
  FORBIDDEN_COLLECTIONS,
  T0,
  makeDb,
  callImport,
  previewAndCommit,
  writtenCollections,
};
