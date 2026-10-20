'use strict';

/**
 * Organization representatives (issue #334): a sponsor or partner edits
 * its own profile, and staff review the edit before it reaches the site.
 *
 *   ownOrganizationProfile      POST, any signed-in account with a grant.
 *     { action: 'get' }         the organization's live profile and the
 *                               caller's queued edit, if any
 *     { action: 'submit', fields }
 *                               queue an edit of REPRESENTATIVE_FIELDS
 *
 *   organizationRepresentatives POST, staff tier.
 *     { action: 'grant', organizationId, email }
 *     { action: 'revoke', uid }
 *     { action: 'apply', organizationId, overwrite? }
 *                               the queued edit into the organization's
 *                               draft; staff then publish it as usual
 *     { action: 'discard', organizationId }
 *
 * THE GRANT is `organization_representatives/{uid}`: one organization per
 * account, so the account's id is the key and the server reads the
 * organization from the grant, never from the request. Staff grant by the
 * address of an account that already exists and has a verified address
 * (Firebase Auth); the uid is what the grant holds. A representative
 * cannot see or name another organization, because no request field
 * chooses one. The grant is server-written only and staff-readable only
 * (firestore.rules), so a representative's identity never reaches a
 * public read.
 *
 * THE QUEUE is `organization_edit_requests/{organizationId}`: at most one
 * open edit per organization. It is NOT a field on the organization's
 * draft: store.publishDocs copies every non-reserved draft key to the live
 * document, so a queue there would publish the sender's identity and the
 * unreviewed text. A second edit from the same
 * account merges onto the first; while one account's edit waits, another
 * representative of the same organization is refused, so the queue never
 * mixes two people's text under one name. `base` holds, per
 * field, the live value the representative saw when that field first
 * entered the queue, so staff can tell an edit apart from a change of
 * their own made since.
 *
 * APPLY writes the queued fields onto the organization's draft through
 * store.writeDraft, the same seam an editor save uses, and nothing else.
 * The public page changes only when staff publish that draft. A field
 * staff changed in the draft since the edit was sent (its draft value is
 * neither `base` nor the queued value) is refused with a 409 that names
 * it, and `overwrite: true` is the explicit choice to replace it. Fields
 * the representative did not send are never written, so a staff edit to
 * any other field is kept. Apply also re-reads the sender's grant: an edit
 * from an account that lost access, or now represents another
 * organization, is refused.
 *
 * Every write here commits in one transaction with its `admin_logs` row,
 * in the five-field shape cms/store.cjs logAdminAction writes, plus
 * `details` without any profile text.
 */

const { requireAdmin, verifyAuthToken } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { contentFieldsOf, isValidDocId, writeDraft } = require('./store.cjs');
const {
  ORGANIZATIONS_COLLECTION,
  REPRESENTATIVE_FIELDS,
  validateOrganizationFields,
  validateRepresentativeFields,
} = require('./organizations.cjs');

const REPRESENTATIVES = 'organization_representatives';
const EDIT_REQUESTS = 'organization_edit_requests';
const DRAFTS = `${ORGANIZATIONS_COLLECTION}_drafts`;
const ADMIN_LOGS = 'admin_logs';

const MAX_UID_LENGTH = 128;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

/**
 * The seed's bookkeeping, which every edit clears (content.cjs
 * SEED_FIELDS, ADR 0001 §5.4). An applied edit is an edit.
 */
const SEED_FIELDS = Object.freeze(['seeded', 'seededAt']);

const NOT_REPRESENTATIVE = Object.freeze({
  status: 403,
  code: 'not-representative',
  message: 'This account does not represent an organization. Ask the event team for access.',
});

/** An HTTP-shaped refusal thrown inside a transaction, so nothing commits. */
class Refusal extends Error {
  constructor(status, code, message) {
    super(message);
    this.refusal = { status, code, message };
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

/** A stored profile value as the queue compares it: text, or null. */
function valueOf(value) {
  return typeof value === 'string' ? value : null;
}

function auditRow({ action, docPath, actor, at, details }) {
  return { action, docPath, uid: actor.uid, email: actor.email, at, ...(details ? { details } : {}) };
}

function readUid(value) {
  if (typeof value !== 'string') return null;
  const uid = value.trim();
  if (!uid || uid.length > MAX_UID_LENGTH || !isValidDocId(uid)) return null;
  return uid;
}

function readEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) return null;
  return email;
}

