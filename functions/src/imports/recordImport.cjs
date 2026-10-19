'use strict';

/**
 * `importRecordsCsv`: the staff CSV import for speakers, sessions and
 * organizations (sponsors). It follows the ticket import
 * (ticketing/csvImport.cjs): the browser parses the file and sends
 * `{ type, mapping, rows }`, where `mapping` points this module's fixed
 * field names at the file's own column names, and the server runs one
 * pipeline for the preview and the commit, so the two cannot disagree.
 *
 * STAFF TIER. Staff create and edit speakers, sessions and organizations in
 * the editors one record at a time. The import writes the same records,
 * through the same validators, as drafts only. It gives staff no power the
 * editors do not, so it asks for the same tier.
 *
 * DRAFTS ONLY. A new speaker is `status: 'draft'`, which has no public
 * projection. A new session or organization is a draft in the two-revision
 * model with `visible: false`, so even a "publish all" keeps it off the
 * site until staff switch it on. An update never changes a speaker's status
 * or a session's or organization's visibility, and it writes the draft,
 * never the live document. Nothing here sends mail or an invitation.
 *
 * THE EXTERNAL ID IS THE KEY. Each row carries a stable id from the source
 * system. `record_imports/{type}__{sha256(id)}` maps it to the document it
 * created and keeps a digest of each value the last import wrote. It keeps
 * digests, not values: the merge below only needs to know whether two
 * values are equal, and a key must not keep a copy of a person's email or
 * bio after staff delete the record. The external ID itself is not stored
 * either, only its hash in the key's id. The key document is read inside
 * each row's transaction, so two imports of one row serialize.
 *
 * A RECORD THAT ALREADY EXISTS. A row with no key whose slug or session ID
 * belongs to a record no import has linked (typed in an editor, seeded, or
 * made before the import existed) is matched to that record instead of
 * making a second one. The row previews as an update with a note that
 * names the record, and the commit writes the key. The match has no "last
 * import" values, so the merge fills only the record's empty fields and
 * keeps every value it already has.
 *
 * RECONCILIATION IS THREE-WAY, per mapped field (reconcileFields):
 *
 *   - The file still says what the last import said: the field is left
 *     alone, whatever staff did to it since. Re-importing a file changes
 *     nothing.
 *   - The file says something new and staff have not touched the field: the
 *     new value is written.
 *   - The file says something new and staff changed the field too: the
 *     staff value is kept and the row reports a conflict.
 *
 * An unmapped field is never read from the file and never written, so a
 * staff edit to it always survives.
 *
 * After a conflict the file's value becomes the "last import" value, so the
 * same file is quiet the next time. If staff later undo their edit, the
 * import does not bring the file's value back until the file changes it
 * again. The admin guide says so.
 *
 * A record staff deleted after an import is not created again. The row
 * reports it as unchanged, with a note.
 *
 * EXPLICIT CONFIRMATION. A dry run answers with a digest of the type, the
 * mapping and the rows. A commit must send that digest back, so the commit
 * writes exactly the rows the person previewed.
 *
 * One transaction per row: a 500-row import does not fit in one Firestore
 * transaction, and a row that fails must not undo the rows before it. A
 * commit that stops part way is finished by running the same file again,
 * because the import is idempotent.
 */

const { createHash } = require('node:crypto');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');

/** The audit collection (cms/store.cjs logAdminAction writes the same shape). */
const ADMIN_LOGS = 'admin_logs';
/** Server-only: firestore.rules denies every client read and write. */
const RECORD_IMPORTS = 'record_imports';

