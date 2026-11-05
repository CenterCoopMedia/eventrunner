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
 * document contains only `{ enabled, closesAt, externalFormUrl, formOptions }`.
 * `formOptions` holds the staff lists the pitch stepper offers (formats,
 * lengths, tracks, the co-presenter limit; ADR 0008 §2), and only
 * `updatePitchFormOptions` writes it. A null
 * `closesAt` means the call has no deadline; staff close it by hand. A set
 * `externalFormUrl` sends people to another form (for example, Airtable),
 * and this API then refuses native submissions so one call never has two
 * intake queues. Rate-limit rows are server-only. This module does not
 * publish a session or change an account. Its only mail is the automatic
 * pitch receipt (./pitchNotices.cjs), queued with the new pitch and sent
 * after the commit. Saving a review decision sends nothing.
 */

const crypto = require('node:crypto');
const { requireAdmin, internals: { extractBearerToken } } = require('../core/auth.cjs');
const {
  sendError, badRequest, notFound, methodNotAllowed, internal,
} = require('../core/errors.cjs');
const { isValidDocId } = require('../cms/store.cjs');
const { automaticReceipt, deliverNotice } = require('./pitchNotices.cjs');

const PITCHES = 'session_pitches';
const RATE_LIMITS = 'session_pitch_rate_limits';
const ADMIN_LOGS = 'admin_logs';
const PITCH_CALL_PATH = 'config/pitch_call';

const STATUSES = Object.freeze(['new', 'in_review', 'accepted', 'rejected']);
const SUBMISSION_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const {
  readClosesAt, readPitchDeadline, readPitchFormUrl, isPitchCallOpen,
} = require('shared/pitch');
const {
  IMPORT_FIELDS, checkPitch, presenterList, readPitchFormOptions, readPresenters, sameValue, validatePitchFormOptions,
} = require('shared/pitchForm');

const MAX_TITLE_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_ORGANIZATION_LENGTH = 200;
const MAX_FORMAT_LENGTH = 120;
const MAX_PRIVATE_NOTES_LENGTH = 5000;
const MAX_BODY_BYTES = 16 * 1024;
// JSON can escape one UTF-16 code unit as six bytes. Cover every valid
// field of the pitch stepper at its character limit (about 13,000
// characters with four co-presenters), plus the keys and object framing.
const MAX_SUBMISSION_BODY_BYTES = 96 * 1024;
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

/**
 * The pitch stepper's submission (ADR 0008 §2), checked by the same rule
 * the browser steps run (shared/pitchForm). The first failing field is
 * returned as `field: message`, the shape every handler here answers with.
 *
 * @param {object} body
 * @param {{ options: object, email: string }} context
 */
function readFormSubmission(body, { options, email }) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const submissionKey = source.submissionKey;
  if (typeof submissionKey !== 'string' || !SUBMISSION_KEY_RE.test(submissionKey)) {
    return { ok: false, message: 'submissionKey: must be 8-128 characters of [A-Za-z0-9_-].' };
  }
  const checked = checkPitch(source, { options, submitterEmail: email });
  if (!checked.ok) {
    const [field, message] = Object.entries(checked.errors)[0];
    return { ok: false, field, message: `${field}: ${message}` };
  }
  return { ok: true, ...checked.pitch, submissionKey };
}

/** The call's lists, widened to hold a body's own choices (a stored pitch's retry). */
function widenedOptions(options, body) {
  const source = body && typeof body === 'object' ? body : {};
  const add = (list, value) => (value === undefined || value === null || value === '' || list.includes(value) ? list : [...list, value]);
  return {
    formats: options.formats.length ? add(options.formats, source.format) : [],
    lengths: add(options.lengths, source.lengthMinutes),
    tracks: add(options.tracks, source.track),
    maxCoPresenters: 4,
  };
}

