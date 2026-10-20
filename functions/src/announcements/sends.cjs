'use strict';

/**
 * Announcement email endpoints (issues #202, #203, #497). All five are staff tier,
 * the same tier as the website banner on the Announcements page: event
 * staff write to attendees, and an operator is not needed for routine
 * notices. The safety is in the flow, not the tier: a server-side audience,
 * a preview, a receipt the send must match, an explicit confirmation of
 * the count, send-once keys, and an admin_logs row for every send.
 *
 *   listAnnouncementSends     { limit?, cursor? }         → one page of history, audiences, channel state
 *   getAnnouncementSend       { id }                      → one send's frozen content and failures
 *   previewAnnouncementEmail  { draft, audience }         → rendered email, count, sendId, receipt
 *   sendAnnouncementTest      { draft }                   → one copy to the caller's own address
 *   sendAnnouncementEmail     { sendId, receipt, draft, audience } to start,
 *                             { sendId } to continue      → the send record after one chunk
 *
 * BOUNDED CHUNKS, NO QUEUE. A send freezes its recipient list on
 * `announcement_sends/{sendId}` when it starts (at most 5,000 addresses).
 * Each sendAnnouncementEmail call sends the next CHUNK_SIZE recipients as
 * one provider batch and moves the cursor. The composer calls again until
 * the record says `sent`. Nothing runs in the background and nothing else
 * reads the record to do work, so this is not a queue (ticket_sync_queue
 * stays the only one). A call that dies part way leaves its lease to expire;
 * the next call takes the same chunk, and the send-once claims skip every
 * recipient the first call reached, so nobody gets two copies.
 *
 * Per-recipient send-once key: `announcement:{sendId}:{suppression id}`.
 * The same send identity and recipient always give the same key. A
 * deliberate resend is a new send with a new identity.
 *
 * RETRY OF FAILED ADDRESSES. Claims are never released, so a recipient
 * whose message failed is never sent again under the same identity. When
 * the provider failed with a transient status (5xx or 429, after the
 * core's own retries), the recipient goes on the record's
 * `retryRecipients`. Staff can start one new send, with its own preview,
 * receipt and identity, limited to that list (`retryOf`). The earlier
 * record then holds `retriedBy`, so the same failures are not retried
 * twice. A refusal for good (an inactive or invalid address) and an
 * uncertain result are never on the list: the first would fail again,
 * and the second may have been delivered. The email core keeps each failure
 * on its claim, so a chunk replayed after a lost progress write counts the
 * same failures again and still lists the transient ones for a retry.
 *
 * The send record, the lease and the chunk itself live in sendRunner.cjs,
 * so the attendee reminder schedule (ADR 0006) sends the same way. A
 * record the schedule made (`reminder` set) shows in the history, but
 * only the schedule moves it on: a staff "Continue sending" would skip the
 * schedule's quiet hours, its window and its approval, so it is refused.
 *
 * HISTORY AND DETAIL (issue #497). The list is a summary: the subject, the
 * audience, the counts and the actor, never a recipient address or the
 * message. It pages newest first by `createdAt`, with the document id as
 * the tiebreaker, so two sends in one millisecond on a page boundary are
 * neither skipped nor repeated. getAnnouncementSend returns one record's
 * frozen composition (the draft and the rendered bodies, with the inert
 * test link in place of each recipient's own) and its failed addresses,
 * and writes one admin_logs row naming the actor and the record path only,
 * as getSentEmail does. The composition is what the send started from, not
 * proof of the bytes a provider delivered; each recipient's copy is in the
 * email log, filtered by the send id. A record past its 90 days keeps only
 * its unsubscribe key (maintenance/cleanup.cjs) and is in neither.
 */

