'use strict';

/**
 * Change a member's role, or remove a member (ADR 0007 §2). Owners only.
 *
 * An organization always keeps at least one Owner. The check and the write
 * run in one transaction over the whole member list, so two Owners who
 * demote each other at the same moment cannot both succeed.
 */

const { ConsoleError } = require('./http.cjs');
const { ROLES, requireOwner, validOrgId } = require('./access.cjs');

const LAST_OWNER = 'An organization needs at least one Owner. Make another member an Owner first.';

/**
 * Run `change({ tx, ref, members, target })` on the current member list
 * inside a transaction, after checking that the caller is still an Owner.
 * `change` buffers the write and returns the member list as it will be
 * after it. A throw after that aborts the transaction, so nothing is written.
 */
async function withTeam(db, { orgId, uid, user }, change) {
  await requireOwner(db, orgId, user);
  if (!validOrgId(uid)) throw new ConsoleError(400, 'bad-request', 'Choose a member.');
  const membersRef = db.collection('organizations').doc(orgId).collection('members');
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(membersRef);
    const members = snap.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
    const me = members.find((m) => m.uid === user.uid);
    if (!me || me.role !== 'owner') throw new ConsoleError(403, 'forbidden', 'Only an Owner can change the team.');
    const target = members.find((m) => m.uid === uid);
    if (!target) throw new ConsoleError(404, 'not-found', 'That person is not on the team.');
    const after = change({ tx, ref: membersRef.doc(uid), members, target });
    if (!after.some((m) => m.role === 'owner')) throw new ConsoleError(409, 'last-owner', LAST_OWNER);
  });
}

async function changeMemberRole({ db }, { body, user }) {
  const { orgId, uid, role } = body;
  if (!ROLES.includes(role)) throw new ConsoleError(400, 'bad-request', 'Choose Owner or Editor.');
  await withTeam(db, { orgId, uid, user }, ({ tx, ref, members }) => {
    const after = members.map((m) => (m.uid === uid ? { ...m, role } : m));
    tx.update(ref, { role });
    return after;
  });
  return { body: { uid, role } };
}

async function removeMember({ db }, { body, user }) {
  const { orgId, uid } = body;
  await withTeam(db, { orgId, uid, user }, ({ tx, ref, members }) => {
    const after = members.filter((m) => m.uid !== uid);
    tx.delete(ref);
    return after;
  });
  return { body: { uid, removed: true } };
}

module.exports = { changeMemberRole, removeMember };
