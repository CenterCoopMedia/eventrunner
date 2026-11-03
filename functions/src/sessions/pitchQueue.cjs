'use strict';

const { createHash } = require('node:crypto');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, methodNotAllowed, internal } = require('../core/errors.cjs');
const { isValidDocId, writeDraft } = require('../cms/store.cjs');
const { validateSessionShape, validateSessionStructure } = require('../schedule/sessions.cjs');
const { internals: { readSubmission, MAX_BODY_BYTES } } = require('./pitches.cjs');
const { readImportedExtras, sameValue, speakerCandidates } = require('shared/pitchForm');
const { inviteSpeaker, internals: { DEFAULT_INVITE_TYPE } } = require('../speakers/invites.cjs');

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
    // The pitch stepper's fields (ADR 0008 §2), only when the row has them,
    // so a file with the legacy columns alone imports exactly as before.
    const extra = readImportedExtras(row, { email });
    if (!extra.ok) return { error: `Row ${index + 1}: ${extra.message}` };
    ids.add(externalId);
    rows.push({ id: hash(`import\0${source}\0${externalId}`), source, externalId, email,
      title: pitch.title, description: pitch.description, organization: pitch.organization, format: pitch.format, ...extra.extras });
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
      // By value: a presenter list read back from Firestore may hold its
      // keys in another order than the one it was written in.
      if (Object.keys(incoming).filter((key) => key !== 'id').some((key) => !sameValue(stored[key], incoming[key]))) fail(409, 'import-conflict', `Row ${i + 1}: This source ID already exists with different content.`);
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

// The names staff confirmed, one per presenter in the stored order. A body
// from before presenters (firstName and lastName alone) names the lead. A
// presenter who is already a speaker needs no name (null), because that
// speaker is linked, not made.
function readSpeakerNames(body) {
  const names = Array.isArray(body?.speakers) ? body.speakers : [{ firstName: body?.firstName, lastName: body?.lastName }];
  if (names.length < 1 || names.length > 5) fail(400, 'bad-request', 'speakers: Review 1-5 speaker names.');
  return names;
}

function checkedName(name, index) {
  const first = typeof name?.firstName === 'string' ? name.firstName.trim() : '';
  const last = typeof name?.lastName === 'string' ? name.lastName.trim() : '';
  if (!first || first.length > 100 || !last || last.length > 100) {
    fail(400, 'bad-request', `speakers.${index}: Review the speaker name (1-100 characters each).`);
  }
  return { firstName: first, lastName: last };
}

/**
 * Accept a pitch into drafts (ADR 0008 §3): one hidden session and one draft
 * speaker per presenter. A presenter whose email is already on a speaker is
 * linked to that speaker, and that speaker is not changed. The lead keeps
 * the id `pitch-{id}`; co-presenters take `pitch-{id}-{position}`.
 */
async function convertPitch({ db, actor, body, now, at }) {
  const { id, expectedRevision, dayId, startTime, endTime } = body || {};
  if (!isValidDocId(id) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail(400, 'bad-request', 'id and expectedRevision: A reviewed pitch and its revision are required.');
  const names = readSpeakerNames(body);
  const sessionId = `pitch-${id}`;
  return db.runTransaction(async (tx) => {
    const ref = db.collection('session_pitches').doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) fail(404, 'not-found', 'No such pitch.');
    const pitch = snap.data();
    // A committed conversion is acknowledged on retry without editing drafts.
    if (pitch.conversion) return { ...pitch.conversion, replayed: true };
    if (pitch.status !== 'accepted' || revisionOf(pitch) !== expectedRevision) fail(409, 'status-conflict', 'The pitch changed or is not accepted. Reload the review before creating drafts.');
    const presenters = speakerCandidates(pitch);
    if (presenters.length !== names.length) fail(409, 'presenters-changed', 'The presenters changed. Reload the review before creating drafts.');
    const event = await tx.get(db.collection('config').doc('event'));
    if (!(event.data()?.days || []).some((day) => day.id === dayId)) fail(400, 'bad-request', 'dayId: Choose a configured event day.');

    // Speaker emails are stored in lower case (shared/speaker).
    const matches = await Promise.all(presenters.map((p) => (p.email
      ? tx.get(db.collection('speakers').where('email', '==', p.email.toLowerCase()).limit(1))
      : null)));
    const plan = presenters.map((presenter, index) => {
      const known = matches[index]?.docs?.[0];
      if (known) return { speakerId: known.id, presenter, created: false };
      return { speakerId: index === 0 ? `pitch-${id}` : `pitch-${id}-${index + 1}`, presenter, name: checkedName(names[index], index), created: true };
    });
    const speakerIds = [...new Set(plan.map((item) => item.speakerId))];
    const fields = { title: pitch.title, description: `<p>${escapeHtml(pitch.description).replace(/\n/g, '<br>')}</p>`,
      dayId, startTime, endTime, speakerIds, type: pitch.format || '' };
    const shape = validateSessionShape(fields, sessionId);
    if (!shape.ok) fail(400, 'bad-request', shape.errors.join('; '));
    const structure = await validateSessionStructure({ db, tx, docId: sessionId, fields });
    if (!structure.ok) fail(400, 'bad-request', structure.message);

    const created = plan.filter((item) => item.created);
    const checks = await Promise.all([
      tx.get(db.collection('cmsSchedule').doc(sessionId)),
      tx.get(db.collection('cmsSchedule_drafts').doc(sessionId)),
      ...created.flatMap(({ speakerId }) => [
        tx.get(db.collection('speakers').doc(speakerId)),
        tx.get(db.collection('speaker_slugs').doc(speakerId)),
        tx.get(db.collection('speakers').where('slug', '==', speakerId).limit(1)),
      ]),
    ]);
    if (checks.some((item) => item.exists || item.empty === false)) fail(409, 'already-exists', 'A conversion draft already occupies this ID. No records were changed.');
    await writeDraft({ db, tx, collection: 'cmsSchedule', docId: sessionId, fields, visible: false, actor, now, createOnly: true });
    for (const { speakerId, presenter, name } of created) {
      tx.create(db.collection('speaker_slugs').doc(speakerId), { speakerId, updatedAt: at });
      tx.create(db.collection('speakers').doc(speakerId), { firstName: name.firstName, lastName: name.lastName, slug: speakerId,
        email: presenter.email ? presenter.email.toLowerCase() : null, organization: presenter.organization || '', bio: '', jobTitle: presenter.role || '', socialHandles: {}, headshotPath: null,
        status: 'draft', uid: null, inviteToken: null, approvedAt: null, createdAt: at, updatedAt: at, updatedBy: actor.email });
    }
    const conversion = { sessionId, speakerId: speakerIds[0], speakerIds, createdSpeakerIds: created.map((item) => item.speakerId), revision: expectedRevision + 1 };
    tx.update(ref, { conversion, convertedAt: at, convertedBy: actor.email, reviewRevision: expectedRevision + 1 });
    tx.set(db.collection('admin_logs').doc(), { action: 'convertSessionPitch', docPath: `session_pitches/${id}`, uid: actor.uid, email: actor.email, at, details: conversion });
    return conversion;
  });
}

