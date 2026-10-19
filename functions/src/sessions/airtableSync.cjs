'use strict';

/**
 * Airtable refresh for the private session pitch queue.
 *
 * An operator approves one base, table and optional view, and maps its
 * fields to pitch fields (`updateAirtablePitchSource`). Staff or an
 * operator then pull the records into `session_pitches`
 * (`refreshAirtablePitches`). An optional schedule
 * (`scheduledAirtablePitchRefresh`) repeats the same run every 15 or 60
 * minutes; it is off until an operator picks a timing.
 *
 * Each record is identified by source and external id, with the same hash
 * as the CSV import (`import\0airtable\0<externalId>`), so a refresh never
 * makes a duplicate:
 *
 * - A new record with consent creates a pitch with `status: 'new'`.
 * - An unchanged record changes nothing.
 * - A changed record updates only the proposal fields. Status, private
 *   notes, conversion and notices stay. `reviewRevision` goes up by one, so
 *   a review form opened on the old text reports a conflict, and
 *   `sourceUpdatedAt` drives the "Updated in Airtable" marker.
 * - A record that leaves the view is never deleted here. A complete run
 *   sets `sourceRemovedAt`; the record coming back clears it.
 * - A record without a ticked consent checkbox is skipped and counted. An
 *   existing pitch whose consent box was cleared is flagged with
 *   `sourceConsentMissingAt`.
 *
 * A run never publishes, never converts and never sends mail. Every run
 * writes `session_pitch_sync/airtable` (what staff see) and one
 * `admin_logs` row. The status document also holds a short lease, so two
 * runs cannot overlap. This is not a queue: nothing waits in Firestore for
 * a later run.
 */

const { createHash } = require('node:crypto');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, methodNotAllowed, internal } = require('../core/errors.cjs');
const { internals: { readSubmission } } = require('./pitches.cjs');
const { AirtableError, readAirtableSource, listAirtableRecords, redact } = require('./airtableClient.cjs');

const PITCHES = 'session_pitches';
const SOURCES = 'session_pitch_sources';
const SYNC = 'session_pitch_sync';
const SOURCE_DOC = 'airtable';
const STATUS_DOC = 'airtable';
const SOURCE_NAME = 'airtable';
const TOKEN_SECRET = 'AIRTABLE_API_TOKEN';
const ENABLED_ENV = 'EVENT_AIRTABLE_ENABLED';

const LEASE_MS = 10 * 60 * 1000;
const MANUAL_GAP_MS = 60 * 1000;
// A scheduled run may start up to two minutes early, so a 60-minute timing
// does not slip to 75 minutes on a 15-minute scheduler tick.
const SCHEDULE_SLACK_MS = 2 * 60 * 1000;
const CHUNK = 100;
const MAX_SKIPPED_LISTED = 25;
const MAX_EXTERNAL_ID_LENGTH = 128;
const CONTENT_KEYS = Object.freeze(['email', 'title', 'description', 'organization', 'format']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const hash = (text) => createHash('sha256').update(text).digest('hex');
const pitchIdFor = (externalId) => hash(`import\0${SOURCE_NAME}\0${externalId}`);
const millis = (value) => (value instanceof Date ? value.getTime()
  : typeof value?.toMillis === 'function' ? value.toMillis()
    : typeof value === 'number' ? value : null);

function airtableEnabled(env = process.env) {
  return (env[ENABLED_ENV] || '').trim().toLowerCase() === 'true';
}

/** Secrets the deployed functions bind. None unless the deployment opts in. */
function airtableSecretNames(env = process.env) {
  return airtableEnabled(env) && env.FUNCTIONS_EMULATOR !== 'true' ? [TOKEN_SECRET] : [];
}

function cellText(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  // A multiple select or a lookup arrives as a list of strings.
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.join(', ');
  return undefined;
}

/**
 * Map one Airtable record to a pitch row, or to a skip reason. The
 * external id is the mapped field, or the Airtable record id when no field
 * is mapped.
 */
function mapRecord(record, fieldMap) {
  const fields = record.fields || {};
  const rawId = fieldMap.externalId ? cellText(fields[fieldMap.externalId]) : record.id;
  const externalId = typeof rawId === 'string' ? rawId.trim() : '';
  if (!externalId || externalId.length > MAX_EXTERNAL_ID_LENGTH) {
    return { ok: false, externalId: null, reason: 'missing-id', field: fieldMap.externalId };
  }
  if (fields[fieldMap.consent] !== true) return { ok: false, externalId, reason: 'no-consent', field: fieldMap.consent };
  const email = cellText(fields[fieldMap.email]);
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(normalized) || normalized.length > 254) return { ok: false, externalId, reason: 'invalid-email', field: fieldMap.email };
  const text = {};
  for (const key of ['title', 'description', 'organization', 'format']) {
    const value = fieldMap[key] ? cellText(fields[fieldMap[key]]) : null;
    if (value === undefined) return { ok: false, externalId, reason: 'invalid-field', field: fieldMap[key] };
    text[key] = value;
  }
  const pitch = readSubmission({ ...text, consent: true, submissionKey: 'airtable-validation' });
  if (!pitch.ok) {
    const key = pitch.message.split(':')[0];
    return { ok: false, externalId, reason: 'invalid-field', field: fieldMap[key] || key };
  }
  return {
    ok: true,
    externalId,
    row: { email: normalized, title: pitch.title, description: pitch.description, organization: pitch.organization, format: pitch.format },
  };
}

