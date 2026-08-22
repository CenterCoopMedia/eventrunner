'use strict';

/**
 * Maintenance sweep (spec §8.4).
 *
 * §8.4 ports one specific lesson from the workflow this platform replaces:
 * the old publish flow reconciled `cmsPublishQueue` from three separate
 * `success()` / `failure()` / `cancelled()` workflow steps, and a run that
 * ended in a state none of them covered left its row stuck at `running`
 * forever. The replacement is "a job-level timeout that marks stranded
 * rows failed — but now the reconciler is a single `maintenance/cleanup.cjs`
 * sweep rather than three workflow steps".
 *
 * Three ways a row strands, all of them handled here:
 *
 *   1. `status: 'running'` — cmsPublish itself died mid-publish (an
 *      instance eviction, a timeout) without reaching either terminal
 *      write. Only a `failed` row is resumable, so a row left at `running`
 *      is a publish an admin cannot retry: cmsPublish answers 409 for it
 *      by design, precisely so two runs can never double-bump revisions.
 *      Timing it out is what makes the publish resumable again.
 *   2. `publisher.status: 'running'` — the Cloud Run job started and never
 *      wrote its terminal status (the task hit its own timeout, or was
 *      killed).
 *   3. `publisher.invoke.status: 'invoked'` with no `publisher.status` —
 *      the execution was accepted by the Cloud Run API and the container
 *      never got far enough to claim the row.
 *
 * The sweep only ever moves a row from a non-terminal state to `failed`.
 * It never deletes, never re-invokes, and never touches a row that already
 * reached a terminal state, so running it twice on the same row is a
 * no-op — which matters, because it runs on a schedule alongside whatever
 * the operator is doing by hand.
 */

/**
 * How long a non-terminal row may sit before the sweep calls it stranded.
 *
 * Must exceed the longest legitimate run of either party by a wide margin,
 * because timing out a row that is still working would mark a live publish
 * failed and invite a concurrent resume. The two bounds: a Cloud Functions
 * v2 request is capped at 60 minutes and cmsPublish is far under that, and
 * the Cloud Run job is created with a 30-minute task timeout
 * (deploy-client.yml). 90 minutes clears both with room for a retry.
 */
const STRANDED_AFTER_MS = 90 * 60 * 1000;

/** Batch bound per query, matching cleanupExpiredAuthChallenges. */
const SWEEP_LIMIT = 250;

/** @param {*} value @returns {number|null} epoch ms, or null */
function toMillis(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'number') return value;
  return null;
}

const TERMINAL = new Set(['done', 'failed']);

/**
 * Decide what a single row needs, if anything. Pure, so every stranding
 * shape is table-testable without a Firestore.
 *
 * @param {object} row a cmsPublishQueue document's data
 * @param {number} nowMs
 * @param {number} timeoutMs
 * @returns {{ publish: boolean, publisher: boolean }}
 */
function strandedParts(row, nowMs, timeoutMs) {
  const cutoff = nowMs - timeoutMs;
  const publisher = row?.publisher || {};

  // The most recent evidence of life, per party. An older row with a fresh
  // updatedAt is still working; a row with no timestamp at all is treated
  // as ancient rather than as immortal.
  const publishSeen = toMillis(row?.updatedAt) ?? toMillis(row?.requestedAt) ?? 0;
  const publisherSeen = toMillis(publisher.startedAt) ??
    toMillis(publisher.invoke?.at) ?? publishSeen;

  const publishStranded = row?.status === 'running' && publishSeen < cutoff;

  const publisherStarted = publisher.status === 'running' ||
    publisher.invoke?.status === 'invoked';
  const publisherStranded = publisherStarted &&
    !TERMINAL.has(publisher.status) &&
    publisherSeen < cutoff;

  return { publish: publishStranded, publisher: publisherStranded };
}

/**
 * The patch that retires a stranded row. `note` is what an operator reads
 * in the CMS queue view, so it says what happened and what to do.
 *
 * @param {{ publish: boolean, publisher: boolean, at: Date, timeoutMs: number }} args
 */
function strandedPatch({ publish, publisher, at, timeoutMs }) {
  const minutes = Math.round(timeoutMs / 60000);
  const patch = { updatedAt: at };
  if (publish) {
    patch.status = 'failed';
    patch.finishedAt = at;
    patch.error = `Publish stranded: no progress for ${minutes} minutes. ` +
      'Committed chunks are recorded on this row — re-run with { queueId } to resume.';
  }
  if (publisher) {
    patch.publisher = {
      status: 'failed',
      failedStage: 'timeout',
      finishedAt: at,
      error: `Site publisher stranded: the Cloud Run job did not report a result within ${minutes} minutes.`,
    };
  }
  return patch;
}

