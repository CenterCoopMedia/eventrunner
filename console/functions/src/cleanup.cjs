'use strict';

/**
 * Deleting requests (ADR 0007, Consequences):
 *
 * - deleteSpamApplication: an operator deletes a spam request and frees
 *   its web-address name. A request that is approved or later is never
 *   deleted here, because a site may exist for it.
 * - runRetention: a scheduled job deletes `withdrawn` and `declined` requests
 *   90 days after their last change (`updatedAt`), and frees their names. A
 *   draft stays: its invoice was paid. The acceptance records are in their
 *   own collection and are never deleted here.
 *
 * Both delete the request first, in a transaction that checks it as it is
 * now and leaves a `console_token_deletions` row. Then they delete its stored
 * account tokens and end its connections where the provider allows it and
 * nothing else uses the account. So a delete that is refused has touched no
 * token, and a token that cannot be deleted keeps its row for the job to try
 * again. A request with a connection change running is not deleted.
 *
 * Each delete writes one `console_audit` record: { action, appId, by, at }.
 * `by` is the operator's uid, or 'retention' for the job. The record holds
 * no client data.
 */

const { ConsoleError } = require('./http.cjs');
const { toMillis } = require('./access.cjs');
const { NOT_FOUND, applicationRef, readApplication, requireAppId, requireOperator } = require('./reviewAccess.cjs');
const { readBuild } = require('./buildState.cjs');
const { heldNames, releaseNames } = require('./siteNames.cjs');
const { connectionChanging } = require('./connectionState.cjs');
const {
  ACCOUNT_COLLECTION, deleteRecordedTokens, readConnectedAccounts, recordTokenDeletion, retryTokenDeletions, sweepExpiredStates,
} = require('./connections.cjs');

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 90;
const RETAINED_STATUSES = Object.freeze(['withdrawn', 'declined']);
const SPAM_STATUSES = Object.freeze(['draft', 'withdrawn', 'declined']);
const RETENTION_BATCH = 500;

/** Delete a request and everything connected to it, in the order that keeps a token findable. */
async function deleteWithConnections(deps, spec) {
  const connected = await deleteApplication(deps.db, spec);
  if (!connected) return false;
  try {
    await deleteRecordedTokens(deps, spec.appId, connected);
  } catch (err) {
    (deps.log || console).error('console will try again to delete stored tokens', spec.appId, err.message);
  }
  return true;
}

/**
 * Delete one request in a transaction, after `check(app)` passes on the
 * request as it is now. Frees every name it holds, unless a run began: that
 * run may have made the name's project, and Google never reuses a project id.
 *
 * @returns {Promise<object[]|null>} its connected accounts, or null when `check` says to keep it
 */
async function deleteApplication(db, { appId, by, action, at, check }) {
  const ref = applicationRef(db, appId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ConsoleError(404, 'not-found', NOT_FOUND);
    const app = { id: snap.id, ...snap.data() };
    if (!check(app)) return null;
    const held = await heldNames(tx, db, app.id);
    const connected = await readConnectedAccounts(tx, db, app.id);
    const build = await readBuild((r) => tx.get(r), db, app.id);
    tx.delete(ref);
    tx.delete(db.collection(ACCOUNT_COLLECTION).doc(app.id));
    if (!build) releaseNames(tx, db, held);
    tx.create(db.collection('console_audit').doc(), { action, appId: app.id, by, at });
    recordTokenDeletion(tx, db, app.id, connected, at);
    return connected;
  });
}

async function deleteSpamApplication(deps, { body, user }) {
  const { db, now = Date.now } = deps;
  await requireOperator(db, user);
  const appId = requireAppId(body.appId);
  if (body.confirm !== true) throw new ConsoleError(400, 'confirm-required', 'Confirm that you want to delete this request.');
  const first = await readApplication(db, appId);
  const check = (app) => {
    if (!SPAM_STATUSES.includes(app.status)) {
      throw new ConsoleError(409, 'cannot-delete', 'This request is approved, so it cannot be deleted as spam.');
    }
    if (connectionChanging(app.connections, now())) {
      throw new ConsoleError(409, 'connection-busy', 'An account on this request is being changed. Try again in a few minutes.');
    }
    return true;
  };
  check(first);
  await deleteWithConnections(deps, { appId, by: user.uid, action: 'delete-spam', at: new Date(now()), check });
  return { body: { appId, deleted: true } };
}

/** True when the request is in a retained status and its last change is 90 days old or more. */
function isExpired(app, at) {
  if (connectionChanging(app.connections, at)) return false;
  const changed = toMillis(app.updatedAt);
  return RETAINED_STATUSES.includes(app.status) && Number.isFinite(changed) && at - changed >= RETENTION_DAYS * DAY_MS;
}

/**
 * The retention job. The query asks only for requests past the cutoff, and
 * pages by asking again: each delete takes a request out of the results.
 * It stops when a batch is short, or when a full batch deleted nothing (so
 * a request that keeps failing cannot hold the job in a loop). Each request
 * is checked again inside its own transaction, so one that changed after
 * the query is kept. Connection states nobody came back for are cleared at
 * the end.
 *
 * @param {{ db: object, secrets: object, connectors?: object, now?: () => number, log?: { info: Function, error: Function }, batchSize?: number }} deps
 * @returns {Promise<{ deleted: string[], failed: string[] }>}
 */
async function runRetention(deps) {
  const { db, now = Date.now, log = console, batchSize = RETENTION_BATCH } = deps;
  const at = now();
  const cutoff = new Date(at - RETENTION_DAYS * DAY_MS);
  const deleted = [];
  const failed = new Set();
  await retryTokenDeletions({ ...deps, log }, batchSize);
  for (const status of RETAINED_STATUSES) {
    for (;;) {
      const snap = await db.collection('applications')
        .where('status', '==', status).where('updatedAt', '<=', cutoff).limit(batchSize).get();
      let progress = 0;
      for (const doc of snap.docs) {
        if (failed.has(doc.id)) continue;
        try {
          if (!isExpired(doc.data(), at)) continue;
          const done = await deleteWithConnections({ ...deps, log }, {
            appId: doc.id, by: 'retention', action: 'retention-delete', at: new Date(at), check: (app) => isExpired(app, at),
          });
          if (done) {
            deleted.push(doc.id);
            progress += 1;
          }
        } catch (err) {
          if (err instanceof ConsoleError && err.code === 'not-found') continue;
          failed.add(doc.id);
          log.error('console retention could not delete a request', doc.id, err);
        }
      }
      if (snap.docs.length < batchSize || progress === 0) break;
    }
  }
  await sweepExpiredStates({ db, log }, at, batchSize);
  log.info?.(`console retention deleted ${deleted.length} request(s)`);
  return { deleted, failed: [...failed] };
}

module.exports = { RETENTION_DAYS, deleteSpamApplication, isExpired, runRetention };
