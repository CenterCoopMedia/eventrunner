#!/usr/bin/env node
'use strict';

/**
 * Live smoke test for the speaker invite pipeline (issue #21 done-when).
 *
 * Drives the deployed HTTP endpoints against running Firebase emulators
 * (functions, firestore, auth) with the console email provider — no real
 * email is sent; the invitation URL is scraped from the functions emulator's
 * stdout log, which the console provider writes to. That scrape is the point
 * of the exercise as much as the assertions are: the invite token is stored
 * only as a SHA-256 digest, so the ONLY way to obtain it is to read the mail,
 * exactly as a speaker does.
 *
 * The whole done-when, in order:
 *
 *   admin creates a speaker → admin sends the invitation → the email is
 *   captured → the link validates before anybody signs in → an
 *   unauthenticated acceptance is refused → an account at a DIFFERENT
 *   address is refused (the invited address is an authorization boundary)
 *   → the invited speaker accepts and users.speakerId ↔ speakers.uid are
 *   linked while the token is burned → the used link no longer validates,
 *   though the accepting account's own replay stays idempotent → admin
 *   approves → speakers_public appears carrying no pipeline fields.
 *
 * Prerequisites (all credential-free / demo-project):
 *   firebase emulators:start --only functions,firestore,auth \
 *     --project demo-run-of-show > emulator.log 2>&1
 *   with EVENT_EMAIL_PROVIDER=console, EVENT_PUBLIC_URL, and
 *   EVENT_ALLOWED_ORIGINS exported for the functions runtime.
 *
 * Usage:
 *   node scripts/dev/invite-smoke.mjs --emulator-log /path/to/emulator.log
 *
 * Exits 0 and prints "SMOKE OK" when every step passes; exits 1 with a
 * diagnostic otherwise.
 */

