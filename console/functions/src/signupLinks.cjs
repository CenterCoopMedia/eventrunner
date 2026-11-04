'use strict';

/**
 * Signup links (ADR 0007, amendment 2026-11-04): the only way in. An operator
 * issues one after an invoice is paid. It works once, for whoever opens it
 * first, and that person's organization and draft request are made together.
 *
 * `signup_links/{linkId}` {
 *   organizationName, tokenHash,  // sha256 hex of the random token, never the token
 *   status: 'open'|'used'|'revoked',
 *   createdBy, createdAt, expiresAt,
 *   usedBy?, usedEmail?, usedAt?, orgId?, appId?
 * }
 *
 * The token exists only in the one answer to its creation. The link puts it
 * after `#`, so the browser never sends it to a server log. The link names no
 * email address, so a forwarded link still works, once. No browser can read
 * this collection (console/firestore.rules).
 */

const { randomBytes } = require('node:crypto');
const { ConsoleError } = require('./http.cjs');
const { toIso, toMillis, validOrgId } = require('./access.cjs');
const { COLLECTION: APPLICATIONS, newApplicationData } = require('./applications.cjs');
const { readSignupTerms } = require('./consoleSettings.cjs');
const { hostName } = require('./hostName.cjs');
const { hashToken, sameHash } = require('./invites.cjs');
const { NAME_MAX, NAME_MIN, cleanName } = require('./organizations.cjs');
const { requireOperator } = require('./reviewAccess.cjs');

const COLLECTION = 'signup_links';
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRES_IN_DAYS = 30;
const LIST_LIMIT = 100;
const TOKEN_MAX_LEN = 200;

const invalid = () => new ConsoleError(404, 'link-invalid', `This signup link is not valid. Ask ${hostName()} for a new link.`);

function requireName(value) {
  const name = cleanName(value);
  if (name) return name;
  const err = new ConsoleError(400, 'bad-request', `Enter an organization name of ${NAME_MIN} to ${NAME_MAX} characters.`);
  err.field = 'organizationName';
  throw err;
}

/**
 * Make a link. Automatic invoices can call this with their own `by`.
 *
 * @param {{ db: object, now?: () => number, publicUrl: string }} deps
 * @param {{ organizationName: string, by: string }} input
 * @returns {Promise<{ link: object, url: string }>} the only time the url exists
 */
async function createLink({ db, now = Date.now, publicUrl }, { organizationName, by }) {
  if (typeof publicUrl !== 'string' || !/^https?:\/\//.test(publicUrl)) {
    const failed = new ConsoleError(502, 'not-configured', 'The console address is not set, so a link cannot be made.');
    failed.cause = new Error('CONSOLE_PUBLIC_URL is not set');
    throw failed;
  }
  const name = requireName(organizationName);
  const { open, missing } = await readSignupTerms((r) => r.get(), db);
  if (!open) {
    throw new ConsoleError(409, 'signups-closed', `Sign-ups are closed. Set ${missing.join(', ')} in the console settings first.`);
  }
  const token = randomBytes(32).toString('base64url');
  const at = new Date(now());
  const ref = db.collection(COLLECTION).doc();
  const data = {
    organizationName: name,
    tokenHash: hashToken(token),
    status: 'open',
    createdBy: by,
    createdAt: at,
    expiresAt: new Date(at.getTime() + EXPIRES_IN_DAYS * DAY_MS),
  };
  await db.runTransaction(async (tx) => {
    tx.create(ref, data);
    tx.create(db.collection('console_audit').doc(), { action: 'create-signup-link', linkId: ref.id, by, at });
  });
  return {
    link: { id: ref.id, organizationName: name, status: 'open', createdAt: toIso(at), expiresAt: toIso(data.expiresAt) },
    url: `${publicUrl}/start/${ref.id}#token=${token}`,
  };
}

async function createSignupLink(deps, { body, user }) {
  await requireOperator(deps.db, user);
  return { status: 201, body: await createLink(deps, { organizationName: body.organizationName, by: user.uid }) };
}

async function listSignupLinks({ db, now = Date.now }, { user }) {
  await requireOperator(db, user);
  const snap = await db.collection(COLLECTION).orderBy('createdAt', 'desc').limit(LIST_LIMIT).get();
  const at = now();
  const links = snap.docs.map((doc) => {
    const link = doc.data();
    return {
      id: doc.id,
      organizationName: link.organizationName,
      status: link.status === 'open' && !(toMillis(link.expiresAt) > at) ? 'expired' : link.status,
      createdAt: toIso(link.createdAt),
      expiresAt: toIso(link.expiresAt),
      usedEmail: link.usedEmail || null,
      usedAt: toIso(link.usedAt),
      orgId: link.orgId || null,
      appId: link.appId || null,
    };
  });
  return { body: { links } };
}

