'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyMintInvite,
  applyCancelInvite,
  applyAcceptInvite,
  resolveInvite,
  listInvites,
  createSendSpeakerInviteHandler,
  createResendSpeakerInviteHandler,
  createCancelSpeakerInviteHandler,
  createListSpeakerInvitesHandler,
  createValidateSpeakerInviteHandler,
  createAcceptSpeakerInviteHandler,
  internals,
} = require('./invites.cjs');
const { SPEAKER_INVITES, hashInviteToken, INVITE_TTL_MS } = require('./inviteTokens.cjs');
const { makeSpeakersDb } = require('./speakersFake.cjs');
const { resetTemplateCacheForTest } = require('../email/templates.cjs');

const ACTOR = { uid: 'admin-1', email: 'admin@example.org' };
const T0 = Date.parse('2026-08-21T12:00:00Z');
const NOW = () => T0;

const CONFIG = {
  event: {
    name: 'Example Summit',
    days: [{ date: '2027-05-13' }, { date: '2027-05-14' }],
    sender: { email: 's@example.org', name: 'Example Summit' },
    legal: { postalAddressHtml: 'Example Org<br>1 Main St', supportEmail: 'help@example.org' },
  },
  theme: { colors: { primary: 'BRAND', ink: 'INK' } },
  tierA: { publicUrl: 'https://summit.example.org' },
};

function world(overrides = {}) {
  return {
    'speakers/rae': {
      firstName: 'Rae',
      lastName: 'Okonkwo',
      slug: 'rae-okonkwo',
      email: 'rae@example.org',
      status: 'draft',
      uid: null,
      inviteToken: null,
    },
    'users/u1': { uid: 'u1', speakerId: null, registrationStatus: 'pending' },
    ...overrides,
  };
}

/** The one invite document in the store, with its id (the token digest). */
function onlyInvite(db) {
  const ids = db.ids(SPEAKER_INVITES);
  assert.equal(ids.length >= 1, true, 'expected at least one invite row');
  return { id: ids[0], data: db.read(SPEAKER_INVITES, ids[0]) };
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function deps(db, { admin = true, sendResult = { status: 'sent', providerMessageId: 'm1' }, now = NOW } = {}) {
  const sent = [];
  return {
    sent,
    deps: {
      db,
      auth: {
        verifyIdToken: async () => ({ uid: ACTOR.uid, email: ACTOR.email, email_verified: true }),
      },
      getConfig: async () => ({ ...CONFIG, bootstrap: { adminEmails: admin ? [ACTOR.email] : [] } }),
      sendEmail: async (message) => {
        sent.push(message);
        return typeof sendResult === 'function' ? sendResult(message) : sendResult;
      },
      now,
      log: { error() {}, warn() {}, info() {} },
    },
  };
}

/**
 * applyAcceptInvite with a verified account address. Both shipped sign-in
 * paths produce one (auth/otp.cjs sets emailVerified on the accounts it
 * creates; Google asserts it), so this is the ordinary case; the tests that
 * exercise the refusal pass emailVerified explicitly.
 */
const acceptWith = (args) => applyAcceptInvite({ emailVerified: true, ...args });

const adminReq = (body) => ({ method: 'POST', body, headers: { authorization: 'Bearer t' } });

test.beforeEach(() => resetTemplateCacheForTest());

/* --- minting ---------------------------------------------------------- */

test('sending an invite moves draft → invited and records a hashed token', async () => {
  const db = makeSpeakersDb(world());
  const result = await applyMintInvite({
    db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW,
  });

  assert.equal(result.ok, true);
  const speaker = db.read('speakers', 'rae');
  assert.equal(speaker.status, 'invited');
  assert.equal(speaker.inviteToken, hashInviteToken(result.token));
  // The raw token is nowhere in the store.
  assert.equal(JSON.stringify(db.read('speakers', 'rae')).includes(result.token), false);
  const invite = onlyInvite(db);
  assert.equal(invite.id, hashInviteToken(result.token));
  assert.equal(JSON.stringify(invite.data).includes(result.token), false);
  assert.equal(invite.data.status, 'pending');
  assert.equal(invite.data.speakerId, 'rae');
  assert.equal(invite.data.email, 'rae@example.org');
  assert.equal(invite.data.sentAt, null);
  assert.equal(invite.data.expiresAt.getTime(), T0 + INVITE_TTL_MS);
});

test('a speaker with no email cannot be invited, and nothing is written', async () => {
  const db = makeSpeakersDb(world({ 'speakers/rae': { firstName: 'Rae', lastName: 'O', status: 'draft', email: null } }));
  const result = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.message, /^email:/);
  assert.deepEqual(db.writes, []);
});

