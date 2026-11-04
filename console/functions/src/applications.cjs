'use strict';

/**
 * Applications (ADR 0007 §3 and §5): start one, read one, list them.
 *
 * `applications/{appId}` {
 *   orgId, status, answers, frozen (a copy of answers at submit, else null),
 *   createdBy, createdAt, updatedAt, updatedBy, submittedAt, submittedBy,
 *   history: [{ status, at, by, note }]  // oldest first
 *   review: null | { note, by, at, settings }  // written by operator review only
 *   agreementAcceptance: null | { id, version, sha256, name, email, at }  // the current acceptance
 *   feeCheckout: null | { sessionId, amount, currency, attempt, createdAt }  // the payment page
 *   payment: null | { sessionId, paymentIntentId, amount, currency, paidAt, eventId }
 *   buildStart: { state: 'pending'|'started'|'failed', at }  // after payment, no detail
 *   feeProblem: { code, sessionId, paymentIntentId, at }  // a paid session that did not approve the request
 * }
 *
 * The browser can read this document (console/firestore.rules), so error
 * text stays in the logs. The signed record is in agreement_acceptances.
 *
 * One application is one event and one site. The client calls it "your
 * request"; the console never shows the word application.
 */

const { ConsoleError } = require('./http.cjs');
const { requireMemberOrOperator, requireOwner, toIso, toMillis, validOrgId } = require('./access.cjs');
const { emptyAnswers, withDefaults } = require('./answers.cjs');
const { checkAnswers } = require('./checks.cjs');
const { siteAddress } = require('./siteNames.cjs');
const { LAUNCH_OWNERS } = require('./organizations.cjs');
const { readSignupTerms } = require('./consoleSettings.cjs');

const COLLECTION = 'applications';
const STATUSES = Object.freeze([
  'draft', 'awaiting_payment', 'submitted', 'changes_requested', 'approved', 'building', 'ready', 'launched', 'withdrawn', 'declined',
]);
const CLOSED = Object.freeze(['withdrawn', 'declined']);
const EDITABLE = Object.freeze(['draft', 'changes_requested']);
const WITHDRAWABLE = Object.freeze(['draft', 'awaiting_payment', 'submitted', 'changes_requested']);
const AWAITING_PAYMENT = 'awaiting_payment';
const MAX_OPEN_PER_ORG = 3;
const STEP_IDS = Object.freeze(['organization', 'event', 'webAddress', 'team', 'tickets', 'email', 'review', 'agreement', 'fee']);

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
  if (['changes_requested', 'declined'].includes(data.status) && data.review && typeof data.review.note === 'string') {
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
  // The second Owner is a launch check, so the team step never holds the setup.
  done.team = true;
  done.review = Object.keys(errors).length === 0;
  done.agreement = Boolean(data.agreementAcceptance);
  done.fee = Boolean(data.payment);
  return done;
}

/** What the browser gets. The operator also gets who did each change and the review. */
function applicationForClient(id, data, { role, operator, ownersNeeded, signups }) {
  const answers = withDefaults(data.answers);
  const errors = checkAnswers(answers);
  const editable = EDITABLE.includes(data.status);
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
    payment: data.payment
      ? { amount: data.payment.amount, currency: data.payment.currency, paidAt: toIso(data.payment.paidAt) }
      : null,
    myRole: role,
    operator,
    canEdit: Boolean(role) && editable,
    canAccept: owner && data.status === 'draft',
    // A request the hosting team held back goes back to them.
    canSubmit: owner && data.status === 'changes_requested',
    canPay: owner && data.status === AWAITING_PAYMENT,
    canWithdraw: owner && WITHDRAWABLE.includes(data.status),
  };
  if (operator) {
    body.frozen = data.frozen || null;
    body.review = data.review
      ? { note: data.review.note || null, by: data.review.by || null, at: toIso(data.review.at), settings: data.review.settings || null }
      : null;
  }
  return body;
}

async function createApplication({ db, now = Date.now }, { body, user }) {
  const { orgId } = body;
  await requireOwner(db, orgId, user, 'Only an Owner can start a new event site.');
  const org = (await db.collection('organizations').doc(orgId).get()).data();
  const timezone = typeof body.timezone === 'string' ? body.timezone.trim().slice(0, 64) : '';
  const ref = db.collection(COLLECTION).doc();
  const at = new Date(now());
  const data = {
    orgId,
    status: 'draft',
    answers: emptyAnswers({ organizationName: org.name, timezone }),
    frozen: null,
    createdBy: user.uid,
    createdAt: at,
    updatedAt: at,
    updatedBy: user.uid,
    submittedAt: null,
    submittedBy: null,
    history: [historyEntry('draft', at, user.uid)],
    review: null,
    agreementAcceptance: null,
    feeCheckout: null,
    payment: null,
  };
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(db.collection(COLLECTION).where('orgId', '==', orgId));
    const open = existing.docs.filter((doc) => !CLOSED.includes(doc.data().status)).length;
    if (open >= MAX_OPEN_PER_ORG) {
      throw new ConsoleError(409, 'too-many-open',
        `An organization can have ${MAX_OPEN_PER_ORG} open requests. Finish or withdraw one first.`);
    }
    tx.create(ref, data);
  });
  return { status: 201, body: { application: { id: ref.id, orgId, status: 'draft' } } };
}

async function getApplication({ db }, { body, user }) {
  const { orgId, appId } = body;
  const access = await requireMemberOrOperator(db, orgId, user);
  const { ref, data } = await readApplication((r) => r.get(), db, orgId, appId);
  const ownersNeeded = Math.max(0, LAUNCH_OWNERS - await countOwners(db, orgId));
  const { open, fee } = await readSignupTerms((r) => r.get(), db);
  const signups = { open, fee };
  return { body: { application: applicationForClient(ref.id, data, { ...access, ownersNeeded, signups }) } };
}

async function listApplications({ db }, { body, user }) {
  const { orgId } = body;
  const access = await requireMemberOrOperator(db, orgId, user);
  const snap = await db.collection(COLLECTION).where('orgId', '==', orgId).get();
  const applications = snap.docs
    .map((doc) => {
      const data = doc.data();
      const answers = withDefaults(data.answers);
      return {
        id: doc.id,
        status: data.status,
        eventName: answers.event.name,
        address: answers.webAddress.name ? siteAddress(answers.webAddress.name) : null,
        createdAt: toIso(data.createdAt),
        updatedAt: toIso(data.updatedAt),
        sortKey: toMillis(data.createdAt),
      };
    })
    .sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0))
    .map(({ sortKey, ...rest }) => rest);
  const open = applications.filter((app) => !CLOSED.includes(app.status)).length;
  return {
    body: {
      applications,
      myRole: access.role,
      operator: access.operator,
      canCreate: access.role === 'owner' && open < MAX_OPEN_PER_ORG,
    },
  };
}

module.exports = {
  AWAITING_PAYMENT,
  CLOSED,
  COLLECTION,
  EDITABLE,
  MAX_OPEN_PER_ORG,
  STATUSES,
  STEP_IDS,
  WITHDRAWABLE,
  applicationForClient,
  countOwners,
  createApplication,
  getApplication,
  historyEntry,
  listApplications,
  readApplication,
  requireMember,
};
