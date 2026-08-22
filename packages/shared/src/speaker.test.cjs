'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ADMIN_SETTABLE_STATUSES,
  PUBLIC_SPEAKER_FIELDS,
  SELF_EDITABLE_SPEAKER_FIELDS,
  speakerDisplayName,
  isPubliclyVisibleSpeaker,
  buildPublicSpeaker,
  validateSpeaker,
} = require('./speaker.cjs');

const CANONICAL = Object.freeze({
  firstName: 'Rae',
  lastName: 'Okonkwo',
  slug: 'rae-okonkwo',
  email: 'rae@example.org',
  bio: 'Community reporter.',
  headshotPath: 'speakers/rae.jpg',
  organization: '[Demo] Cooperative',
  jobTitle: 'Editor',
  socialHandles: { web: 'https://example.org' },
  status: 'approved',
  uid: 'u1',
  inviteToken: 'tok_secret',
  approvedAt: new Date('2026-01-01T00:00:00Z'),
  updatedBy: 'admin@example.org',
});

test('speakerDisplayName joins the two name halves and never throws', () => {
  assert.equal(speakerDisplayName(CANONICAL), 'Rae Okonkwo');
  assert.equal(speakerDisplayName({ firstName: ' Rae ' }), 'Rae');
  assert.equal(speakerDisplayName(null), '');
  assert.equal(speakerDisplayName({ firstName: 42 }), '');
});

test('the projection carries only public-safe fields', () => {
  const projected = buildPublicSpeaker(CANONICAL);
  assert.deepEqual(Object.keys(projected).sort(), [...PUBLIC_SPEAKER_FIELDS].sort());
  for (const secret of ['email', 'uid', 'inviteToken', 'status', 'approvedAt', 'updatedBy']) {
    assert.equal(secret in projected, false, `${secret} must never reach speakers_public`);
  }
  assert.equal(projected.displayName, 'Rae Okonkwo');
});

test('the projection is total over a malformed stored document', () => {
  const projected = buildPublicSpeaker({
    firstName: { nope: true },
    bio: ['array'],
    headshotPath: 7,
    socialHandles: { good: 'x', bad: { nested: true } },
  });
  assert.equal(projected.firstName, '');
  assert.equal(projected.bio, '');
  assert.equal(projected.headshotPath, null);
  assert.deepEqual(projected.socialHandles, { good: 'x' });
  assert.deepEqual(buildPublicSpeaker(null).socialHandles, {});
});

test('a missing slug is derived rather than published empty', () => {
  assert.equal(buildPublicSpeaker({ firstName: 'Sam', lastName: 'Example' }).slug, 'sam-example');
});

test('only approved speakers are publicly visible', () => {
  for (const status of ['draft', 'invited', 'accepted', 'removed', '', undefined]) {
    assert.equal(isPubliclyVisibleSpeaker({ status }), false, `${status} must not publish`);
  }
  assert.equal(isPubliclyVisibleSpeaker({ status: 'approved' }), true);
});

test('create requires both name halves and derives the slug', () => {
  const missing = validateSpeaker({ bio: 'x' });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.errors, ['firstName: required', 'lastName: required']);

  const created = validateSpeaker({ firstName: ' Rae ', lastName: 'Okonkwo' });
  assert.equal(created.ok, true);
  assert.equal(created.fields.slug, 'rae-okonkwo');
  assert.equal(created.fields.firstName, 'Rae');
});

test('a partial update checks only the keys present', () => {
  const updated = validateSpeaker({ bio: 'New bio.' }, { partial: true });
  assert.equal(updated.ok, true);
  assert.deepEqual(updated.fields, { bio: 'New bio.' });
  assert.equal('slug' in updated.fields, false);
});

