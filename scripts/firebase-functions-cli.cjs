#!/usr/bin/env node
'use strict';

const { createRequire } = require('node:module');
const { createPacedFetch } = require('./lib/functions-write-pacing.cjs');

// Patch the pinned CLI's HTTP boundary in this child process only. Every retry
// passes through it, including apiv2's own retries. Its planner, hash-based skip,
// prompts and request/auth construction remain the CLI's responsibility.
const firebaseRequire = createRequire(require.resolve('firebase-tools/package.json'));
const fetchModule = firebaseRequire('node-fetch');
const { functionsOrigin, runOrigin } = firebaseRequire('./lib/api.js');
fetchModule.default = createPacedFetch(fetchModule.default, { origins: [functionsOrigin(), runOrigin()] });
firebaseRequire('./lib/bin/firebase.js');
