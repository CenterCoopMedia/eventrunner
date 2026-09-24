'use strict';

/**
 * exportAttendees — the attendee list as a spreadsheet file (issue #184).
 *
 * A PII egress point, so three rules hold here and nowhere else:
 *
 *   1. EXACTLY the owner-approved field set leaves the deployment:
 *      name, email, organization, role, registration status, badges,
 *      past attendance, social handles, and profile visibility. The columns
 *      are one list (EXPORT_COLUMNS), and each column reads one named field
 *      — no spread of the account document, so a field added to `users`
 *      later is private until it is added to that list. No uid, pronouns,
 *      bio, photo path, approval source, speaker id, or timestamp.
 *   2. A cell a spreadsheet would read as a formula is escaped (escapeCell).
 *   3. Every export writes an admin_logs row, and the file is refused when
 *      that write fails. This is a deliberate exception to the
 *      logAdminAction contract in cms/store.cjs ("a failed audit write NEVER
 *      fails the mutation"): an export is an egress, not a mutation, and an
 *      egress with no record is the failure this audit exists to prevent.
 *
 * The client sends the uids on screen, in screen order, and the server
 * re-reads each account. The file therefore matches the screen by
 * construction, with no second copy of the page's filter. The search text
 * is never sent: it can hold a person's name or address, and an audit row
 * outlives the account it names. The row records the status filter and
 * whether a search narrowed the list, and nothing else.
 *
 * The file lives only in the response body. It is never written to
 * Firestore or Storage (storage.rules makes `exports/` world-readable).
 * Function logs carry counts only, never a cell value.
 */

const { buildPublicProfile } = require('shared/profile');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const {
  internals: { readUid },
} = require('./approval.cjs');

const USERS = 'users';
const ADMIN_LOGS = 'admin_logs';

/** Most rows one export may carry. */
const MAX_EXPORT_ROWS = 10000;

/**
 * The largest file one export may carry, in bytes of CSV. The rules put no
 * length limit on profile fields, so the row cap alone does not bound the
 * file (connector review of PR 274); this keeps it well inside what a
 * function holds in memory and answers in one response.
 */
const MAX_EXPORT_BYTES = 10 * 1024 * 1024;

/** The file would pass MAX_EXPORT_BYTES. */
class ExportTooLargeError extends Error {
  constructor(maxBytes) {
    super(`the export would pass ${maxBytes} bytes`);
    this.name = 'ExportTooLargeError';
  }
}

/** Firestore's getAll batch size. */
const READ_CHUNK = 500;

/** The attendees page's status filter values (AdminAttendees.jsx STATUS_FILTERS). */
const STATUS_FILTER_VALUES = Object.freeze(['all', 'pending', 'ticketed', 'approved', 'revoked']);

/** The body keys this endpoint accepts. Any other key is refused by name. */
const BODY_KEYS = Object.freeze(['uids', 'filter']);
const FILTER_KEYS = Object.freeze(['status', 'searched']);

/** Joins the entries of a list cell. */
const LIST_SEPARATOR = '; ';

/**
 * The leading characters a spreadsheet reads as the start of a formula:
 * `=`, `+`, `-`, `@`, and a tab or carriage return, which some programs
 * strip before they look at the next character. A cell whose first
 * character is one of these, or whose first character after leading
 * whitespace is one of the first four, gains a leading apostrophe. The
 * apostrophe is the spreadsheet's own "this is text" mark, so the value
 * still reads correctly; an `=` inside a value is not a formula and is
 * left alone.
 */
const FORMULA_TRIGGER = /^(?:[\t\r]|\s*[=+\-@])/;

/** @param {unknown} value @returns {string} */
function asText(value) {
  return typeof value === 'string' ? value : '';
}

/** @param {unknown} value @returns {string[]} */
function textList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()) : [];
}

/**
 * The configured label for each badge id, from config/badges. A badge with
 * no label keeps its id, so a half-seeded config never exports a blank.
 *
 * @param {object|null|undefined} badgesConfig
 * @returns {Map<string, string>}
 */
function badgeLabels(badgesConfig) {
  const labels = new Map();
  const categories = Array.isArray(badgesConfig?.categories) ? badgesConfig.categories : [];
  for (const category of categories) {
    for (const badge of Array.isArray(category?.badges) ? category.badges : []) {
      if (badge && typeof badge.id === 'string' && !labels.has(badge.id)) {
        labels.set(badge.id, typeof badge.label === 'string' && badge.label ? badge.label : badge.id);
      }
    }
  }
  return labels;
}