async function revokeSignupLink({ db, now = Date.now }, { body, user }) {
  await requireOperator(db, user);
  const { linkId } = body;
  if (!validOrgId(linkId)) throw new ConsoleError(400, 'bad-request', 'Choose a link.');
  const ref = db.collection(COLLECTION).doc(linkId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ConsoleError(404, 'not-found', 'We could not find that link.');
    if (snap.data().status !== 'open') {
      throw new ConsoleError(409, 'link-not-open', 'This link was already used or revoked. Reload the page to see it.');
    }
    const at = new Date(now());
    tx.update(ref, { status: 'revoked' });
    tx.create(db.collection('console_audit').doc(), { action: 'revoke-signup-link', linkId, by: user.uid, at });
  });
  return { body: { linkId, status: 'revoked' } };
}

function linkRefFor(db, { linkId, token }) {
  if (!validOrgId(linkId) || typeof token !== 'string' || !token || token.length > TOKEN_MAX_LEN) throw invalid();
  return db.collection(COLLECTION).doc(linkId);
}

/** A wrong token and a missing link get the same answer, before anything else is said. */
function linkFrom(snap, token) {
  if (!snap.exists || !sameHash(snap.data().tokenHash, hashToken(token))) throw invalid();
  return snap.data();
}

/** @throws {ConsoleError} 410 unless the link can still be used. Call after a repeat by the same user is answered. */
function refuseUnlessOpen(link, at) {
  if (link.status === 'used') throw new ConsoleError(410, 'link-used', `A different sign-in already used this signup link. If that was you, sign out and sign in with the address you used. If not, ask ${hostName()} for a new link.`);
  if (link.status === 'revoked') throw new ConsoleError(410, 'link-revoked', `This signup link was cancelled. Ask ${hostName()} for a new link.`);
  if (link.status !== 'open') throw invalid();
  if (!(toMillis(link.expiresAt) > at)) throw new ConsoleError(410, 'link-expired', `This signup link has expired. Ask ${hostName()} for a new link.`);
}

const usedByThisUser = (link, user) => link.status === 'used' && link.usedBy === user.uid;

async function getSignupLink({ db, now = Date.now }, { body, user }) {
  const link = linkFrom(await linkRefFor(db, body).get(), body.token);
  if (usedByThisUser(link, user)) return { body: { status: 'used', orgId: link.orgId, appId: link.appId } };
  refuseUnlessOpen(link, now());
  return { body: { organizationName: link.organizationName, status: 'open' } };
}

/**
 * One transaction checks the link and the terms and makes the organization,
 * its Owner and the draft request, so a refusal leaves nothing behind and two
 * clicks make one of each.
 */
async function redeemSignupLink({ db, now = Date.now }, { body, user }) {
  const ref = linkRefFor(db, body);
  const orgRef = db.collection('organizations').doc();
  const appRef = db.collection(APPLICATIONS).doc();
  return db.runTransaction(async (tx) => {
    const link = linkFrom(await tx.get(ref), body.token);
    if (usedByThisUser(link, user)) return { status: 200, body: { orgId: link.orgId, appId: link.appId } };
    const at = new Date(now());
    refuseUnlessOpen(link, at.getTime());
    const organizationName = requireName(body.organizationName);
    if (!(await readSignupTerms((r) => tx.get(r), db)).open) {
      throw new ConsoleError(409, 'signups-closed', 'We cannot start new event sites right now. Your link still works, so try again later.');
    }
    tx.create(orgRef, { name: organizationName, createdAt: at, createdBy: user.uid });
    tx.create(orgRef.collection('members').doc(user.uid), { uid: user.uid, email: user.email, role: 'owner', joinedAt: at });
    tx.create(appRef, newApplicationData({ orgId: orgRef.id, organizationName, timezone: body.timezone, uid: user.uid, at }));
    tx.update(ref, { status: 'used', usedBy: user.uid, usedEmail: user.email, usedAt: at, orgId: orgRef.id, appId: appRef.id });
    return { status: 201, body: { orgId: orgRef.id, appId: appRef.id } };
  });
}

module.exports = {
  COLLECTION,
  EXPIRES_IN_DAYS,
  createLink,
  createSignupLink,
  getSignupLink,
  listSignupLinks,
  redeemSignupLink,
  revokeSignupLink,
};