test('transition guards: approved, removed, accepted and already-invited speakers refuse a send', async () => {
  for (const [status, pattern] of [
    ['approved', /cannot be invited/],
    ['removed', /cannot be invited/],
    ['accepted', /cannot be invited/],
    ['invited', /already has an outstanding invitation/],
  ]) {
    const db = makeSpeakersDb(world({
      'speakers/rae': { firstName: 'Rae', lastName: 'O', email: 'rae@example.org', status, inviteToken: null },
    }));
    const result = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });
    assert.equal(result.ok, false, `status ${status} should refuse`);
    assert.equal(result.status, 409);
    assert.match(result.message, pattern);
    assert.deepEqual(db.writes, [], `status ${status} wrote something`);
  }
});

test('an unknown inviteType is rejected before anything is read', async () => {
  const db = makeSpeakersDb(world());
  const result = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'chief guest', mode: 'send', actor: ACTOR, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.message, /^inviteType:/);
  assert.deepEqual(db.writes, []);
});

test('resend mints a new token and the old one stops working in the same commit', async () => {
  const db = makeSpeakersDb(world());
  const first = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });
  const second = await applyMintInvite({
    db, speakerId: 'rae', inviteType: 'speaker', mode: 'resend', actor: ACTOR, now: () => T0 + 1000,
  });

  assert.equal(second.ok, true);
  assert.notEqual(second.token, first.token);
  assert.equal(db.read('speakers', 'rae').inviteToken, hashInviteToken(second.token));
  assert.equal(db.read(SPEAKER_INVITES, hashInviteToken(first.token)).status, 'superseded');
  assert.equal(db.read(SPEAKER_INVITES, hashInviteToken(second.token)).status, 'pending');

  const stale = await resolveInvite({ db, token: first.token, now: () => T0 + 2000 });
  assert.deepEqual(stale, { ok: false, reason: 'invalid' });
  const fresh = await resolveInvite({ db, token: second.token, now: () => T0 + 2000 });
  assert.equal(fresh.ok, true);
});

test('a resend with no outstanding invitation is refused by status', async () => {
  const db = makeSpeakersDb(world());
  const result = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'resend', actor: ACTOR, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.message, /no outstanding invitation to resend/);
});

test('the per-speaker send budget refuses the sixth mail in an hour and changes nothing', async () => {
  const db = makeSpeakersDb(world());
  let at = T0;
  const first = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: () => at });
  assert.equal(first.ok, true);
  for (let i = 1; i < internals.SEND_LIMIT_MAX; i += 1) {
    at += 60_000;
    const again = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'resend', actor: ACTOR, now: () => at });
    assert.equal(again.ok, true, `resend ${i} should pass the budget`);
  }
  at += 60_000;
  const writesBefore = db.writes.length;
  const refused = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'resend', actor: ACTOR, now: () => at });
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 429);
  assert.equal(typeof refused.retryAfterMs, 'number');
  assert.equal(db.writes.length, writesBefore, 'a refused resend wrote something');

  // The window slides: an hour after the first send there is room again.
  const later = await applyMintInvite({
    db, speakerId: 'rae', inviteType: 'speaker', mode: 'resend', actor: ACTOR,
    now: () => T0 + internals.SEND_LIMIT_WINDOW_MS + 1,
  });
  assert.equal(later.ok, true);
});

/* --- cancel ----------------------------------------------------------- */

test('cancelling burns the token and reverts invited → draft', async () => {
  const db = makeSpeakersDb(world());
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });
  const result = await applyCancelInvite({ db, speakerId: 'rae', actor: ACTOR, now: () => T0 + 10 });

  assert.equal(result.ok, true);
  assert.equal(db.read('speakers', 'rae').status, 'draft');
  assert.equal(db.read('speakers', 'rae').inviteToken, null);
  assert.equal(db.read(SPEAKER_INVITES, hashInviteToken(minted.token)).status, 'cancelled');
  assert.deepEqual(await resolveInvite({ db, token: minted.token, now: () => T0 + 20 }), { ok: false, reason: 'invalid' });
});