/**
 * The export's columns, in file order. Each reads one named field of the
 * account document (`user`) or of its public projection (`profile`, for the
 * configured badges and the flag-gated custom badges). Changing this list
 * changes what leaves the deployment: the field set is the owner's decision
 * (docs/plans/2026-09-09-cjs-parity-gap.md, M9 item 7).
 */
const EXPORT_COLUMNS = Object.freeze([
  { header: 'Name', value: ({ user }) => asText(user.displayName) },
  { header: 'Email', value: ({ user }) => asText(user.email) },
  { header: 'Organization', value: ({ user }) => asText(user.organization) },
  // "Role" is the profile form's label for jobTitle. users.role is an
  // access input and is never exported.
  { header: 'Role', value: ({ user }) => asText(user.jobTitle) },
  { header: 'Registration status', value: ({ user }) => asText(user.registrationStatus) },
  {
    header: 'Badges',
    value: ({ profile, labels }) => [
      ...profile.badges.map((id) => labels.get(id) ?? id),
      ...(Array.isArray(profile.customBadges) ? profile.customBadges : []),
    ].join(LIST_SEPARATOR),
  },
  { header: 'Past attendance', value: ({ user }) => textList(user.pastAttendance).join(LIST_SEPARATOR) },
  {
    header: 'Social handles',
    value: ({ profile }) => Object.entries(profile.socialHandles)
      .filter(([label, handle]) => label && handle.trim())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([label, handle]) => `${label}: ${handle}`)
      .join(LIST_SEPARATOR),
  },
  { header: 'Profile visibility', value: ({ user }) => asText(user.profileVisibility) },
]);

/**
 * Escape one cell for a spreadsheet, then quote it for CSV. Runs on the
 * whole cell, so a list cell is checked once, on its first entry.
 *
 * @param {string} value
 * @returns {string} the quoted CSV field
 */
function escapeCell(value) {
  const text = asText(value);
  const safe = FORMULA_TRIGGER.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * The export's rows as values, one array per account, from the account
 * document alone. Pure; the handler and the tests share it.
 *
 * @param {object} user the users/{uid} document
 * @param {{ badges?: object|null, features?: object|null }} config
 * @returns {string[]}
 */
function exportRow(user, config) {
  const source = user && typeof user === 'object' ? user : {};
  const profile = buildPublicProfile(source, config?.badges ?? null, config?.features ?? null);
  const context = { user: source, profile, labels: badgeLabels(config?.badges) };
  return EXPORT_COLUMNS.map((column) => column.value(context));
}

/**
 * The whole file: a byte-order mark (so a spreadsheet reads UTF-8), the
 * header, one line per account, CRLF line ends, every cell quoted.
 *
 * @param {object[]} users
 * @param {{ badges?: object|null, features?: object|null }} config
 * @returns {string}
 */
function buildCsv(users, config) {
  const lines = [csvHeader()];
  for (const user of users) lines.push(csvLine(user, config));
  return joinCsv(lines);
}

/** The header line. */
function csvHeader() {
  return EXPORT_COLUMNS.map((column) => escapeCell(column.header)).join(',');
}

/** One account's line: the exported cells only, escaped and quoted. */
function csvLine(user, config) {
  return exportRow(user, config).map(escapeCell).join(',');
}

/** The byte-order mark, the lines, CRLF line ends. */
function joinCsv(lines) {
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** `attendees-YYYY-MM-DD.csv`, the UTC date of the export. */
function exportFilename(at) {
  return `attendees-${at.toISOString().slice(0, 10)}.csv`;
}

/**
 * Validate the request body. Returns the cleaned request, or the list of
 * `field: reason` messages the admin client splits with fieldErrorsOf.
 *
 * @param {unknown} body
 * @returns {{ ok: true, uids: string[], filter: { status: string, searched: boolean } } |
 *           { ok: false, errors: string[] }}
 */
function readExportRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['body: must be a JSON object with uids and filter.'] };
  }
  const errors = [];
  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.includes(key)) errors.push(`${key}: is not accepted. Send uids and filter only.`);
  }

  const uids = [];
  if (!Array.isArray(body.uids) || body.uids.length === 0) {
    errors.push('uids: must list at least one attendee.');
  } else if (body.uids.length > MAX_EXPORT_ROWS) {
    errors.push('uids: at most 10,000 attendees per export. Narrow the filter.');
  } else {
    // Duplicates are dropped and the first position is kept. One bad id
    // is named, not ten thousand.
    const seen = new Set();
    for (let index = 0; index < body.uids.length; index += 1) {
      const uid = readUid(body.uids[index]);
      if (!uid) {
        errors.push(`uids[${index}]: must be an account id.`);
        break;
      }
      if (seen.has(uid)) continue;
      seen.add(uid);
      uids.push(uid);
    }
  }

  const filter = body.filter;
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    errors.push('filter: must be an object with status and searched.');
  } else {
    for (const key of Object.keys(filter)) {
      if (!FILTER_KEYS.includes(key)) errors.push(`filter.${key}: is not accepted. Send status and searched only.`);
    }
    if (!STATUS_FILTER_VALUES.includes(filter.status)) {
      errors.push(`filter.status: must be one of ${STATUS_FILTER_VALUES.join(', ')}.`);
    }
    if (typeof filter.searched !== 'boolean') {
      errors.push('filter.searched: must be true or false.');
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, uids, filter: { status: filter.status, searched: filter.searched } };
}

