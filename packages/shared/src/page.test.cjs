'use strict';

/**
 * The cmsPages document readers (shared/page.cjs).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { pageHeading } = require('./page.cjs');

test('pageHeading prefers the page title over the navigation label', () => {
  assert.equal(
    pageHeading({ label: 'FAQ', title: 'Frequently asked questions' }),
    'Frequently asked questions',
  );
});

test('pageHeading falls back to the label when no title is stated', () => {
  assert.equal(pageHeading({ label: 'Contact' }), 'Contact');
  assert.equal(pageHeading({ label: 'Contact', title: null }), 'Contact');
  assert.equal(pageHeading({ label: 'Contact', title: '   ' }), 'Contact');
});

test('pageHeading trims what it returns, so a stray space never reaches a heading', () => {
  assert.equal(pageHeading({ label: '  Recap  ' }), 'Recap');
  assert.equal(pageHeading({ label: 'FAQ', title: '  Frequently asked questions  ' }), 'Frequently asked questions');
});

test('pageHeading names nothing for a page that names itself nothing', () => {
  assert.equal(pageHeading(null), '');
  assert.equal(pageHeading(undefined), '');
  assert.equal(pageHeading('travel'), '');
  assert.equal(pageHeading({}), '');
  assert.equal(pageHeading({ label: '   ' }), '');
});
