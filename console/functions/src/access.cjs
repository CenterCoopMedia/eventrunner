'use strict';

/**
 * Who may do what in the console (ADR 0007 §2).
 *
 * - A member of an organization is `organizations/{orgId}/members/{uid}`.
 *   Its role is `owner` or `editor`.
 * - Owners manage the team. Editors and owners can read the team.
 * - CCM operators are the lowercase emails in `console_config/operators`.
 *   They can read every organization. They do not change a client's team.
 *
 * The allowlist is read live on each request, so removing an operator
 * takes effect at once. console/firestore.rules reads the same document
 * the same way.
 */

const { ConsoleError } = require('./http.cjs');

const ROLES = Object.freeze(['owner', 'editor']);
const MAX_EMAIL_LEN = 254;
// Deliberately simple: one @, no spaces, a dot in the domain. The address
// is proved by the sign-in that accepts the invite, not by this pattern.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @returns {string|null} the lowercase address, or null when it is not one */
function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) return null;
  return email;
}

/** A single Firestore document id: no slash, not `.` or `..`, not too long. */
function validOrgId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && !value.includes('/')
    && value !== '.'
    && value !== '..';
}

/** @returns {Promise<boolean>} */
async function isOperator(db, email) {
  const snap = await db.collection('console_config').doc('operators').get();
  const list = snap.exists ? snap.data().emails : null;
  if (!Array.isArray(list)) return false;
  return list.some((entry) => typeof entry === 'string' && entry.trim().toLowerCase() === email);
}

/** @returns {Promise<object|null>} */
async function readMember(db, orgId, uid) {
  const snap = await db.collection('organizations').doc(orgId).collection('members').doc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function requireOrganization(db, orgId) {
  if (!validOrgId(orgId)) throw new ConsoleError(400, 'bad-request', 'Choose an organization.');
  const snap = await db.collection('organizations').doc(orgId).get();
  if (!snap.exists) throw new ConsoleError(404, 'not-found', 'We could not find that organization.');
  return snap.data();
}

/**
 * The caller must be an Owner of the organization. `refusal` is what an
 * Editor is told, so each action can say what only an Owner can do.
 * @returns {Promise<object>} the caller's member record
 */
async function requireOwner(db, orgId, user, refusal = 'Only an Owner can change the team.') {
  await requireOrganization(db, orgId);
  const member = await readMember(db, orgId, user.uid);
  if (!member) throw new ConsoleError(404, 'not-found', 'We could not find that organization.');
  if (member.role !== 'owner') {
    throw new ConsoleError(403, 'forbidden', refusal);
  }
  return member;
}

/**
 * The caller must be a member of the organization or an operator. A
 * stranger gets the same answer as for an organization that does not
 * exist, so ids cannot be probed.
 *
 * @returns {Promise<{ role: 'owner'|'editor'|null, operator: boolean }>}
 */
async function requireMemberOrOperator(db, orgId, user) {
  await requireOrganization(db, orgId);
  const member = await readMember(db, orgId, user.uid);
  const operator = await isOperator(db, user.email);
  if (!member && !operator) {
    throw new ConsoleError(404, 'not-found', 'We could not find that organization.');
  }
  return { role: member ? member.role : null, operator };
}

/** A stored time (Date, Firestore Timestamp or millis) as ISO text, or null. */
function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  return null;
}

/** A stored time as milliseconds, or NaN. */
function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'number') return value;
  return Number.NaN;
}

module.exports = {
  ROLES,
  isOperator,
  normalizeEmail,
  readMember,
  requireMemberOrOperator,
  requireOrganization,
  requireOwner,
  toIso,
  toMillis,
  validOrgId,
};
