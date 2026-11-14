'use strict';

const { verifyAuthToken } = require('../core/auth.cjs');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { sendError, methodNotAllowed, internal } = require('../core/errors.cjs');
const { isValidDocId } = require('../cms/store.cjs');
const { validateDiscussionPoints } = require('shared/speakerDiscussion');
const { speakerDisplayName } = require('shared/speaker');
const { loadTemplate } = require('../email/templates.cjs');
const { render } = require('../email/render.cjs');
const { transactionalStream } = require('../email/stream.cjs');

const TEMPLATE_ID = 'speaker.discussion_points';
const NOTIFICATION_WINDOW_MS = 15 * 60 * 1000;
const forbidden = () => ({ ok: false, status: 403, code: 'forbidden', message: 'You may only access your own speaker discussion points.' });
const conflict = () => ({ ok: false, status: 409, code: 'revision-conflict', message: 'Your saved discussion points changed. Load the current submission before saving again.' });

function owns(stored, uid) {
  return Boolean(stored) && stored.uid === uid && Boolean(uid) && stored.status !== 'removed';
}

function submissionView(submission) {
  if (!submission) return null;
  return {
    text: submission.text,
    revision: submission.revision,
    requestId: submission.requestId,
    submittedAt: typeof submission.submittedAt?.toDate === 'function'
      ? submission.submittedAt.toDate().toISOString() : new Date(submission.submittedAt).toISOString(),
    notification: { state: submission.notification?.state || 'unknown' },
  };
}

async function caller(req, res, auth) {
  const decoded = await verifyAuthToken({ auth }, req);
  if (!decoded?.uid) {
    sendError(res, 401, 'unauthorized', 'Authentication required.');
    return null;
  }
  if (!isValidDocId(req.body?.speakerId)) {
    sendError(res, 400, 'bad-request', 'speakerId: Required.');
    return null;
  }
  return decoded.uid;
}

function createGetSpeakerDiscussionPointsHandler({ db, auth, log = console }) {
  return async function getSpeakerDiscussionPoints(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const uid = await caller(req, res, auth);
    if (!uid) return;
    try {
      const snap = await db.collection('speakers').doc(req.body.speakerId).get();
      const stored = snap.exists ? snap.data() : null;
      if (!owns(stored, uid)) {
        const error = forbidden();
        return sendError(res, error.status, error.code, error.message);
      }
      return res.status(200).json({ submission: submissionView(stored.discussionPoints) });
    } catch {
      log.error('Speaker discussion points read failed');
      return internal(res, 'Your discussion points could not be loaded. Keep this page open and try again.');
    }
  };
}

/** Only the first commit of a request may attempt mail. A crash leaves unknown. */
async function saveSubmission({ db, speakerId, uid, fields, now }) {
  const ref = db.collection('speakers').doc(speakerId);
  const nowMs = now();
  return db.runTransaction(async (tx) => {
    const policy = await checkDemoWrites({ db, transaction: tx });
    if (!policy.ok) return policy;
    const snap = await tx.get(ref);
    const speaker = snap.exists ? snap.data() : null;
    if (!owns(speaker, uid)) return forbidden();
    const previous = speaker.discussionPoints;
    if (previous?.requestId === fields.requestId) {
      if (previous.text !== fields.text || previous.revision !== fields.expectedRevision + 1) return conflict();
      return { ok: true, submission: previous, replay: true };
    }
    const revision = previous?.revision || 0;
    if (revision !== fields.expectedRevision || revision >= Number.MAX_SAFE_INTEGER) return conflict();
    // Reserve one mail attempt per speaker window in the save transaction.
    // Later saves keep the reservation, including failed or ambiguous sends.
    const windowStartedAt = previous?.notificationWindowStartedAt;
    const notify = !(typeof windowStartedAt === 'number' && nowMs - windowStartedAt < NOTIFICATION_WINDOW_MS);
    const submission = {
      text: fields.text,
      revision: revision + 1,
      requestId: fields.requestId,
      submittedAt: new Date(nowMs),
      notificationWindowStartedAt: notify ? nowMs : windowStartedAt,
      notification: { state: notify ? 'unknown' : 'omitted' },
    };
    tx.update(ref, { discussionPoints: submission });
    return { ok: true, submission, speaker, replay: false, notify };
  });
}

