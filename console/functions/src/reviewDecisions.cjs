'use strict';

/**
 * The operator's one decision on a request (ADR 0007 §5):
 *
 *   declineApplication  draft -> declined (note; frees the name)
 *
 * It runs in one transaction that reads the current status first, so two
 * operators cannot act on the same request twice. The second one gets
 * `status-changed`. It appends to `history`, writes `review`, and then emails
 * the organization's Owners. A failed email does not undo the decision: the
 * answer says `mailFailed`, and the failure is logged. Nothing approves a
 * request: accepting the agreement starts its build (agreementAcceptance.cjs).
 */

const { ConsoleError } = require('./http.cjs');
const {
  NOT_FOUND, applicationRef, ownerEmails, requireAppId, requireOperator, reviewedAnswers,
} = require('./reviewAccess.cjs');
const { heldNames, releaseNames } = require('./siteNames.cjs');
const { statusLink } = require('./applicationStatus.cjs');

const NOTE_MAX = 2000;
const STATUS_CHANGED = 'This request changed since you opened it. Reload the page to see it.';

/** @returns {string} the trimmed note @throws {ConsoleError} 400 when it is missing or too long */
function requireNote(value) {
  const note = typeof value === 'string' ? value.trim() : '';
  if (!note) throw new ConsoleError(400, 'note-required', 'Write a note to the client.');
  if (note.length > NOTE_MAX) {
    throw new ConsoleError(400, 'note-too-long', `Shorten the note to ${NOTE_MAX.toLocaleString('en-US')} characters or fewer.`);
  }
  return note;
}

/**
 * Move one request from one of `from` to `to` in a transaction.
 *
 * `revision` is the history length the operator saw. When the request
 * changed since then, even back to the same status, the move is refused.
 * With `releaseName`, every `site_names` reservation the request holds
 * is deleted.
 *
 * @returns {Promise<object>} the request as it was before the change
 */
async function transition({ db, now = Date.now }, { appId, user, from, to, revision = null, note = null, releaseName = false }) {
  const ref = applicationRef(db, requireAppId(appId));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ConsoleError(404, 'not-found', NOT_FOUND);
    const app = { id: snap.id, ...snap.data() };
    const history = Array.isArray(app.history) ? app.history : [];
    if (!from.includes(app.status)) throw new ConsoleError(409, 'status-changed', STATUS_CHANGED);
    if (revision !== null && revision !== history.length) throw new ConsoleError(409, 'status-changed', STATUS_CHANGED);
    const held = releaseName ? await heldNames(tx, db, app.id) : [];
    const at = new Date(now());
    tx.update(ref, {
      status: to,
      updatedAt: at,
      updatedBy: user.uid,
      history: [...history, { status: to, at, by: user.uid, note }],
      review: { note, by: user.uid, at, settings: null },
    });
    releaseNames(tx, db, held);
    return app;
  });
}

/**
 * Email each Owner. One message per Owner, so no Owner sees a list of
 * addresses. One refused address does not stop the rest. Returns how
 * many went out and whether any failed.
 */
async function notifyOwners({ db, mailer, publicUrl, log = console }, app, { status, note }) {
  try {
    const [owners, org] = await Promise.all([
      ownerEmails(db, app.orgId),
      db.collection('organizations').doc(app.orgId).get(),
    ]);
    const base = typeof publicUrl === 'string' && /^https?:\/\//.test(publicUrl) ? publicUrl : '';
    const change = {
      organizationName: org.exists ? org.data().name : '',
      eventName: reviewedAnswers(app)?.event?.name || '',
      status,
      note,
      link: statusLink(base, app.orgId, app.id),
    };
    let emailed = 0;
    for (const to of owners) {
      try {
        await mailer.sendStatusChange({ ...change, to });
        emailed += 1;
      } catch (err) {
        log.error('console status email failed', err);
      }
    }
    return { emailed, mailFailed: emailed < owners.length };
  } catch (err) {
    log.error('console status email failed', err);
    return { emailed: 0, mailFailed: true };
  }
}

/** The history length the operator's page showed. */
function requireRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new ConsoleError(400, 'bad-request', 'Reload the page and try again.');
  return value;
}

async function decide(deps, { body, user }, spec) {
  await requireOperator(deps.db, user);
  const revision = requireRevision(body.revision);
  const app = await transition(deps, { appId: body.appId, user, revision, ...spec });
  const mail = await notifyOwners(deps, app, { status: spec.to, note: spec.note ?? null });
  return { body: { application: { id: app.id, status: spec.to }, ...mail } };
}

async function declineApplication(deps, input) {
  const note = requireNote(input.body.note);
  return decide(deps, input, { from: ['draft'], to: 'declined', note, releaseName: true });
}

module.exports = { NOTE_MAX, declineApplication, requireNote, transition };
