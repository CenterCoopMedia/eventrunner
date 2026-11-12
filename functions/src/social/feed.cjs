'use strict';

/**
 * The private attendee feed: creation, reports and staff removal.
 *
 *   createSocialPost  POST { text, submissionKey, parentPostId? } — a
 *                     current approved/speaker account, with both flags on.
 *                     201 creates, 200 replays, 409 conflicts, and 410
 *                     (post-removed) is terminal after moderation.
 *
 *   reportSocialPost  POST { postId } — a current approved attendee,
 *                     speaker, or staff/operator. Stores one private report
 *                     per (post, reporter).
 *   removeSocialPost  POST { postId } — staff tier. Replaces the post with a
 *                     content-free tombstone and writes one audit row, in
 *                     one transaction.
 *   markSocialNotificationRead POST { notificationId, action: 'read' } —
 *                     the current approved/speaker owner, with both flags on.
 *                     Sets server readAt once; a retry returns that same time.
 *
 * THE STORES. `social_posts/{postId}`:
 *
 *   active   { state: 'active', authorUid, text, createdAt, parentPostId }
 *   removed  { state: 'removed', parentPostId, createdAt, removedAt }
 *
 * `parentPostId` is null for a root post. A removed row keeps no text and
 * no author: the tombstone closes the id, so a delayed create retry
 * cannot write the text back. No account email, access need, report
 * or moderation note is ever stored on a post.
 *
 * `social_reports/{reportIdFor(postId, reporterUid)}` holds only
 * { postId, reporterUid, createdAt }: no reason, no email, no copy of the
 * post. The id is derived from the pair, so a repeated or concurrent report
 * by the same account lands on one document. Only staff and operators read
 * reports (firestore.rules); no client writes either store.
 *
 * THE FLAGS. Attendee reads (firestore.rules) and every report, a staff
 * member's included, need BOTH `config/features.socialFeed` and
 * `config/features.attendeeDirectory` set to true. Missing, false, or
 * malformed is off. The report transaction reads them live on every
 * attempt, so a flag turned off before the report commits stops it.
 *
 * THE CLEANUP EXCEPTION. Turning either flag off does not stop staff
 * cleanup: live authorized staff can still read posts and reports through
 * the rules and remove a post here, with either flag or both off. This is
 * an explicit exception to "everything behind the flag", the same one the
 * change request store makes (admin/changeRequests.cjs) so content can be
 * cleared after the feature is turned off. It grants no attendee access.
 *
 * CURRENT GRANTS, NOT CACHED ONES. Each report attempt reads, inside its
 * transaction, the caller's `users/{uid}` (approved, or linked to a
 * speaker: the rules' requesterIsApprovedAttendee) and `config/bootstrap`
 * through resolveAdminTier with a clock read on that attempt. It never uses
 * requireAttendeeAccess, whose operator branch reads the five-minute cache.
 * A listed staff address whose grant has ended is not a grant here. An
 * account delete, a bootstrap revocation, a flag change, or a removal that
 * commits first refuses a later report; a valid independent grant still
 * admits the caller. Each removal attempt rechecks the staff grant the same
 * way, so a revocation that commits first stops the removal too.
 *
 * REMOVAL AND ITS AUDIT ROW commit together, in the change-request shape
 * (auditRow below: action, docPath, uid, email, at). The row names the
 * moderator and the post id, never the removed text or its author. The
 * best-effort cms/store.cjs logAdminAction is not used: it returns success
 * after a failed audit write. A failed commit leaves the active post as it
 * was. A second removal of the same post writes nothing.
 *
 * ACCOUNT DELETE. users/records.cjs PER_ACCOUNT_STORES sweeps the account's
 * active posts by authorUid (rechecking each row in a transaction, so a
 * tombstone written by a concurrent removal stays) and its reports by
 * reporterUid. Other authors' replies and tombstones stay.
 */

