'use strict';

/**
 * What an operator reads during review (ADR 0007 §5): the queue, and one
 * request with its frozen answers, history, team and ticket choice.
 * Operators only, checked live against the allowlist.
 */

const { ConsoleError } = require('./http.cjs');
const { toIso, toMillis } = require('./access.cjs');
const { STATUSES, readApplication, requireOperator, reviewedAnswers, siteNameOf } = require('./reviewAccess.cjs');
const { connectionForReview } = require('./connectionState.cjs');
const { canRetryBuild, readBuild, readableBuild } = require('./buildRetry.cjs');

const QUEUE_LIMIT = 200;
const ROLE_ORDER = { owner: 0, editor: 1 };

/** Names of the given organizations, read once each. */
async function organizationNames(db, orgIds) {
  const names = new Map();
  for (const orgId of new Set(orgIds)) {
    if (typeof orgId !== 'string' || !orgId || orgId.includes('/')) continue;
    const snap = await db.collection('organizations').doc(orgId).get();
    names.set(orgId, snap.exists ? snap.data().name : '');
  }
  return names;
}

async function listApplicationsForReview({ db }, { body, user }) {
  await requireOperator(db, user);
  const status = body.status === undefined ? 'approved' : body.status;
  if (!STATUSES.includes(status)) throw new ConsoleError(400, 'bad-request', 'Choose a status.');
  // Newest change first. console/firestore.indexes.json holds the index.
  const snap = await db.collection('applications')
    .where('status', '==', status)
    .orderBy('updatedAt', 'desc')
    .limit(QUEUE_LIMIT)
    .get();
  const names = await organizationNames(db, snap.docs.map((doc) => doc.data().orgId));
  const applications = snap.docs.map((doc) => {
    const app = doc.data();
    const answers = reviewedAnswers(app);
    return {
      id: doc.id,
      orgId: app.orgId,
      organizationName: names.get(app.orgId) || '',
      eventName: answers?.event?.name || '',
      webAddressName: siteNameOf(app),
      status: app.status,
      submittedAt: toIso(app.submittedAt),
      updatedAt: toIso(app.updatedAt),
      buildStartFailed: app.buildStart?.state === 'failed',
    };
  });
  return { body: { status, applications } };
}

/** The team as the Team page shows it: members, then invites still open. */
async function readTeam(db, orgId, at) {
  const orgRef = db.collection('organizations').doc(orgId);
  const [memberSnap, inviteSnap] = await Promise.all([
    orgRef.collection('members').get(),
    db.collection('invites').where('orgId', '==', orgId).where('status', '==', 'pending').get(),
  ]);
  const members = memberSnap.docs
    .map((doc) => ({ uid: doc.id, email: doc.data().email, role: doc.data().role, joinedAt: toIso(doc.data().joinedAt) }))
    .sort((a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || String(a.email).localeCompare(String(b.email)));
  const invites = inviteSnap.docs
    .filter((doc) => toMillis(doc.data().expiresAt) > at)
    .map((doc) => ({ id: doc.id, email: doc.data().email, role: doc.data().role, expiresAt: toIso(doc.data().expiresAt) }))
    .sort((a, b) => String(a.email).localeCompare(String(b.email)));
  return { members, invites };
}

/** History with times as text and, for a team member, the email of who acted. */
function readableHistory(history, members) {
  const emails = new Map(members.map((m) => [m.uid, m.email]));
  return (Array.isArray(history) ? history : []).map((entry) => ({
    status: entry.status,
    at: toIso(entry.at),
    by: entry.by || null,
    byEmail: emails.get(entry.by) || null,
    note: entry.note || null,
  }));
}

function readableReview(review) {
  if (!review) return null;
  return { note: review.note || null, by: review.by || null, at: toIso(review.at), settings: review.settings || null };
}

/** The acceptance and the build start, for the hosting team. */
function readableProgress(app) {
  const accepted = app.agreementAcceptance;
  return {
    acceptance: accepted ? { id: accepted.id, version: accepted.version, sha256: accepted.sha256, name: accepted.name, legalName: accepted.legalName || null, title: accepted.title || null, email: accepted.email, at: toIso(accepted.at) } : null,
    buildStart: app.buildStart ? { state: app.buildStart.state, at: toIso(app.buildStart.at) } : null,
  };
}

async function getApplicationForReview({ db, now = Date.now }, { body, user }) {
  await requireOperator(db, user);
  const app = await readApplication(db, body.appId);
  const [orgSnap, team, build] = await Promise.all([
    db.collection('organizations').doc(String(app.orgId)).get(),
    readTeam(db, String(app.orgId), now()),
    readBuild((r) => r.get(), db, app.id),
  ]);
  const answers = reviewedAnswers(app);
  return {
    body: {
      application: {
        id: app.id,
        orgId: app.orgId,
        status: app.status,
        // A draft has no frozen copy, and a draft is what an operator can decline.
        answers: app.frozen || app.answers || null,
        ticketChoice: answers?.tickets?.choice || null,
        webAddressName: siteNameOf(app),
        // Sent back with a decision, so a page opened before a change is refused.
        revision: Array.isArray(app.history) ? app.history.length : 0,
        history: readableHistory(app.history, team.members),
        review: readableReview(app.review),
        ...readableProgress(app),
        createdAt: toIso(app.createdAt),
        submittedAt: toIso(app.submittedAt),
        updatedAt: toIso(app.updatedAt),
      },
      organization: { id: app.orgId, name: orgSnap.exists ? orgSnap.data().name : '' },
      team,
      connection: connectionForReview(answers?.tickets?.choice, app.connections),
      build: readableBuild(build),
      canRetryBuild: canRetryBuild(app, build, now()),
    },
  };
}

module.exports = { getApplicationForReview, listApplicationsForReview };
