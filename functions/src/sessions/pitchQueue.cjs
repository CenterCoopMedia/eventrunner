'use strict';

const { createHash } = require('node:crypto');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, methodNotAllowed, internal } = require('../core/errors.cjs');
const { isValidDocId, writeDraft } = require('../cms/store.cjs');
const { validateSessionShape, validateSessionStructure } = require('../schedule/sessions.cjs');
const { internals: { readSubmission, MAX_BODY_BYTES } } = require('./pitches.cjs');

const hash = (text) => createHash('sha256').update(text).digest('hex');
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fail(status, code, message) { const err = new Error(message); err.status = status; err.code = code; throw err; }
function revisionOf(row) { return Number.isSafeInteger(row.reviewRevision) ? row.reviewRevision : 0; }

// Staff-only imports have stable source/external-id identities. All rows are
// validated before the transaction; a conflict leaves the entire batch unchanged.
function readImport(body) {
  const source = typeof body?.source === 'string' ? body.source.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(source)) return { error: 'source: Use 1-80 letters, numbers, underscores, or hyphens.' };
  if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 50) return { error: 'rows: Import 1-50 proposals at a time.' };
  const ids = new Set();
  const rows = [];
  for (const [index, row] of body.rows.entries()) {
    const externalId = typeof row?.externalId === 'string' ? row.externalId.trim() : '';
    const email = typeof row?.email === 'string' ? row.email.trim().toLowerCase() : '';
    const pitch = readSubmission({ ...row, submissionKey: 'import-validation' });
    if (!externalId || externalId.length > 128 || ids.has(externalId)) return { error: `Row ${index + 1}: A unique externalId (at most 128 characters) is required.` };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: `Row ${index + 1}: A valid email is required.` };
    if (row?.consent !== true || !pitch.ok) return { error: `Row ${index + 1}: ${pitch.ok ? 'consent: Must be true and evidenced in the source form.' : pitch.message}` };
    ids.add(externalId);
    rows.push({ id: hash(`import\0${source}\0${externalId}`), source, externalId, email,
      title: pitch.title, description: pitch.description, organization: pitch.organization, format: pitch.format });
  }
  return { rows };
}

async function importPitches({ db, actor, body, at }) {
  const parsed = readImport(body);
  if (parsed.error) fail(400, 'bad-request', parsed.error);
  return db.runTransaction(async (tx) => {
    const refs = parsed.rows.map((row) => db.collection('session_pitches').doc(row.id));
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    let imported = 0;
    snaps.forEach((snap, i) => {
      if (!snap.exists) return;
      const stored = snap.data();
      const incoming = parsed.rows[i];
      if (Object.keys(incoming).filter((key) => key !== 'id').some((key) => stored[key] !== incoming[key])) fail(409, 'import-conflict', `Row ${i + 1}: This source ID already exists with different content.`);
    });
    parsed.rows.forEach(({ id: _id, ...row }, i) => {
      if (snaps[i].exists) return;
      imported += 1;
      tx.create(refs[i], { ...row, uid: null, status: 'new', reviewRevision: 0, privateNotes: null,
        consent: { version: 'source-form', at, recordedBy: actor.email }, createdAt: at, reviewedAt: null, reviewedBy: null });
    });
    if (imported) tx.set(db.collection('admin_logs').doc(), { action: 'importSessionPitches', docPath: 'session_pitches', uid: actor.uid, email: actor.email, at, details: { count: imported, source: body.source } });
    return { imported, unchanged: snaps.length - imported };
  });
}

