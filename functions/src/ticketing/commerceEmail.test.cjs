'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const { sendOrderConfirmations } = require('./commerceEmail.cjs');
const { createEmailCore } = require('../email/send.cjs');
const { resetTemplateCacheForTest } = require('../email/templates.cjs');

const env = { EVENT_PUBLIC_URL: 'https://event.example.org', EVENT_TICKETING_EVENT_ID: 'synthetic-event', EVENT_STRIPE_ACCOUNT_ID: 'acct_synthetic', EVENT_STRIPE_MODE: 'test' };
const config = { event: { name: 'Synthetic conference', historicalDemo: false, sender: { email: 'organizer@example.org', name: 'Synthetic organizer' }, legal: { operatorName: 'Synthetic organizer', supportEmail: 'help@example.org', postalAddressHtml: 'Synthetic test address' } }, tierA: { publicUrl: env.EVENT_PUBLIC_URL } };
const getConfig = async () => config;
const order = { id: 'order-1', provider: 'stripe', eventId: env.EVENT_TICKETING_EVENT_ID, stripeAccountId: env.EVENT_STRIPE_ACCOUNT_ID, livemode: false, inventoryState: 'sold', paymentStatus: 'succeeded', purchaserEmail: 'buyer@example.org', totalAmount: 10000, currency: 'usd', ticketIds: ['ticket-1', 'ticket-2'] };
function fixture(extra = {}) {
  return makeFakeDb({
    'config/event': config.event, 'ticket_orders/order-1': order,
    'tickets/ticket-1': { externalId: 'ticket-1', orderId: 'order-1', status: 'valid', email: 'attendee@example.org', firstName: 'Synthetic' },
    'tickets/ticket-2': { externalId: 'ticket-2', orderId: 'order-1', status: 'valid', email: 'attendee@example.org', firstName: 'Synthetic' },
    ...extra,
  });
}
test.beforeEach(resetTemplateCacheForTest);

test('confirmation replay sends one purchaser confirmation and one distinct attendee invitation through the existing email core', async () => {
  const db = fixture();
  const sent = [];
  const provider = { name: 'test', async send(message) { sent.push(message); return { status: 'sent', providerMessageId: `synthetic-${sent.length}` }; } };
  const sendEmail = createEmailCore({ db, provider, getConfig }).send;
  const run = () => sendOrderConfirmations({ db, getConfig, orderId: 'order-1', env, sendEmail });
  assert.equal((await run()).sent, 2);
  assert.equal((await run()).alreadySent, true);
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /\$100\.00/);
  assert.match(sent[0].text, /tickets\/status\?orderId=order-1/);
  assert.doesNotMatch(sent[1].text, /100\.00|buyer@example/);
  assert.match(sent[1].text, /ticket\/claim\?order=order-1/);
  const logs = await db.collection('sent_emails').get();
  assert.equal(logs.size, 2);
  assert.ok(logs.docs.every((snap) => snap.data().bodyStored === false));
});

test('unpaid, wrong-scope, refunded-only, and demo orders send no messages', async () => {
  for (const changes of [
    { 'ticket_orders/order-1': { ...order, paymentStatus: 'unpaid' } },
    { 'ticket_orders/order-1': { ...order, livemode: true } },
    { 'ticket_orders/order-1': { ...order, stripeAccountId: 'acct_other' } },
    { 'config/event': { historicalDemo: true } },
    { 'tickets/ticket-1': { orderId: 'order-1', status: 'refunded' }, 'tickets/ticket-2': { orderId: 'order-1', status: 'cancelled' } },
  ]) {
    let sends = 0;
    const result = await sendOrderConfirmations({ db: fixture(changes), getConfig, orderId: 'order-1', env, sendEmail: async () => { sends += 1; } });
    assert.equal(sends, 0);
    assert.equal(result.sent, 0);
  }
});

test('uncertain delivery is visible and an explicit new resend key remains idempotent', async () => {
  const db = fixture();
  let sends = 0;
  const provider = { name: 'test', async send() { sends += 1; return { status: 'failed', providerMessageId: null, error: 'synthetic failure' }; } };
  const sendEmail = createEmailCore({ db, provider, getConfig }).send;
  const first = await sendOrderConfirmations({ db, getConfig, orderId: 'order-1', env, sendEmail });
  assert.equal(first.failed, 2);
  assert.equal((await db.collection('admin_logs').get()).docs[0].data().action, 'ticketing.confirmation-needs-attention');
  await sendOrderConfirmations({ db, getConfig, orderId: 'order-1', env, sendEmail });
  assert.equal(sends, 2);
  await sendOrderConfirmations({ db, getConfig, orderId: 'order-1', env, sendEmail, resendKey: 'explicit-request' });
  assert.equal(sends, 4);
  await sendOrderConfirmations({ db, getConfig, orderId: 'order-1', env, sendEmail, resendKey: 'explicit-request' });
  assert.equal(sends, 4);
});
