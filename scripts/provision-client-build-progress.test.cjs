'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { CONSOLE_BUILD_PHASES } = require('../packages/shared/src/consoleRequest.cjs');
const { STEPS } = require('./provision-client.cjs');

test('every provisioner step has exactly one ordered client phrase', () => {
  assert.ok(Array.isArray(CONSOLE_BUILD_PHASES), 'The shared client build phases must be defined');
  assert.deepEqual(CONSOLE_BUILD_PHASES.flatMap((phase) => phase.steps), STEPS.map((step) => step.id));
  for (const phase of CONSOLE_BUILD_PHASES) assert.ok(phase.label && phase.steps.length > 0);
});
