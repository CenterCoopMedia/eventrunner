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
 * never from the request. firestore.rules `ticketSessionGranted` mirrors this
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

/** Load the current control, grant and canonical session, then decide. */
async function checkSessionGrant({ db, uid, account, sessionId, interactions = false }) {
  const control = (await db.collection(POLICIES).doc('current').get()).data() ?? null;
  if (!control || control.effectiveRevision === 0) return { ok: true };
  const [grantSnap, sessionSnap] = await Promise.all([
    db.collection(GRANTS).doc(uid).get(),
    db.collection('cmsSchedule').doc(sessionId).get(),
  ]);
  return decideSessionGrant({ control, account, grant: grantSnap.data() ?? null,
    session: sessionSnap.data() ?? null, sessionId, interactions });
}

module.exports = { decideSessionGrant, checkSessionGrant };
