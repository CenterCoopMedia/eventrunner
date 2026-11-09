'use strict';

/**
 * Staff-sent session confirmations (owner decision, 2026-11-08).
 *
 * `sendSessionConfirmation` sends `speaker.confirmation` to one speaker for
 * one session, after a preview. It reads the LIVE session
 * (`cmsSchedule/{sessionId}`): a draft has not happened yet, so it is never
 * confirmed. The session must be published, have a title, a day and a start
 * time, and name the speaker in `speakerIds`. The speaker must not be
 * removed and must have an email address.
 *
 * Each pair has one private delivery record,
 * `session_confirmations/{sessionId}__{speakerId}`, with the state `queued`,
 * `sent`, `failed` or `uncertain` (shared/delivery), the attempt number, its
 * send-once key and the slot it `named` (title, time, room). The record also
 * keeps `lastSent`, the slot of the last confirmation that went.
 *
 * The retry rule is functions/src/email/noticeRetry.cjs, with one
 * exception. A sent confirmation is not sent again for the same slot, but a
 * new attempt may go when the session's title, time or room changed since
 * the last sent one. A failed attempt for a slot that was already confirmed
 * is not retried, because the speaker has that confirmation.
 *
 * A preview writes nothing. A send must carry the preview's `named` as
 * `expectedNamed`, so staff send what they read. The claim, the queued
 * record and its `admin_logs` row commit in one transaction; the result is
 * stored only while the record still holds that attempt.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const { isValidDocId } = require('../cms/store.cjs');
const { noticeRetryState, toMillis } = require('../email/noticeRetry.cjs');
const { deliveryStateOf } = require('shared/delivery');
const { getDay } = require('shared/time');
const {
  namedSlotOf, sameNamedSlot, renderConfirmation, sendSessionConfirmationEmail,
} = require('./confirmation.cjs');

const CONFIRMATIONS = 'session_confirmations';
const SESSIONS = 'cmsSchedule';
const SPEAKERS = 'speakers';
const MAX_BODY_BYTES = 8 * 1024;
const MAX_ERROR_LENGTH = 500;

function bodyBytes(body) {
  try {
    return Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function confirmationIdFor(sessionId, speakerId) {
  return `${sessionId}__${speakerId}`;
}

function onceKeyFor(speakerId, sessionId, attempt) {
  return `speaker-confirmation:${speakerId}:${sessionId}:${attempt}`;
}

function readNamed(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const key of ['title', 'time', 'room']) {
    if (typeof value[key] !== 'string') return null;
    out[key] = value[key];
  }
  return out;
}

function readRequest(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (!isValidDocId(source.sessionId)) return { ok: false, message: 'sessionId: must be a session id.' };
  if (!isValidDocId(source.speakerId)) return { ok: false, message: 'speakerId: must be a speaker id.' };
  for (const field of ['preview', 'confirmUnknown']) {
    if (source[field] !== undefined && typeof source[field] !== 'boolean') {
      return { ok: false, message: `${field}: must be true or false.` };
    }
  }
  const preview = source.preview === true;
  const expectedNamed = readNamed(source.expectedNamed);
  if (!preview && !expectedNamed) {
    return { ok: false, message: 'expectedNamed: Preview the confirmation first, then send it with the preview’s named slot.' };
  }
  const expectedContent = typeof source.expectedContent === 'string' && /^[0-9a-f]{64}$/.test(source.expectedContent)
    ? source.expectedContent : null;
  if (!preview && !expectedContent) {
    return { ok: false, message: 'expectedContent: Preview the confirmation first, then send it with the preview’s contentHash.' };
  }
  return {
    ok: true,
    sessionId: source.sessionId,
    speakerId: source.speakerId,
    preview,
    confirmUnknown: source.confirmUnknown === true,
    expectedNamed,
    expectedContent,
  };
}

const refuse = (status, code, message) => ({ refusal: { status, code, message } });

/** The slot of the last confirmation that went, or null. */
function lastSentOf(previous) {
  if (!previous) return null;
  if (deliveryStateOf(previous.state) === 'sent') {
    return { named: readNamed(previous.named), attempt: previous.attempt ?? null, sentAt: previous.sentAt ?? null };
  }
  const carried = previous.lastSent;
  return carried && readNamed(carried.named)
    ? { named: readNamed(carried.named), attempt: carried.attempt ?? null, sentAt: carried.sentAt ?? null }
    : null;
}