async function convertPitch({ db, actor, body, now, at }) {
  const { id, expectedRevision, firstName, lastName, dayId, startTime, endTime } = body || {};
  if (!isValidDocId(id) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail(400, 'bad-request', 'id and expectedRevision: A reviewed pitch and its revision are required.');
  if (typeof firstName !== 'string' || !firstName.trim() || firstName.length > 100 || typeof lastName !== 'string' || !lastName.trim() || lastName.length > 100) fail(400, 'bad-request', 'firstName and lastName: Review the speaker name (1-100 characters each).');
  const sessionId = `pitch-${id}`;
  const speakerId = `pitch-${id}`;
  return db.runTransaction(async (tx) => {
    const ref = db.collection('session_pitches').doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) fail(404, 'not-found', 'No such pitch.');
    const pitch = snap.data();
    // A committed conversion is acknowledged on retry without editing drafts.
    if (pitch.conversion) return { ...pitch.conversion, replayed: true };
    if (pitch.status !== 'accepted' || revisionOf(pitch) !== expectedRevision) fail(409, 'status-conflict', 'The pitch changed or is not accepted. Reload the review before creating drafts.');
    const event = await tx.get(db.collection('config').doc('event'));
    if (!(event.data()?.days || []).some((day) => day.id === dayId)) fail(400, 'bad-request', 'dayId: Choose a configured event day.');
    const fields = { title: pitch.title, description: `<p>${escapeHtml(pitch.description).replace(/\n/g, '<br>')}</p>`,
      dayId, startTime, endTime, speakerIds: [speakerId], format: pitch.format || '' };
    const shape = validateSessionShape(fields, sessionId);
    if (!shape.ok) fail(400, 'bad-request', shape.errors.join('; '));
    const structure = await validateSessionStructure({ db, tx, docId: sessionId, fields });
    if (!structure.ok) fail(400, 'bad-request', structure.message);
    const speakerRef = db.collection('speakers').doc(speakerId);
    const slugRef = db.collection('speaker_slugs').doc(speakerId);
    const checks = await Promise.all([
      tx.get(speakerRef), tx.get(slugRef),
      tx.get(db.collection('speakers').where('slug', '==', speakerId).limit(1)),
      tx.get(db.collection('cmsSchedule').doc(sessionId)),
      tx.get(db.collection('cmsSchedule_drafts').doc(sessionId)),
    ]);
    if (checks.some((item) => item.exists || item.empty === false)) fail(409, 'already-exists', 'A conversion draft already occupies this ID. No records were changed.');
    await writeDraft({ db, tx, collection: 'cmsSchedule', docId: sessionId, fields, visible: false, actor, now, createOnly: true });
    tx.create(slugRef, { speakerId, updatedAt: at });
    tx.create(speakerRef, { firstName: firstName.trim(), lastName: lastName.trim(), slug: speakerId,
      email: pitch.email, organization: pitch.organization || '', bio: '', jobTitle: '', socialHandles: {}, headshotPath: null,
      status: 'draft', uid: null, inviteToken: null, approvedAt: null, createdAt: at, updatedAt: at, updatedBy: actor.email });
    const conversion = { sessionId, speakerId, revision: expectedRevision + 1 };
    tx.update(ref, { conversion, convertedAt: at, convertedBy: actor.email, reviewRevision: expectedRevision + 1 });
    tx.set(db.collection('admin_logs').doc(), { action: 'convertSessionPitch', docPath: `session_pitches/${id}`, uid: actor.uid, email: actor.email, at, details: conversion });
    return conversion;
  });
}

function createQueueHandler({ db, auth, getConfig, now = Date.now, log = console }, action) {
  return async (req, res) => {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const actor = await requireAdmin({ db, auth, getConfig }, req, { tier: 'staff' });
    if (!actor.ok) return sendError(res, actor.status, actor.code, actor.message);
    if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > (action === 'import' ? 512 * 1024 : MAX_BODY_BYTES)) return sendError(res, 413, 'payload-too-large', 'The request is too large.');
    try {
      const at = new Date(now());
      const result = action === 'import'
        ? await importPitches({ db, actor, body: req.body, now, at })
        : await convertPitch({ db, actor, body: req.body, now, at });
      return res.status(200).json(result);
    } catch (err) {
      if (err.status) return sendError(res, err.status, err.code, err.message);
      log.error('Session pitch queue action failed', err);
      return internal(res, 'The action could not be saved. Keep your entries and try again.');
    }
  };
}
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
  const region = process.env.EVENT_FIREBASE_REGION || 'us-central1';
  const expose = (action) => onRequest({ region }, async (req, res) => {
    if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS) })) return;
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    await createQueueHandler({ db, auth: getAuth(), getConfig: () => getEventConfig({ db }) }, action)(req, res);
  });
  return { importSessionPitches: expose('import'), convertSessionPitch: expose('convert') };
}
module.exports = { readImport, createQueueHandler, get handlers() { return buildHandlers(); } };
