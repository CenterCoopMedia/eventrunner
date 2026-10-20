'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EMAIL_ADDRESS_RE, isEmailAddress } = require('./email.cjs');

// The spelling every validator used before this module. It accepts the right
// strings but backtracks over every dot in a domain that fails to match.
const PREVIOUS_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

test('isEmailAddress accepts the usual address shapes', () => {
  for (const value of ['ada@example.org', 'a.b+tag@mail.example.co', 'x@y.z', '.@..a', 'a@b..c']) {
    assert.equal(isEmailAddress(value), true, value);
  }
});

test('isEmailAddress refuses the shapes the form checks refuse', () => {
  for (const value of ['', 'ada', 'ada@', '@example.org', 'ada@example', 'ada@.org', 'ada@example.', 'a b@example.org', 'ada@exa mple.org', 'a@b@example.org', ' ada@example.org', 'ada@example.org\n', null, undefined, 42]) {
    assert.equal(isEmailAddress(value), false, String(value));
  }
});

test('the linear spelling accepts exactly what the previous spelling accepted', () => {
  // Every string up to length 7 over the characters that decide a match.
  const alphabet = ['a', '.', '@', ' '];
  let checked = 0;
  const visit = (prefix) => {
    assert.equal(EMAIL_ADDRESS_RE.test(prefix), PREVIOUS_EMAIL_RE.test(prefix), JSON.stringify(prefix));
    checked += 1;
    if (prefix.length === 7) return;
    for (const char of alphabet) visit(prefix + char);
  };
  visit('');
  assert.ok(checked > 20000);
});

test('a long hostile value is refused in linear time', () => {
  // The previous spelling took seconds on this input: every dot in the
  // domain was tried against every later position before the final space
  // made the match fail. At this size it would take over 30 s, so a 500 ms
  // ceiling leaves room for a slow CI worker and still catches the old cost.
  for (const value of [
    `!@!.${'!.'.repeat(100000)} `,
    `a@${'.'.repeat(200000)} `,
    `${'a'.repeat(200000)}@`,
    `a@b${'.a'.repeat(100000)}@`,
  ]) {
    const started = performance.now();
    assert.equal(isEmailAddress(value), false);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 500,`${value.length} characters took ${elapsed.toFixed(1)} ms`);
  }
});

test('isBareEmailAddress takes one plain address and nothing that could name another or add a header', () => {
  const { isBareEmailAddress } = require('./email.cjs');
  for (const value of ['ada@example.org', 'a.b+tag@mail.example.co']) {
    assert.equal(isBareEmailAddress(value), true, value);
  }
  for (const value of ['Ada <ada@example.org>', 'a<b@example.org', 'ada@example.org>', '"a"@example.org', 'a(b)@example.org',
    'a;b@example.org', 'a:b@example.org', 'a\\b@example.org', 'a,b@example.org', 'ada@example.org\r\nBcc: x@example.org', 'ada@example', 42]) {
    assert.equal(isBareEmailAddress(value), false, String(value));
  }
});
