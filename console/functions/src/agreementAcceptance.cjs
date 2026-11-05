'use strict';

/**
 * The agreement step (ADR 0007, amendment 2026-11-04).
 *
 * `agreement_acceptances/{id}` is the signed record: { version, sha256,
 * typedName, email, uid, orgId, appId, at }. It is only ever created, the
 * rules give the browser no access, and it outlives the request. The
 * request's `agreementAcceptance` is a pointer to it. Accepting starts the
 * build: no operator approves it and nothing holds it.
 */

const { ConsoleError } = require('./http.cjs');
const { requireMemberOrOperator, requireOwner, toIso } = require('./access.cjs');
const { checkAnswers } = require('./checks.cjs');
const { runStartBuild } = require('./buildDispatch.cjs');
const { historyEntry, readApplication } = require('./applications.cjs');
const { readAgreementVersion, readSignupTerms, signupsClosed } = require('./consoleSettings.cjs');
const { answersToFreeze, notifyOperators, notifyOwners, refuseIncomplete, statusLink, takeSubmitSlot } = require('./applicationStatus.cjs');

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
      accepted: accepted ? { version: accepted.version, name: accepted.name, legalName: accepted.legalName || null, title: accepted.title || null, email: accepted.email, at: toIso(accepted.at) } : null,
    },
  };
}

function refuseStatus(status) {
  if (status === 'draft') return;
  throw new ConsoleError(409, 'locked', 'This request already moved past the agreement.');
}

function typed(value, field, message) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (text.length < NAME_MIN || text.length > NAME_MAX) {
    const err = new ConsoleError(400, `${field}-required`, message);
    err.field = field;
    throw err;
  }
  return text;
}

/** Email the signer a copy. A failed email is logged and does not undo the acceptance. */
async function sendCopy({ db, mailer, log, publicUrl }, { user, orgId, appId, eventName, agreement, name, legalName, title, at }) {
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
      legalName,
      signerTitle: title,
      acceptedAt: at.toISOString(),
      link: statusLink(publicUrl, orgId, appId),
    });
    return true;
  } catch (err) {
    log.error('console agreement copy failed', err);
    return false;
  }
}

/** One step after the commit. A failure is logged, and the next step still runs. */
async function isolated(log, what, step) {
  try {
    return await step();
  } catch (err) {
    log.error(`console acceptance: ${what} failed`, err);
    return false;
  }
}

/**
 * acceptAgreement: an Owner accepts the version the page showed. Freezes the
 * answers, writes the record and sets `approved` in one transaction, so there
 * is no state with one and not the others. The build starts first after that,
 * so a slow email can never lose it. A failed start is not an error to the
 * client: the status page shows it, and the Owners' email says it did not
 * finish rather than promise another email that would never come.
 */
async function acceptAgreement(deps, { body, user }) {
  const { db, now = Date.now, log = console, consoleTestMode: testMode = false } = deps;
  const { orgId, appId } = body;
  await requireOwner(db, orgId, user, 'Only an Owner can accept the agreement.');
  const first = await readApplication((r) => r.get(), db, orgId, appId);
  refuseStatus(first.data.status);
  if (body.accept !== true) throw new ConsoleError(400, 'accept-required', 'Select Accept the agreement to continue.');
  const name = typed(body.name, 'name', 'Type your full name to accept the agreement.');
  const legalName = typed(body.legalName, 'legalName', "Type your organization's legal name to accept the agreement.");
  const title = typed(body.title, 'title', 'Type your job title to accept the agreement.');
  if (!(await readSignupTerms((r) => r.get(), db)).open) throw signupsClosed();
  refuseIncomplete(checkAnswers(first.data.answers, first.data.connections, { testMode }));
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
    const answers = await answersToFreeze(tx, db, appId, data, { testMode });
    const { version, sha256 } = terms.agreement;
    tx.create(recordRef, { version, sha256, typedName: name, legalName, title, email: user.email, uid: user.uid, orgId, appId, at });
    tx.update(ref, {
      status: 'approved',
      frozen: answers,
      submittedAt: at,
      submittedBy: user.uid,
      agreementAcceptance: { id: recordRef.id, version, sha256, name, legalName, title, email: user.email, at },
      buildStart: { state: 'pending', at },
      updatedAt: at,
      updatedBy: user.uid,
      history: [...(Array.isArray(data.history) ? data.history : []), historyEntry('approved', at, user.uid)],
    });
    return { eventName: answers.event.name, agreement: terms.agreement };
  });

  const after = { ...deps, now, log };
  const buildStarted = await isolated(log, 'the build start', () => runStartBuild(after, { orgId, appId, eventName, by: user.uid }));
  // Right after the start, so a run that fails quickly can't email first and be contradicted.
  const emailed = await isolated(log, 'the Owners email', () => notifyOwners(after, { orgId, appId, status: buildStarted ? 'approved' : 'build-failed', eventName }));
  const copySent = await isolated(log, 'the copy', () => sendCopy(after, { user, orgId, appId, eventName, agreement, name, legalName, title, at }));
  // runStartBuild has already told operators about a failed start.
  if (buildStarted) await isolated(log, 'the operators email', () => notifyOperators(after, { orgId, appId, eventName, kind: 'started' }));
  return { body: { status: 'approved', acceptanceId: recordRef.id, copySent, emailed, buildStarted } };
}

module.exports = { COLLECTION, acceptAgreement, getAgreement };
