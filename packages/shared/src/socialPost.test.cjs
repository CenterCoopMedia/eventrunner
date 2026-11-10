'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readSocialPost, socialTextLength, socialRequestBytes } = require('./socialPost.cjs');

// Oracles: #510 specifies trimmed nonblank plain text, 2,000 UTF-16 code
// units, an 8 KiB JSON body, bounded IDs and the pitch submission alphabet.
const root = { text: '  Lunch at noon.\n', submissionKey: 'intent_1' };

test('normalizes only outer whitespace and an omitted root parent', () => {
  assert.deepEqual(readSocialPost(root), {
    ok: true, text: 'Lunch at noon.', parentPostId: null, submissionKey: 'intent_1',
  });
  assert.equal(readSocialPost({ ...root, text: '<b>Plain</b>\n  text' }).text, '<b>Plain</b>\n  text');
});

test('counts emoji as two UTF-16 units and refuses text beyond 2,000 units', () => {
  assert.equal(socialTextLength('  😀\n'), 2);
  for (const text of ['a'.repeat(2000), '😀'.repeat(1000)]) {
    assert.equal(readSocialPost({ ...root, text }).ok, true);
  }
  for (const text of ['', ' \n\t', 'a'.repeat(2001), '😀'.repeat(1000) + 'a', 2, null]) {
    assert.equal(readSocialPost({ ...root, text }).ok, false);
  }
});

test('refuses forged server fields and every unknown field', () => {
  for (const field of ['authorUid', 'uid', 'state', 'createdAt', 'removedAt', 'extra']) {
    assert.equal(readSocialPost({ ...root, [field]: 'forged' }).ok, false, field);
  }
  for (const body of [null, [], 'post']) assert.equal(readSocialPost(body).ok, false);
});

test('bounds keys and parent IDs before any database access', () => {
  for (const submissionKey of ['x'.repeat(8), 'x'.repeat(128), 'intent_-2']) {
    assert.equal(readSocialPost({ ...root, submissionKey }).ok, true);
  }
  for (const submissionKey of [undefined, 4, 'x'.repeat(7), 'x'.repeat(129), 'bad key!', 'bad/key!']) {
    assert.equal(readSocialPost({ ...root, submissionKey }).ok, false);
  }
  for (const parentPostId of [null, 'root-1', 'x'.repeat(128)]) {
    assert.equal(readSocialPost({ ...root, parentPostId }).ok, true);
  }
  for (const parentPostId of ['', '/', '.', '..', 'x'.repeat(129), 1, [], {}]) {
    assert.equal(readSocialPost({ ...root, parentPostId }).ok, false);
  }
});

test('JSON bytes count encoding and escaping rather than text characters', () => {
  // Quotes and control characters expand in JSON; emoji is four UTF-8 bytes.
  assert.equal(socialRequestBytes({ text: '😀\n' }), 17);
  const circular = {};
  circular.text = circular;
  assert.equal(socialRequestBytes(circular), Infinity);
});