/** What the representative reads of the live organization: its public profile. */
function profileView(live) {
  return {
    name: valueOf(live.name),
    logoPath: valueOf(live.logoPath),
    description: valueOf(live.description),
    bio: valueOf(live.bio),
    url: valueOf(live.url),
  };
}

function pendingView(request) {
  if (!request || !isPlainObject(request.fields) || Object.keys(request.fields).length === 0) return null;
  const at = request.submittedAt;
  const date = at instanceof Date ? at : typeof at?.toDate === 'function' ? at.toDate() : null;
  return { fields: { ...request.fields }, submittedAt: date ? date.toISOString() : null };
}

// ------------------------------------------------------- representative side

/**
 * The verified caller. A representative needs a verified address, the
 * same bar an admin meets, and the token is checked for revocation, so a
 * deleted or disabled account is refused at once.
 */
async function gateRepresentative({ auth }, req) {
  const decoded = await verifyAuthToken({ auth }, req);
  if (!decoded?.uid) return { ok: false, status: 401, code: 'unauthorized', message: 'Authentication required.' };
  if (decoded.email_verified !== true) return { ok: false, ...NOT_REPRESENTATIVE };
  return { ok: true, uid: decoded.uid, email: typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '' };
}

async function applyGetOwn({ db, uid }) {
  const grantSnap = await db.collection(REPRESENTATIVES).doc(uid).get();
  const organizationId = grantSnap.exists ? grantSnap.data()?.organizationId : null;
  if (!isValidDocId(organizationId)) return { ok: false, ...NOT_REPRESENTATIVE };
  const [liveSnap, requestSnap] = await Promise.all([
    db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId).get(),
    db.collection(EDIT_REQUESTS).doc(organizationId).get(),
  ]);
  if (!liveSnap.exists) {
    return { ok: true, body: { organizationId, organization: null, pending: null, otherPending: false } };
  }
  // Another representative's edit is theirs to see: this caller learns only
  // that one is waiting.
  const queued = pendingView(requestSnap.exists ? requestSnap.data() : null);
  const mine = queued !== null && requestSnap.data()?.submittedByUid === uid;
  return {
    ok: true,
    body: {
      organizationId,
      organization: profileView(liveSnap.data() || {}),
      pending: mine ? queued : null,
      otherPending: queued !== null && !mine,
    },
  };
}

/**
 * Queue the caller's edit of its own organization.
 *
 * One transaction reads the demo policy, the grant, the live organization
 * and the queue, so a revocation that commits first refuses this edit, and
 * one that commits after it finds the edit and removes it.
 */
async function applySubmit({ db, uid, email, sent, now }) {
  const verdict = validateRepresentativeFields(sent);
  if (!verdict.ok) return { ok: false, status: 400, code: 'bad-request', message: verdict.errors.join('; ') };

  try {
    return await db.runTransaction(async (tx) => {
      const policy = await checkDemoWrites({ db, transaction: tx });
      if (!policy.ok) throw new Refusal(policy.status, policy.code, policy.message);
      const grantSnap = await tx.get(db.collection(REPRESENTATIVES).doc(uid));
      const organizationId = grantSnap.exists ? grantSnap.data()?.organizationId : null;
      if (!isValidDocId(organizationId)) {
        throw new Refusal(NOT_REPRESENTATIVE.status, NOT_REPRESENTATIVE.code, NOT_REPRESENTATIVE.message);
      }
      const liveRef = db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId);
      const requestRef = db.collection(EDIT_REQUESTS).doc(organizationId);
      const liveSnap = await tx.get(liveRef);
      const requestSnap = await tx.get(requestRef);
      if (!liveSnap.exists) {
        throw new Refusal(409, 'not-published', 'Your organization is not on the site yet. The event team publishes it first.');
      }
      const live = liveSnap.data() || {};
      const prior = requestSnap.exists ? requestSnap.data() : null;
      // One edit per organization, and it is its sender's: a second
      // representative's text must not merge in under the first one's
      // name, where a revocation of either would treat it wrongly.
      if (pendingView(prior) !== null && prior.submittedByUid !== uid) {
        throw new Refusal(
          409,
          'other-edit-waiting',
          'Another representative of your organization has an edit waiting for review. Send yours after the event team reviews it.',
        );
      }
      const fields = isPlainObject(prior?.fields) ? { ...prior.fields } : {};
      const base = isPlainObject(prior?.base) ? { ...prior.base } : {};

      for (const [field, value] of Object.entries(verdict.fields)) {
        const baseValue = Object.prototype.hasOwnProperty.call(base, field) ? base[field] : valueOf(live[field]);
        if (value === baseValue) {
          // Back to what the representative started from: no edit to review.
          delete fields[field];
          delete base[field];
        } else {
          fields[field] = value;
          base[field] = baseValue;
        }
      }

      const at = new Date(now());
      const docPath = `${EDIT_REQUESTS}/${organizationId}`;
      let request = null;
      if (Object.keys(fields).length === 0) {
        if (requestSnap.exists) tx.delete(requestRef);
      } else {
        request = {
          organizationId,
          fields,
          base,
          submittedByUid: uid,
          submittedByEmail: email,
          submittedAt: at,
        };
        tx.set(requestRef, request);
      }
      tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
        action: request ? 'submitOrganizationEdit' : 'withdrawOrganizationEdit',
        docPath,
        actor: { uid, email },
        at,
        details: { fields: Object.keys(verdict.fields) },
      }));
      return { ok: true, body: { organizationId, pending: pendingView(request) } };
    });
  } catch (err) {
    if (err?.refusal) return { ok: false, ...err.refusal };
    throw err;
  }
}

