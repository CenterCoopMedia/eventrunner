'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTicketCatalog, validateCheckoutRequest, isSalesWindowOpen } = require('./ticketCommerce.cjs');

const catalog = (patch = {}) => ({
  currency: 'usd', capacity: 100, taxTreatment: 'not_collected',
  ticketTypes: [{ id: 'general', name: 'Full event pass', unitAmount: 2500, capacity: 100 }], ...patch,
});
const attendee = { firstName: 'Ada', lastName: 'Example', email: 'ada@example.com' };
const request = (patch = {}) => ({
  requestId: 'request-0123456789', lines: [{ ticketTypeId: 'general', quantity: 1, attendees: [attendee] }], ...patch,
});

test('catalog normalizes one server currency and explicit commercial terms', () => {
  const checked = validateTicketCatalog(catalog({ currency: 'USD' }));
  assert.equal(checked.ok, true);
  assert.equal(checked.value.currency, 'usd');
  assert.equal(checked.value.published, false);
  assert.equal(checked.value.salesPaused, false);
  assert.equal(checked.value.ticketTypes[0].visibility, 'public');
  assert.equal(checked.value.ticketTypes[0].maxPerOrder, 20);
  assert.equal(validateTicketCatalog(catalog({ published: true })).ok, false);
  assert.equal(validateTicketCatalog(catalog({ published: true, commercialTermsConfirmed: true, refundPolicy: 'Refunds until sales close.' })).ok, true);
});

test('prices, capacities, supported minor units, and quantity bounds fail closed', () => {
  for (const patch of [
    { currency: 'jpy' }, { currency: 'constructor' }, { capacity: 1.5 }, { capacity: 0 },
    { maxPerOrder: 21 }, { taxTreatment: 'exempt' }, { salesPaused: 'false' }, { revision: -1 },
  ]) assert.equal(validateTicketCatalog(catalog(patch)).ok, false, JSON.stringify(patch));
  for (const patch of [
    { unitAmount: 9.99 }, { unitAmount: -1 }, { unitAmount: Number.MAX_SAFE_INTEGER },
    { capacity: 0 }, { id: 'constructor' }, { id: '../users' }, { visibility: 'private' },
    { minPerOrder: 3, maxPerOrder: 2 }, { maxPerOrder: 21 },
  ]) {
    assert.equal(validateTicketCatalog(catalog({ ticketTypes: [{ ...catalog().ticketTypes[0], ...patch }] })).ok, false, JSON.stringify(patch));
  }
});

test('catalog sale windows require timezone and increasing dates', () => {
  assert.equal(validateTicketCatalog(catalog({ salesStartAt: '2026-10-12T09:00:00' })).ok, false);
  assert.equal(validateTicketCatalog(catalog({ salesStartAt: '2026-10-12T09:00:00Z', salesEndAt: '2026-10-12T08:00:00Z' })).ok, false);
  const type = { ...catalog().ticketTypes[0], salesStartAt: '2026-10-12T09:00:00-04:00', salesEndAt: '2026-10-12T14:00:00Z' };
  const result = validateTicketCatalog(catalog({ ticketTypes: [type] }));
  assert.equal(result.ok, true);
  assert.equal(result.value.ticketTypes[0].salesStartAt, '2026-10-12T13:00:00.000Z');
  assert.equal(isSalesWindowOpen(result.value.ticketTypes[0], new Date('2026-10-12T13:00:00Z')), true);
  assert.equal(isSalesWindowOpen(result.value.ticketTypes[0], new Date('2026-10-12T14:00:00Z')), false);
});

test('catalog refuses duplicate types and bounded ticket collections', () => {
  const type = catalog().ticketTypes[0];
  assert.equal(validateTicketCatalog(catalog({ ticketTypes: [type, type] })).ok, false);
  assert.equal(validateTicketCatalog(catalog({ ticketTypes: [] })).ok, false);
  assert.equal(validateTicketCatalog(catalog({ ticketTypes: Array(21).fill(type) })).ok, false);
});

test('checkout accepts selections and normalized per-seat assignments only', () => {
  const result = validateCheckoutRequest(request({ lines: [
    { ticketTypeId: 'student', quantity: 1, attendees: [{ ...attendee, email: ' ADA@EXAMPLE.COM ' }] },
    { ticketTypeId: 'general', quantity: 1, attendees: [attendee] },
  ] }));
  assert.equal(result.ok, true);
  assert.equal(result.value.lines[0].ticketTypeId, 'general');
  assert.equal(result.value.lines[1].attendees[0].email, 'ada@example.com');
  for (const bad of [
    request({ unitAmount: 1 }), request({ purchaserUid: 'admin' }), request({ requestId: '../bad' }),
    request({ lines: [{ ...request().lines[0], price: 1 }] }),
    request({ lines: [{ ...request().lines[0], attendees: [{ ...attendee, claimedByUid: 'admin' }] }] }),
    request({ lines: [{ ...request().lines[0], attendees: [{ ...attendee, email: '' }] }] }),
    request({ lines: [{ ...request().lines[0], quantity: 1.1 }] }),
    request({ lines: [{ ...request().lines[0], quantity: 2 }] }),
    request({ lines: [request().lines[0], request().lines[0]] }),
  ]) assert.equal(validateCheckoutRequest(bad).ok, false, JSON.stringify(bad));
});

test('checkout normalizes an accepted catalog revision and leaves revision-free internal requests intact', () => {
  for (const revision of [0, 1, Number.MAX_SAFE_INTEGER]) {
    const checked = validateCheckoutRequest(request({ catalogRevision: revision }));
    assert.equal(checked.ok, true);
    assert.equal(checked.value.catalogRevision, revision);
  }
  assert.equal(Object.hasOwn(validateCheckoutRequest(request()).value, 'catalogRevision'), false);
  for (const catalogRevision of [null, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validateCheckoutRequest(request({ catalogRevision })).ok, false);
  }
  assert.equal(validateCheckoutRequest({ requestId: request().requestId, resume: true, catalogRevision: 1 }).ok, false);
});

test('group purchases have a global seat ceiling, not one ceiling per type', () => {
  assert.equal(validateCheckoutRequest(request({ lines: [
    { ticketTypeId: 'general', quantity: 11, attendees: Array(11).fill(attendee) },
    { ticketTypeId: 'student', quantity: 10, attendees: Array(10).fill(attendee) },
  ] })).ok, false);
});

test('resume accepts the original request ID without resending private attendee data', () => {
  assert.deepEqual(validateCheckoutRequest({ requestId: 'request-0123456789', resume: true }), {
    ok: true, value: { requestId: 'request-0123456789', resume: true }, issues: [],
  });
  assert.equal(validateCheckoutRequest(request({ resume: true })).ok, false);
});

test('cross-device resume accepts one opaque order ID but never mixes it with a new cart', () => {
  const orderId = `ord_${'a'.repeat(40)}`;
  assert.deepEqual(validateCheckoutRequest({ orderId, resume: true }), {
    ok: true, value: { orderId, resume: true }, issues: [],
  });
  assert.equal(validateCheckoutRequest({ orderId: '../tickets', resume: true }).ok, false);
  assert.equal(validateCheckoutRequest(request({ orderId })).ok, false);
  assert.equal(validateCheckoutRequest({ orderId, requestId: request().requestId, resume: true }).ok, false);
});

test('ES module shim exposes the same commerce validator', async () => {
  const esm = await import('./ticketCommerce.mjs');
  assert.equal(esm.validateTicketCatalog, validateTicketCatalog);
});
