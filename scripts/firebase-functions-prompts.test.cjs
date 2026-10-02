'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const lock = require('../package-lock.json');
const installed = require('firebase-tools/package.json');
const {
  promptForFailurePolicies,
  promptForFunctionDeletion,
  promptForCleanupPolicyDays,
} = require('firebase-tools/lib/deploy/functions/prompts.js');

const endpoint = {
  id: 'retryingFunction',
  region: 'us-central1',
  platform: 'gcfv2',
  eventTrigger: { eventType: 'google.cloud.firestore.document.v1.written', retry: true },
};
const want = { endpoints: { 'us-central1': { retryingFunction: endpoint } } };
const have = { endpoints: {} };

test('the installed Firebase CLI matches the lockfile used by deployments', () => {
  assert.equal(installed.version, lock.packages['node_modules/firebase-tools'].version);
});

test('the pinned CLI needs force for a new retry policy in non-interactive mode', async () => {
  await assert.rejects(
    promptForFailurePolicies({ nonInteractive: true }, want, have),
    /Pass the --force option to deploy functions with a failure policy/,
  );
  await assert.doesNotReject(promptForFailurePolicies({ nonInteractive: true, force: true }, want, have));
});

test('the pinned CLI force flag also accepts deletion and one-day artifact retention', async () => {
  assert.equal(await promptForFunctionDeletion([endpoint], { nonInteractive: true, force: true }), true);
  assert.equal(await promptForCleanupPolicyDays({ nonInteractive: true, force: true }, ['us-central1']), 1);
});