/**
 * Check one session, speaker and delivery record against a request.
 * Returns `{ refusal }` when the data cannot be confirmed at all. Otherwise
 * returns the target, with `blocked` set when a send is refused by the
 * retry rule (a preview still shows the email).
 */
function evaluate({ session, speaker, previous, eventConfig, request, nowMs }) {
  if (!session) return refuse(404, 'not-found', 'No such session. Publish the session first.');
  if (!speaker) return refuse(404, 'not-found', 'No such speaker.');
  if (session.visible === false) {
    return refuse(409, 'session-hidden', 'This session is not published. Publish it before you send a confirmation.');
  }
  if (typeof session.title !== 'string' || !session.title.trim()) {
    return refuse(409, 'session-incomplete', 'This session has no title. Add one and publish it first.');
  }
  if (!session.dayId || typeof session.startTime !== 'string' || !session.startTime.trim()) {
    return refuse(409, 'session-incomplete', 'This session has no day or start time. Schedule it and publish it first.');
  }
  const day = getDay(eventConfig, session.dayId);
  if (!day || typeof day.date !== 'string' || !day.date) {
    return refuse(409, 'session-incomplete', 'This session’s day is not on the event any more. Pick a day and publish it first.');
  }
  const speakerIds = Array.isArray(session.speakerIds) ? session.speakerIds : [];
  if (!speakerIds.includes(request.speakerId)) {
    return refuse(409, 'not-on-session', 'This speaker is not on the published session.');
  }
  if (speaker.status === 'removed') {
    return refuse(409, 'speaker-removed', 'This speaker is marked removed. Nothing was sent.');
  }
  if (typeof speaker.email !== 'string' || !speaker.email.trim()) {
    return refuse(409, 'no-email', 'This speaker has no email address. Add one first.');
  }
  if (previous && (previous.sessionId !== request.sessionId || previous.speakerId !== request.speakerId)) {
    return refuse(409, 'record-conflict', 'The confirmation record belongs to another session or speaker.');
  }

  const named = namedSlotOf(eventConfig, session);
  const lastSent = lastSentOf(previous);
  const changedSinceLastSend = Boolean(lastSent?.named) && !sameNamedSlot(lastSent.named, named);
  const target = { named, lastSent, changedSinceLastSend, previous, mayHaveBeenSent: false, blocked: null };

  if (deliveryStateOf(previous?.state) === 'sent') {
    // The one exception to the shared retry rule: a changed slot.
    if (!changedSinceLastSend) {
      target.blocked = { status: 409, code: 'already-sent', message: 'This confirmation was already sent. A new one can go after the title, time or room changes.' };
    }
    return target;
  }
  const retry = noticeRetryState(previous, nowMs);
  if (retry.refusal) {
    target.blocked = retry.refusal;
    return target;
  }
  // The speaker already has this slot, unless a later attempt for another
  // slot may have reached them: then a checked resend can correct it.
  const laterMayHaveGone = retry.mayHaveBeenSent && readNamed(previous?.named) && !sameNamedSlot(previous.named, lastSent?.named);
  if (lastSent?.named && !changedSinceLastSend && !laterMayHaveGone) {
    target.blocked = { status: 409, code: 'already-sent', message: 'The speaker already has a confirmation for this title, time and room.' };
    return target;
  }
  target.mayHaveBeenSent = retry.mayHaveBeenSent;
  return target;
}

/** The queued record built inside the transaction that claims the attempt. */
function queuedRecord({ sessionId, speakerId, previous, lastSent, named, by, at }) {
  const attempt = (Number.isSafeInteger(previous?.attempt) ? previous.attempt : 0) + 1;
  return {
    sessionId,
    speakerId,
    state: 'queued',
    attempt,
    onceKey: onceKeyFor(speakerId, sessionId, attempt),
    named,
    lastSent: lastSent?.named ? lastSent : null,
    queuedAt: at,
    queuedBy: by,
    sentAt: null,
    updatedAt: at,
    error: null,
  };
}

