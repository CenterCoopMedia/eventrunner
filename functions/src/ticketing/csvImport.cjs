'use strict';

/**
 * `ticketingImportCsv` and `ticketingListTickets` (spec §3.3, §4.2; issue
 * #31) — the admin surface the `manual` provider's ticket set is built and
 * read through.
 *
 * FLEXIBLE COLUMN MAPPING (maintainer decision, issue #31). A client's CSV
 * export names its columns however it likes ("Email", "E-mail Address",
 * "Attendee Email"…), so this endpoint does not assume a header shape. The
 * browser parses the file and sends `{ mapping, rows }`: `mapping` maps our
 * fixed vocabulary (`email`, `id`, `orderId`, `firstName`, `lastName`,
 * `name`, `ticketClass`, `status`, `purchasedAt`) to the CSV's own column
 * names, and `rows` are the parsed records keyed by THOSE original column
 * names. Only `email` and `id` are required — "order/ticket id" is
 * deliberately one field: most CSV exports have one row per ticket with no
 * separate order concept, so `id` doubles as `orderId` unless the admin maps
 * a distinct order column.
 *
 * DRY RUN vs COMMIT. Both modes run the identical validate → normalize →
 * dedupe → classify pipeline (`buildImportPreview`) and differ only in
 * whether `upsertTickets` (sync.cjs) is then called — so a dry-run preview
 * can never show a different verdict than the commit that follows it. The
 * existence check (create vs. update) does one read per surviving row,
 * which is also why rows are capped (MAX_IMPORT_ROWS): an admin re-pasting
 * a 50,000-row platform export would otherwise spend that many reads on a
 * preview nobody asked to commit yet.
 *
 * The write path is NOT a new upsert: valid, non-duplicate rows are handed
 * to `upsertTickets` from sync.cjs unchanged, so a CSV import respects
 * exactly the same server-owned fields (claim state survives a re-import,
 * `createdAt` survives, §4.2) that every other ticketing write path does.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const {
  internals: { TICKETS, isSafeDocId, TICKET_STATUSES },
} = require('./index.cjs');
const { upsertTickets } = require('./sync.cjs');

const PROVIDER_NAME = 'manual';

/** Same shape auth/otp.cjs and shared/speaker.cjs use. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A CSV pasted from a full platform export can be large; bound it. */
const MAX_IMPORT_ROWS = 500;
/** Guards against one absurd cell (a pasted document, not a ticket record). */
const MAX_CELL_LENGTH = 500;
/** Every mapping target the admin may point at a CSV column. */
const REQUIRED_MAPPING_FIELDS = ['email', 'id'];
const OPTIONAL_MAPPING_FIELDS = [
  'orderId', 'firstName', 'lastName', 'name', 'ticketClass', 'status', 'purchasedAt',
];
const MAPPING_FIELDS = [...REQUIRED_MAPPING_FIELDS, ...OPTIONAL_MAPPING_FIELDS];

/** Common CSV status spellings, normalized the way sync.cjs's normalizeTicket does for unknowns. */
const STATUS_ALIASES = {
  valid: 'valid', paid: 'valid', complete: 'valid', completed: 'valid', confirmed: 'valid', active: 'valid',
  refunded: 'refunded', refund: 'refunded',
  cancelled: 'cancelled', canceled: 'cancelled', cancel: 'cancelled', void: 'cancelled', voided: 'cancelled',
  pending: 'pending_info', unpaid: 'pending_info', 'pending_info': 'pending_info',
};

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** @param {unknown} v @returns {string} trimmed, capped */
function cell(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return typeof v === 'string' ? v.trim().slice(0, MAX_CELL_LENGTH) : '';
}

/**
 * Validate the request envelope: mapping shape and row count/shape. Does
 * NOT validate individual field values — that is per-row, in `mapRow`,
 * because a bad email in row 4 is a preview finding, not a 400.
 *
 * @param {unknown} body
 * @returns {{ ok: true, mapping: Record<string,string>, rows: object[], dryRun: boolean } |
 *            { ok: false, message: string }}
 */
