'use strict';

/**
 * saveApplicationStep (ADR 0007 §3): one step's answers, saved as the
 * client types. A member saves while the request is a draft or has
 * changes requested.
 *
 * Every step but the web address saves what it gets, even when a check
 * fails, so a half-typed answer is not lost; the reply carries the step's
 * errors by field. The web-address step saves only a name the request can
 * hold: it reserves `site_names/{name}` and releases the request's old
 * name in the same transaction, so two requests never hold one name.
 */

const { ConsoleError } = require('./http.cjs');
const { ANSWER_STEPS, cleanStep, withDefaults } = require('./answers.cjs');
const { checkAnswers, stepErrors } = require('./checks.cjs');
const { COLLECTION: SITE_NAMES, TAKEN, heldNames, releaseNames, siteNameProblem } = require('./siteNames.cjs');
const { EDITABLE, readApplication, requireMember } = require('./applications.cjs');

const LOCKED = 'This request is with the hosting team, so you cannot change it now.';

/**
 * Inside the transaction: the web-address reads and writes.
 * @returns {Promise<Record<string, string>|null>} a field error, or null when the name is saved
 */
async function reserveSiteName(tx, db, { appId, orgId, name, at }) {
  const held = await heldNames(tx, db, appId);
  if (!name) {
    releaseNames(tx, db, held);
    return null;
  }
  const problem = siteNameProblem(name);
  if (problem) return { 'webAddress.name': problem.message };
  const ref = db.collection(SITE_NAMES).doc(name);
  const snap = await tx.get(ref);
  if (snap.exists && snap.data().appId !== appId) return { 'webAddress.name': TAKEN.message };
  if (!snap.exists) tx.create(ref, { appId, orgId, reservedAt: at });
  releaseNames(tx, db, held.filter((other) => other !== name));
  return null;
}

async function saveApplicationStep({ db, now = Date.now }, { body, user }) {
  const { orgId, appId, step } = body;
  if (!ANSWER_STEPS.includes(step)) throw new ConsoleError(400, 'bad-request', 'Choose a step.');
  await requireMember(db, orgId, user);
  const clean = cleanStep(step, body.answers);
  const at = new Date(now());

  const outcome = await db.runTransaction(async (tx) => {
    const { ref, data } = await readApplication((r) => tx.get(r), db, orgId, appId);
    if (!EDITABLE.includes(data.status)) throw new ConsoleError(409, 'locked', LOCKED);
    if (step === 'webAddress') {
      const refusal = await reserveSiteName(tx, db, { appId, orgId, name: clean.name, at });
      if (refusal) return { saved: false, errors: refusal };
    }
    const answers = { ...withDefaults(data.answers), [step]: clean };
    tx.update(ref, { answers, updatedAt: at, updatedBy: user.uid });
    return { saved: true, errors: stepErrors(checkAnswers(answers), step) };
  });

  return {
    body: {
      step,
      saved: outcome.saved,
      answers: clean,
      errors: outcome.errors,
      updatedAt: outcome.saved ? at.toISOString() : null,
    },
  };
}

module.exports = { saveApplicationStep, LOCKED };