function isoOrNull(value) {
  const ms = toMillis(value);
  return ms === null ? null : new Date(ms).toISOString();
}

/** The part of the stored record a preview shows. */
function previousSummary(previous, lastSent) {
  if (!previous) return null;
  return {
    state: deliveryStateOf(previous.state) ?? null,
    attempt: Number.isSafeInteger(previous.attempt) ? previous.attempt : null,
    named: readNamed(previous.named),
    sentAt: isoOrNull(lastSent?.sentAt),
    lastSentNamed: lastSent?.named ?? null,
  };
}

/**
 * Send one queued attempt and store its result, only while the record still
 * holds this attempt in the queued state, so a late finish cannot overwrite
 * a newer one.
 */
async function deliverConfirmation({ db, sendEmail, getConfig, now = Date.now, log = console, ref, record, speaker, rendered = null }) {
  const outcome = await sendSessionConfirmationEmail({
    db, sendEmail, getConfig, onceKey: record.onceKey, speaker, named: record.named, rendered, log,
  });
  const state = outcome?.status === 'sent' ? 'sent' : outcome?.ambiguous ? 'uncertain' : 'failed';
  const error = state === 'sent' ? null : String(outcome?.error || 'The email could not be sent.').slice(0, MAX_ERROR_LENGTH);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? snap.data() : null;
      if (current?.attempt !== record.attempt || current?.state !== 'queued') return;
      const at = new Date(now());
      tx.update(ref, {
        state,
        updatedAt: at,
        error,
        ...(state === 'sent' ? { sentAt: at, lastSent: { named: record.named, attempt: record.attempt, sentAt: at } } : {}),
      });
    });
  } catch (err) {
    // The record stays queued and becomes retryable once it is stale.
    log.error('session confirmation record update failed', err);
  }
  if (state !== 'sent') log.warn(`speaker.confirmation ${record.onceKey} ${state}: ${error}`);
  return { state, error };
}