test('a cancelled invitation cannot be accepted', async () => {
  const db = makeSpeakersDb(world());
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });
  await applyCancelInvite({ db, speakerId: 'rae', actor: ACTOR, now: () => T0 + 10 });

  const accepted = await acceptWith({
    db, token: minted.token, uid: 'u1', email: 'rae@example.org', now: () => T0 + 20,
  });
  assert.equal(accepted.ok, false);
  assert.equal(accepted.code, 'invite-invalid');
  assert.equal(db.read('users', 'u1').speakerId, null);
});

test('an accepted invitation cannot be cancelled', async () => {
  const db = makeSpeakersDb(world());
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });
  await acceptWith({ db, token: minted.token, uid: 'u1', email: 'rae@example.org', now: () => T0 + 10 });

  const result = await applyCancelInvite({ db, speakerId: 'rae', actor: ACTOR, now: () => T0 + 20 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.message, /already been accepted/);
});

/* --- resolve / no-oracle --------------------------------------------- */

test('every miss but expiry answers the same: invalid', async () => {
  const db = makeSpeakersDb(world());
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });

  const unknown = await resolveInvite({ db, token: 'f'.repeat(64), now: NOW });
  const malformed = await resolveInvite({ db, token: 'not-a-token', now: NOW });
  assert.deepEqual(unknown, { ok: false, reason: 'invalid' });
  assert.deepEqual(malformed, { ok: false, reason: 'invalid' });

  // A real token whose speaker was moved off `invited` behind the scenes.
  await db.collection('speakers').doc('rae').set({ status: 'removed' }, { merge: true });
  assert.deepEqual(await resolveInvite({ db, token: minted.token, now: NOW }), { ok: false, reason: 'invalid' });
});

test('an expired token is expired, not invalid — and cannot be accepted', async () => {
  const db = makeSpeakersDb(world());
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });
  const after = () => T0 + INVITE_TTL_MS + 1;

  assert.deepEqual(await resolveInvite({ db, token: minted.token, now: after }), { ok: false, reason: 'expired' });
  const accepted = await acceptWith({ db, token: minted.token, uid: 'u1', email: 'rae@example.org', now: after });
  assert.equal(accepted.ok, false);
  assert.equal(accepted.status, 410);
  assert.equal(accepted.code, 'invite-expired');
  assert.equal(db.read('users', 'u1').speakerId, null);
  assert.equal(db.read('speakers', 'rae').status, 'invited');
});

/* --- acceptance ------------------------------------------------------- */

test('acceptance links both halves, transitions to accepted, and burns the token', async () => {
  const db = makeSpeakersDb(world());
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });

  const result = await acceptWith({
    db, token: minted.token, uid: 'u1', email: 'rae@example.org', now: () => T0 + 10,
  });

  assert.equal(result.ok, true);
  // §4.3 seam #3: both halves, one pair.
  assert.equal(db.read('users', 'u1').speakerId, 'rae');
  assert.equal(db.read('speakers', 'rae').uid, 'u1');
  assert.equal(db.read('speakers', 'rae').status, 'accepted');
  assert.equal(db.read('speakers', 'rae').inviteToken, null);
  assert.equal(db.read(SPEAKER_INVITES, hashInviteToken(minted.token)).status, 'accepted');
  assert.equal(db.read(SPEAKER_INVITES, hashInviteToken(minted.token)).acceptedByUid, 'u1');
});

test('the token is single-use: a second acceptance by a different account is refused', async () => {
  const db = makeSpeakersDb(world({ 'users/u2': { uid: 'u2', speakerId: null } }));
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });
  await acceptWith({ db, token: minted.token, uid: 'u1', email: 'rae@example.org', now: () => T0 + 10 });

  const second = await acceptWith({ db, token: minted.token, uid: 'u2', email: 'other@example.org', now: () => T0 + 20 });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'invite-invalid');
  assert.equal(db.read('users', 'u2').speakerId, null);
  assert.equal(db.read('speakers', 'rae').uid, 'u1');
});

test('the same account replaying its own acceptance gets the original success back', async () => {
  const db = makeSpeakersDb(world());
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });
  await acceptWith({ db, token: minted.token, uid: 'u1', email: 'rae@example.org', now: () => T0 + 10 });

  // A lost HTTP response, or a double-click: the work is done and durable,
  // so telling this speaker their link is "not valid" would be false and
  // send them to support over a dropped packet.
  const writesBefore = db.writes.length;
  const replay = await acceptWith({ db, token: minted.token, uid: 'u1', email: 'rae@example.org', now: () => T0 + 20 });
  assert.equal(replay.ok, true);
  assert.equal(replay.alreadyAccepted, true);
  assert.equal(replay.speakerId, 'rae');
  assert.equal(db.read('speakers', 'rae').status, 'accepted');
  assert.equal(db.writes.length, writesBefore, 'a replay rewrote something');
});

