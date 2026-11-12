'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONSOLE_REQUEST_STATUSES: STATUSES,
  CONSOLE_REQUEST_GROUPS: GROUPS,
  CONSOLE_REQUEST_TRANSITIONS: TRANSITIONS,
  CONSOLE_REQUEST_OPERATOR_LABELS,
  CONSOLE_REQUEST_CLIENT_LABELS,
  CONSOLE_BUILD_PHASES,
  canMoveConsoleRequest,
  inConsoleRequestGroup,
} = require('./consoleRequest.cjs');

test('every status has a transition row and both labels, and nothing else does', () => {
  for (const table of [TRANSITIONS, CONSOLE_REQUEST_OPERATOR_LABELS, CONSOLE_REQUEST_CLIENT_LABELS]) {
    assert.deepEqual(Object.keys(table).sort(), [...STATUSES].sort());
  }
});

test('groups and transitions name only known statuses', () => {
  for (const [name, members] of Object.entries(GROUPS)) {
    for (const status of members) assert.ok(STATUSES.includes(status), `${name}: ${status}`);
  }
  for (const [from, targets] of Object.entries(TRANSITIONS)) {
    for (const to of targets) assert.ok(STATUSES.includes(to), `${from} -> ${to}`);
    assert.ok(!targets.includes(from), `${from} does not move to itself`);
  }
});

test('the moves the console and scripts make are allowed, and others are not', () => {
  const made = [
    ['draft', 'approved'], ['draft', 'withdrawn'], ['draft', 'declined'],
    ['approved', 'building'], ['approved', 'declined'], ['building', 'declined'], ['building', 'ready'],
    ['ready', 'launched'],
    ['draft', 'archived'], ['ready', 'archived'], ['launched', 'archived'], ['declined', 'archived'],
    ['archived', 'ready'], ['archived', 'building'],
  ];
  for (const [from, to] of made) assert.ok(canMoveConsoleRequest(from, to), `${from} -> ${to}`);
  for (const [from, to] of [['withdrawn', 'draft'], ['declined', 'approved'], ['ready', 'building'], ['archived', 'withdrawn'], ['nope', 'draft'], ['draft', 'nope']]) {
    assert.equal(canMoveConsoleRequest(from, to), false, `${from} -> ${to}`);
  }
});

test('groups answer membership and refuse an unknown group name', () => {
  assert.equal(inConsoleRequestGroup('built', 'launched'), true);
  assert.equal(inConsoleRequestGroup('built', 'building'), false);
  assert.equal(inConsoleRequestGroup('closed', 'archived'), false);
  assert.throws(() => inConsoleRequestGroup('bulit', 'ready'), /unknown console request group/);
});

test('the lists and tables cannot be changed by a caller', () => {
  assert.ok(Object.isFrozen(STATUSES));
  assert.ok(Object.isFrozen(GROUPS) && Object.values(GROUPS).every(Object.isFrozen));
  assert.ok(Object.isFrozen(TRANSITIONS) && Object.values(TRANSITIONS).every(Object.isFrozen));
  assert.ok(Object.isFrozen(CONSOLE_BUILD_PHASES));
  for (const phase of CONSOLE_BUILD_PHASES) {
    assert.ok(Object.isFrozen(phase) && Object.isFrozen(phase.steps));
    assert.ok(phase.slowAfterMinutes > 0);
  }
});
