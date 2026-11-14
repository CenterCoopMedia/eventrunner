'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_POLICY_BYTES, normalizeTicketClassId, ticketClassIdentity,
  validateTicketAccessPolicy, resolveTicketClassGrant,
} = require('./ticketAccess.cjs');
const { validateCheckoutRequest } = require('./ticketCommerce.cjs');

const context = { provider: 'manual', eventId: 'synthetic-event',
  dayIds: ['friday', 'saturday'], sessionIds: ['workshop', 'awards', 'plenary'] };
const resources = (sessions, directory = false, attendeeUpdates = false, interactions = false) => ({
  sessions, directory, attendeeUpdates, interactions, protectedMaterials: 'existing-embargo',
});
const partial = (dayIds = [], sessionIds = []) => ({ all: false, dayIds, sessionIds });
function policy() {
  return {
    schemaVersion: 1, provider: context.provider, eventId: context.eventId, revision: 3, lifetime: 'current-policy',
    classes: [
      { id: 'full', resources: resources({ all: true, dayIds: [], sessionIds: [] }, true, true, true) },
      { id: 'one-day', resources: resources(partial(['friday']), true, true) },
      { id: 'workshop', resources: resources(partial([], ['workshop'])) },
      { id: 'awards', resources: resources(partial([], ['awards'])) },
      { id: 'combined', resources: resources(partial(['friday'], ['awards']), true) },
    ],
    mappings: [
      { sourceClassId: 'paid-full', classId: 'full' },
      { sourceClassId: 'day-pass', classId: 'one-day' },
      { sourceClassId: 'workshop-pass', classId: 'workshop' },
      { sourceClassId: 'awards-pass', classId: 'awards' },
      { sourceClassId: 'combined-pass', classId: 'combined' },
      { sourceClassId: 'free-pass', classId: 'one-day' },
      { sourceClassId: 'sponsor-pass', classId: 'one-day' },
      { sourceClassId: 'comp-pass', classId: 'workshop' },
    ],
  };
}
const ticket = (id, patch = {}) => ({ provider: 'manual', eventId: context.eventId, ticketClassId: id, ...patch });

test('the resource matrix represents full, day, workshop, awards and combined selections', () => {
  const input = policy();
  assert.equal(validateTicketAccessPolicy(input, context).ok, true);
  const cases = [
    ['paid-full', { all: true, dayIds: [], sessionIds: [] }],
    ['day-pass', partial(['friday'])],
    ['workshop-pass', partial([], ['workshop'])],
    ['awards-pass', partial([], ['awards'])],
    ['combined-pass', partial(['friday'], ['awards'])],
  ];
  for (const [id, expected] of cases) {
    const grant = resolveTicketClassGrant(input, ticket(id), context);
    assert.deepEqual(grant.resources.sessions, expected, id);
    assert.equal(grant.policyRevision, 3);
    assert.equal(grant.resources.protectedMaterials, 'existing-embargo');
  }
});

test('free, sponsor and comp tickets use their chosen class, not an issuer role or price', () => {
  for (const [id, classId] of [['free-pass', 'one-day'], ['sponsor-pass', 'one-day'], ['comp-pass', 'workshop']]) {
    const grant = resolveTicketClassGrant(policy(), ticket(id, {
      source: 'comp', unitAmount: 0, role: 'admin', grants: { all: true }, ticketClass: 'Full event',
    }), context);
    assert.equal(grant.classId, classId);
    assert.equal(grant.resources.sessions.all, false);
    assert.equal(grant.resources.interactions, false);
  }
});

test('labels and missing, foreign or malformed identities cannot acquire a mapped grant', () => {
  for (const candidate of [
    ticket(null, { ticketClass: 'paid-full' }),
    ticket('unknown', { ticketClass: 'Full event' }),
    ticket('paid-full', { eventId: null }),
    ticket('paid-full', { eventId: 'another-event' }),
    ticket('paid-full', { provider: 'eventbrite' }),
    ticket('../paid-full'),
  ]) assert.equal(resolveTicketClassGrant(policy(), candidate, context), null);
  const original = resolveTicketClassGrant(policy(), ticket('day-pass', { ticketClass: 'Full event' }), context);
  assert.deepEqual(resolveTicketClassGrant(policy(), ticket('day-pass', { ticketClass: 'A renamed ticket' }), context), original);
  assert.equal(ticketClassIdentity(ticket(null, { ticketTypeId: 'paid-full' })), null, 'manual IDs never fall back to a Stripe field');
  assert.equal(normalizeTicketClassId({ id: 'paid-full' }), null);
});

