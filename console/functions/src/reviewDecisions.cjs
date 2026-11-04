'use strict';

/**
 * The operator's decisions on a request (ADR 0007 §5):
 *
 *   requestChanges      submitted                     -> changes_requested (note)
 *   declineApplication  submitted | changes_requested -> declined (note; frees the name)
 *   approveApplication  submitted                     -> approved (records the build settings)
 *
 * Each runs in one transaction that reads the current status first, so two
 * operators cannot act on the same request twice. The second one gets
 * `status-changed`. Each appends to `history`, writes `review`, and then
 * emails the organization's Owners. A failed email does not undo the
 * decision: the answer says `mailFailed`, and the failure is logged.
 *
 * Approval records the decision only. Building the site (P8) starts from
 * `approved` and `review.settings`; nothing is started here.
 */

const { ConsoleError } = require('./http.cjs');
const {
  NOT_FOUND, applicationRef, ownerEmails, requireAppId, requireOperator, reviewedAnswers, siteNameOf,
} = require('./reviewAccess.cjs');
const { heldNames, releaseNames } = require('./siteNames.cjs');
const { statusLink } = require('./applicationStatus.cjs');
const { APPROVAL_FIELDS, approvalDefaults, checkSettings, readConsoleSettings } = require('./consoleSettings.cjs');
const { connectionProblem } = require('./connectionState.cjs');

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
 * `review(app)` returns the `review.settings` value to record, or null.
 * With `releaseName`, every `site_names` reservation the request holds
 * is deleted.
 *
 * @returns {Promise<object>} the request as it was before the change
 */
async function transition({ db, now = Date.now }, { appId, user, from, to, revision = null, note = null, review = () => null, releaseName = false }) {
  const ref = applicationRef(db, requireAppId(appId));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ConsoleError(404, 'not-found', NOT_FOUND);
    const app = { id: snap.id, ...snap.data() };
    const history = Array.isArray(app.history) ? app.history : [];
    if (!from.includes(app.status)) throw new ConsoleError(409, 'status-changed', STATUS_CHANGED);
    if (revision !== null && revision !== history.length) throw new ConsoleError(409, 'status-changed', STATUS_CHANGED);
    const held = releaseName ? await heldNames(tx, db, app.id) : [];
    // Every read is done; the writes follow.
    const settings = review(app);
    const at = new Date(now());
    tx.update(ref, {
      status: to,
      updatedAt: at,
      updatedBy: user.uid,
      history: [...history, { status: to, at, by: user.uid, note }],
      review: { note, by: user.uid, at, settings },
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

async function requestChanges(deps, input) {
  const note = requireNote(input.body.note);
  return decide(deps, input, { from: ['submitted'], to: 'changes_requested', note });
}

async function declineApplication(deps, input) {
  const note = requireNote(input.body.note);
  return decide(deps, input, { from: ['submitted', 'changes_requested'], to: 'declined', note, releaseName: true });
}

async function approveApplication(deps, input) {
  const { db } = deps;
  await requireOperator(db, input.user);
  const overrides = input.body.settings && typeof input.body.settings === 'object' ? input.body.settings : {};
  const consoleSettings = await readConsoleSettings(db);
  // Checked inside the transaction against the request as it is then, so
  // the project id comes from the name the request holds at approval.
  const review = (app) => {
    // A client can disconnect after sending the request.
    if (connectionProblem(reviewedAnswers(app)?.tickets?.choice, app.connections)) {
      throw new ConsoleError(409, 'connection-needed', 'The client has not connected the account for ticket sales, so this request cannot be approved yet.');
    }
    return checkSettings(APPROVAL_FIELDS, approvalDefaults(consoleSettings, siteNameOf(app)), overrides);
  };
  const result = await decide(deps, input, { from: ['submitted'], to: 'approved', review });
  return result;
}

module.exports = { NOTE_MAX, approveApplication, declineApplication, requestChanges, requireNote, transition };
