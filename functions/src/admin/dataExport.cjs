'use strict';

/**
 * exportEventData: one spreadsheet of the event's records (issue #329).
 *
 * POST `{ dataset }`, where dataset is one of DATASETS. The answer is
 * `{ filename, csv, rowCount }`, the same shape exportAttendees answers, and
 * the admin saves it with the same download code.
 *
 * TIERS. Sessions, speakers and organizations are staff tier: a staff admin
 * already reads every one of those documents in the admin panel. Ticket
 * orders and admissions are operator tier: they name purchasers and carry
 * payment state, and the ticketing page shows them to staff one order at a
 * time only. The gate admits both tiers, then refuses an operator dataset
 * to staff by name, so the refusal says which tier it needs.
 *
 * The rules users/export.cjs set for the attendee file hold here too:
 *
 *   1. Explicit columns. Each column reads one field of a record from
 *      exportRecords.cjs, which names every field it copies. No account id,
 *      private note, invite token, raw provider payload or staff address.
 *   2. A formula-shaped cell gains a leading apostrophe (escapeCell).
 *   3. The admin_logs row is written, and awaited, before the file leaves.
 *      No row, no file.
 *
 * The file lives only in the response body. Function logs carry counts only.
 */

const { requireAdmin, internals: { tierSatisfies } } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const { internals: { escapeCell } } = require('../users/export.cjs');
const {
  LIST_SEPARATOR,
  LimitError,
  admissionRecord,
  orderRecord,
  organizationRecord,
  readDocs,
  readRecords,
  sessionRecord,
  speakerRecord,
} = require('./exportRecords.cjs');

const ADMIN_LOGS = 'admin_logs';
const ACTION = 'exportEventData';

/** Most documents one spreadsheet may read, summed over its collections. */
const MAX_EXPORT_DOCS = 20000;

/** The largest file one spreadsheet may carry, in bytes (the attendee export's cap). */
const MAX_EXPORT_BYTES = 10 * 1024 * 1024;

/** The body keys this endpoint accepts. */
const BODY_KEYS = Object.freeze(['dataset']);

class TooLargeError extends Error {}

/** @param {string} id @param {object|null} event config/event */
function dayOf(id, event) {
  const days = Array.isArray(event?.days) ? event.days : [];
  const index = days.findIndex((day) => day?.id === id);
  if (index < 0) return { label: id ? 'Not on a configured day' : 'Unscheduled', date: '' };
  const day = days[index];
  const label = typeof day.label === 'string' && day.label.trim() ? day.label.trim() : `Day ${index + 1}`;
  return { label, date: typeof day.date === 'string' ? day.date : '' };
}

/** Draft, Live, or Live with unpublished changes: the admin's three words (recordState.js). */
function stateWord(live, draft) {
  if (!live && draft) return 'Draft';
  if (live && draft && draft.status === 'dirty') return 'Live with unpublished changes';
  return 'Live';
}

/**
 * The current revision of every record in a publishable collection: the
 * draft where one exists, else the live document, the same record the admin
 * list shows. Each carries its state word, and `hidden` when that revision
 * has visible: false (the admin list's Hidden badge).
 *
 * `liveOnly` reads the live documents only, with no draft: the event data
 * package holds no draft (eventPackage.cjs EXCLUDED).
 *
 * A draft never holds `materialCount`: materials/store.cjs keeps it on the
 * live session only (cms/store.cjs RESERVED_FIELDS). The record takes it
 * from the live document.
 */
async function readCurrent({ db, collection, counter, maxDocs, cache, liveOnly = false }, toRecord) {
  const live = await readDocs({ db, collection, counter, maxDocs, cache });
  const drafts = liveOnly ? [] : await readDocs({ db, collection: `${collection}_drafts`, counter, maxDocs, cache });
  const liveById = new Map(live.map((entry) => [entry.id, entry.data]));
  const draftById = new Map(drafts.map((entry) => [entry.id, entry.data]));
  const ids = [...new Set([...liveById.keys(), ...draftById.keys()])].sort();
  return ids.map((id) => {
    const liveDoc = liveById.get(id) ?? null;
    const draftDoc = draftById.get(id) ?? null;
    const current = draftDoc && typeof liveDoc?.materialCount === 'number'
      ? { ...draftDoc, materialCount: liveDoc.materialCount }
      : draftDoc ?? liveDoc;
    return { ...toRecord(id, current), state: stateWord(liveDoc, draftDoc), hidden: current.visible === false };
  });
}

