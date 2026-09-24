'use strict';

/**
 * Change requests (issue #188): one store, two entry points. A signed-in
 * visitor sends a request from the public footer, a staff member from the
 * admin page, and both reach the same endpoint and the same collection.
 *
 *   submitChangeRequest       POST { message, page?, submissionKey? } — any
 *                             signed-in account with a verified email, while
 *                             `features.changeRequests` is on.
 *   updateChangeRequestStatus POST { id, status } — staff tier.
 *   deleteChangeRequest       POST { id } — staff tier. Removes the request
 *                             and its text outright.
 *
 * `change_requests` is admin-readable (the admin page lists it through a
 * listener) and never client-written: these three handlers are its only
 * writers. `change_request_rate_limits/{uid}` is server-only.
 *
 * THE FLAG gates submission only, and the server reads it LIVE from
 * `config/features`, not from the five-minute container cache
 * (core/config.cjs): an operator who turns the flag off stops the next
 * submission on every container, not the one five minutes later. A read
 * that fails refuses the submission. Status changes and removals are not
 * gated, so staff can still clear the store after the flag goes off.
 *
 * IDENTITY comes from the verified ID token, never from the body: no free
 * text is stored against a signed-out identity (parity plan, gap table), and
 * a sender cannot be forged. No mail is sent and no notifier fires, so no
 * personal data leaves the deployment.
 *
 * ONE TRANSACTION PER WRITE, WITH ITS AUDIT ROW. Every submission, status
 * change, and removal commits together with its `admin_logs` row, so a
 * request never exists without the row that records who sent it, and a
 * change never commits without its row. `auditRow` writes exactly the five
 * fields cms/store.cjs `logAdminAction` writes (the test pins the key set),
 * and never the message: a removal leaves no copy of the text. The submit
 * transaction also holds the rate limit, so a refused or failed submission
 * spends no slot, and a retry of a stored request spends none either.
 *
 * RETRY IDEMPOTENCY. The client sends one `submissionKey` per form session
 * and resends it on a retry; it becomes the document id, the same device
 * as submitFeedback. A retry that finds its own stored request writes
 * nothing and answers as the first call did.
 */

const crypto = require('node:crypto');
const { requireAdmin, verifyAuthToken } = require('../core/auth.cjs');
const {
  sendError, badRequest, notFound, methodNotAllowed, internal,
} = require('../core/errors.cjs');
const { isValidDocId } = require('../cms/store.cjs');

const COLLECTION = 'change_requests';
const RATE_LIMIT_COLLECTION = 'change_request_rate_limits';
const ADMIN_LOGS = 'admin_logs';

const MAX_MESSAGE_LENGTH = 2000;
const MAX_PAGE_LENGTH = 200;
const MAX_BODY_BYTES = 8 * 1024;

/** The same budget as submitFeedback, per account rather than per address. */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const STATUSES = Object.freeze(['new', 'in_progress', 'done', 'declined']);
// The same shape submitFeedback accepts: a client-generated token that is
// safe as a bare document id, never caller-chosen free text.
const SUBMISSION_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

const FLAG_OFF_MESSAGE = 'Change requests are not enabled for this event.';
const SAVE_FAILED_MESSAGE = 'Your request could not be saved. Try again.';

/**
 * The audit row, in exactly the shape `logAdminAction` writes, for a write
 * that must commit in the same transaction as its row.
 *
 * @param {{ action: string, docPath: string,
 *           actor: { uid: string, email: string }, at: Date }} args
 */
function auditRow({ action, docPath, actor, at }) {
  return { action, docPath, uid: actor.uid, email: actor.email, at };
}

/**
 * Read the rate-limit window from a stored document: the timestamps still
 * inside the window, and whether one more request would exceed it.
 *
 * @param {unknown} stored the document's `requests` field
 * @param {number} nowMs
 * @returns {{ limited: boolean, retryAfterMs: number, requests: number[] }}
 */
function rateLimitWindow(stored, nowMs) {
  const requests = (Array.isArray(stored) ? stored : [])
    .filter((t) => typeof t === 'number' && nowMs - t < RATE_LIMIT_WINDOW_MS);
  if (requests.length >= RATE_LIMIT_MAX) {
    const oldest = Math.min(...requests);
    return { limited: true, retryAfterMs: Math.max(0, oldest + RATE_LIMIT_WINDOW_MS - nowMs), requests };
  }
  return { limited: false, retryAfterMs: 0, requests };
}