const crypto = require('node:crypto');
const {
  requireAdmin, resolveAdminTier, verifyAuthToken,
} = require('../core/auth.cjs');
const {
  sendError, badRequest, notFound, methodNotAllowed, internal,
} = require('../core/errors.cjs');
const { isValidDocId } = require('../cms/store.cjs');
const {
  MAX_SOCIAL_REQUEST_BYTES, socialRequestBytes, readSocialPost,
} = require('shared/socialPost');

const POSTS = 'social_posts';
const REPORTS = 'social_reports';
const ADMIN_LOGS = 'admin_logs';
const ACTIVE = 'active';
const REMOVED = 'removed';

/** A report body is one id. Anything much larger is not a report. */
const MAX_BODY_BYTES = 1024;

const FEED_CLOSED_MESSAGE = 'The attendee feed is not available for this event.';
const NO_ACCESS_MESSAGE = 'Attendee access is required to report a post.';
const NO_POST_MESSAGE = 'This post is not available.';

/** Both flags on, read from a config/features document. */
function feedOpen(features) {
  return features?.socialFeed === true && features?.attendeeDirectory === true;
}

/**
 * The account grant the rules call requesterIsApprovedAttendee: approved,
 * or linked to a speaker. A stored `role` grants nothing.
 */
function accountGrant(user) {
  if (!user || typeof user !== 'object') return false;
  return user.registrationStatus === 'approved' || (user.speakerId !== undefined && user.speakerId !== null);
}

/** The deterministic report id for one (post, reporter) pair. */
function reportIdFor(postId, reporterUid) {
  return crypto.createHash('sha256').update(JSON.stringify([postId, reporterUid])).digest('hex');
}

/** The audit row, the same five fields logAdminAction writes. */
function auditRow({ action, docPath, actor, at }) {
  return { action, docPath, uid: actor.uid, email: actor.email, at };
}

/** The tombstone that replaces a post: no text, no author. */
function tombstoneOf(data, at) {
  return {
    state: REMOVED,
    parentPostId: typeof data?.parentPostId === 'string' ? data.parentPostId : null,
    createdAt: data?.createdAt ?? null,
    removedAt: at,
  };
}

/** Milliseconds from an injected clock; anything else fails closed (NaN). */
function clockMs(now) {
  const value = now();
  if (value instanceof Date) return value.getTime();
  return typeof value === 'number' ? value : Number.NaN;
}

/** The size of the parsed body, as JSON. An unserializable body is too large. */
function bodyBytes(body) {
  try {
    return Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8');
  } catch {
    return MAX_BODY_BYTES + 1;
  }
}

/** The post id of a `{ postId }` body, or null. */
function readPostId(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return isValidDocId(body.postId) ? body.postId : null;
}

/** A verified, lowercased token email, or '' when it cannot confer a bootstrap grant. */
function verifiedEmail(decoded) {
  if (decoded?.email_verified !== true || typeof decoded.email !== 'string') return '';
  return decoded.email.trim().toLowerCase();
}

/** The pitch pattern: a submission key belongs to exactly one UID. */
function postIdFor(uid, submissionKey) {
  return crypto.createHash('sha256').update(`${uid}\0${submissionKey}`, 'utf8').digest('hex');
}

/**
 * Authorization precedes every replay. Reading the account and flags in the
 * write transaction orders creation against account removal and flag-off.
 * Reading the parent orders a new reply against root removal. A replay of
 * an existing reply writes nothing, even if its root has since been removed.
 */
