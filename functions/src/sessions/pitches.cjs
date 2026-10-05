'use strict';

/**
 * Private session pitch intake and review.
 *
 * `submitSessionPitch` accepts a verified Firebase sign-in. It does not
 * require a ticket or attendee approval. The ID token supplies the stored
 * uid and email. `updatePitchCall` is operator-only. `reviewSessionPitch`
 * admits either admin tier and uses expectedStatus plus expectedRevision to
 * reject stale status and private-note edits.
 *
 * Pitch rows are private and server-written. The public config/pitch_call
 * document contains only `{ enabled, closesAt }`. Rate-limit rows are
 * server-only. This module does not publish a session, change an account,
 * or send mail.
 */

const crypto = require('node:crypto');
const { requireAdmin, internals: { extractBearerToken } } = require('../core/auth.cjs');
const {
  sendError, badRequest, notFound, methodNotAllowed, internal,
} = require('../core/errors.cjs');
const { isValidDocId } = require('../cms/store.cjs');

const PITCHES = 'session_pitches';
const RATE_LIMITS = 'session_pitch_rate_limits';
const ADMIN_LOGS = 'admin_logs';
const PITCH_CALL_PATH = 'config/pitch_call';

const STATUSES = Object.freeze(['new', 'in_review', 'accepted', 'rejected']);
const SUBMISSION_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const { readClosesAt } = require('shared/pitch');

const MAX_TITLE_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_ORGANIZATION_LENGTH = 200;
const MAX_FORMAT_LENGTH = 120;
const MAX_PRIVATE_NOTES_LENGTH = 5000;
const MAX_BODY_BYTES = 16 * 1024;
// JSON can escape one UTF-16 code unit as six bytes. Cover every valid
// field at its character limit, plus the key and object framing.
const MAX_SUBMISSION_BODY_BYTES = 40 * 1024;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const CLOSED_MESSAGE = 'Session pitch submissions are closed.';

function bodyBytes(body) {
  try {
    return Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function readRequiredText(source, field, max) {
  const raw = source[field];
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    return { ok: false, message: `${field}: must be text.` };
  }
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { ok: false, message: `${field}: is required.` };
  if (value.length > max) return { ok: false, message: `${field}: at most ${max} characters.` };
  return { ok: true, value };
}

function readOptionalText(source, field, max) {
  const raw = source[field];
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    return { ok: false, message: `${field}: must be text.` };
  }
  const value = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  if (value && value.length > max) {
    return { ok: false, message: `${field}: at most ${max} characters.` };
  }
  return { ok: true, value };
}

function readSubmission(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const title = readRequiredText(source, 'title', MAX_TITLE_LENGTH);
  if (!title.ok) return title;
  const description = readRequiredText(source, 'description', MAX_DESCRIPTION_LENGTH);
  if (!description.ok) return description;
  const organization = readOptionalText(source, 'organization', MAX_ORGANIZATION_LENGTH);
  if (!organization.ok) return organization;
  const format = readOptionalText(source, 'format', MAX_FORMAT_LENGTH);
  if (!format.ok) return format;
  if (source.consent !== true) return { ok: false, message: 'consent: Agree to organizer review before submitting.' };
  const submissionKey = source.submissionKey;
  if (typeof submissionKey !== 'string' || !SUBMISSION_KEY_RE.test(submissionKey)) {
    return { ok: false, message: 'submissionKey: must be 8-128 characters of [A-Za-z0-9_-].' };
  }
  return {
    ok: true,
    title: title.value,
    description: description.value,
    organization: organization.value,
    format: format.value,
    submissionKey,
    consent: source.consent === true,
  };
}