/**
 * Validate a submission body. Unknown fields are ignored; `uid` and
 * `email` in the body are never read.
 *
 * @param {unknown} body
 * @returns {{ ok: true, message: string, page: string|null, submissionKey: string|null } |
 *           { ok: false, message: string }}
 */
function readSubmission(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};

  const rawMessage = source.message;
  if (rawMessage !== undefined && rawMessage !== null && typeof rawMessage !== 'string') {
    return { ok: false, message: 'message: must be text.' };
  }
  const message = typeof rawMessage === 'string' ? rawMessage.trim() : '';
  if (!message) return { ok: false, message: 'message: is required.' };
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, message: `message: at most ${MAX_MESSAGE_LENGTH} characters.` };
  }

  const rawPage = source.page;
  if (rawPage !== undefined && rawPage !== null && typeof rawPage !== 'string') {
    return { ok: false, message: 'page: must be text.' };
  }
  const page = typeof rawPage === 'string' && rawPage.trim() ? rawPage.trim() : null;
  if (page && page.length > MAX_PAGE_LENGTH) {
    return { ok: false, message: `page: at most ${MAX_PAGE_LENGTH} characters.` };
  }

  const rawKey = source.submissionKey;
  if (rawKey !== undefined && (typeof rawKey !== 'string' || !SUBMISSION_KEY_RE.test(rawKey))) {
    return { ok: false, message: 'submissionKey: must be 8-128 characters of [A-Za-z0-9_-].' };
  }

  return { ok: true, message, page, submissionKey: rawKey === undefined ? null : rawKey };
}

/** The size of the parsed body, as JSON. An unserializable body is too large. */
function bodyBytes(body) {
  try {
    return Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8');
  } catch {
    return MAX_BODY_BYTES + 1;
  }
}

/**
 * Whether the flag is on, read live. Throws when the read fails; the caller
 * refuses the submission.
 */
async function changeRequestsEnabled(db) {
  const snap = await db.collection('config').doc('features').get();
  return snap.exists && snap.data()?.changeRequests === true;
}

/**
 * Store one request, its rate-limit slot, and its audit row together.
 *
 * @returns {Promise<{ outcome: 'stored'|'replayed' } |
 *                   { outcome: 'limited', retryAfterMs: number } |
 *                   { outcome: 'taken' }>}
 */
async function storeRequest({ db, id, actor, message, page, nowMs }) {
  const ref = db.collection(COLLECTION).doc(id);
  const limitRef = db.collection(RATE_LIMIT_COLLECTION).doc(actor.uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      // A retry of a request this account already stored writes nothing. A
      // key another account holds is not this caller's request.
      return snap.data()?.uid === actor.uid ? { outcome: 'replayed' } : { outcome: 'taken' };
    }
    const limitSnap = await tx.get(limitRef);
    const recent = rateLimitWindow(limitSnap.exists ? limitSnap.data()?.requests : null, nowMs);
    if (recent.limited) return { outcome: 'limited', retryAfterMs: recent.retryAfterMs };

    const at = new Date(nowMs);
    tx.set(limitRef, { requests: [...recent.requests, nowMs], updatedAt: at });
    tx.create(ref, {
      message,
      page,
      status: 'new',
      uid: actor.uid,
      email: actor.email,
      createdAt: at,
      updatedAt: null,
      updatedBy: null,
    });
    tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
      action: 'submitChangeRequest',
      docPath: `${COLLECTION}/${id}`,
      actor,
      at,
    }));
    return { outcome: 'stored' };
  });
}

