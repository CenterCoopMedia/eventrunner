'use strict';

/**
 * Team invites (ADR 0007 §2).
 *
 * `invites/{inviteId}` {
 *   orgId, email (lowercase), role: 'owner'|'editor',
 *   tokenHash,            // sha256 hex of the random token, never the token
 *   status: 'pending'|'accepted'|'replaced',
 *   invitedBy, invitedByEmail, createdAt, expiresAt,
 *   acceptedBy?, acceptedAt?
 * }
 *
 * The token exists only in the email. The link puts it after `#`, so the
 * browser never sends it to a server log; the web app reads it and posts
 * it to acceptInvite. A new invite to the same address replaces the open
 * one, so only the latest email works.
 */

const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { ConsoleError } = require('./http.cjs');
const { ROLES, normalizeEmail, requireOwner, toMillis, validOrgId } = require('./access.cjs');
const { takeSlot } = require('./rateLimit.cjs');

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRES_IN_DAYS = 7;
const INVITES_PER_ORG_PER_DAY = 20;
const INVITES_PER_USER_PER_DAY = 30;
const TOKEN_MAX_LEN = 200;

const INVALID = 'This invite link is not valid. Ask an Owner to send a new invite.';

const hashToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex');

function sameHash(a, b) {
  const left = Buffer.from(String(a), 'hex');
  const right = Buffer.from(String(b), 'hex');
  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right);
}

async function inviteMember({ db, mailer, now = Date.now, publicUrl }, { body, user }) {
  const { orgId } = body;
  const inviter = await requireOwner(db, orgId, user);
  const email = normalizeEmail(body.email);
  if (!email) throw new ConsoleError(400, 'bad-request', 'Enter a valid email address.');
  if (!ROLES.includes(body.role)) throw new ConsoleError(400, 'bad-request', 'Choose Owner or Editor.');

  const orgRef = db.collection('organizations').doc(orgId);
  const members = await orgRef.collection('members').where('email', '==', email).get();
  if (!members.empty) throw new ConsoleError(409, 'already-member', 'That person is already on the team.');

  const message = 'This organization has sent too many invites today. Try again tomorrow.';
  await takeSlot(db, { key: `invite-org-${orgId}`, max: INVITES_PER_ORG_PER_DAY, windowMs: DAY_MS, now, message });
  await takeSlot(db, { key: `invite-user-${user.uid}`, max: INVITES_PER_USER_PER_DAY, windowMs: DAY_MS, now, message });

  const token = randomBytes(32).toString('base64url');
  const at = now();
  const inviteRef = db.collection('invites').doc();
  const invite = {
    orgId,
    email,
    role: body.role,
    tokenHash: hashToken(token),
    status: 'pending',
    invitedBy: user.uid,
    invitedByEmail: inviter.email || user.email,
    createdAt: new Date(at),
    expiresAt: new Date(at + EXPIRES_IN_DAYS * DAY_MS),
  };
  await inviteRef.create(invite);

  const organizationName = (await orgRef.get()).data().name;
  try {
    await mailer.sendInvite({
      to: email,
      organizationName,
      inviterEmail: invite.invitedByEmail,
      role: body.role,
      link: `${publicUrl}/invite/${inviteRef.id}#token=${token}`,
      expiresInDays: EXPIRES_IN_DAYS,
    });
  } catch (err) {
    await inviteRef.delete();
    const failed = new ConsoleError(502, 'mail-failed', 'We could not send the invite email. Try again.');
    failed.cause = err;
    throw failed;
  }

  // The email went out, so the new invite is the one that counts.
  const open = await db.collection('invites').where('orgId', '==', orgId).where('email', '==', email).get();
  const batch = db.batch();
  for (const doc of open.docs) {
    if (doc.id !== inviteRef.id && doc.data().status === 'pending') batch.update(doc.ref, { status: 'replaced' });
  }
  await batch.commit();

  return {
    status: 201,
    body: { invite: { id: inviteRef.id, email, role: body.role, expiresAt: invite.expiresAt.toISOString() } },
  };
}

async function acceptInvite({ db, now = Date.now }, { body, user }) {
  const { inviteId, token } = body;
  if (!validOrgId(inviteId) || typeof token !== 'string' || !token || token.length > TOKEN_MAX_LEN) {
    throw new ConsoleError(404, 'invite-invalid', INVALID);
  }
  const inviteRef = db.collection('invites').doc(inviteId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(inviteRef);
    // A wrong token and a missing invite get the same answer, and the token
    // is checked before anything else is said about the invite.
    if (!snap.exists || !sameHash(snap.data().tokenHash, hashToken(token))) {
      throw new ConsoleError(404, 'invite-invalid', INVALID);
    }
    const invite = snap.data();
    if (invite.status === 'accepted') throw new ConsoleError(410, 'invite-used', 'This invite was already used.');
    if (invite.status === 'replaced') {
      throw new ConsoleError(410, 'invite-replaced', 'A newer invite replaced this one. Use the link in the latest email.');
    }
    if (invite.status !== 'pending') throw new ConsoleError(404, 'invite-invalid', INVALID);
    const at = now();
    if (!(toMillis(invite.expiresAt) > at)) {
      throw new ConsoleError(410, 'invite-expired', 'This invite has expired. Ask an Owner to send a new one.');
    }
    if (invite.email !== user.email) {
      throw new ConsoleError(403, 'wrong-email', 'This invite was sent to a different email address. Sign in with that address to accept it.');
    }
    const orgRef = db.collection('organizations').doc(invite.orgId);
    const memberRef = orgRef.collection('members').doc(user.uid);
    const [org, member] = await Promise.all([tx.get(orgRef), tx.get(memberRef)]);
    if (!org.exists) throw new ConsoleError(404, 'invite-invalid', INVALID);
    let role = invite.role;
    if (member.exists) {
      role = member.data().role;
    } else {
      tx.create(memberRef, { uid: user.uid, email: user.email, role, joinedAt: new Date(at) });
    }
    tx.update(inviteRef, { status: 'accepted', acceptedBy: user.uid, acceptedAt: new Date(at) });
    return { body: { organization: { id: orgRef.id, name: org.data().name }, role } };
  });
}

module.exports = { acceptInvite, inviteMember, hashToken, EXPIRES_IN_DAYS };