test('a consumed token replayed by a DIFFERENT account is still just invalid', async () => {
  const db = makeSpeakersDb(world({ 'users/u2': { uid: 'u2', speakerId: null } }));
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });
  await acceptWith({ db, token: minted.token, uid: 'u1', email: 'rae@example.org', now: () => T0 + 10 });

  const other = await acceptWith({ db, token: minted.token, uid: 'u2', email: 'rae@example.org', now: () => T0 + 20 });
  assert.equal(other.ok, false);
  assert.equal(other.code, 'invite-invalid');
  assert.equal(db.read('users', 'u2').speakerId, null);
});

test('a retry after the link committed but the transition did not still succeeds', async () => {
  const db = makeSpeakersDb(world());
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });

  // Simulate the crash window: the pair write landed, the status/token
  // transition did not.
  const { linkSpeakerToUser } = require('./lifecycle.cjs');
  await linkSpeakerToUser({ db, speakerId: 'rae', uid: 'u1', now: () => T0 + 5 });
  assert.equal(db.read('speakers', 'rae').status, 'invited');

  const result = await acceptWith({ db, token: minted.token, uid: 'u1', email: 'rae@example.org', now: () => T0 + 10 });
  assert.equal(result.ok, true);
  assert.equal(db.read('speakers', 'rae').status, 'accepted');
  assert.equal(db.read('speakers', 'rae').inviteToken, null);
});

test('an account already linked to another speaker is refused with link-occupied', async () => {
  const db = makeSpeakersDb(world({
    'speakers/sam-example': { firstName: 'Sam', lastName: 'Example', slug: 'sam-example', status: 'accepted', uid: 'u1' },
    'users/u1': { uid: 'u1', speakerId: 'sam-example' },
  }));
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });

  const result = await acceptWith({ db, token: minted.token, uid: 'u1', email: 'rae@example.org', now: () => T0 + 10 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, 'link-occupied');
  // The public message must not name the occupying speaker record — that
  // detail is admin-facing (lifecycle.cjs keeps it for the operator).
  assert.equal(result.message.includes('sam-example'), false);
  // Nothing moved: the invitation is still usable by the right account.
  assert.equal(db.read('users', 'u1').speakerId, 'sam-example');
  assert.equal(db.read('speakers', 'rae').status, 'invited');
  assert.equal((await resolveInvite({ db, token: minted.token, now: () => T0 + 20 })).ok, true);
});

test('an account whose users document does not exist yet gets retry guidance', async () => {
  const db = makeSpeakersDb(world());
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });

  const result = await acceptWith({ db, token: minted.token, uid: 'brand-new', email: 'rae@example.org', now: () => T0 + 10 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, 'account-not-ready');
  assert.match(result.message, /try again/i);
  assert.equal(db.read('speakers', 'rae').status, 'invited');
  assert.equal(db.read('speakers', 'rae').uid, null);
});

test('an account at a DIFFERENT address is refused, and nothing is linked', async () => {
  const db = makeSpeakersDb(world());
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });

  const result = await acceptWith({
    db, token: minted.token, uid: 'u1', email: 'Rae.Personal@Example.NET', now: () => T0 + 10,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, 'email-mismatch');
  // Actionable without printing the address into a page reached from a link
  // that may have travelled.
  assert.equal(result.invitedEmailMasked, 'r**@example.org');
  assert.equal(result.message.includes('rae@example.org'), false);
  // The pair is untouched and the invitation still works for the right
  // account — a mismatch must not consume the token.
  assert.equal(db.read('users', 'u1').speakerId, null);
  assert.equal(db.read('speakers', 'rae').uid, null);
  assert.equal(db.read('speakers', 'rae').status, 'invited');
  assert.equal((await resolveInvite({ db, token: minted.token, now: () => T0 + 20 })).ok, true);
});