/** The proposal fields a replay must repeat exactly. */
function proposalOf(pitch, email) {
  return {
    title: pitch.title,
    summary: pitch.summary ?? null,
    description: pitch.description,
    organization: pitch.organization ?? null,
    format: pitch.format ?? null,
    lengthMinutes: pitch.lengthMinutes ?? null,
    track: pitch.track ?? null,
    audienceLevel: pitch.audienceLevel ?? null,
    presenters: presenterList(pitch, email),
    accessNeeds: pitch.accessNeeds ?? null,
    notes: pitch.notes ?? null,
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
  if (stored.uid !== actor.uid) return false;
  // A pitch stored before the stepper (no presenter list) replays on the
  // four fields it was stored with, so a retry from that time still lands.
  if (!Array.isArray(stored.presenters)) {
    return stored.title === pitch.title
      && stored.description === pitch.description
      && (stored.organization ?? null) === (pitch.organization ?? null)
      && (stored.format ?? null) === (pitch.format ?? null);
  }
  const expected = proposalOf(pitch, actor.email);
  // By value: Firestore may return a presenter map's keys in another order.
  return Object.entries(expected).every(([key, value]) => sameValue(stored[key], value));
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
    // A null deadline stays open until an operator turns the call off.
    if (!isPitchCallOpen(call, nowMs) || readPitchFormUrl(call?.externalFormUrl)) {
      return { outcome: 'closed' };
    }
    // The handler checked the pitch against the lists it read first. An
    // operator who changed a list since then makes this read the new one,
    // and a choice that is no longer offered is refused, not stored.
    const recheck = checkPitch(pitch, { options: readPitchFormOptions(call), submitterEmail: actor.email });
    if (!recheck.ok) return { outcome: 'form-changed' };

    const window = rateLimitWindow(limitSnap.exists ? limitSnap.data()?.requests : null, nowMs);
    if (window.limited) return { outcome: 'limited', retryAfterMs: window.retryAfterMs };

    const at = new Date(nowMs);
    // Reads stay ahead of the writes below, as transactions require.
    const receipt = await automaticReceipt({ db, tx, pitchId: id, email: actor.email, at });
    tx.create(pitchRef, {
      ...proposalOf(pitch, actor.email),
      ...(pitch.consent ? { consent: { version: 'session-pitch-review-v1', at } } : {}),
      uid: actor.uid,
      email: actor.email,
      status: 'new',
      reviewRevision: 0,
      privateNotes: null,
      createdAt: at,
      reviewedAt: null,
      reviewedBy: null,
      ...(receipt ? { notices: { receipt: receipt.record } } : {}),
    });
    tx.set(limitRef, { requests: [...window.requests, nowMs], updatedAt: at });
    return { outcome: 'stored', id, receipt };
  });
}