/** `25.00` from 2500 and an exponent of 2. Empty for a missing amount. */
function amount(value, exponent) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const places = Number.isInteger(exponent) && exponent >= 0 && exponent <= 4 ? exponent : 2;
  return (value / 10 ** places).toFixed(places);
}

function speakerName(record) {
  return [record.firstName, record.lastName].filter(Boolean).join(' ') || record.id;
}

const list = (values) => values.filter(Boolean).join(LIST_SEPARATOR);

/**
 * The spreadsheets. Each names its tier, its file name, the package file
 * that holds its live records (packagePath, packageHolds), how it reads its
 * rows, and its columns in file order. A column reads one field.
 */
const DATASETS = Object.freeze({
  sessions: {
    tier: 'staff',
    filename: 'sessions',
    docPath: 'cmsSchedule',
    packagePath: 'program/sessions.csv',
    packageHolds: 'the live sessions',
    async read({ db, counter, maxDocs, cache, config, liveOnly }) {
      const sessions = await readCurrent({ db, collection: 'cmsSchedule', counter, maxDocs, cache, liveOnly }, sessionRecord);
      const speakers = await readRecords({ db, collection: 'speakers', counter, maxDocs, cache }, speakerRecord);
      const names = new Map(speakers.map((speaker) => [speaker.id, speakerName(speaker)]));
      const titles = new Map(sessions.map((session) => [session.id, session.title]));
      const timeZone = typeof config?.event?.timezone === 'string' ? config.event.timezone : '';
      return sessions.map((session) => ({
        ...session,
        day: dayOf(session.dayId, config?.event ?? null),
        timeZone,
        speakerNames: session.speakerIds.map((id) => names.get(id) ?? id),
        parentTitle: session.parentId ? (titles.get(session.parentId) ?? session.parentId) : '',
      }));
    },
    columns: [
      { header: 'Session ID', value: (row) => row.id },
      { header: 'Title', value: (row) => row.title },
      { header: 'State', value: (row) => row.state },
      { header: 'Hidden', value: (row) => (row.hidden ? 'yes' : 'no') },
      { header: 'Day', value: (row) => row.day.label },
      { header: 'Date', value: (row) => row.day.date },
      { header: 'Start time', value: (row) => row.startTime },
      { header: 'End time', value: (row) => row.endTime },
      { header: 'Time zone', value: (row) => row.timeZone },
      { header: 'Type', value: (row) => row.type },
      { header: 'Track', value: (row) => row.track },
      { header: 'Location', value: (row) => row.location },
      { header: 'Speakers', value: (row) => list(row.speakerNames) },
      { header: 'Speaker IDs', value: (row) => list(row.speakerIds) },
      { header: 'Part of', value: (row) => row.parentTitle },
      { header: 'Description', value: (row) => row.description },
      { header: 'Materials', value: (row) => (typeof row.materialCount === 'number' ? String(row.materialCount) : '0') },
    ],
  },
  speakers: {
    tier: 'staff',
    filename: 'speakers',
    docPath: 'speakers',
    packagePath: 'speakers/speakers.csv',
    packageHolds: 'the speakers',
    async read({ db, counter, maxDocs, cache }) {
      const speakers = await readRecords({ db, collection: 'speakers', counter, maxDocs, cache }, speakerRecord);
      // Published: a live session the site shows, not a hidden one.
      const sessions = (await readRecords({ db, collection: 'cmsSchedule', counter, maxDocs, cache }, sessionRecord))
        .filter((session) => session.visible !== false);
      return speakers.map((speaker) => ({
        ...speaker,
        sessionTitles: sessions.filter((session) => session.speakerIds.includes(speaker.id)).map((session) => session.title),
      }));
    },
    columns: [
      { header: 'Speaker ID', value: (row) => row.id },
      { header: 'First name', value: (row) => row.firstName },
      { header: 'Last name', value: (row) => row.lastName },
      { header: 'Email', value: (row) => row.email },
      { header: 'Organization', value: (row) => row.organization },
      { header: 'Role', value: (row) => row.jobTitle },
      { header: 'Status', value: (row) => row.status },
      { header: 'Published sessions', value: (row) => list(row.sessionTitles) },
      {
        header: 'Social handles',
        value: (row) => list(Object.keys(row.socialHandles).sort().map((label) => `${label}: ${row.socialHandles[label]}`)),
      },
      { header: 'Bio', value: (row) => row.bio },
      { header: 'Headshot path', value: (row) => row.headshotPath },
    ],
  },
  organizations: {
    tier: 'staff',
    filename: 'organizations',
    docPath: 'cmsOrganizations',
    packagePath: 'organizations/organizations.csv',
    packageHolds: 'the live organizations',
    read: ({ db, counter, maxDocs, cache, liveOnly }) => readCurrent({ db, collection: 'cmsOrganizations', counter, maxDocs, cache, liveOnly }, organizationRecord),
    columns: [
      { header: 'Organization ID', value: (row) => row.id },
      { header: 'Name', value: (row) => row.name },
      { header: 'State', value: (row) => row.state },
      { header: 'Hidden', value: (row) => (row.hidden ? 'yes' : 'no') },
      { header: 'Tier', value: (row) => row.tier },
      { header: 'Website', value: (row) => row.url },
      { header: 'Description', value: (row) => row.description },
      { header: 'Support description', value: (row) => row.supportDescription },
      { header: 'Logo path', value: (row) => row.logoPath },
      { header: 'Order', value: (row) => (typeof row.order === 'number' ? String(row.order) : '') },
    ],
  },
  orders: {
    tier: 'operator',
    filename: 'ticket-orders',
    docPath: 'ticket_orders',
    packagePath: 'orders/orders.csv',
    packageHolds: 'the ticket orders',
    read: ({ db, counter, maxDocs, cache }) => readRecords({ db, collection: 'ticket_orders', counter, maxDocs, cache }, orderRecord),
    columns: [
      { header: 'Order ID', value: (row) => row.id },
      { header: 'Created', value: (row) => row.createdAt },
      { header: 'Mode', value: (row) => row.mode },
      { header: 'Source', value: (row) => row.source },
      { header: 'Status', value: (row) => row.status },
      { header: 'Payment status', value: (row) => row.paymentStatus },
      { header: 'Purchaser email', value: (row) => row.purchaserEmail },
      { header: 'Currency', value: (row) => row.currency },
      { header: 'Subtotal', value: (row) => amount(row.subtotalAmount, row.currencyExponent) },
      { header: 'Discount', value: (row) => amount(row.discountAmount, row.currencyExponent) },
      { header: 'Tax', value: (row) => amount(row.taxAmount, row.currencyExponent) },
      { header: 'Total', value: (row) => amount(row.totalAmount, row.currencyExponent) },
      { header: 'Refund status', value: (row) => row.refundStatus },
      { header: 'Refunded', value: (row) => amount(row.refundedAmount, row.currencyExponent) },
      { header: 'Tickets', value: (row) => list(row.lines.map((line) => `${line.quantity} × ${line.name || line.ticketTypeId}`)) },
      { header: 'Ticket IDs', value: (row) => list(row.ticketIds) },
    ],
  },
  admissions: {
    tier: 'operator',
    filename: 'admissions',
    docPath: 'tickets',
    packagePath: 'orders/admissions.csv',
    packageHolds: 'the admissions',
    read: ({ db, counter, maxDocs, cache }) => readRecords({ db, collection: 'tickets', counter, maxDocs, cache }, admissionRecord),
    columns: [
      { header: 'Ticket ID', value: (row) => row.id },
      { header: 'Order ID', value: (row) => row.orderId },
      { header: 'Provider', value: (row) => row.provider },
      { header: 'Ticket type', value: (row) => row.ticketClass || row.ticketTypeId },
      { header: 'First name', value: (row) => row.firstName },
      { header: 'Last name', value: (row) => row.lastName },
      { header: 'Email', value: (row) => row.email },
      { header: 'Status', value: (row) => row.status },
      { header: 'Claimed by an account', value: (row) => (row.claimedByAccountId ? 'yes' : 'no') },
      { header: 'Checked in', value: (row) => row.checkedInAt },
      { header: 'Purchased', value: (row) => row.purchasedAt },
    ],
  },
});

