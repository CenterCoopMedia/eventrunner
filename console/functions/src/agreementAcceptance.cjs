'use strict';

/**
 * The agreement step (ADR 0007, amendment 2026-11-04).
 *
 * `agreement_acceptances/{id}` is the signed record: { version, sha256,
 * typedName, email, uid, orgId, appId, at }. It is only ever created, the
 * rules give the browser no access, and it outlives the request. The
 * request's `agreementAcceptance` is a pointer to the current one. Going
 * back to edit clears the pointer and leaves the record.
 */

const { ConsoleError } = require('./http.cjs');
const { requireMemberOrOperator, requireOwner, toIso } = require('./access.cjs');
const { checkAnswers } = require('./checks.cjs');
const { AWAITING_PAYMENT, historyEntry, readApplication } = require('./applications.cjs');
const { readAgreementVersion, readSignupTerms, signupsClosed } = require('./consoleSettings.cjs');
const { answersToFreeze, notifyOwners, refuseIncomplete, statusLink, takeSubmitSlot } = require('./applicationStatus.cjs');
const { closeOpenCheckout, refuseNewCheckout } = require('./feeCheckout.cjs');

const COLLECTION = 'agreement_acceptances';
const NAME_MIN = 2;
const NAME_MAX = 200;

/**
 * getAgreement: the text a member reads. Once accepted, the accepted
 * version, even when a newer one exists. `agreement` is null when none is
 * set, and the step then says the site is not taking sign-ups.
 */
async function getAgreement({ db }, { body, user }) {
  const { orgId, appId } = body;
  await requireMemberOrOperator(db, orgId, user);
  const { data } = await readApplication((r) => r.get(), db, orgId, appId);
  const accepted = data.agreementAcceptance || null;
  const agreement = accepted
    ? await readAgreementVersion((r) => r.get(), db, accepted.version)
    : (await readSignupTerms((r) => r.get(), db)).agreement;
  return {
    body: {
      agreement,
      accepted: accepted ? { version: accepted.version, name: accepted.name, email: accepted.email, at: toIso(accepted.at) } : null,
    },
  };
}

function refuseStatus(status) {
  if (status === 'draft') return;
  if (status === 'changes_requested') {
    throw new ConsoleError(409, 'locked', 'The hosting team asked for changes, so send the request back to them.');
  }
  throw new ConsoleError(409, 'locked', 'This request already moved past the agreement.');
}

function typedName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    const err = new ConsoleError(400, 'name-required', 'Type your full name to accept the agreement.');
    err.field = 'name';
    throw err;
  }
  return name;
}

/** Email the signer a copy. A failed email is logged and does not undo the acceptance. */
async function sendCopy({ db, mailer, log, publicUrl }, { user, orgId, appId, eventName, agreement, name, at }) {
  try {
    const organizationName = (await db.collection('organizations').doc(orgId).get()).data().name;
    await mailer.sendAgreementCopy({
      to: user.email,
      organizationName,
      eventName,
      title: agreement.title,
      version: agreement.version,
      body: agreement.body,
      sha256: agreement.sha256,
      typedName: name,
      acceptedAt: at.toISOString(),
      link: statusLink(publicUrl, orgId, appId),
    });
    return true;
  } catch (err) {
    log.error('console agreement copy failed', err);
    return false;
  }
}

/**
 * acceptAgreement: an Owner accepts the version the page showed. Freezes
 * the answers, writes the record and sets `awaiting_payment` in one
 * transaction, so there is no state with one and not the others.
 */
async function acceptAgreement(deps, { body, user }) {
  const { db, now = Date.now, log = console } = deps;
  const { orgId, appId } = body;
  await requireOwner(db, orgId, user, 'Only an Owner can accept the agreement.');
  const first = await readApplication((r) => r.get(), db, orgId, appId);
  refuseStatus(first.data.status);
  if (body.accept !== true) throw new ConsoleError(400, 'accept-required', 'Select Accept the agreement to continue.');
  const name = typedName(body.name);
  if (!(await readSignupTerms((r) => r.get(), db)).open) throw signupsClosed();
  refuseIncomplete(checkAnswers(first.data.answers));
  await takeSubmitSlot(db, user, now);

  const at = new Date(now());
  const recordRef = db.collection(COLLECTION).doc();
  const { eventName, agreement } = await db.runTransaction(async (tx) => {
    const { ref, data } = await readApplication((r) => tx.get(r), db, orgId, appId);
    refuseStatus(data.status);
    const terms = await readSignupTerms((r) => tx.get(r), db);
    if (!terms.open) throw signupsClosed();
    if (terms.agreement.version !== body.version) {
      throw new ConsoleError(409, 'agreement-changed', 'The agreement changed. Read the new version, then accept it.');
    }
    const answers = await answersToFreeze(tx, db, appId, data);
    const { version, sha256 } = terms.agreement;
    tx.create(recordRef, { version, sha256, typedName: name, email: user.email, uid: user.uid, orgId, appId, at });
    tx.update(ref, {
      status: AWAITING_PAYMENT,
      frozen: answers,
      submittedAt: at,
      submittedBy: user.uid,
      agreementAcceptance: { id: recordRef.id, version, sha256, name, email: user.email, at },
      feeCheckout: null,
      updatedAt: at,
      updatedBy: user.uid,
      history: [...(Array.isArray(data.history) ? data.history : []), historyEntry(AWAITING_PAYMENT, at, user.uid)],
    });
    return { eventName: answers.event.name, agreement: terms.agreement };
  });

  const mail = { ...deps, log };
  const copySent = await sendCopy(mail, { user, orgId, appId, eventName, agreement, name, at });
  const ownersEmailed = await notifyOwners(mail, { orgId, appId, status: AWAITING_PAYMENT, eventName });
  return { body: { status: AWAITING_PAYMENT, acceptanceId: recordRef.id, copySent, emailed: ownersEmailed } };
}

/**
 * reopenApplication: an Owner goes back to edit before paying. Closes the
 * payment page first, so no one can pay for answers that are changing.
 */
async function reopenApplication(deps, { body, user }) {
  const { db, stripe, now = Date.now, log = console } = deps;
  const { orgId, appId } = body;
  await requireOwner(db, orgId, user, 'Only an Owner can go back to change the answers.');
  const refuse = (status) => {
    if (status !== AWAITING_PAYMENT) throw new ConsoleError(409, 'locked', 'This request is not waiting for payment.');
  };
  const first = await readApplication((r) => r.get(), db, orgId, appId);
  refuse(first.data.status);
  await closeOpenCheckout(stripe, first.data);

  const at = new Date(now());
  const eventName = await db.runTransaction(async (tx) => {
    const { ref, data } = await readApplication((r) => tx.get(r), db, orgId, appId);
    refuse(data.status);
    refuseNewCheckout(first.data, data);
    tx.update(ref, {
      status: 'draft',
      frozen: null,
      submittedAt: null,
      submittedBy: null,
      agreementAcceptance: null,
      feeCheckout: null,
      updatedAt: at,
      updatedBy: user.uid,
      history: [...(Array.isArray(data.history) ? data.history : []), historyEntry('draft', at, user.uid)],
    });
    return data.frozen?.event?.name || '';
  });
  const emailed = await notifyOwners({ ...deps, log }, { orgId, appId, status: 'draft', eventName });
  return { body: { status: 'draft', emailed } };
}

module.exports = { COLLECTION, acceptAgreement, getAgreement, reopenApplication };