function validateImportRequest(body) {
  if (!isPlainObject(body)) return { ok: false, message: 'body: must be a JSON object' };

  const mapping = body.mapping;
  if (!isPlainObject(mapping)) return { ok: false, message: 'mapping: must be a JSON object' };
  const cleanMapping = {};
  for (const field of MAPPING_FIELDS) {
    const value = mapping[field];
    if (typeof value === 'string' && value.trim()) cleanMapping[field] = value;
  }
  for (const field of REQUIRED_MAPPING_FIELDS) {
    if (!cleanMapping[field]) {
      return {
        ok: false,
        message: `mapping.${field}: required — map a CSV column to this field`,
      };
    }
  }

  const rows = body.rows;
  if (!Array.isArray(rows)) return { ok: false, message: 'rows: must be an array' };
  if (rows.length === 0) return { ok: false, message: 'rows: must contain at least one row' };
  if (rows.length > MAX_IMPORT_ROWS) {
    return { ok: false, message: `rows: at most ${MAX_IMPORT_ROWS} rows per import — split larger files` };
  }
  if (!rows.every(isPlainObject)) return { ok: false, message: 'rows: every row must be a JSON object' };

  return { ok: true, mapping: cleanMapping, rows, dryRun: body.dryRun !== false };
}

/** @param {string} raw @returns {string} one of TICKET_STATUSES */
function normalizeStatus(raw) {
  const key = raw.toLowerCase();
  if (STATUS_ALIASES[key]) return STATUS_ALIASES[key];
  if (TICKET_STATUSES.includes(key)) return key;
  // Empty/unmapped → an admin importing a roster is asserting these
  // tickets are good; an unrecognized non-empty value is treated the
  // conservative way sync.cjs's normalizeTicket treats it — "we don't know
  // yet" confers no entitlement (§3.4).
  return raw ? 'pending_info' : 'valid';
}

/** Split "Ada Lovelace" into { firstName: 'Ada', lastName: 'Lovelace' }. */
function splitName(name) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * Map + validate one CSV row into a TicketRecord (§3.3), or a list of
 * reasons it cannot be imported.
 *
 * @param {{ row: object, mapping: Record<string,string> }} args
 * @returns {{ ok: true, ticket: object } | { ok: false, reasons: string[] }}
 */
function mapRow({ row, mapping }) {
  const reasons = [];

  const email = cell(row[mapping.email]).toLowerCase();
  if (!email) reasons.push('missing email');
  else if (!EMAIL_RE.test(email)) reasons.push('invalid email address');

  const rawId = cell(row[mapping.id]);
  if (!rawId) reasons.push('missing order/ticket id');
  else if (!isSafeDocId(rawId)) reasons.push('order/ticket id is not usable as an identifier');

  if (reasons.length > 0) return { ok: false, reasons };

  const orderId = mapping.orderId ? cell(row[mapping.orderId]) || rawId : rawId;

  let firstName = mapping.firstName ? cell(row[mapping.firstName]) || null : null;
  let lastName = mapping.lastName ? cell(row[mapping.lastName]) || null : null;
  if (!firstName && !lastName && mapping.name) {
    const split = splitName(cell(row[mapping.name]));
    firstName = split.firstName;
    lastName = split.lastName;
  }

  const ticketClass = mapping.ticketClass ? cell(row[mapping.ticketClass]) || null : null;
  const purchasedAt = mapping.purchasedAt ? cell(row[mapping.purchasedAt]) || null : null;
  const status = normalizeStatus(mapping.status ? cell(row[mapping.status]) : '');

  return {
    ok: true,
    ticket: {
      externalId: rawId,
      orderId,
      email,
      firstName,
      lastName,
      ticketClass,
      quantity: 1,
      purchasedAt,
      status,
      // Original row, for support forensics (§3.3 TicketRecord.raw) —
      // capped the same way every cell is, so an oversized paste cannot
      // balloon one ticket document.
      raw: Object.fromEntries(Object.entries(row).map(([k, v]) => [cell(k) || k, cell(v)])),
    },
  };
}

/**
 * Validate, dedupe, and classify every row — shared by dry-run and commit
 * so they can never disagree (see module doc).
 *
 * @param {{ db: object, mapping: Record<string,string>, rows: object[] }} args
 * @returns {Promise<{ results: object[], summary: Record<string, number>, validTickets: object[] }>}
 */
