'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isSafeUrl, safeUrlHref, looksLikeUrl, scrubLinkLabel } = require('./urlSafety.cjs');

test('isSafeUrl: http/https allowlist', () => {
  assert.equal(isSafeUrl('https://docs.example.org/deck'), true);
  assert.equal(isSafeUrl('http://example.org'), true);
  assert.equal(isSafeUrl('javascript:alert(1)'), false);
  assert.equal(isSafeUrl('data:text/html,x'), false);
  assert.equal(isSafeUrl('mailto:user@example.org'), false);
  assert.equal(isSafeUrl('not a url'), false);
  assert.equal(isSafeUrl(''), false);
});

test('isSafeUrl: a scheme without its slashes is not an absolute link', () => {
  // `new URL('https:docs.example.org/deck')` PARSES, with protocol
  // 'https:' — the WHATWG parser reads a special scheme with no `//` as a
  // relative reference. Rendered in an href it resolves against the page it
  // sits on, so the reader stays on the event's own domain instead of
  // reaching the site the operator typed.
  assert.equal(isSafeUrl('https:docs.example.org/deck'), false);
  assert.equal(isSafeUrl('http:example.org'), false);
  assert.equal(isSafeUrl('https:/docs.example.org'), false);
  assert.equal(isSafeUrl('HTTPS:docs.example.org'), false);
  // Protocol-relative: no scheme at all, so it inherits the page's.
  assert.equal(isSafeUrl('//evil.example.org/deck'), false);
  // Relative paths, for the same reason.
  assert.equal(isSafeUrl('/schedule/session-1'), false);
  assert.equal(isSafeUrl('docs.example.org/deck'), false);
});

test('isSafeUrl: case and surrounding space do not change the verdict', () => {
  assert.equal(isSafeUrl('HTTPS://DOCS.EXAMPLE.ORG/deck'), true);
  assert.equal(isSafeUrl('  https://docs.example.org/deck  '), true);
  assert.equal(isSafeUrl(null), false);
  assert.equal(isSafeUrl(undefined), false);
  assert.equal(isSafeUrl(42), false);
});

test('safeUrlHref returns the canonical href, so the checked string is the stored one', () => {
  // The host lower-cases and the parser fills in what it normalizes; a
  // caller that stores this value can never store something that resolves
  // differently from what was approved.
  assert.equal(
    safeUrlHref('HTTPS://Video.Example.ORG/watch?v=abc'),
    'https://video.example.org/watch?v=abc',
  );
  assert.equal(safeUrlHref('https://video.example.org'), 'https://video.example.org/');
  assert.equal(safeUrlHref('  https://video.example.org/a b  '), 'https://video.example.org/a%20b');
  // The rejections all come back as the empty string, never as a partial
  // value a caller might store by mistake.
  for (const bad of ['https:video.example.org', '//evil.example.org', 'javascript:alert(1)', '', null]) {
    assert.equal(safeUrlHref(bad), '', `accepted ${JSON.stringify(bad)}`);
  }
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
