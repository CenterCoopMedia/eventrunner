'use strict';

/**
 * Change request notices (issue #330): the acknowledgement a requester gets
 * when their request is stored, and the outcome email they get when staff
 * mark it done or declined.
 *
 *   saveChangeRequestNoticeSettings  POST { acknowledgement, outcome,
 *                                    expectedRevision } — operator tier.
 *                                    Each is 'off' or 'automatic'. Both
 *                                    are off until an operator turns them
 *                                    on.
 *   retryChangeRequestNotice         POST { id, slot, confirmUnknown? } —
 *                                    staff tier. Sends one notice again.
 *
 * WHEN MAIL GOES. With the acknowledgement on, submitChangeRequest queues it
 * in the transaction that stores the request and sends it after the commit.
 * With the outcome on, updateChangeRequestStatus queues the done or the
 * declined email in the transaction that sets that status, the first time
 * the request gets that status, and sends it after the commit. A failed
 * send never fails the request or the status change. No other path sends
 * one, and staff can only retry a notice that was queued.
 *
 * ONE RECORD PER NOTICE. `change_requests/{id}.notices.{slot}` (slot
 * `received`, `done` or `declined`) holds the state `queued`, `sent`,
 * `failed`, `unknown` or `suppressed`, the attempt number and the send-once
 * key `change-request-notice:{id}:{slot}:{attempt}`. The email core's claim
 * on that key (email/send.cjs) means one attempt reaches the provider at
 * most once, whatever retries the caller makes. A sent notice is never sent
 * again. A failed or suppressed one may be retried with a new attempt. An
 * `unknown` one (the provider threw, so it may have accepted the message)
 * and a stale queued one need staff to confirm that they checked the Email
 * log, because the new attempt may deliver a second copy. A result is
 * stored only while the record still holds that attempt, so a late finish
 * cannot overwrite a newer retry. The records are staff-readable and never
 * reach the requester.
 *
 * FIXED WORDING, NO REQUEST TEXT. The emails are rendered from the shipped
 * templates with no override (email/templates/changeRequestNotice.cjs). No
 * token carries the request's text, a staff reply or a result link: the
 * email points to the requester's own page, `/profile/change-requests`.
 *
 * THE TRANSACTIONAL STREAM AND SUPPRESSIONS. A notice goes on the
 * transactional stream (email/stream.cjs) and is refused, as `failed`, when
 * that stream is set to the announcement stream. A notice is optional mail,
 * so an address with an `email_suppressions` record (an announcement
 * unsubscribe, announcements/suppression.cjs) gets none, and the record
 * says `suppressed`.
 *
 * Mail goes through the central sender, which applies the historical-demo
 * guard, the send-once claim and the sent_emails log. A historical demo
 * queues nothing.
 */

const { requireAdmin } = require('../core/auth.cjs');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { sendError, badRequest, notFound, methodNotAllowed, internal } = require('../core/errors.cjs');
const { isValidDocId } = require('../cms/store.cjs');

const COLLECTION = 'change_requests';
const SETTINGS_COLLECTION = 'change_request_settings';
const SETTINGS_DOC = 'notices';
const ADMIN_LOGS = 'admin_logs';
const MODES = Object.freeze(['off', 'automatic']);
const SLOT_TEMPLATES = Object.freeze({
  received: 'changeRequest.received',
  done: 'changeRequest.done',
  declined: 'changeRequest.declined',
});
const OUTCOME_SLOTS = Object.freeze(['done', 'declined']);
/** The requester's own page, which every notice links to. */
const REQUESTS_PATH = '/profile/change-requests';
// A queued record older than this is treated as interrupted. A younger one
// may still be sending.
const QUEUED_STALE_MS = 10 * 60 * 1000;
const MAX_ERROR_LENGTH = 500;
const MAX_BODY_BYTES = 4 * 1024;

function settingsRef(db) {
  return db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC);
}

/** The stored settings, with anything unknown read as off. */
function readNoticeSettings(data) {
  const mode = (value) => (MODES.includes(value) ? value : 'off');
  const revision = Number.isSafeInteger(data?.revision) && data.revision >= 0 ? data.revision : 0;
  return { acknowledgement: mode(data?.acknowledgement), outcome: mode(data?.outcome), revision };
}

/** The settings key that turns one slot on. */
function settingFor(slot) {
  return slot === 'received' ? 'acknowledgement' : 'outcome';
}