function createOwnOrganizationProfileHandler({ db, auth, now = Date.now, log = console }) {
  return async function ownOrganizationProfile(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const action = req.body?.action;
    if (action !== 'get' && action !== 'submit') return badRequest(res, 'action: use get or submit');
    const gate = await gateRepresentative({ auth }, req);
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);

    let result;
    try {
      result = action === 'get'
        ? await applyGetOwn({ db, uid: gate.uid })
        : await applySubmit({ db, uid: gate.uid, email: gate.email, sent: req.body?.fields, now });
    } catch (err) {
      log.error('ownOrganizationProfile failed', err);
      return internal(res, action === 'get'
        ? 'Your organization could not be loaded. Try again.'
        : 'Your changes could not be sent. Try again.');
    }
    if (!result.ok) return sendError(res, result.status, result.code, result.message);
    res.status(200).json(result.body);
  };
}

// ---------------------------------------------------------------- staff side

async function applyGrant({ db, auth, organizationId, email, actor, now }) {
  let account;
  try {
    account = await auth.getUserByEmail(email);
  } catch (err) {
    if (err?.code === 'auth/user-not-found') {
      return {
        ok: false,
        status: 404,
        code: 'no-account',
        message: 'email: no account uses this address. Ask them to sign in to the site once, then try again.',
      };
    }
    throw err;
  }
  if (account?.emailVerified !== true || account?.disabled === true || !readUid(account?.uid)) {
    return {
      ok: false,
      status: 409,
      code: 'unverified-account',
      message: 'email: this account has no confirmed address, or it is turned off.',
    };
  }
  const uid = account.uid;
  const grantRef = db.collection(REPRESENTATIVES).doc(uid);

  return db.runTransaction(async (tx) => {
    const liveSnap = await tx.get(db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId));
    const draftSnap = await tx.get(db.collection(DRAFTS).doc(organizationId));
    const grantSnap = await tx.get(grantRef);
    if (!liveSnap.exists && !draftSnap.exists) {
      return { ok: false, status: 404, code: 'not-found', message: `No organization with id "${organizationId}".` };
    }
    if (grantSnap.exists) {
      const held = grantSnap.data()?.organizationId;
      if (held === organizationId) return { ok: true, body: { uid, organizationId, changed: false } };
      return {
        ok: false,
        status: 409,
        code: 'already-representative',
        message: 'email: this account already represents another organization. Remove that access first.',
      };
    }
    const at = new Date(now());
    tx.set(grantRef, { uid, email, organizationId, grantedAt: at, grantedBy: actor.email });
    tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
      action: 'grantOrganizationRepresentative',
      docPath: `${REPRESENTATIVES}/${uid}`,
      actor,
      at,
      details: { organizationId },
    }));
    return { ok: true, body: { uid, organizationId, changed: true } };
  });
}

