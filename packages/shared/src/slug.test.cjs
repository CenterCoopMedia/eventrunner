'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateSlug, generateSpeakerSlug } = require('./slug.cjs');

test('generateSlug: lowercase, hyphenated, trimmed', () => {
  assert.equal(generateSlug('Opening Keynote: The Big Idea!'), 'opening-keynote-the-big-idea');
  assert.equal(generateSlug('  --Hello World--  '), 'hello-world');
  assert.equal(generateSlug(''), '');
  assert.equal(generateSlug(null), '');
});

test('generateSlug strips diacritics', () => {
  assert.equal(generateSlug('Café Àla Zürich'), 'cafe-ala-zurich');
});

test('generateSpeakerSlug joins names and tolerates missing parts', () => {
  assert.equal(generateSpeakerSlug('María', 'García'), 'maria-garcia');
  assert.equal(generateSpeakerSlug('Cher', ''), 'cher');
  assert.equal(generateSpeakerSlug(undefined, 'Solo'), 'solo');
  assert.equal(generateSpeakerSlug(undefined, undefined), '');
});