function onceKeyFor(id, slot, attempt) {
  return `change-request-notice:${id}:${slot}:${attempt}`;
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
}

/** The audit row, in the five-field shape changeRequests.cjs writes. */
function auditRow({ action, id, actor, at }) {
  return { action, docPath: `${COLLECTION}/${id}`, uid: actor.uid, email: actor.email, at };
}

function bodyBytes(body) {
  try {
    return Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** A queued record, built inside the transaction that claims the attempt. */
function queuedRecord({ id, slot, previous, mode, by, at }) {
  const attempt = (Number.isSafeInteger(previous?.attempt) ? previous.attempt : 0) + 1;
  return {
    state: 'queued',
    templateId: SLOT_TEMPLATES[slot],
    attempt,
    onceKey: onceKeyFor(id, slot, attempt),
    mode,
    queuedAt: at,
    queuedBy: by,
    updatedAt: at,
    error: null,
  };
}

/** The address of the requester's own page, or '' with no public site address. */
function requestsUrl(config) {
  const raw = config?.tierA?.publicUrl;
  if (typeof raw !== 'string' || !raw.trim()) return '';
  return `${raw.trim().replace(/\/+$/, '')}${REQUESTS_PATH}`;
}

/** Render one notice with the shipped wording. Never reads an override. */
function renderNotice({ config, slot }) {
  const { render } = require('../email/render.cjs');
  const { getDefaultTemplate } = require('../email/templates.cjs');
  const rendered = render({
    template: getDefaultTemplate(SLOT_TEMPLATES[slot]),
    override: null,
    tokenValues: { requests_url: requestsUrl(config) },
    config,
  });
  return { ...rendered, subject: rendered.subject.replace(/\s+/g, ' ').trim() };
}

/**
 * The record to queue with a new request, or null. Reads the settings and
 * the demo policy inside the store transaction, so a change to either
 * retries it. Every read happens before the caller's first write.
 */
async function queueAcknowledgement({ db, tx, id, at }) {
  const settingsSnap = await tx.get(settingsRef(db));
  const settings = readNoticeSettings(settingsSnap.exists ? settingsSnap.data() : null);
  if (settings.acknowledgement !== 'automatic') return null;
  const policy = await checkDemoWrites({ db, transaction: tx });
  if (policy.code === 'read-only-demo') return null;
  return queuedRecord({ id, slot: 'received', previous: null, mode: 'automatic', by: 'automatic', at });
}

/**
 * The outcome record to queue with a status change, or null: only for done
 * or declined, only while the outcome email is on, and only the first time
 * the request gets that outcome.
 */
async function queueOutcome({ db, tx, id, stored, status, at }) {
  if (!OUTCOME_SLOTS.includes(status)) return null;
  if (stored?.notices?.[status]) return null;
  const settingsSnap = await tx.get(settingsRef(db));
  const settings = readNoticeSettings(settingsSnap.exists ? settingsSnap.data() : null);
  if (settings.outcome !== 'automatic') return null;
  const policy = await checkDemoWrites({ db, transaction: tx });
  if (policy.code === 'read-only-demo') return null;
  return { slot: status, record: queuedRecord({ id, slot: status, previous: null, mode: 'automatic', by: 'automatic', at }) };
}

/** Whether the address has an announcement suppression record. */
async function isSuppressed(db, email) {
  const { suppressionIdFor } = require('../announcements/suppression.cjs');
  const snap = await db.collection('email_suppressions').doc(suppressionIdFor(email)).get();
  return snap.exists;
}

/**
 * Send one queued notice and store its result. Never throws.
 *
 * @returns {Promise<{ state: 'sent'|'failed'|'unknown'|'suppressed', error: string|null }>}
 */
async function deliverNotice({ db, sendEmail, getConfig, now = Date.now, log = console, id, slot, record, to }) {
  let state;
  let error = null;
  try {
    if (typeof sendEmail !== 'function' || typeof getConfig !== 'function') {
      throw new Error('Email sending is not configured.');
    }
    const config = await getConfig();
    const { transactionalStream } = require('../email/stream.cjs');
    const channel = transactionalStream(config);
    if (!channel.ok) {
      state = 'failed';
      error = 'The transactional email stream is set to the announcement stream. Nothing was sent.';
    } else if (await isSuppressed(db, to)) {
      state = 'suppressed';
      error = 'This address unsubscribed from email from this site. Nothing was sent.';
    } else {
      const rendered = renderNotice({ config, slot });
      const outcome = await sendEmail({
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tag: record.templateId,
        source: 'change-requests',
        onceKey: record.onceKey,
        storeRendered: rendered.storeRendered,
        hasLegalFooterHtml: rendered.hasLegalFooterHtml,
        hasLegalFooterText: rendered.hasLegalFooterText,
        ...(channel.stream ? { messageStream: channel.stream } : {}),
      });
      // A provider throw is ambiguous: the message may have been accepted.
      state = outcome?.status === 'sent' ? 'sent' : outcome?.ambiguous ? 'unknown' : 'failed';
      if (state !== 'sent') error = String(outcome?.error || 'The email could not be sent.');
    }
  } catch (err) {
    // The central sender throws only before it contacts the provider.
    state = 'failed';
    error = String(err?.message || err);
  }
  if (error) error = error.slice(0, MAX_ERROR_LENGTH);

  const ref = db.collection(COLLECTION).doc(id);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const current = snap.data()?.notices?.[slot];
      if (current?.attempt !== record.attempt || current?.state !== 'queued') return;
      const at = new Date(now());
      tx.update(ref, {
        notices: {
          ...snap.data().notices,
          [slot]: { ...current, state, updatedAt: at, error, ...(state === 'sent' ? { sentAt: at } : {}) },
        },
      });
    });
  } catch (err) {
    // The record stays queued and becomes retryable once it is stale.
    log.error('change request notice record update failed', err);
  }
  if (state !== 'sent') log.warn(`${record.templateId} for ${id} ${state}: ${error}`);
  return { state, error };
}