function sameAirtable(stored, current) {
  return Boolean(stored) && stored.baseId === current.baseId && stored.table === current.table && stored.recordId === current.recordId;
}

function emptyCounts() {
  return { fetched: 0, created: 0, updated: 0, unchanged: 0, restored: 0, skipped: 0, removed: 0 };
}

function skipEntry(record, mapped) {
  return { recordId: record.id, reason: mapped.reason, ...(mapped.field ? { field: mapped.field } : {}) };
}

/**
 * Upsert one chunk of mapped records in a transaction. Content changes
 * update the proposal and bump the review revision; everything a reviewer
 * owns is left as it is.
 */
async function applyChunk({ db, source, entries, at, actorEmail, counts }) {
  const refs = entries.map((entry) => db.collection(PITCHES).doc(pitchIdFor(entry.externalId)));
  await db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...refs);
    const local = { created: 0, updated: 0, unchanged: 0, restored: 0 };
    snaps.forEach((snap, i) => {
      const entry = entries[i];
      const stored = snap.exists ? snap.data() : null;
      const airtable = { baseId: source.baseId, table: source.table, recordId: entry.recordId };
      // A row from an earlier CSV import under the source name "airtable"
      // has the same id, and the refresh adopts it. A seen record also takes
      // the current table, so a switch from a table name to its ID keeps
      // the record in removal tracking.
      const track = stored && !sameAirtable(stored.airtable, airtable) ? { airtable } : {};
      if (!entry.mapped.ok) {
        // A pitch that exists and lost its consent tick is flagged for staff.
        // The record is in the view, so a removed flag no longer holds.
        if (stored && entry.mapped.reason === 'no-consent' && (!stored.sourceConsentMissingAt || stored.sourceRemovedAt || track.airtable)) {
          tx.update(refs[i], { ...track, sourceConsentMissingAt: stored.sourceConsentMissingAt || at, sourceRemovedAt: null });
        }
        return;
      }
      const row = entry.mapped.row;
      if (!stored) {
        local.created += 1;
        tx.create(refs[i], {
          ...row,
          source: SOURCE_NAME,
          externalId: entry.externalId,
          airtable,
          uid: null,
          status: 'new',
          reviewRevision: 0,
          privateNotes: null,
          consent: { version: 'airtable-source', at, recordedBy: actorEmail },
          createdAt: at,
          reviewedAt: null,
          reviewedBy: null,
          sourceUpdatedAt: null,
          sourceRemovedAt: null,
          sourceConsentMissingAt: null,
        });
        return;
      }
      const changed = CONTENT_KEYS.filter((key) => (stored[key] ?? null) !== row[key]);
      const flagged = Boolean(stored.sourceRemovedAt || stored.sourceConsentMissingAt);
      if (changed.length) {
        local.updated += 1;
        const revision = Number.isSafeInteger(stored.reviewRevision) ? stored.reviewRevision : 0;
        tx.update(refs[i], {
          ...row,
          ...track,
          reviewRevision: revision + 1,
          sourceUpdatedAt: at,
          sourceChangedFields: changed,
          sourceRemovedAt: null,
          sourceConsentMissingAt: null,
        });
      } else if (flagged) {
        local.restored += 1;
        tx.update(refs[i], { ...track, sourceRemovedAt: null, sourceConsentMissingAt: null });
      } else {
        local.unchanged += 1;
        if (track.airtable) tx.update(refs[i], track);
      }
    });
    return local;
  }).then((local) => {
    for (const [key, value] of Object.entries(local)) counts[key] += value;
  });
}