async function storePost({ db, uid, submission, now }) {
  const { text, parentPostId, submissionKey } = submission;
  const postId = postIdFor(uid, submissionKey);
  const postRef = db.collection(POSTS).doc(postId);
  const parentRef = parentPostId === null ? null : db.collection(POSTS).doc(parentPostId);
  const outcome = await db.runTransaction(async (tx) => {
    const [features, account, target, parent] = await tx.getAll(
      db.collection('config').doc('features'), db.collection('users').doc(uid), postRef,
      ...(parentRef ? [parentRef] : []),
    );
    if (!feedOpen(features.exists ? features.data() : null)) return 'closed';
    // Bootstrap staff access never grants composition access.
    if (!accountGrant(account.exists ? account.data() : null)) return 'forbidden';
    if (target.exists) {
      const stored = target.data();
      if (stored.state === REMOVED) return 'removed';
      return stored.state === ACTIVE && stored.authorUid === uid
        && stored.text === text && stored.parentPostId === parentPostId ? 'replayed' : 'conflict';
    }
    if (parentRef && (!parent.exists || parent.data().state !== ACTIVE
        || parent.data().parentPostId !== null)) return 'no-root';
    const rootAuthorUid = parentRef ? parent.data().authorUid : null;
    if (parentRef) {
      if (!isValidDocId(rootAuthorUid)) return 'no-root';
      // Account deletion removes this document before sweeping its stores.
      // Reading it here orders both the reply and notification before that
      // sweep, or refuses both after deletion, even while the root remains.
      const recipient = await tx.get(db.collection('users').doc(rootAuthorUid));
      if (!recipient.exists) return 'no-root';
    }
    const createdAt = new Date(clockMs(now));
    tx.create(postRef, { state: ACTIVE, authorUid: uid, text, parentPostId, createdAt });
    if (rootAuthorUid !== null && rootAuthorUid !== uid) {
      tx.create(db.collection('users').doc(rootAuthorUid).collection('notifications').doc(postId), {
        kind: 'post_reply', rootPostId: parentPostId, replyPostId: postId, createdAt, readAt: null,
      });
    }
    return 'stored';
  });
  return { outcome, postId };
}

function createCreateSocialPostHandler({ db, auth, now = Date.now, log = console }) {
  return async function createSocialPost(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    if ((req.rawBody?.length ?? 0) > MAX_SOCIAL_REQUEST_BYTES
        || socialRequestBytes(req.body) > MAX_SOCIAL_REQUEST_BYTES) {
      return sendError(res, 413, 'payload-too-large', 'The request is too large.');
    }
    const submission = readSocialPost(req.body);
    if (!submission.ok) return badRequest(res, submission.message);
    const decoded = await verifyAuthToken({ auth }, req);
    if (!decoded?.uid) return sendError(res, 401, 'unauthorized', 'Sign in to post.');
    let result;
    try {
      result = await storePost({ db, uid: decoded.uid, submission, now });
    } catch (err) {
      log.error('createSocialPost failed', { code: err?.code ?? 'unknown' });
      return internal(res, 'The post could not be saved. Try again with the same submission key.');
    }
    const { outcome, postId } = result;
    if (outcome === 'closed') return notFound(res, FEED_CLOSED_MESSAGE);
    if (outcome === 'forbidden') return sendError(res, 403, 'forbidden', 'An approved or speaker account is required to post.');
    if (outcome === 'no-root') return notFound(res, 'The original post is not available for replies.');
    if (outcome === 'conflict') return sendError(res, 409, 'submission-conflict', 'This submission key was already used for another post.');
    if (outcome === 'removed') return sendError(res, 410, 'post-removed', 'This post was removed and cannot be submitted again.');
    res.status(outcome === 'stored' ? 201 : 200).json({ postId, state: ACTIVE });
  };
}