const crypto = require('node:crypto');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, notFound, methodNotAllowed, internal } = require('../core/errors.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { AUDIENCES, AudienceError, isAudience, listAudiences, resolveAudience } = require('./audience.cjs');
const { readSuppressedIds, suppressionIdFor, testUnsubscribeUrl } = require('./suppression.cjs');
const {
  personalize,
  previewBodies,
  receiptFor,
  renderAnnouncement,
  resolveChannel,
  senderOf,
  unsubscribeNote,
  validateDraft,
  internals: composeInternals,
} = require('./compose.cjs');
const {
  SENDS,
  CHUNK_SIZE,
  LEASE_MS,
  MAX_FAILURES_KEPT,
  EMPTY_COUNTS,
  toMillis,
  tally,
  isTransientFailure,
  startSendRecord,
  takeLease,
  runChunk,
} = require('./sendRunner.cjs');

const HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 50;
/** The first and the last millisecond a Firestore Timestamp can hold. */
const MIN_TIME = -62_135_596_800_000;
const MAX_TIME = 253_402_300_799_999;
const SEND_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const RECEIPT_RE = /^[0-9a-f]{64}$/;
const TEST_SOURCE = 'announcement-test';

/**
 * The history row a browser may see: never a recipient address, the
 * message, the bodies, or the key. The detail endpoint has the rest.
 */
function summarize(id, data, nowMs) {
  const counts = { ...EMPTY_COUNTS, ...(data.counts || {}) };
  const leaseUntil = toMillis(data.lease?.until);
  return {
    id,
    status: data.status,
    audience: data.audience,
    audienceLabel: AUDIENCES[data.audience]?.label || data.audience,
    subject: data.subject,
    mode: data.mode,
    total: data.total,
    processed: data.nextIndex || 0,
    counts,
    // Recipient rows the email log could not record (issue #497).
    auditGaps: Number.isInteger(data.auditGaps) ? data.auditGaps : 0,
    // Whether the email log can list this send's rows by its id. A send
    // recorded before rows carried the id cannot be filtered that way.
    recipientRowsLinked: data.recipientRowsCarrySendId === true,
    createdAt: toMillis(data.createdAt),
    createdBy: data.createdBy?.email || null,
    scheduled: Boolean(data.reminder),
    completedAt: toMillis(data.completedAt),
    busy: leaseUntil !== null && leaseUntil > nowMs,
    retryCount: Array.isArray(data.retryRecipients) ? data.retryRecipients.length : 0,
    retryOf: data.retryOf || null,
    retriedBy: data.retriedBy || null,
  };
}

class RetryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RetryError';
    this.code = code;
  }
}

/**
 * The recipients of a retry: the earlier send's transient failures, less
 * every address that unsubscribed since. Refuses an earlier send that is
 * missing, still sending, has nothing to retry, or was retried already.
 */
async function resolveRetry({ db, retryOf, audience }) {
  if (typeof retryOf !== 'string' || !SEND_ID_RE.test(retryOf)) {
    throw new AudienceError('bad-retry', 'retryOf: must name an earlier send');
  }
  const snap = await db.collection(SENDS).doc(retryOf).get();
  const earlier = snap.exists ? snap.data() : null;
  if (!earlier) throw new RetryError('not-found', 'The earlier send does not exist.');
  if (earlier.audience !== audience) throw new AudienceError('bad-retry', 'audience: must be the audience of the earlier send');
  if (earlier.retriedBy) {
    throw new RetryError('retry-used', 'The failed addresses of this send were already sent again. Retry from that later send instead.');
  }
  if (earlier.status !== 'sent') throw new RetryError('retry-early', 'Finish this send before you retry its failed addresses.');
  const list = (Array.isArray(earlier.retryRecipients) ? earlier.retryRecipients : [])
    .filter((email) => typeof email === 'string')
    .map((email) => ({ uid: null, email }));
  if (list.length === 0) throw new RetryError('nothing-to-retry', 'This send has no failed addresses that can be sent again.');
  const suppressedIds = await readSuppressedIds(db, list.map((r) => suppressionIdFor(r.email)));
  const recipients = list.filter((r) => !suppressedIds.has(suppressionIdFor(r.email)));
  return { recipients, suppressed: list.length - recipients.length, unusable: 0 };
}

/** The audience string a receipt binds: a retry never matches a full send. */
function receiptAudience(audience, retryOf) {
  return retryOf ? `${audience}:retry:${retryOf}` : audience;
}

function gateDeps(deps) {
  return { auth: deps.auth, db: deps.db, getConfig: deps.getConfig };
}

