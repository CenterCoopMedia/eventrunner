'use strict';

/**
 * Applications (ADR 0007 §3 and §5): read one, list them. One starts only when
 * a signup link is redeemed (signupLinks.cjs).
 *
 * `applications/{appId}` {
 *   orgId, status, answers, frozen (a copy of answers at acceptance, else null),
 *   connections (connected accounts, see connectionState.cjs; absent until one is connected),
 *   createdBy, createdAt, updatedAt, updatedBy, submittedAt, submittedBy,
 *   history: [{ status, at, by, note }]  // oldest first
 *   review: null | { note, by, at, settings }  // written by operator review only
 *   agreementAcceptance: null | { id, version, sha256, name, email, at }  // the current acceptance
 *   buildStart: { state: 'pending'|'started'|'failed', at }  // from acceptance on, no detail
 * }
 *
 * The browser can read this document (console/firestore.rules), so error
 * text stays in the logs. The signed record is in agreement_acceptances.
 *
 * One application is one event and one site. The client calls it "your
 * request"; the console never shows the word application.
 */

const { ConsoleError } = require('./http.cjs');
const { requireMemberOrOperator, toIso, toMillis, validOrgId } = require('./access.cjs');
const { emptyAnswers, withDefaults } = require('./answers.cjs');
const { RETRY_STATUSES, buildForClient, readBuild } = require('./buildState.cjs');
const { checkAnswers } = require('./checks.cjs');
const { connectionsForClient } = require('./connectionState.cjs');
const { siteAddress } = require('./siteNames.cjs');
const { LAUNCH_OWNERS } = require('./organizations.cjs');
const { readSignupTerms } = require('./consoleSettings.cjs');

const COLLECTION = 'applications';
const STATUSES = Object.freeze(['draft', 'approved', 'building', 'ready', 'launched', 'withdrawn', 'declined']);
const CLOSED = Object.freeze(['withdrawn', 'declined']);
const WITHDRAWABLE = Object.freeze(['draft']);
const STEP_IDS = Object.freeze(['organization', 'event', 'webAddress', 'team', 'tickets', 'email', 'review', 'agreement']);

const NOT_FOUND = 'We could not find that request.';

function historyEntry(status, at, by, note = null) {
  return { status, at, by, note };
}

/**
 * The application `appId` of organization `orgId`, read with `get` (a
 * transaction's or the database's). A wrong organization reads as missing.
 */
async function readApplication(get, db, orgId, appId) {
  if (!validOrgId(appId)) throw new ConsoleError(400, 'bad-request', 'Choose a request.');
  const ref = db.collection(COLLECTION).doc(appId);
  const snap = await get(ref);
  if (!snap.exists || snap.data().orgId !== orgId) throw new ConsoleError(404, 'not-found', NOT_FOUND);
  return { ref, data: snap.data() };
}

/** The caller must be a member. An operator reads, but does not change, a client's answers. */
async function requireMember(db, orgId, user) {
  const access = await requireMemberOrOperator(db, orgId, user);
  if (!access.role) {
    throw new ConsoleError(403, 'forbidden', 'The hosting team can read this request, but only the client can change it.');
  }
  return access;
}

async function countOwners(db, orgId) {
  const snap = await db.collection('organizations').doc(orgId).collection('members').where('role', '==', 'owner').get();
  return snap.size;
}

/** The latest note for the current status, from the history or the review. */
function currentNote(data) {
  const history = Array.isArray(data.history) ? data.history : [];
  const last = [...history].reverse().find((entry) => entry.status === data.status);
  if (last && typeof last.note === 'string' && last.note) return last.note;
  if (data.status === 'declined' && data.review && typeof data.review.note === 'string') {
    return data.review.note || null;
  }
  return null;
}

/** Which steps are complete, for the step list. */
function stepProgress(errors, data) {
  const done = Object.fromEntries(STEP_IDS.map((step) => [
    step,
    !Object.keys(errors).some((path) => path === step || path.startsWith(`${step}.`)),
  ]));
  // A second Owner is a recommendation, so the team step never holds the setup.
  done.team = true;
  done.review = Object.keys(errors).length === 0;
  done.agreement = Boolean(data.agreementAcceptance);
  return done;
}