test('the invited address matches case-insensitively and ignores surrounding space', async () => {
  const db = makeSpeakersDb(world());
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });

  const result = await acceptWith({
    db, token: minted.token, uid: 'u1', email: '  RAE@Example.ORG ', now: () => T0 + 10,
  });
  assert.equal(result.ok, true);
  assert.equal(db.read('speakers', 'rae').acceptedEmail, 'rae@example.org');
});

test('an UNVERIFIED address at the invited inbox is refused: the check wants proof, not a claim', async () => {
  const db = makeSpeakersDb(world());
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });

  const result = await applyAcceptInvite({
    db, token: minted.token, uid: 'u1', email: 'rae@example.org', emailVerified: false, now: () => T0 + 10,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'email-mismatch');
  assert.equal(db.read('users', 'u1').speakerId, null);
});

test('an admin cancelling mid-acceptance cannot leave a linked, uninvited speaker', async () => {
  // The race the single transaction exists for: with validation and the
  // pair write in separate transactions, a cancel landing between them
  // linked the account to a speaker the organizer had just revoked — and
  // left it linked, holding the attendee access §3.4 grants for
  // `speakerId != null`, while the speaker was told the invite was invalid.
  const db = makeSpeakersDb(world());
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });

  let cancelled = false;
  const racingDb = {
    ...db,
    async runTransaction(fn) {
      // Fire the cancel once, after the acceptance transaction has read but
      // before it commits; the second attempt (Firestore retries an aborted
      // transaction) then sees the cancelled state.
      if (!cancelled) {
        cancelled = true;
        await applyCancelInvite({ db, speakerId: 'rae', actor: ACTOR, now: () => T0 + 5 });
      }
      return db.runTransaction(fn);
    },
  };

  const result = await acceptWith({
    db: racingDb, token: minted.token, uid: 'u1', email: 'rae@example.org', now: () => T0 + 10,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invite-invalid');
  // The critical assertion: the pair did NOT move.
  assert.equal(db.read('users', 'u1').speakerId, null);
  assert.equal(db.read('speakers', 'rae').uid, null);
  assert.equal(db.read('speakers', 'rae').status, 'draft');
});

/* --- listing ---------------------------------------------------------- */

test('the invite listing never returns the token digest', async () => {
  const db = makeSpeakersDb(world());
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'panelist', mode: 'send', actor: ACTOR, now: NOW });
  const rows = await listInvites({ db });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].speakerId, 'rae');
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].inviteType, 'panelist');
  assert.equal(JSON.stringify(rows[0]).includes(hashInviteToken(minted.token)), false);
  assert.equal(JSON.stringify(rows[0]).includes(minted.token), false);
});

test('the listing orders and caps in the QUERY, not after it', async () => {
  const db = makeSpeakersDb(world());
  // Six invitations for one speaker, oldest first.
  let at = T0;
  await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: () => at });
  for (let i = 0; i < 4; i += 1) {
    at += 2 * internals.SEND_LIMIT_WINDOW_MS;
    await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'resend', actor: ACTOR, now: () => at });
  }
  assert.equal(db.ids(SPEAKER_INVITES).length, 5);

  const rows = await listInvites({ db, limit: 2 });
  assert.equal(rows.length, 2);
  // Newest first, and the cap was applied by the query — `speaker_invites`
  // is append-only for the life of an event, so a collection read plus a
  // client-side slice would bill the whole history to render one screen.
  assert.equal(rows[0].createdAt > rows[1].createdAt, true);
  assert.equal(rows[0].status, 'pending');
  const lastRead = db.reads[db.reads.length - 1];
  assert.equal(String(lastRead).startsWith(SPEAKER_INVITES), true);
});

test('the listing filters by speaker', async () => {
  const db = makeSpeakersDb(world({
    'speakers/sam': { firstName: 'Sam', lastName: 'Other', email: 'sam@example.org', status: 'draft', inviteToken: null },
  }));
  await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });
  await applyMintInvite({ db, speakerId: 'sam', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });

  assert.equal((await listInvites({ db })).length, 2);
  const raeOnly = await listInvites({ db, speakerId: 'rae' });
  assert.equal(raeOnly.length, 1);
  assert.equal(raeOnly[0].speakerId, 'rae');
});

/* --- handlers --------------------------------------------------------- */

