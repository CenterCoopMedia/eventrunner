'use strict';

/**
 * The outbound email log (issue #183): two staff-tier POST endpoints over
 * `sent_emails`, the audit row email/send.cjs writes for every send() call.
 *
 *   listSentEmails { q?, source?, status?, limit?, cursor? } → { rows, nextCursor, scanned }
 *   getSentEmail   { id }                                    → { row }
 *
 * `sent_emails` is server-only (firestore.rules: allow read, write: if
 * false, admins included), so these two are its only readers, through the
 * Admin SDK. send.cjs stays its only writer. Nothing here writes to it.
 *
 * TWO ENDPOINTS, NOT ONE. A list never carries a body: the query selects
 * LIST_FIELDS, which holds neither `html` nor `text`, so a body never leaves
 * Firestore for a list. Each body can be 100 KB, and a page of 25 with both
 * bodies could reach 5 MB. getSentEmail returns one row with its bodies.
 *
 * WHO. Both endpoints are staff tier (parity plan: "the overview and the
 * email log are staff visible"). An operator reaches them too. Reading a
 * person's mail is the sensitive act, so getSentEmail writes one admin_logs
 * row per read that names the actor and the path only: never an address,
 * never a subject. A list is a read of the log, and writes none, as
 * listSystemErrors writes none.
 *
 * SEARCH IS A BOUNDED SCAN. Firestore has no substring query, and `to` is
 * stored as the caller gave it (only auth/otp.cjs normalizes), so an
 * equality lookup would miss rows. With `q`, one request reads at most
 * SCAN_CAP rows, newest first, and keeps a row when its recipient or its
 * subject contains `q`, compared lowercased; a null field never matches.
 * The cursor is the last row EXAMINED, not the last row returned, so the
 * next call continues the scan where this one stopped. `q` is compared in
 * memory only: it never reaches a query, a log line, or an error message.
 *
 * `source` and `status` are equality filters, so each shape has its
 * composite index in firestore.indexes.json (log.test.cjs pins them). The
 * cursor is `{ sentAt, id }` with `__name__` as the tiebreaker, the same
 * shape listSystemErrors pages with: two sends in one millisecond on a page
 * boundary are neither skipped nor repeated.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { sendError, badRequest, notFound, methodNotAllowed, internal } = require('../core/errors.cjs');

const COLLECTION = 'sent_emails';
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
/** The most rows one search request reads. */
const SCAN_CAP = 500;
const MAX_QUERY_LENGTH = 200;
const MAX_ID_LENGTH = 128;
const SOURCE_RE = /^[a-z0-9-]{1,64}$/;
const STATUSES = Object.freeze(['sent', 'failed']);

/** Every field a list row carries. Never a body. */
const LIST_FIELDS = Object.freeze([
  'sentAt',
  'to',
  'from',
  'subject',
  'templateId',
  'source',
  'status',
  'deliveryStatus',
  'deliveryUpdatedAt',
  'bounceReason',
  'error',
  'retries',
  'bodyStored',
  'bodyTruncated',
]);

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * A Firestore document id this endpoint will pass to `doc()` or
 * `startAfter()`: 1 to 128 characters, no `/`, not `.` or `..`, and not a
 * reserved `__…__` name. Each of those makes the SDK throw, and a thrown
 * query is a 500 where a 400 is the honest answer.
 */
function isValidDocId(id) {
  return (
    typeof id === 'string' &&
    id.length >= 1 &&
    id.length <= MAX_ID_LENGTH &&
    !id.includes('/') &&
    id !== '.' &&
    id !== '..' &&
    !/^__.*__$/.test(id)
  );
}

/** @param {unknown} v @returns {number|null} millis, or null if not a usable instant */
function toMillis(v) {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

const str = (v) => (typeof v === 'string' ? v : null);

/** One list row: named fields only, so a new stored field never leaks by default. */
function toRow(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    sentAt: toMillis(data.sentAt),
    to: str(data.to),
    from: str(data.from),
    subject: str(data.subject),
    templateId: str(data.templateId),
    source: str(data.source),
    status: str(data.status),
    deliveryStatus: str(data.deliveryStatus),
    deliveryUpdatedAt: toMillis(data.deliveryUpdatedAt),
    bounceReason: str(data.bounceReason),
    error: str(data.error),
    retries: Number.isInteger(data.retries) ? data.retries : null,
    bodyStored: data.bodyStored !== false,
    bodyTruncated: data.bodyTruncated === true,
  };
}

/** One row for the preview: the list fields plus the bodies and the provider fields. */
function toDetail(doc) {
  const data = doc.data() || {};
  return {
    ...toRow(doc),
    html: str(data.html),
    text: str(data.text),
    providerMessageId: str(data.providerMessageId),
    providerStatus: Number.isFinite(data.providerStatus) ? data.providerStatus : null,
  };
}

/**
 * Validate a list request. Each refusal names its field and never repeats
 * the value it was given: a search value is personal data.
 *
 * @returns {{ ok: true, q: string|null, source: string|null, status: string|null,
 *             limit: number, cursor: { sentAt: number, id: string }|null } |
 *           { ok: false, message: string }}
 */