function createSubmitSessionPitchHandler({ db, auth, getConfig, sendEmail, now = Date.now, log = console }) {
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

    let options;
    try {
      const callSnap = await db.collection('config').doc('pitch_call').get();
      options = readPitchFormOptions(callSnap.exists ? callSnap.data() : null);
    } catch (err) {
      log.error('submitSessionPitch could not read the call', err);
      return internal(res, 'The session pitch could not be saved. Try again.');
    }
    let pitch = readFormSubmission(req.body, { options, email });
    if (!pitch.ok) {
      // A retry of a pitch already stored must still land after staff take
      // one of its choices off a list, or it could never get its answer. So
      // a refused body is checked again against the lists widened by its own
      // choices, and only when this account and key already hold a pitch.
      // storePitch then replays it, or refuses changed answers with 409.
      const stored = await db.collection(PITCHES).doc(pitchIdFor(decoded.uid, String(req.body?.submissionKey ?? ''))).get().catch(() => null);
      if (stored?.exists && SUBMISSION_KEY_RE.test(String(req.body?.submissionKey ?? ''))) {
        pitch = readFormSubmission(req.body, { options: widenedOptions(options, req.body), email });
      }
      if (!pitch.ok) return badRequest(res, pitch.message);
    }

    let result;
    try {
      result = await storePitch({ db, actor: { uid: decoded.uid, email }, pitch, now });
    } catch (err) {
      log.error('submitSessionPitch failed', err);
      return internal(res, 'The session pitch could not be saved. Try again.');
    }

    if (result.outcome === 'closed') return notFound(res, CLOSED_MESSAGE);
    if (result.outcome === 'form-changed') {
      return sendError(res, 409, 'form-changed', 'The organizers changed the pitch form. Reload the page and check your choices.');
    }
    if (result.outcome === 'changed') {
      return sendError(res, 409, 'conflict', 'You changed your answers after sending. Select Submit pitch again.');
    }
    if (result.outcome === 'limited') {
      const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: {
          code: 'rate-limited',
          message: 'You have sent several pitches in a short time. Wait 15 minutes, then try again.',
          retryAfterSeconds,
        },
      });
      return;
    }
    // The pitch is durable before the receipt is sent. A replay finds the
    // record already queued and sends nothing, and a send failure only
    // marks the record failed for staff to retry.
    if (result.outcome === 'stored' && result.receipt) {
      try {
        await deliverNotice({
          db, sendEmail, getConfig, now, log, pitchId: result.id, slot: 'receipt',
          record: result.receipt.record, pitch: { title: pitch.title }, settings: result.receipt.settings,
        });
      } catch (err) {
        log.error('session pitch receipt failed', err);
      }
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
    // An explicit null is "Open until I close it" (issue #476): the call has
    // no deadline and stays open until an operator saves enabled: false.
    const deadline = readPitchDeadline(req.body?.closesAt);
    if (!deadline.ok) return badRequest(res, 'closesAt: must be an RFC3339 date and time, or null for no deadline.');
    const { closesAt } = deadline;

    // Leaving the field out keeps the stored form, so an older admin tab or a
    // deadline-only script cannot silently reopen native intake. Only an
    // explicit null or empty string selects this site's form.
    const keepFormUrl = !Object.hasOwn(req.body ?? {}, 'externalFormUrl');
    const rawFormUrl = req.body?.externalFormUrl;
    const blankFormUrl = rawFormUrl === null || (typeof rawFormUrl === 'string' && !rawFormUrl.trim());
    let externalFormUrl = keepFormUrl || blankFormUrl ? null : readPitchFormUrl(rawFormUrl);
    if (!keepFormUrl && !blankFormUrl && !externalFormUrl) {
      return badRequest(res, 'externalFormUrl: must be empty or an https:// address of 2,048 characters or fewer.');
    }

    const enabled = req.body.enabled;
    const callRef = db.collection('config').doc('pitch_call');
    try {
      await db.runTransaction(async (tx) => {
        const stored = await tx.get(callRef);
        const storedCall = stored.exists ? stored.data() : null;
        if (keepFormUrl) externalFormUrl = readPitchFormUrl(storedCall?.externalFormUrl);
        const at = new Date(now());
        // The form option lists have their own endpoint; this save keeps them.
        const formOptions = storedCall?.formOptions;
        tx.set(callRef, { enabled, closesAt, externalFormUrl, ...(formOptions ? { formOptions } : {}) });
        tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
          action: 'updatePitchCall',
          docPath: PITCH_CALL_PATH,
          actor: gate,
          at,
          details: { enabled, closesAt, externalFormUrl },
        }));
      });
    } catch (err) {
      log.error('updatePitchCall failed', err);
      return internal(res, 'The session pitch call could not be saved.');
    }
    return res.status(200).json({ enabled, closesAt, externalFormUrl });
  };
}

/**
 * The pitch stepper's option lists (ADR 0008 §2): formats, lengths in
 * minutes, tracks, and the co-presenter limit. Operator-only, like the rest
 * of the call. It merges into config/pitch_call, so the call's state stays.
 */
function createUpdatePitchFormOptionsHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function updatePitchFormOptions(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'operator' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    if (bodyBytes(req.body) > MAX_BODY_BYTES) {
      return sendError(res, 413, 'payload-too-large', 'The form options are too large.');
    }
    const checked = validatePitchFormOptions(req.body?.formOptions);
    if (!checked.ok) return badRequest(res, checked.errors.join(' '));
    const formOptions = checked.options;
    const callRef = db.collection('config').doc('pitch_call');
    try {
      await db.runTransaction(async (tx) => {
        await tx.get(callRef);
        const at = new Date(now());
        tx.set(callRef, { formOptions }, { merge: true });
        tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
          action: 'updatePitchFormOptions',
          docPath: PITCH_CALL_PATH,
          actor: gate,
          at,
          details: { formOptions },
        }));
      });
    } catch (err) {
      log.error('updatePitchFormOptions failed', err);
      return internal(res, 'The pitch form options could not be saved.');
    }
    return res.status(200).json({ formOptions });
  };
}