const DATASET_NAMES = Object.freeze(Object.keys(DATASETS));

/** The cells of one row, as strings. */
function cellsOf(dataset, row) {
  return dataset.columns.map((column) => {
    const value = column.value(row);
    return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  });
}

/**
 * The whole file: a byte-order mark, the header, one CRLF line per row,
 * every cell escaped and quoted. Throws TooLargeError past `maxBytes`.
 *
 * @param {object} dataset one of DATASETS
 * @param {object[]} rows
 * @param {number} [maxBytes]
 * @returns {string}
 */
function buildCsv(dataset, rows, maxBytes = MAX_EXPORT_BYTES) {
  const lines = [dataset.columns.map((column) => escapeCell(column.header)).join(',')];
  let bytes = Buffer.byteLength(lines[0]) + 5;
  for (const row of rows) {
    const line = cellsOf(dataset, row).map(escapeCell).join(',');
    bytes += Buffer.byteLength(line) + 2;
    if (bytes > maxBytes) throw new TooLargeError();
    lines.push(line);
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** `sessions-YYYY-MM-DD.csv`, the UTC date of the export. */
function exportFilename(dataset, at) {
  return `${dataset.filename}-${at.toISOString().slice(0, 10)}.csv`;
}

/**
 * Validate `{ dataset }`.
 *
 * @param {unknown} body
 * @returns {{ ok: true, name: string } | { ok: false, errors: string[] }}
 */
function readRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['body: must be a JSON object with dataset.'] };
  }
  const errors = [];
  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.includes(key)) errors.push(`${key}: is not accepted. Send dataset only.`);
  }
  if (!DATASET_NAMES.includes(body.dataset)) {
    errors.push(`dataset: must be one of ${DATASET_NAMES.join(', ')}.`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, name: body.dataset };
}

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           now?: () => Date, log?: Pick<Console, 'info'|'error'>,
 *           maxDocs?: number, maxBytes?: number }} deps
 */
