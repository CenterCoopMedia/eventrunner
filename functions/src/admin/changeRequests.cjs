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
 *   saveChangeRequestOutcome  POST { id, reply?, resultUrl?, resultChecked? }
 *                             — staff tier. The reply and the checked
 *                             result link of a done or declined request.
 *   deleteChangeRequest       POST { id } — staff tier. Removes the request
 *                             and its text outright.
 *   listMyChangeRequests      POST {} — any signed-in account with a
 *                             verified email. The caller's own requests,
 *                             in the requester-safe shape (issue #330).
 *
 * `change_requests` is admin-readable (the admin page lists it through a
 * listener) and never client-written: these handlers and the notice
 * delivery in changeRequestNotices.cjs are its only writers.
 * `change_request_rate_limits/{uid}` is server-only.
 *
 * PROGRESS FOR THE REQUESTER (issue #330). A requester cannot read
 * `change_requests`: the document holds their address and uid, the address
 * of the staff member who last changed it, the delivery records of its
 * emails, and who checked a result link. listMyChangeRequests reads the
 * caller's own documents with the Admin SDK and answers only the fields in
 * `requesterView`: the text and page they sent, the status, the `history`
 * of statuses with their times (never who set them), and, while the
 * request is done or declined, the `outcome` with the staff reply and the
 * result link written for the requester. Nothing else leaves the server.
 * The read is not gated by the flag: a requester can still see what they
 * sent after an operator turns change requests off.
 *
 * THE OUTCOME is recorded by staff, never by a deploy or any other process:
 * marking a request done or declined stores `outcome`, and
 * saveChangeRequestOutcome adds an optional reply and an optional result
 * link. A result link must be on this site's own origin
 * (`config.tierA.publicUrl`, compared exactly after parsing) and needs the
 * staff member to confirm that they opened it and saw the change. The
 * request text is never an instruction to anything: no handler reads it to
 * decide what to do.
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
 * a sender cannot be forged. The token is verified WITH the revocation
 * check, which asks Firebase Auth for the account: an ID token outlives its
 * sign-in by up to an hour, and an account delete (users/records.cjs)
 * removes the account's change requests, so a deleted account's open
 * session must not store a new one. The revocation check cannot see a delete
 * that lands after it, so the store transaction also reads `users/{uid}`:
 * the delete removes that document in one transaction BEFORE it sweeps
 * change_requests, so a store that commits first is swept, and a store that
 * reads after it is refused. A bootstrap admin needs no account document,
 * because an account delete refuses an admin.
 *
 * EMAIL. With the operator's settings on, a stored request gets an
 * acknowledgement, and a request marked done or declined gets an outcome
 * email, through changeRequestNotices.cjs. Both are off by default. An email
 * holds no request text; it links to the requester's own page.
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
 * as submitFeedback. A retry that finds its own stored request with the
 * same message and page writes nothing and answers as the first call did.
 * A key is bound to the text first stored under it: a retry that changed
 * the text is 409, never a 201 for text that was not stored. The client
 * takes a new key when the text changes.
 */

const crypto = require('node:crypto');
const { requireAdmin, resolveAdminTier, internals: { extractBearerToken } } = require('../core/auth.cjs');
const {
  sendError, badRequest, notFound, methodNotAllowed, internal,
} = require('../core/errors.cjs');
const { isValidDocId } = require('../cms/store.cjs');
const { queueAcknowledgement, queueOutcome, deliverNotice } = require('./changeRequestNotices.cjs');

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
const OUTCOME_STATUSES = Object.freeze(['done', 'declined']);
/** The newest status changes kept on a request for its requester. */
const HISTORY_LIMIT = 50;
const MAX_REPLY_LENGTH = 1000;
const MAX_RESULT_URL_LENGTH = 2048;
/** The newest requests listMyChangeRequests answers. */
const MY_REQUESTS_LIMIT = 50;
// The same shape submitFeedback accepts: a client-generated token that is
// safe as a bare document id, never caller-chosen free text.
const SUBMISSION_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

const FLAG_OFF_MESSAGE = 'Change requests are not enabled for this event.';
const ACCOUNT_GONE_MESSAGE = 'Your account was not found. Sign in again to send a change request.';
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
 * The refusal a reader sees when the window is full, with the wait in whole
 * minutes, rounded up so it never promises a slot too early.
 *
 * @param {number} retryAfterMs
 * @returns {string}
 */
function rateLimitMessage(retryAfterMs) {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000));
  return `Too many change requests. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
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
 * The sender's decoded ID token, checked against Firebase Auth so a
 * deleted, disabled, or revoked sign-in is refused; null for no token or a
 * token that does not pass. Never throws.
 *
 * @param {{ auth: { verifyIdToken: (t: string, checkRevoked?: boolean) => Promise<object> } }} deps
 * @param {object} req
 * @returns {Promise<object|null>}
 */
async function verifySender({ auth }, req) {
  const token = extractBearerToken(req);
  if (!token) return null;
  try {
    return await auth.verifyIdToken(token, true);
  } catch {
    return null;
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

/** A stored time as a Date, or null. */
function dateOf(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value.toDate === 'function') return value.toDate();
  return null;
}

function isoOf(value) {
  return dateOf(value)?.toISOString() ?? null;
}

/**
 * The status history of a stored request. A request stored before issue
 * #330 has none, so one is rebuilt from its own times: received at
 * createdAt, and its current status at updatedAt.
 *
 * @returns {Array<{ status: string, at: Date }>}
 */
function historyOf(stored) {
  if (Array.isArray(stored?.history)) {
    return stored.history
      .filter((entry) => STATUSES.includes(entry?.status) && dateOf(entry?.at))
      .map((entry) => ({ status: entry.status, at: dateOf(entry.at) }));
  }
  const rebuilt = [];
  const created = dateOf(stored?.createdAt);
  if (created) rebuilt.push({ status: 'new', at: created });
  const updated = dateOf(stored?.updatedAt);
  if (stored?.status && stored.status !== 'new' && STATUSES.includes(stored.status) && updated) {
    rebuilt.push({ status: stored.status, at: updated });
  }
  return rebuilt;
}

/** An outcome with no reply and no result link yet. */
function freshOutcome(status, at, by) {
  return {
    status,
    reply: null,
    resultUrl: null,
    resultCheckedBy: null,
    resultCheckedAt: null,
    recordedAt: at,
    recordedBy: by ?? null,
  };
}

/**
 * One request as its requester may read it. Every field is listed here, so
 * a field added to the stored document later stays private until someone
 * adds it on purpose.
 */
function requesterView(id, data) {
  const status = STATUSES.includes(data?.status) ? data.status : 'new';
  const stored = data?.outcome;
  const outcome = OUTCOME_STATUSES.includes(status) && stored?.status === status
    ? {
      status,
      reply: typeof stored.reply === 'string' && stored.reply ? stored.reply : null,
      resultUrl: status === 'done' && typeof stored.resultUrl === 'string' && stored.resultUrl ? stored.resultUrl : null,
      recordedAt: isoOf(stored.recordedAt),
    }
    : null;
  return {
    id,
    message: typeof data?.message === 'string' ? data.message : '',
    page: typeof data?.page === 'string' && data.page ? data.page : null,
    status,
    createdAt: isoOf(data?.createdAt),
    history: historyOf(data).map((entry) => ({ status: entry.status, at: entry.at.toISOString() })),
    outcome,
  };
}

/**
 * A result link staff checked, or a refusal. Only an http(s) address on
 * this site's own origin passes: both are parsed, and the origins are
 * compared exactly, so a look-alike host, a credential, another port or a
 * relative address is refused.
 *
 * @param {unknown} value
 * @param {string} publicUrl config.tierA.publicUrl
 * @returns {{ ok: true, href: string } | { ok: false, message: string }}
 */
function readResultUrl(value, publicUrl) {
  if (typeof value !== 'string' || !value.trim()) return { ok: false, message: 'resultUrl: must be a web address.' };
  const raw = value.trim();
  if (raw.length > MAX_RESULT_URL_LENGTH) {
    return { ok: false, message: `resultUrl: at most ${MAX_RESULT_URL_LENGTH} characters.` };
  }
  let site;
  try {
    site = new URL(String(publicUrl ?? '').trim());
  } catch {
    return { ok: false, message: 'resultUrl: this site has no public address set, so a result link cannot be checked.' };
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: 'resultUrl: must be a full address on this site, such as a page link copied from the browser.' };
  }
  if ((site.protocol !== 'https:' && site.protocol !== 'http:') || url.username || url.password || url.origin !== site.origin) {
    return { ok: false, message: `resultUrl: must be an address on this site (${site.origin}).` };
  }
  return { ok: true, href: url.href };
}

/**
 * Store one request, its rate-limit slot, and its audit row together.
 *
 * @returns {Promise<{ outcome: 'stored'|'replayed' } |
 *                   { outcome: 'limited', retryAfterMs: number } |
 *                   { outcome: 'taken'|'changed'|'account-gone' }>}
 */
async function storeRequest({ db, id, actor, message, page, nowMs }) {
  const ref = db.collection(COLLECTION).doc(id);
  const limitRef = db.collection(RATE_LIMIT_COLLECTION).doc(actor.uid);
  const accountRef = db.collection('users').doc(actor.uid);
  const bootstrapRef = db.collection('config').doc('bootstrap');
  return db.runTransaction(async (tx) => {
    // Every read first, as Firestore requires. The account read is what
    // orders this store against an account delete (see the header).
    const [snap, limitSnap, accountSnap] = await Promise.all([tx.get(ref), tx.get(limitRef), tx.get(accountRef)]);
    if (!accountSnap.exists) {
      const bootstrapSnap = await tx.get(bootstrapRef);
      const bootstrap = bootstrapSnap.exists ? bootstrapSnap.data() : null;
      if (resolveAdminTier(bootstrap, actor.email) === null) return { outcome: 'account-gone' };
    }
    if (snap.exists) {
      // A retry of a request this account already stored writes nothing. A
      // key another account holds is not this caller's request, and a key
      // under which other text is stored is not this text's.
      const stored = snap.data() || {};
      if (stored.uid !== actor.uid) return { outcome: 'taken' };
      return stored.message === message && (stored.page ?? null) === page
        ? { outcome: 'replayed' }
        : { outcome: 'changed' };
    }
    const recent = rateLimitWindow(limitSnap.exists ? limitSnap.data()?.requests : null, nowMs);
    if (recent.limited) return { outcome: 'limited', retryAfterMs: recent.retryAfterMs };

    const at = new Date(nowMs);
    // The last read, before the first write: the acknowledgement settings
    // and the demo policy (changeRequestNotices.cjs).
    const acknowledgement = await queueAcknowledgement({ db, tx, id, at });
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
      history: [{ status: 'new', at }],
      outcome: null,
      ...(acknowledgement ? { notices: { received: acknowledgement } } : {}),
    });
    tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
      action: 'submitChangeRequest',
      docPath: `${COLLECTION}/${id}`,
      actor,
      at,
    }));
    return { outcome: 'stored', acknowledgement };
  });
}

/**
 * @param {{ db: object, auth: { verifyIdToken: (t: string) => Promise<object> },
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createSubmitChangeRequestHandler({ db, auth, getConfig, sendEmail, now = Date.now, log = console }) {
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

    const decoded = await verifySender({ auth }, req);
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
        error: { code: 'rate-limited', message: rateLimitMessage(result.retryAfterMs), retryAfterSeconds },
      });
      return;
    }
    if (result.outcome === 'account-gone') return sendError(res, 403, 'forbidden', ACCOUNT_GONE_MESSAGE);
    if (result.outcome === 'taken' || result.outcome === 'changed') {
      return sendError(res, 409, 'conflict', 'submissionKey: already used. Open the form again.');
    }
    // The request is durable before the acknowledgement goes. A replay
    // finds it stored and sends nothing; a failed send only marks the
    // record for staff to retry (deliverNotice never throws).
    if (result.outcome === 'stored' && result.acknowledgement) {
      await deliverNotice({
        db, sendEmail, getConfig, now, log, id, slot: 'received', record: result.acknowledgement, to: email,
      });
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
function createUpdateChangeRequestStatusHandler({ db, auth, getConfig, sendEmail, now = Date.now, log = console }) {
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
    let result;
    try {
      result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const stored = snap.data() || {};
        const at = new Date(now());
        // The last read, before the first write: the outcome settings, the
        // demo policy, and whether this outcome already has an email.
        const queued = await queueOutcome({ db, tx, id, stored, status, at });
        const changed = stored.status !== status;
        const history = changed
          ? [...historyOf(stored), { status, at }].slice(-HISTORY_LIMIT)
          : historyOf(stored);
        let outcome = null;
        if (OUTCOME_STATUSES.includes(status)) {
          // The same outcome again keeps its reply and link; a new one starts empty.
          outcome = !changed && stored.outcome?.status === status ? stored.outcome : freshOutcome(status, at, gate.email);
        }
        tx.update(ref, {
          status,
          updatedAt: at,
          updatedBy: gate.email,
          history,
          outcome,
          ...(queued ? { notices: { ...stored.notices, [queued.slot]: queued.record } } : {}),
        });
        tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
          action: 'updateChangeRequestStatus',
          docPath: `${COLLECTION}/${id}`,
          actor: gate,
          at,
        }));
        return { queued, to: stored.email };
      });
    } catch (err) {
      log.error('updateChangeRequestStatus failed', err);
      return internal(res, 'The status could not be saved. Try again.');
    }
    if (!result) return notFound(res, 'No such change request.');
    // The status is saved before the email goes; a failed send is stated,
    // and staff can retry it from the request.
    let notice = null;
    if (result.queued) {
      const delivered = await deliverNotice({
        db, sendEmail, getConfig, now, log, id, slot: result.queued.slot, record: result.queued.record, to: result.to,
      });
      notice = { slot: result.queued.slot, state: delivered.state };
    }
    res.status(200).json({ id, status, notice });
  };
}

/** Read the reply staff write for the requester: text, or null for none. */
function readReply(value) {
  if (value === undefined || value === null) return { ok: true, reply: null };
  if (typeof value !== 'string') return { ok: false, message: 'reply: must be text.' };
  const reply = value.replace(/\r\n?/g, '\n').trim();
  if (reply.length > MAX_REPLY_LENGTH) return { ok: false, message: `reply: at most ${MAX_REPLY_LENGTH} characters.` };
  return { ok: true, reply: reply || null };
}

/**
 * @param {{ db: object, auth: object, getConfig: () => Promise<object>,
 *           now?: () => number, log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createSaveChangeRequestOutcomeHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function saveChangeRequestOutcome(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    if (bodyBytes(req.body) > MAX_BODY_BYTES) return sendError(res, 413, 'payload-too-large', 'The request is too large.');

    const id = readId(req.body);
    if (!id) return badRequest(res, 'id: must be a change request id.');
    const reply = readReply(req.body?.reply);
    if (!reply.ok) return badRequest(res, reply.message);
    const rawUrl = req.body?.resultUrl;
    const wantsUrl = rawUrl !== undefined && rawUrl !== null && rawUrl !== '';
    const checked = req.body?.resultChecked;
    if (checked !== undefined && typeof checked !== 'boolean') return badRequest(res, 'resultChecked: must be true or false.');

    let resultUrl = null;
    if (wantsUrl) {
      let config;
      try {
        config = await getConfig();
      } catch (err) {
        log.error('saveChangeRequestOutcome: the config could not be read', err);
        return internal(res, 'The outcome could not be saved. Try again.');
      }
      const parsed = readResultUrl(rawUrl, config?.tierA?.publicUrl);
      if (!parsed.ok) return badRequest(res, parsed.message);
      resultUrl = parsed.href;
    }

    const ref = db.collection(COLLECTION).doc(id);
    let result;
    try {
      result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { status: 404 };
        const stored = snap.data() || {};
        if (!OUTCOME_STATUSES.includes(stored.status)) return { status: 409 };
        if (resultUrl && stored.status !== 'done') return { status: 400, message: 'resultUrl: only a done request has a result link.' };
        const base = stored.outcome?.status === stored.status
          ? stored.outcome
          : freshOutcome(stored.status, dateOf(stored.updatedAt) ?? new Date(now()), stored.updatedBy);
        const at = new Date(now());
        // A link that was already checked stays checked; a new one needs the
        // staff member to say they opened it and saw the change.
        const sameLink = Boolean(resultUrl) && resultUrl === base.resultUrl;
        if (resultUrl && !sameLink && checked !== true) {
          return { status: 400, message: 'resultChecked: open the link and confirm that it shows the change before you save it.' };
        }
        tx.update(ref, {
          outcome: {
            ...base,
            reply: reply.reply,
            resultUrl,
            resultCheckedBy: resultUrl ? (sameLink ? base.resultCheckedBy : gate.email) : null,
            resultCheckedAt: resultUrl ? (sameLink ? base.resultCheckedAt : at) : null,
          },
        });
        tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
          action: 'saveChangeRequestOutcome',
          docPath: `${COLLECTION}/${id}`,
          actor: gate,
          at,
        }));
        return { status: 200 };
      });
    } catch (err) {
      log.error('saveChangeRequestOutcome failed', err);
      return internal(res, 'The outcome could not be saved. Try again.');
    }
    if (result.status === 404) return notFound(res, 'No such change request.');
    if (result.status === 409) {
      return sendError(res, 409, 'conflict', 'Mark the request done or declined first. Only a request with an outcome has a reply.');
    }
    if (result.status === 400) return badRequest(res, result.message);
    res.status(200).json({ id, saved: true });
  };
}

/**
 * The caller's own requests, newest first, in the requester-safe shape.
 *
 * @param {{ db: object, auth: { verifyIdToken: (t: string, checkRevoked?: boolean) => Promise<object> },
 *           log?: Pick<Console, 'warn'|'error'> }} deps
 */
function createListMyChangeRequestsHandler({ db, auth, log = console }) {
  return async function listMyChangeRequests(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const decoded = await verifySender({ auth }, req);
    if (!decoded?.uid) return sendError(res, 401, 'unauthorized', 'Sign in to see your change requests.');
    if (decoded.email_verified !== true) {
      return sendError(res, 403, 'forbidden', 'Sign in with a verified email address to see your change requests.');
    }
    let snap;
    try {
      snap = await db.collection(COLLECTION)
        .where('uid', '==', decoded.uid)
        .orderBy('createdAt', 'desc')
        .limit(MY_REQUESTS_LIMIT)
        .get();
    } catch (err) {
      log.error('listMyChangeRequests failed', err);
      return internal(res, 'Your change requests could not be loaded. Try again.');
    }
    res.status(200).json({ requests: snap.docs.map((doc) => requesterView(doc.id, doc.data())) });
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
 * saveChangeRequestOutcome, deleteChangeRequest, listMyChangeRequests, and
 * from changeRequestNotices.cjs saveChangeRequestNoticeSettings and
 * retryChangeRequestNotice. firebase-functions and firebase-admin are
 * required lazily here only.
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

  const expose = (create, options = {}) =>
    onRequest({ region, ...options }, withCors(async (req, res) => {
      await create(buildDeps())(req, res);
    }));

  const {
    createSaveChangeRequestNoticeSettingsHandler,
    createRetryChangeRequestNoticeHandler,
  } = require('./changeRequestNotices.cjs');

  return {
    submitChangeRequest: expose(createSubmitChangeRequestHandler, { secrets }),
    updateChangeRequestStatus: expose(createUpdateChangeRequestStatusHandler, { secrets }),
    saveChangeRequestOutcome: expose(createSaveChangeRequestOutcomeHandler),
    deleteChangeRequest: expose(createDeleteChangeRequestHandler),
    listMyChangeRequests: expose(createListMyChangeRequestsHandler),
    saveChangeRequestNoticeSettings: expose(createSaveChangeRequestNoticeSettingsHandler),
    retryChangeRequestNotice: expose(createRetryChangeRequestNoticeHandler, { secrets }),
  };
}

module.exports = {
  createSubmitChangeRequestHandler,
  createUpdateChangeRequestStatusHandler,
  createSaveChangeRequestOutcomeHandler,
  createDeleteChangeRequestHandler,
  createListMyChangeRequestsHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    auditRow,
    rateLimitWindow,
    rateLimitMessage,
    readSubmission,
    readResultUrl,
    requesterView,
    historyOf,
    COLLECTION,
    RATE_LIMIT_COLLECTION,
    STATUSES,
    MAX_MESSAGE_LENGTH,
    MAX_PAGE_LENGTH,
    MAX_BODY_BYTES,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
    FLAG_OFF_MESSAGE,
    HISTORY_LIMIT,
    MAX_REPLY_LENGTH,
    MAX_RESULT_URL_LENGTH,
    MY_REQUESTS_LIMIT,
  },
};