async function buildImportPreview({ db, mapping, rows }) {
  const seenAt = new Map();
  const results = [];
  const candidates = [];

  rows.forEach((row, index) => {
    const mapped = mapRow({ row, mapping });
    if (!mapped.ok) {
      results.push({ index, verdict: 'invalid', reasons: mapped.reasons });
      return;
    }
    const { ticket } = mapped;
    if (seenAt.has(ticket.externalId)) {
      results.push({
        index,
        verdict: 'duplicate',
        externalId: ticket.externalId,
        reasons: [`duplicate of row ${seenAt.get(ticket.externalId) + 1}`],
      });
      return;
    }
    seenAt.set(ticket.externalId, index);
    candidates.push({ index, ticket });
  });

  // Sequential, one read per surviving row — bounded by MAX_IMPORT_ROWS, and
  // the same cost class as upsertTickets' own per-row transaction below.
  for (const { index, ticket } of candidates) {
    const snap = await db.collection(TICKETS).doc(ticket.externalId).get();
    results.push({
      index,
      verdict: snap.exists ? 'update' : 'create',
      externalId: ticket.externalId,
      email: ticket.email,
      orderId: ticket.orderId,
      status: ticket.status,
    });
  }

  results.sort((a, b) => a.index - b.index);
  const summary = { create: 0, update: 0, duplicate: 0, invalid: 0 };
  for (const row of results) summary[row.verdict] += 1;

  return { results, summary, validTickets: candidates.map((c) => c.ticket) };
}

/** Shared admin-POST preamble, mirroring speakers/invites.cjs's gateAdminPost. */
async function gateAdminPost({ auth, getConfig }, req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST']);
    return null;
  }
  const verdict = await requireAdmin({ auth, getConfig }, req);
  if (!verdict.ok) {
    sendError(res, verdict.status, verdict.code, verdict.message);
    return null;
  }
  return { uid: verdict.uid, email: verdict.email };
}

/** @param {{ db, auth, getConfig, now?, log? }} deps */
function createTicketingImportCsvHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function ticketingImportCsv(req, res) {
    const actor = await gateAdminPost({ auth, getConfig }, req, res);
    if (!actor) return;

    const validated = validateImportRequest(req.body);
    if (!validated.ok) return badRequest(res, validated.message);
    const { mapping, rows, dryRun } = validated;

    let preview;
    try {
      preview = await buildImportPreview({ db, mapping, rows });
    } catch (err) {
      log.error('ticketingImportCsv preview failed', err);
      return internal(res, 'The import could not be checked.');
    }

    if (dryRun) {
      res.status(200).json({
        ok: true, dryRun: true, total: rows.length, summary: preview.summary, rows: preview.results,
      });
      return;
    }

    let counts;
    try {
      counts = await upsertTickets({ db, tickets: preview.validTickets, providerName: PROVIDER_NAME, now, log });
    } catch (err) {
      log.error('ticketingImportCsv commit failed', err);
      return internal(res, 'The import could not be committed.');
    }

    await logAdminAction({
      db,
      action: 'ticketingImportCsv',
      docPath: TICKETS,
      actor,
      now,
      log,
    });

    res.status(200).json({
      ok: true,
      dryRun: false,
      total: rows.length,
      summary: preview.summary,
      created: counts.created,
      updated: counts.updated,
      rows: preview.results,
    });
  };
}

/** Cap on one page of the admin ticket list. */
const MAX_LIST_LIMIT = 100;

/**
 * `ticketingListTickets` — admin read path over `tickets/{externalId}`,
 * which firestore.rules denies to every client (`allow read, write: if
 * false`, same reasoning as the other two ticketing collections). Mirrors
 * `listSpeakerInvites` (speakers/invites.cjs): admin-gated POST, filtered
 * and capped IN THE QUERY, ordered newest first.
 *
 * "Searchable" here means exact-match, not full text — Firestore has no
 * text search, and an admin support flow ("does this attendee's address
 * have a ticket", "what does order 4821 look like") only ever needs exact
 * lookups. `email` and `status` filter; `externalId` looks up one document
 * directly, short-circuiting the rest.
 *
 * @param {{ db, auth, getConfig, log? }} deps
 */