function readSettingsRequest(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  for (const key of ['acknowledgement', 'outcome']) {
    if (!MODES.includes(source[key])) return { ok: false, message: `${key}: must be one of ${MODES.join(', ')}.` };
  }
  if (!Number.isSafeInteger(source.expectedRevision) || source.expectedRevision < 0) {
    return { ok: false, message: 'expectedRevision: must be the revision of the settings you edited.' };
  }
  return { ok: true, acknowledgement: source.acknowledgement, outcome: source.outcome, expectedRevision: source.expectedRevision };
}

function createSaveChangeRequestNoticeSettingsHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function saveChangeRequestNoticeSettings(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'operator' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    if (bodyBytes(req.body) > MAX_BODY_BYTES) return sendError(res, 413, 'payload-too-large', 'The request is too large.');
    const parsed = readSettingsRequest(req.body);
    if (!parsed.ok) return badRequest(res, parsed.message);
    let stored;
    try {
      stored = await db.runTransaction(async (tx) => {
        const snap = await tx.get(settingsRef(db));
        const current = readNoticeSettings(snap.exists ? snap.data() : null).revision;
        if (current !== parsed.expectedRevision) return null;
        const at = new Date(now());
        const next = { acknowledgement: parsed.acknowledgement, outcome: parsed.outcome, revision: current + 1 };
        tx.set(settingsRef(db), { ...next, updatedAt: at, updatedBy: gate.email });
        tx.set(db.collection(ADMIN_LOGS).doc(), {
          action: 'saveChangeRequestNoticeSettings',
          docPath: `${SETTINGS_COLLECTION}/${SETTINGS_DOC}`,
          uid: gate.uid,
          email: gate.email,
          at,
        });
        return next;
      });
    } catch (err) {
      log.error('saveChangeRequestNoticeSettings failed', err);
      return internal(res, 'The email settings could not be saved. Try again.');
    }
    if (!stored) {
      return sendError(res, 409, 'settings-conflict', 'Another operator changed the email settings. Load the current settings and try again.');
    }
    return res.status(200).json(stored);
  };
}

function readRetryRequest(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (!isValidDocId(source.id)) return { ok: false, message: 'id: must be a change request id.' };
  if (!Object.hasOwn(SLOT_TEMPLATES, source.slot)) {
    return { ok: false, message: `slot: must be one of ${Object.keys(SLOT_TEMPLATES).join(', ')}.` };
  }
  if (source.confirmUnknown !== undefined && typeof source.confirmUnknown !== 'boolean') {
    return { ok: false, message: 'confirmUnknown: must be true or false.' };
  }
  return { ok: true, id: source.id, slot: source.slot, confirmUnknown: source.confirmUnknown === true };
}

