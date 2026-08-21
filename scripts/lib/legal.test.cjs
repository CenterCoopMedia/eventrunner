'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildLegalContent, REVIEW_MARKER } = require('./legal.cjs');

const EVENT = Object.freeze({
  legal: {
    operatorName: 'Test Operator',
    supportEmail: 'support@example.org',
    conductEmail: 'conduct@example.org',
  },
  auth: { googleProviderEnabled: false },
});

function build(providers, event = EVENT) {
  return buildLegalContent({ event, providers });
}

const text = (blocks) => blocks.map((b) => b.value).join('\n');

test('both pages seed as unreviewed templates', () => {
  const legal = build({ ticketing: { provider: 'none' }, email: { provider: 'console' } });
  assert.equal(legal.reviewRequired, true);
  assert.ok(legal.privacy.length > 0 && legal.terms.length > 0);
});

test('the operator name comes from config, and no organization is hardcoded', () => {
  const legal = build({ ticketing: { provider: 'none' }, email: { provider: 'console' } });
  assert.match(text(legal.privacy), /Test Operator/);
  assert.match(text(legal.terms), /Test Operator/);
  // The pre-v1 pages named one university and one ticketing vendor
  // unconditionally; nothing in the template may name an organization.
  assert.doesNotMatch(text(legal.privacy) + text(legal.terms), /Montclair|Eventbrite|Postmark/i);
});

test('a manual/none deployment never mentions a ticketing vendor', () => {
  const legal = build({ ticketing: { provider: 'manual' }, email: { provider: 'console' } });
  const all = text(legal.privacy) + text(legal.terms);
  assert.doesNotMatch(all, /ticketing platform/);
  assert.equal(legal.terms.some((b) => b.section === 'terms_registration'), false);
});

test('a ticketed deployment discloses the ticketing processor and refund policy', () => {
  const legal = build({ ticketing: { provider: 'eventbrite' }, email: { provider: 'postmark' } });
  assert.match(text(legal.privacy), /third-party ticketing platform/);
  assert.match(text(legal.privacy), /third-party transactional email provider/);
  const registration = legal.terms.find((b) => b.section === 'terms_registration');
  assert.ok(registration);
  assert.match(registration.value, /refund/);
});

test('sign-in is described as emailed one-time codes — never a magic link', () => {
  const legal = build({ ticketing: { provider: 'none' }, email: { provider: 'console' } });
  const signin = legal.privacy.find((b) => b.field === 'signin');
  assert.match(signin.value, /one-time code emailed/);
  assert.doesNotMatch(text(legal.privacy) + text(legal.terms), /magic link/i);
});

test('Google sign-in is described only once it is actually enabled', () => {
  const off = build({ ticketing: { provider: 'none' }, email: { provider: 'console' } });
  assert.doesNotMatch(text(off.privacy), /Google sign-in/);
  const on = build(
    { ticketing: { provider: 'none' }, email: { provider: 'console' } },
    { ...EVENT, auth: { googleProviderEnabled: true } },
  );
  assert.match(text(on.privacy), /Google sign-in/);
});

test('jurisdiction-dependent clauses carry the review marker', () => {
  const legal = build({ ticketing: { provider: 'none' }, email: { provider: 'console' } });
  const retention = legal.privacy.find((b) => b.section === 'privacy_retention');
  const liability = legal.terms.find((b) => b.section === 'terms_liability');
  assert.match(retention.value, new RegExp(REVIEW_MARKER.replace(/[[\]]/g, '\\$&')));
  assert.match(liability.value, new RegExp(REVIEW_MARKER.replace(/[[\]]/g, '\\$&')));
});

test('a missing operator name degrades to a [Replace] marker, never a blank assertion', () => {
  const legal = buildLegalContent({
    event: { legal: {} },
    providers: { ticketing: { provider: 'none' }, email: { provider: 'console' } },
  });
  assert.match(text(legal.privacy), /\[Replace\] Operator name/);
});