/** The notification owner comes only from the revocation-checked sign-in. */
function createMarkSocialNotificationReadHandler({ db, auth, now = Date.now, log = console }) {
  return async function markSocialNotificationRead(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    if ((req.rawBody?.length ?? 0) > MAX_BODY_BYTES || bodyBytes(req.body) > MAX_BODY_BYTES) {
      return sendError(res, 413, 'payload-too-large', 'The request is too large.');
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).length !== 2 || body.action !== 'read'
        || !isValidDocId(body.notificationId)) {
      return badRequest(res, 'Send notificationId and action: read.');
    }
    const decoded = await verifyAuthToken({ auth }, req);
    if (!decoded?.uid) return sendError(res, 401, 'unauthorized', 'Sign in to read a notification.');
    let result;
    try {
      result = await markNotificationRead({ db, uid: decoded.uid, notificationId: body.notificationId, now });
    } catch (err) {
      log.error('markSocialNotificationRead failed', { code: err?.code ?? 'unknown' });
      return internal(res, 'The notification could not be marked read. Try again.');
    }
    if (result.outcome === 'closed') return notFound(res, FEED_CLOSED_MESSAGE);
    if (result.outcome === 'forbidden') return sendError(res, 403, 'forbidden', 'An approved or speaker account is required.');
    if (result.outcome === 'missing') return notFound(res, 'This notification is not available.');
    res.status(200).json({ notificationId: body.notificationId, readAt: result.readAt.toISOString() });
  };
}

async function markNotificationRead({ db, uid, notificationId, now }) {
  const item = db.collection('users').doc(uid).collection('notifications').doc(notificationId);
  return db.runTransaction(async (tx) => {
    const [features, account, notification] = await tx.getAll(
      db.collection('config').doc('features'), db.collection('users').doc(uid), item,
    );
    if (!feedOpen(features.exists ? features.data() : null)) return { outcome: 'closed' };
    if (!accountGrant(account.exists ? account.data() : null)) return { outcome: 'forbidden' };
    if (!notification.exists) return { outcome: 'missing' };
    const previous = notification.data().readAt;
    const readAt = previous === null ? new Date(clockMs(now)) : previous.toDate();
    if (previous === null) tx.update(item, { readAt });
    return { outcome: 'read', readAt };
  });
}

/**
 * Store one report, once. Every read happens on every attempt: the flags,
 * the target, the caller's account, the bootstrap lists, and the report.
 *
 * @returns {Promise<'stored'|'replayed'|'closed'|'forbidden'|'no-post'>}
 */
async function storeReport({ db, postId, uid, email, now }) {
  const postRef = db.collection(POSTS).doc(postId);
  const reportRef = db.collection(REPORTS).doc(reportIdFor(postId, uid));
  const featuresRef = db.collection('config').doc('features');
  const accountRef = db.collection('users').doc(uid);
  const bootstrapRef = db.collection('config').doc('bootstrap');
  return db.runTransaction(async (tx) => {
    const [featuresSnap, postSnap, accountSnap, bootstrapSnap, reportSnap] = await tx.getAll(
      featuresRef, postRef, accountRef, bootstrapRef, reportRef,
    );
    if (!feedOpen(featuresSnap.exists ? featuresSnap.data() : null)) return 'closed';
    const nowMs = clockMs(now);
    const bootstrap = bootstrapSnap.exists ? bootstrapSnap.data() : null;
    const staffGrant = Boolean(email) && resolveAdminTier(bootstrap, email, nowMs) !== null;
    if (!staffGrant && !accountGrant(accountSnap.exists ? accountSnap.data() : null)) return 'forbidden';
    if (reportSnap.exists) return 'replayed';
    if (!postSnap.exists || postSnap.data()?.state !== ACTIVE) return 'no-post';
    tx.create(reportRef, { postId, reporterUid: uid, createdAt: new Date(nowMs) });
    return 'stored';
  });
}

/**
 * Replace one post with its tombstone and write its audit row, together.
 * The staff grant is checked again on every attempt.
 *
 * @returns {Promise<'removed'|'already-removed'|'missing'|'forbidden'>}
 */