/** What the browser gets. The operator also gets who did each change and the review. */
function applicationForClient(id, data, { role, operator, ownersNeeded, signups, available, build, testMode = false }) {
  const answers = withDefaults(data.answers);
  const errors = checkAnswers(answers, data.connections, { testMode });
  const draft = data.status === 'draft';
  const owner = role === 'owner';
  const body = {
    id,
    orgId: data.orgId,
    status: data.status,
    answers,
    address: answers.webAddress.name ? siteAddress(answers.webAddress.name) : null,
    note: currentNote(data),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    submittedAt: toIso(data.submittedAt),
    history: (Array.isArray(data.history) ? data.history : []).map((entry) => ({
      status: entry.status,
      at: toIso(entry.at),
      note: entry.note || null,
      ...(operator ? { by: entry.by || null } : {}),
    })),
    errors,
    progress: stepProgress(errors, data),
    ownersNeeded,
    signups,
    acceptance: data.agreementAcceptance
      ? { version: data.agreementAcceptance.version, name: data.agreementAcceptance.name, at: toIso(data.agreementAcceptance.at) }
      : null,
    build,
    myRole: role,
    operator,
    canEdit: Boolean(role) && draft,
    canAccept: owner && draft,
    canWithdraw: owner && WITHDRAWABLE.includes(data.status),
    connections: connectionsForClient(data.connections, { available, status: data.status, role, reconnect: build.failed }),
  };
  if (operator) {
    body.frozen = data.frozen || null;
    body.review = data.review
      ? { note: data.review.note || null, by: data.review.by || null, at: toIso(data.review.at), settings: data.review.settings || null }
      : null;
  }
  return body;
}

/** A new draft request, with nothing answered but what the signup form gave. */
function newApplicationData({ orgId, organizationName, timezone, uid, at }) {
  return {
    orgId,
    status: 'draft',
    answers: emptyAnswers({ organizationName, timezone: typeof timezone === 'string' ? timezone.trim().slice(0, 64) : '' }),
    frozen: null,
    createdBy: uid,
    createdAt: at,
    updatedAt: at,
    updatedBy: uid,
    submittedAt: null,
    submittedBy: null,
    history: [historyEntry('draft', at, uid)],
    review: null,
    agreementAcceptance: null,
  };
}

async function getApplication({ db, connectionsAvailable, consoleTestMode, now = Date.now }, { body, user }) {
  const { orgId, appId } = body;
  const access = await requireMemberOrOperator(db, orgId, user);
  const { ref, data } = await readApplication((r) => r.get(), db, orgId, appId);
  const ownersNeeded = Math.max(0, LAUNCH_OWNERS - await countOwners(db, orgId));
  const { open } = await readSignupTerms((r) => r.get(), db);
  const record = RETRY_STATUSES.includes(data.status) ? await readBuild((r) => r.get(), db, ref.id) : null;
  return {
    body: {
      application: applicationForClient(ref.id, data, {
        ...access,
        ownersNeeded,
        signups: { open },
        available: connectionsAvailable,
        build: buildForClient(data, record, now(), { testMode: consoleTestMode }),
        testMode: consoleTestMode,
      }),
    },
  };
}

async function listApplications({ db, now = Date.now }, { body, user }) {
  const { orgId } = body;
  const access = await requireMemberOrOperator(db, orgId, user);
  const snap = await db.collection(COLLECTION).where('orgId', '==', orgId).get();
  const rows = await Promise.all(snap.docs.map(async (doc) => {
    const data = doc.data();
    const answers = withDefaults(data.answers);
    const record = RETRY_STATUSES.includes(data.status) ? await readBuild((r) => r.get(), db, doc.id) : null;
    return {
      id: doc.id,
      status: data.status,
      eventName: answers.event.name,
      address: answers.webAddress.name ? siteAddress(answers.webAddress.name) : null,
      createdAt: toIso(data.createdAt),
      updatedAt: toIso(data.updatedAt),
      buildFailed: buildForClient(data, record, now()).failed,
      sortKey: toMillis(data.createdAt),
    };
  }));
  const applications = rows
    .sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0))
    .map(({ sortKey, ...rest }) => rest);
  return { body: { applications, myRole: access.role, operator: access.operator } };
}

module.exports = {
  CLOSED,
  COLLECTION,
  STATUSES,
  STEP_IDS,
  WITHDRAWABLE,
  applicationForClient,
  countOwners,
  getApplication,
  historyEntry,
  listApplications,
  newApplicationData,
  readApplication,
  requireMember,
};