/** The most rows one request may carry; split a larger file. */
const MAX_IMPORT_ROWS = 500;
/** The longest cell the import reads. A speaker bio is the longest field (4000). */
const MAX_CELL_LENGTH = 5000;
/** The most columns one row may carry. */
const MAX_COLUMNS = 60;
/** The longest external id. */
const MAX_EXTERNAL_ID_LENGTH = 200;
// Printable characters only. Built from code points so the source has no
// literal control characters.
const CONTROL_CHAR_RE = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`);

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

/**
 * One cell as trimmed text. Numbers and booleans become text; anything else
 * is empty. runImport refuses a row with a mapped cell over the limit
 * before any importer reads it (overLongCells), so the cut here only bounds
 * what the digest reads.
 *
 * @param {unknown} v
 * @returns {string}
 */
function cell(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return typeof v === 'string' ? v.trim().slice(0, MAX_CELL_LENGTH) : '';
}

/** A cell, or null when it is blank. */
function cellOrNull(v) {
  const text = cell(v);
  return text === '' ? null : text;
}

/**
 * The refusal for an external id, or null when it is usable.
 *
 * @param {string} id trimmed
 * @returns {string|null}
 */
function externalIdError(id) {
  if (!id) return 'externalId: the row has no external ID';
  if (id.length > MAX_EXTERNAL_ID_LENGTH) {
    return `externalId: use ${MAX_EXTERNAL_ID_LENGTH} characters or fewer`;
  }
  if (CONTROL_CHAR_RE.test(id)) return 'externalId: use printable characters only';
  return null;
}

/**
 * The key document id for one external id. Hashed, so an id from any
 * source system (spaces, slashes, any length up to the cap) is a usable
 * Firestore document id.
 *
 * @param {string} type
 * @param {string} externalId
 * @returns {string}
 */
function importKeyId(type, externalId) {
  return `${type}__${createHash('sha256').update(externalId).digest('hex').slice(0, 40)}`;
}

/** Blank, null and absent compare as one "no value". */
function comparable(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && v === '') return null;
  if (Array.isArray(v)) return v.map(comparable);
  if (isPlainObject(v)) {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, comparable(v[k])]));
  }
  return v;
}

/** @returns {boolean} the two values are the same field value */
function sameValue(a, b) {
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}

/**
 * The digest a key keeps for one field value. Equal values (blank, null and
 * absent among them) give equal digests.
 *
 * @param {unknown} v
 * @returns {string}
 */
function valueDigest(v) {
  return createHash('sha256').update(JSON.stringify(comparable(v))).digest('hex').slice(0, 32);
}

/** Each field's value as its digest, for the key document. */
function digestValues(values) {
  return Object.fromEntries(Object.entries(values ?? {}).map(([field, v]) => [field, valueDigest(v)]));
}

/**
 * The mapped columns of a row whose cell is longer than the import reads,
 * as row errors that name the field.
 *
 * @param {object} row
 * @param {Record<string,string>} mapping
 * @returns {string[]}
 */
function overLongCells(row, mapping) {
  return Object.entries(mapping)
    .filter(([, column]) => typeof row[column] === 'string' && row[column].trim().length > MAX_CELL_LENGTH)
    .map(([field, column]) => `${field}: the "${column}" cell is longer than ${MAX_CELL_LENGTH} characters`);
}

/**
 * True when an import key other than this row's already points at the
 * record. A record linked that way belongs to another external ID, so a
 * row with no key must not be matched to it.
 *
 * @param {{ db, tx, type: string, docId: string }} args
 * @returns {Promise<boolean>}
 */
async function linkedByImport({ db, tx, type, docId }) {
  const snap = await tx.get(db.collection(RECORD_IMPORTS).where('docId', '==', docId));
  return snap.docs.some((doc) => doc.data()?.type === type);
}

/** The note on a row matched to a record that already exists. */
function matchNote(noun, id, by) {
  return `Matches the existing ${noun} "${id}" by its ${by}. The import links this row to it, fills its empty fields and keeps the values it has.`;
}

/**
 * The three-way merge of one row's mapped fields (module doc).
 *
 * @param {{ incoming: object, last: object|null, current: object }} args
 *   incoming: the file's normalized value for each MAPPED field;
 *   last: the digest of each value the last import wrote (the key
 *     document), or null;
 *   current: the record as it is stored now.
 * @returns {{ patch: object, conflicts: string[] }}
 */
function reconcileFields({ incoming, last, current }) {
  const patch = {};
  const conflicts = [];
  const lastDigests = isPlainObject(last) ? last : {};
  for (const [field, next] of Object.entries(incoming)) {
    const stored = current?.[field];
    const hasLast = Object.prototype.hasOwnProperty.call(lastDigests, field);
    if (hasLast && valueDigest(next) === lastDigests[field]) continue; // the file did not change it
    if (sameValue(stored, next)) continue; // already what the file says
    if (hasLast ? valueDigest(stored) === lastDigests[field] : comparable(stored) === null) {
      patch[field] = next;
    } else {
      conflicts.push(field);
    }
  }
  return { patch, conflicts };
}

/** The note a row carries for each field where the stored value was kept. */
function conflictNote(field) {
  return `${field}: kept the value in the admin panel. The file has a different value.`;
}

const DELETED_NOTE = 'The record from this row was deleted in the admin panel. The import does not create it again.';

/**
 * Validate the request envelope. Field values are checked per row, because
 * a bad value in row 4 is a preview finding, not a 400.
 *
 * @param {unknown} body
 * @param {Record<string, object>} importers by type
 * @returns {{ ok: true, importer: object, type: string, mapping: Record<string,string>,
 *             rows: object[], dryRun: boolean, confirmDigest: string|null } |
 *           { ok: false, message: string }}
 */
function validateImportRequest(body, importers) {
  if (!isPlainObject(body)) return { ok: false, message: 'body: must be a JSON object' };

  const type = body.type;
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(importers, type)) {
    return { ok: false, message: `type: must be one of ${Object.keys(importers).join(', ')}` };
  }
  const importer = importers[type];

  if (!isPlainObject(body.mapping)) return { ok: false, message: 'mapping: must be a JSON object' };
  const mapping = {};
  for (const field of importer.fields.map((f) => f.id)) {
    const value = body.mapping[field];
    if (typeof value === 'string' && value.trim()) mapping[field] = value;
  }
  const mappingError = importer.mappingError(mapping);
  if (mappingError) return { ok: false, message: mappingError };

  const rows = body.rows;
  if (!Array.isArray(rows)) return { ok: false, message: 'rows: must be an array' };
  if (rows.length === 0) return { ok: false, message: 'rows: the file has no data rows' };
  if (rows.length > MAX_IMPORT_ROWS) {
    return { ok: false, message: `rows: import at most ${MAX_IMPORT_ROWS} rows at a time. Split the file.` };
  }
  if (!rows.every(isPlainObject)) return { ok: false, message: 'rows: every row must be a JSON object' };
  if (rows.some((row) => Object.keys(row).length > MAX_COLUMNS)) {
    return { ok: false, message: `rows: a row may have at most ${MAX_COLUMNS} columns` };
  }

  const dryRun = body.dryRun !== false;
  const confirmDigest = typeof body.confirmDigest === 'string' ? body.confirmDigest : null;
  if (!dryRun && !confirmDigest) {
    return { ok: false, message: 'confirmDigest: preview the import first, then confirm it' };
  }
  return { ok: true, importer, type, mapping, rows, dryRun, confirmDigest };
}

/**
 * The digest a preview answers with and a commit must send back.
 *
 * @param {{ type: string, mapping: Record<string,string>, rows: object[] }} args
 * @returns {string}
 */
function requestDigest({ type, mapping, rows }) {
  const sortedMapping = Object.fromEntries(Object.keys(mapping).sort().map((k) => [k, mapping[k]]));
  const sortedRows = rows.map((row) => Object.fromEntries(Object.keys(row).sort().map((k) => [k, cell(row[k])])));
  return createHash('sha256')
    .update(JSON.stringify({ type, mapping: sortedMapping, rows: sortedRows }))
    .digest('hex');
}

/**
 * Run every row through the importer. The preview and the commit both call
 * this; only `dryRun` decides whether a row's writes are applied.
 *
 * An importer exposes:
 *   fields                 [{ id, required? }]
 *   mappingError(mapping)  a refusal or null
 *   loadContext({ db })    read once per request (event config, say)
 *   mapRow({ row, mapping, context })
 *                          { ok: true, externalId, input } or { ok: false, reasons }
 *   planRow({ db, tx, input, key, claimed, context, actor, now, newId })
 *                          reads only; returns the verdict and, for a write,
 *                          `write(tx)` that applies it after the reads
 *
 * @returns {Promise<{ results: object[], summary: Record<string, number> }>}
 */
async function runImport({ db, importer, type, mapping, rows, dryRun, actor, now = Date.now, log = console, newId }) {
  const context = importer.loadContext ? await importer.loadContext({ db }) : {};
  const seenAt = new Map();
  const claimed = new Set();
  const results = [];

  for (let index = 0; index < rows.length; index += 1) {
    const tooLong = overLongCells(rows[index], mapping);
    if (tooLong.length > 0) {
      const externalId = mapping.externalId ? cell(rows[index][mapping.externalId]) || null : null;
      results.push({ index, verdict: 'error', externalId, reasons: tooLong });
      continue;
    }
    const mapped = importer.mapRow({ row: rows[index], mapping, context });
    if (!mapped.ok) {
      results.push({ index, verdict: 'error', externalId: mapped.externalId ?? null, reasons: mapped.reasons });
      continue;
    }
    const { externalId } = mapped;
    if (seenAt.has(externalId)) {
      results.push({
        index,
        verdict: 'error',
        externalId,
        reasons: [`externalId: the same ID is on row ${seenAt.get(externalId) + 1}`],
      });
      continue;
    }
    seenAt.set(externalId, index);

    const keyRef = db.collection(RECORD_IMPORTS).doc(importKeyId(type, externalId));
    let plan;
    try {
      plan = await db.runTransaction(async (tx) => {
        const keySnap = await tx.get(keyRef);
        const key = keySnap.exists ? keySnap.data() : null;
        const planned = await importer.planRow({
          db, tx, input: mapped.input, key, claimed, context, actor, now, newId,
        });
        if (dryRun || planned.verdict === 'error') return planned;
        if (planned.write) await planned.write(tx);
        const at = new Date(now());
        if (planned.verdict === 'create' || planned.matched) {
          // A new record, or one that existed before and is linked now.
          tx.set(keyRef, {
            type,
            docId: planned.docId,
            values: digestValues(planned.values),
            createdAt: at,
            importedAt: at,
            importedBy: actor.email,
          });
        } else if (planned.values) {
          // The file's values become the new "last import", conflicts
          // included: the next run of the same file then leaves the kept
          // staff edit alone instead of reporting it again. Written only
          // when something moved, so a repeat run writes nothing at all.
          const values = { ...(key?.values ?? {}), ...digestValues(planned.values) };
          if (!sameValue(key?.values ?? {}, values)) {
            tx.set(keyRef, { values, importedAt: at, importedBy: actor.email }, { merge: true });
          }
        }
        return planned;
      });
    } catch (err) {
      log.error?.('importRecordsCsv row failed', err);
      results.push({ index, verdict: 'error', externalId, reasons: ['The row could not be imported. Try again.'] });
      continue;
    }
    if (plan.verdict !== 'error') for (const claim of plan.claims ?? []) claimed.add(claim);
    results.push({
      index,
      verdict: plan.verdict,
      externalId,
      label: plan.label ?? null,
      docId: plan.docId ?? null,
      changedFields: plan.changedFields ?? [],
      matched: Boolean(plan.matched),
      reasons: plan.reasons ?? [],
      notes: plan.notes ?? [],
    });
  }

  const summary = { create: 0, update: 0, unchanged: 0, error: 0 };
  for (const row of results) summary[row.verdict] += 1;
  return { results, summary };
}

/** Shared admin-POST preamble. Sends the response itself on failure. */
async function gateStaffPost({ auth, db, getConfig }, req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST']);
    return null;
  }
  const verdict = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
  if (!verdict.ok) {
    sendError(res, verdict.status, verdict.code, verdict.message);
    return null;
  }
  return { uid: verdict.uid, email: verdict.email };
}

/**
 * @param {{ db, auth, getConfig, importers, now?, log?, newId? }} deps
 */
function createImportRecordsCsvHandler({ db, auth, getConfig, importers, now = Date.now, log = console, newId }) {
  return async function importRecordsCsv(req, res) {
    const actor = await gateStaffPost({ auth, db, getConfig }, req, res);
    if (!actor) return;

    const validated = validateImportRequest(req.body, importers);
    if (!validated.ok) return badRequest(res, validated.message);
    const { importer, type, mapping, rows, dryRun, confirmDigest } = validated;

    const digest = requestDigest({ type, mapping, rows });
    if (!dryRun && confirmDigest !== digest) {
      return sendError(
        res,
        409,
        'preview-mismatch',
        'The file or the column mapping changed after the preview. Preview the import again.',
      );
    }

    // The audit row is written, and awaited, BEFORE the first record write
    // (the exportAttendees rule): a commit that dies part way still leaves
    // a row that names who started it. The counts are added at the end.
    let auditRef = null;
    if (!dryRun) {
      auditRef = db.collection(ADMIN_LOGS).doc();
      try {
        await auditRef.set({
          action: 'records-import',
          docPath: importer.docPath,
          uid: actor.uid,
          email: actor.email,
          at: new Date(now()),
          details: { type, rows: rows.length, finished: false },
        });
      } catch (err) {
        log.error('importRecordsCsv: the admin_logs row could not be written; nothing was imported', err);
        return internal(res, 'The import could not be recorded in the audit log, so nothing was imported. Try again.');
      }
    }

    let outcome;
    try {
      outcome = await runImport({ db, importer, type, mapping, rows, dryRun, actor, now, log, newId });
    } catch (err) {
      log.error('importRecordsCsv failed', err);
      return internal(res, dryRun ? 'The import could not be checked.' : 'The import could not be completed.');
    }

    if (auditRef) {
      try {
        await auditRef.set({ details: { type, rows: rows.length, finished: true, ...outcome.summary } }, { merge: true });
      } catch (err) {
        log.warn('importRecordsCsv: the admin_logs counts could not be written', err);
      }
    }

    res.status(200).json({
      ok: true,
      type,
      dryRun,
      digest,
      total: rows.length,
      summary: outcome.summary,
      rows: outcome.results,
    });
  };
}

/** The importers, by request type. Required lazily so a test can load one alone. */
function defaultImporters() {
  return {
    speakers: require('./speakerImport.cjs'),
    sessions: require('./sessionImport.cjs'),
    organizations: require('./organizationImport.cjs'),
  };
}

/** Deployable export (spec §1.3): importRecordsCsv. */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  return {
    importRecordsCsv: onRequest({ region, timeoutSeconds: 300 }, async (req, res) => {
      const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
      const handled = applyCors(req, res, {
        allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
        methods: ['POST'],
      });
      if (handled) return;
      const { getDb } = require('../core/firestore.cjs');
      const { getAuth } = require('firebase-admin/auth');
      const { getEventConfig } = require('../core/config.cjs');
      const db = getDb();
      await createImportRecordsCsvHandler({
        db,
        auth: getAuth(),
        getConfig: () => getEventConfig({ db }),
        importers: defaultImporters(),
        now: Date.now,
        log: console,
      })(req, res);
    }),
  };
}

module.exports = {
  createImportRecordsCsvHandler,
  defaultImporters,
  runImport,
  validateImportRequest,
  requestDigest,
  reconcileFields,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    RECORD_IMPORTS,
    MAX_IMPORT_ROWS,
    MAX_CELL_LENGTH,
    MAX_COLUMNS,
    MAX_EXTERNAL_ID_LENGTH,
    DELETED_NOTE,
    cell,
    valueDigest,
    digestValues,
    overLongCells,
    linkedByImport,
    matchNote,
    cellOrNull,
    externalIdError,
    importKeyId,
    sameValue,
    conflictNote,
    isPlainObject,
  },
};
