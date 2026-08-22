'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb } = require('../../cms/firestoreFake.cjs');
const { createManualProvider } = require('./manual.cjs');

const T0 = new Date('2026-08-20T10:00:00.000Z');

function manualTicket(id, overrides = {}) {
  return {
    orderId: id,
    email: 'attendee@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    ticketClass: 'General',
    quantity: 1,
    purchasedAt: null,
    status: 'valid',
    provider: 'manual',
    claimedByUid: null,
    claimedAt: null,
    claimPromptSentAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

test('reads externalEventId once, from EVENT_TICKETING_EVENT_ID (§3.3), same as none', () => {
  const provider = createManualProvider({ env: { EVENT_TICKETING_EVENT_ID: ' evt-1 ' }, db: makeFakeDb() });
  assert.equal(provider.externalEventId, 'evt-1');
  assert.equal(provider.name, 'manual');
});

test('verifyWebhook always refuses — no webhook, ever (§3.3)', async () => {
  const provider = createManualProvider({ db: makeFakeDb() });
  const verification = await provider.verifyWebhook(Buffer.from('{}'), {});
  assert.deepEqual(verification, {
    valid: false, deliveryId: '', eventType: 'unknown', resourceId: null, reason: 'no webhook',
  });
  // No registerWebhook — the §3.3 capability gate must report false.
  assert.equal(typeof provider.registerWebhook, 'undefined');
});

test('listTickets serves from the imported tickets set (§3.3), scoped to provider === manual', async () => {
  const db = makeFakeDb({
    'tickets/tkt-1': manualTicket('ord-1'),
    'tickets/tkt-2': manualTicket('ord-2', { email: 'b@example.com' }),
    'tickets/tkt-3': { ...manualTicket('ord-9'), provider: 'eventbrite' },
  });
  const provider = createManualProvider({ db });
  const { tickets, nextPageToken } = await provider.listTickets();
  assert.equal(tickets.length, 2);
  assert.equal(nextPageToken, null);
  assert.ok(tickets.every((t) => ['tkt-1', 'tkt-2'].includes(t.externalId)));
});

test('lookupByOrderNumber is an exact match on imported rows', async () => {
  const db = makeFakeDb({ 'tickets/tkt-1': manualTicket('ord-42') });
  const provider = createManualProvider({ db });
  const found = await provider.lookupByOrderNumber('ord-42', 'attendee@example.com');
  assert.equal(found.length, 1);
  assert.equal(found[0].externalId, 'tkt-1');
  assert.equal(found[0].orderId, 'ord-42');

  assert.equal(await provider.lookupByOrderNumber('nope', ''), null);
  assert.equal(await provider.lookupByOrderNumber('', ''), null);
});

test('fetchOrder returns complete: true — a CSV row has no eventually-consistent state to wait out', async () => {
  const db = makeFakeDb({ 'tickets/tkt-1': manualTicket('ord-7') });
  const provider = createManualProvider({ db });
  const order = await provider.fetchOrder('ord-7');
  assert.equal(order.complete, true);
  assert.equal(order.tickets.length, 1);

  const empty = await provider.fetchOrder('missing');
  assert.deepEqual(empty, { orderId: 'missing', externalEventId: null, tickets: [], complete: true });
});

test('getRegistrationPrompt suppresses for a speaker or an already-claimed ticket, every trigger', async () => {
  const provider = createManualProvider({ db: makeFakeDb() });
  for (const ctx of [{ isSpeaker: true }, { hasClaimedTicket: true }]) {
    const prompt = await provider.getRegistrationPrompt({ ...ctx, trigger: 'account_created' });
    assert.equal(prompt.send, false);
  }
});

test('getRegistrationPrompt: unclaimed ticket → claim prompt pointed at /ticket/claim (§3.5, issue #33)', async () => {
  const provider = createManualProvider({
    db: makeFakeDb(),
    getConfig: async () => ({ tierA: { publicUrl: 'https://summit.example.org' } }),
  });
  const prompt = await provider.getRegistrationPrompt({ trigger: 'ticket_unclaimed' });
  assert.equal(prompt.send, true);
  assert.equal(prompt.action, 'claim');
  assert.equal(prompt.templateId, 'ticket.claim_prompt');
  assert.equal(prompt.ctaUrl, 'https://summit.example.org/ticket/claim');
});

test('getRegistrationPrompt: unclaimed ticket with no configured public URL degrades to no CTA', async () => {
  const provider = createManualProvider({ db: makeFakeDb(), getConfig: async () => ({}) });
  const prompt = await provider.getRegistrationPrompt({ trigger: 'ticket_unclaimed' });
  assert.equal(prompt.send, true);
  assert.equal(prompt.ctaUrl, null);
});

test('getRegistrationPrompt: account_created with an external registration URL configured', async () => {
  const provider = createManualProvider({
    db: makeFakeDb(),
    getConfig: async () => ({ event: { registration: { externalUrl: 'https://register.example/' } } }),
  });
  const prompt = await provider.getRegistrationPrompt({ trigger: 'account_created' });
  assert.equal(prompt.send, true);
  assert.equal(prompt.action, 'purchase');
  assert.equal(prompt.ctaUrl, 'https://register.example/');
});

test('getRegistrationPrompt: account_created with no external URL → await_approval, no CTA (§3.5)', async () => {
  const provider = createManualProvider({ db: makeFakeDb(), getConfig: async () => ({}) });
  const prompt = await provider.getRegistrationPrompt({ trigger: 'account_created' });
  assert.equal(prompt.send, true);
  assert.equal(prompt.action, 'await_approval');
  assert.equal(prompt.ctaUrl, null);
  assert.ok(prompt.bodyNote);
});

test('constructing without a db throws loudly rather than TypeError-ing three calls deep', async () => {
  const provider = createManualProvider({});
  await assert.rejects(() => provider.listTickets(), /without a db handle/);
});