/**
 * Sweep `cmsPublishQueue` for stranded rows.
 *
 * Three single-field equality queries rather than one range scan: each is
 * served by an automatic single-field index, so this adds no entry to
 * firestore.indexes.json, and the row count in any of them is tiny (a
 * stranded row is by definition rare). Doc ids are deduped because a row
 * can match more than one query.
 *
 * @param {{
 *   db: object,
 *   now?: () => number,
 *   timeoutMs?: number,
 *   limit?: number,
 *   notifyOperator?: (event: object) => Promise<unknown>,
 *   log?: Console,
 * }} deps
 * @returns {Promise<{ scanned: number, publishFailed: number, publisherFailed: number }>}
 */
async function sweepStrandedPublishRows({
  db,
  now = Date.now,
  timeoutMs = STRANDED_AFTER_MS,
  limit = SWEEP_LIMIT,
  notifyOperator = async () => {},
  log = console,
}) {
  const nowMs = now();
  const at = new Date(nowMs);
  const collection = db.collection('cmsPublishQueue');

  const queries = [
    collection.where('status', '==', 'running').limit(limit),
    collection.where('publisher.status', '==', 'running').limit(limit),
    collection.where('publisher.invoke.status', '==', 'invoked').limit(limit),
  ];

  const seen = new Map();
  for (const query of queries) {
    const snap = await query.get();
    for (const doc of snap.docs) {
      if (!seen.has(doc.id)) seen.set(doc.id, doc);
    }
  }

  let publishFailed = 0;
  let publisherFailed = 0;
  for (const doc of seen.values()) {
    const parts = strandedParts(doc.data(), nowMs, timeoutMs);
    if (!parts.publish && !parts.publisher) continue;
    await doc.ref.set(strandedPatch({ ...parts, at, timeoutMs }), { merge: true });
    if (parts.publish) publishFailed += 1;
    if (parts.publisher) publisherFailed += 1;
    log.warn(
      `maintenance: cmsPublishQueue/${doc.id} timed out ` +
      `(publish=${parts.publish}, publisher=${parts.publisher})`,
    );
  }

  if (publishFailed + publisherFailed > 0) {
    // One event per sweep, not per row: a broken publisher strands every
    // publish, and the useful signal is "this is happening", once.
    try {
      await notifyOperator({
        kind: 'warning',
        title: 'Stranded publish rows timed out',
        summary:
          'The maintenance sweep marked publish-queue rows failed because neither cmsPublish nor ' +
          'the site-publisher job reported a result in time. A failed publish row is resumable ' +
          'from the CMS; a failed publisher row means the crawler-facing snapshot is stale.',
        fields: { publishFailed, publisherFailed, timeoutMinutes: Math.round(timeoutMs / 60000) },
        dedupeKey: 'publish-queue-stranded',
      });
    } catch (err) {
      log.warn(`maintenance: operator notification failed: ${err?.message || err}`);
    }
  }

  return { scanned: seen.size, publishFailed, publisherFailed };
}

/**
 * Deployable exports (spec §1.3). Follows cleanupExpiredAuthChallenges's
 * conventions (auth/otp.cjs): onSchedule, region from EVENT_FIREBASE_REGION,
 * and every dependency required inside the callback so deploy analysis
 * never touches firebase-admin.
 */
function buildHandlers() {
  const { onSchedule } = require('firebase-functions/v2/scheduler');
  const { defineSecret } = require('firebase-functions/params');

  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const secretNames = new Set();
  if ((process.env.EVENT_OPERATOR_NOTIFIER || '').trim() === 'webhook') {
    secretNames.add('OPERATOR_WEBHOOK_URL');
    secretNames.add('OPERATOR_WEBHOOK_SECRET');
  }
  if ((process.env.EVENT_OPERATOR_NOTIFIER || '').trim() === 'email') {
    const { SEND_SECRETS_BY_PROVIDER } = require('../email/send.cjs').internals;
    const provider = (process.env.EVENT_EMAIL_PROVIDER || '').trim();
    for (const name of SEND_SECRETS_BY_PROVIDER[provider] || []) secretNames.add(name);
  }
  const secrets = [...secretNames].map(defineSecret);

  return {
    // Well inside STRANDED_AFTER_MS, so a stranded row is retired within
    // one sweep of crossing the timeout rather than up to a day later.
    cleanupStrandedPublishRows: onSchedule(
      { region, schedule: 'every 30 minutes', secrets },
      async () => {
        const { getDb } = require('../core/firestore.cjs');
        const { getEventConfig } = require('../core/config.cjs');
        const { createOperatorNotifier } = require('../notify/operator.cjs');
        const { getEmailProvider } = require('../email/providers/index.cjs');
        const { createEmailCore } = require('../email/send.cjs');
        const db = getDb();
        const getConfig = () => getEventConfig({ db });
        const notifier = createOperatorNotifier({
          env: process.env,
          getConfig,
          sendEmail: async (message) => createEmailCore({
            db, provider: getEmailProvider({ env: process.env }), getConfig,
          }).send(message),
        });
        await sweepStrandedPublishRows({ db, notifyOperator: notifier.notify });
      },
    ),
  };
}

module.exports = {
  sweepStrandedPublishRows,
  get handlers() {
    return buildHandlers();
  },
  internals: { strandedParts, strandedPatch, toMillis, STRANDED_AFTER_MS, SWEEP_LIMIT },
};
