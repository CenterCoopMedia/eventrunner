'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RESERVED_PATH_SEGMENTS, firstPathSegment, isReservedPathSegment } = require('./routing.cjs');

test('RESERVED_PATH_SEGMENTS covers every statically mounted App.jsx route, the old /p/ prefix, and reserved future system areas', () => {
  for (const segment of [
    'schedule', 'speakers', 'sponsors', 'signin', 'profile', 'attendees', 'p', 'admin', 'updates', 'ticket',
  ]) {
    assert.ok(RESERVED_PATH_SEGMENTS.includes(segment), segment);
  }
});

test('isReservedPathSegment matches only reserved segments', () => {
  assert.equal(isReservedPathSegment('schedule'), true);
  assert.equal(isReservedPathSegment('profile'), true);
  assert.equal(isReservedPathSegment('attendees'), true);
  assert.equal(isReservedPathSegment('p'), true);
  assert.equal(isReservedPathSegment('updates'), true);
  assert.equal(isReservedPathSegment('ticket'), true);
  assert.equal(isReservedPathSegment('scholarships'), false);
  assert.equal(isReservedPathSegment(''), false);
});

test('firstPathSegment reads the segment this list is about, and nothing else', () => {
  assert.equal(firstPathSegment('/travel'), 'travel');
  assert.equal(firstPathSegment('/p/faq'), 'p');
  assert.equal(firstPathSegment('/schedule/session-1'), 'schedule');
  // A trailing slash is not an empty second segment.
  assert.equal(firstPathSegment('/travel/'), 'travel');
  // The home route, a relative path, and no path at all all have no segment
  // — callers compare the result, so it is never null or undefined.
  assert.equal(firstPathSegment('/'), '');
  assert.equal(firstPathSegment(''), '');
  assert.equal(firstPathSegment(undefined), '');
  assert.equal(firstPathSegment(null), '');
});