/**
 * Flag Airtable pitches from this base that a complete run did not see.
 * There is one approved source, so the base is the match: a pitch stored
 * under a table name still matches after the operator saves the table ID.
 */
async function flagRemoved({ db, source, seen, at, counts }) {
  const snap = await db.collection(PITCHES).where('source', '==', SOURCE_NAME).get();
  const missing = snap.docs.filter((doc) => {
    const data = doc.data();
    return data.airtable?.baseId === source.baseId && !seen.has(data.externalId) && !data.sourceRemovedAt;
  });
  for (let i = 0; i < missing.length; i += CHUNK) {
    const batch = db.batch();
    for (const doc of missing.slice(i, i + CHUNK)) batch.update(doc.ref, { sourceRemovedAt: at });
    await batch.commit();
  }
  counts.removed = missing.length;
}

/** Take the run lease, or say why not. */
async function acquireLease({ db, trigger, actor, nowMs, scheduleMinutes }) {
  const ref = db.collection(SYNC).doc(STATUS_DOC);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const status = snap.exists ? snap.data() : {};
    const runningSince = millis(status.running?.startedAt);
    if (runningSince !== null && nowMs - runningSince < LEASE_MS) return { ok: false, reason: 'busy' };
    const lastStart = millis(status.lastRun?.startedAt);
    if (trigger === 'manual' && lastStart !== null && nowMs - lastStart < MANUAL_GAP_MS) {
      return { ok: false, reason: 'too-soon', retryAfterMs: MANUAL_GAP_MS - (nowMs - lastStart) };
    }
    if (trigger === 'scheduled' && lastStart !== null && nowMs - lastStart < scheduleMinutes * 60 * 1000 - SCHEDULE_SLACK_MS) {
      return { ok: false, reason: 'not-due' };
    }
    tx.set(ref, { running: { startedAt: new Date(nowMs), trigger, by: actor.email ?? null } }, { merge: true });
    return { ok: true };
  });
}

function outcomeOf(error, complete) {
  if (error) return 'failed';
  return complete ? 'completed' : 'partial';
}

/**
 * One refresh run. Never throws for an Airtable problem: the run records
 * the failure in the status document and returns it.
 *
 * @returns {Promise<{ outcome: string, counts?: object, skippedReasons?: object, error?: object, reason?: string, retryAfterMs?: number }>}
 */