/**
 * @typedef {{ db: FirebaseFirestore.Firestore, auth: object, getConfig: () => Promise<object>,
 *   provider: object, emailCore: { send: Function, sendBatch: Function },
 *   now?: () => number, newId?: () => string, log?: Pick<Console, 'error'|'warn'> }} Deps
 */

/**
 * A history page request: `limit` 1 to 50 (20 by default) and the
 * `{ createdAt, id }` cursor a previous page returned.
 */
function parseHistoryRequest(body) {
  const { limit, cursor } = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const errors = [];
  if (limit !== undefined && limit !== null && !(Number.isInteger(limit) && limit >= 1 && limit <= MAX_HISTORY_LIMIT)) {
    errors.push(`limit: must be a whole number from 1 to ${MAX_HISTORY_LIMIT}`);
  }
  const goodCursor = cursor && typeof cursor === 'object' && !Array.isArray(cursor)
    && Number.isInteger(cursor.createdAt) && cursor.createdAt >= MIN_TIME && cursor.createdAt <= MAX_TIME
    && typeof cursor.id === 'string' && SEND_ID_RE.test(cursor.id);
  if (cursor !== undefined && cursor !== null && !goodCursor) errors.push('cursor: must come from a previous page');
  return {
    errors,
    limit: Number.isInteger(limit) ? limit : HISTORY_LIMIT,
    cursor: goodCursor ? { createdAt: cursor.createdAt, id: cursor.id } : null,
  };
}

