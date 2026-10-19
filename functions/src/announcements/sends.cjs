'use strict';

/**
 * Announcement email endpoints (issues #202, #203). All four are staff tier,
 * the same tier as the website banner on the Announcements page: event
 * staff write to attendees, and an operator is not needed for routine
 * notices. The safety is in the flow, not the tier: a server-side audience,
 * a preview, a receipt the send must match, an explicit confirmation of
 * the count, send-once keys, and an admin_logs row for every send.
 *
 *   listAnnouncementSends     {}                          → history, audiences, channel state
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
 */

const crypto = require('node:crypto');
const { requireAdmin } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const { logAdminAction } = require('../cms/store.cjs');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { EmailBatchError } = require('../email/send.cjs');
const { AUDIENCES, AudienceError, isAudience, listAudiences, resolveAudience } = require('./audience.cjs');
const {
  newUnsubscribeKey,
  readSuppressedIds,
  suppressionIdFor,
  testUnsubscribeUrl,
  unsubscribeUrlFor,
} = require('./suppression.cjs');
const {
  auditRedactFor,
  personalize,
  previewBodies,
  receiptFor,
  renderAnnouncement,
  resolveChannel,
  senderOf,
  unsubscribeHeaders,
  unsubscribeNote,
  validateDraft,
} = require('./compose.cjs');

const SENDS = 'announcement_sends';
const CHUNK_SIZE = 200;
const LEASE_MS = 6 * 60 * 1000;
const MAX_FAILURES_KEPT = 50;
const HISTORY_LIMIT = 20;
const SEND_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const RECEIPT_RE = /^[0-9a-f]{64}$/;
const SOURCE = 'announcement';
const TEST_SOURCE = 'announcement-test';

const EMPTY_COUNTS = Object.freeze({ sent: 0, failed: 0, uncertain: 0, skipped: 0, suppressed: 0 });

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  return null;
}

/** The history row a browser may see: never the recipient list, the bodies, or the key. */
function summarize(id, data, nowMs) {
  const counts = { ...EMPTY_COUNTS, ...(data.counts || {}) };
  const leaseUntil = toMillis(data.lease?.until);
  return {
    id,
    status: data.status,
    audience: data.audience,
    audienceLabel: AUDIENCES[data.audience]?.label || data.audience,
    subject: data.subject,
    message: data.message,
    link: data.link || null,
    mode: data.mode,
    total: data.total,
    processed: data.nextIndex || 0,
    counts,
    failures: Array.isArray(data.failures) ? data.failures : [],
    createdAt: toMillis(data.createdAt),
    createdBy: data.createdBy?.email || null,
    completedAt: toMillis(data.completedAt),
    busy: leaseUntil !== null && leaseUntil > nowMs,
  };
}

/** Map a result from sendBatch onto the record's counters. */
function tally(result) {
  if (result.skipped) return 'skipped';
  if (result.status === 'sent') return 'sent';
  if (result.uncertain) return 'uncertain';
  return 'failed';
}

function gateDeps(deps) {
  return { auth: deps.auth, db: deps.db, getConfig: deps.getConfig };
}

/**
 * @typedef {{ db: FirebaseFirestore.Firestore, auth: object, getConfig: () => Promise<object>,
 *   provider: object, emailCore: { send: Function, sendBatch: Function },
 *   now?: () => number, newId?: () => string, log?: Pick<Console, 'error'|'warn'> }} Deps
 */