async function notifyOrganizers({ db, getConfig, sendEmail, speakerId, speaker, submission }) {
  const ref = db.collection('speakers').doc(speakerId);
  const skipped = await db.runTransaction(async (tx) => {
    const policy = await checkDemoWrites({ db, transaction: tx });
    if (!policy.ok) return { state: 'failed' };
    const current = await tx.get(ref);
    const stored = current.exists ? current.data() : null;
    if (!owns(stored, speaker.uid)) return { state: 'unknown' };
    const saved = stored.discussionPoints;
    if (saved?.revision === submission.revision && saved?.requestId === submission.requestId) return null;
    // No mail was attempted for this superseded save. Release only its unused
    // reservation, preserving the newer text and its omitted notification.
    if (Number.isFinite(submission.notificationWindowStartedAt)
        && saved?.notificationWindowStartedAt === submission.notificationWindowStartedAt
        && saved?.notification?.state === 'omitted') {
      tx.update(ref, { discussionPoints: { ...saved, notificationWindowStartedAt: null } });
    }
    return { state: 'unknown' };
  });
  if (skipped) return skipped;
  const eventSnap = await db.collection('config').doc('event').get();
  const address = eventSnap.data()?.legal?.supportEmail;
  if (typeof address !== 'string' || !address.trim()) return { state: 'omitted' };
  const config = await getConfig();
  const channel = transactionalStream(config);
  if (!channel.ok) return { state: 'failed' };
  const { template, override } = await loadTemplate({ db, id: TEMPLATE_ID });
  const rendered = render({
    template, override, config,
    tokenValues: {
      speaker_name: speakerDisplayName(speaker),
      discussion_points: submission.text,
      submission_revision: String(submission.revision),
      submitted_at: submissionView(submission).submittedAt,
    },
  });
  const result = await sendEmail({
    to: address.trim(),
    subject: rendered.subject.replace(/\s+/g, ' ').trim(),
    html: rendered.html,
    text: rendered.text,
    tag: TEMPLATE_ID,
    source: 'speaker-discussion-points',
    onceKey: `speaker-discussion-points:${speakerId}:${submission.revision}`,
    storeRendered: false,
    hasLegalFooterHtml: rendered.hasLegalFooterHtml,
    hasLegalFooterText: rendered.hasLegalFooterText,
    ...(channel.stream ? { messageStream: channel.stream } : {}),
  });
  if (!result || result.skipped || result.ambiguous) return { state: 'unknown' };
  return { state: result.status === 'sent' ? 'accepted' : 'failed' };
}

/** An older provider result must not replace a later submission or its result. */
async function recordNotification({ db, speakerId, uid, submission, notification }) {
  const ref = db.collection('speakers').doc(speakerId);
  return db.runTransaction(async (tx) => {
    const policy = await checkDemoWrites({ db, transaction: tx });
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() : null;
    if (!owns(current, uid)) return forbidden();
    const saved = current.discussionPoints;
    if (saved?.revision !== submission.revision || saved?.requestId !== submission.requestId) return conflict();
    if (!policy.ok) return { ok: true, submission: saved };
    if (saved.notification?.state !== 'unknown') return { ok: true, submission: saved };
    const completed = { ...saved, notification };
    tx.update(ref, { discussionPoints: completed });
    return { ok: true, submission: completed };
  });
}

function createSaveSpeakerDiscussionPointsHandler({ db, auth, getConfig, sendEmail, now = Date.now, log = console }) {
  return async function saveSpeakerDiscussionPoints(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const uid = await caller(req, res, auth);
    if (!uid) return;
    const validation = validateDiscussionPoints(req.body);
    if (!validation.ok) return sendError(res, 400, 'bad-request', validation.errors.join(' '));
    const speakerId = req.body.speakerId;
    let result;
    try {
      result = await saveSubmission({ db, speakerId, uid, fields: validation.fields, now });
    } catch {
      log.error('Speaker discussion points save failed');
      return internal(res, 'Your discussion points could not be saved. Keep your text and try again.');
    }
    if (!result.ok) return sendError(res, result.status, result.code, result.message);
    if (result.replay) return res.status(200).json({ submission: submissionView(result.submission), replay: true });
    if (!result.notify) return res.status(200).json({ submission: submissionView(result.submission) });
    let notification;
    try {
      notification = await notifyOrganizers({ db, getConfig, sendEmail, speakerId, ...result });
    } catch {
      // Preparation or provider errors can contain private text. Do not log them.
      notification = { state: 'unknown' };
      log.error('Speaker discussion points notification outcome unknown');
    }
    try {
      const completed = await recordNotification({ db, speakerId, uid, submission: result.submission, notification });
      if (!completed.ok) return sendError(res, completed.status, completed.code, completed.message);
      return res.status(200).json({ submission: submissionView(completed.submission) });
    } catch {
      // The save succeeded even if its mail-result write did not. Replay is safe.
      log.error('Speaker discussion points notification result could not be stored');
      return res.status(200).json({ submission: submissionView(result.submission) });
    }
  };
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const { SEND_SECRETS_BY_PROVIDER } = require('../email/send.cjs').internals;
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const providerName = (process.env.EVENT_EMAIL_PROVIDER || '').trim();
  const secrets = (SEND_SECRETS_BY_PROVIDER[providerName] || []).map(defineSecret);
  const handle = (createHandler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS), methods: ['POST'] })) return;
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
    await createHandler({ db, auth: getAuth(), getConfig, sendEmail })(req, res);
  };
  return {
    getSpeakerDiscussionPoints: onRequest({ region }, handle(createGetSpeakerDiscussionPointsHandler)),
    saveSpeakerDiscussionPoints: onRequest({ region, secrets }, handle(createSaveSpeakerDiscussionPointsHandler)),
  };
}

module.exports = {
  createGetSpeakerDiscussionPointsHandler,
  createSaveSpeakerDiscussionPointsHandler,
  get handlers() { return buildHandlers(); },
};
