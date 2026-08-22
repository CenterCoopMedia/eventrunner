'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getTicketingProvider,
  ticketingSecretNames,
  providerNameSupportsWebhooks,
  assertProviderContract,
  PROVIDER_NAMES,
  WEBHOOK_CAPABLE_PROVIDERS,
} = require('./index.cjs');
const { createFakeTicketingProvider } = require('../ticketingFake.cjs');

test('selects the built-in none provider', () => {
  const provider = getTicketingProvider({ env: { EVENT_TICKETING_PROVIDER: 'none' } });
  assert.equal(provider.name, 'none');
  assert.equal(typeof provider.verifyWebhook, 'function');
  assert.equal(typeof provider.fetchOrder, 'function');
  assert.equal(typeof provider.listTickets, 'function');
  assert.equal(typeof provider.getRegistrationPrompt, 'function');
});

test('tolerates a padded provider value, as validateDeployEnv does', () => {
  const provider = getTicketingProvider({ env: { EVENT_TICKETING_PROVIDER: '  none  ' } });
  assert.equal(provider.name, 'none');
});

test('reads externalEventId once, from EVENT_TICKETING_EVENT_ID (§3.3)', () => {
  const provider = getTicketingProvider({
    env: { EVENT_TICKETING_PROVIDER: 'none', EVENT_TICKETING_EVENT_ID: ' evt-77 ' },
  });
  assert.equal(provider.externalEventId, 'evt-77');
});

test('an unset provider fails loudly — there is no emulator default', () => {
  assert.throws(
    () => getTicketingProvider({ env: {} }),
    /EVENT_TICKETING_PROVIDER is not set/,
  );
  assert.throws(
    () => getTicketingProvider({ env: { EVENT_TICKETING_PROVIDER: '   ' } }),
    /EVENT_TICKETING_PROVIDER is not set/,
  );
});

test('an unknown provider names the valid set', () => {
  assert.throws(
    () => getTicketingProvider({ env: { EVENT_TICKETING_PROVIDER: 'ticketmaster' } }),
    /Unknown EVENT_TICKETING_PROVIDER "ticketmaster".*eventbrite, manual, none/s,
  );
});

test('selecting an adapter that is not in the build says so, not MODULE_NOT_FOUND', () => {
  // manual (#31) has landed; only eventbrite (#30) is still unbuilt.
  assert.throws(
    () => getTicketingProvider({ env: { EVENT_TICKETING_PROVIDER: 'eventbrite' } }),
    /is "eventbrite", but that adapter is not part of this build/,
  );
});

test('manual is resolved by convention — adding providers/manual.cjs was the whole registration', () => {
  const { makeFakeDb } = require('../../cms/firestoreFake.cjs');
  const db = makeFakeDb();
  const provider = getTicketingProvider({ env: { EVENT_TICKETING_PROVIDER: 'manual' }, db });
  assert.equal(provider.name, 'manual');
  assert.equal(typeof provider.verifyWebhook, 'function');
  assert.equal(typeof provider.fetchOrder, 'function');
  assert.equal(typeof provider.listTickets, 'function');
  assert.equal(typeof provider.lookupByOrderNumber, 'function');
  assert.equal(typeof provider.getRegistrationPrompt, 'function');
  // No registerWebhook (§3.3 capability gate).
  assert.equal(typeof provider.registerWebhook, 'undefined');
});

test('a registered adapter factory is used and contract-checked', () => {
  const provider = getTicketingProvider({
    env: { EVENT_TICKETING_PROVIDER: 'eventbrite', EVENT_TICKETING_EVENT_ID: 'evt-1' },
    factories: { eventbrite: () => createFakeTicketingProvider({ name: 'eventbrite' }) },
  });
  assert.equal(provider.name, 'eventbrite');
  assert.equal(provider.externalEventId, 'evt-1');
});

test('an adapter whose name disagrees with the config is rejected', () => {
  assert.throws(
    () => getTicketingProvider({
      env: { EVENT_TICKETING_PROVIDER: 'eventbrite' },
      factories: { eventbrite: () => createFakeTicketingProvider({ name: 'manual' }) },
    }),
    /name mismatch/,
  );
});

test('an adapter missing a required method is rejected at selection', () => {
  const broken = createFakeTicketingProvider({ name: 'manual' });
  delete broken.fetchOrder;
  assert.throws(
    () => getTicketingProvider({
      env: { EVENT_TICKETING_PROVIDER: 'manual' },
      factories: { manual: () => broken },
    }),
    /missing fetchOrder\(\)/,
  );
});

test('an optional method that is not a function is rejected', () => {
  const broken = createFakeTicketingProvider({ name: 'manual' });
  broken.registerWebhook = 'yes';
  assert.throws(() => assertProviderContract(broken, 'manual'), /declares registerWebhook/);
});

test('a factory that returns nothing is rejected', () => {
  assert.throws(
    () => getTicketingProvider({
      env: { EVENT_TICKETING_PROVIDER: 'manual' },
      factories: { manual: () => null },
    }),
    /returned no provider/,
  );
});

test('secret gating follows §8.2: token off none, webhook secret by capability', () => {
  assert.deepEqual(ticketingSecretNames({ EVENT_TICKETING_PROVIDER: 'none' }), []);
  assert.deepEqual(ticketingSecretNames({ EVENT_TICKETING_PROVIDER: 'manual' }), ['TICKETING_API_TOKEN']);
  assert.deepEqual(
    ticketingSecretNames({ EVENT_TICKETING_PROVIDER: 'eventbrite' }),
    ['TICKETING_API_TOKEN', 'TICKETING_WEBHOOK_SECRET'],
  );
  // An unset or bogus value binds nothing: a deploy must not fail on a
  // secret chosen from a value that was never valid.
  assert.deepEqual(ticketingSecretNames({}), []);
  assert.deepEqual(ticketingSecretNames({ EVENT_TICKETING_PROVIDER: 'nope' }), []);
});

test('the webhook capability table covers only real provider names', () => {
  for (const name of WEBHOOK_CAPABLE_PROVIDERS) {
    assert.ok(PROVIDER_NAMES.includes(name), `${name} is not a provider name`);
  }
  assert.equal(providerNameSupportsWebhooks('eventbrite'), true);
  assert.equal(providerNameSupportsWebhooks('manual'), false);
  assert.equal(providerNameSupportsWebhooks('none'), false);
  assert.equal(providerNameSupportsWebhooks(undefined), false);
});

test('none behaves as manual-with-an-empty-set (§3.3), never as a retry source', async () => {
  const provider = getTicketingProvider({ env: { EVENT_TICKETING_PROVIDER: 'none' } });
  assert.deepEqual(await provider.listTickets(), { tickets: [], nextPageToken: null });
  assert.equal(await provider.lookupByOrderNumber('1234', 'a@example.com'), null);

  const verification = await provider.verifyWebhook(Buffer.from('{}'), {});
  assert.equal(verification.valid, false);
  assert.equal(verification.reason, 'no webhook');

  // complete: true — an order that can never fill in must not sit in the
  // queue for six attempts and then page an operator.
  const order = await provider.fetchOrder('ord-1');
  assert.equal(order.complete, true);
  assert.deepEqual(order.tickets, []);

  // No registerWebhook: the §3.3 capability gate reports false rather than
  // an unregistered-webhook warning.
  assert.equal(typeof provider.registerWebhook, 'undefined');

  // §3.5: `none` sends nothing.
  assert.equal((await provider.getRegistrationPrompt({})).send, false);
});
