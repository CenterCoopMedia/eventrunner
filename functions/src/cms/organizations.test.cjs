'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ORGANIZATION_LIMITS,
  ORGANIZATION_SLUG_RE,
  organizationSlugError,
  slugTakenMessage,
  validateOrganizationFields,
} = require('./organizations.cjs');

const VALID = Object.freeze({
  name: 'Example Fund',
  tier: 'presenting',
  order: 2,
  logoPath: 'cms-images/example-fund.webp',
  url: 'https://example.org/fund',
  description: 'Funds the travel grants.',
});

function refused(fields, sent = fields) {
  const verdict = validateOrganizationFields(fields, sent);
  assert.equal(verdict.ok, false, `expected a refusal for ${JSON.stringify(fields)}`);
  return verdict.errors;
}

function accepted(fields, sent = fields) {
  const verdict = validateOrganizationFields(fields, sent);
  assert.equal(verdict.ok, true, JSON.stringify(verdict.errors));
  return verdict.fields;
}

test('a complete organization passes with every field kept', () => {
  assert.deepEqual(accepted({ ...VALID }), { ...VALID });
});

test('the name is required text, trimmed, and at most 120 characters', () => {
  assert.deepEqual(refused({ ...VALID, name: 42 }), ['name: must be text']);
  assert.deepEqual(refused({ ...VALID, name: { first: 'x' } }), ['name: must be text']);
  assert.deepEqual(refused({ ...VALID, name: '   ' }), ["name: enter the organization's name"]);
  assert.deepEqual(refused({ ...VALID, name: null }), ["name: enter the organization's name"]);
  const { name, ...withoutName } = VALID;
  assert.equal(name, VALID.name);
  assert.deepEqual(refused(withoutName), ["name: enter the organization's name"]);
  assert.equal(accepted({ ...VALID, name: '  Example Fund  ' }).name, 'Example Fund');
  assert.equal(accepted({ ...VALID, name: 'n'.repeat(120) }).name.length, 120);
  assert.deepEqual(refused({ ...VALID, name: 'n'.repeat(121) }), ['name: use 120 characters or fewer']);
});

test('the tier and the description are optional text, trimmed, blank as null', () => {
  assert.deepEqual(refused({ ...VALID, tier: { level: 1 } }), ['tier: must be text']);
  assert.deepEqual(refused({ ...VALID, description: ['a'] }), ['description: must be text']);
  assert.equal(accepted({ ...VALID, tier: '  gold ' }).tier, 'gold');
  assert.equal(accepted({ ...VALID, tier: '   ' }).tier, null);
  assert.equal(accepted({ ...VALID, tier: null }).tier, null);
  assert.equal(accepted({ ...VALID, description: '' }).description, null);
  assert.equal(accepted({ ...VALID, tier: 't'.repeat(60) }).tier.length, 60);
  assert.deepEqual(refused({ ...VALID, tier: 't'.repeat(61) }), ['tier: use 60 characters or fewer']);
  assert.deepEqual(
    refused({ ...VALID, description: 'd'.repeat(501) }),
    ['description: use 500 characters or fewer'],
  );
  // Absent stays absent: nothing is invented for a key the record never had.
  const { tier, description, ...bare } = VALID;
  assert.equal(tier, VALID.tier);
  assert.equal(description, VALID.description);
  const kept = accepted(bare);
  assert.equal('tier' in kept, false);
  assert.equal('description' in kept, false);
});

test('the order is a finite number or null, never a numeric string', () => {
  assert.deepEqual(refused({ ...VALID, order: '3' }), ['order: must be a number']);
  assert.deepEqual(refused({ ...VALID, order: Number.NaN }), ['order: must be a number']);
  assert.deepEqual(refused({ ...VALID, order: Number.POSITIVE_INFINITY }), ['order: must be a number']);
  assert.equal(accepted({ ...VALID, order: null }).order, null);
  assert.equal(accepted({ ...VALID, order: -1.5 }).order, -1.5);
});

test('the website must be an absolute http(s) link and is stored canonical', () => {
  for (const bad of ['javascript:alert(1)', 'example.org', '//example.org', 'https:example.org', 'mailto:a@example.org', 7]) {
    assert.deepEqual(refused({ ...VALID, url: bad }), ['url: must start with http:// or https://'], String(bad));
  }
  assert.equal(accepted({ ...VALID, url: '  HTTPS://Example.ORG ' }).url, 'https://example.org/');
  assert.equal(accepted({ ...VALID, url: '' }).url, null);
  assert.equal(accepted({ ...VALID, url: null }).url, null);
  assert.deepEqual(
    refused({ ...VALID, url: `https://example.org/${'a'.repeat(ORGANIZATION_LIMITS.url)}` }),
    ['url: use 2000 characters or fewer'],
  );
});

