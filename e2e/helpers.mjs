// Shared helpers for the e2e suite (issue #38, spec §8.1).
//
// The suite runs entirely against Firebase emulators under
// `firebase emulators:exec` (see package.json `test:e2e`), which exports
// FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST /
// FIREBASE_STORAGE_EMULATOR_HOST into this process automatically. Nothing
// here ever touches a real project or a real inbox: the console email
// provider prints every message to the functions emulator's own stdout,
// which `test:e2e` tees to E2E_EMULATOR_LOG — reading that file is the
// credential-free "inbox" every OTP/invite journey scrapes, exactly as
// scripts/dev/{login,invite}-smoke.mjs already do outside Playwright.
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
export const EMULATOR_LOG = process.env.E2E_EMULATOR_LOG || null;

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
 * Every `[email:console]` JSON blob the console email provider has printed
 * into the captured emulator log since byte offset `since` — that log IS
 * the recipient's inbox for this run (functions/src/email/providers/
 * console.cjs); an OTP code and an invite token exist nowhere else
 * server-side (one is a scrypt hash, the other a SHA-256 digest), so
 * reading the mail is the only way to obtain either. Same block-scan as
 * scripts/dev/login-smoke.mjs's scrapeCodeFromLog.
 *
 * @param {number} since byte offset to start reading from — sliced as
 *   BYTES then decoded, since mail bodies contain multibyte characters (the
 *   em dash in the OTP copy) that a string-offset slice could split.
 * @returns {object[]} parsed blobs, oldest first
 */
function readMailSince(since) {
  if (!EMULATOR_LOG) throw new Error('E2E_EMULATOR_LOG is not set — see package.json test:e2e');
  const buffer = fs.existsSync(EMULATOR_LOG) ? fs.readFileSync(EMULATOR_LOG) : Buffer.alloc(0);
  const log = buffer.subarray(since).toString('utf8')
    // firebase-tools prefixes every forwarded line of a function's captured
    // stdout with "> " under `emulators:exec` — strip it before parsing.
    .split('\n').map((line) => line.replace(/^>\s*/, '')).join('\n');
  const marker = '[email:console]';
  const blocks = log.split(marker).slice(1);
  const mails = [];
  for (const chunk of blocks) {
    const start = chunk.indexOf('{');
    if (start === -1) continue;
    let depth = 0;
    let end = -1;
    for (let j = start; j < chunk.length; j += 1) {
      if (chunk[j] === '{') depth += 1;
      else if (chunk[j] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) continue;
    try {
      mails.push(JSON.parse(chunk.slice(start, end + 1)));
    } catch {
      // A block firebase-tools split mid-write; the next poll re-reads it whole.
    }
  }
  return mails;
}

/**
 * Fail loudly, immediately, when the captured-mail log itself is the
 * problem — rather than letting a mail scan poll a file that will never
 * receive content for its whole timeout and surface as an opaque "the OTP
 * code was captured" assertion failure. Missing-or-still-empty after this
 * grace window means the file was never created (or nothing has ever been
 * teed into it), which happens exactly one way: something invoked
 * `firebase emulators:exec` / `playwright test` OUTSIDE
 * scripts/dev/run-e2e.sh, so the `tee` that produces E2E_EMULATOR_LOG never
 * ran. `emulatorLogSize()` capturing a byte offset moments earlier is what
 * every caller already does, so the file existing by then is normal; this
 * only exists to catch it NOT existing.
 *
 * @param {number} graceMs how long to tolerate the file not existing yet
 *   (global-setup's seeding takes several seconds, so a brief absence right
 *   at suite start is not itself a problem)
 */
async function assertMailLogIsWired(graceMs = 5000) {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(EMULATOR_LOG)) return;
    await sleep(250);
  }
  throw new Error(
    `E2E_EMULATOR_LOG (${EMULATOR_LOG}) does not exist. A mail scan cannot ever find anything ` +
    'in a log that was never written — the e2e suite must run through scripts/dev/run-e2e.sh ' +
    '(npm run test:e2e / the ci.yml e2e job), which tees `firebase emulators:exec`\'s output to ' +
    'this file before Playwright starts. Invoking `playwright test` directly, or wrapping ' +
    '`firebase emulators:exec` some other way, never creates it.',
  );
}

/**
 * Poll the captured emulator log until `extract` finds something in mail
 * sent to `email` since byte offset `since`, or time out.
 *
 * @param {number} since @param {string} email
 * @param {(mail: object) => string|null} extract
 * @param {number} timeoutMs
 */
async function waitForMail(since, email, extract, timeoutMs = 30000) {
  await assertMailLogIsWired();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mails = readMailSince(since).filter((m) => m.to === email);
    for (let i = mails.length - 1; i >= 0; i -= 1) {
      const found = extract(mails[i]);
      if (found) return found;
    }
    await sleep(300);
  }
  return null;
}

/** Current size of the captured emulator log, to bound a later mail wait. */
export function emulatorLogSize() {
  if (!EMULATOR_LOG) return 0;
  return fs.existsSync(EMULATOR_LOG) ? fs.statSync(EMULATOR_LOG).size : 0;
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