test('every admin endpoint is admin-gated and POST-only', async () => {
  for (const create of [
    createSendSpeakerInviteHandler,
    createResendSpeakerInviteHandler,
    createCancelSpeakerInviteHandler,
    createListSpeakerInvitesHandler,
  ]) {
    const db = makeSpeakersDb(world());
    const denied = fakeRes();
    await create(deps(db, { admin: false }).deps)(adminReq({ speakerId: 'rae' }), denied);
    assert.equal(denied.statusCode, 403);

    const wrongMethod = fakeRes();
    await create(deps(db).deps)({ method: 'GET' }, wrongMethod);
    assert.equal(wrongMethod.statusCode, 405);
    assert.deepEqual(db.writes, []);
  }
});

test('sendSpeakerInvite mails a tokenized invite that carries the accept URL and is never stored', async () => {
  const db = makeSpeakersDb(world());
  const { sent, deps: d } = deps(db);
  const res = fakeRes();
  await createSendSpeakerInviteHandler(d)(adminReq({ speakerId: 'rae' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'invited');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'rae@example.org');
  assert.equal(sent[0].tag, 'speaker.invite');
  // storeRendered false: the body holds a bearer token and sent_emails is
  // admin-readable (spec §3.1).
  assert.equal(sent[0].storeRendered, false);
  const match = sent[0].text.match(/\/speaker\/accept\?token=([0-9a-f]{64})/);
  assert.notEqual(match, null, 'the mail must carry the accept URL');
  assert.equal(sent[0].html.includes(match[0]), true);
  assert.equal(sent[0].subject.includes('Example Summit'), true);
  // The mailed token is the one the store hashed.
  assert.equal(db.read('speakers', 'rae').inviteToken, hashInviteToken(match[1]));
  // The delivery stamp lands only after the provider accepted it.
  assert.notEqual(onlyInvite(db).data.sentAt, null);
  // Audited.
  assert.equal(db.ids('admin_logs').length, 1);
});

test('a provider failure leaves the invitation recorded, undelivered, and says so', async () => {
  const db = makeSpeakersDb(world());
  const { deps: d } = deps(db, { sendResult: { status: 'failed', providerStatus: 500 } });
  const res = fakeRes();
  await createSendSpeakerInviteHandler(d)(adminReq({ speakerId: 'rae' }), res);

  assert.equal(res.statusCode, 502);
  assert.match(res.body.error.message, /not delivered/);
  assert.equal(db.read('speakers', 'rae').status, 'invited');
  assert.equal(onlyInvite(db).data.sentAt, null);
});

test('resend keys its send-once claim on the minted token, not on the minute', async () => {
  const db = makeSpeakersDb(world());
  // A frozen clock is the point: under a per-minute key these two resends
  // would claim the same key, the email core would answer skipped, and the
  // second (only valid) token would be stamped delivered without a mail
  // ever carrying it — leaving the speaker with a dead link.
  const { sent, deps: d } = deps(db);
  await createSendSpeakerInviteHandler(d)(adminReq({ speakerId: 'rae' }), fakeRes());
  await createResendSpeakerInviteHandler(d)(adminReq({ speakerId: 'rae' }), fakeRes());
  const res = fakeRes();
  await createResendSpeakerInviteHandler(d)(adminReq({ speakerId: 'rae' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 3);
  assert.equal(new Set(sent.map((m) => m.onceKey)).size, 3, 'two sends shared a send-once key');
  for (const message of sent.slice(1)) {
    assert.match(message.onceKey, /^speaker-invite:resend:[0-9a-f]{64}$/);
  }
  // Each mail carries the token whose digest keys it.
  for (const message of sent) {
    const token = message.text.match(/token=([0-9a-f]{64})/)[1];
    assert.equal(message.onceKey.endsWith(hashInviteToken(token)), true);
  }
  // And the live token is the last one mailed.
  const lastToken = sent[2].text.match(/token=([0-9a-f]{64})/)[1];
  assert.equal(db.read('speakers', 'rae').inviteToken, hashInviteToken(lastToken));
});

test('two speakers invited in the same minute by one admin both get mail', async () => {
  const db = makeSpeakersDb(world({
    'speakers/sam': { firstName: 'Sam', lastName: 'Other', email: 'sam@example.org', status: 'invited', inviteToken: null },
  }));
  // Seeded `invited` with no token so the resend path applies to both.
  await db.collection('speakers').doc('sam').set({ status: 'draft' }, { merge: true });
  const { sent, deps: d } = deps(db);
  await createSendSpeakerInviteHandler(d)(adminReq({ speakerId: 'rae' }), fakeRes());
  await createSendSpeakerInviteHandler(d)(adminReq({ speakerId: 'sam' }), fakeRes());
  await createResendSpeakerInviteHandler(d)(adminReq({ speakerId: 'rae' }), fakeRes());
  await createResendSpeakerInviteHandler(d)(adminReq({ speakerId: 'sam' }), fakeRes());

  assert.equal(sent.length, 4);
  assert.equal(new Set(sent.map((m) => m.onceKey)).size, 4);
  assert.deepEqual(sent.map((m) => m.to), [
    'rae@example.org', 'sam@example.org', 'rae@example.org', 'sam@example.org',
  ]);
});

test('the rate-limited resend answers 429 with a Retry-After', async () => {
  const db = makeSpeakersDb(world());
  let at = T0;
  const { deps: d } = deps(db, { now: () => at });
  await createSendSpeakerInviteHandler(d)(adminReq({ speakerId: 'rae' }), fakeRes());
  for (let i = 1; i < internals.SEND_LIMIT_MAX; i += 1) {
    at += 1000;
    await createResendSpeakerInviteHandler(d)(adminReq({ speakerId: 'rae' }), fakeRes());
  }
  at += 1000;
  const res = fakeRes();
  await createResendSpeakerInviteHandler(d)(adminReq({ speakerId: 'rae' }), res);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error.code, 'rate-limited');
  assert.equal(typeof res.headers['Retry-After'], 'string');
});

test('validateSpeakerInvite answers 200 for every outcome and masks the address', async () => {
  const db = makeSpeakersDb(world());
  const { deps: d } = deps(db);
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });

  const ok = fakeRes();
  await createValidateSpeakerInviteHandler(d)({ method: 'POST', body: { token: minted.token } }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.valid, true);
  assert.equal(ok.body.speakerName, 'Rae Okonkwo');
  assert.equal(ok.body.invitedEmailMasked, 'r**@example.org');
  assert.equal(JSON.stringify(ok.body).includes('rae@example.org'), false);

  const miss = fakeRes();
  await createValidateSpeakerInviteHandler(d)({ method: 'POST', body: { token: 'f'.repeat(64) } }, miss);
  assert.equal(miss.statusCode, 200);
  assert.deepEqual(miss.body, { valid: false, reason: 'invalid' });

  const expired = fakeRes();
  await createValidateSpeakerInviteHandler({ ...d, now: () => T0 + INVITE_TTL_MS + 1 })(
    { method: 'POST', body: { token: minted.token } },
    expired,
  );
  assert.equal(expired.statusCode, 200);
  assert.deepEqual(expired.body, { valid: false, reason: 'expired' });
});