/** @param {Deps} deps */
function createListAnnouncementSendsHandler(deps) {
  const { db, getConfig, provider, now = Date.now, log = console } = deps;
  return async function listAnnouncementSends(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin(gateDeps(deps), req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    const request = parseHistoryRequest(req.body);
    if (request.errors.length > 0) return badRequest(res, `Invalid history request: ${request.errors.join('; ')}`);
    try {
      // One extra record says whether an older page exists. The document id
      // breaks ties; the createdAt index serves it with no composite index.
      let query = db.collection(SENDS).orderBy('createdAt', 'desc').orderBy('__name__', 'desc');
      if (request.cursor) query = query.startAfter(new Date(request.cursor.createdAt), request.cursor.id);
      const snap = await query.limit(request.limit + 1).get();
      const docs = snap.docs.slice(0, request.limit);
      const last = docs[docs.length - 1];
      const lastAt = last ? toMillis(last.data()?.createdAt) : null;
      const config = await getConfig();
      const channel = await resolveChannel({ provider, config });
      const policy = await checkDemoWrites({ db });
      const nowMs = now();
      return res.status(200).json({
        sends: docs.map((doc) => summarize(doc.id, doc.data() || {}, nowMs)),
        nextCursor: snap.docs.length > request.limit && lastAt !== null ? { createdAt: lastAt, id: last.id } : null,
        audiences: listAudiences(),
        channel: policy.ok
          ? { canSend: channel.ok, blocker: channel.ok ? null : channel.message, mode: channel.ok ? channel.mode : null }
          : { canSend: false, blocker: policy.message, mode: null },
      });
    } catch (err) {
      log.error('listAnnouncementSends failed', err);
      return internal(res, 'The send history is temporarily unavailable.');
    }
  };
}

/** A record's draft in the composer's field names, for "Use this message". */
function draftOf(data) {
  return {
    subject: typeof data.subject === 'string' ? data.subject : '',
    message: typeof data.message === 'string' ? data.message : '',
    linkUrl: typeof data.link?.url === 'string' ? data.link.url : '',
    linkLabel: typeof data.link?.label === 'string' ? data.link.label : '',
  };
}

/** @param {Deps} deps */
function createGetAnnouncementSendHandler(deps) {
  const { db, getConfig, now = Date.now, log = console } = deps;
  return async function getAnnouncementSend(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin(gateDeps(deps), req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    const id = req.body?.id;
    if (typeof id !== 'string' || !SEND_ID_RE.test(id)) {
      return badRequest(res, 'Invalid request: id: must name a send from the history');
    }
    let data;
    let config;
    try {
      const snap = await db.collection(SENDS).doc(id).get();
      // A record past its retention keeps no start time and no content.
      data = snap.exists && toMillis(snap.data()?.createdAt) !== null ? snap.data() : null;
      if (data) config = await getConfig();
    } catch (err) {
      log.error('getAnnouncementSend read failed', err);
      return internal(res, 'The send history is temporarily unavailable.');
    }
    if (!data) return notFound(res, 'This send is not in the history. The history keeps a send for 90 days.');

    // The row names who read which send, and nothing about the send.
    await logAdminAction({
      db,
      action: 'view-announcement-send',
      docPath: `${SENDS}/${id}`,
      actor: { uid: gate.uid, email: gate.email },
      now,
      log,
    });
    const bodies = previewBodies({
      rendered: { html: typeof data.html === 'string' ? data.html : '', text: typeof data.text === 'string' ? data.text : '' },
      config,
    });
    return res.status(200).json({
      send: {
        ...summarize(id, data, now()),
        draft: draftOf(data),
        renderedSubject: typeof data.renderedSubject === 'string' ? data.renderedSubject : data.subject,
        html: bodies.html,
        text: bodies.text,
        unsubscribeNote: data.mode ? unsubscribeNote(data.mode) : null,
        failures: (Array.isArray(data.failures) ? data.failures : [])
          .map((failure) => ({ email: String(failure?.email ?? ''), error: String(failure?.error ?? '') })),
        failuresKept: MAX_FAILURES_KEPT,
      },
    });
  };
}

/** @param {Deps} deps */
function createPreviewAnnouncementEmailHandler(deps) {
  const { db, getConfig, provider, newId = () => crypto.randomUUID(), log = console } = deps;
  return async function previewAnnouncementEmail(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin(gateDeps(deps), req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    const draft = validateDraft(req.body?.draft);
    const audience = req.body?.audience;
    const errors = [...draft.errors];
    if (!isAudience(audience)) errors.push('audience: must be one of the listed audiences');
    if (errors.length > 0) return badRequest(res, `Invalid announcement: ${errors.join('; ')}`);

    try {
      const config = await getConfig();
      const channel = await resolveChannel({ provider, config });
      const policy = await checkDemoWrites({ db });
      const mode = channel.ok ? channel.mode : 'app';
      const retryOf = req.body?.retryOf ?? null;
      const { recipients, suppressed, unusable } = retryOf
        ? await resolveRetry({ db, retryOf, audience })
        : await resolveAudience({ db, audience });
      const rendered = renderAnnouncement({ config, draft: draft.value, mode });
      const sender = senderOf(config);
      const shown = previewBodies({ rendered, config });
      let blocker = null;
      if (!policy.ok) blocker = policy.message;
      else if (!channel.ok) blocker = channel.message;
      else if (recipients.length === 0) blocker = 'Nobody in this audience can get the email.';
      return res.status(200).json({
        sendId: newId(),
        receipt: channel.ok
          ? receiptFor({ audience: receiptAudience(audience, retryOf), recipients, rendered, sender, channel })
          : null,
        audience,
        retryOf,
        audienceLabel: AUDIENCES[audience].label,
        recipientCount: recipients.length,
        suppressedCount: suppressed,
        unusableCount: unusable,
        subject: rendered.subject,
        html: shown.html,
        text: shown.text,
        from: sender.from,
        replyTo: sender.replyTo,
        stream: channel.ok ? channel.stream : null,
        unsubscribeNote: unsubscribeNote(mode),
        canSend: blocker === null,
        blocker,
      });
    } catch (err) {
      if (err instanceof AudienceError) return badRequest(res, `Invalid announcement: ${err.message}`);
      if (err instanceof RetryError) return sendError(res, 409, err.code, err.message);
      log.error('previewAnnouncementEmail failed', err);
      return internal(res, 'The preview could not be built.');
    }
  };
}

/** @param {Deps} deps */
function createSendAnnouncementTestHandler(deps) {
  const { db, getConfig, provider, emailCore, now = Date.now, log = console } = deps;
  return async function sendAnnouncementTest(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin(gateDeps(deps), req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    const draft = validateDraft(req.body?.draft);
    if (!draft.ok) return badRequest(res, `Invalid announcement: ${draft.errors.join('; ')}`);

    const policy = await checkDemoWrites({ db });
    if (!policy.ok) return sendError(res, policy.status, policy.code, policy.message);
    let result;
    try {
      const config = await getConfig();
      const channel = await resolveChannel({ provider, config });
      if (!channel.ok) return sendError(res, 409, channel.code, channel.message);
      const rendered = renderAnnouncement({ config, draft: draft.value, mode: channel.mode });
      const bodies = personalize(rendered, testUnsubscribeUrl(config));
      result = await emailCore.send({
        to: gate.email,
        subject: `Test: ${rendered.subject}`,
        html: bodies.html,
        text: bodies.text,
        hasLegalFooterHtml: rendered.hasLegalFooterHtml,
        hasLegalFooterText: rendered.hasLegalFooterText,
        tag: 'announcement.email',
        source: TEST_SOURCE,
        messageStream: channel.stream,
      });
    } catch (err) {
      log.error('sendAnnouncementTest failed', err);
      return internal(res, 'The test email could not be sent.');
    }
    await logAdminAction({
      db,
      action: 'sendAnnouncementTest',
      docPath: SENDS,
      actor: { uid: gate.uid, email: gate.email },
      now,
      log,
    });
    if (result.status !== 'sent') {
      return sendError(res, 502, 'send-failed', `The test email was not sent: ${result.error || 'the provider refused it'}.`);
    }
    return res.status(200).json({ sentTo: gate.email });
  };
}

/**
 * Create the send record from a confirmed preview, or refuse. Returns the
 * record's data, or an error to answer with.
 */
async function startSend({ deps, gate, body, sendId, nowMs }) {
  const { db, getConfig, provider, log = console, now = Date.now } = deps;
  const draft = validateDraft(body?.draft);
  const errors = [...draft.errors];
  if (!isAudience(body?.audience)) errors.push('audience: must be one of the listed audiences');
  if (typeof body?.receipt !== 'string' || !RECEIPT_RE.test(body.receipt)) errors.push('receipt: must come from a preview');
  if (errors.length > 0) return { error: [400, 'bad-request', `Invalid announcement: ${errors.join('; ')}`] };

  const config = await getConfig();
  const channel = await resolveChannel({ provider, config });
  if (!channel.ok) return { error: [409, channel.code, channel.message] };
  const retryOf = body.retryOf ?? null;
  let audience;
  try {
    audience = retryOf
      ? await resolveRetry({ db, retryOf, audience: body.audience })
      : await resolveAudience({ db, audience: body.audience });
  } catch (err) {
    if (err instanceof AudienceError) return { error: [400, 'bad-request', `Invalid announcement: ${err.message}`] };
    if (err instanceof RetryError) return { error: [409, err.code, err.message] };
    throw err;
  }
  const rendered = renderAnnouncement({ config, draft: draft.value, mode: channel.mode });
  const sender = senderOf(config);
  const receipt = receiptFor({
    audience: receiptAudience(body.audience, retryOf), recipients: audience.recipients, rendered, sender, channel,
  });
  if (receipt !== body.receipt) {
    return { error: [409, 'preview-stale', 'The audience or the email changed after the preview. Preview the email again.'] };
  }
  if (audience.recipients.length === 0) {
    return { error: [409, 'no-recipients', 'Nobody in this audience can get the email.'] };
  }

  const started = await startSendRecord({
    db,
    sendId,
    nowMs,
    audience: body.audience,
    draft: draft.value,
    rendered,
    channel,
    receipt,
    recipients: audience.recipients,
    retryOf,
    createdBy: { uid: gate.uid, email: gate.email },
  });
  if (!started.record) return started;
  const { record } = started;
  await logAdminAction({
    db,
    action: 'startAnnouncementEmail',
    docPath: `${SENDS}/${sendId}`,
    actor: { uid: gate.uid, email: gate.email },
    details: { audience: body.audience, total: record.total, mode: channel.mode, ...(retryOf ? { retryOf } : {}) },
    now,
    log,
  });
  return { record };
}

/** @param {Deps} deps */
function createSendAnnouncementEmailHandler(deps) {
  const { db, getConfig, provider, emailCore, now = Date.now, log = console } = deps;
  return async function sendAnnouncementEmail(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin(gateDeps(deps), req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    const sendId = req.body?.sendId;
    if (typeof sendId !== 'string' || !SEND_ID_RE.test(sendId)) {
      return badRequest(res, 'Invalid announcement: sendId: must come from a preview');
    }
    // The historical demo refuses before any record, claim, or request.
    const policy = await checkDemoWrites({ db });
    if (!policy.ok) return sendError(res, policy.status, policy.code, policy.message);

    const ref = db.collection(SENDS).doc(sendId);
    let lease;
    try {
      const existing = await ref.get();
      if (!existing.exists) {
        const started = await startSend({ deps, gate, body: req.body, sendId, nowMs: now() });
        if (started.error) return sendError(res, ...started.error);
      } else if (existing.data()?.reminder) {
        return sendError(res, 409, 'scheduled-send', 'Scheduled attendee reminders send this email. Only the schedule continues it.');
      } else if (req.body?.receipt !== undefined && req.body.receipt !== existing.data()?.receipt) {
        // A second confirmation under the same identity must be the same send.
        return sendError(res, 409, 'send-conflict', 'This send already exists with different content. Preview the email again.');
      }
      lease = await takeLease({ db, sendId, nowMs: now() });
    } catch (err) {
      log.error('sendAnnouncementEmail start failed', err);
      return internal(res, 'The send could not start.');
    }
    if (lease.missing) return sendError(res, 404, 'not-found', 'This send does not exist.');
    if (lease.done || lease.busy) return res.status(200).json({ send: summarize(sendId, lease.data, now()) });

    const finished = await runChunk({ db, sendId, lease, getConfig, provider, emailCore, now, log });
    if (finished.error) return sendError(res, ...finished.error);
    if (!finished.stale && finished.done) {
      await logAdminAction({
        db,
        action: 'completeAnnouncementEmail',
        docPath: `${SENDS}/${sendId}`,
        actor: { uid: gate.uid, email: gate.email },
        details: { counts: finished.data.counts, total: finished.data.total },
        now,
        log,
      });
    }
    return res.status(200).json({ send: summarize(sendId, finished.data, now()) });
  };
}

/** Deployable exports (spec §1.3). */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const { SEND_SECRETS_BY_PROVIDER } = require('../email/send.cjs').internals;
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const providerName = (process.env.EVENT_EMAIL_PROVIDER || '').trim();
  const secrets = (SEND_SECRETS_BY_PROVIDER[providerName] || []).map(defineSecret);

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const { getEmailProvider } = require('../email/providers/index.cjs');
    const { createEmailCore } = require('../email/send.cjs');
    const db = getDb();
    const getConfig = () => getEventConfig({ db });
    const provider = getEmailProvider({ env: process.env });
    return { db, auth: getAuth(), getConfig, provider, emailCore: createEmailCore({ db, provider, getConfig }) };
  };
  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS) })) return;
    await handler(req, res);
  };
  const expose = (create, options = {}) => onRequest(
    { region, secrets, ...options },
    withCors(async (req, res) => create(buildDeps())(req, res)),
  );

  return {
    listAnnouncementSends: expose(createListAnnouncementSendsHandler),
    getAnnouncementSend: expose(createGetAnnouncementSendHandler),
    previewAnnouncementEmail: expose(createPreviewAnnouncementEmailHandler),
    sendAnnouncementTest: expose(createSendAnnouncementTestHandler),
    // One chunk per call; the lease outlasts this timeout.
    sendAnnouncementEmail: expose(createSendAnnouncementEmailHandler, { timeoutSeconds: 300 }),
  };
}

module.exports = {
  createListAnnouncementSendsHandler,
  createGetAnnouncementSendHandler,
  createPreviewAnnouncementEmailHandler,
  createSendAnnouncementTestHandler,
  createSendAnnouncementEmailHandler,
  get handlers() { return buildHandlers(); },
  internals: {
    SENDS,
    CHUNK_SIZE,
    LEASE_MS,
    MAX_FAILURES_KEPT,
    HISTORY_LIMIT,
    MAX_HISTORY_LIMIT,
    UNSUBSCRIBE_SLOT: composeInternals.UNSUBSCRIBE_SLOT,
    summarize,
    tally,
    isTransientFailure,
    parseHistoryRequest,
  },
};
