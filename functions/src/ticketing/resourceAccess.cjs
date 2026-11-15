'use strict';

/**
 * Session-scoped ticket resource enforcement (#557). Granular mode starts only
 * after a policy revision is published (effectiveRevision >= 1); before that,
 * and when no policy exists, the binary attendee gate is the whole decision.
 *
 * In granular mode verified speakers and admin-approved accounts keep full
 * access. Every other approved account needs its private grant for the current
 * effective revision; a grant from another revision or a sweep in progress
 * fails closed as "access updating". The session's day comes from cmsSchedule,
 * never from the request. Bookmark and reaction transactions call
 * assertSessionGrant; firestore.rules `ticketSessionGranted` mirrors it
 * for note writes; both read __fixtures__/session-grant-cases.json in tests.
 */

const { internals: { POLICIES, GRANTS } } = require('./resourceGrants.cjs');

const ACCESS_UPDATING = Object.freeze({ ok: false, status: 403, code: 'access-updating',
  message: 'Access updating. Try again in a few minutes.' });
const NOT_INCLUDED = Object.freeze({ ok: false, status: 403, code: 'ticket-resource',
  message: 'Your ticket does not include this session.' });

/**
 * @param {{ control: object|null, account: object|null, grant: object|null,
 *           session: object|null, sessionId: string, interactions?: boolean }} input
 * @returns {{ ok: true } | typeof ACCESS_UPDATING | typeof NOT_INCLUDED}
 */
function decideSessionGrant({ control, account, grant, session, sessionId, interactions = false }) {
  if (!control || control.effectiveRevision === 0) return { ok: true };
  if (account?.speakerId != null) return { ok: true };
  if (account?.registrationStatus === 'approved' && account?.approvalSource === 'admin') return { ok: true };
  const revision = control.effectiveRevision;
  if (!Number.isSafeInteger(revision) || revision < 1 || (control.candidateRevision ?? null) !== null) return ACCESS_UPDATING;
  if (!grant || grant.policyRevision !== revision) return ACCESS_UPDATING;
  const sessions = grant.resources?.sessions;
  const list = (value) => (Array.isArray(value) ? value : []);
  const covered = sessions?.all === true || list(sessions?.sessionIds).includes(sessionId) ||
    (typeof session?.dayId === 'string' && list(sessions?.dayIds).includes(session.dayId));
  if (!covered || (interactions && grant.resources?.interactions !== true)) return NOT_INCLUDED;
  return { ok: true };
}

/** A session write the caller's ticket grant does not allow; carries the decision. */
class SessionGrantError extends Error {
  constructor(decision) {
    super(decision.message);
    this.name = 'SessionGrantError';
    this.decision = decision;
  }
}

/**
 * Read the account, control and grant inside the caller's write transaction,
 * so a concurrent refund, revocation or publication conflicts with the write
 * and the retry decides again. `session` is the cmsSchedule data that
 * transaction already read. Throws SessionGrantError on denial.
 */
async function assertSessionGrant({ db, tx, uid, sessionId, session, interactions = false }) {
  const control = (await tx.get(db.collection(POLICIES).doc('current'))).data() ?? null;
  if (!control || control.effectiveRevision === 0) return;
  const [accountSnap, grantSnap] = await Promise.all([
    tx.get(db.collection('users').doc(uid)),
    tx.get(db.collection(GRANTS).doc(uid)),
  ]);
  const decision = decideSessionGrant({ control, account: accountSnap.data() ?? null,
    grant: grantSnap.data() ?? null, session, sessionId, interactions });
  if (!decision.ok) throw new SessionGrantError(decision);
}

module.exports = { decideSessionGrant, assertSessionGrant, SessionGrantError };