test('acceptSpeakerInvite requires a signed-in caller', async () => {
  const db = makeSpeakersDb(world());
  const { deps: d } = deps(db);
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });

  const res = fakeRes();
  await createAcceptSpeakerInviteHandler({ ...d, auth: { verifyIdToken: async () => { throw new Error('bad'); } } })(
    { method: 'POST', body: { token: minted.token }, headers: {} },
    res,
  );
  assert.equal(res.statusCode, 401);
  assert.equal(db.read('speakers', 'rae').status, 'invited');
});

test('a successful acceptance mails speaker.accepted with the §3.1 onceKey', async () => {
  const db = makeSpeakersDb(world());
  const { sent, deps: d } = deps(db);
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });

  const res = fakeRes();
  await createAcceptSpeakerInviteHandler({
    ...d,
    auth: { verifyIdToken: async () => ({ uid: 'u1', email: 'rae@example.org', email_verified: true }) },
  })({ method: 'POST', body: { token: minted.token }, headers: { authorization: 'Bearer t' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'accepted');
  const confirmation = sent.find((m) => m.tag === 'speaker.accepted');
  assert.notEqual(confirmation, undefined);
  assert.equal(confirmation.onceKey, 'speaker-accepted:rae');
  assert.equal(confirmation.storeRendered, true);
  assert.equal(confirmation.html.includes('https://summit.example.org/speaker/profile'), true);
  // The CTA is the WIZARD (issue #22) — the canonical speakers/{id} record
  // an organizer approves, not the attendee /profile page.
  assert.match(confirmation.text, /write your speaker profile/i);
});

