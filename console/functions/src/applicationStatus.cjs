'use strict';

/**
 * The client's status changes (ADR 0007 §3 and §5): send a held-back
 * request again (submitApplication) and withdraw a request
 * (withdrawApplication). Owners only. A new request does not use
 * submitApplication: it moves on with acceptAgreement.
 *
 * Each change appends to `history` and emails the client's Owners. A send
 * also emails each operator in `console_config/operators`. The email goes
 * after the change is saved, and a failed email does not undo it: the
 * failure is logged for the operator, and the status page shows the state.
 */

const { ConsoleError } = require('./http.cjs');
const { requireOwner, validOrgId } = require('./access.cjs');
const { withDefaults } = require('./answers.cjs');
const { checkAnswers } = require('./checks.cjs');
const { takeSlot } = require('./rateLimit.cjs');
const { COLLECTION: SITE_NAMES, TAKEN, heldNames, releaseNames } = require('./siteNames.cjs');
const { AWAITING_PAYMENT, CLOSED, WITHDRAWABLE, historyEntry, readApplication } = require('./applications.cjs');
const { closeOpenCheckout } = require('./feeCheckout.cjs');

const DAY_MS = 24 * 60 * 60 * 1000;
const SUBMITS_PER_DAY = 5;

function statusLink(publicUrl, orgId, appId) {
  return publicUrl ? `${publicUrl}/organizations/${orgId}/applications/${appId}` : '';
}

function reviewLink(publicUrl, appId) {
  return publicUrl ? `${publicUrl}/review/${appId}` : '';
}

async function ownerEmails(db, orgId) {
  const snap = await db.collection('organizations').doc(orgId).collection('members').where('role', '==', 'owner').get();
  return [...new Set(snap.docs.map((doc) => doc.data().email).filter(Boolean))];
}

