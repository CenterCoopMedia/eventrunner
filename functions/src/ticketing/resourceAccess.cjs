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
const { resolveAdminTier } = require('../core/auth.cjs');

const ACCESS_UPDATING = Object.freeze({ ok: false, status: 403, code: 'access-updating',
  message: 'Access updating. Try again in a few minutes.' });
const NOT_INCLUDED = Object.freeze({ ok: false, status: 403, code: 'ticket-resource',
  message: 'Your ticket does not include this session.' });
const RESOURCE_NOT_INCLUDED = Object.freeze({ ...NOT_INCLUDED,
  message: 'Your ticket does not include this part of the event.' });

const RESOURCES = Object.freeze(['interactions', 'directory', 'attendeeUpdates']);

/**
 * The checks every resource shares: legacy mode and the exemptions admit,
 * a sweep in progress or a grant from another revision is "access updating".
 * Returns a final decision, or the current grant's resources to test.
 */
function currentResources({ control, account, grant }) {
  if (!control || control.effectiveRevision === 0) return { decision: { ok: true } };
  if (account?.speakerId != null) return { decision: { ok: true } };
  if (account?.registrationStatus === 'approved' && account?.approvalSource === 'admin') return { decision: { ok: true } };
  const revision = control.effectiveRevision;
  if (!Number.isSafeInteger(revision) || revision < 1 || (control.candidateRevision ?? null) !== null) return { decision: ACCESS_UPDATING };
  if (!grant || grant.policyRevision !== revision) return { decision: ACCESS_UPDATING };
  return { resources: grant.resources ?? {} };
}

/**
 * @param {{ control: object|null, account: object|null, grant: object|null,
 *           session: object|null, sessionId: string, interactions?: boolean }} input
 * @returns {{ ok: true } | typeof ACCESS_UPDATING | typeof NOT_INCLUDED}
 */
function decideSessionGrant({ control, account, grant, session, sessionId, interactions = false }) {
  const { decision, resources } = currentResources({ control, account, grant });
  if (decision) return decision;
  const sessions = resources.sessions;
  const list = (value) => (Array.isArray(value) ? value : []);
  const covered = sessions?.all === true || list(sessions?.sessionIds).includes(sessionId) ||
    (typeof session?.dayId === 'string' && list(sessions?.dayIds).includes(session.dayId));
  if (!covered || (interactions && resources.interactions !== true)) return NOT_INCLUDED;
  return { ok: true };
}

/**
 * The same decision for a resource that is not tied to a session: the
 * social feed (`interactions`), the directory or attendee updates.
 *
 * @param {{ control: object|null, account: object|null, grant: object|null,
 *           resource: 'interactions'|'directory'|'attendeeUpdates' }} input
 * @returns {{ ok: true } | typeof ACCESS_UPDATING | typeof RESOURCE_NOT_INCLUDED}
 */
function decideResourceGrant({ control, account, grant, resource }) {
  if (!RESOURCES.includes(resource)) throw new TypeError(`Unknown ticket resource: ${resource}`);
  const { decision, resources } = currentResources({ control, account, grant });
  if (decision) return decision;
  return resources[resource] === true ? { ok: true } : RESOURCE_NOT_INCLUDED;
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
 * and the retry decides again. `decide` receives { control, account, grant }.
 * `bootstrapEmail` is the verified address of a caller the attendee gate
 * admitted from its cached bootstrap copy; the exemption is confirmed here
 * from the live document, as the rules do. Throws SessionGrantError on denial.
 */
async function assertGrant({ db, tx, uid, bootstrapEmail, decide }) {
  const control = (await tx.get(db.collection(POLICIES).doc('current'))).data() ?? null;
  if (!control || control.effectiveRevision === 0) return;
  if (bootstrapEmail) {
    const bootstrap = (await tx.get(db.collection('config').doc('bootstrap'))).data() ?? null;
    if (resolveAdminTier(bootstrap, bootstrapEmail.trim().toLowerCase()) !== null) return;
  }
  const [accountSnap, grantSnap] = await Promise.all([
    tx.get(db.collection('users').doc(uid)),
    tx.get(db.collection(GRANTS).doc(uid)),
  ]);
  const decision = decide({ control, account: accountSnap.data() ?? null, grant: grantSnap.data() ?? null });
  if (!decision.ok) throw new SessionGrantError(decision);
}

/** `session` is the cmsSchedule data the caller's transaction already read. */
function assertSessionGrant({ db, tx, uid, sessionId, session, interactions = false, bootstrapEmail = null }) {
  return assertGrant({ db, tx, uid, bootstrapEmail,
    decide: (input) => decideSessionGrant({ ...input, session, sessionId, interactions }) });
}

function assertResourceGrant({ db, tx, uid, resource, bootstrapEmail = null }) {
  return assertGrant({ db, tx, uid, bootstrapEmail,
    decide: (input) => decideResourceGrant({ ...input, resource }) });
}

module.exports = {
  decideSessionGrant, decideResourceGrant, assertSessionGrant, assertResourceGrant, SessionGrantError,
};