test('server-owned fields are rejected by name', () => {
  const verdict = validateSpeaker(
    { firstName: 'Rae', lastName: 'Okonkwo', uid: 'u1', inviteToken: 't', approvedAt: 1 },
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.errors.length, 3);
  assert.match(verdict.errors[0], /^uid: read-only/);
  assert.match(verdict.errors[0], /invite\/acceptance transaction and deleteSpeaker/);
  assert.match(verdict.errors[1], /^inviteToken: read-only/);
  assert.match(verdict.errors[2], /^approvedAt: read-only/);
});

test('unknown fields are rejected by name', () => {
  const verdict = validateSpeaker({ firstName: 'A', lastName: 'B', sessionInfo: {} });
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.errors, ['sessionInfo: unknown speaker field']);
});

test('invited and accepted are not admin-settable statuses', () => {
  assert.deepEqual([...ADMIN_SETTABLE_STATUSES], ['draft', 'approved', 'removed']);
  for (const status of ['invited', 'accepted', 'nonsense']) {
    const verdict = validateSpeaker({ status }, { partial: true });
    assert.equal(verdict.ok, false);
    assert.match(verdict.errors[0], /^status: must be one of draft, approved, removed$/);
  }
});

test('field shapes are validated with messages that name the field', () => {
  const cases = [
    [{ slug: 'Not A Slug' }, /^slug: /],
    [{ email: 'nope' }, /^email: /],
    [{ bio: 42 }, /^bio: /],
    [{ organization: 'x'.repeat(300) }, /^organization: /],
    [{ headshotPath: 3 }, /^headshotPath: /],
    [{ socialHandles: [] }, /^socialHandles: /],
    [{ socialHandles: { a: 1 } }, /^socialHandles: /],
    [{ firstName: '   ' }, /^firstName: /],
  ];
  for (const [payload, pattern] of cases) {
    const verdict = validateSpeaker(payload, { partial: true });
    assert.equal(verdict.ok, false, `${JSON.stringify(payload)} should fail`);
    assert.match(verdict.errors[0], pattern);
  }
});

test('an explicitly cleared slug is re-derived from the names in the same payload', () => {
  const verdict = validateSpeaker({ firstName: 'Sam', lastName: 'Example', slug: '' });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.fields.slug, 'sam-example');
});

test('null clears the optional scalars rather than storing a string', () => {
  const verdict = validateSpeaker({ email: null, headshotPath: null }, { partial: true });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.fields, { email: null, headshotPath: null });
});

test('a non-object payload is refused', () => {
  assert.deepEqual(validateSpeaker(null).errors, ['speaker: must be an object']);
  assert.deepEqual(validateSpeaker([]).errors, ['speaker: must be an object']);
});

// --- fieldsAllowed (self-service narrowing, issue #22) ----------------------

test('fieldsAllowed accepts a field on the allowed list', () => {
  const verdict = validateSpeaker(
    { bio: 'New bio.' },
    { partial: true, fieldsAllowed: SELF_EDITABLE_SPEAKER_FIELDS },
  );
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.fields, { bio: 'New bio.' });
});

test('fieldsAllowed rejects an otherwise-editable field with "not editable here"', () => {
  for (const payload of [{ slug: 'x' }, { email: 'a@example.org' }, { status: 'approved' }]) {
    const verdict = validateSpeaker(payload, { partial: true, fieldsAllowed: SELF_EDITABLE_SPEAKER_FIELDS });
    assert.equal(verdict.ok, false);
    assert.match(verdict.errors[0], /not editable here/);
  }
});

test('fieldsAllowed still rejects a genuinely unknown field, and server-owned fields the same as always', () => {
  const unknown = validateSpeaker({ sessionInfo: {} }, { partial: true, fieldsAllowed: SELF_EDITABLE_SPEAKER_FIELDS });
  assert.match(unknown.errors[0], /unknown speaker field/);

  const serverOwned = validateSpeaker({ approvedAt: 1 }, { partial: true, fieldsAllowed: SELF_EDITABLE_SPEAKER_FIELDS });
  assert.match(serverOwned.errors[0], /read-only — server-owned/);
});