import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function parseArgs(argv) {
  const out = {
    projectId: process.env.EVENT_FIREBASE_PROJECT_ID || 'demo-run-of-show',
    region: process.env.EVENT_FIREBASE_REGION || 'us-central1',
    functionsPort: 5001,
    authHost: process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099',
    emulatorLog: null,
    timeoutMs: 30000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--emulator-log') out.emulatorLog = argv[++i];
    else if (argv[i] === '--timeout-ms') out.timeoutMs = Number(argv[++i]);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const ORIGIN = `http://127.0.0.1:${args.functionsPort}/${args.projectId}/${args.region}`;
const ADMIN_EMAIL = 'invite-smoke-admin@example.test';
const SPEAKER_EMAIL = `invite-smoke-speaker-${Date.now()}@example.test`;
const SPEAKER_ID = `invite-smoke-${Date.now()}`;
// Unique per run: `speaker_slugs` reservations survive between runs against
// a persisted emulator, and a re-used name would 409 on the slug rather than
// on anything this script is testing.
const SPEAKER_FIRST = 'Smoke';
const SPEAKER_LAST = `Speaker ${Date.now()}`;
const SPEAKER_NAME = `${SPEAKER_FIRST} ${SPEAKER_LAST}`;

function fail(message) {
  console.error(`SMOKE FAIL: ${message}`);
  process.exit(1);
}

function check(condition, message) {
  if (!condition) fail(message);
  console.log(`  ok  ${message}`);
}

/** POST one function endpoint, returning { status, body }. */
async function call(name, body, idToken = null) {
  const response = await fetch(`${ORIGIN}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, body: payload };
}

/** An ID token for `uid`, via the Auth emulator's custom-token exchange. */
async function idTokenFor(uid) {
  const customToken = await getAuth().createCustomToken(uid);
  const response = await fetch(
    `http://${args.authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const payload = await response.json();
  if (!payload.idToken) fail(`could not mint an ID token for ${uid}: ${JSON.stringify(payload)}`);
  return payload.idToken;
}

/** Create (or reuse) an emulator account with a verified address. */
async function ensureUser(email) {
  try {
    return (await getAuth().getUserByEmail(email)).uid;
  } catch {
    return (await getAuth().createUser({ email, emailVerified: true })).uid;
  }
}

/**
 * Wait for something the console email provider printed into the emulator
 * log. That log IS the recipient's inbox for this run: both the invitation
 * token and the sign-in code exist nowhere else server-side (one is stored
 * as a SHA-256 digest, the other as a scrypt hash), so reading the mail is
 * the only way to obtain either — exactly as a speaker does.
 */
async function waitForMailMatch(re, since, deadline) {
  while (Date.now() < deadline) {
    // Sliced as BYTES, then decoded: `since` comes from statSync, and the
    // mail bodies contain multibyte characters (the em dash in the OTP
    // copy), so slicing the decoded string by a byte offset would read
    // mail from an earlier run back into the window.
    const buffer = fs.existsSync(args.emulatorLog) ? fs.readFileSync(args.emulatorLog) : Buffer.alloc(0);
    const log = buffer.subarray(since).toString('utf8');
    const matches = [...log.matchAll(re)];
    if (matches.length > 0) return matches[matches.length - 1][1];
    await sleep(300);
  }
  return null;
}

const waitForInviteUrl = (since, deadline) =>
  waitForMailMatch(/\/speaker\/accept\?token=([0-9a-f]{64})/g, since, deadline);

/**
 * Sign in through the REAL emailed-code flow (functions/src/auth/otp.cjs),
 * at `email`, and return the resulting ID token.
 *
 * This is the load-bearing half of the invited-address rule: acceptance
 * requires a verified account AT the invited address, and this is the path
 * that produces one for a speaker who has no account yet. If OTP sign-in
 * ever stopped yielding a verified address, match-required would lock every
 * invite-first speaker out — so the smoke proves the two together rather
 * than assuming they agree.
 */
async function signInWithEmailedCode(email, deadline) {
  const logSize = fs.existsSync(args.emulatorLog) ? fs.statSync(args.emulatorLog).size : 0;
  const requested = await call('sendOtpCode', { email });
  if (requested.status !== 200) fail(`sendOtpCode answered ${requested.status}`);

  // Read out of the PLAIN-TEXT body specifically, where the code stands on
  // its own line. Anything looser picks up a six-digit lookalike from the
  // HTML alternative — `color:#333333` is the one that bites — and reports
  // it as a wrong-code failure that has nothing to do with the code.
  const code = await waitForMailMatch(
    /"text":\s*"Here is your sign-in code[^"]{0,120}?\\n\\n(\d{6})\\n/g,
    logSize,
    deadline,
  );
  if (!code) fail('the sign-in code never appeared in the captured mail');

  const verified = await call('verifyOtpCode', {
    challengeId: requested.body.challengeId,
    email,
    code,
  });
  if (verified.status !== 200) fail(`verifyOtpCode answered ${verified.status}: ${JSON.stringify(verified.body)}`);

  const exchanged = await fetch(
    `http://${args.authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verified.body.token, returnSecureToken: true }),
    },
  );
  const payload = await exchanged.json();
  if (!payload.idToken) fail(`custom-token exchange failed: ${JSON.stringify(payload)}`);
  // The custom-token exchange does not always return `localId`; the uid is
  // in the ID token itself, which is what the server reads anyway.
  const claims = JSON.parse(Buffer.from(payload.idToken.split('.')[1], 'base64url').toString('utf8'));
  return { idToken: payload.idToken, uid: claims.user_id || claims.sub, claims };
}

async function main() {
  if (!args.emulatorLog) fail('--emulator-log is required');
  initializeApp({ projectId: args.projectId });
  const db = getFirestore();
  const deadline = () => Date.now() + args.timeoutMs;

  console.log('seeding config and accounts');
  await db.collection('config').doc('bootstrap').set({ adminEmails: [ADMIN_EMAIL] }, { merge: true });
  await db.collection('config').doc('event').set(
    {
      name: 'Invite Smoke Summit',
      days: [{ date: '2027-05-13' }],
      sender: { name: 'Invite Smoke Summit', email: 'sender@example.test' },
      legal: { supportEmail: 'help@example.test', postalAddressHtml: 'Example Org<br>1 Main St' },
    },
    { merge: true },
  );

  const adminUid = await ensureUser(ADMIN_EMAIL);
  const adminToken = await idTokenFor(adminUid);
  // The speaker deliberately has NO account yet: invite-first is the flow
  // §4.3 is built around, and it is the case the invited-address rule has
  // to keep working for. They get one below, through the emailed code.

  console.log('admin creates a draft speaker');
  const created = await call(
    'createSpeaker',
    {
      speakerId: SPEAKER_ID,
      speaker: { firstName: SPEAKER_FIRST, lastName: SPEAKER_LAST, email: SPEAKER_EMAIL, status: 'draft' },
    },
    adminToken,
  );
  check(created.status === 200, `createSpeaker answered 200 (${created.status})`);

  console.log('admin sends the invitation');
  const logSize = fs.existsSync(args.emulatorLog) ? fs.statSync(args.emulatorLog).size : 0;
  const sent = await call('sendSpeakerInvite', { speakerId: SPEAKER_ID }, adminToken);
  check(sent.status === 200, `sendSpeakerInvite answered 200 (${sent.status}: ${JSON.stringify(sent.body)})`);
  check(sent.body?.status === 'invited', 'the speaker moved draft → invited');

  const token = await waitForInviteUrl(logSize, deadline());
  check(Boolean(token), 'the invitation email was captured, carrying the accept URL');

  const stored = (await db.collection('speakers').doc(SPEAKER_ID).get()).data();
  check(stored.inviteToken && stored.inviteToken !== token, 'the stored token is a digest, not the token');

  console.log('the link validates before sign-in');
  const validated = await call('validateSpeakerInvite', { token });
  check(validated.status === 200 && validated.body?.valid === true, 'validateSpeakerInvite says the link is usable');
  check(validated.body?.speakerName === SPEAKER_NAME, 'it names the invited speaker');
  check(
    typeof validated.body?.invitedEmailMasked === 'string' &&
      !validated.body.invitedEmailMasked.includes(SPEAKER_EMAIL),
    'the invited address is masked',
  );

  console.log('an unauthenticated acceptance is refused');
  const anonymous = await call('acceptSpeakerInvite', { token });
  check(anonymous.status === 401, `acceptance without a signed-in account is 401 (${anonymous.status})`);

  console.log('an account at another address cannot claim the invitation');
  // The invited address is an authorization boundary: the token grants
  // attendee access and speaker access to embargoed materials, and invite
  // URLs travel. A signed-in stranger holding the link must get nowhere.
  const strangerUid = await ensureUser(`invite-smoke-stranger-${Date.now()}@example.test`);
  const strangerToken = await idTokenFor(strangerUid);
  const stranger = await call('acceptSpeakerInvite', { token }, strangerToken);
  check(
    stranger.status === 403 && stranger.body?.error?.code === 'email-mismatch',
    `a different address is refused with email-mismatch (${stranger.status}: ${JSON.stringify(stranger.body)})`,
  );
  check(
    typeof stranger.body?.error?.invitedEmailMasked === 'string' &&
      !stranger.body.error.invitedEmailMasked.includes(SPEAKER_EMAIL),
    'the refusal names the invited inbox, masked',
  );
  const afterStranger = (await db.collection('speakers').doc(SPEAKER_ID).get()).data();
  check(afterStranger.uid == null, 'the refused attempt linked nothing');
  check(afterStranger.status === 'invited', 'the invitation is still outstanding');
  check(
    (await db.collection('users').doc(strangerUid).get()).data()?.speakerId == null,
    'the stranger account holds no speaker id',
  );

  console.log('the speaker signs in with the emailed code, at the invited address');
  const { idToken: speakerToken, uid: speakerUid, claims } = await signInWithEmailedCode(
    SPEAKER_EMAIL,
    deadline(),
  );
  check(Boolean(speakerUid), 'the emailed code produced an account at the invited address');
  // The load-bearing property: acceptance requires a VERIFIED address, and
  // this is where an invite-first speaker's verified address comes from.
  check(claims.email === SPEAKER_EMAIL, 'the session is at the invited address');
  check(claims.email_verified === true, 'and that address is verified by the code they proved they received');

  console.log('the invited speaker accepts');
  // The account document is seeded by the auth onCreate trigger
  // (users/lifecycle.cjs) moments after the sign-in above, so the first
  // attempt may genuinely land ahead of it — which is the retriable 409
  // `link-target-missing` that lifecycle.cjs returns and the accept page
  // retries. Retrying here exercises that branch for real instead of
  // asserting it cannot happen.
  let accepted;
  const acceptDeadline = deadline();
  do {
    accepted = await call('acceptSpeakerInvite', { token }, speakerToken);
    if (accepted.body?.error?.code !== 'account-not-ready') break;
    console.log('  ..  account not seeded yet; retrying, as the page does');
    await sleep(300);
  } while (Date.now() < acceptDeadline);
  check(accepted.status === 200, `acceptSpeakerInvite answered 200 (${accepted.status}: ${JSON.stringify(accepted.body)})`);
  check(accepted.body?.status === 'accepted', 'the response reports the accepted status');

  const afterAccept = (await db.collection('speakers').doc(SPEAKER_ID).get()).data();
  const userDoc = (await db.collection('users').doc(speakerUid).get()).data();
  check(afterAccept.uid === speakerUid, 'speakers.uid names the account');
  check(userDoc.speakerId === SPEAKER_ID, 'users.speakerId names the speaker');
  check(afterAccept.status === 'accepted', 'the speaker is accepted');
  check(afterAccept.inviteToken === null, 'the token is burned');

  console.log('the used link is single-use, but a lost response is not');
  const reused = await call('validateSpeakerInvite', { token });
  check(reused.body?.valid === false, 'the same link no longer validates');
  // The SAME account replaying its own acceptance — a dropped response, a
  // double-click — gets the original success back rather than "not valid".
  const replayed = await call('acceptSpeakerInvite', { token }, speakerToken);
  check(
    replayed.status === 200 && replayed.body?.status === 'accepted',
    `the accepting account's replay is idempotent (${replayed.status})`,
  );
  const otherUid = await ensureUser(`invite-smoke-other-${Date.now()}@example.test`);
  const reaccepted = await call('acceptSpeakerInvite', { token }, await idTokenFor(otherUid));
  check(reaccepted.status !== 200, `a consumed token gets nobody else in (${reaccepted.status})`);

  console.log('admin approves, and the public projection appears');
  const approved = await call('updateSpeaker', { speakerId: SPEAKER_ID, speaker: { status: 'approved' } }, adminToken);
  check(approved.status === 200, `updateSpeaker answered 200 (${approved.status})`);

  const until = deadline();
  let publicDoc = null;
  while (Date.now() < until) {
    const snap = await db.collection('speakers_public').doc(SPEAKER_ID).get();
    if (snap.exists) {
      publicDoc = snap.data();
      break;
    }
    await sleep(300);
  }
  check(Boolean(publicDoc), 'speakers_public appeared after approval');
  check(publicDoc.displayName === SPEAKER_NAME, 'the projection carries the display name');
  check(!('email' in publicDoc) && !('inviteToken' in publicDoc) && !('uid' in publicDoc),
    'the projection carries no pipeline fields');

  console.log('SMOKE OK');
}

main().catch((err) => fail(err?.stack || String(err)));