async function runAirtableSync({ db, fetchImpl, token, env = process.env, actor, trigger, now = Date.now, sleep, log = console }) {
  const sourceSnap = await db.collection(SOURCES).doc(SOURCE_DOC).get();
  const stored = sourceSnap.exists ? readAirtableSource(sourceSnap.data()) : null;
  if (trigger === 'scheduled' && (!stored?.ok || !stored.value.enabled || !stored.value.scheduleMinutes || !airtableEnabled(env))) {
    return { outcome: 'skipped', reason: 'not-scheduled' };
  }
  const startedMs = now();
  const lease = await acquireLease({ db, trigger, actor, nowMs: startedMs, scheduleMinutes: stored?.value?.scheduleMinutes || 0 });
  if (!lease.ok) return { outcome: 'skipped', reason: lease.reason, retryAfterMs: lease.retryAfterMs };

  const startedAt = new Date(startedMs);
  const counts = emptyCounts();
  const skippedReasons = {};
  const skippedRecords = [];
  let complete = false;
  let error = null;
  try {
    if (!airtableEnabled(env)) throw new AirtableError('not-enabled', `Airtable is not turned on for this deployment. An operator sets ${ENABLED_ENV} and the ${TOKEN_SECRET} secret.`);
    if (!stored) throw new AirtableError('not-configured', 'No Airtable connection is saved. An operator saves the connection settings first.');
    if (!stored.ok) throw new AirtableError('not-configured', `The saved Airtable connection is not valid. ${stored.message}`);
    if (!stored.value.enabled) throw new AirtableError('turned-off', 'The Airtable connection is turned off. An operator turns it on in the connection settings.');
    const source = stored.value;
    const listed = await listAirtableRecords({ fetchImpl, token, source, env, sleep, now });
    complete = listed.complete;
    counts.fetched = listed.records.length;
    const at = new Date(now());
    const seen = new Set();
    const entries = [];
    for (const record of listed.records) {
      const mapped = mapRecord(record, source.fieldMap);
      if (mapped.externalId && seen.has(mapped.externalId)) {
        mapped.ok = false; mapped.reason = 'duplicate-id'; mapped.field = source.fieldMap.externalId;
      } else if (mapped.externalId) {
        seen.add(mapped.externalId);
      }
      if (!mapped.ok) {
        counts.skipped += 1;
        skippedReasons[mapped.reason] = (skippedReasons[mapped.reason] || 0) + 1;
        if (skippedRecords.length < MAX_SKIPPED_LISTED) skippedRecords.push(skipEntry(record, mapped));
      }
      // Only a skip with a usable id can touch an existing pitch (the
      // consent flag); the others are reported and left alone.
      if (mapped.ok || (mapped.reason === 'no-consent' && mapped.externalId)) {
        entries.push({ externalId: mapped.externalId, recordId: record.id, mapped });
      }
    }
    for (let i = 0; i < entries.length; i += CHUNK) {
      await applyChunk({ db, source, entries: entries.slice(i, i + CHUNK), at, actorEmail: actor.email ?? 'scheduled refresh', counts });
    }
    // A partial read cannot prove that a record left Airtable.
    if (complete) await flagRemoved({ db, source, seen, at, counts });
  } catch (err) {
    if (err instanceof AirtableError) {
      error = { code: err.code, message: redact(err.message, token) };
    } else {
      log.error('Airtable pitch refresh failed', redact(err?.stack || err?.message || err, token));
      error = { code: 'internal', message: 'The refresh stopped on a server error. Pitches saved before the error stay. Try again.' };
    }
  }

  const finishedAt = new Date(now());
  const outcome = outcomeOf(error, complete);
  const lastRun = {
    trigger, startedAt, finishedAt, outcome, counts, skippedReasons, skippedRecords,
    error, by: actor.email ?? null,
  };
  const statusRef = db.collection(SYNC).doc(STATUS_DOC);
  await db.runTransaction(async (tx) => {
    await tx.get(statusRef);
    tx.set(statusRef, { running: null, lastRun, ...(error ? {} : { lastSuccessAt: finishedAt }) }, { merge: true });
    tx.set(db.collection('admin_logs').doc(), {
      action: 'refreshAirtablePitches',
      docPath: PITCHES,
      uid: actor.uid ?? null,
      email: actor.email ?? null,
      at: finishedAt,
      details: { trigger, outcome, counts, skippedReasons, ...(error ? { errorCode: error.code } : {}) },
    });
  });
  return { outcome, counts, skippedReasons, skippedRecords, error };
}

function createUpdateAirtableSourceHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function updateAirtablePitchSource(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ db, auth, getConfig }, req, { tier: 'operator' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > 8 * 1024) return sendError(res, 413, 'payload-too-large', 'The settings are too large.');
    const parsed = readAirtableSource(req.body);
    if (!parsed.ok) return sendError(res, 400, 'bad-request', parsed.message);
    const at = new Date(now());
    const value = { ...parsed.value, updatedAt: at, updatedBy: gate.email };
    try {
      await db.runTransaction(async (tx) => {
        tx.set(db.collection(SOURCES).doc(SOURCE_DOC), value);
        tx.set(db.collection('admin_logs').doc(), {
          action: 'updateAirtablePitchSource', docPath: `${SOURCES}/${SOURCE_DOC}`, uid: gate.uid, email: gate.email, at,
          details: parsed.value,
        });
      });
    } catch (err) {
      log.error('updateAirtablePitchSource failed', err);
      return internal(res, 'The Airtable settings could not be saved. Try again.');
    }
    return res.status(200).json(parsed.value);
  };
}

function createRefreshAirtableHandler({ db, auth, getConfig, fetchImpl = globalThis.fetch, env = process.env, now = Date.now, sleep, log = console }) {
  return async function refreshAirtablePitches(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    // Staff may refresh: the operator chose the table and the mapping, and
    // a refresh only brings private proposals into the review queue that
    // staff already work. It publishes nothing and sends no mail.
    const gate = await requireAdmin({ db, auth, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    let result;
    try {
      result = await runAirtableSync({
        db, fetchImpl, token: env[TOKEN_SECRET], env, actor: { uid: gate.uid, email: gate.email }, trigger: 'manual', now, sleep, log,
      });
    } catch (err) {
      log.error('refreshAirtablePitches failed', redact(err?.stack || err?.message || err, env[TOKEN_SECRET]));
      return internal(res, 'The refresh could not be recorded. Try again.');
    }
    if (result.reason === 'busy') return sendError(res, 409, 'refresh-running', 'A refresh is already running. Wait for it to finish.');
    if (result.reason === 'too-soon') {
      const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      res.set('Retry-After', String(seconds));
      return sendError(res, 429, 'rate-limited', `A refresh ran less than a minute ago. Try again in ${seconds} seconds.`);
    }
    if (result.outcome === 'failed') return sendError(res, 502, result.error.code, result.error.message);
    return res.status(200).json({ outcome: result.outcome, counts: result.counts, skippedReasons: result.skippedReasons });
  };
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { onSchedule } = require('firebase-functions/v2/scheduler');
  const { defineSecret } = require('firebase-functions/params');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const secrets = airtableSecretNames(process.env).map(defineSecret);
  const deps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }) };
  };
  const expose = (create, options = {}) => onRequest({ region, ...options }, async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS) })) return;
    await create(deps())(req, res);
  });
  return {
    updateAirtablePitchSource: expose(createUpdateAirtableSourceHandler),
    // Two 30-second rate-limit waits fit inside this budget.
    refreshAirtablePitches: expose(createRefreshAirtableHandler, { secrets, timeoutSeconds: 300 }),
    // Always deployed, so turning Airtable off never deletes a function in
    // a non-interactive deploy. It reads one document and returns unless an
    // operator chose a timing.
    scheduledAirtablePitchRefresh: onSchedule({ region, schedule: 'every 15 minutes', secrets, timeoutSeconds: 300 }, async () => {
      const { getDb } = require('../core/firestore.cjs');
      await runAirtableSync({
        db: getDb(), fetchImpl: globalThis.fetch, token: process.env[TOKEN_SECRET], env: process.env,
        actor: { uid: null, email: null }, trigger: 'scheduled',
      });
    }),
  };
}

module.exports = {
  mapRecord,
  runAirtableSync,
  airtableSecretNames,
  createUpdateAirtableSourceHandler,
  createRefreshAirtableHandler,
  get handlers() { return buildHandlers(); },
  internals: { PITCHES, SOURCES, SYNC, SOURCE_DOC, STATUS_DOC, TOKEN_SECRET, ENABLED_ENV, LEASE_MS, MANUAL_GAP_MS, CHUNK, pitchIdFor },
};