test('Stripe keeps its existing native type identity for paid, free and comp records', () => {
  const scope = { ...context, provider: 'stripe' };
  const input = { ...policy(), provider: 'stripe' };
  for (const source of ['checkout', 'free', 'comp']) {
    const native = { provider: 'stripe', eventId: context.eventId, ticketTypeId: 'workshop-pass',
      ticketClass: 'Full event', ticketClassId: 'paid-full', source };
    assert.deepEqual(ticketClassIdentity(native), { provider: 'stripe', eventId: context.eventId, classId: 'workshop-pass' });
    assert.equal(resolveTicketClassGrant(input, native, scope).classId, 'workshop');
  }
});

test('policies require a version, deliberate revision lifetime, canonical references and closed rights', () => {
  const mutations = [
    (p) => { p.schemaVersion = 2; },
    (p) => { p.revision = 0; },
    (p) => { p.lifetime = 'purchase-snapshot'; },
    (p) => { p.eventId = 'another-event'; },
    (p) => { p.roles = { attendee: 'admin' }; },
    (p) => { p.classes[0].resources.protectedMaterials = 'early-access'; },
    (p) => { p.classes[0].resources.directory = 'true'; },
    (p) => { p.classes[0].resources.sessions.dayIds = ['friday']; },
    (p) => { p.classes[1].resources.sessions.dayIds = ['unknown-day']; },
    (p) => { p.classes[1].resources.sessions.sessionIds = ['unknown-session']; },
    (p) => { p.classes[1].resources.sessions.sessionIds = [null]; },
    (p) => { p.classes[1].resources.sessions.dayIds = ['friday', 'friday']; },
    (p) => { p.classes.push(p.classes[0]); },
    (p) => { p.mappings.push(p.mappings[0]); },
    (p) => { p.mappings[0].classId = 'missing-class'; },
    (p) => { p.mappings[0].sourceClassId = ' paid-full '; },
    (p) => { p.classes[0].resources.extraRights = true; },
  ];
  for (const mutate of mutations) {
    const input = policy();
    mutate(input);
    const checked = validateTicketAccessPolicy(input, context);
    assert.equal(checked.ok, false, mutate.toString());
    assert.equal(checked.value, null);
    assert.equal(resolveTicketClassGrant(input, ticket('paid-full'), context), null);
  }
  assert.equal(validateTicketAccessPolicy(policy(), { ...context, dayIds: [null] }).ok, false);
  assert.equal(validateTicketAccessPolicy(policy(), null).ok, false);
  const oversized = policy();
  oversized.mappings = [{ sourceClassId: 'x'.repeat(MAX_POLICY_BYTES), classId: 'full' }];
  assert.equal(validateTicketAccessPolicy(oversized, context).ok, false);
});

test('resolution carries the current policy revision and leaves input snapshots intact', () => {
  const original = policy();
  const snapshot = JSON.stringify(original);
  const before = resolveTicketClassGrant(original, ticket('day-pass'), context);
  const revised = policy();
  revised.revision++;
  revised.classes.find((entry) => entry.id === 'one-day').resources.sessions.dayIds = ['saturday'];
  const after = resolveTicketClassGrant(revised, ticket('day-pass'), context);
  assert.equal(before.policyRevision, 3);
  assert.equal(after.policyRevision, 4);
  assert.deepEqual(after.resources.sessions.dayIds, ['saturday']);
  assert.equal(JSON.stringify(original), snapshot);
});

test('browser checkout cannot author grants in its envelope, lines or attendee assignment', () => {
  const base = { requestId: 'synthetic-request-555', lines: [{ ticketTypeId: 'full', quantity: 1,
    attendees: [{ firstName: 'Riley', lastName: 'Example', email: 'riley@example.test' }] }] };
  assert.equal(validateCheckoutRequest(base).ok, true);
  for (const inject of [
    (v) => { v.grants = policy().classes[0].resources; },
    (v) => { v.lines[0].grants = policy().classes[0].resources; },
    (v) => { v.lines[0].attendees[0].grants = policy().classes[0].resources; },
  ]) {
    const input = JSON.parse(JSON.stringify(base));
    inject(input);
    assert.equal(validateCheckoutRequest(input).ok, false);
  }
});

test('the ESM entry exposes the same validated contract', async () => {
  const esm = await import('./ticketAccess.mjs');
  assert.deepEqual(esm.resolveTicketClassGrant(policy(), ticket('paid-full'), context),
    resolveTicketClassGrant(policy(), ticket('paid-full'), context));
});