async function operatorEmails(db) {
  const snap = await db.collection('console_config').doc('operators').get();
  const list = snap.exists && Array.isArray(snap.data().emails) ? snap.data().emails : [];
  return [...new Set(list.filter((e) => typeof e === 'string').map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

/** Send each message; log a failure and carry on. @returns {Promise<boolean>} true when all went */
async function sendAll(log, sends) {
  let allSent = true;
  for (const send of sends) {
    try {
      await send();
    } catch (err) {
      allSent = false;
      log.error('console status email failed', err);
    }
  }
  return allSent;
}

/** Email the Owners that the status changed. */
async function notifyOwners({ db, mailer, log, publicUrl }, { orgId, appId, status, eventName, note = null }) {
  const organizationName = (await db.collection('organizations').doc(orgId).get()).data().name;
  const link = statusLink(publicUrl, orgId, appId);
  const owners = await ownerEmails(db, orgId);
  return sendAll(log, owners.map((to) => () => mailer.sendStatusChange({
    to, organizationName, eventName, status, link, note,
  })));
}

/** `kind` and `problem` choose the words (mailer.cjs). A payment can name an organization that is gone. */
async function notifyOperators({ db, mailer, log, publicUrl }, { orgId, appId, eventName, kind, problem }) {
  const org = validOrgId(orgId) ? await db.collection('organizations').doc(orgId).get() : null;
  const organizationName = org?.exists ? org.data().name : '';
  const link = reviewLink(publicUrl, appId);
  const operators = await operatorEmails(db);
  const extra = { ...(kind ? { kind } : {}), ...(problem ? { problem } : {}) };
  return sendAll(log, operators.map((to) => () => mailer.sendOperatorNotice({
    to, organizationName, eventName, link, ...extra,
  })));
}

const INCOMPLETE = 'Some answers need attention before you continue.';

/** @throws {ConsoleError} 400 incomplete, listing the fields */
function refuseIncomplete(errors) {
  if (Object.keys(errors).length === 0) return;
  const err = new ConsoleError(400, 'incomplete', INCOMPLETE);
  err.fields = errors;
  throw err;
}

/**
 * Inside a transaction: the answers to freeze. They are checked again on
 * this copy, in case a teammate saved since, and the request must still
 * hold its web-address name.
 */
async function answersToFreeze(tx, db, appId, data) {
  const answers = withDefaults(data.answers);
  const again = checkAnswers(answers);
  const siteName = answers.webAddress.name;
  const held = siteName ? await tx.get(db.collection(SITE_NAMES).doc(siteName)) : null;
  if (!again['webAddress.name'] && (!held?.exists || held.data().appId !== appId)) {
    again['webAddress.name'] = TAKEN.message;
  }
  refuseIncomplete(again);
  return answers;
}

/** The limit shared by the two ways to send a request. A refused send does not use a slot. */
function takeSubmitSlot(db, user, now) {
  return takeSlot(db, {
    key: `submit-app-${user.uid}`,
    max: SUBMITS_PER_DAY,
    windowMs: DAY_MS,
    now,
    message: 'You have sent too many requests today. Try again tomorrow.',
  });
}

async function submitApplication(deps, { body, user }) {
  const { db, now = Date.now, log = console } = deps;
  const { orgId, appId } = body;
  await requireOwner(db, orgId, user, 'Only an Owner can send the request.');
  const first = await readApplication((r) => r.get(), db, orgId, appId);
  const refuseStatus = (status) => {
    if (status === 'draft') throw new ConsoleError(409, 'agreement-required', 'Read and accept the agreement to continue.');
    if (status !== 'changes_requested') throw new ConsoleError(409, 'locked', 'This request was already sent.');
  };
  refuseStatus(first.data.status);
  refuseIncomplete(checkAnswers(first.data.answers));
  await takeSubmitSlot(db, user, now);

  const at = new Date(now());
  const eventName = await db.runTransaction(async (tx) => {
    const { ref, data } = await readApplication((r) => tx.get(r), db, orgId, appId);
    refuseStatus(data.status);
    const answers = await answersToFreeze(tx, db, appId, data);
    tx.update(ref, {
      status: 'submitted',
      frozen: answers,
      submittedAt: at,
      submittedBy: user.uid,
      updatedAt: at,
      updatedBy: user.uid,
      history: [...(Array.isArray(data.history) ? data.history : []), historyEntry('submitted', at, user.uid)],
    });
    return answers.event.name;
  });

  const mail = { ...deps, log };
  const clientSent = await notifyOwners(mail, { orgId, appId, status: 'submitted', eventName });
  const operatorsSent = await notifyOperators(mail, { orgId, appId, eventName });
  return { body: { status: 'submitted', submittedAt: at.toISOString(), emailed: clientSent && operatorsSent } };
}

async function withdrawApplication(deps, { body, user }) {
  const { db, now = Date.now, log = console } = deps;
  const { orgId, appId } = body;
  await requireOwner(db, orgId, user, 'Only an Owner can withdraw the request.');
  const refuseStatus = (status) => {
    if (CLOSED.includes(status)) throw new ConsoleError(409, 'locked', 'This request is already closed.');
    if (!WITHDRAWABLE.includes(status)) {
      throw new ConsoleError(409, 'locked', 'We already approved this request, so you cannot withdraw it here. Contact the hosting team.');
    }
  };
  const first = await readApplication((r) => r.get(), db, orgId, appId);
  refuseStatus(first.data.status);
  // No payment page stays open for a request that is gone.
  if (first.data.status === AWAITING_PAYMENT) await closeOpenCheckout(deps.stripe, first.data);
  const at = new Date(now());
  const eventName = await db.runTransaction(async (tx) => {
    const { ref, data } = await readApplication((r) => tx.get(r), db, orgId, appId);
    refuseStatus(data.status);
    const held = await heldNames(tx, db, appId);
    releaseNames(tx, db, held);
    tx.update(ref, {
      status: 'withdrawn',
      updatedAt: at,
      updatedBy: user.uid,
      history: [...(Array.isArray(data.history) ? data.history : []), historyEntry('withdrawn', at, user.uid)],
    });
    return withDefaults(data.answers).event.name;
  });
  const emailed = await notifyOwners({ ...deps, log }, { orgId, appId, status: 'withdrawn', eventName });
  return { body: { status: 'withdrawn', emailed } };
}

module.exports = {
  SUBMITS_PER_DAY,
  answersToFreeze,
  notifyOperators,
  notifyOwners,
  refuseIncomplete,
  statusLink,
  submitApplication,
  takeSubmitSlot,
  withdrawApplication,
};
