'use strict';

/**
 * Credentials for the operator scripts (spec §2.1, §2.3: no hardcoded
 * project ids).
 *
 * Three ways in, resolved in this order, none of them interactive:
 *
 *   1. `FIRESTORE_EMULATOR_HOST` (and optionally `FIREBASE_STORAGE_EMULATOR_HOST`)
 *      — the emulator path. The Admin SDK talks to the emulator with
 *      throwaway credentials, so no service account is needed or wanted.
 *   2. `GOOGLE_APPLICATION_CREDENTIALS` — a service-account key file, the
 *      form CI has (FIREBASE_SERVICE_ACCOUNT written to a temp file).
 *   3. Application-default credentials already on the machine.
 *
 * There is deliberately no `gcloud auth login` prompt and no browser
 * flow: these scripts run in CI and over SSH, where an interactive login
 * is a hang, not a convenience.
 *
 * The project id always comes from `EVENT_FIREBASE_PROJECT_ID` (Tier A),
 * never from a constant in this file.
 */

/** @param {Record<string,string|undefined>} [env] @returns {boolean} */
function usingEmulator(env = process.env) {
  return typeof env.FIRESTORE_EMULATOR_HOST === 'string' && env.FIRESTORE_EMULATOR_HOST.trim() !== '';
}

/**
 * Resolve the project id and credential mode without touching the SDK, so
 * the decision is testable and the CLI can report it before connecting.
 *
 * @param {Record<string,string|undefined>} [env]
 * @returns {{ ok: boolean, errors: string[], projectId: string|null,
 *             mode: 'emulator'|'service-account'|'application-default',
 *             storageBucket: string|null, emulatorHost: string|null }}
 */
function resolveCredentials(env = process.env) {
  const errors = [];
  const projectId = (env.EVENT_FIREBASE_PROJECT_ID || '').trim() || null;
  if (!projectId) {
    errors.push('EVENT_FIREBASE_PROJECT_ID is not set (Tier A, .env.example)');
  }
  const emulator = usingEmulator(env);
  let mode = 'application-default';
  if (emulator) mode = 'emulator';
  else if ((env.GOOGLE_APPLICATION_CREDENTIALS || '').trim()) mode = 'service-account';

  return {
    ok: errors.length === 0,
    errors,
    projectId,
    mode,
    storageBucket: (env.EVENT_STORAGE_BUCKET || '').trim() || null,
    emulatorHost: emulator ? env.FIRESTORE_EMULATOR_HOST.trim() : null,
  };
}

/**
 * Initialize firebase-admin once per process and hand back the handles the
 * scripts use. `firebase-admin` is required lazily so the pure modules
 * (and their unit tests) never pull the SDK in.
 *
 * @param {{ env?: Record<string,string|undefined> }} [opts]
 * @returns {{ app: object, db: object, projectId: string, mode: string,
 *             bucket: () => object }}
 */
function initFirebase({ env = process.env } = {}) {
  const resolved = resolveCredentials(env);
  if (!resolved.ok) {
    throw new Error(resolved.errors.join('; '));
  }
  const { initializeApp, getApps, applicationDefault } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');

  const existing = getApps();
  const options = { projectId: resolved.projectId };
  if (resolved.storageBucket) options.storageBucket = resolved.storageBucket;
  // Under the emulator the SDK ignores credentials entirely; asking for
  // ADC there would fail on a machine that has none, which is most of them.
  if (resolved.mode === 'application-default') options.credential = applicationDefault();

  const app = existing.length > 0 ? existing[0] : initializeApp(options);
  const db = getFirestore(app);

  return {
    app,
    db,
    projectId: resolved.projectId,
    mode: resolved.mode,
    bucket() {
      if (!resolved.storageBucket) {
        throw new Error('EVENT_STORAGE_BUCKET is not set — no Storage bucket to write to');
      }
      const { getStorage } = require('firebase-admin/storage');
      return getStorage(app).bucket(resolved.storageBucket);
    },
  };
}

module.exports = { resolveCredentials, usingEmulator, initFirebase };