/** The proposal fields a staff edit may change, in the order the audit names them. */
const EDITABLE_FIELDS = Object.freeze([
  'title', 'summary', 'description', 'organization', 'format', 'lengthMinutes', 'track',
  'audienceLevel', 'presenters', 'accessNeeds', 'notes',
]);

/** A stored pitch's proposal, for the first-edit copy and the change list. */
function storedProposal(stored) {
  const proposal = {};
  for (const field of EDITABLE_FIELDS) {
    proposal[field] = field === 'presenters' ? readPresenters(stored) : (stored[field] ?? null);
  }
  return proposal;
}

/**
 * A staff edit of a pitch's proposal (ADR 0008, admin review). The edit is
 * checked like a new pitch, with one difference: a format, length or track
 * the pitch already holds stays allowed after staff take it off the list,
 * so correcting a typo never forces a second change. The lead presenter's
 * email is the submitter's and cannot change; their name and role can.
 *
 * The first edit keeps a copy of the pitch as submitted (`submitted`), so
 * what the person sent is never lost. The edit raises the review revision,
 * so an open review of the old text conflicts. It sends no email.
 */
function createEditSessionPitchHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function editSessionPitch(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    if (bodyBytes(req.body) > MAX_SUBMISSION_BODY_BYTES) {
      return sendError(res, 413, 'payload-too-large', 'The edit is too large.');
    }
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (!isValidDocId(body.id)) return badRequest(res, 'id: must be a session pitch id.');
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
      return badRequest(res, 'expectedRevision: must be a non-negative whole number.');
    }
    const source = body.pitch && typeof body.pitch === 'object' && !Array.isArray(body.pitch) ? body.pitch : null;
    if (!source) return badRequest(res, 'pitch: must be an object.');

    const ref = db.collection(PITCHES).doc(body.id);
    const callRef = db.collection('config').doc('pitch_call');
    let outcome;
    try {
      outcome = await db.runTransaction(async (tx) => {
        const [snap, callSnap] = await Promise.all([tx.get(ref), tx.get(callRef)]);
        if (!snap.exists) return { outcome: 'missing' };
        const stored = snap.data() || {};
        const currentRevision = Number.isSafeInteger(stored.reviewRevision) ? stored.reviewRevision : 0;
        if (currentRevision !== body.expectedRevision) return { outcome: 'conflict' };

        const listed = readPitchFormOptions(callSnap.exists ? callSnap.data() : null);
        const keep = (list, value) => (value === null || value === undefined || list.includes(value) ? list : [...list, value]);
        const options = {
          ...listed,
          formats: listed.formats.length ? keep(listed.formats, stored.format) : [],
          lengths: keep(listed.lengths, stored.lengthMinutes),
          tracks: keep(listed.tracks, stored.track),
          maxCoPresenters: Math.max(listed.maxCoPresenters, Math.max(0, readPresenters(stored).length - 1)),
        };
        const leadEmail = readPresenters(stored)[0]?.email ?? stored.email ?? null;
        const fields = [...EDITABLE_FIELDS.filter((field) => field !== 'presenters'), 'leadName', 'leadRole', 'presenters'];
        const checked = checkPitch(source, { options, submitterEmail: leadEmail, fields });
        if (!checked.ok) {
          const [field, message] = Object.entries(checked.errors)[0];
          return { outcome: 'invalid', message: `${field}: ${message}` };
        }
        const next = proposalOf(checked.pitch, leadEmail);
        const before = storedProposal(stored);
        const changed = EDITABLE_FIELDS.filter((field) => !sameValue(before[field], next[field]));
        if (changed.length === 0) return { outcome: 'unchanged', revision: currentRevision };

        const at = new Date(now());
        const nextRevision = currentRevision + 1;
        tx.update(ref, {
          ...next,
          ...(stored.submitted ? {} : { submitted: { ...before, at: stored.createdAt ?? null } }),
          // A pitch from Airtable that predates sourceValues gets them now,
          // from the values before this edit, so the next refresh does not
          // read the correction as a change to undo.
          ...(stored.source === 'airtable' && !stored.sourceValues
            ? { sourceValues: Object.fromEntries(['email', 'title', 'description', 'organization', 'format', ...IMPORT_FIELDS, 'presenters']
              .filter((key) => ['email', 'title', 'description', 'organization', 'format'].includes(key) || stored[key] !== undefined)
              .map((key) => [key, stored[key] ?? null])) }
            : {}),
          reviewRevision: nextRevision,
          editedAt: at,
          editedBy: gate.email,
        });
        tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
          action: 'editSessionPitch',
          docPath: `${PITCHES}/${body.id}`,
          actor: gate,
          at,
          details: { changed, fromRevision: currentRevision, toRevision: nextRevision },
        }));
        return { outcome: 'updated', revision: nextRevision, changed };
      });
    } catch (err) {
      log.error('editSessionPitch failed', err);
      return internal(res, 'The session pitch edit could not be saved.');
    }
    if (outcome.outcome === 'missing') return notFound(res, 'No such session pitch.');
    if (outcome.outcome === 'conflict') {
      return sendError(res, 409, 'status-conflict', 'Someone else changed this pitch. Reload the page, then try again.');
    }
    if (outcome.outcome === 'invalid') return badRequest(res, outcome.message);
    return res.status(200).json({ id: body.id, revision: outcome.revision, changed: outcome.changed ?? [] });
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
      return sendError(res, 409, 'status-conflict', 'Someone else changed this pitch. Reload the page, then try again.');
    }
    return res.status(200).json({ id: review.id, status: review.status, revision: outcome.revision });
  };
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const { defineSecret } = require('firebase-functions/params');
  const { SEND_SECRETS_BY_PROVIDER } = require('../email/send.cjs').internals;
  const providerName = (process.env.EVENT_EMAIL_PROVIDER || '').trim();
  // Only the endpoints that send mail bind the provider's send secrets.
  const secrets = (SEND_SECRETS_BY_PROVIDER[providerName] || []).map(defineSecret);

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    const getConfig = () => getEventConfig({ db });
    const sendEmail = (message) => {
      const { createEmailCore } = require('../email/send.cjs');
      const { getEmailProvider } = require('../email/providers/index.cjs');
      return createEmailCore({ db, provider: getEmailProvider({ env: process.env }), getConfig }).send(message);
    };
    return { db, auth: getAuth(), getConfig, sendEmail };
  };
  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    if (applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
    })) return;
    await handler(req, res);
  };
  const expose = (create, options = {}) => onRequest({ region, ...options }, withCors(async (req, res) => {
    await create(buildDeps())(req, res);
  }));
  const {
    createSendSessionPitchNoticeHandler,
    createSavePitchNoticeSettingsHandler,
  } = require('./pitchNotices.cjs');
  const { createSaveSessionPitchNoteHandler } = require('./pitchNotes.cjs');

  return {
    submitSessionPitch: expose(createSubmitSessionPitchHandler, { secrets }),
    updatePitchCall: expose(createUpdatePitchCallHandler),
    updatePitchFormOptions: expose(createUpdatePitchFormOptionsHandler),
    editSessionPitch: expose(createEditSessionPitchHandler),
    reviewSessionPitch: expose(createReviewSessionPitchHandler),
    saveSessionPitchNote: expose(createSaveSessionPitchNoteHandler),
    sendSessionPitchNotice: expose(createSendSessionPitchNoticeHandler, { secrets }),
    savePitchNoticeSettings: expose(createSavePitchNoticeSettingsHandler),
  };
}

module.exports = {
  createSubmitSessionPitchHandler,
  createUpdatePitchCallHandler,
  createUpdatePitchFormOptionsHandler,
  createEditSessionPitchHandler,
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
    readFormSubmission,
    proposalOf,
    rateLimitWindow,
    pitchIdFor,
    rateLimitIdFor,
  },
};
