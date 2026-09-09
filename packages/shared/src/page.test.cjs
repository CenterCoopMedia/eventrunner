'use strict';

/**
 * The cmsPages document readers (shared/page.cjs).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { pageHeading, pageFeatureGate, isPublicPage } = require('./page.cjs');

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

test('pageHeading leaves a system page named by its label, whatever title it carries', () => {
  // A system page's <h1> is written in its route's code — Schedule.jsx
  // writes "Schedule", the home page draws its hero title — so a stored
  // `title` could only rename the browser tab and the link card and never
  // the heading itself, which is three names for one page. The editor no
  // longer offers the field for these pages; a document written before it
  // stopped, or written straight into Firestore, can still carry one.
  assert.equal(
    pageHeading({ id: 'schedule', label: 'Schedule', title: 'The full programme', systemPage: true }),
    'Schedule',
  );
  assert.equal(
    pageHeading({ id: 'home', label: 'Home', title: 'Welcome', systemPage: true }),
    'Home',
  );
  // A content page is still headed by the title it states.
  assert.equal(
    pageHeading({ id: 'faq', label: 'FAQ', title: 'Frequently asked questions', systemPage: false }),
    'Frequently asked questions',
  );
});

test('pageHeading names nothing for a page that names itself nothing', () => {
  assert.equal(pageHeading(null), '');
  assert.equal(pageHeading(undefined), '');
  assert.equal(pageHeading('travel'), '');
  assert.equal(pageHeading({}), '');
  assert.equal(pageHeading({ label: '   ' }), '');
});

// ------------------------------------------------------------ isPublicPage

const ALL_ON = Object.freeze({
  schedule: true, speakers: true, sponsors: true, attendeeDirectory: true, updates: true,
});

const generic = (over = {}) => ({ id: 'travel', path: '/travel', visible: true, systemPage: false, ...over });
const system = (id, over = {}) => ({ id, path: `/${id}`, visible: true, systemPage: true, ...over });

test('pageFeatureGate names the flag a system route checks, and nothing for the rest', () => {
  assert.equal(pageFeatureGate(system('schedule')), 'schedule');
  assert.equal(pageFeatureGate(system('updates')), 'updates');
  assert.equal(pageFeatureGate(system('attendees')), 'attendeeDirectory');
  // The index route is always mounted: no flag turns the front door off.
  assert.equal(pageFeatureGate(system('home')), null);
  assert.equal(pageFeatureGate(generic()), null);
  assert.equal(pageFeatureGate(null), null);
  assert.equal(pageFeatureGate({}), null);
});

test('isPublicPage publishes a visible page whose route is not gated', () => {
  assert.equal(isPublicPage(generic(), ALL_ON), true);
  assert.equal(isPublicPage(system('home'), {}), true);
});

test('isPublicPage refuses a hidden page whatever its flags say', () => {
  assert.equal(isPublicPage(generic({ visible: false }), ALL_ON), false);
  assert.equal(isPublicPage(system('schedule', { visible: false }), ALL_ON), false);
});

test('isPublicPage reads `visible` strictly, so a document that never stated it is not published', () => {
  // The whole reason the contract is `=== true`: the server side of this
  // runs on the Admin SDK, which bypasses firestore.rules, so a doc with
  // the field absent or half-written has nothing else standing behind it.
  assert.equal(isPublicPage(generic({ visible: undefined }), ALL_ON), false);
  assert.equal(isPublicPage(generic({ visible: 'yes' }), ALL_ON), false);
  assert.equal(isPublicPage(generic({ visible: 1 }), ALL_ON), false);
  const { visible, ...noField } = generic();
  assert.equal(visible, true);
  assert.equal(isPublicPage(noField, ALL_ON), false);
});

test('isPublicPage refuses a visible system page whose feature is off', () => {
  assert.equal(isPublicPage(system('updates'), { ...ALL_ON, updates: false }), false);
  assert.equal(isPublicPage(system('updates'), {}), false);
  assert.equal(isPublicPage(system('updates'), undefined), false);
  // A flag that is merely truthy is not on either — the seed writes booleans.
  assert.equal(isPublicPage(system('updates'), { updates: 'on' }), false);
  assert.equal(isPublicPage(system('updates'), ALL_ON), true);
});

test('isPublicPage leaves a generic page alone when an unrelated feature is off', () => {
  assert.equal(isPublicPage(generic(), { ...ALL_ON, schedule: false }), true);
});

test('isPublicPage refuses anything that is not a page document', () => {
  assert.equal(isPublicPage(null, ALL_ON), false);
  assert.equal(isPublicPage(undefined, ALL_ON), false);
  assert.equal(isPublicPage('travel', ALL_ON), false);
  assert.equal(isPublicPage(42, ALL_ON), false);
});
