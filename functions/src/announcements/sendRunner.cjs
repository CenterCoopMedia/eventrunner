'use strict';

/**
 * The send record and its chunks: what an announcement send does once a
 * caller has decided to send (issue #518). sends.cjs is the staff caller;
 * it checks the request, the preview and the receipt, then uses these.
 * The attendee reminder schedule (ADR 0006) will be the second caller, so
 * a scheduled email gets the same suppression check, unsubscribe modes,
 * stream re-check, send-once keys and send history as a staff send.
 *
 * The rules (bounded chunks, no queue, the lease, retries of transient
 * failures) are described in sends.cjs.
 */

const crypto = require('node:crypto');
const { EmailBatchError } = require('../email/send.cjs');
const { newUnsubscribeKey, readSuppressedIds, suppressionIdFor, testUnsubscribeUrl, unsubscribeUrlFor } = require('./suppression.cjs');
const { auditRedactFor, personalize, resolveChannel, unsubscribeHeaders } = require('./compose.cjs');

const SENDS = 'announcement_sends';
const CHUNK_SIZE = 200;
const LEASE_MS = 6 * 60 * 1000;
const MAX_FAILURES_KEPT = 50;
const SOURCE = 'announcement';

const EMPTY_COUNTS = Object.freeze({ sent: 0, failed: 0, uncertain: 0, skipped: 0, suppressed: 0 });

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  return null;
}

/** A failure the provider may not repeat: 5xx, or 429, with a definite answer. */
function isTransientFailure(result) {
  // A skipped result can carry a failure an earlier call recorded on the
  // claim (a progress write lost after the provider answered).
  if (!result || result.status === 'sent' || result.uncertain) return false;
  const status = result.providerStatus;
  return typeof status === 'number' && (status === 429 || (status >= 500 && status <= 599));
}

/** Map a result from sendBatch onto the record's counters. */
function tally(result) {
  if (result.skipped && result.status === 'sent') return 'skipped';
  if (result.status === 'sent') return 'sent';
  if (result.uncertain) return 'uncertain';
  return 'failed';
}

function isAlreadyExists(err) {
  return err?.code === 6 || err?.code === 'already-exists' || /ALREADY_EXISTS/i.test(String(err?.message || ''));
}

/**
 * Create the send record, with its recipient list frozen. A retry
 * (`retryOf`) also marks the earlier record in the same transaction.
 *
 * @returns {Promise<{ record: object } | { existing: true } | { error: [number, string, string] }>}
 */
async function startSendRecord({
  db, sendId, nowMs, audience, draft, rendered, channel, receipt, recipients, retryOf = null, createdBy,
}) {
  const record = {
    status: 'sending',
    audience,
    subject: draft.subject,
    message: draft.message,
    link: draft.link,
    renderedSubject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    hasLegalFooterHtml: rendered.hasLegalFooterHtml,
    hasLegalFooterText: rendered.hasLegalFooterText,
    stream: channel.stream,
    mode: channel.mode,
    receipt,
    recipients,
    total: recipients.length,
    nextIndex: 0,
    counts: { ...EMPTY_COUNTS, suppressed: 0 },
    failures: [],
    retryRecipients: [],
    retryOf,
    retriedBy: null,
    unsubscribeKey: newUnsubscribeKey(),
    lease: null,
    createdAt: new Date(nowMs),
    updatedAt: new Date(nowMs),
    completedAt: null,
    createdBy,
  };
  const ref = db.collection(SENDS).doc(sendId);
  try {
    if (retryOf) {
      // The new record and the earlier record's mark land together, so two
      // confirmations cannot both retry the same failures.
      const refused = await db.runTransaction(async (tx) => {
        const earlierRef = db.collection(SENDS).doc(retryOf);
        const [mine, earlier] = [await tx.get(ref), await tx.get(earlierRef)];
        if (mine.exists) return 'existing';
        if (earlier.data()?.retriedBy) return 'retry-used';
        tx.create(ref, record);
        tx.update(earlierRef, { retriedBy: sendId, updatedAt: new Date(nowMs) });
        return null;
      });
      if (refused === 'existing') return { existing: true };
      if (refused) {
        return { error: [409, refused, 'The failed addresses of this send were already sent again. Retry from that later send instead.'] };
      }
    } else {
      await ref.create(record);
    }
  } catch (err) {
    if (isAlreadyExists(err)) return { existing: true };
    throw err;
  }
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

/**
 * Send the next chunk under a lease takeLease() granted, then save the
 * progress and release the lease.
 *
 * @returns {Promise<{ error: [number, string, string] } | { stale: true, data: object }
 *   | { done: boolean, data: object }>} `done` is true when this chunk
 *   finished the send.
 */
async function runChunk({ db, sendId, lease, getConfig, provider, emailCore, now = Date.now, log = console }) {
  const ref = db.collection(SENDS).doc(sendId);
  const { token, start, data } = lease;
  const chunk = data.recipients.slice(start, start + CHUNK_SIZE);
  const delta = { ...EMPTY_COUNTS };
  const failures = [];
  const retryable = [];
  try {
    const config = await getConfig();
    // The stream is checked again before every chunk's claims (issue #490).
    const channel = await resolveChannel({ provider, config });
    if (!channel.ok || channel.stream !== data.stream || channel.mode !== data.mode) {
      await releaseLease({ db, sendId, token });
      const message = channel.ok
        ? 'The announcement stream or its unsubscribe handling changed after this send started. Restore it, then continue the send.'
        : channel.message;
      return { error: [409, channel.ok ? 'channel-changed' : channel.code, message] };
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
      // Addresses only: the record also holds up to 5,000 recipients.
      if (isTransientFailure(result)) retryable.push(targets[index].email);
    });
  } catch (err) {
    await releaseLease({ db, sendId, token }).catch(() => {});
    if (err instanceof EmailBatchError) return { error: [409, err.code, err.message] };
    log.error('sendAnnouncementEmail chunk failed', err);
    return { error: [500, 'internal', 'Part of the send failed before it reached the email provider. Continue the send to try again.'] };
  }

  let finished;
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
        retryRecipients: [...(current.retryRecipients || []), ...retryable],
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
    return { error: [500, 'internal', 'The send progress could not be saved. Continue the send; no recipient gets a second copy.'] };
  }
  if (finished.stale) log.warn('sendAnnouncementEmail lease expired before the chunk finished', { sendId });
  return finished;
}

module.exports = {
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
  releaseLease,
  runChunk,
};
