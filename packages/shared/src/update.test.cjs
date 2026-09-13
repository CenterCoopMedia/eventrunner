'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validUpdateImage, validUpdateContent } = require('./update.cjs');
const updates = require('../../../scripts/lib/demo-updates.json');
test('all demo posts satisfy the rich update contract', () => {
  for (const update of updates) {
    if (update.featuredImage) assert.equal(validUpdateImage(update.featuredImage), true, update.id);
    assert.equal(validUpdateContent(update.content), true, update.id);
  }
});
test('reject unsafe and unbounded update content', () => {
  for (const href of ['javascript:alert(1)', '//evil.example', '/\\evil.example', 'data:text/html,x']) {
    assert.equal(validUpdateContent([{ type: 'button', label: 'Open', href }]), false);
  }
  assert.equal(validUpdateContent(Array(21).fill({ type: 'richtext', value: 'Text' })), false);
  assert.equal(validUpdateContent([{ type: 'columns', columns: [] }]), false);
  assert.equal(validUpdateContent([{ type: 'practicePoll', question: 'Vote', options: ['A', 'A'] }]), false);
  assert.equal(validUpdateImage({ url: 'demo/../secret.webp', alt: 'Invalid' }), false);
});
