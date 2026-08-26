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

test('rejects an event type outside the pull request and push contract', () => {
  const env = passingEnvironment();
  env.EVENT_NAME = 'workflow_dispatch';
  env.DCO_RESULT = 'skipped';

  assert.throws(() => verifyGate(env), /EVENT_NAME must be pull_request or push/);
});