/** Check a stored request against a retry. Returns a refusal or the previous record. */
function evaluateRetry(stored, settings, request, nowMs) {
  if (!stored) return { status: 404, code: 'not-found', message: 'No such change request.' };
  if (settings[settingFor(request.slot)] !== 'automatic') {
    return { status: 409, code: 'notices-off', message: 'These emails are off. An operator can turn them on.' };
  }
  // An outcome email goes only while the request has that outcome, and an
  // acknowledgement only while the request is still open.
  const stillTrue = request.slot === 'received'
    ? !OUTCOME_SLOTS.includes(stored.status)
    : stored.status === request.slot;
  if (!stillTrue) {
    return { status: 409, code: 'status-changed', message: 'The request’s status changed, so this email is not sent.' };
  }
  const previous = stored.notices?.[request.slot];
  if (!previous) return { status: 409, code: 'not-queued', message: 'This email was never queued, so there is nothing to retry.' };
  if (previous.state === 'sent') return { status: 409, code: 'already-sent', message: 'This email was already sent. It is not sent again.' };
  let mayHaveBeenSent = previous.state === 'unknown';
  if (previous.state === 'queued') {
    const queuedAt = toMillis(previous.queuedAt);
    if (queuedAt === null || nowMs - queuedAt < QUEUED_STALE_MS) {
      return { status: 409, code: 'in-progress', message: 'This email is being sent. Check its state again in a few minutes.' };
    }
    mayHaveBeenSent = true;
  }
  if (mayHaveBeenSent && !request.confirmUnknown) {
    return { status: 409, code: 'delivery-unknown', message: 'This email may have been sent. Check the Email log, then confirm before you retry.' };
  }
  return { previous };
}

function createRetryChangeRequestNoticeHandler({ db, auth, getConfig, sendEmail, now = Date.now, log = console }) {
  return async function retryChangeRequestNotice(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    if (bodyBytes(req.body) > MAX_BODY_BYTES) return sendError(res, 413, 'payload-too-large', 'The request is too large.');
    const request = readRetryRequest(req.body);
    if (!request.ok) return badRequest(res, request.message);
    const ref = db.collection(COLLECTION).doc(request.id);

    let claimed;
    try {
      claimed = await db.runTransaction(async (tx) => {
        const [snap, settingsSnap, policy] = await Promise.all([
          tx.get(ref), tx.get(settingsRef(db)), checkDemoWrites({ db, transaction: tx }),
        ]);
        if (!policy.ok) return { refusal: policy };
        const stored = snap.exists ? snap.data() : null;
        const settings = readNoticeSettings(settingsSnap.exists ? settingsSnap.data() : null);
        const verdict = evaluateRetry(stored, settings, request, now());
        if (verdict.status) return { refusal: verdict };
        const at = new Date(now());
        const record = queuedRecord({ id: request.id, slot: request.slot, previous: verdict.previous, mode: 'retry', by: gate.email, at });
        tx.update(ref, { notices: { ...stored.notices, [request.slot]: record } });
        tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({ action: 'retryChangeRequestNotice', id: request.id, actor: gate, at }));
        return { record, to: stored.email };
      });
    } catch (err) {
      log.error('retryChangeRequestNotice failed', err);
      return internal(res, 'The email could not be queued. Try again.');
    }
    if (claimed.refusal) {
      const { status, code, message } = claimed.refusal;
      if (status === 404) return notFound(res, message);
      return sendError(res, status, code, message);
    }
    const result = await deliverNotice({
      db, sendEmail, getConfig, now, log, id: request.id, slot: request.slot, record: claimed.record, to: claimed.to,
    });
    return res.status(200).json({ id: request.id, slot: request.slot, state: result.state, attempt: claimed.record.attempt });
  };
}

module.exports = {
  createSaveChangeRequestNoticeSettingsHandler,
  createRetryChangeRequestNoticeHandler,
  queueAcknowledgement,
  queueOutcome,
  deliverNotice,
  renderNotice,
  internals: {
    SETTINGS_COLLECTION,
    SETTINGS_DOC,
    SLOT_TEMPLATES,
    QUEUED_STALE_MS,
    REQUESTS_PATH,
    onceKeyFor,
    readNoticeSettings,
    requestsUrl,
  },
};