async function removePost({ db, postId, actor, now }) {
  const postRef = db.collection(POSTS).doc(postId);
  const bootstrapRef = db.collection('config').doc('bootstrap');
  return db.runTransaction(async (tx) => {
    const [bootstrapSnap, postSnap] = await tx.getAll(bootstrapRef, postRef);
    const nowMs = clockMs(now);
    const bootstrap = bootstrapSnap.exists ? bootstrapSnap.data() : null;
    if (resolveAdminTier(bootstrap, actor.email, nowMs) === null) return 'forbidden';
    if (!postSnap.exists) return 'missing';
    const data = postSnap.data() || {};
    if (data.state === REMOVED) return 'already-removed';
    const at = new Date(nowMs);
    // set without merge: the stored document becomes exactly the tombstone.
    tx.set(postRef, tombstoneOf(data, at));
    tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
      action: 'removeSocialPost',
      docPath: `${POSTS}/${postId}`,
      actor,
      at,
    }));
    return 'removed';
  });
}

/**
 * @param {{ db: object, auth: object, now?: () => number|Date, log?: Pick<Console, 'error'> }} deps
 */
function createReportSocialPostHandler({ db, auth, now = Date.now, log = console }) {
  return async function reportSocialPost(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    if (bodyBytes(req.body) > MAX_BODY_BYTES) {
      return sendError(res, 413, 'payload-too-large', 'The request is too large.');
    }
    // Revocation-checked: a deleted or disabled sign-in is refused here,
    // and the transaction below catches a delete that lands after it.
    const decoded = await verifyAuthToken({ auth }, req);
    if (!decoded?.uid) return sendError(res, 401, 'unauthorized', 'Sign in to report a post.');
    const postId = readPostId(req.body);
    if (!postId) return badRequest(res, 'postId: must be a post id.');

    let outcome;
    try {
      outcome = await storeReport({ db, postId, uid: decoded.uid, email: verifiedEmail(decoded), now });
    } catch (err) {
      log.error('reportSocialPost failed', err);
      return internal(res, 'The report could not be saved. Try again.');
    }
    if (outcome === 'closed') return notFound(res, FEED_CLOSED_MESSAGE);
    if (outcome === 'forbidden') return sendError(res, 403, 'forbidden', NO_ACCESS_MESSAGE);
    if (outcome === 'no-post') return notFound(res, NO_POST_MESSAGE);
    res.status(outcome === 'stored' ? 201 : 200).json({ postId, reported: true });
  };
}

/**
 * @param {{ db: object, auth: object, getConfig?: () => Promise<object>,
 *           now?: () => number|Date, log?: Pick<Console, 'error'> }} deps
 */
function createRemoveSocialPostHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function removeSocialPost(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig, now }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    const postId = readPostId(req.body);
    if (!postId) return badRequest(res, 'postId: must be a post id.');

    let outcome;
    try {
      outcome = await removePost({ db, postId, actor: { uid: gate.uid, email: gate.email }, now });
    } catch (err) {
      log.error('removeSocialPost failed', err);
      return internal(res, 'The post could not be removed. Nothing was changed. Try again.');
    }
    if (outcome === 'forbidden') return sendError(res, 403, 'forbidden', 'Admin access required.');
    if (outcome === 'missing') return notFound(res, NO_POST_MESSAGE);
    res.status(200).json({ postId, removed: true, alreadyRemoved: outcome === 'already-removed' });
  };
}

/** Deployable social endpoints. */
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

  const expose = (create) => onRequest({ region }, withCors(async (req, res) => {
    await create(buildDeps())(req, res);
  }));

  return {
    createSocialPost: expose(createCreateSocialPostHandler),
    reportSocialPost: expose(createReportSocialPostHandler),
    removeSocialPost: expose(createRemoveSocialPostHandler),
    markSocialNotificationRead: expose(createMarkSocialNotificationReadHandler),
  };
}

module.exports = {
  createCreateSocialPostHandler,
  createReportSocialPostHandler,
  createRemoveSocialPostHandler,
  createMarkSocialNotificationReadHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    POSTS,
    REPORTS,
    MAX_BODY_BYTES,
    feedOpen,
    accountGrant,
    reportIdFor,
    postIdFor,
    tombstoneOf,
  },
};