function createSendSessionConfirmationHandler({ db, auth, getConfig, sendEmail, now = Date.now, log = console }) {
  return async function sendSessionConfirmation(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    if (bodyBytes(req.body) > MAX_BODY_BYTES) {
      return sendError(res, 413, 'payload-too-large', 'The request is too large.');
    }
    const request = readRequest(req.body);
    if (!request.ok) return badRequest(res, request.message);
    const sessionRef = db.collection(SESSIONS).doc(request.sessionId);
    const speakerRef = db.collection(SPEAKERS).doc(request.speakerId);
    const ref = db.collection(CONFIRMATIONS).doc(confirmationIdFor(request.sessionId, request.speakerId));
    const dataOf = (snap) => (snap.exists ? snap.data() : null);

    if (request.preview) {
      try {
        const [sessionSnap, speakerSnap, recordSnap, config] = await Promise.all([
          sessionRef.get(), speakerRef.get(), ref.get(), getConfig(),
        ]);
        const speaker = dataOf(speakerSnap);
        const target = evaluate({
          session: dataOf(sessionSnap), speaker, previous: dataOf(recordSnap),
          eventConfig: config?.event, request, nowMs: now(),
        });
        if (target.refusal) return sendError(res, target.refusal.status, target.refusal.code, target.refusal.message);
        const rendered = await renderConfirmation({ db, config, speaker, named: target.named });
        return res.status(200).json({
          preview: {
            to: speaker.email,
            subject: rendered.subject,
            text: rendered.text,
            contentHash: rendered.contentHash,
            named: target.named,
            changedSinceLastSend: target.changedSinceLastSend,
            mayHaveBeenSent: target.mayHaveBeenSent,
            blocked: target.blocked ? { code: target.blocked.code, message: target.blocked.message } : null,
            previous: previousSummary(target.previous, target.lastSent),
          },
        });
      } catch (err) {
        log.error('sendSessionConfirmation preview failed', err);
        return internal(res, 'The confirmation preview could not be made. Try again.');
      }
    }

    let claimed;
    let rendered;
    try {
      const config = await getConfig();
      // Render the email this send would carry. The claim compares it with
      // the preview after the data checks, and the send uses this render.
      const speakerNow = dataOf(await speakerRef.get());
      rendered = speakerNow ? await renderConfirmation({ db, config, speaker: speakerNow, named: request.expectedNamed }) : null;
      claimed = await db.runTransaction(async (tx) => {
        const [sessionSnap, speakerSnap, recordSnap, policy] = await Promise.all([
          tx.get(sessionRef), tx.get(speakerRef), tx.get(ref), checkDemoWrites({ db, transaction: tx }),
        ]);
        if (!policy.ok) return { refusal: policy };
        const speaker = dataOf(speakerSnap);
        const previous = dataOf(recordSnap);
        const target = evaluate({
          session: dataOf(sessionSnap), speaker, previous, eventConfig: config?.event, request, nowMs: now(),
        });
        if (target.refusal) return target;
        if (!sameNamedSlot(target.named, request.expectedNamed)) {
          return refuse(409, 'slot-changed', 'The session’s title, time or room changed. Preview the confirmation again.');
        }
        if (rendered?.contentHash !== request.expectedContent) {
          return refuse(409, 'wording-changed', 'The email wording changed since the preview. Preview the confirmation again.');
        }
        if (target.blocked) return { refusal: target.blocked };
        if (target.mayHaveBeenSent && !request.confirmUnknown) {
          return refuse(409, 'delivery-unknown', 'This confirmation may have been sent. Check the Email log, then confirm before you send it again.');
        }
        const at = new Date(now());
        const record = queuedRecord({
          sessionId: request.sessionId, speakerId: request.speakerId, previous, lastSent: target.lastSent,
          named: target.named, by: gate.email, at,
        });
        tx.set(ref, record);
        tx.set(db.collection('admin_logs').doc(), {
          action: 'sendSessionConfirmation',
          docPath: `${CONFIRMATIONS}/${ref.id}`,
          uid: gate.uid,
          email: gate.email,
          at,
          details: {
            sessionId: request.sessionId,
            speakerId: request.speakerId,
            attempt: record.attempt,
            changedSinceLastSend: target.changedSinceLastSend,
          },
        });
        return { record, speaker: { firstName: speaker.firstName, lastName: speaker.lastName, email: speaker.email } };
      });
    } catch (err) {
      log.error('sendSessionConfirmation failed', err);
      return internal(res, 'The confirmation could not be queued. Try again.');
    }
    if (claimed.refusal) {
      const { status, code, message } = claimed.refusal;
      return sendError(res, status, code, message);
    }

    const result = await deliverConfirmation({
      db, sendEmail, getConfig, now, log, ref, record: claimed.record, speaker: claimed.speaker, rendered,
    });
    if (result.state === 'uncertain') {
      return sendError(res, 502, 'delivery-unknown', 'We do not know if the confirmation went out. Check the Email log before you send it again.');
    }
    if (result.state !== 'sent') {
      return sendError(res, 502, 'delivery-failed', 'The confirmation was not sent. Try again later.');
    }
    return res.status(200).json({ state: 'sent', attempt: claimed.record.attempt });
  };
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const { defineSecret } = require('firebase-functions/params');
  const { SEND_SECRETS_BY_PROVIDER } = require('../email/send.cjs').internals;
  const providerName = (process.env.EVENT_EMAIL_PROVIDER || '').trim();
  // This endpoint sends mail, so it binds the provider's send secrets.
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

  return {
    sendSessionConfirmation: onRequest({ region, secrets }, async (req, res) => {
      const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
      if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS) })) return;
      await createSendSessionConfirmationHandler(buildDeps())(req, res);
    }),
  };
}

module.exports = {
  createSendSessionConfirmationHandler,
  deliverConfirmation,
  get handlers() { return buildHandlers(); },
  internals: {
    CONFIRMATIONS,
    confirmationIdFor,
    onceKeyFor,
    readRequest,
    evaluate,
  },
};
