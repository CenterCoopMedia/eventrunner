'use strict';

/**
 * What an operator reads during review (ADR 0007 §5): the queue, and one
 * request with its frozen answers, history, team and ticket choice.
 * Operators only, checked live against the allowlist.
 */

const { ConsoleError } = require('./http.cjs');
const { toIso, toMillis } = require('./access.cjs');
const { STATUSES, readApplication, requireOperator, reviewedAnswers, siteNameOf } = require('./reviewAccess.cjs');
const { approvalDefaults, readConsoleSettings } = require('./consoleSettings.cjs');
const { connectionForReview } = require('./connectionState.cjs');

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
  const status = body.status === undefined ? 'submitted' : body.status;
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
      feeProblem: app.feeProblem?.code || null,
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

/** The current acceptance and the payment, for the hosting team. */
function readablePayment(app) {
  const accepted = app.agreementAcceptance;
  const paid = app.payment;
  return {
    acceptance: accepted ? { id: accepted.id, version: accepted.version, sha256: accepted.sha256, name: accepted.name, email: accepted.email, at: toIso(accepted.at) } : null,
    payment: paid ? { sessionId: paid.sessionId, paymentIntentId: paid.paymentIntentId, amount: paid.amount, currency: paid.currency, paidAt: toIso(paid.paidAt) } : null,
    buildStart: app.buildStart ? { state: app.buildStart.state, at: toIso(app.buildStart.at) } : null,
    feeProblem: app.feeProblem ? { code: app.feeProblem.code, sessionId: app.feeProblem.sessionId, paymentIntentId: app.feeProblem.paymentIntentId || null, at: toIso(app.feeProblem.at) } : null,
  };
}

async function getApplicationForReview({ db, now = Date.now }, { body, user }) {
  await requireOperator(db, user);
  const app = await readApplication(db, body.appId);
  const [orgSnap, team, settings] = await Promise.all([
    db.collection('organizations').doc(String(app.orgId)).get(),
    readTeam(db, String(app.orgId), now()),
    readConsoleSettings(db),
  ]);
  const name = siteNameOf(app);
  return {
    body: {
      application: {
        id: app.id,
        orgId: app.orgId,
        status: app.status,
        answers: app.frozen || null,
        ticketChoice: app.frozen?.tickets?.choice || null,
        webAddressName: name,
        // Sent back with a decision, so a page opened before a change is refused.
        revision: Array.isArray(app.history) ? app.history.length : 0,
        history: readableHistory(app.history, team.members),
        review: readableReview(app.review),
        ...readablePayment(app),
        createdAt: toIso(app.createdAt),
        submittedAt: toIso(app.submittedAt),
        updatedAt: toIso(app.updatedAt),
      },
      organization: { id: app.orgId, name: orgSnap.exists ? orgSnap.data().name : '' },
      team,
      connection: connectionForReview(app.frozen?.tickets?.choice, app.connections),
      approvalDefaults: approvalDefaults(settings, name),
    },
  };
}

module.exports = { getApplicationForReview, listApplicationsForReview };
