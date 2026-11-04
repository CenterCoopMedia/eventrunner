'use strict';

/**
 * Shared parts of operator review (ADR 0007 §5): the operator gate, the
 * application lookup, the Owners to email, and the web-address name.
 *
 * `applications/{appId}` is written by the guided setup (P5) and by these
 * review functions. Only review writes `review`.
 */

const { ConsoleError } = require('./http.cjs');
const { isOperator, validOrgId } = require('./access.cjs');

const STATUSES = Object.freeze(['draft', 'approved', 'building', 'ready', 'launched', 'withdrawn', 'declined']);

const NOT_OPERATOR = 'This page is for the hosting team.';
const NOT_FOUND = 'We could not find that request.';

/**
 * The caller must be on the operator allowlist, read live on each call.
 * @throws {ConsoleError} 403 not-operator
 */
async function requireOperator(db, user) {
  if (!(await isOperator(db, user.email))) throw new ConsoleError(403, 'not-operator', NOT_OPERATOR);
}

/** @throws {ConsoleError} 400 when the id is not one document id */
function requireAppId(appId) {
  if (!validOrgId(appId)) throw new ConsoleError(400, 'bad-request', 'Choose a request.');
  return appId;
}

function applicationRef(db, appId) {
  return db.collection('applications').doc(appId);
}

/** @returns {Promise<object>} the application data with its id */
async function readApplication(db, appId) {
  const snap = await applicationRef(db, requireAppId(appId)).get();
  if (!snap.exists) throw new ConsoleError(404, 'not-found', NOT_FOUND);
  return { id: snap.id, ...snap.data() };
}

/** The answers the review is about: the frozen copy, or the live answers before acceptance. */
function reviewedAnswers(app) {
  return app.frozen || app.answers || {};
}

/** The reserved web-address name, or null. */
function siteNameOf(app) {
  const name = reviewedAnswers(app)?.webAddress?.name ?? app.answers?.webAddress?.name;
  return typeof name === 'string' && validOrgId(name) ? name : null;
}

/** The lowercase emails of the organization's Owners. */
async function ownerEmails(db, orgId) {
  if (!validOrgId(orgId)) return [];
  const snap = await db.collection('organizations').doc(orgId).collection('members').where('role', '==', 'owner').get();
  return snap.docs.map((doc) => doc.data().email).filter((email) => typeof email === 'string' && email);
}

module.exports = {
  NOT_FOUND,
  STATUSES,
  applicationRef,
  ownerEmails,
  readApplication,
  requireAppId,
  requireOperator,
  reviewedAnswers,
  siteNameOf,
};