function parseListRequest(body) {
  const { q, source, status, limit, cursor } = isPlainObject(body) ? body : {};
  const absent = (v) => v === undefined || v === null;

  let query = null;
  if (!absent(q)) {
    if (typeof q !== 'string' || q.trim().length > MAX_QUERY_LENGTH) {
      return { ok: false, message: `q must be text of at most ${MAX_QUERY_LENGTH} characters.` };
    }
    query = q.trim().toLowerCase() || null;
  }
  if (!absent(source) && !(typeof source === 'string' && SOURCE_RE.test(source))) {
    return { ok: false, message: 'source must be a source id: lowercase letters, digits and hyphens, at most 64.' };
  }
  if (!absent(status) && !STATUSES.includes(status)) {
    return { ok: false, message: 'status must be sent or failed.' };
  }
  if (!absent(limit) && !(Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT)) {
    return { ok: false, message: `limit must be a whole number from 1 to ${MAX_LIMIT}.` };
  }
  if (!absent(cursor) && !(isPlainObject(cursor) && Number.isFinite(cursor.sentAt) && isValidDocId(cursor.id))) {
    return { ok: false, message: 'cursor must be { sentAt, id } from a previous page.' };
  }
  return {
    ok: true,
    q: query,
    source: absent(source) ? null : source,
    status: absent(status) ? null : status,
    limit: absent(limit) ? DEFAULT_LIMIT : limit,
    cursor: absent(cursor) ? null : { sentAt: cursor.sentAt, id: cursor.id },
  };
}

/** Whether a row's recipient or subject contains `q` (already lowercased). */
function matches(row, q) {
  return [row.to, row.subject].some((field) => typeof field === 'string' && field.toLowerCase().includes(q));
}

const cursorOf = (row) => ({ sentAt: row.sentAt, id: row.id });

/**
 * @param {{ db: FirebaseFirestore.Firestore, auth, getConfig, log?: Pick<Console, 'error'> }} deps
 */
function createListSentEmailsHandler({ db, auth, getConfig, log = console }) {
  return async function listSentEmails(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const request = parseListRequest(req.body);
    if (!request.ok) return badRequest(res, request.message);
    const { q, source, status, limit, cursor } = request;

    // Each filter shape has its composite index (firestore.indexes.json);
    // the __name__ tiebreaker rides on every index automatically.
    let query = db.collection(COLLECTION);
    if (source) query = query.where('source', '==', source);
    if (status) query = query.where('status', '==', status);
    query = query.orderBy('sentAt', 'desc').orderBy('__name__', 'desc');
    if (cursor) query = query.startAfter(new Date(cursor.sentAt), cursor.id);
    query = query.select(...LIST_FIELDS);

    // Without q, one extra row decides nextCursor without a second query.
    // With q, one query of SCAN_CAP rows is the whole budget.
    const asked = q ? SCAN_CAP : limit + 1;
    let snap;
    try {
      snap = await query.limit(asked).get();
    } catch (err) {
      log.error('listSentEmails query failed', err);
      return internal(res, 'The email log is temporarily unavailable.');
    }
    const all = snap.docs.map(toRow);

    if (!q) {
      const rows = all.slice(0, limit);
      const nextCursor = all.length > limit ? cursorOf(rows[rows.length - 1]) : null;
      return res.status(200).json({ rows, nextCursor, scanned: rows.length });
    }

    const rows = [];
    let scanned = 0;
    for (const row of all) {
      scanned += 1;
      if (matches(row, q)) rows.push(row);
      if (rows.length >= limit) break;
    }
    // Null only when the query came back short AND every row it returned
    // was examined: then nothing older is left to scan.
    const exhausted = all.length < asked && scanned === all.length;
    const nextCursor = exhausted ? null : cursorOf(all[scanned - 1]);
    return res.status(200).json({ rows, nextCursor, scanned });
  };
}

/**
 * @param {{ db: FirebaseFirestore.Firestore, auth, getConfig, now?: () => number,
 *           log?: Pick<Console, 'error'|'warn'> }} deps
 */
function createGetSentEmailHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function getSentEmail(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const id = isPlainObject(req.body) ? req.body.id : undefined;
    if (!isValidDocId(id)) return badRequest(res, 'id must be a message id from the email log.');

    let snap;
    try {
      snap = await db.collection(COLLECTION).doc(id).get();
    } catch (err) {
      log.error('getSentEmail read failed', err);
      return internal(res, 'The email log is temporarily unavailable.');
    }
    if (!snap.exists) return notFound(res, 'This message is not in the email log.');

    // The row names who read which message, and nothing about the message.
    await logAdminAction({
      db,
      action: 'view-sent-email',
      docPath: `${COLLECTION}/${id}`,
      actor: { uid: gate.uid, email: gate.email },
      now,
      log,
    });
    return res.status(200).json({ row: toDetail(snap) });
  };
}

/** Deployable exports (spec §1.3): listSentEmails, getSentEmail. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }) };
  };

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    });
    if (handled) return;
    await handler(req, res);
  };

  const expose = (create) =>
    onRequest({ region }, withCors(async (req, res) => {
      await create(buildDeps())(req, res);
    }));

  return {
    listSentEmails: expose(createListSentEmailsHandler),
    getSentEmail: expose(createGetSentEmailHandler),
  };
}

module.exports = {
  createListSentEmailsHandler,
  createGetSentEmailHandler,
  // Lazily built so requiring this module in tests never pulls in
  // firebase-functions.
  get handlers() {
    return buildHandlers();
  },
  internals: {
    toRow,
    toDetail,
    toMillis,
    isValidDocId,
    parseListRequest,
    LIST_FIELDS,
    SCAN_CAP,
    DEFAULT_LIMIT,
    MAX_LIMIT,
  },
};