function createTicketingListTicketsHandler({ db, auth, getConfig, log = console }) {
  return async function ticketingListTickets(req, res) {
    const actor = await gateAdminPost({ auth, getConfig }, req, res);
    if (!actor) return;

    const body = isPlainObject(req.body) ? req.body : {};
    const externalId = typeof body.externalId === 'string' ? body.externalId.trim() : '';
    if (externalId) {
      if (!isSafeDocId(externalId)) return badRequest(res, 'externalId: not a usable identifier');
      let snap;
      try {
        snap = await db.collection(TICKETS).doc(externalId).get();
      } catch (err) {
        log.error('ticketingListTickets lookup failed', err);
        return internal(res, 'The ticket could not be looked up.');
      }
      res.status(200).json({ tickets: snap.exists ? [{ id: snap.id, ...rowOf(snap.data()) }] : [], nextCursor: null });
      return;
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const status = typeof body.status === 'string' ? body.status.trim() : '';
    if (status && !TICKET_STATUSES.includes(status)) {
      return badRequest(res, `status: must be one of ${TICKET_STATUSES.join(', ')}`);
    }
    const limit = Number.isInteger(body.limit) && body.limit > 0
      ? Math.min(body.limit, MAX_LIST_LIMIT)
      : MAX_LIST_LIMIT;
    const cursor = typeof body.cursor === 'string' && body.cursor.trim() ? new Date(body.cursor.trim()) : null;
    if (cursor && Number.isNaN(cursor.getTime())) return badRequest(res, 'cursor: not a valid timestamp');

    let query = db.collection(TICKETS);
    if (email) query = query.where('email', '==', email);
    if (status) query = query.where('status', '==', status);
    query = query.orderBy('createdAt', 'desc').limit(limit);
    if (cursor) query = query.startAfter(cursor);

    let snap;
    try {
      snap = await query.get();
    } catch (err) {
      log.error('ticketingListTickets query failed', err);
      return internal(res, 'The tickets could not be listed.');
    }

    const tickets = snap.docs.map((doc) => ({ id: doc.id, ...rowOf(doc.data()) }));
    const last = snap.docs[snap.docs.length - 1]?.data();
    const nextCursor = snap.docs.length === limit && last?.createdAt instanceof Date
      ? last.createdAt.toISOString()
      : null;
    res.status(200).json({ tickets, nextCursor });
  };
}

/** One `tickets/{externalId}` doc, shaped for the admin list — timestamps as ISO strings. */
function rowOf(data = {}) {
  const iso = (v) => (v instanceof Date ? v.toISOString() : (typeof v === 'string' ? v : null));
  return {
    orderId: data.orderId ?? null,
    email: data.email ?? null,
    firstName: data.firstName ?? null,
    lastName: data.lastName ?? null,
    ticketClass: data.ticketClass ?? null,
    quantity: data.quantity ?? 1,
    status: data.status ?? null,
    provider: data.provider ?? null,
    claimedByUid: data.claimedByUid ?? null,
    claimedAt: iso(data.claimedAt),
    createdAt: iso(data.createdAt),
    updatedAt: iso(data.updatedAt),
  };
}

/** Deployable exports (spec §1.3): ticketingImportCsv, ticketingListTickets. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const { ticketingSecretNames } = require('./providers/index.cjs');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const secrets = ticketingSecretNames(process.env).map(defineSecret);

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
      methods: ['POST'],
    });
    if (handled) return;
    await handler(req, res);
  };

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }), now: Date.now, log: console };
  };

  return {
    ticketingImportCsv: onRequest({ region, secrets }, withCors(async (req, res) => {
      await createTicketingImportCsvHandler(buildDeps())(req, res);
    })),
    ticketingListTickets: onRequest({ region, secrets }, withCors(async (req, res) => {
      await createTicketingListTicketsHandler(buildDeps())(req, res);
    })),
  };
}

module.exports = {
  createTicketingImportCsvHandler,
  createTicketingListTicketsHandler,
  buildImportPreview,
  validateImportRequest,
  mapRow,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    PROVIDER_NAME,
    EMAIL_RE,
    MAX_IMPORT_ROWS,
    MAX_CELL_LENGTH,
    MAX_LIST_LIMIT,
    MAPPING_FIELDS,
    REQUIRED_MAPPING_FIELDS,
    OPTIONAL_MAPPING_FIELDS,
    STATUS_ALIASES,
    normalizeStatus,
    splitName,
    rowOf,
  },
};
