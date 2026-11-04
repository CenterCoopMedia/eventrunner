'use strict';

/**
 * Deleting requests (ADR 0007, Consequences):
 *
 * - deleteSpamApplication: an operator deletes a spam request and frees
 *   its web-address name. A request that is approved or later is never
 *   deleted here, because a site may exist for it.
 * - runRetention: a scheduled job deletes `withdrawn` and `declined`
 *   requests 90 days after their last change (`updatedAt`), and frees
 *   their names.
 *
 * Each delete writes one `console_audit` record: { action, appId, by, at }.
 * `by` is the operator's uid, or 'retention' for the job. The record holds
 * no client data.
 */

const { ConsoleError } = require('./http.cjs');
const { toMillis } = require('./access.cjs');
const { NOT_FOUND, applicationRef, requireAppId, requireOperator, siteNameOf } = require('./reviewAccess.cjs');

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 90;
const RETAINED_STATUSES = Object.freeze(['withdrawn', 'declined']);
const SPAM_STATUSES = Object.freeze(['draft', 'submitted', 'changes_requested', 'withdrawn', 'declined']);
const RETENTION_BATCH = 500;

/**
 * Delete one request in a transaction, after `check(app)` passes on the
 * request as it is now. Frees its name when the name still points at it.
 *
 * @returns {Promise<boolean>} false when `check` says to keep it
 */
async function deleteApplication(db, { appId, by, action, at, check }) {
  const ref = applicationRef(db, appId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ConsoleError(404, 'not-found', NOT_FOUND);
    const app = { id: snap.id, ...snap.data() };
    if (!check(app)) return false;
    const name = siteNameOf(app);
    const nameRef = name ? db.collection('site_names').doc(name) : null;
    const nameSnap = nameRef ? await tx.get(nameRef) : null;
    tx.delete(ref);
    if (nameSnap?.exists && nameSnap.data().appId === app.id) tx.delete(nameRef);
    tx.create(db.collection('console_audit').doc(), { action, appId: app.id, by, at });
    return true;
  });
}

async function deleteSpamApplication({ db, now = Date.now }, { body, user }) {
  await requireOperator(db, user);
  const appId = requireAppId(body.appId);
  if (body.confirm !== true) throw new ConsoleError(400, 'confirm-required', 'Confirm that you want to delete this request.');
  await deleteApplication(db, {
    appId,
    by: user.uid,
    action: 'delete-spam',
    at: new Date(now()),
    check: (app) => {
      if (!SPAM_STATUSES.includes(app.status)) {
        throw new ConsoleError(409, 'cannot-delete', 'This request is approved, so it cannot be deleted as spam.');
      }
      return true;
    },
  });
  return { body: { appId, deleted: true } };
}

/** True when the request is withdrawn or declined and its last change is 90 days old or more. */
function isExpired(app, at) {
  const changed = toMillis(app.updatedAt);
  return RETAINED_STATUSES.includes(app.status) && Number.isFinite(changed) && at - changed >= RETENTION_DAYS * DAY_MS;
}

/**
 * The retention job. Each request is checked again inside its own
 * transaction, so a request that changed after the query is kept.
 *
 * @param {{ db: object, now?: () => number, log?: { info: Function, error: Function } }} deps
 * @returns {Promise<{ deleted: string[], failed: string[] }>}
 */
async function runRetention({ db, now = Date.now, log = console }) {
  const at = now();
  const deleted = [];
  const failed = [];
  for (const status of RETAINED_STATUSES) {
    const snap = await db.collection('applications').where('status', '==', status).limit(RETENTION_BATCH).get();
    for (const doc of snap.docs) {
      if (!isExpired(doc.data(), at)) continue;
      try {
        const done = await deleteApplication(db, {
          appId: doc.id, by: 'retention', action: 'retention-delete', at: new Date(at), check: (app) => isExpired(app, at),
        });
        if (done) deleted.push(doc.id);
      } catch (err) {
        if (err instanceof ConsoleError && err.code === 'not-found') continue;
        failed.push(doc.id);
        log.error('console retention could not delete a request', doc.id, err);
      }
    }
  }
  log.info?.(`console retention deleted ${deleted.length} request(s)`);
  return { deleted, failed };
}

module.exports = { RETENTION_DAYS, deleteSpamApplication, isExpired, runRetention };
