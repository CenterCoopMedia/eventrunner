'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { JOBS, verifyGate } = require('./verify-gate.cjs');

function passingEnvironment() {
  const env = {
    EVENT_NAME: 'pull_request',
    CHANGES_RESULT: 'success',
    DCO_RESULT: 'success',
    SECRETS_RESULT: 'success',
    LOCAL_VALIDATED: 'false',
  };
  for (const { selected, result } of JOBS) {
    env[selected] = 'false';
    env[result] = 'skipped';
  }
  return env;
}

test('accepts exact selector values with matching selected job results', () => {
  const env = passingEnvironment();
  env.DOCS_SELECTED = 'true';
  env.DOCS_RESULT = 'success';

  assert.doesNotThrow(() => verifyGate(env));
});

test('rejects missing and malformed selector output rather than treating it as false', () => {
  const missing = passingEnvironment();
  delete missing.DOCS_SELECTED;
  assert.throws(() => verifyGate(missing), /DOCS_SELECTED must be exactly true or false/);

  const malformed = passingEnvironment();
  malformed.DOCS_SELECTED = 'TRUE';
  assert.throws(() => verifyGate(malformed), /DOCS_SELECTED must be exactly true or false/);
});

test('requires success for selected jobs and skipped for unselected jobs', () => {
  const selectedFailure = passingEnvironment();
  selectedFailure.DOCS_SELECTED = 'true';
  assert.throws(() => verifyGate(selectedFailure), /docs was selected but finished with skipped/);

  const unselectedRun = passingEnvironment();
  unselectedRun.DOCS_RESULT = 'success';
  assert.throws(() => verifyGate(unselectedRun), /docs was not selected but finished with success/);
});

test('rejects an event type outside the pull request and manual contract', () => {
  const env = passingEnvironment();
  env.EVENT_NAME = 'push';
  env.DCO_RESULT = 'skipped';

  assert.throws(() => verifyGate(env), /EVENT_NAME must be pull_request or workflow_dispatch/);
});

test('local evidence replaces selected tiers but retains the trust checks', () => {
  const env = passingEnvironment();
  env.LOCAL_VALIDATED = 'true';
  env.DOCS_SELECTED = 'true';
  assert.doesNotThrow(() => verifyGate(env));
  env.SECRETS_RESULT = 'skipped';
  assert.throws(() => verifyGate(env), /SECRETS_RESULT must be success/);
});

test('missing local decision fails closed and manual runs cannot use local results', () => {
  const env = passingEnvironment();
  delete env.LOCAL_VALIDATED;
  assert.throws(() => verifyGate(env), /LOCAL_VALIDATED/);
  env.LOCAL_VALIDATED = 'true';
  env.EVENT_NAME = 'workflow_dispatch';
  env.DCO_RESULT = 'skipped';
  assert.throws(() => verifyGate(env), /Only pull requests/);
  env.LOCAL_VALIDATED = 'false';
  assert.doesNotThrow(() => verifyGate(env));
});