test('the logo is a Storage object path, refused the way the page refuses it', () => {
  for (const bad of ['https://x/a.png', '/a.png', 'a/../b.png', 'data:image/png;base64,AAAA', 3]) {
    assert.deepEqual(
      refused({ ...VALID, logoPath: bad }),
      ['logoPath: choose an image from the media library'],
      String(bad),
    );
  }
  assert.equal(accepted({ ...VALID, logoPath: ' cms-images/a.png ' }).logoPath, 'cms-images/a.png');
  assert.equal(accepted({ ...VALID, logoPath: '' }).logoPath, null);
  assert.deepEqual(
    refused({ ...VALID, logoPath: `cms-images/${'a'.repeat(300)}.png` }),
    ['logoPath: use 300 characters or fewer'],
  );
});

test('a profile field is checked when the request sends it, and left alone when it does not', () => {
  const stored = { ...VALID, bio: {}, supportDescription: 9, readMorePath: ['x'] };
  // An editor save sends only the six fields it shows: the malformed values
  // a script stored do not block it.
  assert.equal(validateOrganizationFields(stored, { name: 'Example Fund' }).ok, true);
  // A request that sends one is judged on it.
  assert.deepEqual(
    validateOrganizationFields({ ...VALID, bio: {} }, { bio: {} }).errors,
    ['bio: must be text'],
  );
  assert.deepEqual(
    validateOrganizationFields({ ...VALID, bio: 'b'.repeat(5001) }, { bio: 'b'.repeat(5001) }).errors,
    ['bio: use 5000 characters or fewer'],
  );
  assert.deepEqual(
    validateOrganizationFields(
      { ...VALID, supportDescription: 's'.repeat(2001) },
      { supportDescription: 's'.repeat(2001) },
    ).errors,
    ['supportDescription: use 2000 characters or fewer'],
  );
  assert.deepEqual(
    validateOrganizationFields({ ...VALID, readMorePath: 7 }, { readMorePath: 7 }).errors,
    ['readMorePath: must be text'],
  );
  const kept = validateOrganizationFields({ ...VALID, bio: '  First.\n\nSecond.  ' }, { bio: 'x' });
  assert.equal(kept.fields.bio, 'First.\n\nSecond.');
});

test('every error is named, and all of them come back together', () => {
  const errors = refused({ name: 42, order: '1', url: 'ftp://x', logoPath: '/x.png' });
  assert.deepEqual(errors, [
    'name: must be text',
    'order: must be a number',
    'logoPath: choose an image from the media library',
    'url: must start with http:// or https://',
  ]);
});

test('unknown keys pass through, as the generic endpoint always allowed', () => {
  const fields = accepted({ ...VALID, partnerSince: 2019, notes: { any: 'shape' } });
  assert.equal(fields.partnerSince, 2019);
  assert.deepEqual(fields.notes, { any: 'shape' });
});

test('the slug shape is the speaker slug shape, and the limit is 80', () => {
  assert.equal(ORGANIZATION_SLUG_RE.test('example-fund'), true);
  assert.equal(ORGANIZATION_SLUG_RE.test('fund-2'), true);
  for (const bad of ['Example', 'a--b', '-a', 'a-', 'a_b', 'a b', '_new', '']) {
    assert.equal(ORGANIZATION_SLUG_RE.test(bad), false, bad);
  }
  assert.equal(ORGANIZATION_LIMITS.slug, 80);
});

test('a page address is refused unless it is slug-shaped and at most 80 characters (issue 193)', () => {
  const message = 'slug: use lowercase letters, digits, and single hyphens, up to 80 characters';
  assert.equal(organizationSlugError('example-fund'), null);
  assert.equal(organizationSlugError('a'.repeat(80)), null);
  assert.equal(organizationSlugError('a'.repeat(81)), message);
  for (const bad of ['Bad Slug', 'UPPER', 'a--b', '-a', 'a-', '_new', '', null, 42]) {
    assert.equal(organizationSlugError(bad), message, String(bad));
  }
  assert.equal(slugTakenMessage('example-fund'), 'slug: another organization already uses "example-fund"');
});

// Review round (c2, finding 7): the admin guide and the changelog say what
// the logo check is. It checks the path's shape only: a path inside the
// site's own files passes whether or not a file is there.
test('the logo check is the path shape only, never a file lookup', () => {
  for (const path of ['cms-images/missing.png', 'users/abc/photo.jpg', 'branding/logo.svg']) {
    assert.equal(accepted({ ...VALID, logoPath: path }).logoPath, path);
  }
  for (const path of ['https://example.org/logo.png', '/cms-images/a.png', 'cms-images/../a.png']) {
    assert.deepEqual(refused({ ...VALID, logoPath: path }), ['logoPath: choose an image from the media library']);
  }
});
