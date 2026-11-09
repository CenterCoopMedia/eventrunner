'use strict';

/**
 * startBuild (ADR 0007 §6): start `provision-client.yml` for one request.
 * The console holds one narrow credential for this, a GitHub App
 * installation token with `actions: write` on one repository.
 *
 * Settings: CONSOLE_GITHUB_APP_ID, CONSOLE_GITHUB_INSTALLATION_ID,
 * CONSOLE_GITHUB_REPOSITORY (owner/name) and the secret
 * CONSOLE_GITHUB_APP_PRIVATE_KEY. With one unset or unusable it refuses to
 * dispatch, and runStartBuild reports that as a failed start. A build is live
 * unless CONSOLE_TEST_MODE is 'true', the setting the console's own checks read.
 *
 * Errors name the step and the HTTP status only, never the key, a token or a
 * response body. scripts/provision-client.cjs uses installationToken for the
 * provisioner's own App.
 */

const { createPrivateKey, createSign } = require('node:crypto');
const { notifyOperators } = require('./applicationStatus.cjs');

const API = 'https://api.github.com';
const WORKFLOW = 'provision-client.yml';
const TIMEOUT_MS = 15_000;
// GitHub refuses a token that lasts over ten minutes or starts in the future.
const JWT_SKEW_SECONDS = 60;
const JWT_LIFETIME_SECONDS = 540;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GITHUB_HEADERS = Object.freeze({
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
});

const base64url = (value) => Buffer.from(value).toString('base64url');

/** The App's own short-lived token. @throws {Error} when the key cannot sign */
function appJwt({ appId, privateKey, now = Date.now }) {
  let key;
  try {
    key = createPrivateKey(privateKey);
  } catch {
    throw new Error('github app: the private key is not usable');
  }
  const issued = Math.floor(now() / 1000);
  const body = [
    base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
    base64url(JSON.stringify({ iat: issued - JWT_SKEW_SECONDS, exp: issued + JWT_LIFETIME_SECONDS, iss: String(appId) })),
  ].join('.');
  return `${body}.${createSign('RSA-SHA256').update(body).sign(key, 'base64url')}`;
}

async function githubFetch(fetch, label, path, options) {
  let response;
  try {
    response = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS), ...options });
  } catch {
    throw new Error(`github ${label}: no answer`);
  }
  if (!response.ok) throw new Error(`github ${label}: HTTP ${response.status}`);
  return response;
}

/**
 * An installation token cut down to one repository and these permissions,
 * whatever more the App itself holds.
 *
 * @param {{ appId: string, installationId: string, privateKey: string, repository: string,
 *           permissions: Record<string, string>, fetch: typeof globalThis.fetch, now?: () => number }} input
 * @returns {Promise<string>}
 */
async function installationToken({ appId, installationId, privateKey, repository, permissions, fetch, now }) {
  const response = await githubFetch(fetch, 'installation token', `/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: 'POST',
    headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${appJwt({ appId, privateKey, now })}` },
    body: JSON.stringify({ repositories: [repository.split('/')[1]], permissions }),
  });
  const { token } = await response.json();
  if (!token) throw new Error('github installation token: the answer held no token');
  return token;
}

/**
 * @param {{ env: Record<string, string|undefined>, privateKey: string,
 *           fetch: typeof globalThis.fetch, now?: () => number }} input
 * @returns {({ appId: string }) => Promise<void>} throws when it did not dispatch
 */
function createStartBuild({ env, privateKey, fetch, now = Date.now }) {
  return async function startBuild({ appId }) {
    const githubAppId = (env.CONSOLE_GITHUB_APP_ID || '').trim();
    const installationId = (env.CONSOLE_GITHUB_INSTALLATION_ID || '').trim();
    const repository = (env.CONSOLE_GITHUB_REPOSITORY || '').trim();
    if (!githubAppId || !installationId || !REPOSITORY_RE.test(repository) || !privateKey) {
      throw new Error('start build: the GitHub App is not set up');
    }
    const token = await installationToken({
      appId: githubAppId, installationId, privateKey, repository, permissions: { actions: 'write' }, fetch, now,
    });
    await githubFetch(fetch, 'dispatch', `/repos/${repository}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        ref: 'main',
        inputs: { application_id: appId, ...(env.CONSOLE_TEST_MODE === 'true' ? { test_mode: 'true' } : {}) },
      }),
    });
  };
}

/** Run a step after the start. A failure is logged and the next step still runs. */
async function afterStart(log, what, step) {
  try {
    await step();
  } catch (err) {
    log.error(`console build start: ${what} failed`, err);
  }
}

/**
 * Start the build and record the outcome on the request. A failed start never
 * throws: it is flagged for the review queue, audited and sent to operators,
 * and an operator can then retry (buildRetry.cjs).
 *
 * @param {object} deps needs db, startBuild, now, log, and what notifyOperators needs
 * @param {{ orgId: string, appId: string, eventName: string, by?: string }} input
 * @returns {Promise<boolean>} whether it started
 */
async function runStartBuild(deps, { orgId, appId, eventName, by = 'console' }) {
  const { db, startBuild, now, log } = deps;
  const ref = db.collection('applications').doc(appId);
  try {
    await startBuild({ orgId, appId });
  } catch (err) {
    log.error('console build start: the build did not start', appId, err);
    const at = new Date(now());
    await afterStart(log, 'recording the failure', () => ref.update({ buildStart: { state: 'failed', at } }));
    await afterStart(log, 'auditing the failure', () => db.collection('console_audit').doc().create({
      action: 'build-start-failed', appId, by, at,
    }));
    await afterStart(log, 'the failure notice', () => notifyOperators(deps, { orgId, appId, eventName, kind: 'build-failed' }));
    return false;
  }
  await afterStart(log, 'recording the start', () => ref.update({ buildStart: { state: 'started', at: new Date(now()) } }));
  return true;
}

module.exports = { GITHUB_HEADERS, createStartBuild, installationToken, runStartBuild };
