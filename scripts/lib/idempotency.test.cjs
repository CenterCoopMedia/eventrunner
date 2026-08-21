'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { decideSeedWrite, decideConfigWrite, mergeAdminEmails, mergeConfigDoc } = require('./idempotency.cjs');

test('an absent doc is created', () => {
  assert.equal(decideSeedWrite(null).action, 'create');
  assert.equal(decideSeedWrite(undefined).action, 'create');
});

test('a still-seeded doc is refreshed', () => {
  assert.equal(decideSeedWrite({ seeded: true, value: '[Replace] x' }).action, 'overwrite');
});

test('a client-edited doc is never overwritten — not even under --force', () => {
  const edited = { seeded: false, value: 'Our real copy' };
  assert.equal(decideSeedWrite(edited).action, 'skip');
  assert.equal(decideSeedWrite(edited, { force: true }).action, 'skip');
  // A doc that never carried the flag at all (client-authored) is the same case.
  assert.equal(decideSeedWrite({ value: 'Client page' }, { force: true }).action, 'skip');
});

test('config docs are left alone on re-run unless --force is passed', () => {
  const existing = { name: 'Client edited' };
  const next = { name: 'Seeded' };
  assert.equal(decideConfigWrite({ docId: 'event', existing, next }).action, 'skip');
  assert.equal(decideConfigWrite({ docId: 'event', existing, next, force: true }).action, 'overwrite');
});

test('a --force refresh never takes back what another writer owns', () => {
  const existing = {
    name: 'Client edited',
    sender: { email: 'a@example.org', domainVerified: true, domainVerifiedAt: '2027-01-01' },
    legal: { reviewRequired: false },
    announcedAt: '2027-02-01T00:00:00',
    archivedAt: null,
    auth: { googleProviderEnabled: true, authorizedDomainsConfigured: true },
  };
  const next = {
    name: 'Seeded',
    sender: { email: 'a@example.org', domainVerified: false, domainVerifiedAt: null },
    legal: { reviewRequired: true },
    announcedAt: null,
    archivedAt: null,
    auth: { googleProviderEnabled: false, authorizedDomainsConfigured: false },
  };
  const { value } = decideConfigWrite({ docId: 'event', existing, next, force: true });
  assert.equal(value.name, 'Seeded', 'seeded fields do refresh');
  assert.equal(value.sender.domainVerified, true, 'verify-sender-domain.cjs owns this');
  assert.equal(value.legal.reviewRequired, false, 'admin Settings owns this');
  assert.equal(value.announcedAt, '2027-02-01T00:00:00', 'the lifecycle stamp is editorial');
  assert.equal(value.auth.googleProviderEnabled, true, 'the operator attestation stands');
});

test('mergeConfigDoc does not mutate its inputs', () => {
  const existing = { legal: { reviewRequired: false } };
  const next = { legal: { reviewRequired: true }, name: 'x' };
  mergeConfigDoc(existing, next);
  assert.equal(next.legal.reviewRequired, true);
});

test('admin emails are additive, lowercased, and de-duplicated', () => {
  const merged = mergeAdminEmails(
    { adminEmails: ['granted-in-ui@example.org'] },
    { adminEmails: ['Ops@Example.org', 'granted-in-ui@example.org'] },
  );
  assert.deepEqual(merged.adminEmails, ['granted-in-ui@example.org', 'ops@example.org']);
});

test('a mis-normalized stored admin list is rewritten, not skipped on a matching count', () => {
  // firestore.rules compares against request.auth.token.email.lower(), so a
  // stored "Ops@Example.org" is an admin who can never authenticate. A
  // length-only comparison would call that list unchanged and leave it.
  const decision = decideConfigWrite({
    docId: 'bootstrap',
    existing: { adminEmails: ['Ops@Example.org'] },
    next: { adminEmails: ['ops@example.org'] },
  });
  assert.equal(decision.action, 'overwrite');
  assert.deepEqual(decision.value.adminEmails, ['ops@example.org']);
});

test('an unpublished editor draft protects a document whose live copy still looks seeded', () => {
  const liveSeeded = { seeded: true, value: '[Replace] x' };
  const editorDraft = { seeded: false, status: 'dirty', value: 'Unpublished rewrite' };
  assert.equal(decideSeedWrite(liveSeeded, { draft: editorDraft }).action, 'skip');
  assert.equal(decideSeedWrite(liveSeeded, { draft: editorDraft, force: true }).action, 'skip');
  // A draft that is still the seeded one is not an edit.
  assert.equal(decideSeedWrite(liveSeeded, { draft: { seeded: true } }).action, 'overwrite');
  // A draft-only document (never published) is protected the same way.
  assert.equal(decideSeedWrite(null, { draft: editorDraft }).action, 'skip');
  assert.equal(decideSeedWrite(null, { draft: null }).action, 'create');
});

test('bootstrap re-runs report skip when the admin list is unchanged', () => {
  const existing = { adminEmails: ['ops@example.org'] };
  const same = decideConfigWrite({ docId: 'bootstrap', existing, next: { adminEmails: ['ops@example.org'] } });
  assert.equal(same.action, 'skip');
  const added = decideConfigWrite({ docId: 'bootstrap', existing, next: { adminEmails: ['new@example.org'] } });
  assert.equal(added.action, 'overwrite');
  assert.deepEqual(added.value.adminEmails, ['ops@example.org', 'new@example.org']);
});