test('the accept handler answers a mismatch with the masked invited address', async () => {
  const db = makeSpeakersDb(world());
  const { sent, deps: d } = deps(db);
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });

  const res = fakeRes();
  await createAcceptSpeakerInviteHandler({
    ...d,
    auth: { verifyIdToken: async () => ({ uid: 'u1', email: 'someone.else@example.net', email_verified: true }) },
  })({ method: 'POST', body: { token: minted.token }, headers: { authorization: 'Bearer t' } }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'email-mismatch');
  assert.equal(res.body.error.invitedEmailMasked, 'r**@example.org');
  assert.equal(JSON.stringify(res.body).includes('rae@example.org'), false);
  // No confirmation mail for a refused acceptance.
  assert.equal(sent.some((m) => m.tag === 'speaker.accepted'), false);
  assert.equal(db.read('users', 'u1').speakerId, null);
});

test('an acceptance whose confirmation mail fails is still an acceptance', async () => {
  const db = makeSpeakersDb(world());
  const { deps: d } = deps(db, {
    sendResult: () => { throw new Error('provider exploded'); },
  });
  const minted = await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });

  const res = fakeRes();
  await createAcceptSpeakerInviteHandler({
    ...d,
    auth: { verifyIdToken: async () => ({ uid: 'u1', email: 'rae@example.org', email_verified: true }) },
  })({ method: 'POST', body: { token: minted.token }, headers: { authorization: 'Bearer t' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(db.read('users', 'u1').speakerId, 'rae');
});

test('listSpeakerInvites answers admins with rows and rejects a bad filter', async () => {
  const db = makeSpeakersDb(world());
  const { deps: d } = deps(db);
  await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });

  const res = fakeRes();
  await createListSpeakerInvitesHandler(d)(adminReq({}), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.invites.length, 1);

  const bad = fakeRes();
  await createListSpeakerInvitesHandler(d)(adminReq({ speakerId: 'a/b' }), bad);
  assert.equal(bad.statusCode, 400);
});

test('the endpoints that never send mail work without an email provider', async () => {
  // Deploy shape, asserted through the handler factories: cancel, list, and
  // validate are constructed with NO sendEmail at all. Building an email
  // provider for them would make a provider-configuration problem
  // (unset EVENT_EMAIL_PROVIDER, unbound adapter secrets — both throw at
  // construction) a 500 on endpoints that never needed one, including the
  // public endpoint a speaker's accept page calls first.
  const db = makeSpeakersDb(world());
  await applyMintInvite({ db, speakerId: 'rae', inviteType: 'speaker', mode: 'send', actor: ACTOR, now: NOW });
  const { deps: full } = deps(db);
  const mailless = { ...full };
  delete mailless.sendEmail;

  const cancelled = fakeRes();
  await createCancelSpeakerInviteHandler(mailless)(adminReq({ speakerId: 'rae' }), cancelled);
  assert.equal(cancelled.statusCode, 200);

  const listed = fakeRes();
  await createListSpeakerInvitesHandler(mailless)(adminReq({}), listed);
  assert.equal(listed.statusCode, 200);

  const validated = fakeRes();
  await createValidateSpeakerInviteHandler(mailless)({ method: 'POST', body: { token: 'f'.repeat(64) } }, validated);
  assert.equal(validated.statusCode, 200);
});

test('the deployable definitions bind send secrets only to the mail-sending endpoints', () => {
  // The other half of the same guarantee: a secret bound to an endpoint is
  // a secret that endpoint's deployment requires.
  const previous = process.env.EVENT_EMAIL_PROVIDER;
  process.env.EVENT_EMAIL_PROVIDER = 'postmark';
  try {
    const { handlers } = require('./invites.cjs');
    const secretsOf = (fn) =>
      (Object.getOwnPropertyDescriptor(fn, '__endpoint')?.value?.secretEnvironmentVariables ?? [])
        .map((s) => s.key)
        .sort();

    assert.deepEqual(secretsOf(handlers.cancelSpeakerInvite), []);
    assert.deepEqual(secretsOf(handlers.listSpeakerInvites), []);
    assert.deepEqual(secretsOf(handlers.validateSpeakerInvite), []);
    assert.equal(secretsOf(handlers.sendSpeakerInvite).length > 0, true);
    assert.equal(secretsOf(handlers.resendSpeakerInvite).length > 0, true);
    assert.equal(secretsOf(handlers.acceptSpeakerInvite).length > 0, true);
  } finally {
    if (previous === undefined) delete process.env.EVENT_EMAIL_PROVIDER;
    else process.env.EVENT_EMAIL_PROVIDER = previous;
  }
});
