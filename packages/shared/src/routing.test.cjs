'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RESERVED_PATH_SEGMENTS, isReservedPathSegment } = require('./routing.cjs');

test('RESERVED_PATH_SEGMENTS covers every statically mounted App.jsx route, the old /p/ prefix, and reserved future system areas', () => {
  for (const segment of [
    'schedule', 'speakers', 'sponsors', 'signin', 'profile', 'attendees', 'p', 'admin',
  ]) {
    assert.ok(RESERVED_PATH_SEGMENTS.includes(segment), segment);
  }
});

test('isReservedPathSegment matches only reserved segments', () => {
  assert.equal(isReservedPathSegment('schedule'), true);
  assert.equal(isReservedPathSegment('profile'), true);
  assert.equal(isReservedPathSegment('attendees'), true);
  assert.equal(isReservedPathSegment('p'), true);
  assert.equal(isReservedPathSegment('scholarships'), false);
  assert.equal(isReservedPathSegment(''), false);
});