/** @param {Deps} deps */
function createListAnnouncementSendsHandler(deps) {
  const { db, getConfig, provider, now = Date.now, log = console } = deps;
  return async function listAnnouncementSends(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin(gateDeps(deps), req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    try {
      const snap = await db.collection(SENDS).orderBy('createdAt', 'desc').limit(HISTORY_LIMIT).get();
      const config = await getConfig();
      const channel = await resolveChannel({ provider, config });
      const policy = await checkDemoWrites({ db });
      const nowMs = now();
      return res.status(200).json({
        sends: snap.docs.map((doc) => summarize(doc.id, doc.data() || {}, nowMs)),
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
      const { recipients, suppressed, unusable } = await resolveAudience({ db, audience });
      const rendered = renderAnnouncement({ config, draft: draft.value, mode });
      const sender = senderOf(config);
      const shown = previewBodies({ rendered, config });
      let blocker = null;
      if (!policy.ok) blocker = policy.message;
      else if (!channel.ok) blocker = channel.message;
      else if (recipients.length === 0) blocker = 'Nobody in this audience can get the email.';
      return res.status(200).json({
        sendId: newId(),
        receipt: channel.ok ? receiptFor({ audience, recipients, rendered, sender, channel }) : null,
        audience,
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
  let audience;
  try {
    audience = await resolveAudience({ db, audience: body.audience });
  } catch (err) {
    if (err instanceof AudienceError) return { error: [400, 'bad-request', `Invalid announcement: ${err.message}`] };
    throw err;
  }
  const rendered = renderAnnouncement({ config, draft: draft.value, mode: channel.mode });
  const sender = senderOf(config);
  const receipt = receiptFor({ audience: body.audience, recipients: audience.recipients, rendered, sender, channel });
  if (receipt !== body.receipt) {
    return { error: [409, 'preview-stale', 'The audience or the email changed after the preview. Preview the email again.'] };
  }
  if (audience.recipients.length === 0) {
    return { error: [409, 'no-recipients', 'Nobody in this audience can get the email.'] };
  }

  const record = {
    status: 'sending',
    audience: body.audience,
    subject: draft.value.subject,
    message: draft.value.message,
    link: draft.value.link,
    renderedSubject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    hasLegalFooterHtml: rendered.hasLegalFooterHtml,
    hasLegalFooterText: rendered.hasLegalFooterText,
    stream: channel.stream,
    mode: channel.mode,
    receipt,
    recipients: audience.recipients,
    total: audience.recipients.length,
    nextIndex: 0,
    counts: { ...EMPTY_COUNTS, suppressed: 0 },
    failures: [],
    unsubscribeKey: newUnsubscribeKey(),
    lease: null,
    createdAt: new Date(nowMs),
    updatedAt: new Date(nowMs),
    completedAt: null,
    createdBy: { uid: gate.uid, email: gate.email },
  };
  try {
    await db.collection(SENDS).doc(sendId).create(record);
  } catch (err) {
    if (err?.code === 6 || err?.code === 'already-exists' || /ALREADY_EXISTS/i.test(String(err?.message || ''))) {
      return { existing: true };
    }
    throw err;
  }
  await logAdminAction({
    db,
    action: 'startAnnouncementEmail',
    docPath: `${SENDS}/${sendId}`,
    actor: { uid: gate.uid, email: gate.email },
    details: { audience: body.audience, total: record.total, mode: channel.mode },
    now,
    log,
  });
  return { record };
}

/** Take the chunk lease, or report why not. */
async function takeLease({ db, sendId, nowMs }) {
  const ref = db.collection(SENDS).doc(sendId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { missing: true };
    const data = snap.data();
    if (data.status !== 'sending') return { done: true, data };
    const until = toMillis(data.lease?.until);
    if (until !== null && until > nowMs) return { busy: true, data };
    const token = crypto.randomUUID();
    const start = data.nextIndex || 0;
    tx.update(ref, { lease: { token, until: new Date(nowMs + LEASE_MS) }, updatedAt: new Date(nowMs) });
    return { token, start, data };
  });
}

async function releaseLease({ db, sendId, token }) {
  const ref = db.collection(SENDS).doc(sendId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data()?.lease?.token === token) tx.update(ref, { lease: null });
  });
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

    const { token, start, data } = lease;
    const chunk = data.recipients.slice(start, start + CHUNK_SIZE);
    const delta = { ...EMPTY_COUNTS };
    const failures = [];
    try {
      const config = await getConfig();
      // The stream is checked again before every chunk's claims (issue #490).
      const channel = await resolveChannel({ provider, config });
      if (!channel.ok || channel.stream !== data.stream || channel.mode !== data.mode) {
        await releaseLease({ db, sendId, token });
        const message = channel.ok
          ? 'The announcement stream or its unsubscribe handling changed after this send started. Restore it, then continue the send.'
          : channel.message;
        return sendError(res, 409, channel.ok ? 'channel-changed' : channel.code, message);
      }
      // An opt-out recorded after the send started still holds.
      const suppressed = await readSuppressedIds(db, chunk.map((r) => suppressionIdFor(r.email)));
      const targets = chunk.filter((r) => !suppressed.has(suppressionIdFor(r.email)));
      delta.suppressed = chunk.length - targets.length;
      const messages = targets.map((recipient) => {
        const url = data.mode === 'app'
          ? unsubscribeUrlFor({ config, sendId, key: data.unsubscribeKey, email: recipient.email })
          : null;
        const bodies = personalize({ html: data.html, text: data.text }, url);
        return {
          to: recipient.email,
          subject: data.renderedSubject,
          html: bodies.html,
          text: bodies.text,
          hasLegalFooterHtml: data.hasLegalFooterHtml,
          hasLegalFooterText: data.hasLegalFooterText,
          ...(url ? { headers: unsubscribeHeaders(url) } : {}),
          // The email log keeps the inert link: the live one would let anyone
          // who reads the log unsubscribe this recipient.
          ...(url ? { auditRedact: auditRedactFor(url, testUnsubscribeUrl(config)) } : {}),
          tag: 'announcement.email',
          source: SOURCE,
          messageStream: data.stream,
          onceKey: `announcement:${sendId}:${suppressionIdFor(recipient.email)}`,
        };
      });
      const results = messages.length > 0 ? await emailCore.sendBatch(messages) : [];
      results.forEach((result, index) => {
        const bucket = tally(result);
        delta[bucket] += 1;
        if ((bucket === 'failed' || bucket === 'uncertain') && failures.length < MAX_FAILURES_KEPT) {
          failures.push({ email: targets[index].email, error: String(result.error || 'Not sent').slice(0, 300) });
        }
      });
    } catch (err) {
      await releaseLease({ db, sendId, token }).catch(() => {});
      if (err instanceof EmailBatchError) return sendError(res, 409, err.code, err.message);
      log.error('sendAnnouncementEmail chunk failed', err);
      return internal(res, 'Part of the send failed before it reached the email provider. Continue the send to try again.');
    }

    let finished = null;
    try {
      finished = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.data();
        if (current?.lease?.token !== token) return { stale: true, data: current };
        const counts = { ...EMPTY_COUNTS, ...(current.counts || {}) };
        for (const key of Object.keys(delta)) counts[key] += delta[key];
        const nextIndex = start + chunk.length;
        const done = nextIndex >= current.total;
        const at = new Date(now());
        const patch = {
          counts,
          nextIndex,
          failures: [...(current.failures || []), ...failures].slice(0, MAX_FAILURES_KEPT),
          lease: null,
          updatedAt: at,
          status: done ? 'sent' : 'sending',
          completedAt: done ? at : null,
        };
        tx.update(ref, patch);
        return { done, data: { ...current, ...patch } };
      });
    } catch (err) {
      log.error('sendAnnouncementEmail progress write failed', err);
      return internal(res, 'The send progress could not be saved. Continue the send; no recipient gets a second copy.');
    }
    if (finished.stale) {
      log.warn('sendAnnouncementEmail lease expired before the chunk finished', { sendId });
    } else if (finished.done) {
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
    previewAnnouncementEmail: expose(createPreviewAnnouncementEmailHandler),
    sendAnnouncementTest: expose(createSendAnnouncementTestHandler),
    // One chunk per call; the lease outlasts this timeout.
    sendAnnouncementEmail: expose(createSendAnnouncementEmailHandler, { timeoutSeconds: 300 }),
  };
}

module.exports = {
  createListAnnouncementSendsHandler,
  createPreviewAnnouncementEmailHandler,
  createSendAnnouncementTestHandler,
  createSendAnnouncementEmailHandler,
  get handlers() { return buildHandlers(); },
  internals: { SENDS, CHUNK_SIZE, LEASE_MS, MAX_FAILURES_KEPT, summarize, tally },
};