/**
 * @param {{ db: object, auth: { verifyIdToken: (t: string) => Promise<object> },
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createSubmitChangeRequestHandler({ db, auth, now = Date.now, log = console }) {
  return async function submitChangeRequest(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    // The flag first, before the auth gate, as the reactions and bookmarks
    // endpoints do: with the flag off, a direct POST learns nothing more.
    let enabled;
    try {
      enabled = await changeRequestsEnabled(db);
    } catch (err) {
      log.error('submitChangeRequest: config/features could not be read', err);
      return internal(res, SAVE_FAILED_MESSAGE);
    }
    if (!enabled) return notFound(res, FLAG_OFF_MESSAGE);

    const decoded = await verifyAuthToken({ auth }, req);
    if (!decoded?.uid) {
      return sendError(res, 401, 'unauthorized', 'Sign in to send a change request.');
    }
    const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
    if (!email || decoded.email_verified !== true) {
      return sendError(res, 403, 'forbidden', 'Sign in with a verified email address to send a change request.');
    }

    if (bodyBytes(req.body) > MAX_BODY_BYTES) {
      return sendError(res, 413, 'payload-too-large', 'The request is too large.');
    }
    const submission = readSubmission(req.body);
    if (!submission.ok) return badRequest(res, submission.message);

    const id = submission.submissionKey ?? crypto.randomUUID();
    const actor = { uid: decoded.uid, email };
    let result;
    try {
      result = await storeRequest({
        db, id, actor, message: submission.message, page: submission.page, nowMs: now(),
      });
    } catch (err) {
      log.error('submitChangeRequest: the request could not be stored', err);
      return internal(res, SAVE_FAILED_MESSAGE);
    }

    if (result.outcome === 'limited') {
      const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: { code: 'rate-limited', message: 'Too many change requests. Try again later.', retryAfterSeconds },
      });
      return;
    }
    if (result.outcome === 'taken') {
      return sendError(res, 409, 'conflict', 'submissionKey: already used. Open the form again.');
    }
    res.status(201).json({ id, ok: true });
  };
}

/** Read `{ id }` from a staff request body. */
function readId(body) {
  const id = body && typeof body === 'object' ? body.id : undefined;
  return isValidDocId(id) ? id : null;
}

/**
 * @param {{ db: object, auth: object, getConfig?: () => Promise<object>,
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createUpdateChangeRequestStatusHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function updateChangeRequestStatus(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const id = readId(req.body);
    if (!id) return badRequest(res, 'id: must be a change request id.');
    const status = req.body?.status;
    if (!STATUSES.includes(status)) {
      return badRequest(res, `status: must be one of ${STATUSES.join(', ')}.`);
    }

    const ref = db.collection(COLLECTION).doc(id);
    let found;
    try {
      found = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        const at = new Date(now());
        tx.update(ref, { status, updatedAt: at, updatedBy: gate.email });
        tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
          action: 'updateChangeRequestStatus',
          docPath: `${COLLECTION}/${id}`,
          actor: gate,
          at,
        }));
        return true;
      });
    } catch (err) {
      log.error('updateChangeRequestStatus failed', err);
      return internal(res, 'The status could not be saved. Try again.');
    }
    if (!found) return notFound(res, 'No such change request.');
    res.status(200).json({ id, status });
  };
}

/**
 * @param {{ db: object, auth: object, getConfig?: () => Promise<object>,
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createDeleteChangeRequestHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function deleteChangeRequest(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const id = readId(req.body);
    if (!id) return badRequest(res, 'id: must be a change request id.');

    const ref = db.collection(COLLECTION).doc(id);
    let found;
    try {
      found = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        tx.delete(ref);
        tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
          action: 'deleteChangeRequest',
          docPath: `${COLLECTION}/${id}`,
          actor: gate,
          at: new Date(now()),
        }));
        return true;
      });
    } catch (err) {
      log.error('deleteChangeRequest failed', err);
      return internal(res, 'The request could not be removed. Try again.');
    }
    if (!found) return notFound(res, 'No such change request.');
    res.status(200).json({ id, deleted: true });
  };
}

/**
 * Deployable exports: submitChangeRequest, updateChangeRequestStatus,
 * deleteChangeRequest. firebase-functions and firebase-admin are required
 * lazily here only.
 */
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
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }) };
  };

  const expose = (create) =>
    onRequest({ region }, withCors(async (req, res) => {
      await create(buildDeps())(req, res);
    }));

  return {
    submitChangeRequest: expose(createSubmitChangeRequestHandler),
    updateChangeRequestStatus: expose(createUpdateChangeRequestStatusHandler),
    deleteChangeRequest: expose(createDeleteChangeRequestHandler),
  };
}

module.exports = {
  createSubmitChangeRequestHandler,
  createUpdateChangeRequestStatusHandler,
  createDeleteChangeRequestHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    auditRow,
    rateLimitWindow,
    readSubmission,
    COLLECTION,
    RATE_LIMIT_COLLECTION,
    STATUSES,
    MAX_MESSAGE_LENGTH,
    MAX_PAGE_LENGTH,
    MAX_BODY_BYTES,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
    FLAG_OFF_MESSAGE,
  },
};
