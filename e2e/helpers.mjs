// Shared helpers for the e2e suite (issue #38, spec §8.1).
//
// The suite runs entirely against Firebase emulators under
// `firebase emulators:exec` (see package.json `test:e2e`), which exports
// FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST /
// FIREBASE_STORAGE_EMULATOR_HOST into this process automatically. Nothing
// here ever touches a real project or a real inbox: the console email
// provider (functions/src/email/providers/console.cjs) appends one JSON line
// per sent message to E2E_MAIL_FILE, and reading that file is the
// credential-free "inbox" every OTP/invite journey reads.
//
// This deliberately does NOT scrape the emulator's stdout the way
// scripts/dev/{login,invite}-smoke.mjs do. Under `emulators:exec`
// firebase-tools re-prints each captured line with a "> " prefix that it
// ANSI-colorizes whenever it believes the terminal supports color — which it
// does on GitHub Actions but not through a local pipe. That injects
// "\x1b[90m>\x1b[39m " into the middle of the provider's pretty-printed,
// multi-line JSON blob, so JSON.parse throws on every message and the scan
// finds nothing. The suite passed locally and failed in CI for exactly that
// reason. scripts/dev/run-e2e.sh still tees the emulator output to
// E2E_EMULATOR_LOG, but only as a post-mortem debugging aid — no test reads it.
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const PROJECT_ID = process.env.EVENT_FIREBASE_PROJECT_ID || 'demo-run-of-show';
export const REGION = process.env.EVENT_FIREBASE_REGION || 'us-central1';
export const FUNCTIONS_ORIGIN = `http://127.0.0.1:5001/${PROJECT_ID}/${REGION}`;
export const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
export const APP_BASE_URL = process.env.E2E_APP_URL || 'http://127.0.0.1:5173';
export const MAIL_FILE = process.env.E2E_MAIL_FILE || null;

/** One shared Admin SDK app for the whole worker (Playwright forks one Node process per worker). */
export function adminApp() {
  return getApps()[0] || initializeApp({ projectId: PROJECT_ID });
}

export function adminDb() {
  return getFirestore(adminApp());
}

export function adminAuth() {
  return getAuth(adminApp());
}

