#!/usr/bin/env node
'use strict';

const { createRequire } = require('node:module');
const { createPacedFetch } = require('./lib/functions-write-pacing.cjs');
const { COMMAND, retireAirtableFunctions } = require('./retire-airtable-functions.cjs');

// Patch the pinned CLI's HTTP boundary in this child process only. Every retry
// passes through it, including apiv2's own retries. Its planner, hash-based skip,
// prompts and request/auth construction remain the CLI's responsibility.
const firebaseRequire = createRequire(require.resolve('firebase-tools/package.json'));
const fetchModule = firebaseRequire('node-fetch');
const { functionsOrigin, functionsV2Origin, runOrigin } = firebaseRequire('./lib/api.js');
fetchModule.default = createPacedFetch(fetchModule.default, { origins: [functionsOrigin(), functionsV2Origin(), runOrigin()] });

const [, , command, project, ...targets] = process.argv;
if (command === COMMAND) {
  retireAirtableFunctions(project, targets).catch((error) => {
    const status = Number.isInteger(error.status) ? ` (SDK status ${error.status})` : '';
    console.error(`deploy-functions: exact Airtable function retirement failed${status}`);
    process.exitCode = 1;
  });
} else {
  firebaseRequire('./lib/bin/firebase.js');
}
