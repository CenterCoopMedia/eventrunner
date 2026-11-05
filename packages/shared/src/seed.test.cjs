'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SEED_ACTOR, isSeedOwned, isStarterContent, publicContentDoc } = require('./seed.cjs');

test('a flagged document written by the seed, or by nobody recorded, is the seed’s', () => {
  assert.equal(isSeedOwned({ seeded: true }), true);
  assert.equal(isSeedOwned({ seeded: true, publishedBy: SEED_ACTOR.uid }), true);
  assert.equal(isSeedOwned({ seeded: true, updatedBy: SEED_ACTOR.email, status: 'clean' }), true);
});

test('a document any other actor wrote is the client’s, whatever its flag says', () => {
  // The write path once carried `seeded: true` through an edit (adversarial
  // review, 2026-09-24); a deployment from then still holds such documents.
  assert.equal(isSeedOwned({ seeded: true, publishedBy: 'admin-uid' }), false);
  assert.equal(isSeedOwned({ seeded: true, updatedBy: 'editor@example.org' }), false);
  assert.equal(isSeedOwned({ seeded: false }), false);
  assert.equal(isSeedOwned({ value: 'Client copy' }), false);
  assert.equal(isSeedOwned(null), false);
});

test('the public copy states ownership by that rule and drops the writer bookkeeping', () => {
  const seed = publicContentDoc({ id: 'a', value: 'x', seeded: true, publishedBy: SEED_ACTOR.uid });
  assert.deepEqual(seed, { id: 'a', value: 'x', seeded: true });
  const edited = publicContentDoc({ id: 'a', value: 'y', seeded: true, publishedBy: 'admin-uid', updatedBy: 'e@x.org' });
  assert.deepEqual(edited, { id: 'a', value: 'y' });
  const plain = publicContentDoc({ id: 'a', value: 'z' });
  assert.deepEqual(plain, { id: 'a', value: 'z' });
});

test('a block still holding starter text is starter content; a filled one is not', () => {
  assert.equal(isStarterContent({ blockType: 'text', value: '[Replace] Venue name.' }), true);
  assert.equal(isStarterContent({ blockType: 'richtext', value: '<p>[Replace] What happens.</p>' }), true);
  assert.equal(isStarterContent({ blockType: 'stat', value: '0', label: 'attendees expected', seeded: true }), true);
  assert.equal(isStarterContent({ blockType: 'stat', value: '0', label: 'tickets left' }), false);
  assert.equal(isStarterContent({ blockType: 'text', value: 'The Grand Hall' }), false);
  assert.equal(isStarterContent({ blockType: 'text', value: 'Hall', section: '[Replace]' }), false);
  assert.equal(isStarterContent(null), false);
});