async function applyRevoke({ db, uid, actor, now }) {
  const grantRef = db.collection(REPRESENTATIVES).doc(uid);
  return db.runTransaction(async (tx) => {
    const grantSnap = await tx.get(grantRef);
    if (!grantSnap.exists) {
      return { ok: false, status: 404, code: 'not-found', message: 'This account is not a representative.' };
    }
    const organizationId = grantSnap.data()?.organizationId;
    let requestSnap = null;
    if (isValidDocId(organizationId)) {
      requestSnap = await tx.get(db.collection(EDIT_REQUESTS).doc(organizationId));
    }
    // An edit nobody reviewed yet goes with the access that sent it.
    const discardedEdit = Boolean(requestSnap?.exists && requestSnap.data()?.submittedByUid === uid);
    if (discardedEdit) tx.delete(requestSnap.ref);
    tx.delete(grantRef);
    const at = new Date(now());
    tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
      action: 'revokeOrganizationRepresentative',
      docPath: `${REPRESENTATIVES}/${uid}`,
      actor,
      at,
      details: { organizationId: typeof organizationId === 'string' ? organizationId : null, discardedEdit },
    }));
    return { ok: true, body: { uid, organizationId, discardedEdit } };
  });
}

async function applyApprove({ db, organizationId, overwrite, actor, now }) {
  const requestRef = db.collection(EDIT_REQUESTS).doc(organizationId);
  try {
    return await db.runTransaction(async (tx) => {
      const requestSnap = await tx.get(requestRef);
      const request = requestSnap.exists ? requestSnap.data() : null;
      const queued = isPlainObject(request?.fields) ? request.fields : {};
      if (Object.keys(queued).length === 0) {
        throw new Refusal(404, 'not-found', 'This organization has no edit waiting for review.');
      }
      const senderUid = readUid(request.submittedByUid);
      const grantSnap = senderUid ? await tx.get(db.collection(REPRESENTATIVES).doc(senderUid)) : null;
      if (!grantSnap?.exists || grantSnap.data()?.organizationId !== organizationId) {
        throw new Refusal(
          409,
          'representative-revoked',
          'The person who sent this edit no longer represents this organization. Discard it.',
        );
      }
      const draftSnap = await tx.get(db.collection(DRAFTS).doc(organizationId));
      const liveSnap = await tx.get(db.collection(ORGANIZATIONS_COLLECTION).doc(organizationId));
      const current = draftSnap.exists
        ? contentFieldsOf(draftSnap.data())
        : liveSnap.exists ? contentFieldsOf(liveSnap.data()) : null;
      if (!current) throw new Refusal(404, 'not-found', `No organization with id "${organizationId}".`);

      // Only the representative's own fields: a queue written by anything
      // else cannot widen what apply writes.
      const fields = {};
      for (const field of REPRESENTATIVE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(queued, field)) fields[field] = queued[field];
      }
      const base = isPlainObject(request.base) ? request.base : {};
      const changed = Object.keys(fields).filter((field) => {
        const draftValue = valueOf(current[field]);
        return draftValue !== valueOf(base[field]) && draftValue !== fields[field];
      });
      if (changed.length > 0 && overwrite !== true) {
        throw new Refusal(
          409,
          'staff-changed',
          `${changed.join(', ')}: changed by staff since this edit was sent. Check it, then apply with overwrite.`,
        );
      }

      const merged = {};
      for (const [key, value] of Object.entries({ ...current, ...fields })) {
        if (!SEED_FIELDS.includes(key)) merged[key] = value;
      }
      const verdict = validateOrganizationFields(merged, fields);
      if (!verdict.ok) throw new Refusal(400, 'bad-request', verdict.errors.join('; '));

      // writeDraft reads before it writes; every read of ours is above.
      const written = await writeDraft({
        db, tx, collection: ORGANIZATIONS_COLLECTION, docId: organizationId, fields: verdict.fields, actor, now,
      });
      tx.delete(requestRef);
      tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
        action: 'applyOrganizationEdit',
        docPath: written.docPath,
        actor,
        at: new Date(now()),
        details: { fields: Object.keys(fields), overwrite: overwrite === true },
      }));
      // The values this attempt wrote, as stored. A retried attempt reads
      // the queue again, so they can be newer than what the caller listed,
      // and the editor adopts these, never its own copy.
      const applied = Object.fromEntries(
        Object.keys(fields).map((field) => [field, verdict.fields[field] ?? null]),
      );
      return {
        ok: true,
        body: { organizationId, docPath: written.docPath, appliedFields: Object.keys(fields), applied },
      };
    });
  } catch (err) {
    if (err?.refusal) return { ok: false, ...err.refusal };
    throw err;
  }
}