/**
 * Read the accounts in request order, a getAll chunk at a time, and turn
 * each into its line as it arrives, so no whole account document outlives
 * its chunk. An absent account is skipped and counted. The file is refused
 * as soon as it would pass `maxBytes`.
 *
 * @param {{ db: object, uids: string[], config: object, maxBytes?: number }} args
 * @returns {Promise<{ csv: string, rowCount: number, skipped: number }>}
 * @throws {ExportTooLargeError}
 */
async function buildExport({ db, uids, config, maxBytes = MAX_EXPORT_BYTES }) {
  const lines = [csvHeader()];
  // The byte-order mark, the header and its line end.
  let bytes = Buffer.byteLength(joinCsv(lines));
  let skipped = 0;
  for (let start = 0; start < uids.length; start += READ_CHUNK) {
    const refs = uids.slice(start, start + READ_CHUNK).map((uid) => db.collection(USERS).doc(uid));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) {
        skipped += 1;
        continue;
      }
      const line = csvLine(snap.data() || {}, config);
      bytes += Buffer.byteLength(line) + 2;
      if (bytes > maxBytes) throw new ExportTooLargeError(maxBytes);
      lines.push(line);
    }
  }
  return { csv: joinCsv(lines), rowCount: lines.length - 1, skipped };
}

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           now?: () => Date, log?: Pick<Console, 'info'|'error'>, maxExportBytes?: number }} deps
 */
function createExportAttendeesHandler({
  db, auth, getConfig, now = () => new Date(), log = console, maxExportBytes = MAX_EXPORT_BYTES,
}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    const verdict = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!verdict.ok) return sendError(res, verdict.status, verdict.code, verdict.message);

    const request = readExportRequest(req.body);
    if (!request.ok) return badRequest(res, request.errors.join('; '));

    const at = now();
    let csv;
    let rowCount;
    let skipped;
    try {
      const config = await getConfig();
      ({ csv, rowCount, skipped } = await buildExport({
        db, uids: request.uids, config, maxBytes: maxExportBytes,
      }));
    } catch (err) {
      // Refused before the audit row: no row, no file.
      if (err instanceof ExportTooLargeError) {
        return sendError(res, 413, 'too-large', `This export is larger than ${MAX_EXPORT_BYTES / 1024 / 1024} MB. Narrow the filter and export again.`);
      }
      log.error('exportAttendees: the accounts could not be read', err);
      return internal(res, 'The attendee list could not be read. Try again.');
    }

    // The audit row is written, and awaited, BEFORE the file leaves. No
    // row, no file.
    try {
      await db.collection(ADMIN_LOGS).doc().set({
        action: 'exportAttendees',
        docPath: USERS,
        uid: verdict.uid,
        email: verdict.email,
        at,
        details: { rowCount, filter: request.filter },
      });
    } catch (err) {
      log.error('exportAttendees: the admin_logs row could not be written; no file was sent', err);
      return internal(res, 'The export could not be recorded, so no file was made. Try again.');
    }

    log.info?.(`exportAttendees: ${rowCount} rows, ${skipped} skipped`);
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ filename: exportFilename(at), csv, rowCount, skipped });
  };
}

/** Deployable export (spec §1.3 users/): exportAttendees. */
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

  const buildAdminDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getEventConfig } = require('../core/config.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }) };
  };

  return {
    exportAttendees: onRequest({ region }, withCors(async (req, res) => {
      await createExportAttendeesHandler(buildAdminDeps())(req, res);
    })),
  };
}

module.exports = {
  createExportAttendeesHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    EXPORT_COLUMNS,
    MAX_EXPORT_BYTES,
    MAX_EXPORT_ROWS,
    buildExport,
    STATUS_FILTER_VALUES,
    buildCsv,
    escapeCell,
    exportRow,
    exportFilename,
    readExportRequest,
  },
};
