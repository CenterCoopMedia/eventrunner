'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESERVED_PATH_SEGMENTS,
  SYSTEM_PAGE_ROUTES,
  firstPathSegment,
  isCanonicalPagePath,
  isReservedPathSegment,
  systemPageIdForPath,
} = require('./routing.cjs');

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

test('isCanonicalPagePath accepts the shape the validator writes', () => {
  assert.equal(isCanonicalPagePath('/'), true);
  assert.equal(isCanonicalPagePath('/travel'), true);
  assert.equal(isCanonicalPagePath('/get-involved/scholarships-2026'), true);
  assert.equal(isCanonicalPagePath('/faq2'), true);
});

test('isCanonicalPagePath refuses anything that is not a path', () => {
  // A protocol-relative URL sends the reader to another origin, and an
  // absolute one says so outright. Neither may reach an href.
  assert.equal(isCanonicalPagePath('//example.org'), false);
  assert.equal(isCanonicalPagePath('//example.org/travel'), false);
  assert.equal(isCanonicalPagePath('https://example.org'), false);
  assert.equal(isCanonicalPagePath('javascript:alert(1)'), false);
  // And the merely malformed, which the validator also refuses on write.
  assert.equal(isCanonicalPagePath('travel'), false);
  assert.equal(isCanonicalPagePath('/travel/'), false);
  assert.equal(isCanonicalPagePath('/Travel'), false);
  assert.equal(isCanonicalPagePath('/tra vel'), false);
  assert.equal(isCanonicalPagePath('/-travel'), false);
  assert.equal(isCanonicalPagePath('/travel//venue'), false);
  assert.equal(isCanonicalPagePath(''), false);
  assert.equal(isCanonicalPagePath(undefined), false);
  assert.equal(isCanonicalPagePath(null), false);
  assert.equal(isCanonicalPagePath({ path: '/travel' }), false);
});

// --------------------------------------------------- the system page map

test('SYSTEM_PAGE_ROUTES names a route, a gate, and a children flag for every system page', () => {
  const ids = Object.keys(SYSTEM_PAGE_ROUTES);
  // The six the seed writes (scripts/lib/seed.cjs).
  assert.deepEqual(
    ids.slice().sort(),
    ['attendees', 'home', 'schedule', 'sponsors', 'speakers', 'updates'].sort(),
  );
  for (const [id, route] of Object.entries(SYSTEM_PAGE_ROUTES)) {
    assert.match(id, /^[a-z]+$/);
    assert.ok(route.to.startsWith('/'), id);
    assert.equal(typeof route.children, 'boolean', id);
    assert.ok(route.feature === null || typeof route.feature === 'string', id);
  }
  // Only the home page is ungated: the index route is always mounted.
  assert.equal(SYSTEM_PAGE_ROUTES.home.feature, null);
  for (const [id, route] of Object.entries(SYSTEM_PAGE_ROUTES)) {
    if (id !== 'home') assert.equal(typeof route.feature, 'string', id);
  }
});

test('SYSTEM_PAGE_ROUTES reserves every segment it mounts, so no generic page can claim one', () => {
  for (const [id, route] of Object.entries(SYSTEM_PAGE_ROUTES)) {
    if (route.to === '/') continue;
    assert.equal(isReservedPathSegment(firstPathSegment(route.to)), true, id);
  }
});

test('systemPageIdForPath answers by route, never by a stored path', () => {
  assert.equal(systemPageIdForPath('/'), 'home');
  assert.equal(systemPageIdForPath('/schedule'), 'schedule');
  assert.equal(systemPageIdForPath('/speakers'), 'speakers');
  assert.equal(systemPageIdForPath('/sponsors'), 'sponsors');
  assert.equal(systemPageIdForPath('/attendees'), 'attendees');
  assert.equal(systemPageIdForPath('/updates'), 'updates');
});

test('systemPageIdForPath resolves a detail path only under a route that mounts children', () => {
  assert.equal(systemPageIdForPath('/schedule/opening-remarks'), 'schedule');
  assert.equal(systemPageIdForPath('/speakers/rae-okonkwo'), 'speakers');
  assert.equal(systemPageIdForPath('/updates/post-1'), 'updates');
  assert.equal(systemPageIdForPath('/attendees/uid-1'), 'attendees');
  // Sponsors mounts no children, so nothing sits under it — describing
  // /sponsors/anything as the sponsors page would title a 404.
  assert.equal(systemPageIdForPath('/sponsors/anything'), null);
});

test('systemPageIdForPath answers nothing for a route no system page mounts', () => {
  assert.equal(systemPageIdForPath('/travel'), null);
  assert.equal(systemPageIdForPath('/p/schedule'), null);
  assert.equal(systemPageIdForPath('/signin'), null);
  assert.equal(systemPageIdForPath(''), null);
  assert.equal(systemPageIdForPath(undefined), null);
  assert.equal(systemPageIdForPath(null), null);
});
