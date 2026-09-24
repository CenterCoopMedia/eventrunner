'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validUpdateImage, validUpdateContent, UPDATE_CATEGORY_MAX, validUpdateCategory } = require('./update.cjs');
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
test('poll option labels must differ after display whitespace is normalized', () => {
  for (const options of [['A', ' A '], ['Local news', 'Local  news'], ['Local news', 'Local\nnews']]) {
    assert.equal(validUpdateContent([{ type: 'practicePoll', question: 'Choose', options }]), false);
  }
  assert.equal(validUpdateContent([{ type: 'practicePoll', question: 'Choose', options: ['Local news', 'Revenue'] }]), true);
});
test('a category is one short line: 1 to 24 characters once trimmed, with no control character', () => {
  assert.equal(UPDATE_CATEGORY_MAX, 24);
  for (const value of ['T', 'Travel', ' Travel ', 'Travel and arrival notes', 'x'.repeat(24), 'Café et thé']) {
    assert.equal(validUpdateCategory(value), true, JSON.stringify(value));
  }
  for (const value of [
    'x'.repeat(25), '', '   ', null, undefined, 7, true, ['Travel'], { value: 'Travel' },
    'Two\nlines', 'Tab\there', 'Nul\u0000', 'Bell\u0007', 'Del\u007f', 'C1\u0085',
  ]) {
    assert.equal(validUpdateCategory(value), false, JSON.stringify(value));
  }
});
test('the demo posts carry valid categories, and exactly one is featured and it is not pinned', () => {
  const categorised = updates.filter((update) => update.category !== undefined);
  assert.ok(categorised.length >= 1);
  for (const update of categorised) assert.equal(validUpdateCategory(update.category), true, update.id);
  const featured = updates.filter((update) => update.featured === true);
  assert.equal(featured.length, 1);
  assert.equal(featured[0].pinned, false);
  for (const update of updates) {
    if ('featured' in update) assert.equal(typeof update.featured, 'boolean', update.id);
  }
});
