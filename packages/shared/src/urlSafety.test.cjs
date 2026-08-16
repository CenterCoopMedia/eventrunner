'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isSafeUrl, looksLikeUrl, scrubLinkLabel } = require('./urlSafety.cjs');

test('isSafeUrl: http/https allowlist', () => {
  assert.equal(isSafeUrl('https://docs.example.org/deck'), true);
  assert.equal(isSafeUrl('http://example.org'), true);
  assert.equal(isSafeUrl('javascript:alert(1)'), false);
  assert.equal(isSafeUrl('data:text/html,x'), false);
  assert.equal(isSafeUrl('mailto:user@example.org'), false);
  assert.equal(isSafeUrl('not a url'), false);
  assert.equal(isSafeUrl(''), false);
});

test('looksLikeUrl edge cases (ported regex behavior)', () => {
  assert.equal(looksLikeUrl('https://docs.example.org/deck'), true);
  assert.equal(looksLikeUrl('HTTP://EXAMPLE.ORG'), true);
  assert.equal(looksLikeUrl('ftp://files.example.org'), true);   // any scheme-relative ://
  assert.equal(looksLikeUrl('docs.example.org/abc'), true);      // bare domain.tld/path
  assert.equal(looksLikeUrl('example.org'), true);               // bare domain, no path
  assert.equal(looksLikeUrl('Session slides'), false);           // plain words
  assert.equal(looksLikeUrl('Q&A notes from day 1'), false);
  assert.equal(looksLikeUrl(''), false);
  assert.equal(looksLikeUrl('   '), false);
  assert.equal(looksLikeUrl(null), false);
  // "slides.pdf" matches the bare-domain shape ("pdf" reads as a TLD), so
  // the ported regex returns TRUE for it. That is fine by design: file
  // materials are never passed through the scrub (spec §4.4) — their
  // filename is a display label, not a secret — so this over-match only
  // ever affects link labels.
  assert.equal(looksLikeUrl('slides.pdf'), true);
});

// The three PR #438 pinning cases (spec §4.4): the embargo invariant that a
// link material's public display name can never be its URL.
test('scrubLinkLabel: URL-shaped label becomes "External link"', () => {
  assert.equal(scrubLinkLabel('https://docs.example.org/secret-deck'), 'External link');
  assert.equal(scrubLinkLabel('docs.example.org/secret-deck'), 'External link');
});

test('scrubLinkLabel: empty label becomes "External link"', () => {
  assert.equal(scrubLinkLabel(''), 'External link');
  assert.equal(scrubLinkLabel('   '), 'External link');
  assert.equal(scrubLinkLabel(undefined), 'External link');
});

test('scrubLinkLabel: real label preserved (trimmed)', () => {
  assert.equal(scrubLinkLabel('Workshop slides'), 'Workshop slides');
  assert.equal(scrubLinkLabel('  Workshop slides  '), 'Workshop slides');
});
