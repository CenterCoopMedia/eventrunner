'use strict';

const { ConsoleError } = require('./http.cjs');
const { validOrgId } = require('./access.cjs');
const { requireOperator } = require('./reviewAccess.cjs');
const { connectionChanging } = require('./connectionState.cjs');
const {
  ACCOUNT_COLLECTION, deleteRecordedTokens, readConnectedAccounts, recordTokenDeletion,
} = require('./connections.cjs');

const UNUSED_STATUSES = ['draft', 'withdrawn', 'declined'];
const USED_MESSAGE = 'This organization has a request that was approved or a site that was built. It cannot be deleted here. Withdraw an unused draft request, or archive an existing site with the decommission workflow.';

function requireUnused(app, at) {
  const history = Array.isArray(app.history) ? app.history : [];
  if (!UNUSED_STATUSES.includes(app.status)
    || history.some((entry) => !UNUSED_STATUSES.includes(entry.status))
    || app.agreementAcceptance || app.submittedAt || app.frozen || app.buildStart
    || app.review?.settings?.projectId) {
    throw new ConsoleError(409, 'organization-in-use', USED_MESSAGE);
  }
  if (connectionChanging(app.connections, at)) {
    throw new ConsoleError(409, 'connection-busy', 'An account on this organization is being changed. Try again in a few minutes.');
  }
}

/** Check every dependency and delete the organization in the same transaction. */
async function deleteOrganization(deps, { body, user }) {
  const { db, now = Date.now, log = console } = deps;
  await requireOperator(db, user);
  const { orgId } = body;
  if (!validOrgId(orgId)) throw new ConsoleError(400, 'bad-request', 'Choose an organization.');
  if (body.confirm !== true) throw new ConsoleError(400, 'confirm-required', 'Confirm that you want to delete this organization.');
  const orgRef = db.collection('organizations').doc(orgId);
  const at = new Date(now());
  const cleanup = await db.runTransaction(async (tx) => {
    const [org, applications, members, invites, links, states, names, acceptances] = await Promise.all([
      tx.get(orgRef),
      tx.get(db.collection('applications').where('orgId', '==', orgId)),
      tx.get(orgRef.collection('members')),
      tx.get(db.collection('invites').where('orgId', '==', orgId)),
      tx.get(db.collection('signup_links').where('orgId', '==', orgId)),
      tx.get(db.collection('console_connection_states').where('orgId', '==', orgId)),
      tx.get(db.collection('site_names').where('orgId', '==', orgId)),
      tx.get(db.collection('agreement_acceptances').where('orgId', '==', orgId).limit(1)),
    ]);
    if (!org.exists) throw new ConsoleError(404, 'not-found', 'We could not find that organization.');
    // Acceptance records survive request retention, so past approval still blocks deletion.
    if (!acceptances.empty) throw new ConsoleError(409, 'organization-in-use', USED_MESSAGE);
    const linked = new Map(links.docs.map((doc) => [doc.ref.path, doc.ref]));
    const accounts = [];
    for (const app of applications.docs) {
      const data = app.data();
      requireUnused(data, at.getTime());
      const [build, connected, held, appLinks] = await Promise.all([
        tx.get(db.collection('console_builds').doc(app.id)),
        readConnectedAccounts(tx, db, app.id),
        tx.get(db.collection('site_names').where('appId', '==', app.id)),
        tx.get(db.collection('signup_links').where('appId', '==', app.id)),
      ]);
      if (build.exists) throw new ConsoleError(409, 'organization-in-use', USED_MESSAGE);
      for (const doc of [...held.docs, ...appLinks.docs]) linked.set(doc.ref.path, doc.ref);
      if (validOrgId(data.signupLinkId)) {
        const link = await tx.get(db.collection('signup_links').doc(data.signupLinkId));
        if (link.exists && (link.data().orgId === orgId || link.data().appId === app.id)) linked.set(link.ref.path, link.ref);
      }
      accounts.push({ appId: app.id, connected });
    }
    // All reads precede writes. A refusal or a concurrent acceptance leaves everything intact.
    for (const snap of [applications, members, invites, states, names]) {
      for (const doc of snap.docs) tx.delete(doc.ref);
    }
    for (const ref of linked.values()) tx.delete(ref);
    for (const { appId, connected } of accounts) {
      tx.delete(db.collection(ACCOUNT_COLLECTION).doc(appId));
      recordTokenDeletion(tx, db, appId, connected, at);
    }
    tx.delete(orgRef);
    tx.create(db.collection('console_audit').doc(), { action: 'delete-organization', orgId, by: user.uid, at });
    return accounts;
  });
  // Reuse durable token cleanup: failures stay findable for the retention job.
  for (const { appId, connected } of cleanup) {
    await deleteRecordedTokens(deps, appId, connected)
      .catch((err) => log.error('console will try again to delete stored tokens', appId, err.message));
  }
  return { body: { orgId, deleted: true } };
}

module.exports = { deleteOrganization };