/** POST one HTTP function, returning `{ status, body }`. Mirrors scripts/dev/invite-smoke.mjs. */
export async function callFunction(name, body, idToken = null) {
  const response = await fetch(`${FUNCTIONS_ORIGIN}/${name}`, {
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
export async function idTokenFor(uid) {
  const customToken = await adminAuth().createCustomToken(uid);
  const response = await fetch(
    `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const payload = await response.json();
  if (!payload.idToken) throw new Error(`could not mint an ID token for ${uid}: ${JSON.stringify(payload)}`);
  return payload.idToken;
}

/** Create (or reuse) an emulator account with a verified address. */
export async function ensureUser(email) {
  try {
    return (await adminAuth().getUserByEmail(email)).uid;
  } catch {
    return (await adminAuth().createUser({ email, emailVerified: true })).uid;
  }
}

/** ID token for the seeded e2e admin (config/bootstrap.adminEmails; see global-setup.mjs). */
export async function adminIdToken() {
  const uid = await ensureUser(ADMIN_EMAIL);
  return idTokenFor(uid);
}

export const ADMIN_EMAIL = 'e2e-admin@example.test';

/**
 * Every message the console email provider has appended to E2E_MAIL_FILE
 * since byte offset `since` — that file IS the recipient's inbox for this
 * run (functions/src/email/providers/console.cjs); an OTP code and an invite
 * token exist nowhere else server-side (one is a scrypt hash, the other a
 * SHA-256 digest), so reading the mail is the only way to obtain either.
 *
 * One JSON object per line, so a record is self-delimiting: unlike the old
 * stdout scrape there is no prefix to strip, no ANSI to trip over, and a
 * trailing partial line (a write still in flight) is simply skipped and
 * re-read whole on the next poll.
 *
 * @param {number} since byte offset to start reading from — sliced as
 *   BYTES then decoded, since mail bodies contain multibyte characters (the
 *   em dash in the OTP copy) that a string-offset slice could split.
 * @returns {object[]} parsed messages, oldest first
 */
function readMailSince(since) {
  if (!MAIL_FILE) throw new Error('E2E_MAIL_FILE is not set — see scripts/dev/run-e2e.sh');
  const buffer = fs.existsSync(MAIL_FILE) ? fs.readFileSync(MAIL_FILE) : Buffer.alloc(0);
  const text = buffer.subarray(since).toString('utf8');
  const mails = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      mails.push(JSON.parse(line));
    } catch {
      // A trailing line still being written; the next poll re-reads it whole.
    }
  }
  return mails;
}

/**
 * Fail loudly, immediately, when the captured-mail file itself is the
 * problem — rather than letting a mail scan poll a file that will never
 * receive content for its whole timeout and surface as an opaque "the OTP
 * code was captured" assertion failure. run-e2e.sh truncates E2E_MAIL_FILE
 * into existence before Playwright starts, so by the time any spec runs the
 * file is always there (empty at worst). Still missing after this grace
 * window means exactly one thing: something invoked `firebase
 * emulators:exec` / `playwright test` OUTSIDE scripts/dev/run-e2e.sh, so
 * E2E_MAIL_FILE was never created or never reached the functions emulator.
 *
 * @param {number} graceMs how long to tolerate the file not existing yet
 */
async function assertMailFileIsWired(graceMs = 5000) {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(MAIL_FILE)) return;
    await sleep(250);
  }
  throw new Error(
    `E2E_MAIL_FILE (${MAIL_FILE}) does not exist. A mail scan cannot ever find anything in a ` +
    'file that was never written — the e2e suite must run through scripts/dev/run-e2e.sh ' +
    '(npm run test:e2e / the ci.yml e2e job), which creates this file and exports its path to ' +
    '`firebase emulators:exec` so the console email provider appends every sent message to it. ' +
    'Invoking `playwright test` directly, or wrapping `firebase emulators:exec` some other way, ' +
    'never creates it.',
  );
}

/**
 * Poll the captured-mail file until `extract` finds something in mail sent
 * to `email` since byte offset `since`, or time out.
 *
 * @param {number} since @param {string} email
 * @param {(mail: object) => string|null} extract
 * @param {number} timeoutMs
 */
async function waitForMail(since, email, extract, timeoutMs = 30000) {
  await assertMailFileIsWired();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mails = readMailSince(since).filter((m) => m.to === email);
    for (let i = mails.length - 1; i >= 0; i -= 1) {
      const found = extract(mails[i]);
      if (found) return found;
    }
    await sleep(300);
  }
  // Loud by construction: name what DID arrive, so the next reader can tell
  // "no mail at all was sent" (a real app/wiring failure) apart from "mail
  // arrived but not for this recipient, or without the field we wanted"
  // (a test-data or template problem) without re-running anything.
  const seen = readMailSince(since);
  const summary = seen.length
    ? seen.map((m) => `${m.to} <${m.tag || 'no tag'}>`).join(', ')
    : '(none)';
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for mail to ${email} in ${MAIL_FILE}. `
    + `Messages appended since offset ${since}: ${summary}. `
    + 'If that list is empty the functions emulator sent no mail at all — check that '
    + 'E2E_MAIL_FILE reached it (scripts/dev/run-e2e.sh exports it) and that the console '
    + 'email provider is selected. e2e/.tmp/emulator.log has the full emulator output.',
  );
}

/** Current size of the captured-mail file, to bound a later mail wait. */
export function mailFileSize() {
  if (!MAIL_FILE) return 0;
  return fs.existsSync(MAIL_FILE) ? fs.statSync(MAIL_FILE).size : 0;
}

/** The six-digit sign-in code most recently emailed to `email`. */
export function waitForOtpCode(since, email, timeoutMs) {
  return waitForMail(since, email, (mail) => {
    const match = `${mail.text || ''} ${mail.html || ''}`.match(/\b(\d{6})\b/);
    return match ? match[1] : null;
  }, timeoutMs);
}

/** The speaker-invite accept URL's token most recently emailed to `email`. */
export function waitForInviteToken(since, email, timeoutMs) {
  return waitForMail(since, email, (mail) => {
    const match = `${mail.text || ''} ${mail.html || ''}`.match(/\/speaker\/accept\?token=([0-9a-f]{64})/);
    return match ? match[1] : null;
  }, timeoutMs);
}
