'use strict';

/**
 * Organizations (ADR 0007 §2): list mine, read its team. One is made only by
 * redeeming a signup link (signupLinks.cjs).
 *
 * `organizations/{orgId}`               { name, createdAt, createdBy }
 * `organizations/{orgId}/members/{uid}` { uid, email, role, joinedAt }
 *
 * The member record repeats its own uid so "my organizations" is one
 * collection-group query (`members` where uid ==), which Firestore cannot
 * do on the document id alone. console/firestore.indexes.json holds the
 * collection-group index for that field.
 */

const { isOperator, requireMemberOrOperator, toIso, toMillis } = require('./access.cjs');

const NAME_MIN = 2;
const NAME_MAX = 100;
const LAUNCH_OWNERS = 2;
const OPERATOR_LIST_LIMIT = 500;

/** Trim and fold inner spaces. @returns {string|null} */
function cleanName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= NAME_MIN && name.length <= NAME_MAX ? name : null;
}

async function listOrganizations({ db }, { user }) {
  const memberships = await db.collectionGroup('members').where('uid', '==', user.uid).get();
  const mine = [];
  for (const doc of memberships.docs) {
    const orgRef = doc.ref.parent.parent;
    const org = await orgRef.get();
    if (org.exists) mine.push({ id: orgRef.id, name: org.data().name, role: doc.data().role });
  }
  mine.sort((a, b) => a.name.localeCompare(b.name));
  const operator = await isOperator(db, user.email);
  const body = { operator, organizations: mine };
  if (operator) {
    const all = await db.collection('organizations').orderBy('createdAt', 'desc').limit(OPERATOR_LIST_LIMIT).get();
    body.allOrganizations = all.docs.map((doc) => ({
      id: doc.id, name: doc.data().name, createdAt: toIso(doc.data().createdAt),
    }));
  }
  return { body };
}

const ROLE_ORDER = { owner: 0, editor: 1 };

async function getTeam({ db, now = Date.now }, { body, user }) {
  const access = await requireMemberOrOperator(db, body.orgId, user);
  const orgRef = db.collection('organizations').doc(body.orgId);
  const [org, memberSnap, inviteSnap] = await Promise.all([
    orgRef.get(),
    orgRef.collection('members').get(),
    db.collection('invites').where('orgId', '==', body.orgId).where('status', '==', 'pending').get(),
  ]);
  const members = memberSnap.docs
    .map((doc) => ({ uid: doc.id, email: doc.data().email, role: doc.data().role, joinedAt: toIso(doc.data().joinedAt) }))
    .sort((a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || a.email.localeCompare(b.email));
  const at = now();
  const invites = inviteSnap.docs
    .filter((doc) => toMillis(doc.data().expiresAt) > at)
    .map((doc) => ({ id: doc.id, email: doc.data().email, role: doc.data().role, expiresAt: toIso(doc.data().expiresAt) }))
    .sort((a, b) => a.email.localeCompare(b.email));
  const owners = members.filter((m) => m.role === 'owner').length;
  return {
    body: {
      organization: { id: orgRef.id, name: org.data().name },
      myRole: access.role,
      operator: access.operator,
      members,
      invites,
      ownersNeeded: Math.max(0, LAUNCH_OWNERS - owners),
    },
  };
}

module.exports = { getTeam, listOrganizations, cleanName, LAUNCH_OWNERS, NAME_MAX, NAME_MIN };