function rateLimitWindow(stored, nowMs) {
  const requests = (Array.isArray(stored) ? stored : [])
    .filter((timestamp) => typeof timestamp === 'number' && nowMs - timestamp < RATE_LIMIT_WINDOW_MS);
  if (requests.length < RATE_LIMIT_MAX) return { limited: false, requests };
  const oldest = Math.min(...requests);
  return {
    limited: true,
    requests,
    retryAfterMs: Math.max(0, oldest + RATE_LIMIT_WINDOW_MS - nowMs),
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

// Firebase UIDs are trusted identity values, but they are not Firestore
// document IDs. Hashing also gives each account its own idempotency-key
// namespace, so another account cannot reserve a key first.
function pitchIdFor(uid, submissionKey) {
  return sha256(`${uid}\0${submissionKey}`);
}

function rateLimitIdFor(uid) {
  return sha256(uid);
}

function samePitch(stored, actor, pitch) {
  return stored.uid === actor.uid
    && stored.title === pitch.title
    && stored.description === pitch.description
    && (stored.organization ?? null) === pitch.organization
    && (stored.format ?? null) === pitch.format;
}

function auditRow({ action, docPath, actor, at, details }) {
  return {
    action,
    docPath,
    uid: actor.uid,
    email: actor.email,
    at,
    ...(details ? { details } : {}),
  };
}

// Pitch intake checks revocation so a disabled or deleted Firebase account
// cannot submit with an ID token that has not expired yet. A ticket and a
// Firestore users document remain deliberately unnecessary.
async function verifySubmitter(auth, req) {
  const token = extractBearerToken(req);
  if (!token) return null;
  try {
    return await auth.verifyIdToken(token, true);
  } catch {
    return null;
  }
}

/**
 * The transaction reads config/pitch_call before it creates a pitch. A
 * concurrent operator update makes Firestore retry this function against
 * the new config, so a close cannot race past a stale preflight read.
 */
async function storePitch({ db, actor, pitch, now = Date.now }) {
  const id = pitchIdFor(actor.uid, pitch.submissionKey);
  const pitchRef = db.collection(PITCHES).doc(id);
  const limitRef = db.collection(RATE_LIMITS).doc(rateLimitIdFor(actor.uid));
  const callRef = db.collection('config').doc('pitch_call');
  return db.runTransaction(async (tx) => {
    const [callSnap, pitchSnap, limitSnap] = await Promise.all([
      tx.get(callRef), tx.get(pitchRef), tx.get(limitRef),
    ]);

    if (pitchSnap.exists) {
      const stored = pitchSnap.data() || {};
      if (!samePitch(stored, actor, pitch)) return { outcome: 'changed' };
      // A pre-consent submission may replay only after this caller agrees.
      // Preserve the proposal, review revision, and original submission time.
      if (!stored.consent && pitch.consent === true) {
        tx.update(pitchRef, { consent: { version: 'session-pitch-review-v1', at: new Date(now()) } });
      }
      return { outcome: 'replayed' };
    }

    const nowMs = now();
    const call = callSnap.exists ? callSnap.data() : null;
    const closesAt = readClosesAt(call?.closesAt);
    if (call?.enabled !== true || !closesAt || Date.parse(closesAt) <= nowMs) {
      return { outcome: 'closed' };
    }

    const window = rateLimitWindow(limitSnap.exists ? limitSnap.data()?.requests : null, nowMs);
    if (window.limited) return { outcome: 'limited', retryAfterMs: window.retryAfterMs };

    const at = new Date(nowMs);
    tx.create(pitchRef, {
      title: pitch.title,
      description: pitch.description,
      organization: pitch.organization,
      format: pitch.format,
      ...(pitch.consent ? { consent: { version: 'session-pitch-review-v1', at } } : {}),
      uid: actor.uid,
      email: actor.email,
      status: 'new',
      reviewRevision: 0,
      privateNotes: null,
      createdAt: at,
      reviewedAt: null,
      reviewedBy: null,
    });
    tx.set(limitRef, { requests: [...window.requests, nowMs], updatedAt: at });
    return { outcome: 'stored', id };
  });
}

function createSubmitSessionPitchHandler({ db, auth, now = Date.now, log = console }) {
  return async function submitSessionPitch(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    const decoded = await verifySubmitter(auth, req);
    if (!decoded?.uid) return sendError(res, 401, 'unauthorized', 'Sign in to submit a session pitch.');
    const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
    if (!email || decoded.email_verified !== true) {
      return sendError(res, 403, 'forbidden', 'Use a verified email address to submit a session pitch.');
    }
    if (bodyBytes(req.body) > MAX_SUBMISSION_BODY_BYTES) {
      return sendError(res, 413, 'payload-too-large', 'The session pitch is too large.');
    }

    const pitch = readSubmission(req.body);
    if (!pitch.ok) return badRequest(res, pitch.message);

    let result;
    try {
      result = await storePitch({ db, actor: { uid: decoded.uid, email }, pitch, now });
    } catch (err) {
      log.error('submitSessionPitch failed', err);
      return internal(res, 'The session pitch could not be saved. Try again.');
    }

    if (result.outcome === 'closed') return notFound(res, CLOSED_MESSAGE);
    if (result.outcome === 'changed') {
      return sendError(res, 409, 'conflict', 'submissionKey: already used for a different session pitch.');
    }
    if (result.outcome === 'limited') {
      const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: {
          code: 'rate-limited',
          message: 'Too many session pitches. Try again later.',
          retryAfterSeconds,
        },
      });
      return;
    }
    return res.status(201).json({ id: pitchIdFor(decoded.uid, pitch.submissionKey), ok: true });
  };
}

function createUpdatePitchCallHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function updatePitchCall(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'operator' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    if (typeof req.body?.enabled !== 'boolean') return badRequest(res, 'enabled: must be true or false.');
    const closesAt = readClosesAt(req.body?.closesAt);
    if (!closesAt) return badRequest(res, 'closesAt: must be an RFC3339 date and time.');

    const enabled = req.body.enabled;
    try {
      await db.runTransaction(async (tx) => {
        const at = new Date(now());
        tx.set(db.collection('config').doc('pitch_call'), { enabled, closesAt });
        tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
          action: 'updatePitchCall',
          docPath: PITCH_CALL_PATH,
          actor: gate,
          at,
          details: { enabled, closesAt },
        }));
      });
    } catch (err) {
      log.error('updatePitchCall failed', err);
      return internal(res, 'The session pitch call could not be saved.');
    }
    return res.status(200).json({ enabled, closesAt });
  };
}

function readReview(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (!isValidDocId(source.id)) return { ok: false, message: 'id: must be a session pitch id.' };
  if (!STATUSES.includes(source.status)) {
    return { ok: false, message: `status: must be one of ${STATUSES.join(', ')}.` };
  }
  if (!STATUSES.includes(source.expectedStatus)) {
    return { ok: false, message: `expectedStatus: must be one of ${STATUSES.join(', ')}.` };
  }
  if (!Number.isSafeInteger(source.expectedRevision) || source.expectedRevision < 0) {
    return { ok: false, message: 'expectedRevision: must be a non-negative whole number.' };
  }
  const privateNotes = readOptionalText(source, 'privateNotes', MAX_PRIVATE_NOTES_LENGTH);
  if (!privateNotes.ok) return privateNotes;
  return {
    ok: true,
    id: source.id,
    status: source.status,
    expectedStatus: source.expectedStatus,
    expectedRevision: source.expectedRevision,
    privateNotesProvided: Object.hasOwn(source, 'privateNotes'),
    privateNotes: privateNotes.value,
  };
}

function createReviewSessionPitchHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function reviewSessionPitch(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    if (bodyBytes(req.body) > MAX_BODY_BYTES) {
      return sendError(res, 413, 'payload-too-large', 'The review is too large.');
    }

    const review = readReview(req.body);
    if (!review.ok) return badRequest(res, review.message);
    const ref = db.collection(PITCHES).doc(review.id);
    let outcome;
    try {
      outcome = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { outcome: 'missing' };
        const stored = snap.data() || {};
        const currentStatus = stored.status;
        const currentRevision = Number.isSafeInteger(stored.reviewRevision) ? stored.reviewRevision : 0;
        if (currentStatus !== review.expectedStatus || currentRevision !== review.expectedRevision) {
          return { outcome: 'conflict' };
        }
        const at = new Date(now());
        const nextRevision = currentRevision + 1;
        tx.update(ref, {
          status: review.status,
          reviewRevision: nextRevision,
          reviewedAt: at,
          reviewedBy: gate.email,
          ...(review.privateNotesProvided ? { privateNotes: review.privateNotes } : {}),
        });
        tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
          action: 'reviewSessionPitch',
          docPath: `${PITCHES}/${review.id}`,
          actor: gate,
          at,
          details: {
            fromStatus: review.expectedStatus,
            toStatus: review.status,
            fromRevision: currentRevision,
            toRevision: nextRevision,
          },
        }));
        return { outcome: 'updated', revision: nextRevision };
      });
    } catch (err) {
      log.error('reviewSessionPitch failed', err);
      return internal(res, 'The session pitch review could not be saved.');
    }

    if (outcome.outcome === 'missing') return notFound(res, 'No such session pitch.');
    if (outcome.outcome === 'conflict') {
      return sendError(res, 409, 'status-conflict', 'The session pitch changed. Refresh and try again.');
    }
    return res.status(200).json({ id: review.id, status: review.status, revision: outcome.revision });
  };
}

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
    if (applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    })) return;
    await handler(req, res);
  };
  const expose = (create) => onRequest({ region }, withCors(async (req, res) => {
    await create(buildDeps())(req, res);
  }));

  return {
    submitSessionPitch: expose(createSubmitSessionPitchHandler),
    updatePitchCall: expose(createUpdatePitchCallHandler),
    reviewSessionPitch: expose(createReviewSessionPitchHandler),
  };
}

module.exports = {
  createSubmitSessionPitchHandler,
  createUpdatePitchCallHandler,
  createReviewSessionPitchHandler,
  get handlers() { return buildHandlers(); },
  internals: {
    PITCHES,
    RATE_LIMITS,
    STATUSES,
    MAX_TITLE_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    MAX_ORGANIZATION_LENGTH,
    MAX_FORMAT_LENGTH,
    MAX_PRIVATE_NOTES_LENGTH,
    MAX_BODY_BYTES,
    MAX_SUBMISSION_BODY_BYTES,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
    CLOSED_MESSAGE,
    readClosesAt,
    readSubmission,
    rateLimitWindow,
    pitchIdFor,
    rateLimitIdFor,
  },
};