async function applyDiscard({ db, organizationId, actor, now }) {
  const requestRef = db.collection(EDIT_REQUESTS).doc(organizationId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(requestRef);
    if (!snap.exists) {
      return { ok: false, status: 404, code: 'not-found', message: 'This organization has no edit waiting for review.' };
    }
    tx.delete(requestRef);
    tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
      action: 'discardOrganizationEdit',
      docPath: `${EDIT_REQUESTS}/${organizationId}`,
      actor,
      at: new Date(now()),
    }));
    return { ok: true, body: { organizationId } };
  });
}

const STAFF_ACTIONS = Object.freeze(['grant', 'revoke', 'apply', 'discard']);

function createOrganizationRepresentativesHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function organizationRepresentatives(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const verdict = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!verdict.ok) return sendError(res, verdict.status, verdict.code, verdict.message);
    const actor = { uid: verdict.uid, email: verdict.email };
    const body = isPlainObject(req.body) ? req.body : {};
    const { action } = body;
    if (!STAFF_ACTIONS.includes(action)) return badRequest(res, `action: use ${STAFF_ACTIONS.join(', ')}`);

    let result;
    try {
      if (action === 'revoke') {
        const uid = readUid(body.uid);
        if (!uid) return badRequest(res, 'uid: is required');
        result = await applyRevoke({ db, uid, actor, now });
      } else {
        const organizationId = body.organizationId;
        if (!isValidDocId(organizationId)) return badRequest(res, 'organizationId: is required');
        if (action === 'grant') {
          const email = readEmail(body.email);
          if (!email) return badRequest(res, 'email: enter the address of the account to add');
          result = await applyGrant({ db, auth, organizationId, email, actor, now });
        } else if (action === 'apply') {
          result = await applyApprove({ db, organizationId, overwrite: body.overwrite === true, actor, now });
        } else {
          result = await applyDiscard({ db, organizationId, actor, now });
        }
      }
    } catch (err) {
      log.error(`organizationRepresentatives ${action} failed`, err);
      return internal(res, 'The change could not be saved. Try again.');
    }
    if (!result.ok) return sendError(res, result.status, result.code, result.message);
    res.status(200).json(result.body);
  };
}

// ------------------------------------------------------------ organization delete

/**
 * Inside the caller's transaction: read what an organization delete must
 * take with it. Every grant for the organization and its queued edit go
 * when it does, or a new organization at the same address would inherit
 * the old one's representatives. Call before any write; apply the result
 * with removeOrganizationAccess after them.
 */
async function readOrganizationAccess({ db, tx, organizationId }) {
  const grants = await tx.get(db.collection(REPRESENTATIVES).where('organizationId', '==', organizationId));
  const request = await tx.get(db.collection(EDIT_REQUESTS).doc(organizationId));
  return { grants: grants.docs, request };
}

function removeOrganizationAccess({ db, tx, organizationId, access, actor, at }) {
  for (const grant of access.grants) {
    tx.delete(grant.ref);
    tx.set(db.collection(ADMIN_LOGS).doc(), auditRow({
      action: 'revokeOrganizationRepresentative',
      docPath: `${REPRESENTATIVES}/${grant.id}`,
      actor,
      at,
      details: { organizationId, reason: 'organization-deleted' },
    }));
  }
  if (access.request.exists) tx.delete(access.request.ref);
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const db = getDb();
    return { db, auth: getAuth(), getConfig: () => getEventConfig({ db }), now: Date.now, log: console };
  };

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
      methods: ['POST'],
    });
    if (handled) return;
    await handler(req, res);
  };

  return {
    ownOrganizationProfile: onRequest({ region }, withCors(async (req, res) => {
      await createOwnOrganizationProfileHandler(buildDeps())(req, res);
    })),
    organizationRepresentatives: onRequest({ region }, withCors(async (req, res) => {
      await createOrganizationRepresentativesHandler(buildDeps())(req, res);
    })),
  };
}

module.exports = {
  REPRESENTATIVES,
  EDIT_REQUESTS,
  createOwnOrganizationProfileHandler,
  createOrganizationRepresentativesHandler,
  readOrganizationAccess,
  removeOrganizationAccess,
  get handlers() {
    return buildHandlers();
  },
};