// "Invite the presenters now": after the drafts commit, each new speaker
// gets the ordinary speaker invite. A failed send leaves the drafts; the
// result says who was not invited, and the Speakers page can resend.
async function invitePresenters({ db, getConfig, sendEmail, actor, conversion, now, log }) {
  const invites = [];
  for (const speakerId of conversion.createdSpeakerIds) {
    let result;
    try {
      result = await inviteSpeaker({ db, getConfig, sendEmail, speakerId, inviteType: DEFAULT_INVITE_TYPE, mode: 'send', actor, now, log });
    } catch (err) {
      log.error('Pitch presenter invite failed', err);
      result = { ok: false, message: 'The invitation could not be created.' };
    }
    const email = result.ok ? result.minted.speaker.email : null;
    invites.push(result.ok ? { speakerId, email, sent: true } : { speakerId, sent: false, message: result.message });
  }
  return invites;
}

function createQueueHandler({ db, auth, getConfig, sendEmail, now = Date.now, log = console }, action) {
  return async (req, res) => {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const actor = await requireAdmin({ db, auth, getConfig }, req, { tier: 'staff' });
    if (!actor.ok) return sendError(res, actor.status, actor.code, actor.message);
    if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > (action === 'import' ? 512 * 1024 : MAX_BODY_BYTES)) return sendError(res, 413, 'payload-too-large', 'The request is too large.');
    try {
      const at = new Date(now());
      if (action === 'import') return res.status(200).json(await importPitches({ db, actor, body: req.body, at }));
      const conversion = await convertPitch({ db, actor, body: req.body, now, at });
      const invites = req.body?.invite === true && !conversion.replayed
        ? await invitePresenters({ db, getConfig, sendEmail, actor, conversion, now, log })
        : [];
      return res.status(200).json({ ...conversion, invites });
    } catch (err) {
      if (err.status) return sendError(res, err.status, err.code, err.message);
      log.error('Session pitch queue action failed', err);
      return internal(res, 'The action could not be saved. Keep your entries and try again.');
    }
  };
}
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
  const { SEND_SECRETS_BY_PROVIDER } = require('../email/send.cjs').internals;
  const region = process.env.EVENT_FIREBASE_REGION || 'us-central1';
  // Conversion can send the speaker invites, so it binds the send secrets.
  const secrets = (SEND_SECRETS_BY_PROVIDER[(process.env.EVENT_EMAIL_PROVIDER || '').trim()] || []).map(defineSecret);
  const expose = (action, options = {}) => onRequest({ region, ...options }, async (req, res) => {
    if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS) })) return;
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    const getConfig = () => getEventConfig({ db });
    // Built on first use, so a missing provider fails only a send.
    const sendEmail = (message) => {
      const { createEmailCore } = require('../email/send.cjs');
      const { getEmailProvider } = require('../email/providers/index.cjs');
      return createEmailCore({ db, provider: getEmailProvider({ env: process.env }), getConfig }).send(message);
    };
    await createQueueHandler({ db, auth: getAuth(), getConfig, sendEmail }, action)(req, res);
  });
  return { importSessionPitches: expose('import'), convertSessionPitch: expose('convert', { secrets }) };
}
module.exports = { readImport, createQueueHandler, get handlers() { return buildHandlers(); } };
