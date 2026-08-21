'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { redactText, redactUrl } = require('./redact.cjs');

// --- redactText --------------------------------------------------------------

test('redacts an email address embedded in a message', () => {
  assert.equal(
    redactText('Failed to load profile for jane.doe+test@example.org'),
    'Failed to load profile for [redacted-email]',
  );
});

test('redacts multiple emails', () => {
  assert.equal(
    redactText('a@example.com wrote to b@example.org'),
    '[redacted-email] wrote to [redacted-email]',
  );
});

test('redacts a Bearer token', () => {
  assert.equal(
    redactText('request failed: Authorization: Bearer abc123.def-456_GHI'),
    'request failed: Authorization: Bearer [redacted-token]',
  );
});

test('redacts a JWT-shaped string even without a Bearer prefix', () => {
  // Two rules chain here: JWT_RE redacts the token value first, then the
  // (now-boundary-relaxed) credential-param rule redacts the whole
  // "token=..." pair — still safe, just the more generic placeholder wins.
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM';
  assert.equal(redactText(`token=${jwt} in body`), 'token=[redacted] in body');
});

test('redacts credential-shaped query params appearing in plain text', () => {
  assert.equal(
    redactText('GET /api/x?token=abc123&foo=bar'),
    'GET /api/x?token=[redacted]&foo=bar',
  );
  assert.equal(
    redactText('...&apiKey=secret-value&other=1'),
    '...&apiKey=[redacted]&other=1',
  );
});

// Codex review finding (P1): the original regex required a leading `?`/`&`
// before the param name, so free text with no query-string delimiter at all
// (a plain "key: value" style message, or a param at the very start of the
// string) passed through unredacted.
test('redacts a credential param with no leading ?/& — free text, not a query string', () => {
  assert.equal(redactText('request failed: token=abc123'), 'request failed: token=[redacted]');
  assert.equal(redactText('token=abc123 in body'), 'token=[redacted] in body');
});

test('redacts a credential param at the very start of the string', () => {
  assert.equal(redactText('auth=secret123'), 'auth=[redacted]');
});

// The other direction of the same fix: loosening the boundary must not
// start matching PART of an unrelated identifier — "authorization" is not
// "auth", "mytoken" is not "token", "zipcode" is not "code".
test('does not redact an identifier that merely contains a credential param name as a substring', () => {
  assert.equal(redactText('authorization=abcdef'), 'authorization=abcdef');
  assert.equal(redactText('mytoken=abcdef'), 'mytoken=abcdef');
  assert.equal(redactText('monkey=1'), 'monkey=1');
  assert.equal(redactText('zipcode=90210'), 'zipcode=90210');
});

test('leaves ordinary text untouched', () => {
  const message = 'Cannot read properties of undefined (reading "map")';
  assert.equal(redactText(message), message);
});

test('non-string input passes through unchanged', () => {
  assert.equal(redactText(null), null);
  assert.equal(redactText(undefined), undefined);
  assert.equal(redactText(42), 42);
});

// --- redactUrl -----------------------------------------------------------------

test('redacts a credential query param on an absolute URL, keeps the rest', () => {
  const out = redactUrl('https://example.org/reset?token=abcd1234&lang=en');
  const parsed = new URL(out);
  assert.equal(parsed.searchParams.get('token'), '[redacted]');
  assert.equal(parsed.searchParams.get('lang'), 'en');
  assert.equal(parsed.origin + parsed.pathname, 'https://example.org/reset');
});

test('redacts multiple credential-shaped params on an absolute URL', () => {
  const out = redactUrl('https://example.org/x?access_token=t1&session=s1&keep=me');
  const parsed = new URL(out);
  assert.equal(parsed.searchParams.get('access_token'), '[redacted]');
  assert.equal(parsed.searchParams.get('session'), '[redacted]');
  assert.equal(parsed.searchParams.get('keep'), 'me');
});

test('falls back to text-level scrub for a relative or malformed URL', () => {
  assert.equal(redactUrl('/reset?token=abcd1234&lang=en'), '/reset?token=[redacted]&lang=en');
});

test('a URL with no credential params is unchanged', () => {
  const url = 'https://example.org/schedule?day=1';
  assert.equal(redactUrl(url), url);
});