function createExportEventDataHandler({
  db, auth, getConfig, now = () => new Date(), log = console,
  maxDocs = MAX_EXPORT_DOCS, maxBytes = MAX_EXPORT_BYTES,
}) {
  return async function exportEventData(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    const verdict = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!verdict.ok) return sendError(res, verdict.status, verdict.code, verdict.message);

    const request = readRequest(req.body);
    if (!request.ok) return badRequest(res, request.errors.join('; '));
    const dataset = DATASETS[request.name];
    if (!tierSatisfies(verdict.tier, dataset.tier)) {
      return sendError(res, 403, 'forbidden', `dataset: only an operator can export ${request.name}.`);
    }

    const at = now();
    let csv;
    let rowCount;
    try {
      const config = await getConfig();
      const rows = await dataset.read({ db, config, counter: { read: 0 }, maxDocs });
      csv = buildCsv(dataset, rows, maxBytes);
      rowCount = rows.length;
    } catch (err) {
      if (err instanceof LimitError || err instanceof TooLargeError) {
        // Only an operator can run the script or download the package.
        const where = tierSatisfies(verdict.tier, 'operator')
          ? 'Run scripts/export-event-package.cjs from a terminal (docs/operator/archive-handoff.md)'
          : 'Ask an operator for the event data package';
        return sendError(
          res, 413, 'too-large',
          `This spreadsheet is too large to build here. ${where}: its file ${dataset.packagePath} holds ${dataset.packageHolds}.`,
        );
      }
      log.error(`exportEventData: the ${request.name} records could not be read`, err);
      return internal(res, 'The records could not be read. Try again.');
    }

    try {
      await db.collection(ADMIN_LOGS).doc().set({
        action: ACTION,
        docPath: dataset.docPath,
        uid: verdict.uid,
        email: verdict.email,
        at,
        details: { dataset: request.name, rowCount },
      });
    } catch (err) {
      log.error('exportEventData: the admin_logs row could not be written; no file was sent', err);
      return internal(res, 'The export could not be recorded, so no file was made. Try again.');
    }

    log.info?.(`exportEventData: ${request.name}, ${rowCount} rows`);
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ filename: exportFilename(dataset, at), csv, rowCount });
  };
}

/** Deployable export: exportEventData. */
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
    exportEventData: onRequest({ region, memory: '512MiB' }, withCors(async (req, res) => {
      await createExportEventDataHandler(buildDeps())(req, res);
    })),
  };
}

module.exports = {
  createExportEventDataHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    ACTION,
    DATASETS,
    DATASET_NAMES,
    MAX_EXPORT_DOCS,
    amount,
    buildCsv,
    cellsOf,
    exportFilename,
    readCurrent,
    readRequest,
  },
};
