'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const scriptPath = path.join(__dirname, 'invite-smoke.mjs');

async function loadGuard() {
  return import(pathToFileURL(scriptPath).href);
}

test('invite smoke refuses a missing or remote emulator host', async () => {
  const { inviteSmokeEmulatorError } = await loadGuard();
  assert.match(
    inviteSmokeEmulatorError({}),
    /FIRESTORE_EMULATOR_HOST must be a loopback emulator host/,
  );
  assert.match(
    inviteSmokeEmulatorError({ FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }),
    /FIRESTORE_EMULATOR_HOST must be a loopback emulator host/,
  );
  assert.match(
    inviteSmokeEmulatorError({
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_AUTH_EMULATOR_HOST: 'identitytoolkit.googleapis.com:443',
    }),
    /FIREBASE_AUTH_EMULATOR_HOST must be a loopback emulator host/,
  );
  assert.match(
    inviteSmokeEmulatorError({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }),
    /FIREBASE_AUTH_EMULATOR_HOST must be a loopback emulator host/,
  );
});

test('invite smoke accepts loopback Firestore and Auth hosts', async () => {
  const { inviteSmokeEmulatorError } = await loadGuard();
  for (const auth of ['127.0.0.1:9099', 'localhost:9099', '[::1]:9099', ' 127.0.0.1:9099 ']) {
    assert.equal(inviteSmokeEmulatorError({
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_AUTH_EMULATOR_HOST: auth,
    }), null);
  }
});

function runScript(env, args) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.GOOGLE_APPLICATION_CREDENTIALS;
  try {
    execFileSync(process.execPath, [scriptPath, ...args], {
      env: childEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stderr: '' };
  } catch (error) {
    return { status: error.status, stderr: error.stderr || '' };
  }
}

test('the script exits before Firebase when the emulator hosts are absent', () => {
  const result = runScript(
    { FIRESTORE_EMULATOR_HOST: '', FIREBASE_AUTH_EMULATOR_HOST: '' },
    ['--emulator-log', 'unused.log'],
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SMOKE FAIL: FIRESTORE_EMULATOR_HOST must be a loopback emulator host/);
});

test('a loopback target still requires the emulator log before it connects', () => {
  const result = runScript(
    {
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    },
    [],
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SMOKE FAIL: --emulator-log is required/);
});
