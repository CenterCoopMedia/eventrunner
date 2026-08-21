'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isBenignClientError } = require('./benignFilter.cjs');

// --- SafeLinks -----------------------------------------------------------------

test('flags a SafeLinks URL as benign', () => {
  assert.equal(
    isBenignClientError({
      message: 'Failed to fetch',
      url: 'https://nam02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.org',
    }),
    true,
  );
});

test('flags a SafeLinks reference in the stack, not just the url field', () => {
  assert.equal(
    isBenignClientError({
      message: 'NetworkError',
      stack: 'at fetch (safelinks.protection.outlook.com/...)',
    }),
    true,
  );
});

// --- stale bundle ----------------------------------------------------------------

test('flags a ChunkLoadError as benign', () => {
  assert.equal(isBenignClientError({ message: 'ChunkLoadError: Loading chunk 42 failed.' }), true);
});

test('flags a dynamic-import failure as benign', () => {
  assert.equal(
    isBenignClientError({ message: 'Failed to fetch dynamically imported module: https://x/chunk-abc.js' }),
    true,
  );
});

test('flags a Firefox-style module import failure as benign', () => {
  assert.equal(isBenignClientError({ message: 'error loading dynamically imported module: https://x/y.js' }), true);
});

// --- browser extensions -----------------------------------------------------------

test('flags an error whose stack originates in a chrome extension', () => {
  assert.equal(
    isBenignClientError({
      message: 'Cannot read properties of null',
      stack: 'at inject (chrome-extension://abcdefghijklmnop/content.js:10:5)',
    }),
    true,
  );
});

test('flags a Firefox extension context invalidation as benign', () => {
  assert.equal(isBenignClientError({ message: 'Extension context invalidated.' }), true);
});

test('flags a moz-extension source url as benign', () => {
  assert.equal(isBenignClientError({ url: 'moz-extension://abc-123/page.html' }), true);
});

// --- negative cases: real bugs must NOT be filtered -------------------------------

test('does not flag an ordinary application error', () => {
  assert.equal(
    isBenignClientError({
      message: "Cannot read properties of undefined (reading 'map')",
      stack: 'at Schedule (Schedule.jsx:120:10)',
      url: 'https://example.org/schedule',
      userAgent: 'Mozilla/5.0',
    }),
    false,
  );
});

test('does not flag a real network error unrelated to SafeLinks or chunks', () => {
  assert.equal(isBenignClientError({ message: 'Failed to fetch', url: 'https://example.org/api/x' }), false);
});

test('handles missing/empty fields without throwing', () => {
  assert.equal(isBenignClientError({}), false);
  assert.equal(isBenignClientError({ message: null, stack: undefined, url: '', userAgent: 42 }), false);
  assert.equal(isBenignClientError(), false);
});
